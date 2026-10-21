-- ============================================================
-- 0003_solicitudes_articulos.sql
-- Solicitudes con varios artículos de avance independiente,
-- semana objetivo (lunes a domingo), borradores, corrección con motivo,
-- tabla explícita de transiciones de etapa y RPCs del flujo.
-- ============================================================

-- Consecutivo único generado en servidor (nunca "cantidad de filas + 1").
create sequence if not exists public.solicitudes_consecutivo_seq;

create table if not exists public.solicitudes (
  id             uuid primary key default gen_random_uuid(),
  consecutivo    bigint not null default nextval('public.solicitudes_consecutivo_seq'),
  numero         text not null unique,                 -- SOL-AAAA-NNNNN (presentación)
  solicitante_id uuid not null default auth.uid() references public.perfiles (id),
  area_id        uuid not null references public.areas (id),
  centro_costo_id uuid not null references public.centros_costo (id),
  estado         public.estado_solicitud not null default 'borrador',
  justificacion  text,
  semana_lunes   date not null,                        -- lunes de la semana objetivo de compra
  fecha_declarada date,                                -- fecha declarada por el usuario, si aplica
  origen         public.origen_registro not null default 'app',
  creado_en      timestamptz not null default now(),   -- fecha técnica del servidor
  enviado_en     timestamptz,
  actualizado_en timestamptz not null default now(),
  version        integer not null default 1,
  constraint semana_es_lunes check (extract(isodow from semana_lunes) = 1),
  constraint consecutivo_unico unique (consecutivo)
);

create table if not exists public.articulos (
  id             uuid primary key default gen_random_uuid(),
  solicitud_id   uuid not null references public.solicitudes (id) on delete cascade,
  nombre         text not null,
  descripcion    text,                                 -- medidas, color, material, especificaciones
  cantidad       numeric(12,2) not null,
  unidad         text not null default 'unidad',
  prioridad      public.prioridad_articulo not null default 'media',
  fecha_requerida date,
  justificacion  text,
  area_id        uuid references public.areas (id),          -- opcional: distinta a la cabecera
  centro_costo_id uuid references public.centros_costo (id), -- opcional: distinta a la cabecera
  etapa          public.etapa_articulo not null default 'borrador',
  requiere_aprobacion boolean not null default false,
  aprobador_id   uuid references public.perfiles (id),
  origen         public.origen_registro not null default 'app',
  estatus_historico text,                              -- estado declarado del CSV histórico (sin fabricar movimientos)
  fila_importacion_id uuid,                            -- FK se añade en 0011
  cerrado_en     timestamptz,
  cerrado_motivo text,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  version        integer not null default 1,
  constraint cantidad_positiva check (cantidad > 0),
  constraint nombre_articulo check (char_length(btrim(nombre)) between 1 and 300)
);

create index if not exists solicitudes_solicitante_idx on public.solicitudes (solicitante_id);
create index if not exists solicitudes_semana_idx      on public.solicitudes (semana_lunes);
create index if not exists solicitudes_estado_idx      on public.solicitudes (estado);
create index if not exists solicitudes_area_idx        on public.solicitudes (area_id);
create index if not exists solicitudes_cc_idx          on public.solicitudes (centro_costo_id);
create index if not exists articulos_solicitud_idx     on public.articulos (solicitud_id);
create index if not exists articulos_etapa_idx         on public.articulos (etapa);
create index if not exists articulos_aprobador_idx     on public.articulos (aprobador_id);

-- ------------------------------------------------------------
-- Número legible en servidor
-- ------------------------------------------------------------
create or replace function app.tg_solicitudes_numero()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  new.numero := 'SOL-' || to_char(now() at time zone 'America/Bogota', 'YYYY')
                || '-' || lpad(new.consecutivo::text, 5, '0');
  return new;
end $$;

drop trigger if exists tg_solicitudes_numero on public.solicitudes;
create trigger tg_solicitudes_numero
  before insert on public.solicitudes
  for each row execute function app.tg_solicitudes_numero();

