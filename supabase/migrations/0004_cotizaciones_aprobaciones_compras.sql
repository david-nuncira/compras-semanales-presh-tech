-- ============================================================
-- 0004_cotizaciones_aprobaciones_compras.sql
-- Cotizaciones alternativas con selección inequívoca, aprobaciones
-- versionadas con evidencia, compra bloqueada sin aprobación vigente,
-- importes decimales calculados y validados en servidor, y
-- fechas estimadas con historial.
-- ============================================================

create table if not exists public.cotizaciones (
  id             uuid primary key default gen_random_uuid(),
  articulo_id    uuid not null references public.articulos (id) on delete cascade,
  proveedor_id   uuid not null references public.proveedores (id),
  moneda         char(3) not null default 'COP',
  precio_unitario numeric(14,2) not null,
  cantidad       numeric(12,2) not null,
  impuestos      numeric(14,2) not null default 0,
  descuentos     numeric(14,2) not null default 0,
  otros_cargos   numeric(14,2) not null default 0,
  notas          text,
  es_seleccionada boolean not null default false,
  creado_por     uuid not null default auth.uid(),
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  version        integer not null default 1,
  constraint cot_montos check (
    precio_unitario >= 0 and cantidad > 0 and impuestos >= 0
    and descuentos >= 0 and otros_cargos >= 0
  ),
  constraint cot_moneda check (moneda ~ '^[A-Z]{3}$')
);

-- Selección inequívoca: a lo sumo una cotización seleccionada por artículo.
create unique index if not exists cotizaciones_seleccionada_unica
  on public.cotizaciones (articulo_id) where es_seleccionada;

create index if not exists cotizaciones_articulo_idx on public.cotizaciones (articulo_id);

create table if not exists public.aprobaciones (
  id             uuid primary key default gen_random_uuid(),
  articulo_id    uuid not null references public.articulos (id) on delete cascade,
  aprobador_id   uuid not null references public.perfiles (id),
  solicitada_por uuid not null references public.perfiles (id),
  estado         public.estado_aprobacion not null default 'pendiente',
  es_vigente     boolean not null default true,
  version_aprobada jsonb not null,   -- qué se aprueba: artículo, cantidad, proveedor, importe
  comentario     text,
  decidido_en    timestamptz,
  creado_en      timestamptz not null default now()
);

create unique index if not exists aprobaciones_vigente_unica
  on public.aprobaciones (articulo_id) where es_vigente;
create index if not exists aprobaciones_aprobador_idx on public.aprobaciones (aprobador_id, estado);

create table if not exists public.compras (
  id             uuid primary key default gen_random_uuid(),
  articulo_id    uuid not null unique references public.articulos (id) on delete cascade,
  cotizacion_id  uuid references public.cotizaciones (id),
  proveedor_id   uuid not null references public.proveedores (id),
  moneda         char(3) not null default 'COP',
  precio_unitario numeric(14,2) not null,
  cantidad       numeric(12,2) not null,
  subtotal       numeric(14,2) not null,
  impuestos      numeric(14,2) not null default 0,
  descuentos     numeric(14,2) not null default 0,
  otros_cargos   numeric(14,2) not null default 0,
  total          numeric(14,2) not null,
  fecha_compra   date not null,
  referencia     text,
  fecha_estimada_llegada date,          -- null = "sin información" (nunca "0 días de atraso")
  llegada_completa_en timestamptz,
  responsable_id uuid not null default auth.uid() references public.perfiles (id),
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  version        integer not null default 1,
  constraint compra_montos check (
    precio_unitario >= 0 and cantidad > 0 and impuestos >= 0
    and descuentos >= 0 and otros_cargos >= 0
  ),
  constraint compra_subtotal check (subtotal = round(precio_unitario * cantidad, 2)),
  constraint compra_total check (total = subtotal + impuestos + otros_cargos - descuentos),
  constraint compra_moneda check (moneda ~ '^[A-Z]{3}$')
);

