-- ============================================================
-- 0005_movimientos_saldos.sql
-- Movimientos físicos por artículo con control transaccional de saldos:
-- recepción del proveedor, entrega al solicitante, devolución al proveedor
-- y retorno del solicitante. Recepciones/entregas parciales, bloqueo de
-- sobreentregas y dobles recepciones (FOR UPDATE + idempotencia),
-- anulación explícita sin borrar originales y cierre controlado.
-- ============================================================

create table if not exists public.movimientos (
  id             uuid primary key default gen_random_uuid(),
  articulo_id    uuid not null references public.articulos (id) on delete restrict,
  tipo           public.tipo_movimiento not null,
  cantidad       numeric(12,2) not null,
  fecha_efectiva date not null,                  -- declarada por quien registra
  creado_en      timestamptz not null default now(),  -- fecha técnica del servidor
  responsable_id uuid not null default auth.uid() references public.perfiles (id),
  contraparte    text,                           -- receptor / origen / destino
  observacion    text,
  permite_reposicion boolean not null default false,  -- en devoluciones al proveedor
  confirmado_por_solicitante boolean,
  confirmado_en  timestamptz,
  anulado        boolean not null default false,
  anulado_por    uuid references public.perfiles (id),
  anulado_motivo text,
  anulado_en     timestamptz,
  constraint mov_cantidad_positiva check (cantidad > 0)
);

create index if not exists movimientos_articulo_idx on public.movimientos (articulo_id, tipo) where not anulado;
create index if not exists movimientos_fecha_idx on public.movimientos (creado_en desc);

alter table public.movimientos enable row level security;

drop policy if exists mov_select on public.movimientos;
create policy mov_select on public.movimientos for select to authenticated
  using (app.es_gestor() or app.tiene_rol('almacen')
         or app.es_dueno_articulo(articulo_id) or app.es_aprobador_de(articulo_id));
-- Sin escritura directa: todo pasa por las funciones transaccionales.

-- Visibilidad de almacén sobre solicitudes/artículos en etapas físicas.
drop policy if exists solicitudes_select_almacen on public.solicitudes;
create policy solicitudes_select_almacen on public.solicitudes for select to authenticated
  using (
    app.tiene_rol('almacen') and exists (
      select 1 from public.articulos a
      where a.solicitud_id = solicitudes.id
        and a.etapa in ('comprado','en_transito','recibido_parcial','recibido_total','cerrado')
    )
  );

drop policy if exists articulos_select_almacen on public.articulos;
create policy articulos_select_almacen on public.articulos for select to authenticated
  using (
    app.tiene_rol('almacen')
    and etapa in ('comprado','en_transito','recibido_parcial','recibido_total','cerrado')
  );

-- ------------------------------------------------------------
-- Saldos de un artículo (coherentes bajo bloqueo del artículo)
-- ------------------------------------------------------------
create or replace function app.saldos_articulo(p_articulo uuid)
returns table (
  comprado numeric, recibido_bruto numeric, devuelto_proveedor numeric,
  recibido_neto numeric, entregado_bruto numeric, retornado numeric,
  entregado_neto numeric, disponible_almacen numeric, pendiente_llegada numeric
) language sql stable security definer
set search_path = ''
as $$
  with c as (
    select coalesce((select cantidad from public.compras where articulo_id = p_articulo), 0) as comprado
  ), m as (
    select
      coalesce(sum(cantidad) filter (where tipo = 'recepcion'), 0)            as rb,
      coalesce(sum(cantidad) filter (where tipo = 'devolucion_proveedor'), 0) as dp,
      coalesce(sum(cantidad) filter (where tipo = 'entrega'), 0)              as eb,
      coalesce(sum(cantidad) filter (where tipo = 'retorno_solicitante'), 0)  as rs
    from public.movimientos
    where articulo_id = p_articulo and not anulado
  )
  select
    c.comprado,
    m.rb,
    m.dp,
    m.rb - m.dp,
    m.eb,
    m.rs,
    m.eb - m.rs,
    (m.rb - m.dp) - (m.eb - m.rs),
    greatest(c.comprado - (m.rb - m.dp), 0)
  from c, m;