-- ------------------------------------------------------------
-- Contexto de servidor: las RPC marcan app.bypass para poder modificar
-- campos protegidos; la API nunca puede fijar ese contexto.
-- ------------------------------------------------------------
create or replace function app.es_servidor()
returns boolean language sql stable
set search_path = ''
as $$ select coalesce(current_setting('app.bypass', true), '') = '1'; $$;

create or replace function app.modo_servidor()
returns void language sql
set search_path = ''
as $$ select set_config('app.bypass', '1', true); $$;

-- Validación y protección de solicitudes en UPDATE/INSERT directos.
create or replace function app.tg_solicitudes_proteger()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if not app.es_servidor() then
      if new.estado <> 'borrador' then
        raise exception 'Una solicitud nueva siempre inicia como borrador.';
      end if;
      if new.solicitante_id <> auth.uid() then
        raise exception 'No puedes crear solicitudes a nombre de otra persona.';
      end if;
      if new.origen <> 'app' then
        raise exception 'Origen inválido.';
      end if;
    end if;
    if not exists (select 1 from public.areas a where a.id = new.area_id and a.activo) then
      raise exception 'El área seleccionada no existe o está inactiva.';
    end if;
    if not exists (select 1 from public.centros_costo c where c.id = new.centro_costo_id and c.activo) then
      raise exception 'El centro de costo seleccionado no existe o está inactivo.';
    end if;
    return new;
  end if;

  -- UPDATE
  if not app.es_servidor() then
    if old.estado not in ('borrador','en_correccion') then
      raise exception 'La solicitud ya fue enviada; usa el flujo de corrección.';
    end if;
    if new.estado is distinct from old.estado
       or new.consecutivo is distinct from old.consecutivo
       or new.numero is distinct from old.numero
       or new.solicitante_id is distinct from old.solicitante_id
       or new.origen is distinct from old.origen
       or new.creado_en is distinct from old.creado_en
       or new.enviado_en is distinct from old.enviado_en then
      raise exception 'Campo protegido: esta modificación requiere una operación del servidor.';
    end if;
    if old.estado = 'en_correccion' and new.semana_lunes is distinct from old.semana_lunes then
      raise exception 'La semana se reprograma desde la opción "Reprogramar semana" (queda trazada).';
    end if;
  end if;
  if new.area_id is distinct from old.area_id
     and not exists (select 1 from public.areas a where a.id = new.area_id and a.activo) then
    raise exception 'El área seleccionada no existe o está inactiva.';
  end if;
  if new.centro_costo_id is distinct from old.centro_costo_id
     and not exists (select 1 from public.centros_costo c where c.id = new.centro_costo_id and c.activo) then
    raise exception 'El centro de costo seleccionado no existe o está inactivo.';
  end if;
  return new;
end $$;

drop trigger if exists tg_solicitudes_proteger on public.solicitudes;
create trigger tg_solicitudes_proteger
  before insert or update on public.solicitudes
  for each row execute function app.tg_solicitudes_proteger();

drop trigger if exists tg_solicitudes_version on public.solicitudes;
create trigger tg_solicitudes_version
  before update on public.solicitudes
  for each row execute function app.tg_version();

-- Protección de artículos.
create or replace function app.tg_articulos_proteger()
returns trigger language plpgsql
set search_path = ''
as $$
declare
  v_sol public.solicitudes%rowtype;
  v_sol_id uuid;