create index if not exists compras_proveedor_idx on public.compras (proveedor_id);
create index if not exists compras_fecha_idx on public.compras (fecha_compra);

-- Historial de fechas estimadas (visible junto al artículo).
create table if not exists public.compra_fechas_estimadas (
  id         bigint generated always as identity primary key,
  compra_id  uuid not null references public.compras (id) on delete cascade,
  fecha_estimada date,
  motivo     text,
  creado_por uuid not null default auth.uid(),
  creado_en  timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Helpers
-- ------------------------------------------------------------
create or replace function app.es_dueno_articulo(p_articulo uuid)
returns boolean language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.articulos a
    join public.solicitudes s on s.id = a.solicitud_id
    where a.id = p_articulo and s.solicitante_id = auth.uid()
  ) and app.es_activo();
$$;

create or replace function app.es_aprobador_de(p_articulo uuid)
returns boolean language sql stable security definer
set search_path = ''
as $$
  select app.tiene_rol('aprobador') and exists (
    select 1 from public.articulos a
    where a.id = p_articulo and a.aprobador_id = auth.uid()
  );
$$;

-- Estado de aprobación del artículo: no_requiere / sin_solicitar / pendiente / aprobada / rechazada
create or replace function app.estado_aprobacion(p_articulo uuid)
returns text language sql stable security definer
set search_path = ''
as $$
  select case
    when not a.requiere_aprobacion then 'no_requiere'
    else coalesce(
      (select ap.estado::text from public.aprobaciones ap
        where ap.articulo_id = a.id and ap.es_vigente),
      'sin_solicitar')
  end
  from public.articulos a where a.id = p_articulo;
$$;

-- ¿La aprobación bloquea compra/recepciones?
create or replace function app.aprobacion_bloquea(p_articulo uuid)
returns boolean language sql stable security definer
set search_path = ''
as $$
  select app.estado_aprobacion(p_articulo) in ('sin_solicitar','pendiente','rechazada');
$$;

revoke all on function app.es_dueno_articulo(uuid), app.es_aprobador_de(uuid),
  app.estado_aprobacion(uuid), app.aprobacion_bloquea(uuid) from public;
grant execute on function app.es_dueno_articulo(uuid), app.es_aprobador_de(uuid),
  app.estado_aprobacion(uuid), app.aprobacion_bloquea(uuid) to authenticated;

-- ------------------------------------------------------------
-- Visibilidad adicional: el aprobador ve las solicitudes/artículos asignados.
-- ------------------------------------------------------------
drop policy if exists solicitudes_select_aprobador on public.solicitudes;
create policy solicitudes_select_aprobador on public.solicitudes for select to authenticated
  using (
    app.tiene_rol('aprobador') and exists (
      select 1 from public.articulos a
      where a.solicitud_id = solicitudes.id and a.aprobador_id = auth.uid()
    )
  );

drop policy if exists articulos_select_aprobador on public.articulos;
create policy articulos_select_aprobador on public.articulos for select to authenticated
  using (app.tiene_rol('aprobador') and aprobador_id = auth.uid());

-- ------------------------------------------------------------
-- RLS de las tablas nuevas
-- ------------------------------------------------------------
alter table public.cotizaciones enable row level security;
alter table public.aprobaciones enable row level security;
alter table public.compras enable row level security;
alter table public.compra_fechas_estimadas enable row level security;

drop policy if exists cot_select on public.cotizaciones;
create policy cot_select on public.cotizaciones for select to authenticated
  using (app.es_gestor() or app.es_dueno_articulo(articulo_id) or app.es_aprobador_de(articulo_id));

drop policy if exists cot_insert on public.cotizaciones;
create policy cot_insert on public.cotizaciones for insert to authenticated
  with check (app.es_gestor() and creado_por = auth.uid());