$$;

revoke all on function app.saldos_articulo(uuid) from public;
grant execute on function app.saldos_articulo(uuid) to authenticated;

-- RPC de consulta (respeta permisos de visibilidad del artículo).
create or replace function public.fn_saldos_articulo(p_articulo uuid)
returns jsonb language plpgsql stable security definer
set search_path = ''
as $$
declare s record; r jsonb;
begin
  if not (app.es_gestor() or app.tiene_rol('almacen')
          or app.es_dueno_articulo(p_articulo) or app.es_aprobador_de(p_articulo)) then
    raise exception 'Sin permiso para consultar este artículo.' using errcode = '42501';
  end if;
  select * into s from app.saldos_articulo(p_articulo);
  r := to_jsonb(s);
  return r;
end $$;

-- ------------------------------------------------------------
-- Actualización de etapa según saldos (tras cada movimiento)
-- ------------------------------------------------------------
create or replace function app.actualizar_etapa_fisica(p_articulo uuid)
returns void language plpgsql
set search_path = ''
as $$
declare
  v_art public.articulos%rowtype;
  s record;
  v_nueva public.etapa_articulo;
begin
  select * into v_art from public.articulos where id = p_articulo;
  if v_art.etapa in ('cerrado','cancelado') then return; end if;
  select * into s from app.saldos_articulo(p_articulo);
  if s.recibido_neto <= 0 then
    -- Sin unidades netas recibidas: vuelve a comprado/en tránsito.
    if v_art.etapa in ('recibido_parcial','recibido_total') then
      v_nueva := 'comprado';
    else
      return;
    end if;
  elsif s.recibido_neto >= s.comprado then
    v_nueva := 'recibido_total';
  else
    v_nueva := 'recibido_parcial';
  end if;
  if v_nueva is distinct from v_art.etapa then
    update public.articulos set etapa = v_nueva where id = p_articulo;
    if v_nueva = 'recibido_total' then
      update public.compras set llegada_completa_en = coalesce(llegada_completa_en, now())
       where articulo_id = p_articulo;
    end if;
  end if;
end $$;

-- ------------------------------------------------------------
-- Registro de movimientos (función transaccional única)
-- ------------------------------------------------------------
create or replace function public.fn_registrar_movimiento(
  p_articulo uuid,
  p_tipo public.tipo_movimiento,
  p_cantidad numeric,
  p_fecha_efectiva date,
  p_contraparte text,
  p_observacion text,
  p_permite_reposicion boolean,
  p_op uuid
) returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare
  v_art public.articulos%rowtype;
  s record;
  v_id uuid;
  v_res jsonb;
  v_puede boolean;