begin
  if tg_op = 'DELETE' then v_sol_id := old.solicitud_id; else v_sol_id := new.solicitud_id; end if;
  select * into v_sol from public.solicitudes where id = v_sol_id;

  if tg_op = 'INSERT' then
    if not app.es_servidor() then
      if v_sol.estado not in ('borrador','en_correccion') then
        raise exception 'Solo se agregan artículos con la solicitud en borrador o en corrección.';
      end if;
      if new.etapa <> 'borrador' then
        raise exception 'Un artículo nuevo siempre inicia en borrador.';
      end if;
      if new.origen <> 'app' or new.estatus_historico is not null or new.fila_importacion_id is not null then
        raise exception 'Origen inválido.';
      end if;
      if new.requiere_aprobacion or new.aprobador_id is not null then
        raise exception 'La aprobación la configura Compras.';
      end if;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if not app.es_servidor() then
      if v_sol.estado <> 'borrador' or old.etapa <> 'borrador' then
        raise exception 'Después del envío los artículos no se eliminan: usa cancelación con motivo.';
      end if;
    end if;
    return old;
  end if;

  -- UPDATE
  if not app.es_servidor() then
    if v_sol.estado not in ('borrador','en_correccion') then
      raise exception 'La solicitud no está en edición; usa el flujo de corrección.';
    end if;
    if old.etapa not in ('borrador','solicitado','en_cotizacion') then
      raise exception 'Este artículo ya está en gestión avanzada; los cambios requieren a Compras.';
    end if;
    if new.etapa is distinct from old.etapa
       or new.solicitud_id is distinct from old.solicitud_id
       or new.requiere_aprobacion is distinct from old.requiere_aprobacion
       or new.aprobador_id is distinct from old.aprobador_id
       or new.origen is distinct from old.origen
       or new.estatus_historico is distinct from old.estatus_historico
       or new.fila_importacion_id is distinct from old.fila_importacion_id
       or new.cerrado_en is distinct from old.cerrado_en
       or new.cerrado_motivo is distinct from old.cerrado_motivo
       or new.creado_en is distinct from old.creado_en then
      raise exception 'Campo protegido: esta modificación requiere una operación del servidor.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists tg_articulos_proteger on public.articulos;
create trigger tg_articulos_proteger
  before insert or update or delete on public.articulos
  for each row execute function app.tg_articulos_proteger();

drop trigger if exists tg_articulos_version on public.articulos;
create trigger tg_articulos_version
  before update on public.articulos
  for each row execute function app.tg_version();

-- ------------------------------------------------------------
-- RLS (la visibilidad de aprobador y almacén se añade en 0004/0005)
-- ------------------------------------------------------------
alter table public.solicitudes enable row level security;
alter table public.articulos   enable row level security;

drop policy if exists solicitudes_select_propias on public.solicitudes;
create policy solicitudes_select_propias on public.solicitudes for select to authenticated
  using (app.es_activo() and solicitante_id = auth.uid());

drop policy if exists solicitudes_select_gestion on public.solicitudes;
create policy solicitudes_select_gestion on public.solicitudes for select to authenticated
  using (app.es_gestor());

drop policy if exists solicitudes_insert on public.solicitudes;
create policy solicitudes_insert on public.solicitudes for insert to authenticated
  with check (app.tiene_rol('solicitante') and solicitante_id = auth.uid() and estado = 'borrador');

drop policy if exists solicitudes_update_propias on public.solicitudes;
create policy solicitudes_update_propias on public.solicitudes for update to authenticated
  using (app.tiene_rol('solicitante') and solicitante_id = auth.uid()
         and estado in ('borrador','en_correccion'))
  with check (solicitante_id = auth.uid());

drop policy if exists solicitudes_delete_borrador on public.solicitudes;
create policy solicitudes_delete_borrador on public.solicitudes for delete to authenticated
  using (app.tiene_rol('solicitante') and solicitante_id = auth.uid() and estado = 'borrador');

create or replace function app.es_dueno_solicitud(p_solicitud uuid)
returns boolean language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.solicitudes s
    where s.id = p_solicitud and s.solicitante_id = auth.uid()
  ) and app.es_activo();
$$;
revoke all on function app.es_dueno_solicitud(uuid) from public;
grant execute on function app.es_dueno_solicitud(uuid) to authenticated;

drop policy if exists articulos_select_propios on public.articulos;
create policy articulos_select_propios on public.articulos for select to authenticated
  using (app.es_dueno_solicitud(solicitud_id));