drop policy if exists cot_update on public.cotizaciones;
create policy cot_update on public.cotizaciones for update to authenticated
  using (app.es_gestor()) with check (app.es_gestor());

drop policy if exists cot_delete on public.cotizaciones;
create policy cot_delete on public.cotizaciones for delete to authenticated
  using (app.es_gestor());

drop policy if exists apr_select on public.aprobaciones;
create policy apr_select on public.aprobaciones for select to authenticated
  using (app.es_gestor() or app.es_dueno_articulo(articulo_id) or aprobador_id = auth.uid());
-- aprobaciones: sin INSERT/UPDATE/DELETE directos (solo RPC).

drop policy if exists compras_select on public.compras;
create policy compras_select on public.compras for select to authenticated
  using (app.es_gestor() or app.es_dueno_articulo(articulo_id) or app.es_aprobador_de(articulo_id)
         or app.tiene_rol('almacen'));
-- compras: sin escritura directa (solo RPC).

drop policy if exists cfe_select on public.compra_fechas_estimadas;
create policy cfe_select on public.compra_fechas_estimadas for select to authenticated
  using (exists (
    select 1 from public.compras c where c.id = compra_id
      and (app.es_gestor() or app.es_dueno_articulo(c.articulo_id)
           or app.es_aprobador_de(c.articulo_id) or app.tiene_rol('almacen'))
  ));

-- Protección de cotizaciones: la selección y el bloqueo tras compra.
create or replace function app.tg_cotizaciones_proteger()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE','DELETE') then
    if exists (select 1 from public.compras c where c.articulo_id = old.articulo_id) then
      raise exception 'Ya existe compra registrada para este artículo: la cotización queda como evidencia.';
    end if;
  end if;
  if tg_op = 'UPDATE' and not app.es_servidor() then
    if new.es_seleccionada is distinct from old.es_seleccionada then
      raise exception 'La selección se realiza con la operación "Seleccionar cotización".';
    end if;
  end if;
  if tg_op = 'INSERT' and not app.es_servidor() then
    if new.es_seleccionada then
      raise exception 'La selección se realiza con la operación "Seleccionar cotización".';
    end if;
    if not exists (select 1 from public.articulos a where a.id = new.articulo_id
                   and a.etapa in ('solicitado','en_cotizacion','cotizado')) then
      raise exception 'El artículo no está en etapa de cotización.';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists tg_cotizaciones_proteger on public.cotizaciones;
create trigger tg_cotizaciones_proteger
  before insert or update or delete on public.cotizaciones
  for each row execute function app.tg_cotizaciones_proteger();

drop trigger if exists tg_cotizaciones_version on public.cotizaciones;
create trigger tg_cotizaciones_version before update on public.cotizaciones
  for each row execute function app.tg_version();

-- ------------------------------------------------------------
-- RPCs de cotización
-- ------------------------------------------------------------
create or replace function public.fn_seleccionar_cotizacion(
  p_cotizacion uuid, p_version_articulo integer
) returns void language plpgsql security definer
set search_path = ''
as $$
declare
  v_cot public.cotizaciones%rowtype;
  v_art public.articulos%rowtype;
