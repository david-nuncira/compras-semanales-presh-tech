-- ============================================================
-- 0001_base.sql · Compras Semanales Presh Tech
-- Esquema auxiliar, tipos, configuración, idempotencia y auditoría base.
-- Todas las migraciones son idempotentes donde es razonable (IF NOT EXISTS).
-- ============================================================

-- Esquema interno NO expuesto por la API (PostgREST solo expone "public").
create schema if not exists app;

-- ------------------------------------------------------------
-- Tipos enumerados
-- ------------------------------------------------------------
do $$ begin
  create type public.estado_perfil as enum ('pendiente','activo','desactivado','rechazado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.rol_app as enum ('administrador','solicitante','compras','aprobador','almacen');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.estado_solicitud as enum ('borrador','enviada','en_correccion','cancelada');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.etapa_articulo as enum
    ('borrador','solicitado','en_cotizacion','cotizado','comprado','en_transito',
     'recibido_parcial','recibido_total','cerrado','cancelado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.prioridad_articulo as enum ('baja','media','alta');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.estado_aprobacion as enum ('pendiente','aprobada','rechazada','reemplazada');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.tipo_movimiento as enum
    ('recepcion','entrega','devolucion_proveedor','retorno_solicitante');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.tipo_novedad as enum
    ('datos_incompletos','producto_mal_solicitado','entrega_incorrecta','observacion');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.estado_novedad as enum ('abierta','en_atencion','resuelta');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.registro_corporativo as enum ('si','no','por_confirmar');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.tipo_compra_externa as enum ('externa','regularizacion');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.origen_registro as enum ('app','importacion_csv');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.estado_fila_importacion as enum ('pendiente','aprobada','rechazada','importada');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.estado_lote_importacion as enum ('en_revision','procesado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.entidad_adjunto as enum ('articulo','novedad','compra','compra_externa');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- Configuración administrable (parámetros del piloto, NO reglas aprobadas por el área)
-- ------------------------------------------------------------
create table if not exists public.configuracion (
  clave        text primary key,
  valor        jsonb not null,
  descripcion  text not null,
  editable     boolean not null default true,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid
);

insert into public.configuracion (clave, valor, descripcion, editable) values
  ('max_adjuntos_por_articulo', '3', 'Cantidad máxima de adjuntos por artículo (propuesta piloto).', true),
  ('max_tamano_adjunto_mb', '5', 'Tamaño máximo por adjunto en MB (también limitado en el bucket).', true),
  ('moneda_defecto', '"COP"', 'Moneda por defecto para cotizaciones y compras.', true),
  ('aprobador_puede_decidir_propia', 'false', 'Si un aprobador puede decidir sobre su propia solicitud (por defecto NO).', true),
  ('tipos_adjunto_permitidos', '["image/jpeg","image/png","image/webp","application/pdf"]', 'Tipos MIME permitidos (también limitados en el bucket).', false)
on conflict (clave) do nothing;

-- Lectura auxiliar de configuración numérica/booleana/texto
create or replace function app.config_num(p_clave text, p_defecto numeric)
returns numeric language sql stable
set search_path = ''
as $$
  select coalesce((select (valor)::numeric from public.configuracion where clave = p_clave), p_defecto);
$$;

create or replace function app.config_bool(p_clave text, p_defecto boolean)
returns boolean language sql stable
set search_path = ''
as $$
  select coalesce((select (valor)::boolean from public.configuracion where clave = p_clave), p_defecto);
$$;

-- ------------------------------------------------------------
-- Idempotencia de operaciones de negocio (reintentos sin duplicar)
-- El cliente genera un op_id (UUID) por acción; si se reintenta con el mismo
-- op_id, la función devuelve el resultado guardado sin repetir efectos.
-- ------------------------------------------------------------
create table if not exists public.operaciones (
  op_id      uuid primary key,
  funcion    text not null,
  actor      uuid,
  resultado  jsonb,
  creado_en  timestamptz not null default now()
);

create or replace function app.op_existente(p_op uuid)
returns jsonb language sql stable
set search_path = ''
as $$
  select resultado from public.operaciones where op_id = p_op;
$$;

create or replace function app.op_guardar(p_op uuid, p_fn text, p_resultado jsonb)
returns void language sql
set search_path = ''
as $$
  insert into public.operaciones (op_id, funcion, actor, resultado)
  values (p_op, p_fn, auth.uid(), p_resultado)
  on conflict (op_id) do nothing;
$$;

-- ------------------------------------------------------------
-- Auditoría (la escriben SOLO disparadores y funciones del servidor;
-- ningún usuario funcional puede editarla ni borrarla desde la API).
-- Nunca se registran contraseñas, tokens ni enlaces de recuperación.
-- ------------------------------------------------------------
create table if not exists public.auditoria (
  id          bigint generated always as identity primary key,
  tabla       text not null,
  registro_id text not null,
  accion      text not null,           -- INSERT / UPDATE / DELETE / accion de negocio
  actor       uuid,                    -- auth.uid() del momento; null = proceso del sistema
  creado_en   timestamptz not null default now(),
  motivo      text,
  anterior    jsonb,
  nuevo       jsonb
);

create index if not exists auditoria_tabla_registro_idx on public.auditoria (tabla, registro_id);
create index if not exists auditoria_creado_idx on public.auditoria (creado_en desc);

-- Motivo contextual: las RPC lo fijan con set_config('app.motivo', ..., true)
-- y el disparador genérico lo recoge.
create or replace function app.motivo_actual()
returns text language sql stable
set search_path = ''
as $$
  select nullif(current_setting('app.motivo', true), '');
$$;

create or replace function app.fijar_motivo(p_motivo text)
returns void language sql
set search_path = ''
as $$
  select set_config('app.motivo', coalesce(p_motivo, ''), true);
$$;

-- Inserción directa de auditoría desde funciones del servidor.
create or replace function app.auditar(
  p_tabla text, p_registro text, p_accion text,
  p_anterior jsonb, p_nuevo jsonb, p_motivo text
) returns void
language sql security definer
set search_path = ''
as $$
  insert into public.auditoria (tabla, registro_id, accion, actor, motivo, anterior, nuevo)
  values (p_tabla, p_registro, p_accion, auth.uid(), p_motivo, p_anterior, p_nuevo);
$$;

revoke all on function app.auditar(text,text,text,jsonb,jsonb,text) from public;

-- Diferencia compacta entre dos jsonb (solo claves que cambian).
create or replace function app.jsonb_diff(p_viejo jsonb, p_nuevo jsonb)
returns table (anterior jsonb, nuevo jsonb)
language sql immutable
set search_path = ''
as $$
  with claves as (
    select k from jsonb_object_keys(coalesce(p_viejo,'{}'::jsonb)) k
    union
    select k from jsonb_object_keys(coalesce(p_nuevo,'{}'::jsonb)) k
  ), dif as (
    select k from claves
    where (p_viejo -> k) is distinct from (p_nuevo -> k)
  )
  select
    coalesce((select jsonb_object_agg(k, p_viejo -> k) from dif), '{}'::jsonb),
    coalesce((select jsonb_object_agg(k, p_nuevo -> k) from dif), '{}'::jsonb);
$$;

-- Disparador genérico de auditoría (se adjunta a las tablas en 0009).
create or replace function app.tg_auditar()
returns trigger language plpgsql security definer
set search_path = ''
as $$
declare
  v_id text;
  v_ant jsonb; v_nue jsonb;
begin
  if tg_op = 'INSERT' then
    v_id := coalesce(to_jsonb(new) ->> 'id', '?');
    insert into public.auditoria (tabla, registro_id, accion, actor, motivo, anterior, nuevo)
    values (tg_table_name, v_id, 'INSERT', auth.uid(), app.motivo_actual(), null, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    v_id := coalesce(to_jsonb(new) ->> 'id', '?');
    select d.anterior, d.nuevo into v_ant, v_nue
    from app.jsonb_diff(to_jsonb(old), to_jsonb(new)) d;
    if v_ant <> '{}'::jsonb or v_nue <> '{}'::jsonb then
      insert into public.auditoria (tabla, registro_id, accion, actor, motivo, anterior, nuevo)
      values (tg_table_name, v_id, 'UPDATE', auth.uid(), app.motivo_actual(), v_ant, v_nue);
    end if;
    return new;
  else
    v_id := coalesce(to_jsonb(old) ->> 'id', '?');
    insert into public.auditoria (tabla, registro_id, accion, actor, motivo, anterior, nuevo)
    values (tg_table_name, v_id, 'DELETE', auth.uid(), app.motivo_actual(), to_jsonb(old), null);
    return old;
  end if;
end $$;

-- Control de versión optimista: el servidor incrementa "version" en cada UPDATE;
-- el cliente filtra por la versión esperada (…eq('version', n)) y detecta conflicto
-- cuando 0 filas resultan afectadas. Las RPC reciben p_version y validan explícito.
create or replace function app.tg_version()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  new.version := old.version + 1;
  new.actualizado_en := now();
  return new;
end $$;
-- ============================================================
-- 0002_perfiles_roles_catalogos.sql
-- Perfiles (espejo de auth.users), roles acumulables, catálogos
-- administrables, helpers de autorización y RPCs de administración.
-- Principio: el navegador NUNCA es fuente de autorización; todo se
-- verifica aquí contra el estado controlado en servidor.
-- ============================================================

-- ------------------------------------------------------------
-- Tablas
-- ------------------------------------------------------------
create table if not exists public.perfiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  nombre         text not null default 'Sin nombre',
  correo         text,                          -- copia informativa; la fuente es auth.users
  estado         public.estado_perfil not null default 'pendiente',
  area_id        uuid,                          -- FK se añade tras crear areas
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  version        integer not null default 1,
  constraint nombre_corto check (char_length(nombre) between 1 and 120)
);

create table if not exists public.perfil_roles (
  perfil_id   uuid not null references public.perfiles (id) on delete cascade,
  rol         public.rol_app not null,
  asignado_por uuid,
  creado_en   timestamptz not null default now(),
  primary key (perfil_id, rol)
);

create table if not exists public.areas (
  id        uuid primary key default gen_random_uuid(),
  nombre    text not null unique,
  activo    boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  version   integer not null default 1
);

create table if not exists public.centros_costo (
  id        uuid primary key default gen_random_uuid(),
  codigo    text not null unique,
  nombre    text not null,
  activo    boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  version   integer not null default 1
);

create table if not exists public.proveedores (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null unique,
  identificacion text,       -- texto informativo; NO es validación legal ni fiscal
  contacto   text,
  telefono   text,
  correo     text,
  notas      text,
  activo     boolean not null default true,
  creado_en  timestamptz not null default now(),
  creado_por uuid default auth.uid(),
  actualizado_en timestamptz not null default now(),
  version    integer not null default 1
);

do $$ begin
  alter table public.perfiles
    add constraint perfiles_area_fk foreign key (area_id) references public.areas (id);
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- Alta automática de perfil al registrarse (queda PENDIENTE, sin acceso)
-- ------------------------------------------------------------
create or replace function app.tg_nuevo_usuario()
returns trigger language plpgsql security definer
set search_path = ''
as $$
declare
  v_nombre text;
begin
  v_nombre := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'nombre', '')), '');
  insert into public.perfiles (id, nombre, correo, estado)
  values (new.id, coalesce(left(v_nombre, 120), 'Sin nombre'), new.email, 'pendiente')
  on conflict (id) do nothing;
  insert into public.auditoria (tabla, registro_id, accion, actor, motivo, anterior, nuevo)
  values ('perfiles', new.id::text, 'REGISTRO', new.id, null, null,
          jsonb_build_object('estado','pendiente','correo', new.email));
  return new;