drop policy if exists articulos_select_gestion on public.articulos;
create policy articulos_select_gestion on public.articulos for select to authenticated
  using (app.es_gestor());

drop policy if exists articulos_insert on public.articulos;
create policy articulos_insert on public.articulos for insert to authenticated
  with check (app.tiene_rol('solicitante') and app.es_dueno_solicitud(solicitud_id));

drop policy if exists articulos_update on public.articulos;
create policy articulos_update on public.articulos for update to authenticated
  using (app.tiene_rol('solicitante') and app.es_dueno_solicitud(solicitud_id))
  with check (app.es_dueno_solicitud(solicitud_id));

drop policy if exists articulos_delete on public.articulos;
create policy articulos_delete on public.articulos for delete to authenticated
  using (app.tiene_rol('solicitante') and app.es_dueno_solicitud(solicitud_id));

-- ------------------------------------------------------------
-- Tabla explícita de transiciones de etapa
-- ------------------------------------------------------------
create table if not exists public.etapa_transiciones (
  id              smallint generated always as identity primary key,
  desde           public.etapa_articulo not null,
  hacia           public.etapa_articulo not null,
  roles           public.rol_app[] not null,
  requiere_motivo boolean not null default false,
  solo_funcion    boolean not null default false,  -- true: solo la ejecutan funciones internas
  descripcion     text not null,
  unique (desde, hacia)
);

insert into public.etapa_transiciones (desde, hacia, roles, requiere_motivo, solo_funcion, descripcion) values
  ('borrador','solicitado','{solicitante}', false, true,  'Envío de la solicitud (fn_enviar_solicitud).'),
  ('solicitado','en_cotizacion','{compras,administrador}', false, false, 'Compras toma el artículo para cotizar.'),
  ('en_cotizacion','solicitado','{compras,administrador}', true,  false, 'Compras devuelve a la cola con motivo.'),
  ('en_cotizacion','cotizado','{compras,administrador}', false, true, 'Al seleccionar cotización (fn_seleccionar_cotizacion).'),
  ('cotizado','en_cotizacion','{compras,administrador}', true,  false, 'Reabrir cotización con motivo.'),
  ('cotizado','comprado','{compras,administrador}', false, true, 'Registro de compra (fn_registrar_compra); exige aprobación vigente si se requiere.'),
  ('comprado','en_transito','{compras,administrador}', false, false, 'Seguimiento: pedido en tránsito.'),
  ('comprado','recibido_parcial','{compras,administrador,almacen}', false, true, 'Automática por recepción (fn_registrar_movimiento).'),
  ('comprado','recibido_total','{compras,administrador,almacen}', false, true, 'Automática por recepción (fn_registrar_movimiento).'),
  ('en_transito','recibido_parcial','{compras,administrador,almacen}', false, true, 'Automática por recepción.'),
  ('en_transito','recibido_total','{compras,administrador,almacen}', false, true, 'Automática por recepción.'),
  ('recibido_parcial','recibido_total','{compras,administrador,almacen}', false, true, 'Automática por recepción.'),
  ('recibido_total','recibido_parcial','{compras,administrador,almacen}', false, true, 'Automática por devolución al proveedor.'),
  ('recibido_parcial','cerrado','{compras,administrador}', true,  true, 'Cierre con saldo pendiente: exige resolución documentada (fn_cerrar_articulo).'),
  ('recibido_total','cerrado','{compras,administrador}', false, true, 'Cierre normal (fn_cerrar_articulo).'),
  ('solicitado','cancelado','{solicitante,compras,administrador}', true, false, 'Cancelación con motivo antes de cotizar.'),
  ('en_cotizacion','cancelado','{compras,administrador}', true, false, 'Cancelación con motivo.'),
  ('cotizado','cancelado','{compras,administrador}', true, false, 'Cancelación con motivo.'),
  ('comprado','cancelado','{compras,administrador}', true, false, 'Cancelación excepcional con motivo (sin unidades recibidas).'),
  ('cancelado','solicitado','{compras,administrador}', true, false, 'Reapertura con motivo.'),
  ('cerrado','recibido_total','{administrador}', true, false, 'Reapertura con motivo.'),
  ('cerrado','recibido_parcial','{administrador}', true, false, 'Reapertura con motivo.')