begin
  if not app.es_gestor() then
    raise exception 'Solo Compras selecciona cotizaciones.' using errcode = '42501';
  end if;
  -- Orden de bloqueo consistente: primero el artículo, luego la cotización.
  select * into v_cot from public.cotizaciones where id = p_cotizacion;
  if not found then raise exception 'Cotización no encontrada.'; end if;
  select * into v_art from public.articulos where id = v_cot.articulo_id for update;
  select * into v_cot from public.cotizaciones where id = p_cotizacion for update;
  if v_art.version <> p_version_articulo then
    raise exception 'El artículo fue modificado en otra sesión. Recarga e intenta de nuevo.' using errcode = '40001';
  end if;
  if v_art.etapa not in ('solicitado','en_cotizacion','cotizado') then
    raise exception 'El artículo no está en etapa de cotización.';
  end if;
  if exists (select 1 from public.compras c where c.articulo_id = v_art.id) then
    raise exception 'Ya existe compra registrada para este artículo.';
  end if;

  perform app.modo_servidor();
  update public.cotizaciones set es_seleccionada = false
   where articulo_id = v_art.id and es_seleccionada;
  update public.cotizaciones set es_seleccionada = true where id = p_cotizacion;

  if v_art.etapa in ('solicitado','en_cotizacion') then
    update public.articulos set etapa = 'cotizado' where id = v_art.id;
    perform app.auditar('articulos', v_art.id::text, 'CAMBIO_ETAPA',
      jsonb_build_object('etapa', v_art.etapa), jsonb_build_object('etapa','cotizado'),
      'Cotización seleccionada');
  end if;
  perform app.auditar('cotizaciones', p_cotizacion::text, 'SELECCION',
    null, jsonb_build_object('articulo_id', v_art.id), null);
end $$;

-- ------------------------------------------------------------
-- RPCs de aprobación
-- ------------------------------------------------------------
create or replace function public.fn_configurar_aprobacion(
  p_articulo uuid, p_requiere boolean, p_aprobador uuid, p_version integer
) returns void language plpgsql security definer
set search_path = ''
as $$
declare v_art public.articulos%rowtype;
begin
  if not app.es_gestor() then
    raise exception 'Solo Compras o el administrador configuran la aprobación.' using errcode = '42501';
  end if;
  select * into v_art from public.articulos where id = p_articulo for update;
  if not found then raise exception 'Artículo no encontrado.'; end if;
  if v_art.version <> p_version then
    raise exception 'El artículo fue modificado en otra sesión. Recarga e intenta de nuevo.' using errcode = '40001';
  end if;
  if v_art.etapa in ('comprado','en_transito','recibido_parcial','recibido_total','cerrado','cancelado') then
    raise exception 'La aprobación se configura antes de la compra.';
  end if;
  if p_requiere then
    if p_aprobador is null then
      raise exception 'Designa el aprobador.';
    end if;
    if not app.rol_de(p_aprobador, 'aprobador') then
      raise exception 'La persona designada no tiene permiso de aprobador activo.';
    end if;
  end if;

  perform app.modo_servidor();
  update public.articulos
     set requiere_aprobacion = p_requiere,
         aprobador_id = case when p_requiere then p_aprobador else null end
   where id = p_articulo;

  -- Si deja de requerir aprobación, la vigente pendiente queda reemplazada (se conserva).
  if not p_requiere then
    update public.aprobaciones
       set es_vigente = false,
           estado = case when estado = 'pendiente' then 'reemplazada' else estado end
     where articulo_id = p_articulo and es_vigente;
  end if;

  perform app.auditar('articulos', p_articulo::text, 'CONFIG_APROBACION',
    jsonb_build_object('requiere', v_art.requiere_aprobacion, 'aprobador', v_art.aprobador_id),
    jsonb_build_object('requiere', p_requiere, 'aprobador', p_aprobador), null);
end $$;

create or replace function public.fn_solicitar_aprobacion(p_articulo uuid, p_op uuid)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare
  v_art public.articulos%rowtype;
  v_sol public.solicitudes%rowtype;
  v_cot record;
  v_snapshot jsonb;
  v_id uuid;
  v_res jsonb;