end $$;

drop trigger if exists tg_perfiles_nuevo_usuario on auth.users;
create trigger tg_perfiles_nuevo_usuario
  after insert on auth.users
  for each row execute function app.tg_nuevo_usuario();

-- ------------------------------------------------------------
-- Helpers de autorización (SECURITY DEFINER para no recursar en RLS)
-- ------------------------------------------------------------
create or replace function app.es_activo()
returns boolean language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.perfiles p
    where p.id = auth.uid() and p.estado = 'activo'
  );
$$;

create or replace function app.tiene_rol(p_rol public.rol_app)
returns boolean language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.perfiles p
    join public.perfil_roles r on r.perfil_id = p.id
    where p.id = auth.uid() and p.estado = 'activo' and r.rol = p_rol
  );
$$;

create or replace function app.es_admin()
returns boolean language sql stable security definer
set search_path = ''
as $$ select app.tiene_rol('administrador'::public.rol_app); $$;

create or replace function app.es_compras()
returns boolean language sql stable security definer
set search_path = ''
as $$ select app.tiene_rol('compras'::public.rol_app); $$;

create or replace function app.es_gestor()
returns boolean language sql stable security definer
set search_path = ''
as $$ select app.es_admin() or app.es_compras(); $$;

create or replace function app.rol_de(p_usuario uuid, p_rol public.rol_app)
returns boolean language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.perfiles p
    join public.perfil_roles r on r.perfil_id = p.id
    where p.id = p_usuario and p.estado = 'activo' and r.rol = p_rol
  );
$$;

create or replace function app.admins_activos()
returns integer language sql stable security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.perfiles p
  join public.perfil_roles r on r.perfil_id = p.id and r.rol = 'administrador'
  where p.estado = 'activo';
$$;

revoke all on function app.es_activo() from public;
revoke all on function app.tiene_rol(public.rol_app) from public;
revoke all on function app.es_admin() from public;
revoke all on function app.es_compras() from public;
revoke all on function app.es_gestor() from public;
revoke all on function app.rol_de(uuid, public.rol_app) from public;
revoke all on function app.admins_activos() from public;
grant execute on function app.es_activo(), app.tiene_rol(public.rol_app), app.es_admin(),
  app.es_compras(), app.es_gestor(), app.rol_de(uuid, public.rol_app), app.admins_activos()
  to authenticated;

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table public.perfiles      enable row level security;
alter table public.perfil_roles  enable row level security;
alter table public.areas         enable row level security;
alter table public.centros_costo enable row level security;
alter table public.proveedores   enable row level security;
alter table public.configuracion enable row level security;
alter table public.operaciones   enable row level security;
alter table public.auditoria     enable row level security;

-- perfiles: cada quien ve el suyo (aun pendiente, para conocer su estado);
-- los roles de gestión ven todos los perfiles (nombres internos).
drop policy if exists perfiles_select on public.perfiles;
create policy perfiles_select on public.perfiles for select to authenticated
  using (
    id = auth.uid()
    or app.es_gestor()
    or (app.es_activo() and (app.tiene_rol('aprobador') or app.tiene_rol('almacen')))
  );
-- Sin políticas de INSERT/UPDATE/DELETE: los cambios pasan por RPCs del servidor.

drop policy if exists perfil_roles_select on public.perfil_roles;
create policy perfil_roles_select on public.perfil_roles for select to authenticated
  using (perfil_id = auth.uid() or app.es_admin());

-- Catálogos: lectura para usuarios activos; escritura del administrador
-- (proveedores también Compras). El disparador de auditoría registra cambios.
drop policy if exists areas_select on public.areas;
create policy areas_select on public.areas for select to authenticated using (app.es_activo());
drop policy if exists areas_admin on public.areas;
create policy areas_admin on public.areas for all to authenticated
  using (app.es_admin()) with check (app.es_admin());

drop policy if exists cc_select on public.centros_costo;
create policy cc_select on public.centros_costo for select to authenticated using (app.es_activo());
drop policy if exists cc_admin on public.centros_costo;
create policy cc_admin on public.centros_costo for all to authenticated
  using (app.es_admin()) with check (app.es_admin());

drop policy if exists prov_select on public.proveedores;
create policy prov_select on public.proveedores for select to authenticated using (app.es_activo());
drop policy if exists prov_gestion on public.proveedores;
create policy prov_gestion on public.proveedores for all to authenticated
  using (app.es_gestor()) with check (app.es_gestor());

drop policy if exists config_select on public.configuracion;
create policy config_select on public.configuracion for select to authenticated using (app.es_activo());
-- Escritura de configuración solo por RPC (abajo).

-- operaciones y auditoria: sin acceso directo de lectura general.
drop policy if exists auditoria_admin on public.auditoria;
create policy auditoria_admin on public.auditoria for select to authenticated using (app.es_admin());
-- operaciones: ninguna política => nadie lee ni escribe por la API.

-- Catálogos: versión optimista
drop trigger if exists tg_areas_version on public.areas;
create trigger tg_areas_version before update on public.areas
  for each row execute function app.tg_version();
drop trigger if exists tg_cc_version on public.centros_costo;
create trigger tg_cc_version before update on public.centros_costo
  for each row execute function app.tg_version();
drop trigger if exists tg_prov_version on public.proveedores;
create trigger tg_prov_version before update on public.proveedores
  for each row execute function app.tg_version();

-- ------------------------------------------------------------
-- RPCs de perfil propio
-- ------------------------------------------------------------
create or replace function public.fn_mi_perfil()
returns jsonb language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'nombre', p.nombre, 'correo', p.correo, 'estado', p.estado,
    'area_id', p.area_id,
    'roles', coalesce((select jsonb_agg(r.rol order by r.rol)
                       from public.perfil_roles r where r.perfil_id = p.id), '[]'::jsonb)
  )
  from public.perfiles p where p.id = auth.uid();
$$;

create or replace function public.fn_actualizar_mi_nombre(p_nombre text)
returns void language plpgsql security definer
set search_path = ''
as $$
declare v_ant text;
begin
  if not app.es_activo() then
    raise exception 'Tu cuenta no está activa.' using errcode = '42501';
  end if;
  if nullif(btrim(p_nombre), '') is null or char_length(btrim(p_nombre)) > 120 then
    raise exception 'Nombre inválido.';
  end if;
  select nombre into v_ant from public.perfiles where id = auth.uid();
  update public.perfiles
     set nombre = btrim(p_nombre), actualizado_en = now(), version = version + 1
   where id = auth.uid();
  perform app.auditar('perfiles', auth.uid()::text, 'CAMBIO_NOMBRE',
    jsonb_build_object('nombre', v_ant), jsonb_build_object('nombre', btrim(p_nombre)), null);
end $$;

-- ------------------------------------------------------------
-- RPCs de administración de usuarios
-- Reglas: nadie elige su propio privilegio; verificación de identidad es un
-- paso humano del administrador; no se puede dejar la app sin administradores.
-- ------------------------------------------------------------
create or replace function public.fn_admin_cambiar_estado_usuario(
  p_usuario uuid, p_estado public.estado_perfil, p_motivo text, p_version integer
) returns void language plpgsql security definer
set search_path = ''
as $$
declare
  v_perfil public.perfiles%rowtype;
begin
  if not app.es_admin() then
    raise exception 'Solo un administrador activo puede gestionar usuarios.' using errcode = '42501';
  end if;
  if p_estado = 'pendiente' then
    raise exception 'No se puede devolver una cuenta a estado pendiente.';
  end if;
  if nullif(btrim(coalesce(p_motivo,'')),'') is null and p_estado in ('desactivado','rechazado') then
    raise exception 'Indica el motivo de la desactivación o rechazo.';
  end if;

  select * into v_perfil from public.perfiles where id = p_usuario for update;
  if not found then raise exception 'Usuario no encontrado.'; end if;
  if v_perfil.version <> p_version then
    raise exception 'El registro fue modificado por otra persona. Recarga e intenta de nuevo.' using errcode = '40001';
  end if;
  if v_perfil.estado = p_estado then return; end if;

  -- Nunca dejar la aplicación sin administradores activos.
  if p_estado in ('desactivado','rechazado')
     and exists (select 1 from public.perfil_roles r where r.perfil_id = p_usuario and r.rol = 'administrador')
     and v_perfil.estado = 'activo'
     and app.admins_activos() <= 1 then
    raise exception 'No puedes desactivar al último administrador activo.';
  end if;
  if p_usuario = auth.uid() and p_estado in ('desactivado','rechazado') then
    raise exception 'No puedes desactivar tu propia cuenta.';
  end if;

  update public.perfiles
     set estado = p_estado, actualizado_en = now(), version = version + 1
   where id = p_usuario;

  perform app.auditar('perfiles', p_usuario::text, 'CAMBIO_ESTADO',
    jsonb_build_object('estado', v_perfil.estado),
    jsonb_build_object('estado', p_estado), p_motivo);
end $$;

create or replace function public.fn_admin_establecer_roles(
  p_usuario uuid, p_roles public.rol_app[], p_motivo text
) returns void language plpgsql security definer
set search_path = ''
as $$
declare
  v_actuales public.rol_app[];
  v_estado public.estado_perfil;
begin
  if not app.es_admin() then
    raise exception 'Solo un administrador activo puede asignar permisos.' using errcode = '42501';
  end if;
  select estado into v_estado from public.perfiles where id = p_usuario for update;
  if not found then raise exception 'Usuario no encontrado.'; end if;

  select coalesce(array_agg(rol order by rol), '{}') into v_actuales
  from public.perfil_roles where perfil_id = p_usuario;

  -- Guardas: no retirarse a sí mismo el rol administrador; no dejar la app sin admin.
  if 'administrador' = any (v_actuales) and not ('administrador' = any (coalesce(p_roles,'{}'))) then
    if p_usuario = auth.uid() then
      raise exception 'No puedes quitarte a ti mismo el rol administrador.';
    end if;
    if v_estado = 'activo' and app.admins_activos() <= 1 then
      raise exception 'No puedes retirar el rol administrador del último administrador activo.';
    end if;
  end if;

  delete from public.perfil_roles where perfil_id = p_usuario;
  insert into public.perfil_roles (perfil_id, rol, asignado_por)
  select p_usuario, r, auth.uid() from unnest(coalesce(p_roles,'{}')) as r;

  perform app.auditar('perfil_roles', p_usuario::text, 'ROLES',
    jsonb_build_object('roles', to_jsonb(v_actuales)),
    jsonb_build_object('roles', to_jsonb(coalesce(p_roles,'{}'))), p_motivo);