on conflict (desde, hacia) do nothing;

alter table public.etapa_transiciones enable row level security;
drop policy if exists transiciones_select on public.etapa_transiciones;
create policy transiciones_select on public.etapa_transiciones for select to authenticated
  using (app.es_activo());

-- Validador central de transiciones.
create or replace function app.validar_transicion(
  p_desde public.etapa_articulo, p_hacia public.etapa_articulo,
  p_motivo text, p_via_funcion boolean
) returns void language plpgsql stable
set search_path = ''
as $$
declare
  v_t public.etapa_transiciones%rowtype;
  v_ok boolean := false;
  r public.rol_app;
begin
  select * into v_t from public.etapa_transiciones where desde = p_desde and hacia = p_hacia;
  if not found then
    raise exception 'Transición de etapa no permitida: % → %.', p_desde, p_hacia;
  end if;
  if v_t.solo_funcion and not p_via_funcion then
    raise exception 'Esta transición solo se realiza mediante la operación correspondiente.';
  end if;
  if v_t.requiere_motivo and nullif(btrim(coalesce(p_motivo,'')),'') is null then
    raise exception 'Esta transición requiere un motivo.';
  end if;
  foreach r in array v_t.roles loop
    if app.tiene_rol(r) then v_ok := true; end if;
  end loop;
  if not v_ok then
    raise exception 'Tu rol no permite esta transición.' using errcode = '42501';
  end if;
end $$;

-- ------------------------------------------------------------
-- RPCs del flujo de solicitud
-- ------------------------------------------------------------
create or replace function public.fn_enviar_solicitud(p_solicitud uuid, p_version integer, p_op uuid)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare
  v_sol public.solicitudes%rowtype;
  v_n integer;
  v_res jsonb;
begin
  v_res := app.op_existente(p_op);
  if v_res is not null then return v_res; end if;

  if not app.es_activo() or not app.tiene_rol('solicitante') then
    raise exception 'Tu cuenta no tiene permiso de solicitante activo.' using errcode = '42501';
  end if;
  select * into v_sol from public.solicitudes where id = p_solicitud for update;
  if not found or v_sol.solicitante_id <> auth.uid() then
    raise exception 'Solicitud no encontrada.';
  end if;
  if v_sol.estado <> 'borrador' then
    raise exception 'Solo se envían solicitudes en borrador.';
  end if;
  if v_sol.version <> p_version then
    raise exception 'La solicitud fue modificada en otra sesión. Recarga e intenta de nuevo.' using errcode = '40001';
  end if;
  select count(*) into v_n from public.articulos a where a.solicitud_id = p_solicitud;
  if v_n = 0 then
    raise exception 'Agrega al menos un artículo antes de enviar.';
  end if;
  if exists (
    select 1 from public.articulos a
    where a.solicitud_id = p_solicitud
      and (nullif(btrim(coalesce(a.descripcion,'')),'') is null)
  ) then
    raise exception 'Todos los artículos necesitan descripción (medidas, color, material o especificaciones).';
  end if;

  perform app.modo_servidor();
  update public.solicitudes
     set estado = 'enviada', enviado_en = now()
   where id = p_solicitud;
  update public.articulos
     set etapa = 'solicitado'
   where solicitud_id = p_solicitud and etapa = 'borrador';

  perform app.auditar('solicitudes', p_solicitud::text, 'ENVIO',
    jsonb_build_object('estado','borrador'),
    jsonb_build_object('estado','enviada','articulos', v_n), null);

  v_res := jsonb_build_object('ok', true, 'numero', v_sol.numero);
  perform app.op_guardar(p_op, 'fn_enviar_solicitud', v_res);
  return v_res;