begin
  v_res := app.op_existente(p_op);
  if v_res is not null then return v_res; end if;

  if not app.es_gestor() then
    raise exception 'Solo Compras solicita aprobaciones.' using errcode = '42501';
  end if;
  select * into v_art from public.articulos where id = p_articulo for update;
  if not found then raise exception 'Artículo no encontrado.'; end if;
  if not v_art.requiere_aprobacion or v_art.aprobador_id is null then
    raise exception 'Configura primero "requiere aprobación" y el aprobador designado.';
  end if;
  select * into v_sol from public.solicitudes where id = v_art.solicitud_id;
  if v_art.aprobador_id = v_sol.solicitante_id
     and not app.config_bool('aprobador_puede_decidir_propia', false) then
    raise exception 'El aprobador no puede decidir su propia solicitud; designa otro aprobador.';
  end if;

  select c.*, p.nombre as proveedor_nombre into v_cot
  from public.cotizaciones c join public.proveedores p on p.id = c.proveedor_id
  where c.articulo_id = p_articulo and c.es_seleccionada;
  if not found then
    raise exception 'Selecciona primero la cotización que se somete a aprobación.';
  end if;

  v_snapshot := jsonb_build_object(
    'articulo', v_art.nombre,
    'descripcion', v_art.descripcion,
    'cantidad', v_cot.cantidad,
    'unidad', v_art.unidad,
    'proveedor_id', v_cot.proveedor_id,
    'proveedor', v_cot.proveedor_nombre,
    'moneda', v_cot.moneda,
    'precio_unitario', v_cot.precio_unitario,
    'total_estimado', round(v_cot.precio_unitario * v_cot.cantidad, 2)
      + v_cot.impuestos + v_cot.otros_cargos - v_cot.descuentos
  );

  update public.aprobaciones
     set es_vigente = false,
         estado = case when estado = 'pendiente' then 'reemplazada' else estado end
   where articulo_id = p_articulo and es_vigente;

  insert into public.aprobaciones (articulo_id, aprobador_id, solicitada_por, version_aprobada)
  values (p_articulo, v_art.aprobador_id, auth.uid(), v_snapshot)
  returning id into v_id;

  perform app.auditar('aprobaciones', v_id::text, 'SOLICITUD_APROBACION',
    null, v_snapshot, null);

  v_res := jsonb_build_object('ok', true, 'aprobacion_id', v_id);
  perform app.op_guardar(p_op, 'fn_solicitar_aprobacion', v_res);
  return v_res;
end $$;

create or replace function public.fn_decidir_aprobacion(
  p_aprobacion uuid, p_aprobar boolean, p_comentario text, p_op uuid
) returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare
  v_apr public.aprobaciones%rowtype;
  v_sol_id uuid;
  v_res jsonb;
begin
  v_res := app.op_existente(p_op);
  if v_res is not null then return v_res; end if;

  select * into v_apr from public.aprobaciones where id = p_aprobacion for update;
  if not found then raise exception 'Aprobación no encontrada.'; end if;
  if v_apr.aprobador_id <> auth.uid() or not app.tiene_rol('aprobador') then
    raise exception 'Solo el aprobador designado decide esta aprobación.' using errcode = '42501';
  end if;
  if not v_apr.es_vigente or v_apr.estado <> 'pendiente' then
    raise exception 'Esta aprobación ya fue decidida o reemplazada.';
  end if;
  select a.solicitud_id into v_sol_id from public.articulos a where a.id = v_apr.articulo_id;
  if exists (select 1 from public.solicitudes s where s.id = v_sol_id
             and s.solicitante_id = auth.uid())
     and not app.config_bool('aprobador_puede_decidir_propia', false) then
    raise exception 'No puedes aprobar tu propia solicitud.';
  end if;
  if not p_aprobar and nullif(btrim(coalesce(p_comentario,'')),'') is null then
    raise exception 'Indica el motivo del rechazo.';
  end if;

  update public.aprobaciones
     set estado = case when p_aprobar then 'aprobada' else 'rechazada' end,
         comentario = p_comentario,
         decidido_en = now()
   where id = p_aprobacion;

  perform app.auditar('aprobaciones', p_aprobacion::text,
    case when p_aprobar then 'APROBADA' else 'RECHAZADA' end,
    jsonb_build_object('estado','pendiente'),
    jsonb_build_object('estado', case when p_aprobar then 'aprobada' else 'rechazada' end,
                       'comentario', p_comentario),
    p_comentario);

  v_res := jsonb_build_object('ok', true);
  perform app.op_guardar(p_op, 'fn_decidir_aprobacion', v_res);
  return v_res;