end $$;

create or replace function public.fn_admin_activar_usuario(
  p_usuario uuid, p_roles public.rol_app[], p_area uuid, p_version integer
) returns void language plpgsql security definer
set search_path = ''
as $$
declare v_perfil public.perfiles%rowtype;
begin
  if not app.es_admin() then
    raise exception 'Solo un administrador activo puede activar cuentas.' using errcode = '42501';
  end if;
  select * into v_perfil from public.perfiles where id = p_usuario for update;
  if not found then raise exception 'Usuario no encontrado.'; end if;
  if v_perfil.version <> p_version then
    raise exception 'El registro fue modificado por otra persona. Recarga e intenta de nuevo.' using errcode = '40001';
  end if;
  if p_area is not null and not exists (select 1 from public.areas a where a.id = p_area and a.activo) then
    raise exception 'El área indicada no existe o está inactiva.';
  end if;
  if coalesce(array_length(p_roles,1),0) = 0 then
    raise exception 'Asigna al menos un permiso (normalmente "solicitante").';
  end if;

  update public.perfiles
     set estado = 'activo', area_id = p_area, actualizado_en = now(), version = version + 1
   where id = p_usuario;

  delete from public.perfil_roles where perfil_id = p_usuario;
  insert into public.perfil_roles (perfil_id, rol, asignado_por)
  select p_usuario, r, auth.uid() from unnest(p_roles) as r;

  perform app.auditar('perfiles', p_usuario::text, 'ACTIVACION',
    jsonb_build_object('estado', v_perfil.estado),
    jsonb_build_object('estado','activo','roles', to_jsonb(p_roles), 'area_id', p_area),
    'Activación tras verificación de identidad por canal corporativo');
end $$;

create or replace function public.fn_admin_cambiar_area_usuario(
  p_usuario uuid, p_area uuid, p_motivo text, p_version integer
) returns void language plpgsql security definer
set search_path = ''
as $$
declare v_perfil public.perfiles%rowtype;
begin
  if not app.es_admin() then
    raise exception 'Solo un administrador activo puede cambiar el área.' using errcode = '42501';
  end if;
  select * into v_perfil from public.perfiles where id = p_usuario for update;
  if not found then raise exception 'Usuario no encontrado.'; end if;
  if v_perfil.version <> p_version then
    raise exception 'El registro fue modificado por otra persona. Recarga e intenta de nuevo.' using errcode = '40001';
  end if;
  if p_area is not null and not exists (select 1 from public.areas a where a.id = p_area and a.activo) then
    raise exception 'El área indicada no existe o está inactiva.';
  end if;
  update public.perfiles
     set area_id = p_area, actualizado_en = now(), version = version + 1
   where id = p_usuario;
  perform app.auditar('perfiles', p_usuario::text, 'CAMBIO_AREA',
    jsonb_build_object('area_id', v_perfil.area_id),
    jsonb_build_object('area_id', p_area), p_motivo);
end $$;

create or replace function public.fn_admin_actualizar_configuracion(
  p_clave text, p_valor jsonb, p_motivo text
) returns void language plpgsql security definer
set search_path = ''
as $$
declare v_ant jsonb; v_editable boolean;
begin
  if not app.es_admin() then
    raise exception 'Solo un administrador activo puede cambiar la configuración.' using errcode = '42501';
  end if;
  select valor, editable into v_ant, v_editable from public.configuracion where clave = p_clave for update;
  if not found then raise exception 'Parámetro desconocido.'; end if;
  if not v_editable then raise exception 'Este parámetro no es editable desde la aplicación.'; end if;
  update public.configuracion
     set valor = p_valor, actualizado_en = now(), actualizado_por = auth.uid()
   where clave = p_clave;
  perform app.auditar('configuracion', p_clave, 'UPDATE',
    jsonb_build_object('valor', v_ant), jsonb_build_object('valor', p_valor), p_motivo);
end $$;

-- Vista de administración de usuarios (respeta RLS por security_invoker).
create or replace view public.v_usuarios_admin
with (security_invoker = true) as
select
  p.id, p.nombre, p.correo, p.estado, p.area_id, a.nombre as area_nombre,
  p.creado_en, p.actualizado_en, p.version,
  coalesce((select array_agg(r.rol order by r.rol)
            from public.perfil_roles r where r.perfil_id = p.id), '{}') as roles
from public.perfiles p
left join public.areas a on a.id = p.area_id;
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
-- ============================================================
-- 0006_novedades.sql
-- Novedades: datos incompletos, producto mal solicitado, entrega
-- incorrecta y observación general. Con motivo, responsable,
-- evidencia (adjuntos en 0007), estado de atención y resolución.
-- Una corrección de solicitud y una devolución física son operaciones
-- distintas: la novedad documenta; el movimiento mueve unidades.
-- ============================================================

create table if not exists public.novedades (
  id            uuid primary key default gen_random_uuid(),
  articulo_id   uuid not null references public.articulos (id) on delete restrict,
  tipo          public.tipo_novedad not null,
  descripcion   text not null,
  estado        public.estado_novedad not null default 'abierta',
  resolucion    text,
  creado_por    uuid not null default auth.uid() references public.perfiles (id),
  creado_en     timestamptz not null default now(),
  atendido_por  uuid references public.perfiles (id),
  resuelto_por  uuid references public.perfiles (id),
  resuelto_en   timestamptz,
  actualizado_en timestamptz not null default now(),
  version       integer not null default 1,
  constraint novedad_descripcion check (char_length(btrim(descripcion)) >= 5)
);

create index if not exists novedades_articulo_idx on public.novedades (articulo_id, estado);

alter table public.novedades enable row level security;

drop policy if exists nov_select on public.novedades;
create policy nov_select on public.novedades for select to authenticated
  using (app.es_gestor() or app.tiene_rol('almacen')
         or app.es_dueno_articulo(articulo_id) or app.es_aprobador_de(articulo_id));

-- Creación: Compras/Admin/Almacén sobre cualquier artículo visible;
-- el solicitante sobre sus propios artículos.
drop policy if exists nov_insert on public.novedades;
create policy nov_insert on public.novedades for insert to authenticated
  with check (
    creado_por = auth.uid()
    and (app.es_gestor() or app.tiene_rol('almacen') or app.es_dueno_articulo(articulo_id))
  );
-- Cambios de estado/resolución solo por RPC.

create or replace function app.tg_novedades_proteger()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if not app.es_servidor() then
      if new.estado <> 'abierta' or new.resolucion is not null
         or new.resuelto_por is not null or new.resuelto_en is not null then
        raise exception 'Una novedad nueva inicia abierta y sin resolución.';
      end if;
      if not exists (select 1 from public.articulos a where a.id = new.articulo_id
                     and a.etapa not in ('borrador','cancelado')) then
        raise exception 'El artículo no admite novedades en su etapa actual.';
      end if;
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and not app.es_servidor() then
    raise exception 'Las novedades se atienden y resuelven con las operaciones correspondientes.';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Las novedades no se eliminan: quedan como registro.';
  end if;
  return new;
end $$;

drop trigger if exists tg_novedades_proteger on public.novedades;
create trigger tg_novedades_proteger
  before insert or update or delete on public.novedades
  for each row execute function app.tg_novedades_proteger();

drop trigger if exists tg_novedades_version on public.novedades;
create trigger tg_novedades_version before update on public.novedades
  for each row execute function app.tg_version();

-- ------------------------------------------------------------
-- RPCs de atención
-- ------------------------------------------------------------
create or replace function public.fn_atender_novedad(p_novedad uuid, p_version integer)
returns void language plpgsql security definer
set search_path = ''
as $$
declare v_n public.novedades%rowtype;
begin
  if not (app.es_gestor() or app.tiene_rol('almacen')) then
    raise exception 'Solo Compras, Almacén o el administrador atienden novedades.' using errcode = '42501';
  end if;
  select * into v_n from public.novedades where id = p_novedad for update;
  if not found then raise exception 'Novedad no encontrada.'; end if;
  if v_n.version <> p_version then
    raise exception 'La novedad fue modificada en otra sesión. Recarga e intenta de nuevo.' using errcode = '40001';
  end if;
  if v_n.estado <> 'abierta' then return; end if;

  perform app.modo_servidor();
  update public.novedades
     set estado = 'en_atencion', atendido_por = auth.uid()
   where id = p_novedad;
  perform app.auditar('novedades', p_novedad::text, 'EN_ATENCION',
    jsonb_build_object('estado','abierta'), jsonb_build_object('estado','en_atencion'), null);
end $$;

create or replace function public.fn_resolver_novedad(
  p_novedad uuid, p_resolucion text, p_version integer
) returns void language plpgsql security definer
set search_path = ''
as $$
declare v_n public.novedades%rowtype;
begin
  if not (app.es_gestor() or app.tiene_rol('almacen')) then
    raise exception 'Solo Compras, Almacén o el administrador resuelven novedades.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_resolucion,'')),'') is null then
    raise exception 'Describe la resolución de la novedad.';
  end if;
  select * into v_n from public.novedades where id = p_novedad for update;
  if not found then raise exception 'Novedad no encontrada.'; end if;
  if v_n.version <> p_version then
    raise exception 'La novedad fue modificada en otra sesión. Recarga e intenta de nuevo.' using errcode = '40001';
  end if;
  if v_n.estado = 'resuelta' then return; end if;

  perform app.modo_servidor();
  update public.novedades
     set estado = 'resuelta', resolucion = btrim(p_resolucion),
         resuelto_por = auth.uid(), resuelto_en = now()
   where id = p_novedad;
  perform app.auditar('novedades', p_novedad::text, 'RESUELTA',
    jsonb_build_object('estado', v_n.estado),
    jsonb_build_object('estado','resuelta','resolucion', btrim(p_resolucion)), null);
end $$;

create or replace function public.fn_reabrir_novedad(
  p_novedad uuid, p_motivo text, p_version integer
) returns void language plpgsql security definer
set search_path = ''
as $$
declare v_n public.novedades%rowtype;
begin
  if not app.es_gestor() then
    raise exception 'Solo Compras o el administrador reabren novedades.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_motivo,'')),'') is null then
    raise exception 'Indica el motivo de la reapertura.';
  end if;
  select * into v_n from public.novedades where id = p_novedad for update;
  if not found then raise exception 'Novedad no encontrada.'; end if;
  if v_n.version <> p_version then
    raise exception 'La novedad fue modificada en otra sesión. Recarga e intenta de nuevo.' using errcode = '40001';
  end if;
  if v_n.estado <> 'resuelta' then return; end if;

  perform app.modo_servidor();
  update public.novedades
     set estado = 'en_atencion', resuelto_por = null, resuelto_en = null
   where id = p_novedad;
  perform app.auditar('novedades', p_novedad::text, 'REABIERTA',
    jsonb_build_object('estado','resuelta'), jsonb_build_object('estado','en_atencion'), p_motivo);