begin
  v_res := app.op_existente(p_op);
  if v_res is not null then return v_res; end if;

  -- Permisos: Compras/Admin siempre; Almacén para recepciones/entregas/devoluciones;
  -- el solicitante no registra movimientos (confirma entregas).
  v_puede := app.es_gestor() or app.tiene_rol('almacen');
  if not v_puede then
    raise exception 'Tu rol no permite registrar movimientos.' using errcode = '42501';
  end if;
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'La cantidad debe ser mayor que cero.';
  end if;
  if p_fecha_efectiva is null then
    raise exception 'Indica la fecha efectiva del movimiento.';
  end if;
  if p_fecha_efectiva > (now() at time zone 'America/Bogota')::date then
    raise exception 'La fecha efectiva no puede ser futura.';
  end if;

  -- Bloqueo del artículo: serializa movimientos concurrentes.
  select * into v_art from public.articulos where id = p_articulo for update;
  if not found then raise exception 'Artículo no encontrado.'; end if;
  if v_art.etapa in ('borrador','solicitado','en_cotizacion','cotizado') then
    raise exception 'El artículo aún no tiene compra registrada.';
  end if;
  if v_art.etapa = 'cancelado' then
    raise exception 'El artículo está cancelado.';
  end if;
  if v_art.etapa = 'cerrado' then
    raise exception 'El artículo está cerrado; reábrelo con motivo para registrar movimientos.';
  end if;

  -- Un cambio material pendiente de aprobación bloquea nuevas recepciones.
  if p_tipo = 'recepcion' and v_art.requiere_aprobacion
     and app.estado_aprobacion(p_articulo) in ('pendiente','rechazada') then
    raise exception 'Hay una aprobación pendiente o rechazada sobre este artículo: no se registran nuevas recepciones.';
  end if;

  select * into s from app.saldos_articulo(p_articulo);

  if p_tipo = 'recepcion' then
    if s.recibido_neto + p_cantidad > s.comprado then
      raise exception 'Recepción rechazada: lo recibido neto (% + % = %) superaría la cantidad comprada (%). Si es correcto, primero modifica la compra con autorización.',
        s.recibido_neto, p_cantidad, s.recibido_neto + p_cantidad, s.comprado;
    end if;
  elsif p_tipo = 'entrega' then
    if p_cantidad > s.disponible_almacen then
      raise exception 'Entrega rechazada: solo hay % disponibles en almacén y se intentó entregar %.',
        s.disponible_almacen, p_cantidad;
    end if;
    if nullif(btrim(coalesce(p_contraparte,'')),'') is null then
      raise exception 'Indica quién recibe la entrega.';
    end if;
  elsif p_tipo = 'devolucion_proveedor' then
    if p_cantidad > s.disponible_almacen then
      raise exception 'Devolución rechazada: solo hay % disponibles en almacén. Lo ya entregado requiere primero un retorno del solicitante.',
        s.disponible_almacen;
    end if;
    if nullif(btrim(coalesce(p_observacion,'')),'') is null then
      raise exception 'Indica el motivo de la devolución al proveedor.';
    end if;
  elsif p_tipo = 'retorno_solicitante' then
    if p_cantidad > s.entregado_neto then
      raise exception 'Retorno rechazado: lo entregado neto es % y se intentó retornar %.',
        s.entregado_neto, p_cantidad;
    end if;
    if nullif(btrim(coalesce(p_observacion,'')),'') is null then
      raise exception 'Indica el motivo del retorno.';
    end if;
  end if;

  insert into public.movimientos (
    articulo_id, tipo, cantidad, fecha_efectiva, contraparte, observacion,
    permite_reposicion, responsable_id
  ) values (
    p_articulo, p_tipo, p_cantidad, p_fecha_efectiva,
    nullif(btrim(coalesce(p_contraparte,'')),''),
    nullif(btrim(coalesce(p_observacion,'')),''),
    coalesce(p_permite_reposicion, false) and p_tipo = 'devolucion_proveedor',
    auth.uid()
  ) returning id into v_id;

  perform app.modo_servidor();
  perform app.actualizar_etapa_fisica(p_articulo);

  select * into s from app.saldos_articulo(p_articulo);
  v_res := jsonb_build_object('ok', true, 'movimiento_id', v_id, 'saldos', to_jsonb(s));
  perform app.op_guardar(p_op, 'fn_registrar_movimiento', v_res);
  return v_res;
end $$;

-- Entrega directa al solicitante: conserva ambos eventos (recepción + entrega).
create or replace function public.fn_entrega_directa(
  p_articulo uuid,
  p_cantidad numeric,
  p_fecha_efectiva date,
  p_receptor text,
  p_observacion text,
  p_op uuid
) returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare
  v_res jsonb;
  v_r jsonb;