end $$;

-- ------------------------------------------------------------
-- RPCs de compra
-- ------------------------------------------------------------
create or replace function public.fn_registrar_compra(
  p_articulo uuid,
  p_cantidad numeric,
  p_fecha_compra date,
  p_impuestos numeric,
  p_descuentos numeric,
  p_otros_cargos numeric,
  p_referencia text,
  p_fecha_estimada date,
  p_version_articulo integer,
  p_op uuid
) returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare
  v_art public.articulos%rowtype;
  v_cot public.cotizaciones%rowtype;
  v_apr public.aprobaciones%rowtype;
  v_estado_apr text;
  v_subtotal numeric(14,2);
  v_total numeric(14,2);
  v_id uuid;
  v_res jsonb;
begin
  v_res := app.op_existente(p_op);
  if v_res is not null then return v_res; end if;

  if not app.es_gestor() then
    raise exception 'Solo Compras registra compras.' using errcode = '42501';
  end if;
  select * into v_art from public.articulos where id = p_articulo for update;
  if not found then raise exception 'Artículo no encontrado.'; end if;
  if v_art.version <> p_version_articulo then
    raise exception 'El artículo fue modificado en otra sesión. Recarga e intenta de nuevo.' using errcode = '40001';
  end if;
  if v_art.etapa <> 'cotizado' then
    raise exception 'La compra se registra con el artículo en etapa "cotizado" (proveedor y precio seleccionados).';
  end if;
  if exists (select 1 from public.compras c where c.articulo_id = p_articulo) then
    raise exception 'Este artículo ya tiene compra registrada.';
  end if;

  select * into v_cot from public.cotizaciones
   where articulo_id = p_articulo and es_seleccionada;
  if not found then
    raise exception 'No hay cotización seleccionada: no se puede comprar sin proveedor y precio.';
  end if;

  -- Bloqueo por aprobación obligatoria.
  v_estado_apr := app.estado_aprobacion(p_articulo);
  if v_estado_apr in ('sin_solicitar','pendiente','rechazada') then
    raise exception 'Aprobación obligatoria %: no se puede registrar la compra.',
      case v_estado_apr when 'sin_solicitar' then 'sin solicitar'
                        when 'pendiente' then 'pendiente' else 'rechazada' end;
  end if;

  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'Cantidad a comprar inválida.';
  end if;
  if coalesce(p_impuestos,0) < 0 or coalesce(p_descuentos,0) < 0 or coalesce(p_otros_cargos,0) < 0 then
    raise exception 'Importes negativos no permitidos.';
  end if;
  if p_fecha_compra is null then
    raise exception 'Indica la fecha de compra.';
  end if;

  -- Si la aprobación fue sobre otra cantidad/proveedor/precio, exigir nueva aprobación.
  if v_estado_apr = 'aprobada' then
    select * into v_apr from public.aprobaciones
     where articulo_id = p_articulo and es_vigente;
    if (v_apr.version_aprobada ->> 'proveedor_id')::uuid is distinct from v_cot.proveedor_id
       or (v_apr.version_aprobada ->> 'precio_unitario')::numeric is distinct from v_cot.precio_unitario
       or (v_apr.version_aprobada ->> 'moneda') is distinct from v_cot.moneda::text
       or (v_apr.version_aprobada ->> 'cantidad')::numeric is distinct from p_cantidad then
      raise exception 'La compra difiere materialmente de lo aprobado (cantidad, proveedor o precio): solicita una nueva aprobación. La anterior se conserva.';
    end if;
  end if;

  v_subtotal := round(v_cot.precio_unitario * p_cantidad, 2);
  v_total := v_subtotal + coalesce(p_impuestos,0) + coalesce(p_otros_cargos,0) - coalesce(p_descuentos,0);
  if v_total < 0 then
    raise exception 'El total no puede ser negativo (revisa los descuentos).';
  end if;

  insert into public.compras (
    articulo_id, cotizacion_id, proveedor_id, moneda, precio_unitario, cantidad,
    subtotal, impuestos, descuentos, otros_cargos, total,
    fecha_compra, referencia, fecha_estimada_llegada, responsable_id
  ) values (
    p_articulo, v_cot.id, v_cot.proveedor_id, v_cot.moneda, v_cot.precio_unitario, p_cantidad,
    v_subtotal, coalesce(p_impuestos,0), coalesce(p_descuentos,0), coalesce(p_otros_cargos,0), v_total,
    p_fecha_compra, nullif(btrim(coalesce(p_referencia,'')),''), p_fecha_estimada, auth.uid()
  ) returning id into v_id;

  if p_fecha_estimada is not null then
    insert into public.compra_fechas_estimadas (compra_id, fecha_estimada, motivo)
    values (v_id, p_fecha_estimada, 'Registro inicial');
  end if;

  perform app.modo_servidor();
  update public.articulos set etapa = 'comprado' where id = p_articulo;

  perform app.auditar('compras', v_id::text, 'REGISTRO_COMPRA',
    null, jsonb_build_object('articulo_id', p_articulo, 'proveedor_id', v_cot.proveedor_id,
      'moneda', v_cot.moneda, 'precio_unitario', v_cot.precio_unitario,
      'cantidad', p_cantidad, 'total', v_total, 'fecha_compra', p_fecha_compra), null);

  v_res := jsonb_build_object('ok', true, 'compra_id', v_id, 'total', v_total);
  perform app.op_guardar(p_op, 'fn_registrar_compra', v_res);
  return v_res;