end $$;
-- ============================================================
-- 0007_adjuntos_storage.sql
-- Adjuntos privados (JPG/PNG/WebP/PDF), 5 MB y 3 por artículo
-- (configurables), rutas impredecibles, descarga autenticada con
-- JWT + RLS en cada petición (sin enlaces firmados reutilizables).
-- El bucket valida tamaño y tipo también en el almacenamiento.
-- ============================================================

create table if not exists public.adjuntos (
  id          uuid primary key default gen_random_uuid(),
  entidad     public.entidad_adjunto not null,
  entidad_id  uuid not null,
  ruta        text not null unique,          -- <entidad>/<entidad_id>/<uuid>.<ext>
  nombre_original text not null,
  mime        text not null,
  tamano_bytes bigint not null,
  subido_por  uuid not null default auth.uid() references public.perfiles (id),
  creado_en   timestamptz not null default now(),
  constraint adjunto_tamano check (tamano_bytes > 0),
  constraint adjunto_mime check (mime in ('image/jpeg','image/png','image/webp','application/pdf'))
);

create index if not exists adjuntos_entidad_idx on public.adjuntos (entidad, entidad_id);

alter table public.adjuntos enable row level security;

-- ------------------------------------------------------------
-- Autorización por entidad
-- ------------------------------------------------------------
create or replace function app.puede_ver_entidad_adjunto(p_entidad public.entidad_adjunto, p_id uuid)
returns boolean language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not app.es_activo() then return false; end if;
  if p_entidad = 'articulo' then
    return app.es_gestor() or app.tiene_rol('almacen')
        or app.es_dueno_articulo(p_id) or app.es_aprobador_de(p_id);
  elsif p_entidad = 'novedad' then
    return exists (
      select 1 from public.novedades n
      where n.id = p_id
        and (app.es_gestor() or app.tiene_rol('almacen')
             or app.es_dueno_articulo(n.articulo_id) or app.es_aprobador_de(n.articulo_id))
    );
  elsif p_entidad = 'compra' then
    return exists (
      select 1 from public.compras c
      where c.id = p_id
        and (app.es_gestor() or app.tiene_rol('almacen')
             or app.es_dueno_articulo(c.articulo_id) or app.es_aprobador_de(c.articulo_id))
    );
  elsif p_entidad = 'compra_externa' then
    return app.es_gestor();
  end if;
  return false;
end $$;

create or replace function app.puede_adjuntar_entidad(p_entidad public.entidad_adjunto, p_id uuid)
returns boolean language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not app.es_activo() then return false; end if;
  if p_entidad = 'articulo' then
    -- El solicitante adjunta en borrador/corrección y mientras no esté cerrado;
    -- Compras/Almacén en gestión.
    return (app.es_gestor() or app.tiene_rol('almacen')
            or app.es_dueno_articulo(p_id))
       and exists (select 1 from public.articulos a where a.id = p_id
                   and a.etapa not in ('cerrado','cancelado'));
  elsif p_entidad = 'novedad' then
    return exists (
      select 1 from public.novedades n
      where n.id = p_id
        and (app.es_gestor() or app.tiene_rol('almacen') or n.creado_por = auth.uid())
        and n.estado <> 'resuelta'
    );
  elsif p_entidad = 'compra' then
    return app.es_gestor() and exists (select 1 from public.compras c where c.id = p_id);
  elsif p_entidad = 'compra_externa' then
    return app.es_gestor();
  end if;
  return false;
end $$;

revoke all on function app.puede_ver_entidad_adjunto(public.entidad_adjunto, uuid) from public;
revoke all on function app.puede_adjuntar_entidad(public.entidad_adjunto, uuid) from public;
grant execute on function app.puede_ver_entidad_adjunto(public.entidad_adjunto, uuid),
  app.puede_adjuntar_entidad(public.entidad_adjunto, uuid) to authenticated;

drop policy if exists adj_select on public.adjuntos;
create policy adj_select on public.adjuntos for select to authenticated
  using (app.puede_ver_entidad_adjunto(entidad, entidad_id));
-- INSERT/DELETE de filas de adjuntos: solo por RPC (consistencia con Storage).

-- ------------------------------------------------------------
-- Interpretación de rutas del bucket
-- ------------------------------------------------------------
create or replace function app.ruta_entidad(p_ruta text, out o_entidad public.entidad_adjunto, out o_id uuid)
language plpgsql immutable
set search_path = ''
as $$
declare v_partes text[];
begin
  v_partes := string_to_array(p_ruta, '/');
  if array_length(v_partes, 1) <> 3 then
    raise exception 'Ruta de adjunto inválida.';
  end if;
  o_entidad := v_partes[1]::public.entidad_adjunto;
  o_id := v_partes[2]::uuid;
end $$;

create or replace function app.storage_puede_leer(p_ruta text)
returns boolean language plpgsql stable security definer
set search_path = ''
as $$
declare e public.entidad_adjunto; i uuid;
begin
  begin
    select o_entidad, o_id into e, i from app.ruta_entidad(p_ruta);
  exception when others then
    return false;
  end;
  return app.puede_ver_entidad_adjunto(e, i);
end $$;

create or replace function app.storage_puede_subir(p_ruta text)
returns boolean language plpgsql stable security definer
set search_path = ''
as $$
declare e public.entidad_adjunto; i uuid;
begin
  begin
    select o_entidad, o_id into e, i from app.ruta_entidad(p_ruta);
  exception when others then
    return false;
  end;
  if e = 'articulo' then
    -- Límite de adjuntos por artículo también en el almacenamiento.
    if (select count(*) from public.adjuntos a
        where a.entidad = 'articulo' and a.entidad_id = i)
       >= app.config_num('max_adjuntos_por_articulo', 3) then
      return false;
    end if;
  end if;
  return app.puede_adjuntar_entidad(e, i);
end $$;

create or replace function app.storage_puede_borrar(p_ruta text)
returns boolean language plpgsql stable security definer
set search_path = ''
as $$
declare e public.entidad_adjunto; i uuid; v_subio uuid;
begin
  begin
    select o_entidad, o_id into e, i from app.ruta_entidad(p_ruta);
  exception when others then
    return false;
  end;
  select subido_por into v_subio from public.adjuntos where ruta = p_ruta;
  -- Huérfanos (subida sin registro): puede limpiarlos quien pudo subir; registrados: admin o quien subió.
  if v_subio is null then
    return app.puede_adjuntar_entidad(e, i);
  end if;
  return app.es_admin() or (v_subio = auth.uid() and app.puede_adjuntar_entidad(e, i));
end $$;

revoke all on function app.storage_puede_leer(text), app.storage_puede_subir(text),
  app.storage_puede_borrar(text) from public;
grant execute on function app.storage_puede_leer(text), app.storage_puede_subir(text),
  app.storage_puede_borrar(text) to authenticated;

-- ------------------------------------------------------------
-- Bucket privado con límites de tamaño y tipo en el propio Storage
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('adjuntos', 'adjuntos', false, 5242880,
        array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists adjuntos_leer on storage.objects;
create policy adjuntos_leer on storage.objects for select to authenticated
  using (bucket_id = 'adjuntos' and app.storage_puede_leer(name));

drop policy if exists adjuntos_subir on storage.objects;
create policy adjuntos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'adjuntos' and app.storage_puede_subir(name));

drop policy if exists adjuntos_borrar on storage.objects;
create policy adjuntos_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'adjuntos' and app.storage_puede_borrar(name));
-- Sin política de UPDATE: los objetos no se sobreescriben.

-- ------------------------------------------------------------
-- Registro del adjunto tras subir el archivo (consistencia BD ↔ Storage)
-- ------------------------------------------------------------
create or replace function public.fn_registrar_adjunto(
  p_entidad public.entidad_adjunto,
  p_entidad_id uuid,
  p_ruta text,
  p_nombre_original text,
  p_mime text,
  p_tamano bigint,
  p_op uuid
) returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare
  v_e public.entidad_adjunto; v_i uuid;
  v_max_n numeric; v_max_mb numeric;
  v_id uuid; v_res jsonb;
begin
  v_res := app.op_existente(p_op);
  if v_res is not null then return v_res; end if;

  select o_entidad, o_id into v_e, v_i from app.ruta_entidad(p_ruta);
  if v_e <> p_entidad or v_i <> p_entidad_id then
    raise exception 'La ruta no corresponde a la entidad indicada.';
  end if;
  if not app.puede_adjuntar_entidad(p_entidad, p_entidad_id) then
    raise exception 'Sin permiso para adjuntar en este registro.' using errcode = '42501';
  end if;
  if p_mime not in ('image/jpeg','image/png','image/webp','application/pdf') then
    raise exception 'Tipo de archivo no permitido (JPG, PNG, WebP o PDF).';
  end if;
  v_max_mb := app.config_num('max_tamano_adjunto_mb', 5);
  if p_tamano is null or p_tamano <= 0 or p_tamano > v_max_mb * 1024 * 1024 then
    raise exception 'El archivo supera el máximo de % MB.', v_max_mb;
  end if;

  -- El objeto debe existir realmente en Storage (sin registros falsos).
  if not exists (select 1 from storage.objects o
                 where o.bucket_id = 'adjuntos' and o.name = p_ruta) then
    raise exception 'El archivo no se encuentra en el almacenamiento; repite la subida.';
  end if;

  if p_entidad = 'articulo' then
    v_max_n := app.config_num('max_adjuntos_por_articulo', 3);
    if (select count(*) from public.adjuntos a
        where a.entidad = 'articulo' and a.entidad_id = p_entidad_id) >= v_max_n then
      raise exception 'Máximo % adjuntos por artículo.', v_max_n;
    end if;
  end if;

  insert into public.adjuntos (entidad, entidad_id, ruta, nombre_original, mime, tamano_bytes, subido_por)
  values (p_entidad, p_entidad_id, p_ruta, left(coalesce(p_nombre_original,'archivo'), 200),
          p_mime, p_tamano, auth.uid())
  returning id into v_id;

  v_res := jsonb_build_object('ok', true, 'adjunto_id', v_id);
  perform app.op_guardar(p_op, 'fn_registrar_adjunto', v_res);
  return v_res;
end $$;