end $$;

create or replace function public.fn_devolver_a_correccion(p_solicitud uuid, p_motivo text)
returns void language plpgsql security definer
set search_path = ''
as $$
declare v_sol public.solicitudes%rowtype;
begin
  if not app.es_gestor() then
    raise exception 'Solo Compras o el administrador devuelven a corrección.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_motivo,'')),'') is null then
    raise exception 'Indica el motivo de la corrección.';
  end if;
  select * into v_sol from public.solicitudes where id = p_solicitud for update;
  if not found then raise exception 'Solicitud no encontrada.'; end if;
  if v_sol.estado <> 'enviada' then
    raise exception 'Solo solicitudes enviadas pueden volver a corrección.';
  end if;
  if exists (select 1 from public.articulos a where a.solicitud_id = p_solicitud
             and a.etapa in ('comprado','en_transito','recibido_parcial','recibido_total')) then
    raise exception 'Hay artículos ya comprados o recibidos: gestiona novedades en lugar de corrección.';
  end if;

  perform app.modo_servidor();
  update public.solicitudes set estado = 'en_correccion' where id = p_solicitud;
  perform app.auditar('solicitudes', p_solicitud::text, 'A_CORRECCION',
    jsonb_build_object('estado','enviada'), jsonb_build_object('estado','en_correccion'), p_motivo);
end $$;

create or replace function public.fn_reenviar_solicitud(p_solicitud uuid, p_comentario text, p_op uuid)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare v_sol public.solicitudes%rowtype; v_res jsonb;
begin
  v_res := app.op_existente(p_op);
  if v_res is not null then return v_res; end if;

  select * into v_sol from public.solicitudes where id = p_solicitud for update;
  if not found or v_sol.solicitante_id <> auth.uid() or not app.es_activo() then
    raise exception 'Solicitud no encontrada.';
  end if;
  if v_sol.estado <> 'en_correccion' then
    raise exception 'La solicitud no está en corrección.';
  end if;

  perform app.modo_servidor();
  update public.solicitudes set estado = 'enviada' where id = p_solicitud;
  update public.articulos set etapa = 'solicitado'
   where solicitud_id = p_solicitud and etapa = 'borrador';
  perform app.auditar('solicitudes', p_solicitud::text, 'REENVIO',
    jsonb_build_object('estado','en_correccion'), jsonb_build_object('estado','enviada'), p_comentario);
  v_res := jsonb_build_object('ok', true);
  perform app.op_guardar(p_op, 'fn_reenviar_solicitud', v_res);
  return v_res;
end $$;

create or replace function public.fn_cancelar_solicitud(p_solicitud uuid, p_motivo text, p_version integer)
returns void language plpgsql security definer
set search_path = ''
as $$
declare v_sol public.solicitudes%rowtype; v_es_dueno boolean;
begin
  if nullif(btrim(coalesce(p_motivo,'')),'') is null then
    raise exception 'Indica el motivo de la cancelación.';
  end if;
  select * into v_sol from public.solicitudes where id = p_solicitud for update;
  if not found then raise exception 'Solicitud no encontrada.'; end if;
  v_es_dueno := (v_sol.solicitante_id = auth.uid()) and app.es_activo();
  if not (v_es_dueno or app.es_gestor()) then
    raise exception 'No tienes permiso para cancelar esta solicitud.' using errcode = '42501';
  end if;
  if v_sol.version <> p_version then
    raise exception 'La solicitud fue modificada en otra sesión. Recarga e intenta de nuevo.' using errcode = '40001';
  end if;
  if v_sol.estado = 'cancelada' then return; end if;
  if exists (select 1 from public.articulos a where a.solicitud_id = p_solicitud
             and a.etapa in ('comprado','en_transito','recibido_parcial','recibido_total','cerrado')) then
    raise exception 'Hay artículos comprados o recibidos: cancela artículo por artículo con su resolución.';
  end if;
  if v_es_dueno and not app.es_gestor()
     and exists (select 1 from public.articulos a where a.solicitud_id = p_solicitud
                 and a.etapa in ('en_cotizacion','cotizado')) then
    raise exception 'Compras ya está gestionando artículos de esta solicitud; pide la cancelación a Compras.';
  end if;

  perform app.modo_servidor();
  update public.articulos set etapa = 'cancelado'
   where solicitud_id = p_solicitud and etapa not in ('cancelado');
  update public.solicitudes set estado = 'cancelada' where id = p_solicitud;
  perform app.auditar('solicitudes', p_solicitud::text, 'CANCELACION',
    jsonb_build_object('estado', v_sol.estado), jsonb_build_object('estado','cancelada'), p_motivo);