end $$;

-- Cambio material posterior: conserva aprobación anterior y exige una nueva.
create or replace function public.fn_actualizar_compra(
  p_compra uuid,
  p_cantidad numeric,
  p_precio_unitario numeric,
  p_impuestos numeric,
  p_descuentos numeric,
  p_otros_cargos numeric,
  p_referencia text,
  p_motivo text,
  p_version integer
) returns void language plpgsql security definer
set search_path = ''
as $$
declare
  v_c public.compras%rowtype;
  v_art public.articulos%rowtype;
  v_material boolean;
  v_subtotal numeric(14,2);
  v_total numeric(14,2);
  v_recibido numeric;
begin
  if not app.es_gestor() then
    raise exception 'Solo Compras modifica compras.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_motivo,'')),'') is null then
    raise exception 'Indica el motivo de la modificación.';
  end if;
  select * into v_c from public.compras where id = p_compra for update;
  if not found then raise exception 'Compra no encontrada.'; end if;
  if v_c.version <> p_version then
    raise exception 'La compra fue modificada en otra sesión. Recarga e intenta de nuevo.' using errcode = '40001';
  end if;
  select * into v_art from public.articulos where id = v_c.articulo_id for update;

  if p_cantidad is null or p_cantidad <= 0 or p_precio_unitario is null or p_precio_unitario < 0
     or coalesce(p_impuestos,0) < 0 or coalesce(p_descuentos,0) < 0 or coalesce(p_otros_cargos,0) < 0 then
    raise exception 'Valores inválidos.';
  end if;

  -- No reducir por debajo de lo ya recibido neto.
  select coalesce(sum(case when tipo = 'recepcion' then cantidad
                           when tipo = 'devolucion_proveedor' then -cantidad
                           else 0 end), 0)
    into v_recibido
  from public.movimientos m where m.articulo_id = v_c.articulo_id and not m.anulado;
  if p_cantidad < v_recibido then
    raise exception 'No puedes fijar la cantidad comprada (%) por debajo de lo ya recibido neto (%).',
      p_cantidad, v_recibido;
  end if;

  v_material := (p_cantidad is distinct from v_c.cantidad)
             or (p_precio_unitario is distinct from v_c.precio_unitario);

  v_subtotal := round(p_precio_unitario * p_cantidad, 2);
  v_total := v_subtotal + coalesce(p_impuestos,0) + coalesce(p_otros_cargos,0) - coalesce(p_descuentos,0);
  if v_total < 0 then raise exception 'El total no puede ser negativo.'; end if;

  update public.compras set
    cantidad = p_cantidad,
    precio_unitario = p_precio_unitario,
    subtotal = v_subtotal,
    impuestos = coalesce(p_impuestos,0),
    descuentos = coalesce(p_descuentos,0),
    otros_cargos = coalesce(p_otros_cargos,0),
    total = v_total,
    referencia = nullif(btrim(coalesce(p_referencia,'')),''),
    actualizado_en = now(),
    version = version + 1
  where id = p_compra;

  perform app.auditar('compras', p_compra::text, 'MODIFICACION_COMPRA',
    jsonb_build_object('cantidad', v_c.cantidad, 'precio_unitario', v_c.precio_unitario,
                       'total', v_c.total),
    jsonb_build_object('cantidad', p_cantidad, 'precio_unitario', p_precio_unitario,
                       'total', v_total),
    p_motivo);

  -- Cambio material con aprobación obligatoria: la anterior se conserva y
  -- se exige una nueva (bloquea nuevas recepciones hasta aprobarse).
  if v_material and v_art.requiere_aprobacion then
    update public.aprobaciones
       set es_vigente = false,
           estado = case when estado = 'pendiente' then 'reemplazada' else estado end
     where articulo_id = v_c.articulo_id and es_vigente;

    insert into public.aprobaciones (articulo_id, aprobador_id, solicitada_por, version_aprobada, comentario)
    values (
      v_c.articulo_id, v_art.aprobador_id, auth.uid(),
      jsonb_build_object(
        'articulo', v_art.nombre,
        'cantidad', p_cantidad,
        'unidad', v_art.unidad,
        'proveedor_id', v_c.proveedor_id,
        'moneda', v_c.moneda,
        'precio_unitario', p_precio_unitario,
        'total_estimado', v_total
      ),
      'Generada automáticamente por cambio material de compra: ' || p_motivo
    );
  end if;