create or replace function public.fn_eliminar_adjunto(p_adjunto uuid, p_motivo text)
returns void language plpgsql security definer
set search_path = ''
as $$
declare v_a public.adjuntos%rowtype;
begin
  select * into v_a from public.adjuntos where id = p_adjunto for update;
  if not found then raise exception 'Adjunto no encontrado.'; end if;
  if not (app.es_admin() or (v_a.subido_por = auth.uid()
          and app.puede_adjuntar_entidad(v_a.entidad, v_a.entidad_id))) then
    raise exception 'Sin permiso para eliminar este adjunto.' using errcode = '42501';
  end if;
  delete from public.adjuntos where id = p_adjunto;
  -- El objeto en Storage lo elimina el cliente con la política de borrado;
  -- si queda huérfano, el administrador puede limpiarlo (fn_adjuntos_huerfanos).
  perform app.auditar('adjuntos', p_adjunto::text, 'ELIMINACION',
    to_jsonb(v_a), null, p_motivo);
end $$;

-- Mantenimiento: objetos subidos sin registro (cargas fallidas).
create or replace function public.fn_adjuntos_huerfanos()
returns table (ruta text, creado timestamptz) language sql stable security definer
set search_path = ''
as $$
  select o.name, o.created_at
  from storage.objects o
  where o.bucket_id = 'adjuntos'
    and app.es_admin()
    and not exists (select 1 from public.adjuntos a where a.ruta = o.name)
  order by o.created_at;
$$;
-- ============================================================
-- 0008_compras_externas.sql
-- Registro de compras externas con referencia única (no se cuentan
-- dos veces al vincularlas a una solicitud ni al agregar adjuntos).
-- "Fuera del sistema" es ambiguo: se distingue
--   · tipo = 'externa'        → compra hecha por fuera de esta aplicación
--   · tipo = 'regularizacion' → compra que se regulariza aquí a posteriori
-- y aparte si está registrada en el sistema corporativo (si/no/por_confirmar).
-- Definición PENDIENTE DE VALIDACIÓN por Compras; cada reporte documenta cuál usa.
-- ============================================================

create sequence if not exists public.compras_externas_consecutivo_seq;

create table if not exists public.compras_externas (
  id            uuid primary key default gen_random_uuid(),
  consecutivo   bigint not null default nextval('public.compras_externas_consecutivo_seq'),
  referencia    text not null unique,            -- EXT-AAAA-NNNNN (única: evita doble conteo)
  tipo          public.tipo_compra_externa not null default 'externa',
  registrada_corporativo public.registro_corporativo not null default 'por_confirmar',
  area_id       uuid not null references public.areas (id),
  centro_costo_id uuid not null references public.centros_costo (id),
  proveedor_id  uuid references public.proveedores (id),
  proveedor_texto text,                          -- cuando el proveedor no está en el catálogo
  articulo_texto text not null,
  cantidad      numeric(12,2) not null,
  unidad        text not null default 'unidad',
  moneda        char(3) not null default 'COP',
  importe_total numeric(14,2),                   -- null = "sin información", nunca costo cero
  fecha_compra  date not null,
  observacion   text,
  solicitud_id  uuid references public.solicitudes (id),  -- vínculo posterior opcional
  creado_por    uuid not null default auth.uid() references public.perfiles (id),
  creado_en     timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  version       integer not null default 1,
  constraint ce_cantidad check (cantidad > 0),
  constraint ce_importe check (importe_total is null or importe_total >= 0),
  constraint ce_moneda check (moneda ~ '^[A-Z]{3}$'),
  constraint ce_proveedor check (proveedor_id is not null or nullif(btrim(coalesce(proveedor_texto,'')),'') is not null)
);

create index if not exists ce_area_idx on public.compras_externas (area_id);
create index if not exists ce_fecha_idx on public.compras_externas (fecha_compra);

alter table public.compras_externas enable row level security;

drop policy if exists ce_select on public.compras_externas;
create policy ce_select on public.compras_externas for select to authenticated
  using (app.es_gestor());
-- Escritura solo por RPC.

create or replace function app.tg_compras_externas_numero()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  new.referencia := 'EXT-' || to_char(now() at time zone 'America/Bogota', 'YYYY')
                  || '-' || lpad(new.consecutivo::text, 5, '0');
  return new;
end $$;

drop trigger if exists tg_ce_numero on public.compras_externas;
create trigger tg_ce_numero before insert on public.compras_externas
  for each row execute function app.tg_compras_externas_numero();

drop trigger if exists tg_ce_version on public.compras_externas;
create trigger tg_ce_version before update on public.compras_externas
  for each row execute function app.tg_version();

create or replace function public.fn_registrar_compra_externa(
  p_tipo public.tipo_compra_externa,
  p_registrada public.registro_corporativo,
  p_area uuid,
  p_centro_costo uuid,
  p_proveedor uuid,
  p_proveedor_texto text,
  p_articulo text,
  p_cantidad numeric,
  p_unidad text,
  p_moneda text,
  p_importe numeric,
  p_fecha date,
  p_observacion text,
  p_op uuid
) returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare v_id uuid; v_ref text; v_res jsonb;
begin
  v_res := app.op_existente(p_op);
  if v_res is not null then return v_res; end if;

  if not app.es_gestor() then
    raise exception 'Solo Compras o el administrador registran compras externas.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_articulo,'')),'') is null then
    raise exception 'Describe el artículo comprado.';
  end if;
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'Cantidad inválida.';
  end if;
  if p_importe is not null and p_importe < 0 then
    raise exception 'Importe inválido.';
  end if;
  if p_fecha is null then
    raise exception 'Indica la fecha de compra.';
  end if;
  if p_moneda is null or p_moneda !~ '^[A-Z]{3}$' then
    raise exception 'Moneda inválida (código de 3 letras, p. ej. COP).';
  end if;

  insert into public.compras_externas (
    tipo, registrada_corporativo, area_id, centro_costo_id, proveedor_id, proveedor_texto,
    articulo_texto, cantidad, unidad, moneda, importe_total, fecha_compra, observacion, creado_por
  ) values (
    coalesce(p_tipo,'externa'), coalesce(p_registrada,'por_confirmar'), p_area, p_centro_costo,
    p_proveedor, nullif(btrim(coalesce(p_proveedor_texto,'')),''),
    btrim(p_articulo), p_cantidad, coalesce(nullif(btrim(coalesce(p_unidad,'')),''),'unidad'),
    p_moneda, p_importe, p_fecha, nullif(btrim(coalesce(p_observacion,'')),''), auth.uid()
  ) returning id, referencia into v_id, v_ref;

  v_res := jsonb_build_object('ok', true, 'id', v_id, 'referencia', v_ref);
  perform app.op_guardar(p_op, 'fn_registrar_compra_externa', v_res);
  return v_res;
end $$;

create or replace function public.fn_actualizar_compra_externa(
  p_id uuid,
  p_registrada public.registro_corporativo,
  p_importe numeric,
  p_observacion text,
  p_motivo text,
  p_version integer
) returns void language plpgsql security definer
set search_path = ''
as $$
declare v_ce public.compras_externas%rowtype;
begin
  if not app.es_gestor() then
    raise exception 'Solo Compras o el administrador actualizan compras externas.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_motivo,'')),'') is null then
    raise exception 'Indica el motivo de la modificación.';
  end if;
  select * into v_ce from public.compras_externas where id = p_id for update;
  if not found then raise exception 'Compra externa no encontrada.'; end if;
  if v_ce.version <> p_version then
    raise exception 'El registro fue modificado en otra sesión. Recarga e intenta de nuevo.' using errcode = '40001';
  end if;
  if p_importe is not null and p_importe < 0 then
    raise exception 'Importe inválido.';
  end if;

  update public.compras_externas set
    registrada_corporativo = coalesce(p_registrada, registrada_corporativo),
    importe_total = p_importe,
    observacion = nullif(btrim(coalesce(p_observacion,'')),''),
    actualizado_en = now(),
    version = version + 1
  where id = p_id;

  perform app.auditar('compras_externas', p_id::text, 'MODIFICACION',
    jsonb_build_object('registrada', v_ce.registrada_corporativo, 'importe', v_ce.importe_total),
    jsonb_build_object('registrada', coalesce(p_registrada, v_ce.registrada_corporativo), 'importe', p_importe),
    p_motivo);
end $$;

-- Vincular/desvincular a una solicitud (la compra externa sigue contándose UNA vez por su referencia).
create or replace function public.fn_vincular_compra_externa(
  p_id uuid, p_solicitud uuid, p_motivo text, p_version integer
) returns void language plpgsql security definer
set search_path = ''
as $$
declare v_ce public.compras_externas%rowtype;
begin
  if not app.es_gestor() then
    raise exception 'Solo Compras o el administrador vinculan compras externas.' using errcode = '42501';
  end if;
  select * into v_ce from public.compras_externas where id = p_id for update;
  if not found then raise exception 'Compra externa no encontrada.'; end if;
  if v_ce.version <> p_version then
    raise exception 'El registro fue modificado en otra sesión. Recarga e intenta de nuevo.' using errcode = '40001';
  end if;
  if p_solicitud is not null
     and not exists (select 1 from public.solicitudes s where s.id = p_solicitud) then
    raise exception 'Solicitud no encontrada.';
  end if;

  update public.compras_externas
     set solicitud_id = p_solicitud, actualizado_en = now(), version = version + 1
   where id = p_id;

  perform app.auditar('compras_externas', p_id::text, 'VINCULO_SOLICITUD',
    jsonb_build_object('solicitud_id', v_ce.solicitud_id),
    jsonb_build_object('solicitud_id', p_solicitud), p_motivo);
end $$;
-- ============================================================
-- 0009_auditoria_triggers.sql
-- Adjunta el disparador genérico de auditoría a las tablas de negocio.
-- La auditoría la generan disparadores del servidor con el actor
-- autenticado (auth.uid()); nunca un actor enviado por el cliente.
-- ============================================================