end $$;

create or replace function public.fn_reprogramar_semana(
  p_solicitud uuid, p_semana date, p_motivo text, p_version integer
) returns void language plpgsql security definer
set search_path = ''
as $$
declare v_sol public.solicitudes%rowtype;
begin
  if extract(isodow from p_semana) <> 1 then
    raise exception 'La semana objetivo se identifica por su lunes.';
  end if;
  if nullif(btrim(coalesce(p_motivo,'')),'') is null then
    raise exception 'Indica el motivo de la reprogramación.';
  end if;
  select * into v_sol from public.solicitudes where id = p_solicitud for update;
  if not found then raise exception 'Solicitud no encontrada.'; end if;
  if not (app.es_gestor() or (v_sol.solicitante_id = auth.uid() and app.es_activo()
          and v_sol.estado in ('borrador','enviada','en_correccion'))) then
    raise exception 'No tienes permiso para reprogramar esta solicitud.' using errcode = '42501';
  end if;
  if v_sol.version <> p_version then
    raise exception 'La solicitud fue modificada en otra sesión. Recarga e intenta de nuevo.' using errcode = '40001';
  end if;
  if v_sol.semana_lunes = p_semana then return; end if;

  perform app.modo_servidor();
  update public.solicitudes set semana_lunes = p_semana where id = p_solicitud;
  perform app.auditar('solicitudes', p_solicitud::text, 'REPROGRAMACION',
    jsonb_build_object('semana_lunes', v_sol.semana_lunes),
    jsonb_build_object('semana_lunes', p_semana), p_motivo);
end $$;

-- Cambio manual de etapa (solo transiciones no marcadas solo_funcion).
create or replace function public.fn_cambiar_etapa(
  p_articulo uuid, p_hacia public.etapa_articulo, p_motivo text, p_version integer
) returns void language plpgsql security definer
set search_path = ''
as $$
declare
  v_art public.articulos%rowtype;
  v_sol public.solicitudes%rowtype;
begin
  if not app.es_activo() then
    raise exception 'Tu cuenta no está activa.' using errcode = '42501';
  end if;
  select * into v_art from public.articulos where id = p_articulo for update;
  if not found then raise exception 'Artículo no encontrado.'; end if;
  select * into v_sol from public.solicitudes where id = v_art.solicitud_id;
  if v_art.version <> p_version then
    raise exception 'El artículo fue modificado en otra sesión. Recarga e intenta de nuevo.' using errcode = '40001';
  end if;

  -- El solicitante solo opera sobre lo propio (p. ej. cancelar en etapa solicitado).
  if not app.es_gestor() and not app.tiene_rol('almacen') then
    if v_sol.solicitante_id <> auth.uid() then
      raise exception 'No tienes permiso sobre este artículo.' using errcode = '42501';
    end if;
  end if;

  perform app.validar_transicion(v_art.etapa, p_hacia, p_motivo, false);

  perform app.modo_servidor();
  update public.articulos set etapa = p_hacia where id = p_articulo;
  perform app.auditar('articulos', p_articulo::text, 'CAMBIO_ETAPA',
    jsonb_build_object('etapa', v_art.etapa), jsonb_build_object('etapa', p_hacia), p_motivo);
end $$;
