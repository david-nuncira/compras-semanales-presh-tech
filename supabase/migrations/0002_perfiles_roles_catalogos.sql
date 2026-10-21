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