do $$
declare t text;
begin
  foreach t in array array[
    'perfiles','perfil_roles','areas','centros_costo','proveedores',
    'solicitudes','articulos','cotizaciones','compras','movimientos',
    'novedades','adjuntos','compras_externas'
  ] loop
    execute format('drop trigger if exists tg_aud_%s on public.%I', t, t);
    execute format(
      'create trigger tg_aud_%s after insert or update or delete on public.%I
         for each row execute function app.tg_auditar()', t, t);
  end loop;
end $$;

-- aprobaciones: las escribe solo el servidor; auditamos INSERT y UPDATE.
drop trigger if exists tg_aud_aprobaciones on public.aprobaciones;
create trigger tg_aud_aprobaciones after insert or update on public.aprobaciones
  for each row execute function app.tg_auditar();

-- compra_fechas_estimadas ya es un historial en sí misma: sin disparador.

-- ------------------------------------------------------------
-- Historial consultable de un artículo (para pantalla de detalle):
-- cambios relevantes con valores anteriores/nuevos, respetando permisos.
-- ------------------------------------------------------------
create or replace function public.fn_historial_articulo(p_articulo uuid)
returns table (
  creado_en timestamptz, tabla text, accion text, actor_nombre text,
  motivo text, anterior jsonb, nuevo jsonb
) language sql stable security definer
set search_path = ''
as $$
  select a.creado_en, a.tabla, a.accion,
         coalesce(p.nombre, 'Sistema') as actor_nombre,
         a.motivo, a.anterior, a.nuevo
  from public.auditoria a
  left join public.perfiles p on p.id = a.actor
  where (app.es_gestor() or app.tiene_rol('almacen')
         or app.es_dueno_articulo(p_articulo) or app.es_aprobador_de(p_articulo))
    and (
      (a.tabla = 'articulos' and a.registro_id = p_articulo::text)
      or (a.tabla = 'cotizaciones' and a.registro_id in
            (select id::text from public.cotizaciones where articulo_id = p_articulo))
      or (a.tabla = 'compras' and a.registro_id in
            (select id::text from public.compras where articulo_id = p_articulo))
      or (a.tabla = 'movimientos' and a.registro_id in
            (select id::text from public.movimientos where articulo_id = p_articulo))
      or (a.tabla = 'novedades' and a.registro_id in
            (select id::text from public.novedades where articulo_id = p_articulo))
      or (a.tabla = 'aprobaciones' and a.registro_id in
            (select id::text from public.aprobaciones where articulo_id = p_articulo))
    )
  order by a.creado_en desc
  limit 500;
$$;
-- ============================================================
-- 0010_vistas_reportes.sql
-- Vistas con security_invoker (PG15+): NUNCA evaden RLS.
-- Atrasos solo con fecha estimada conocida; "sin información" ≠ 0.
-- Costos por área/centro de costo/período separando compras externas;
-- sin sumar monedas distintas (se agrupa por moneda).
-- ============================================================

-- Artículos con su contexto completo (gestión y listas).
create or replace view public.v_articulos
with (security_invoker = true) as
select
  a.id, a.solicitud_id, s.numero as solicitud_numero, s.estado as solicitud_estado,
  s.semana_lunes, s.solicitante_id, ps.nombre as solicitante_nombre,
  coalesce(a.area_id, s.area_id) as area_id, ar.nombre as area_nombre,
  coalesce(a.centro_costo_id, s.centro_costo_id) as centro_costo_id,
  cc.codigo as centro_costo_codigo, cc.nombre as centro_costo_nombre,
  a.nombre, a.descripcion, a.cantidad, a.unidad, a.prioridad, a.fecha_requerida,
  a.justificacion, a.etapa, a.requiere_aprobacion, a.aprobador_id,
  pa.nombre as aprobador_nombre,
  a.origen, a.estatus_historico, a.cerrado_en, a.cerrado_motivo,
  a.creado_en, a.actualizado_en, a.version,
  app.estado_aprobacion(a.id) as estado_aprobacion,
  c.id as compra_id, c.proveedor_id, pr.nombre as proveedor_nombre,
  c.moneda, c.precio_unitario, c.cantidad as cantidad_comprada,
  c.subtotal, c.impuestos, c.descuentos, c.otros_cargos, c.total,
  c.fecha_compra, c.referencia, c.fecha_estimada_llegada, c.llegada_completa_en,
  c.version as compra_version,
  m.recibido_bruto, m.devuelto_proveedor, m.recibido_neto,
  m.entregado_bruto, m.retornado, m.entregado_neto,
  m.disponible_almacen, m.pendiente_llegada,
  (select min(mv.fecha_efectiva) from public.movimientos mv
    where mv.articulo_id = a.id and mv.tipo = 'recepcion' and not mv.anulado) as primera_llegada,
  (select max(mv.fecha_efectiva) from public.movimientos mv
    where mv.articulo_id = a.id and mv.tipo = 'recepcion' and not mv.anulado) as ultima_llegada,
  case
    when c.id is null then null
    when c.fecha_estimada_llegada is null then null  -- "sin información"
    when coalesce(m.pendiente_llegada, c.cantidad) <= 0 then 0
    when c.fecha_estimada_llegada < (now() at time zone 'America/Bogota')::date
      then ((now() at time zone 'America/Bogota')::date - c.fecha_estimada_llegada)
    else 0
  end as dias_atraso,
  (select count(*) from public.novedades n
    where n.articulo_id = a.id and n.estado <> 'resuelta') as novedades_abiertas,
  (select count(*) from public.adjuntos ad
    where ad.entidad = 'articulo' and ad.entidad_id = a.id) as adjuntos
from public.articulos a
join public.solicitudes s on s.id = a.solicitud_id
left join public.perfiles ps on ps.id = s.solicitante_id
left join public.areas ar on ar.id = coalesce(a.area_id, s.area_id)
left join public.centros_costo cc on cc.id = coalesce(a.centro_costo_id, s.centro_costo_id)
left join public.perfiles pa on pa.id = a.aprobador_id
left join public.compras c on c.articulo_id = a.id
left join public.proveedores pr on pr.id = c.proveedor_id
left join lateral app.saldos_articulo(a.id) m on true;

-- Solicitudes con avance mixto (sin marcar todo por un único artículo).
create or replace view public.v_solicitudes
with (security_invoker = true) as
select
  s.id, s.numero, s.estado, s.solicitante_id, p.nombre as solicitante_nombre,
  s.area_id, ar.nombre as area_nombre,
  s.centro_costo_id, cc.codigo as centro_costo_codigo, cc.nombre as centro_costo_nombre,
  s.justificacion, s.semana_lunes, s.fecha_declarada, s.origen,
  s.creado_en, s.enviado_en, s.actualizado_en, s.version,
  (select count(*) from public.articulos a where a.solicitud_id = s.id) as total_articulos,
  (select count(*) from public.articulos a where a.solicitud_id = s.id
     and a.etapa in ('cerrado')) as articulos_cerrados,
  (select count(*) from public.articulos a where a.solicitud_id = s.id
     and a.etapa = 'cancelado') as articulos_cancelados,
  (select jsonb_object_agg(e.etapa, e.n) from (
      select a.etapa::text as etapa, count(*) as n
      from public.articulos a where a.solicitud_id = s.id group by a.etapa
   ) e) as resumen_etapas
from public.solicitudes s
left join public.perfiles p on p.id = s.solicitante_id
left join public.areas ar on ar.id = s.area_id
left join public.centros_costo cc on cc.id = s.centro_costo_id;

-- Costos comprados (gestionados aquí) por área/centro de costo/mes/moneda.
create or replace view public.v_costos_gestionados
with (security_invoker = true) as
select
  'gestionada'::text as fuente,
  date_trunc('month', c.fecha_compra)::date as mes,
  coalesce(a.area_id, s.area_id) as area_id, ar.nombre as area_nombre,
  coalesce(a.centro_costo_id, s.centro_costo_id) as centro_costo_id,
  cc.codigo as centro_costo_codigo,
  c.moneda,
  c.total, c.fecha_compra, c.id as compra_id, a.id as articulo_id,
  a.nombre as articulo_nombre, pr.nombre as proveedor_nombre,
  s.numero as solicitud_numero
from public.compras c
join public.articulos a on a.id = c.articulo_id
join public.solicitudes s on s.id = a.solicitud_id
left join public.areas ar on ar.id = coalesce(a.area_id, s.area_id)
left join public.centros_costo cc on cc.id = coalesce(a.centro_costo_id, s.centro_costo_id)
left join public.proveedores pr on pr.id = c.proveedor_id
where a.etapa <> 'cancelado';

-- Costos externos (una sola vez por referencia única; importe null = sin información).
create or replace view public.v_costos_externos
with (security_invoker = true) as
select
  ce.tipo::text as fuente,
  date_trunc('month', ce.fecha_compra)::date as mes,
  ce.area_id, ar.nombre as area_nombre,
  ce.centro_costo_id, cc.codigo as centro_costo_codigo,
  ce.moneda, ce.importe_total as total, ce.fecha_compra,
  ce.id as compra_externa_id, ce.referencia, ce.articulo_texto,
  coalesce(pr.nombre, ce.proveedor_texto) as proveedor_nombre,
  ce.registrada_corporativo, ce.solicitud_id
from public.compras_externas ce
left join public.areas ar on ar.id = ce.area_id
left join public.centros_costo cc on cc.id = ce.centro_costo_id
left join public.proveedores pr on pr.id = ce.proveedor_id;

-- Resumen para el tablero: SECURITY INVOKER a propósito, para que las
-- vistas (security_invoker) apliquen la RLS del usuario que consulta.
-- Cuenta sobre TODO el conjunto autorizado, no solo la página visible.
create or replace function public.fn_resumen_tablero()
returns jsonb language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'pendientes', (select count(*) from public.v_articulos v
                   where v.etapa in ('solicitado','en_cotizacion','cotizado')),
    'por_aprobar', (select count(*) from public.v_articulos v
                    where v.estado_aprobacion = 'pendiente'),
    'atrasados', (select count(*) from public.v_articulos v
                  where coalesce(v.dias_atraso, 0) > 0),
    'por_llegar', (select count(*) from public.v_articulos v
                   where v.etapa in ('comprado','en_transito','recibido_parcial')),
    'en_almacen', (select count(*) from public.v_articulos v
                   where coalesce(v.disponible_almacen,0) > 0),
    'entregados', (select count(*) from public.v_articulos v
                   where coalesce(v.entregado_neto,0) > 0),
    'novedades_abiertas', (select count(*) from public.novedades n
                           where n.estado <> 'resuelta')
  );
$$;
-- ============================================================
-- 0011_importacion_csv.sql
-- Zona de revisión (staging) para el CSV histórico, exclusiva del
-- administrador. Conserva el valor original, registro de origen y lote.
-- Los estados históricos se normalizan SOLO con un mapeo explícito
-- revisable; nunca se inventan fechas, costos, solicitantes ni imágenes.
-- Las filas importadas quedan como HISTÓRICO consultable; no entran a
-- saldos físicos ni a totales de costos (sus costos son "sin información").
-- Si el área quiere seguir gestionando un renglón vigente, se convierte
-- explícitamente en una solicitud nueva (sin fabricar historial).
-- ============================================================

create table if not exists public.importacion_lotes (
  id            uuid primary key default gen_random_uuid(),
  nombre_archivo text not null,
  hash_sha256   text not null unique,     -- repetir el mismo archivo no duplica
  total_filas   integer not null default 0,
  estado        public.estado_lote_importacion not null default 'en_revision',
  creado_por    uuid not null default auth.uid() references public.perfiles (id),
  creado_en     timestamptz not null default now()
);