end $$;

create or replace function public.fn_actualizar_fecha_estimada(
  p_compra uuid, p_fecha date, p_motivo text, p_version integer
) returns void language plpgsql security definer
set search_path = ''
as $$
declare v_c public.compras%rowtype;
begin
  if not app.es_gestor() then
    raise exception 'Solo Compras actualiza la fecha estimada.' using errcode = '42501';
  end if;
  select * into v_c from public.compras where id = p_compra for update;
  if not found then raise exception 'Compra no encontrada.'; end if;
  if v_c.version <> p_version then
    raise exception 'La compra fue modificada en otra sesión. Recarga e intenta de nuevo.' using errcode = '40001';
  end if;
  if v_c.fecha_estimada_llegada is not null and nullif(btrim(coalesce(p_motivo,'')),'') is null then
    raise exception 'Indica el motivo del cambio de fecha estimada.';
  end if;

  update public.compras
     set fecha_estimada_llegada = p_fecha, actualizado_en = now(), version = version + 1
   where id = p_compra;
  insert into public.compra_fechas_estimadas (compra_id, fecha_estimada, motivo)
  values (p_compra, p_fecha, coalesce(nullif(btrim(coalesce(p_motivo,'')),''), 'Registro inicial'));

  perform app.auditar('compras', p_compra::text, 'FECHA_ESTIMADA',
    jsonb_build_object('fecha_estimada', v_c.fecha_estimada_llegada),
    jsonb_build_object('fecha_estimada', p_fecha), p_motivo);
end $$;