begin
  v_res := app.op_existente(p_op);
  if v_res is not null then return v_res; end if;
  if nullif(btrim(coalesce(p_receptor,'')),'') is null then
    raise exception 'Indica quién recibe la entrega directa.';
  end if;

  v_r := public.fn_registrar_movimiento(
    p_articulo, 'recepcion', p_cantidad, p_fecha_efectiva,
    'Entrega directa', coalesce(p_observacion,'Entrega directa al solicitante (recepción)'),
    false, gen_random_uuid());
  v_r := public.fn_registrar_movimiento(
    p_articulo, 'entrega', p_cantidad, p_fecha_efectiva,
    p_receptor, coalesce(p_observacion,'Entrega directa al solicitante (entrega)'),
    false, gen_random_uuid());

  v_res := jsonb_build_object('ok', true, 'saldos', v_r -> 'saldos');
  perform app.op_guardar(p_op, 'fn_entrega_directa', v_res);
  return v_res;
end $$;

-- Confirmación de entrega por el solicitante.
create or replace function public.fn_confirmar_entrega(p_movimiento uuid)
returns void language plpgsql security definer
set search_path = ''
as $$
declare v_m public.movimientos%rowtype;
begin
  select * into v_m from public.movimientos where id = p_movimiento for update;
  if not found or v_m.tipo <> 'entrega' then
    raise exception 'Entrega no encontrada.';
  end if;
  if not app.es_dueno_articulo(v_m.articulo_id) then
    raise exception 'Solo el solicitante confirma su entrega.' using errcode = '42501';
  end if;
  if v_m.anulado then raise exception 'El movimiento está anulado.'; end if;
  if coalesce(v_m.confirmado_por_solicitante, false) then return; end if;
  update public.movimientos
     set confirmado_por_solicitante = true, confirmado_en = now()
   where id = p_movimiento;
  perform app.auditar('movimientos', p_movimiento::text, 'CONFIRMACION_ENTREGA',
    null, jsonb_build_object('confirmado', true), null);
end $$;

-- Anulación explícita (corrige errores de digitación sin borrar el original).
create or replace function public.fn_anular_movimiento(
  p_movimiento uuid, p_motivo text, p_op uuid
) returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare
  v_m public.movimientos%rowtype;
  s record;
  v_res jsonb;
begin
  v_res := app.op_existente(p_op);
  if v_res is not null then return v_res; end if;

  if not app.es_gestor() then
    raise exception 'Solo Compras o el administrador anulan movimientos.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_motivo,'')),'') is null then
    raise exception 'Indica el motivo de la anulación.';
  end if;
  select * into v_m from public.movimientos where id = p_movimiento for update;
  if not found then raise exception 'Movimiento no encontrado.'; end if;
  if v_m.anulado then
    v_res := jsonb_build_object('ok', true, 'ya_anulado', true);
    perform app.op_guardar(p_op, 'fn_anular_movimiento', v_res);
    return v_res;
  end if;

  -- Bloquear el artículo y validar que anular no deja saldos imposibles.
  perform 1 from public.articulos where id = v_m.articulo_id for update;

  update public.movimientos
     set anulado = true, anulado_por = auth.uid(), anulado_motivo = btrim(p_motivo), anulado_en = now()
   where id = p_movimiento;

  select * into s from app.saldos_articulo(v_m.articulo_id);
  if s.recibido_bruto < 0 or s.recibido_neto < 0 or s.entregado_neto < 0
     or s.disponible_almacen < 0 or s.recibido_neto > s.comprado
     or s.entregado_neto > s.recibido_neto then
    raise exception 'No se puede anular: dejaría los saldos inconsistentes (anula primero los movimientos posteriores que dependen de este).';
  end if;

  perform app.modo_servidor();
  perform app.actualizar_etapa_fisica(v_m.articulo_id);

  perform app.auditar('movimientos', p_movimiento::text, 'ANULACION',
    to_jsonb(v_m), jsonb_build_object('anulado', true), p_motivo);

  v_res := jsonb_build_object('ok', true, 'saldos', to_jsonb(s));
  perform app.op_guardar(p_op, 'fn_anular_movimiento', v_res);
  return v_res;