create table if not exists public.importacion_filas (
  id            uuid primary key default gen_random_uuid(),
  lote_id       uuid not null references public.importacion_lotes (id) on delete cascade,
  numero_fila   integer not null,          -- número de registro lógico en el archivo
  datos_originales jsonb not null,         -- las 25 columnas tal cual (evidencia)
  fecha_texto   text,
  fecha_interpretada date,
  fecha_confiable boolean not null default false,
  nombre_articulo text,
  cantidad_texto text,
  cantidad      numeric(12,2),
  descripcion   text,
  justificacion text,
  observacion_compras text,
  imagen_texto  text,                      -- "Imagen", "Se envía por correo", etc. NO es un archivo
  estatus_original text,
  extra_notas   text,                      -- columnas sin encabezado útil
  problemas     text[] not null default '{}',
  estado_fila   public.estado_fila_importacion not null default 'pendiente',
  area_id       uuid references public.areas (id),
  centro_costo_id uuid references public.centros_costo (id),
  solicitud_id  uuid references public.solicitudes (id),
  articulo_id   uuid references public.articulos (id),
  revisado_por  uuid references public.perfiles (id),
  importado_en  timestamptz,
  version       integer not null default 1,
  unique (lote_id, numero_fila)
);

create index if not exists imp_filas_lote_idx on public.importacion_filas (lote_id, estado_fila);

-- Mapeo explícito y revisable de estados históricos (solo presentación).
create table if not exists public.importacion_mapeo_estados (
  texto_original text primary key,
  etiqueta_normalizada text not null,
  confirmado boolean not null default false,
  actualizado_por uuid,
  actualizado_en timestamptz not null default now()
);

insert into public.importacion_mapeo_estados (texto_original, etiqueta_normalizada, confirmado) values
  ('ENTREGADO', 'Entregado', false),
  ('Entregado', 'Entregado', false),
  ('ALMACÉN', 'En almacén', false),
  ('En Almacen', 'En almacén', false),
  ('EN COTIZACIÓN', 'En cotización', false),
  ('En cotización', 'En cotización', false),
  ('Pte. Por llegar', 'Pendiente por llegar', false)
on conflict (texto_original) do nothing;

do $$ begin
  alter table public.articulos
    add constraint articulos_fila_import_fk
    foreign key (fila_importacion_id) references public.importacion_filas (id);
exception when duplicate_object then null; end $$;

alter table public.importacion_lotes enable row level security;
alter table public.importacion_filas enable row level security;
alter table public.importacion_mapeo_estados enable row level security;

drop policy if exists imp_lotes_sel on public.importacion_lotes;
create policy imp_lotes_sel on public.importacion_lotes for select to authenticated
  using (app.es_admin());
drop policy if exists imp_filas_sel on public.importacion_filas;
create policy imp_filas_sel on public.importacion_filas for select to authenticated
  using (app.es_gestor());  -- Compras consulta el histórico; solo admin lo administra
drop policy if exists imp_mapeo_sel on public.importacion_mapeo_estados;
create policy imp_mapeo_sel on public.importacion_mapeo_estados for select to authenticated
  using (app.es_gestor());
-- Escrituras: únicamente RPCs de administrador.

-- ------------------------------------------------------------
-- Utilidades de interpretación (el servidor revalida lo que envíe el cliente)
-- ------------------------------------------------------------
create or replace function app.interpretar_fecha_csv(p_texto text)
returns table (fecha date, confiable boolean, problema text)
language plpgsql immutable
set search_path = ''
as $$
declare v text; d int; m int; a int;
begin
  v := nullif(btrim(coalesce(p_texto,'')), '');
  if v is null then
    fecha := null; confiable := false; problema := 'fecha ausente';
    return next; return;
  end if;
  -- Formato esperado dd/mm/aaaa estricto.
  if v ~ '^\d{1,2}/\d{1,2}/\d{4}$' then
    d := split_part(v,'/',1)::int; m := split_part(v,'/',2)::int; a := split_part(v,'/',3)::int;
    begin
      fecha := make_date(a, m, d); confiable := true; problema := null;
    exception when others then
      fecha := null; confiable := false; problema := 'fecha inválida: ' || v;
    end;
    return next; return;
  end if;
  -- Formas ambiguas o rotas conocidas: NO se inventa el año ni se corrige sola.
  fecha := null; confiable := false; problema := 'fecha ambigua o mal escrita: ' || v;
  return next;
end $$;

create or replace function app.interpretar_cantidad_csv(p_texto text)
returns table (cantidad numeric, problema text)
language plpgsql immutable
set search_path = ''
as $$
declare v text;
begin
  v := nullif(btrim(coalesce(p_texto,'')), '');
  if v is null then
    cantidad := null; problema := 'cantidad ausente'; return next; return;
  end if;
  if v ~ '^\d{1,7}([.,]\d{1,2})?$' then
    cantidad := replace(v, ',', '.')::numeric;
    if cantidad <= 0 then
      cantidad := null; problema := 'cantidad no positiva: ' || v;
    else
      problema := null;
    end if;
    return next; return;
  end if;
  -- "25 metros" y similares: cantidad con texto; queda para revisión humana.
  cantidad := null; problema := 'cantidad no numérica: ' || v;
  return next;
end $$;

-- ------------------------------------------------------------
-- RPCs de carga y revisión (solo administrador)
-- ------------------------------------------------------------
create or replace function public.fn_importacion_crear_lote(
  p_nombre text, p_hash text, p_total integer, p_op uuid
) returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare v_id uuid; v_res jsonb; v_existente record;
begin
  v_res := app.op_existente(p_op);
  if v_res is not null then return v_res; end if;

  if not app.es_admin() then
    raise exception 'Solo el administrador carga el CSV histórico.' using errcode = '42501';
  end if;
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Hash del archivo inválido.';
  end if;
  select id, nombre_archivo, creado_en into v_existente
  from public.importacion_lotes where hash_sha256 = p_hash;
  if found then
    raise exception 'Este archivo ya fue cargado el % como lote % (no se duplica).',
      to_char(v_existente.creado_en at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI'),
      v_existente.id;
  end if;

  insert into public.importacion_lotes (nombre_archivo, hash_sha256, total_filas)
  values (left(coalesce(p_nombre,'archivo.csv'),200), p_hash, coalesce(p_total,0))
  returning id into v_id;

  perform app.auditar('importacion_lotes', v_id::text, 'LOTE_CREADO',
    null, jsonb_build_object('archivo', p_nombre, 'filas', p_total), null);

  v_res := jsonb_build_object('ok', true, 'lote_id', v_id);
  perform app.op_guardar(p_op, 'fn_importacion_crear_lote', v_res);
  return v_res;
end $$;

-- Inserta filas en bloque. p_filas: [{numero_fila, datos_originales, fecha_texto,
-- nombre, cantidad_texto, descripcion, justificacion, observacion_compras,
-- imagen_texto, estatus_original, extra_notas}, ...]
create or replace function public.fn_importacion_insertar_filas(
  p_lote uuid, p_filas jsonb
) returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare
  v_lote public.importacion_lotes%rowtype;
  f jsonb;
  v_fecha record; v_cant record;
  v_problemas text[];
  v_nombre text;
  v_n integer := 0;
begin
  if not app.es_admin() then
    raise exception 'Solo el administrador carga el CSV histórico.' using errcode = '42501';
  end if;
  select * into v_lote from public.importacion_lotes where id = p_lote for update;
  if not found then raise exception 'Lote no encontrado.'; end if;
  if v_lote.estado <> 'en_revision' then
    raise exception 'El lote ya fue procesado.';
  end if;
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' then
    raise exception 'Formato de filas inválido.';
  end if;

  for f in select * from jsonb_array_elements(p_filas) loop
    v_problemas := '{}';
    v_nombre := nullif(btrim(coalesce(f ->> 'nombre','')), '');
    if v_nombre is null then
      v_problemas := v_problemas || 'sin nombre de artículo';
    end if;

    select * into v_fecha from app.interpretar_fecha_csv(f ->> 'fecha_texto');
    if v_fecha.problema is not null then v_problemas := v_problemas || v_fecha.problema; end if;

    select * into v_cant from app.interpretar_cantidad_csv(f ->> 'cantidad_texto');
    if v_cant.problema is not null then v_problemas := v_problemas || v_cant.problema; end if;

    if nullif(btrim(coalesce(f ->> 'estatus_original','')),'') is null then
      v_problemas := v_problemas || 'estatus vacío';
    end if;
    if (f ->> 'imagen_texto') is not null and btrim(f ->> 'imagen_texto') <> '' then
      v_problemas := v_problemas || 'la columna Imagen trae texto, no un archivo';
    end if;

    insert into public.importacion_filas (
      lote_id, numero_fila, datos_originales, fecha_texto, fecha_interpretada,
      fecha_confiable, nombre_articulo, cantidad_texto, cantidad, descripcion,
      justificacion, observacion_compras, imagen_texto, estatus_original,
      extra_notas, problemas
    ) values (
      p_lote,
      (f ->> 'numero_fila')::integer,
      coalesce(f -> 'datos_originales', '{}'::jsonb),
      nullif(btrim(coalesce(f ->> 'fecha_texto','')),''),
      v_fecha.fecha,
      v_fecha.confiable,
      v_nombre,
      nullif(btrim(coalesce(f ->> 'cantidad_texto','')),''),
      v_cant.cantidad,
      nullif(btrim(coalesce(f ->> 'descripcion','')),''),
      nullif(btrim(coalesce(f ->> 'justificacion','')),''),
      nullif(btrim(coalesce(f ->> 'observacion_compras','')),''),
      nullif(btrim(coalesce(f ->> 'imagen_texto','')),''),
      nullif(btrim(coalesce(f ->> 'estatus_original','')),''),
      nullif(btrim(coalesce(f ->> 'extra_notas','')),''),
      v_problemas
    )
    on conflict (lote_id, numero_fila) do nothing;
    v_n := v_n + 1;
  end loop;

  update public.importacion_lotes set total_filas = greatest(total_filas, v_n) where id = p_lote;
  return jsonb_build_object('ok', true, 'procesadas', v_n);
end $$;

create or replace function public.fn_importacion_revisar_fila(
  p_fila uuid, p_accion text, p_area uuid, p_centro_costo uuid, p_version integer
) returns void language plpgsql security definer
set search_path = ''
as $$
declare v_f public.importacion_filas%rowtype;
begin
  if not app.es_admin() then
    raise exception 'Solo el administrador revisa filas del histórico.' using errcode = '42501';
  end if;
  if p_accion not in ('aprobar','rechazar','pendiente') then
    raise exception 'Acción inválida.';
  end if;
  select * into v_f from public.importacion_filas where id = p_fila for update;
  if not found then raise exception 'Fila no encontrada.'; end if;
  if v_f.version <> p_version then
    raise exception 'La fila fue modificada en otra sesión. Recarga e intenta de nuevo.' using errcode = '40001';
  end if;
  if v_f.estado_fila = 'importada' then
    raise exception 'La fila ya fue importada.';
  end if;
  if p_accion = 'aprobar' and v_f.nombre_articulo is null then
    raise exception 'No se aprueba una fila sin nombre de artículo.';
  end if;

  update public.importacion_filas set
    estado_fila = case p_accion when 'aprobar' then 'aprobada'
                                when 'rechazar' then 'rechazada'
                                else 'pendiente' end,
    area_id = coalesce(p_area, area_id),
    centro_costo_id = coalesce(p_centro_costo, centro_costo_id),
    revisado_por = auth.uid(),
    version = version + 1
  where id = p_fila;
end $$;

-- Confirmación del lote: solo filas APROBADAS pasan a "importada" (histórico oficial).
-- Reejecutar no duplica: las ya importadas se omiten.
create or replace function public.fn_importacion_confirmar(
  p_lote uuid, p_op uuid
) returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare
  v_lote public.importacion_lotes%rowtype;
  v_importadas integer; v_aprobadas integer; v_rechazadas integer; v_pendientes integer;
  v_res jsonb;
begin
  v_res := app.op_existente(p_op);
  if v_res is not null then return v_res; end if;

  if not app.es_admin() then
    raise exception 'Solo el administrador confirma la importación.' using errcode = '42501';
  end if;
  select * into v_lote from public.importacion_lotes where id = p_lote for update;
  if not found then raise exception 'Lote no encontrado.'; end if;

  update public.importacion_filas
     set estado_fila = 'importada', importado_en = now(), version = version + 1
   where lote_id = p_lote and estado_fila = 'aprobada';
  get diagnostics v_importadas = row_count;

  select count(*) filter (where estado_fila = 'importada'),
         count(*) filter (where estado_fila = 'rechazada'),
         count(*) filter (where estado_fila = 'pendiente')
    into v_aprobadas, v_rechazadas, v_pendientes
  from public.importacion_filas where lote_id = p_lote;

  if v_pendientes = 0 then
    update public.importacion_lotes set estado = 'procesado' where id = p_lote;
  end if;

  perform app.auditar('importacion_lotes', p_lote::text, 'CONFIRMACION',
    null, jsonb_build_object('importadas_ahora', v_importadas,
      'total_importadas', v_aprobadas, 'rechazadas', v_rechazadas,
      'pendientes', v_pendientes), null);

  -- Conciliación: leídas vs aprobadas/rechazadas/importadas.
  v_res := jsonb_build_object('ok', true, 'importadas_ahora', v_importadas,
    'total_importadas', v_aprobadas, 'rechazadas', v_rechazadas,
    'pendientes', v_pendientes, 'total_lote', v_lote.total_filas);
  perform app.op_guardar(p_op, 'fn_importacion_confirmar', v_res);
  return v_res;
end $$;

-- Convertir una fila vigente en una SOLICITUD NUEVA (sin fabricar historial).
create or replace function public.fn_importacion_convertir_en_solicitud(
  p_fila uuid, p_semana date, p_op uuid
) returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare
  v_f public.importacion_filas%rowtype;
  v_sol_id uuid; v_art_id uuid; v_numero text;
  v_res jsonb;
begin
  v_res := app.op_existente(p_op);
  if v_res is not null then return v_res; end if;

  if not app.es_admin() then
    raise exception 'Solo el administrador convierte filas históricas.' using errcode = '42501';
  end if;
  select * into v_f from public.importacion_filas where id = p_fila for update;
  if not found then raise exception 'Fila no encontrada.'; end if;
  if v_f.articulo_id is not null then
    raise exception 'Esta fila ya fue convertida en solicitud.';
  end if;
  if v_f.nombre_articulo is null then
    raise exception 'La fila no tiene nombre de artículo.';
  end if;
  if v_f.cantidad is null then
    raise exception 'La cantidad de esta fila no es interpretable (%); corrígela en la revisión antes de convertir.',
      coalesce(v_f.cantidad_texto, 'vacía');
  end if;
  if v_f.area_id is null or v_f.centro_costo_id is null then
    raise exception 'Asigna área y centro de costo en la revisión antes de convertir.';
  end if;
  if p_semana is null or extract(isodow from p_semana) <> 1 then
    raise exception 'Indica la semana objetivo (lunes).';
  end if;

  perform app.modo_servidor();
  insert into public.solicitudes (solicitante_id, area_id, centro_costo_id, estado,
    justificacion, semana_lunes, fecha_declarada, origen)
  values (auth.uid(), v_f.area_id, v_f.centro_costo_id, 'borrador',
    coalesce(v_f.justificacion, 'Regularización de renglón del formato histórico de compras'),
    p_semana, case when v_f.fecha_confiable then v_f.fecha_interpretada else null end, 'importacion_csv')
  returning id, numero into v_sol_id, v_numero;

  insert into public.articulos (solicitud_id, nombre, descripcion, cantidad, unidad,
    justificacion, etapa, origen, estatus_historico, fila_importacion_id)
  values (v_sol_id, v_f.nombre_articulo, coalesce(v_f.descripcion,'(sin descripción en el histórico)'),
    v_f.cantidad, 'unidad', v_f.justificacion, 'borrador', 'importacion_csv',
    v_f.estatus_original, p_fila)
  returning id into v_art_id;

  update public.importacion_filas
     set solicitud_id = v_sol_id, articulo_id = v_art_id, version = version + 1
   where id = p_fila;

  perform app.auditar('importacion_filas', p_fila::text, 'CONVERSION_A_SOLICITUD',
    null, jsonb_build_object('solicitud', v_numero), null);

  v_res := jsonb_build_object('ok', true, 'solicitud_id', v_sol_id, 'numero', v_numero);
  perform app.op_guardar(p_op, 'fn_importacion_convertir_en_solicitud', v_res);
  return v_res;
end $$;

create or replace function public.fn_importacion_mapear_estado(
  p_texto text, p_etiqueta text, p_confirmado boolean
) returns void language plpgsql security definer
set search_path = ''
as $$
begin
  if not app.es_admin() then
    raise exception 'Solo el administrador gestiona el mapeo de estados.' using errcode = '42501';
  end if;
  insert into public.importacion_mapeo_estados (texto_original, etiqueta_normalizada, confirmado, actualizado_por)
  values (btrim(p_texto), btrim(p_etiqueta), coalesce(p_confirmado,false), auth.uid())
  on conflict (texto_original) do update
    set etiqueta_normalizada = excluded.etiqueta_normalizada,
        confirmado = excluded.confirmado,
        actualizado_por = excluded.actualizado_por,
        actualizado_en = now();
end $$;

-- Histórico consultable (Compras y administrador).
create or replace view public.v_historico_csv
with (security_invoker = true) as
select
  f.id, f.lote_id, l.nombre_archivo, f.numero_fila,
  f.fecha_texto, f.fecha_interpretada, f.fecha_confiable,
  f.nombre_articulo, f.cantidad_texto, f.cantidad,
  f.descripcion, f.justificacion, f.observacion_compras,
  f.imagen_texto, f.estatus_original,
  case when m.confirmado then m.etiqueta_normalizada else null end as estatus_normalizado,
  f.extra_notas, f.problemas, f.estado_fila,
  f.area_id, a.nombre as area_nombre,
  f.centro_costo_id, cc.codigo as centro_costo_codigo,
  f.solicitud_id, f.articulo_id, f.importado_en, f.version,
  f.datos_originales
from public.importacion_filas f
join public.importacion_lotes l on l.id = f.lote_id
left join public.importacion_mapeo_estados m on m.texto_original = f.estatus_original
left join public.areas a on a.id = f.area_id
left join public.centros_costo cc on cc.id = f.centro_costo_id;
-- ============================================================
-- 0012_endurecimiento.sql
-- Privilegios mínimos: anon no toca nada; authenticated solo lo que
-- las políticas permiten; escrituras sensibles únicamente por RPC.
-- (RLS ya está activo en todas las tablas; esto reduce además la
-- superficie de API: sin GRANT no hay operación posible.)
-- ============================================================

-- anon: ninguna operación sobre datos (el registro/login lo hace Auth, no la API de datos).
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

-- Punto de partida limpio para authenticated.
revoke all on all tables in schema public from authenticated;

-- Lectura general (las políticas RLS filtran filas).
grant select on
  public.configuracion, public.perfiles, public.perfil_roles,
  public.areas, public.centros_costo, public.proveedores,
  public.solicitudes, public.articulos, public.etapa_transiciones,
  public.cotizaciones, public.aprobaciones, public.compras,
  public.compra_fechas_estimadas, public.movimientos, public.novedades,
  public.adjuntos, public.compras_externas, public.auditoria,
  public.importacion_lotes, public.importacion_filas, public.importacion_mapeo_estados,
  public.v_usuarios_admin, public.v_articulos, public.v_solicitudes,
  public.v_costos_gestionados, public.v_costos_externos, public.v_historico_csv
to authenticated;

-- Escrituras directas permitidas (siempre bajo RLS + disparadores de protección):
grant insert, update, delete on public.areas, public.centros_costo, public.proveedores to authenticated;
grant insert, update, delete on public.solicitudes to authenticated;
grant insert, update, delete on public.articulos to authenticated;
grant insert, update, delete on public.cotizaciones to authenticated;
grant insert on public.novedades to authenticated;
-- Todo lo demás (perfiles, roles, aprobaciones, compras, movimientos, adjuntos,
-- compras externas, auditoría, operaciones, importación) SOLO mediante RPC.

-- Secuencias usadas por inserciones directas.
grant usage on sequence public.solicitudes_consecutivo_seq to authenticated;
grant usage on sequence public.compras_externas_consecutivo_seq to authenticated;

-- Esquema auxiliar: utilizable, no modificable.
grant usage on schema app to authenticated;
revoke create on schema app from public;

-- Funciones del esquema app: por defecto PostgreSQL concede EXECUTE a PUBLIC;
-- se retira y se concede solo a authenticated (las políticas y disparadores
-- se ejecutan con el rol del usuario que consulta). Las funciones de contexto
-- privilegiado quedan fuera del alcance de authenticated.
revoke all on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated;
revoke all on function app.modo_servidor() from authenticated;
revoke all on function app.fijar_motivo(text) from authenticated;
revoke all on function app.auditar(text,text,text,jsonb,jsonb,text) from authenticated;
revoke all on function app.op_guardar(uuid,text,jsonb) from authenticated;
revoke all on function app.op_existente(uuid) from authenticated;
alter default privileges in schema app revoke all on functions from public;

-- Las funciones públicas (RPC) requieren sesión; cada una revalida permisos.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as firma
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'fn\_%' escape '\'
  loop
    execute format('revoke all on function %s from public, anon', f.firma);
    execute format('grant execute on function %s to authenticated', f.firma);
  end loop;
end $$;

-- Garantía adicional: nadie (ni siquiera con GRANT accidental futuro) edita
-- auditoría ni operaciones por la API: sin políticas de escritura y sin GRANT.
revoke insert, update, delete on public.auditoria from authenticated;
revoke all on public.operaciones from authenticated;

-- Evitar que futuros objetos hereden permisos amplios por defecto.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon;
-- Fin de setup_completo.sql (0001-0012, regenerado 2026-10-21)