end $$;

-- ------------------------------------------------------------
-- Cierre y reapertura de artículo
-- ------------------------------------------------------------
create or replace function public.fn_cerrar_articulo(
  p_articulo uuid, p_motivo text, p_version integer
) returns void language plpgsql security definer
set search_path = ''
as $$
declare
  v_art public.articulos%rowtype;
  s record;
  v_novedades integer;
  v_pendiente boolean;
begin
  if not app.es_gestor() then
    raise exception 'Solo Compras o el administrador cierran artículos.' using errcode = '42501';
  end if;
  select * into v_art from public.articulos where id = p_articulo for update;
  if not found then raise exception 'Artículo no encontrado.'; end if;
  if v_art.version <> p_version then
    raise exception 'El artículo fue modificado en otra sesión. Recarga e intenta de nuevo.' using errcode = '40001';
  end if;
  if v_art.etapa not in ('recibido_parcial','recibido_total') then
    raise exception 'Solo se cierran artículos recibidos (parcial o total).';
  end if;

  select * into s from app.saldos_articulo(p_articulo);
  select count(*) into v_novedades
  from public.novedades n
  where n.articulo_id = p_articulo and n.estado <> 'resuelta';

  v_pendiente := (s.pendiente_llegada > 0) or (v_novedades > 0);
  if v_pendiente and nullif(btrim(coalesce(p_motivo,'')),'') is null then
    raise exception 'El artículo tiene % pendiente(s) por llegar y % novedad(es) sin resolver: el cierre exige una resolución documentada (motivo).',
      s.pendiente_llegada, v_novedades;
  end if;

  perform app.validar_transicion(v_art.etapa, 'cerrado', coalesce(p_motivo,'Cierre normal'), true);

  perform app.modo_servidor();
  update public.articulos
     set etapa = 'cerrado', cerrado_en = now(),
         cerrado_motivo = nullif(btrim(coalesce(p_motivo,'')),'')
   where id = p_articulo;

  perform app.auditar('articulos', p_articulo::text, 'CIERRE',
    jsonb_build_object('etapa', v_art.etapa),
    jsonb_build_object('etapa','cerrado','saldos', to_jsonb(s), 'novedades_abiertas', v_novedades),
    p_motivo);
end $$;

create or replace function public.fn_reabrir_articulo(
  p_articulo uuid, p_motivo text, p_version integer
) returns void language plpgsql security definer
set search_path = ''
as $$
declare
  v_art public.articulos%rowtype;
  s record;
  v_nueva public.etapa_articulo;
begin
  if not app.es_admin() then
    raise exception 'Solo el administrador reabre artículos cerrados.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_motivo,'')),'') is null then
    raise exception 'Indica el motivo de la reapertura.';
  end if;
  select * into v_art from public.articulos where id = p_articulo for update;
  if not found then raise exception 'Artículo no encontrado.'; end if;
  if v_art.version <> p_version then
    raise exception 'El artículo fue modificado en otra sesión. Recarga e intenta de nuevo.' using errcode = '40001';
  end if;
  if v_art.etapa <> 'cerrado' then
    raise exception 'El artículo no está cerrado.';
  end if;

  select * into s from app.saldos_articulo(p_articulo);
  v_nueva := case when s.recibido_neto >= s.comprado then 'recibido_total'
                  else 'recibido_parcial' end;
  perform app.validar_transicion('cerrado', v_nueva, p_motivo, true);

  perform app.modo_servidor();
  update public.articulos
     set etapa = v_nueva, cerrado_en = null, cerrado_motivo = null
   where id = p_articulo;
  perform app.auditar('articulos', p_articulo::text, 'REAPERTURA',
    jsonb_build_object('etapa','cerrado'), jsonb_build_object('etapa', v_nueva), p_motivo);
end $$;
