-- ============================================================
-- setup_mejora_v2.sql = 0014 + 0015 + 0016 concatenadas (generado 2026-10-26).
-- REQUISITO: haber ejecutado ANTES, en una consulta aparte, 0013_valores_nuevos.sql
-- y el diagnóstico previo con veredicto LISTO PARA MIGRAR.
-- ============================================================
-- ============================================================
-- 0014_estructura_aprobacion_calendario.sql · Mejora v2
--
-- Requiere 0013 ya ejecutada (en otra consulta).
-- ADITIVA Y CONSERVADORA: no elimina columnas ni filas. Los registros
-- previos se marcan con flujo = 'anterior' (llegaron a Compras sin
-- aprobación del jefe) y NO se les crea ninguna aprobación ficticia.
--
-- Contenido:
--   1. Jerarquía: jefe y ruta superior por área.
--   2. Áreas ↔ centros de costo permitidos.
--   3. Catálogos: unidades de medida, categorías y ventanas de recepción.
--   4. Calendario de recepción (configuración, días no hábiles).
--   5. Columnas nuevas en solicitudes y artículos + migración de datos.
--   6. Versiones, aprobaciones del jefe y devoluciones solicitadas.
--   7. Notificaciones, cola de correos y bitácora de liberaciones.
--   8. Permisos (helpers), RLS y disparadores de reglas.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Jerarquía por área
-- ------------------------------------------------------------
alter table public.areas add column if not exists jefe_id uuid references public.perfiles (id);
alter table public.areas add column if not exists aprobador_superior_id uuid references public.perfiles (id);
alter table public.areas add column if not exists descripcion text;

comment on column public.areas.jefe_id is 'Jefe de área: aprueba las solicitudes del área antes de Compras.';
comment on column public.areas.aprobador_superior_id is 'Ruta superior: aprueba las solicitudes hechas por el propio jefe del área.';

do $$ begin
  alter table public.areas add constraint areas_superior_distinto
    check (aprobador_superior_id is null or jefe_id is null or aprobador_superior_id <> jefe_id);
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------
-- 2. Centros de costo permitidos por área
-- ------------------------------------------------------------
create table if not exists public.area_centros_costo (
  area_id         uuid not null references public.areas (id),
  centro_costo_id uuid not null references public.centros_costo (id),
  activo          boolean not null default true,
  creado_en       timestamptz not null default now(),
  creado_por      uuid default auth.uid(),
  primary key (area_id, centro_costo_id)
);
create index if not exists acc_cc_idx on public.area_centros_costo (centro_costo_id);

-- ------------------------------------------------------------
-- 3. Catálogos administrables
-- ------------------------------------------------------------
create table if not exists public.unidades_medida (
  id        uuid primary key default gen_random_uuid(),
  nombre    text not null,
  abreviatura text,
  activo    boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  version   integer not null default 1,
  constraint unidad_nombre_corto check (char_length(btrim(nombre)) between 1 and 40)
);
create unique index if not exists unidades_nombre_unico on public.unidades_medida (lower(nombre));

-- Unidades genéricas iniciales (editables y desactivables desde la app).
insert into public.unidades_medida (nombre, abreviatura) values
  ('Unidad','und'), ('Par','par'), ('Caja','caja'), ('Paquete','paq'),
  ('Resma','resma'), ('Rollo','rollo'), ('Juego','jgo'), ('Kit','kit'),
  ('Bolsa','bolsa'), ('Frasco','fco'), ('Metro','m'), ('Metro cuadrado','m²'),
  ('Litro','L'), ('Galón','gal'), ('Kilogramo','kg'), ('Gramo','g')
on conflict do nothing;

create table if not exists public.categorias_solicitud (
  id        uuid primary key default gen_random_uuid(),
  nombre    text not null unique,
  descripcion text,
  activo    boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  version   integer not null default 1
);

-- Ventanas especiales: p. ej. "papelería de noviembre": se solicita entre
-- abre_en y cierra_en y Compras la recibe en fecha_recepcion.
create table if not exists public.ventanas_recepcion (
  id              uuid primary key default gen_random_uuid(),
  categoria_id    uuid not null references public.categorias_solicitud (id),
  nombre          text not null,
  abre_en         date not null,
  cierra_en       date not null,
  fecha_recepcion date not null,
  activo          boolean not null default true,
  creado_en       timestamptz not null default now(),
  creado_por      uuid default auth.uid(),
  constraint ventana_fechas check (cierra_en >= abre_en and fecha_recepcion >= abre_en)
);
create index if not exists ventanas_categoria_idx on public.ventanas_recepcion (categoria_id, fecha_recepcion);

-- ------------------------------------------------------------
-- 4. Calendario de recepción de Compras
-- ------------------------------------------------------------
create table if not exists public.calendario_config (
  id                  boolean primary key default true check (id),   -- una sola fila
  activo              boolean not null default false,
  dias_recepcion      smallint[] not null default '{}',   -- ISO: 1=lunes … 7=domingo
  dias_no_laborables  smallint[] not null default '{}',   -- p. ej. {6,7}
  mover_si_no_habil   boolean not null default true,      -- festivo → siguiente día hábil
  hora_liberacion     time,                               -- hora en que se libera el lote ese día
  corte_dias_antes    smallint not null default 0,        -- días antes de la recepción
  hora_corte          time,                               -- hora límite para aprobar y entrar al ciclo
  politica_post_corte text not null default 'siguiente_ciclo',
  politica_validada   boolean not null default false,     -- validación formal del área
  actualizado_en      timestamptz not null default now(),
  actualizado_por     uuid,
  constraint politica_valida check (politica_post_corte in ('siguiente_ciclo','mismo_ciclo')),
  constraint corte_rango check (corte_dias_antes between 0 and 14)
);
insert into public.calendario_config (id) values (true) on conflict (id) do nothing;

comment on table public.calendario_config is
  'Mientras activo = false, una solicitud aprobada se libera a Compras de inmediato (equivale al comportamiento previo, con aprobación del jefe).';

create table if not exists public.calendario_no_habiles (
  fecha       date primary key,
  descripcion text not null,
  creado_en   timestamptz not null default now(),
  creado_por  uuid default auth.uid()
);

-- ------------------------------------------------------------
-- 5. Columnas nuevas en solicitudes y artículos
-- ------------------------------------------------------------
alter table public.solicitudes add column if not exists flujo text;
alter table public.solicitudes add column if not exists categoria_id uuid references public.categorias_solicitud (id);
alter table public.solicitudes add column if not exists es_extraordinaria boolean not null default false;
alter table public.solicitudes add column if not exists motivo_extraordinaria text;
alter table public.solicitudes add column if not exists aprobador_jefe_id uuid references public.perfiles (id);
alter table public.solicitudes add column if not exists ultimo_envio_en timestamptz;
alter table public.solicitudes add column if not exists aprobado_en timestamptz;
alter table public.solicitudes add column if not exists fecha_programada_recepcion date;
alter table public.solicitudes add column if not exists liberacion_programada_en timestamptz;
alter table public.solicitudes add column if not exists cierre_ciclo_en timestamptz;
alter table public.solicitudes add column if not exists origen_programacion text;
alter table public.solicitudes add column if not exists recibida_compras_en timestamptz;
alter table public.solicitudes add column if not exists aviso_compras_en timestamptz;
alter table public.solicitudes add column if not exists version_contenido integer not null default 0;

comment on column public.solicitudes.creado_en is 'Fecha REAL de creación (servidor). Nunca se reemplaza por el lunes de recepción.';
comment on column public.solicitudes.enviado_en is 'Primer envío. Flujo nuevo: envío a aprobación. Flujo anterior: envío directo a Compras.';
comment on column public.solicitudes.ultimo_envio_en is 'Último envío a aprobación (reenvíos tras corrección).';
comment on column public.solicitudes.semana_lunes is 'Semana objetivo elegida por el solicitante (lunes).';
comment on column public.solicitudes.fecha_programada_recepcion is 'Fecha en que Compras recibirá la solicitud según el calendario.';
comment on column public.solicitudes.recibida_compras_en is 'Recepción EFECTIVA por Compras. Base para medir los tiempos de gestión.';

-- Migración de datos: solicitudes YA ENVIADAS antes de esta versión.
-- Llegaron directo a Compras al enviarse (así funcionaba el flujo anterior):
-- su recepción efectiva es su fecha de envío. No se crea aprobación alguna.
-- El contexto de servidor se activa SOLO dentro de este bloque (local a la
-- transacción): pasa los disparadores de protección, queda auditado con
-- actor "Sistema" y no deja las protecciones apagadas en la sesión.
do $$
begin
  perform set_config('app.bypass', '1', true);
  perform set_config('app.motivo', 'Migración 0014: aprobación previa del jefe y calendario', true);
  update public.solicitudes
     set flujo = 'anterior',
         recibida_compras_en = coalesce(recibida_compras_en, enviado_en),
         ultimo_envio_en = coalesce(ultimo_envio_en, enviado_en)
   where flujo is null and enviado_en is not null;
  -- Borradores nunca enviados: seguirán el flujo nuevo cuando se envíen.
  update public.solicitudes set flujo = 'aprobacion_previa' where flujo is null;
  perform set_config('app.bypass', '', true);
  perform set_config('app.motivo', '', true);
end $$;

alter table public.solicitudes alter column flujo set default 'aprobacion_previa';
alter table public.solicitudes alter column flujo set not null;
do $$ begin
  alter table public.solicitudes add constraint solicitudes_flujo_valido
    check (flujo in ('anterior','aprobacion_previa'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.solicitudes add constraint solicitudes_extra_motivo
    check (not es_extraordinaria or char_length(btrim(coalesce(motivo_extraordinaria,''))) >= 10);
exception when duplicate_object then null; end $$;

create index if not exists solicitudes_estado_lib_idx
  on public.solicitudes (liberacion_programada_en) where estado = 'programada';
create index if not exists solicitudes_aprobador_jefe_idx on public.solicitudes (aprobador_jefe_id);
create index if not exists solicitudes_recibida_idx on public.solicitudes (recibida_compras_en);

alter table public.articulos add column if not exists enlace_referencia text;
alter table public.articulos add column if not exists proveedor_sugerido text;
comment on column public.articulos.enlace_referencia is 'Enlace de compra o referencia. NO reemplaza la descripción técnica.';

-- ------------------------------------------------------------
-- 6. Versiones, aprobación del jefe y devoluciones solicitadas
-- ------------------------------------------------------------
create table if not exists public.solicitud_versiones (
  id           uuid primary key default gen_random_uuid(),
  solicitud_id uuid not null references public.solicitudes (id) on delete cascade,
  version      integer not null,
  contenido    jsonb not null,       -- cabecera + artículos tal como se enviaron
  motivo       text,
  enviado_por  uuid not null references public.perfiles (id),
  enviado_en   timestamptz not null default now(),
  unique (solicitud_id, version)
);

create table if not exists public.solicitud_aprobaciones (
  id           uuid primary key default gen_random_uuid(),
  solicitud_id uuid not null references public.solicitudes (id) on delete cascade,
  version      integer not null,
  aprobador_id uuid not null references public.perfiles (id),
  ruta         text not null default 'jefe_area',   -- jefe_area | ruta_superior
  estado       text not null default 'pendiente',
  es_vigente   boolean not null default true,
  motivo       text,
  solicitada_en timestamptz not null default now(),
  decidido_en  timestamptz,
  decidido_por uuid references public.perfiles (id),
  constraint aprob_estado check (estado in ('pendiente','aprobada','devuelta','rechazada','reemplazada','anulada')),
  constraint aprob_ruta check (ruta in ('jefe_area','ruta_superior')),
  constraint aprob_motivo check (estado not in ('devuelta','rechazada') or char_length(btrim(coalesce(motivo,''))) >= 5)
);
create unique index if not exists sol_aprob_vigente_unica
  on public.solicitud_aprobaciones (solicitud_id) where es_vigente;
create index if not exists sol_aprob_aprobador_idx
  on public.solicitud_aprobaciones (aprobador_id, estado);

create table if not exists public.solicitud_devoluciones (
  id           uuid primary key default gen_random_uuid(),
  solicitud_id uuid not null references public.solicitudes (id) on delete cascade,
  iniciada_por uuid not null references public.perfiles (id),
  motivo       text not null,
  etapa        text not null,               -- estado de la solicitud al pedirla
  estado       text not null default 'pendiente',
  resuelta_por uuid references public.perfiles (id),
  resuelta_en  timestamptz,
  respuesta    text,
  creado_en    timestamptz not null default now(),
  constraint dev_estado check (estado in ('pendiente','autorizada','negada','aplicada_directa')),
  constraint dev_motivo check (char_length(btrim(motivo)) >= 5)
);
create unique index if not exists sol_dev_pendiente_unica
  on public.solicitud_devoluciones (solicitud_id) where estado = 'pendiente';

-- ------------------------------------------------------------
-- 7. Notificaciones, cola de correos y bitácora de liberaciones
-- ------------------------------------------------------------
create table if not exists public.notificaciones (
  id             bigint generated always as identity primary key,
  destinatario_id uuid not null references public.perfiles (id) on delete cascade,
  tipo           text not null,
  titulo         text not null,
  cuerpo         text,
  enlace         text,
  solicitud_id   uuid references public.solicitudes (id) on delete cascade,
  evento_en      timestamptz not null,       -- fecha REAL del evento
  creado_en      timestamptz not null default now(),
  leida_en       timestamptz,
  clave_dedupe   text unique
);
create index if not exists notif_dest_idx on public.notificaciones (destinatario_id, leida_en, creado_en desc);

create table if not exists public.correos_cola (
  id              bigint generated always as identity primary key,
  destinatario_id uuid references public.perfiles (id) on delete set null,
  correo          text not null,
  asunto          text not null,
  cuerpo_texto    text not null,
  clave_dedupe    text not null unique,     -- evita envíos duplicados
  estado          text not null default 'pendiente',
  intentos        smallint not null default 0,
  proximo_intento timestamptz not null default now(),
  bloqueado_hasta timestamptz,
  enviado_en      timestamptz,
  ultimo_error    text,
  creado_en       timestamptz not null default now(),
  constraint correo_estado check (estado in ('pendiente','enviando','enviado','error','descartado'))
);
create index if not exists correos_pendientes_idx on public.correos_cola (estado, proximo_intento);

create table if not exists public.liberaciones_log (
  id           bigint generated always as identity primary key,
  ejecutado_en timestamptz not null default now(),
  origen       text not null,        -- cron | manual | emergencia
  liberadas    integer not null,
  avisos       integer not null,
  detalle      jsonb
);

insert into public.configuracion (clave, valor, descripcion, editable) values
  ('correo_habilitado', 'false', 'Encolar correos de notificación (requiere configurar Microsoft Graph en la función despachar-correos).', true),
  ('url_aplicacion', '""', 'Dirección pública de la aplicación (para enlaces en los correos), p. ej. https://compras-presh.pages.dev', true)
on conflict (clave) do nothing;

-- ------------------------------------------------------------
-- 8. Permisos: helpers
-- ------------------------------------------------------------
create or replace function app.puede_admin_usuarios()
returns boolean language sql stable security definer
set search_path = ''
as $$ select app.es_admin() or app.tiene_rol('admin_usuarios'::public.rol_app); $$;

create or replace function app.puede_admin_catalogos()
returns boolean language sql stable security definer
set search_path = ''
as $$ select app.es_admin() or app.tiene_rol('admin_catalogos'::public.rol_app); $$;

create or replace function app.puede_consultar_global()
returns boolean language sql stable security definer
set search_path = ''
as $$ select app.es_admin() or app.tiene_rol('consulta_global'::public.rol_app); $$;

-- ¿Es jefe o ruta superior de alguna área activa, o tiene aprobaciones asignadas?
create or replace function app.es_jefe()
returns boolean language sql stable security definer
set search_path = ''
as $$
  select app.es_activo() and (
    exists (select 1 from public.areas a
            where a.activo and (a.jefe_id = auth.uid() or a.aprobador_superior_id = auth.uid()))
    or exists (select 1 from public.solicitud_aprobaciones x where x.aprobador_id = auth.uid())
  );
$$;

-- ¿El usuario es (o fue) aprobador de esa solicitud?
create or replace function app.es_aprobador_de_solicitud(p_sol uuid)
returns boolean language sql stable security definer
set search_path = ''
as $$
  select app.es_activo() and exists (
    select 1 from public.solicitud_aprobaciones x
    where x.solicitud_id = p_sol and x.aprobador_id = auth.uid()
  );
$$;

-- Visibilidad unificada de una solicitud (borradores: solo su autor).
create or replace function app.puede_ver_solicitud(p_sol uuid)
returns boolean language sql stable security definer
set search_path = ''
as $$
  select app.es_activo() and exists (
    select 1 from public.solicitudes s
    where s.id = p_sol and (
         s.solicitante_id = auth.uid()
      or (s.enviado_en is not null and app.puede_consultar_global())
      or (s.recibida_compras_en is not null and app.es_gestor())
      or (s.enviado_en is not null and app.es_aprobador_de_solicitud(s.id))
      or (app.tiene_rol('aprobador') and exists (
            select 1 from public.articulos a where a.solicitud_id = s.id and a.aprobador_id = auth.uid()))
      or (app.tiene_rol('almacen') and s.recibida_compras_en is not null and exists (
            select 1 from public.articulos a where a.solicitud_id = s.id
              and a.etapa in ('comprado','en_transito','recibido_parcial','recibido_total','cerrado')))
    )
  );
$$;

create or replace function app.puede_ver_articulo(p_art uuid)
returns boolean language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.articulos a where a.id = p_art and app.puede_ver_solicitud(a.solicitud_id));
$$;

-- Centro de costo permitido para el área (asociación activa + catálogo activo).
create or replace function app.cc_permitido(p_area uuid, p_cc uuid)
returns boolean language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.area_centros_costo x
    join public.centros_costo c on c.id = x.centro_costo_id
    where x.area_id = p_area and x.centro_costo_id = p_cc and x.activo and c.activo
  );
$$;

-- Estados en los que la solicitud está en la bandeja OPERATIVA de Compras.
create or replace function app.estado_operativo(p_estado public.estado_solicitud)
returns boolean language sql immutable
set search_path = ''
as $$ select p_estado::text in ('enviada','recibida_compras'); $$;

-- Perfiles relacionados por una solicitud (solicitante ↔ aprobador asignado).
create or replace function app.perfil_relacionado(p_perfil uuid)
returns boolean language sql stable security definer
set search_path = ''
as $$
  select app.es_activo() and exists (
    select 1 from public.solicitud_aprobaciones x
    join public.solicitudes s on s.id = x.solicitud_id
    where (s.solicitante_id = auth.uid() and x.aprobador_id = p_perfil)
       or (x.aprobador_id = auth.uid() and (s.solicitante_id = p_perfil or x.decidido_por = p_perfil))
       or (s.solicitante_id = auth.uid() and x.decidido_por = p_perfil)
  );
$$;
revoke all on function app.perfil_relacionado(uuid) from public, anon;
grant execute on function app.perfil_relacionado(uuid) to authenticated;

revoke all on function app.puede_admin_usuarios(), app.puede_admin_catalogos(),
  app.puede_consultar_global(), app.es_jefe(), app.es_aprobador_de_solicitud(uuid),
  app.puede_ver_solicitud(uuid), app.puede_ver_articulo(uuid), app.cc_permitido(uuid, uuid),
  app.estado_operativo(public.estado_solicitud) from public, anon;
grant execute on function app.puede_admin_usuarios(), app.puede_admin_catalogos(),
  app.puede_consultar_global(), app.es_jefe(), app.es_aprobador_de_solicitud(uuid),
  app.puede_ver_solicitud(uuid), app.puede_ver_articulo(uuid), app.cc_permitido(uuid, uuid),
  app.estado_operativo(public.estado_solicitud) to authenticated;

-- ------------------------------------------------------------
-- 8b. RLS: visibilidad nueva de solicitudes y artículos
-- ------------------------------------------------------------
-- Antes: Compras/administrador veían TODO (incluidos borradores).
-- Ahora: Compras solo ve lo RECIBIDO; la consulta global ve lo ENVIADO
-- (con su estado); el jefe ve lo que le toca aprobar; borradores: autor.
drop policy if exists solicitudes_select_gestion on public.solicitudes;
drop policy if exists solicitudes_select_compras on public.solicitudes;
create policy solicitudes_select_compras on public.solicitudes for select to authenticated
  using (recibida_compras_en is not null and app.es_gestor());

drop policy if exists solicitudes_select_consulta on public.solicitudes;
create policy solicitudes_select_consulta on public.solicitudes for select to authenticated
  using (enviado_en is not null and app.puede_consultar_global());

drop policy if exists solicitudes_select_jefe on public.solicitudes;
create policy solicitudes_select_jefe on public.solicitudes for select to authenticated
  using (enviado_en is not null and app.es_aprobador_de_solicitud(id));

drop policy if exists articulos_select_gestion on public.articulos;
drop policy if exists articulos_select_vision on public.articulos;
create policy articulos_select_vision on public.articulos for select to authenticated
  using (app.puede_ver_solicitud(solicitud_id));

-- Perfiles: nombres visibles para quienes los necesitan en su trabajo.
drop policy if exists perfiles_select on public.perfiles;
create policy perfiles_select on public.perfiles for select to authenticated
  using (
    id = auth.uid()
    or app.es_gestor()
    or app.puede_consultar_global()
    or app.puede_admin_usuarios()
    or app.puede_admin_catalogos()
    or (app.es_activo() and (app.tiene_rol('aprobador') or app.tiene_rol('almacen')))
    or app.perfil_relacionado(id)
  );

drop policy if exists perfil_roles_select on public.perfil_roles;
create policy perfil_roles_select on public.perfil_roles for select to authenticated
  using (perfil_id = auth.uid() or app.puede_admin_usuarios());

-- Catálogos: administración separada de la administración de usuarios.
drop policy if exists areas_admin on public.areas;
create policy areas_admin on public.areas for all to authenticated
  using (app.puede_admin_catalogos()) with check (app.puede_admin_catalogos());
drop policy if exists cc_admin on public.centros_costo;
create policy cc_admin on public.centros_costo for all to authenticated
  using (app.puede_admin_catalogos()) with check (app.puede_admin_catalogos());
drop policy if exists prov_catalogos on public.proveedores;
create policy prov_catalogos on public.proveedores for all to authenticated
  using (app.puede_admin_catalogos()) with check (app.puede_admin_catalogos());

-- Consulta global de solo lectura sobre la operación (sin escritura).
drop policy if exists cot_select_consulta on public.cotizaciones;
create policy cot_select_consulta on public.cotizaciones for select to authenticated
  using (app.puede_consultar_global());
drop policy if exists apr_select_consulta on public.aprobaciones;
create policy apr_select_consulta on public.aprobaciones for select to authenticated
  using (app.puede_consultar_global());
drop policy if exists compras_select_consulta on public.compras;
create policy compras_select_consulta on public.compras for select to authenticated
  using (app.puede_consultar_global());
drop policy if exists cfe_select_consulta on public.compra_fechas_estimadas;
create policy cfe_select_consulta on public.compra_fechas_estimadas for select to authenticated
  using (app.puede_consultar_global());
drop policy if exists mov_select_consulta on public.movimientos;
create policy mov_select_consulta on public.movimientos for select to authenticated
  using (app.puede_consultar_global());
drop policy if exists nov_select_consulta on public.novedades;
create policy nov_select_consulta on public.novedades for select to authenticated
  using (app.puede_consultar_global() or app.puede_ver_articulo(articulo_id));
drop policy if exists ce_select_consulta on public.compras_externas;
create policy ce_select_consulta on public.compras_externas for select to authenticated
  using (app.puede_consultar_global());

-- Tablas nuevas
alter table public.area_centros_costo     enable row level security;
alter table public.unidades_medida        enable row level security;
alter table public.categorias_solicitud   enable row level security;
alter table public.ventanas_recepcion     enable row level security;
alter table public.calendario_config      enable row level security;
alter table public.calendario_no_habiles  enable row level security;
alter table public.solicitud_versiones    enable row level security;
alter table public.solicitud_aprobaciones enable row level security;
alter table public.solicitud_devoluciones enable row level security;
alter table public.notificaciones         enable row level security;
alter table public.correos_cola           enable row level security;
alter table public.liberaciones_log       enable row level security;

do $$
declare t text;
begin
  foreach t in array array['area_centros_costo','unidades_medida','categorias_solicitud',
                           'ventanas_recepcion','calendario_config','calendario_no_habiles'] loop
    execute format('drop policy if exists %I on public.%I', t || '_leer', t);
    execute format('create policy %I on public.%I for select to authenticated using (app.es_activo())', t || '_leer', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for all to authenticated
                      using (app.puede_admin_catalogos()) with check (app.puede_admin_catalogos())', t || '_admin', t);
  end loop;
end $$;

drop policy if exists sver_select on public.solicitud_versiones;
create policy sver_select on public.solicitud_versiones for select to authenticated
  using (app.puede_ver_solicitud(solicitud_id));
drop policy if exists saprob_select on public.solicitud_aprobaciones;
create policy saprob_select on public.solicitud_aprobaciones for select to authenticated
  using (aprobador_id = auth.uid() or app.puede_ver_solicitud(solicitud_id));
drop policy if exists sdev_select on public.solicitud_devoluciones;
create policy sdev_select on public.solicitud_devoluciones for select to authenticated
  using (app.puede_ver_solicitud(solicitud_id));
drop policy if exists notif_select on public.notificaciones;
create policy notif_select on public.notificaciones for select to authenticated
  using (destinatario_id = auth.uid());
drop policy if exists correos_admin on public.correos_cola;
create policy correos_admin on public.correos_cola for select to authenticated
  using (app.es_admin());
drop policy if exists lib_log_admin on public.liberaciones_log;
create policy lib_log_admin on public.liberaciones_log for select to authenticated
  using (app.es_admin() or app.puede_admin_catalogos());

-- ------------------------------------------------------------
-- 8c. Disparadores de reglas (se SUMAN a los existentes; no los reemplazan)
-- ------------------------------------------------------------
create or replace function app.tg_solicitudes_reglas_v2()
returns trigger language plpgsql
set search_path = ''
as $$
declare
  v_area_perfil uuid;
begin
  if tg_op = 'INSERT' then
    if not app.es_servidor() then
      if new.flujo <> 'aprobacion_previa' or new.aprobador_jefe_id is not null
         or new.aprobado_en is not null or new.recibida_compras_en is not null
         or new.fecha_programada_recepcion is not null or new.liberacion_programada_en is not null
         or new.ultimo_envio_en is not null or new.aviso_compras_en is not null
         or new.version_contenido <> 0 then
        raise exception 'Campo protegido: lo fija el servidor.';
      end if;
      select area_id into v_area_perfil from public.perfiles where id = new.solicitante_id;
      if v_area_perfil is null then
        raise exception 'Tu usuario no tiene un área asignada. Pide al administrador que te vincule a tu área.';
      end if;
      if new.area_id <> v_area_perfil then
        raise exception 'Solo puedes solicitar para tu área asignada.';
      end if;
    end if;
    if not app.es_servidor() and not app.cc_permitido(new.area_id, new.centro_costo_id) then
      raise exception 'El centro de costo no está autorizado para esta área.';
    end if;
  else
    if not app.es_servidor() then
      if new.flujo is distinct from old.flujo
         or new.aprobador_jefe_id is distinct from old.aprobador_jefe_id
         or new.aprobado_en is distinct from old.aprobado_en
         or new.recibida_compras_en is distinct from old.recibida_compras_en
         or new.fecha_programada_recepcion is distinct from old.fecha_programada_recepcion
         or new.liberacion_programada_en is distinct from old.liberacion_programada_en
         or new.cierre_ciclo_en is distinct from old.cierre_ciclo_en
         or new.origen_programacion is distinct from old.origen_programacion
         or new.ultimo_envio_en is distinct from old.ultimo_envio_en
         or new.aviso_compras_en is distinct from old.aviso_compras_en
         or new.version_contenido is distinct from old.version_contenido then
        raise exception 'Campo protegido: lo fija el servidor.';
      end if;
      if new.area_id is distinct from old.area_id then
        select area_id into v_area_perfil from public.perfiles where id = new.solicitante_id;
        if new.area_id is distinct from v_area_perfil then
          raise exception 'Solo puedes solicitar para tu área asignada.';
        end if;
      end if;
    end if;
    if (new.area_id is distinct from old.area_id or new.centro_costo_id is distinct from old.centro_costo_id)
       and not app.es_servidor()
       and not app.cc_permitido(new.area_id, new.centro_costo_id) then
      raise exception 'El centro de costo no está autorizado para esta área.';
    end if;
  end if;

  if new.categoria_id is not null
     and (tg_op = 'INSERT' or new.categoria_id is distinct from old.categoria_id)
     and not exists (select 1 from public.categorias_solicitud c where c.id = new.categoria_id and c.activo) then
    raise exception 'La categoría seleccionada no existe o está inactiva.';
  end if;

  if new.es_extraordinaria and not app.es_servidor()
     and (tg_op = 'INSERT' or not old.es_extraordinaria)
     and not app.tiene_rol('emergencias') then
    raise exception 'No tienes permiso para crear solicitudes extraordinarias.';
  end if;
  return new;
end $$;

drop trigger if exists tg_solicitudes_reglas_v2 on public.solicitudes;
create trigger tg_solicitudes_reglas_v2
  before insert or update on public.solicitudes
  for each row execute function app.tg_solicitudes_reglas_v2();

create or replace function app.tg_articulos_reglas_v2()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then return old; end if;
  if not app.es_servidor() then
    if (tg_op = 'INSERT' or new.unidad is distinct from old.unidad)
       and not exists (select 1 from public.unidades_medida u
                       where lower(u.nombre) = lower(btrim(new.unidad)) and u.activo) then
      raise exception 'Selecciona la unidad de medida desde el catálogo.';
    end if;
    if (tg_op = 'INSERT' or new.centro_costo_id is distinct from old.centro_costo_id
        or new.area_id is distinct from old.area_id)
       and (new.centro_costo_id is not null or new.area_id is not null) then
      raise exception 'El centro de costo se asigna por solicitud (pendiente de confirmar varias destinaciones por artículo).';
    end if;
  end if;
  if new.enlace_referencia is not null then
    new.enlace_referencia := nullif(btrim(new.enlace_referencia), '');
    if new.enlace_referencia is not null
       and (new.enlace_referencia !~ '^https?://[^\s]+$' or char_length(new.enlace_referencia) > 1000) then
      raise exception 'El enlace de compra debe empezar por http:// o https:// (sin espacios).';
    end if;
  end if;
  if new.proveedor_sugerido is not null then
    new.proveedor_sugerido := nullif(left(btrim(new.proveedor_sugerido), 200), '');
  end if;
  return new;
end $$;

drop trigger if exists tg_articulos_reglas_v2 on public.articulos;
create trigger tg_articulos_reglas_v2
  before insert or update on public.articulos
  for each row execute function app.tg_articulos_reglas_v2();

-- Jefe y ruta superior: solo por la operación del servidor (valida y reasigna).
create or replace function app.tg_areas_jefes_proteger()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  if app.es_servidor() then return new; end if;
  if tg_op = 'INSERT' then
    if new.jefe_id is not null or new.aprobador_superior_id is not null then
      raise exception 'El jefe y la ruta superior se configuran en Administración → Estructura, después de crear el área.';
    end if;
  elsif new.jefe_id is distinct from old.jefe_id
     or new.aprobador_superior_id is distinct from old.aprobador_superior_id then
    raise exception 'El jefe y la ruta superior se configuran en Administración → Estructura.';
  end if;
  return new;
end $$;

drop trigger if exists tg_areas_jefes_proteger on public.areas;
create trigger tg_areas_jefes_proteger
  before insert or update on public.areas
  for each row execute function app.tg_areas_jefes_proteger();

-- Validación del calendario al activarlo.
create or replace function app.tg_calendario_validar()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from unnest(new.dias_recepcion) d where d not between 1 and 7)
     or exists (select 1 from unnest(new.dias_no_laborables) d where d not between 1 and 7) then
    raise exception 'Los días de la semana van de 1 (lunes) a 7 (domingo).';
  end if;
  if new.activo then
    if coalesce(array_length(new.dias_recepcion, 1), 0) = 0 then
      raise exception 'Para activar el calendario indica al menos un día de recepción.';
    end if;
    if new.hora_corte is null or new.hora_liberacion is null then
      raise exception 'Para activar el calendario indica la hora de liberación y la hora de corte.';
    end if;
    if exists (select 1 from unnest(new.dias_recepcion) d where d = any (new.dias_no_laborables)) then
      raise exception 'Un día de recepción no puede ser a la vez día no laborable.';
    end if;
  end if;
  new.actualizado_en := now();
  new.actualizado_por := auth.uid();
  return new;
end $$;

drop trigger if exists tg_calendario_validar on public.calendario_config;
create trigger tg_calendario_validar
  before insert or update on public.calendario_config
  for each row execute function app.tg_calendario_validar();

-- Versión optimista en catálogos nuevos.
drop trigger if exists tg_unidades_version on public.unidades_medida;
create trigger tg_unidades_version before update on public.unidades_medida
  for each row execute function app.tg_version();
drop trigger if exists tg_categorias_version on public.categorias_solicitud;
create trigger tg_categorias_version before update on public.categorias_solicitud
  for each row execute function app.tg_version();

-- Auditoría de las tablas nuevas (administración de catálogos, aprobadores,
-- calendario y flujo). La de calendario_config usa id=true como registro.
do $$
declare t text;
begin
  foreach t in array array[
    'area_centros_costo','unidades_medida','categorias_solicitud','ventanas_recepcion',
    'calendario_config','calendario_no_habiles','solicitud_aprobaciones','solicitud_devoluciones'
  ] loop
    execute format('drop trigger if exists tg_aud_%s on public.%I', t, t);
    execute format(
      'create trigger tg_aud_%s after insert or update or delete on public.%I
         for each row execute function app.tg_auditar()', t, t);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 8d. Adjuntos: visibilidad alineada con la nueva regla
--     (Compras ya no puede abrir adjuntos de solicitudes no liberadas;
--      el solicitante adjunta mientras puede editar).
-- ------------------------------------------------------------
create or replace function app.puede_ver_entidad_adjunto(p_entidad public.entidad_adjunto, p_id uuid)
returns boolean language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not app.es_activo() then return false; end if;
  if p_entidad = 'articulo' then
    return app.puede_ver_articulo(p_id);
  elsif p_entidad = 'novedad' then
    return exists (select 1 from public.novedades n
                   where n.id = p_id and app.puede_ver_articulo(n.articulo_id));
  elsif p_entidad = 'compra' then
    return exists (select 1 from public.compras c
                   where c.id = p_id and app.puede_ver_articulo(c.articulo_id));
  elsif p_entidad = 'compra_externa' then
    return app.es_gestor() or app.puede_consultar_global();
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
    return exists (
      select 1 from public.articulos a
      join public.solicitudes s on s.id = a.solicitud_id
      where a.id = p_id and a.etapa not in ('cerrado','cancelado')
        and (
          (s.solicitante_id = auth.uid() and s.estado in ('borrador','en_correccion'))
          or ((app.es_gestor() or app.tiene_rol('almacen')) and s.recibida_compras_en is not null)
        )
    );
  elsif p_entidad = 'novedad' then
    return exists (
      select 1 from public.novedades n
      where n.id = p_id and n.estado <> 'resuelta'
        and (app.es_gestor() or app.tiene_rol('almacen') or n.creado_por = auth.uid())
        and app.puede_ver_articulo(n.articulo_id)
    );
  elsif p_entidad = 'compra' then
    return app.es_gestor() and exists (select 1 from public.compras c where c.id = p_id);
  elsif p_entidad = 'compra_externa' then
    return app.es_gestor();
  end if;
  return false;
end $$;

-- ============================================================
-- 0015_flujo_aprobacion_funciones.sql · Mejora v2
--
-- Requiere 0013 y 0014. Funciones del servidor del nuevo recorrido:
--   A. Calendario (días hábiles, cálculo de ciclo, vista de próximos ciclos)
--   B. Notificaciones internas + cola de correos (idempotentes)
--   C. Envío a aprobación del jefe (versiones, aprobador, sin autoaprobación)
--   D. Decisión del jefe (aprobar / devolver / rechazar)
--   E. Liberación programada a Compras (+ avisos agrupados por ciclo)
--   F. Devoluciones solicitadas y autorizadas; cancelación; reprogramación
--   G. Administración: estructura de áreas, permisos granulares
--   H. Perfil, historial, indicadores y vistas
--   I. Servicio de correo (solo service_role)
-- Todas las operaciones verifican usuario activo, permiso y alcance en el
-- servidor; ocultar botones en la interfaz no es la protección.
-- ============================================================

-- ============================================================
-- A. CALENDARIO
-- ============================================================
create or replace function app.es_habil(p_fecha date)
returns boolean language sql stable security definer
set search_path = ''
as $$
  select not exists (select 1 from public.calendario_no_habiles n where n.fecha = p_fecha)
     and not (extract(isodow from p_fecha)::smallint = any (
              coalesce((select c.dias_no_laborables from public.calendario_config c where c.id), '{}')));
$$;

-- Ciclo de recepción para una solicitud aprobada (o por aprobar) en p_base.
--   p_semana_min: lunes de la semana objetivo (no se programa antes).
--   Regla de corte: el ciclo vale si p_base < cierre del ciclo, donde
--   cierre = (fecha de recepción − corte_dias_antes) a la hora_corte (Bogotá).
create or replace function app.calcular_ciclo(
  p_base timestamptz, p_categoria uuid, p_semana_min date, p_extra boolean
) returns table (fecha_recepcion date, liberacion timestamptz, cierre timestamptz, origen text, nota text)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  c public.calendario_config%rowtype;
  v_base_fecha date := (p_base at time zone 'America/Bogota')::date;
  v_desde date;
  v_d date;
  v_e date;
  v_i integer;
  v_k integer;
  v_cierre timestamptz;
  v_lib timestamptz;
  v_tiene_ventanas boolean := false;
  w record;
begin
  if p_extra then
    return query select v_base_fecha, p_base, p_base, 'extraordinaria'::text,
      'Solicitud extraordinaria: pasa a Compras en cuanto se aprueba.'::text;
    return;
  end if;

  select * into c from public.calendario_config where id;
  if not found or not c.activo then
    return query select v_base_fecha, p_base, p_base, 'sin_calendario'::text,
      'Calendario de recepción sin activar: pasa a Compras en cuanto se aprueba.'::text;
    return;
  end if;

  v_desde := greatest(v_base_fecha, coalesce(p_semana_min, v_base_fecha));

  if p_categoria is not null then
    select exists (select 1 from public.ventanas_recepcion v
                   where v.categoria_id = p_categoria and v.activo)
      into v_tiene_ventanas;
    if v_tiene_ventanas then
      for w in
        select * from public.ventanas_recepcion v
        where v.categoria_id = p_categoria and v.activo and v.fecha_recepcion >= v_desde
        order by v.fecha_recepcion, v.abre_en
      loop
        v_cierre := (w.cierra_en + c.hora_corte) at time zone 'America/Bogota';
        if p_base < v_cierre then
          v_lib := (w.fecha_recepcion + c.hora_liberacion) at time zone 'America/Bogota';
          return query select w.fecha_recepcion, v_lib, v_cierre, 'ventana_categoria'::text,
            ('Ventana "' || w.nombre || '"')::text;
          return;
        end if;
      end loop;
    end if;
  end if;

  for v_i in 0..200 loop
    v_d := v_desde + v_i;
    if extract(isodow from v_d)::smallint = any (c.dias_recepcion) then
      v_e := v_d;
      if not app.es_habil(v_e) then
        if not c.mover_si_no_habil then
          continue;
        end if;
        v_k := 0;
        while not app.es_habil(v_e) and v_k < 31 loop
          v_e := v_e + 1;
          v_k := v_k + 1;
        end loop;
        if not app.es_habil(v_e) then
          continue;
        end if;
      end if;
      v_cierre := ((v_e - c.corte_dias_antes) + c.hora_corte) at time zone 'America/Bogota';
      if p_base < v_cierre then
        v_lib := (v_e + c.hora_liberacion) at time zone 'America/Bogota';
        return query select v_e, v_lib, v_cierre, 'ciclo_semanal'::text,
          case when v_tiene_ventanas
               then 'Sin ventana vigente para la categoría: se usa el ciclo semanal.'
               when v_e <> v_d then 'El día de recepción no era hábil: se pasa al siguiente día hábil.'
               else null end::text;
        return;
      end if;
    end if;
  end loop;
  raise exception 'No hay un ciclo de recepción disponible en los próximos 200 días; revisa el calendario.';
end $$;

-- Próximos ciclos para el calendario visual del formulario.
create or replace function public.fn_calendario_proximos(
  p_categoria uuid, p_semanas integer, p_extra boolean
) returns table (
  semana_lunes date, fecha_recepcion date, liberacion timestamptz, cierre timestamptz,
  origen text, nota text, no_habiles jsonb
) language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_lunes date;
  v_w integer;
  r record;
begin
  if not app.es_activo() then
    raise exception 'Tu cuenta no está activa.' using errcode = '42501';
  end if;
  v_lunes := (now() at time zone 'America/Bogota')::date;
  v_lunes := v_lunes - (extract(isodow from v_lunes)::integer - 1);
  for v_w in 0..greatest(1, least(coalesce(p_semanas, 8), 26)) - 1 loop
    select * into r from app.calcular_ciclo(now(), p_categoria, v_lunes + 7 * v_w, coalesce(p_extra, false));
    semana_lunes := v_lunes + 7 * v_w;
    fecha_recepcion := r.fecha_recepcion;
    liberacion := r.liberacion;
    cierre := r.cierre;
    origen := r.origen;
    nota := r.nota;
    select coalesce(jsonb_agg(jsonb_build_object('fecha', n.fecha, 'descripcion', n.descripcion) order by n.fecha), '[]'::jsonb)
      into no_habiles
      from public.calendario_no_habiles n
     where n.fecha between v_lunes + 7 * v_w and v_lunes + 7 * v_w + 6;
    return next;
  end loop;
end $$;

-- ============================================================
-- B. NOTIFICACIONES Y COLA DE CORREOS (idempotentes por clave)
-- ============================================================
create or replace function app.notificar(
  p_dest uuid, p_tipo text, p_titulo text, p_cuerpo text, p_enlace text,
  p_sol uuid, p_evento timestamptz, p_clave text, p_correo boolean
) returns void language plpgsql security definer
set search_path = ''
as $$
declare
  v_correo text;
  v_url text;
  v_estado public.estado_perfil;
begin
  if p_dest is null or p_clave is null then return; end if;
  insert into public.notificaciones (destinatario_id, tipo, titulo, cuerpo, enlace, solicitud_id, evento_en, clave_dedupe)
  values (p_dest, p_tipo, left(p_titulo, 200), p_cuerpo, p_enlace, p_sol, coalesce(p_evento, now()), p_clave)
  on conflict (clave_dedupe) do nothing;

  if p_correo and app.config_bool('correo_habilitado', false) then
    select correo, estado into v_correo, v_estado from public.perfiles where id = p_dest;
    if v_correo is not null and v_estado = 'activo' then
      v_url := coalesce((select valor #>> '{}' from public.configuracion where clave = 'url_aplicacion'), '');
      insert into public.correos_cola (destinatario_id, correo, asunto, cuerpo_texto, clave_dedupe)
      values (p_dest, v_correo, '[Compras Semanales] ' || left(p_titulo, 150),
              coalesce(p_cuerpo, '') ||
              case when p_enlace is not null and v_url <> '' then E'\n\nAbrir: ' || v_url || p_enlace else '' end ||
              E'\n\nFecha del evento: ' || to_char(coalesce(p_evento, now()) at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') ||
              E'\n\nMensaje automático. No respondas a este correo.',
              'correo:' || p_clave)
      on conflict (clave_dedupe) do nothing;
    end if;
  end if;
end $$;

-- Notifica a todas las personas activas con rol Compras.
create or replace function app.notificar_compras(
  p_tipo text, p_titulo text, p_cuerpo text, p_enlace text, p_sol uuid, p_evento timestamptz, p_clave text, p_correo boolean
) returns integer language plpgsql security definer
set search_path = ''
as $$
declare
  r record;
  v_n integer := 0;
begin
  for r in
    select p.id from public.perfiles p
    join public.perfil_roles x on x.perfil_id = p.id and x.rol = 'compras'
    where p.estado = 'activo'
  loop
    perform app.notificar(r.id, p_tipo, p_titulo, p_cuerpo, p_enlace, p_sol, p_evento,
                          p_clave || ':' || r.id::text, p_correo);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function public.fn_marcar_notificaciones(p_ids bigint[])
returns integer language plpgsql security definer
set search_path = ''
as $$
declare v_n integer;
begin
  update public.notificaciones
     set leida_en = now()
   where destinatario_id = auth.uid() and leida_en is null
     and (p_ids is null or id = any (p_ids));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ============================================================
-- C. ENVÍO A APROBACIÓN DEL JEFE
-- ============================================================
create or replace function app.snapshot_solicitud(p_sol uuid)
returns jsonb language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'numero', s.numero, 'area_id', s.area_id, 'centro_costo_id', s.centro_costo_id,
    'justificacion', s.justificacion, 'semana_lunes', s.semana_lunes,
    'categoria_id', s.categoria_id, 'es_extraordinaria', s.es_extraordinaria,
    'motivo_extraordinaria', s.motivo_extraordinaria,
    'articulos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'nombre', a.nombre, 'descripcion', a.descripcion, 'cantidad', a.cantidad,
        'unidad', a.unidad, 'prioridad', a.prioridad, 'fecha_requerida', a.fecha_requerida,
        'justificacion', a.justificacion, 'enlace_referencia', a.enlace_referencia,
        'proveedor_sugerido', a.proveedor_sugerido,
        'adjuntos', (select count(*) from public.adjuntos ad where ad.entidad = 'articulo' and ad.entidad_id = a.id)
      ) order by a.creado_en)
      from public.articulos a where a.solicitud_id = s.id and a.etapa <> 'cancelado'), '[]'::jsonb)
  )
  from public.solicitudes s where s.id = p_sol;
$$;

-- Aprobador que corresponde. Nunca devuelve al propio solicitante.
create or replace function app.resolver_aprobador(
  p_solicitante uuid, p_area uuid, out o_aprobador uuid, out o_ruta text
) language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_area public.areas%rowtype;
begin
  select * into v_area from public.areas where id = p_area;
  if not found then
    raise exception 'El área de la solicitud no existe.';
  end if;
  if v_area.jefe_id is null then
    raise exception 'El área "%" no tiene jefe asignado. La solicitud queda en borrador; avisa a administración.', v_area.nombre;
  end if;
  if v_area.jefe_id = p_solicitante then
    if v_area.aprobador_superior_id is null or v_area.aprobador_superior_id = p_solicitante then
      raise exception 'Eres el jefe del área "%" y no hay ruta superior configurada para aprobar tus solicitudes. La solicitud queda en borrador; avisa a administración.', v_area.nombre;
    end if;
    o_aprobador := v_area.aprobador_superior_id;
    o_ruta := 'ruta_superior';
  else
    o_aprobador := v_area.jefe_id;
    o_ruta := 'jefe_area';
  end if;
  if not exists (select 1 from public.perfiles p where p.id = o_aprobador and p.estado = 'activo') then
    raise exception 'El aprobador configurado para el área "%" no tiene una cuenta activa. La solicitud queda en borrador; avisa a administración.', v_area.nombre;
  end if;
  if o_aprobador = p_solicitante then
    raise exception 'No se permite la autoaprobación.';
  end if;
end $$;

create or replace function app.enviar_a_aprobacion(p_sol uuid, p_motivo text)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare
  v_sol public.solicitudes%rowtype;
  v_aprob uuid;
  v_ruta text;
  v_version integer;
  v_ciclo record;
  v_nombre_aprob text;
  v_nombre_sol text;
  v_n integer;
begin
  select * into v_sol from public.solicitudes where id = p_sol for update;
  if v_sol.estado::text not in ('borrador','en_correccion') then
    raise exception 'Solo se envía a aprobación una solicitud en borrador o devuelta para corrección.';
  end if;

  select count(*) into v_n from public.articulos a where a.solicitud_id = p_sol and a.etapa <> 'cancelado';
  if v_n = 0 then
    raise exception 'Agrega al menos un artículo antes de enviar.';
  end if;
  if exists (select 1 from public.articulos a where a.solicitud_id = p_sol and a.etapa <> 'cancelado'
             and nullif(btrim(coalesce(a.descripcion,'')),'') is null) then
    raise exception 'Todos los artículos necesitan especificaciones (medidas, material, color u otras características).';
  end if;
  if not app.cc_permitido(v_sol.area_id, v_sol.centro_costo_id) then
    raise exception 'El centro de costo ya no está autorizado para el área; corrígelo antes de enviar.';
  end if;
  if v_sol.categoria_id is not null
     and not exists (select 1 from public.categorias_solicitud c where c.id = v_sol.categoria_id and c.activo) then
    raise exception 'La categoría de la solicitud está inactiva; elige otra.';
  end if;
  if v_sol.es_extraordinaria then
    if not app.rol_de(v_sol.solicitante_id, 'emergencias') then
      raise exception 'El solicitante no tiene permiso para solicitudes extraordinarias.';
    end if;
    if char_length(btrim(coalesce(v_sol.motivo_extraordinaria,''))) < 10 then
      raise exception 'Describe el motivo de la emergencia (mínimo 10 caracteres).';
    end if;
  end if;

  select o_aprobador, o_ruta into v_aprob, v_ruta
  from app.resolver_aprobador(v_sol.solicitante_id, v_sol.area_id);

  v_version := v_sol.version_contenido + 1;

  insert into public.solicitud_versiones (solicitud_id, version, contenido, motivo, enviado_por)
  values (p_sol, v_version, app.snapshot_solicitud(p_sol), p_motivo, auth.uid());

  update public.solicitud_aprobaciones
     set es_vigente = false,
         estado = case when estado = 'pendiente' then 'reemplazada' else estado end
   where solicitud_id = p_sol and es_vigente;

  insert into public.solicitud_aprobaciones (solicitud_id, version, aprobador_id, ruta)
  values (p_sol, v_version, v_aprob, v_ruta);

  perform app.modo_servidor();
  -- Nada vuelve a Compras sin la nueva aprobación: los artículos que aún no
  -- se compraron salen de su bandeja y se borra la marca de recepción
  -- (la fecha anterior queda en la auditoría). Aplica también a solicitudes
  -- del flujo anterior que se reenvían tras una corrección.
  update public.articulos set etapa = 'borrador'
   where solicitud_id = p_sol and etapa in ('solicitado','en_cotizacion','cotizado');
  update public.solicitudes set
    estado = 'pendiente_aprobacion',
    flujo = 'aprobacion_previa',
    recibida_compras_en = null,
    aviso_compras_en = null,
    aprobador_jefe_id = v_aprob,
    enviado_en = coalesce(enviado_en, now()),
    ultimo_envio_en = now(),
    version_contenido = v_version,
    aprobado_en = null,
    fecha_programada_recepcion = null,
    liberacion_programada_en = null,
    cierre_ciclo_en = null,
    origen_programacion = null
  where id = p_sol;

  select * into v_ciclo from app.calcular_ciclo(now(), v_sol.categoria_id, v_sol.semana_lunes, v_sol.es_extraordinaria);
  select nombre into v_nombre_aprob from public.perfiles where id = v_aprob;
  select nombre into v_nombre_sol from public.perfiles where id = v_sol.solicitante_id;

  perform app.auditar('solicitudes', p_sol::text, 'ENVIO_APROBACION',
    jsonb_build_object('estado', v_sol.estado),
    jsonb_build_object('estado','pendiente_aprobacion','version', v_version,'aprobador', v_aprob,'ruta', v_ruta),
    p_motivo);

  perform app.notificar(v_aprob, 'aprobacion_pendiente',
    case when v_sol.es_extraordinaria then 'EXTRAORDINARIA por aprobar: ' else 'Solicitud por aprobar: ' end || v_sol.numero,
    v_nombre_sol || ' envió la solicitud ' || v_sol.numero || ' (' || v_n || ' artículo(s)) para tu aprobación.' ||
      case when v_version > 1 then ' Es la versión ' || v_version || ' tras una corrección.' else '' end,
    '/aprobacion-solicitudes', p_sol, now(), 'envio:' || p_sol || ':v' || v_version, true);

  return jsonb_build_object(
    'ok', true, 'numero', v_sol.numero, 'estado', 'pendiente_aprobacion', 'version', v_version,
    'aprobador', v_nombre_aprob, 'ruta', v_ruta,
    'recepcion_prevista', v_ciclo.fecha_recepcion, 'cierre', v_ciclo.cierre,
    'origen', v_ciclo.origen, 'nota', v_ciclo.nota);
end $$;

-- Reemplaza la versión anterior: ahora ENVÍA A APROBACIÓN (no a Compras).
create or replace function public.fn_enviar_solicitud(p_solicitud uuid, p_version integer, p_op uuid)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare
  v_sol public.solicitudes%rowtype;
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
    raise exception 'Solo se envían a aprobación solicitudes en borrador.';
  end if;
  if v_sol.version <> p_version then
    raise exception 'La solicitud fue modificada en otra sesión. Recarga e intenta de nuevo.' using errcode = '40001';
  end if;

  v_res := app.enviar_a_aprobacion(p_solicitud, null);
  perform app.op_guardar(p_op, 'fn_enviar_solicitud', v_res);
  return v_res;
end $$;

create or replace function public.fn_reenviar_solicitud(p_solicitud uuid, p_comentario text, p_op uuid)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare
  v_sol public.solicitudes%rowtype;
  v_res jsonb;
begin
  v_res := app.op_existente(p_op);
  if v_res is not null then return v_res; end if;
  select * into v_sol from public.solicitudes where id = p_solicitud for update;
  if not found or v_sol.solicitante_id <> auth.uid() or not app.es_activo() then
    raise exception 'Solicitud no encontrada.';
  end if;
  if v_sol.estado <> 'en_correccion' then
    raise exception 'La solicitud no está devuelta para corrección.';
  end if;
  v_res := app.enviar_a_aprobacion(p_solicitud, coalesce(nullif(btrim(p_comentario),''), 'Reenvío tras corrección'));
  perform app.op_guardar(p_op, 'fn_reenviar_solicitud', v_res);
  return v_res;
end $$;

-- Vista previa para el botón "Enviar a aprobación" (no modifica nada).
create or replace function public.fn_estimar_envio(p_solicitud uuid)
returns jsonb language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_sol public.solicitudes%rowtype;
  v_ciclo record;
  v_aprob uuid;
  v_ruta text;
  v_problema text;
  v_nombre text;
begin
  select * into v_sol from public.solicitudes where id = p_solicitud;
  if not found or v_sol.solicitante_id <> auth.uid() or not app.es_activo() then
    raise exception 'Solicitud no encontrada.';
  end if;
  begin
    select o_aprobador, o_ruta into v_aprob, v_ruta from app.resolver_aprobador(v_sol.solicitante_id, v_sol.area_id);
    select nombre into v_nombre from public.perfiles where id = v_aprob;
  exception when others then
    v_problema := sqlerrm;
  end;
  select * into v_ciclo from app.calcular_ciclo(now(), v_sol.categoria_id, v_sol.semana_lunes, v_sol.es_extraordinaria);
  return jsonb_build_object(
    'aprobador', v_nombre, 'ruta', v_ruta, 'problema', v_problema,
    'recepcion_prevista', v_ciclo.fecha_recepcion, 'cierre', v_ciclo.cierre,
    'origen', v_ciclo.origen, 'nota', v_ciclo.nota);
end $$;

-- ============================================================
-- E. LIBERACIÓN A COMPRAS (definida antes de la decisión, que la usa)
-- ============================================================
create or replace function app.liberar_solicitud(p_sol uuid, p_origen text)
returns boolean language plpgsql security definer
set search_path = ''
as $$
declare
  v_sol public.solicitudes%rowtype;
begin
  select * into v_sol from public.solicitudes where id = p_sol for update;
  if not found or v_sol.estado <> 'programada' then
    return false;
  end if;
  -- Condición 1: aprobación vigente, aprobada y de ESTA versión del contenido.
  if not exists (select 1 from public.solicitud_aprobaciones x
                 where x.solicitud_id = p_sol and x.es_vigente and x.estado = 'aprobada'
                   and x.version = v_sol.version_contenido) then
    return false;
  end if;
  -- Condición 2: llegó la fecha programada (o es extraordinaria / sin calendario).
  if v_sol.liberacion_programada_en is null or v_sol.liberacion_programada_en > now() then
    return false;
  end if;

  perform app.modo_servidor();
  update public.solicitudes
     set estado = 'recibida_compras', recibida_compras_en = now(), aviso_compras_en = null
   where id = p_sol;
  update public.articulos set etapa = 'solicitado'
   where solicitud_id = p_sol and etapa = 'borrador';

  perform app.auditar('solicitudes', p_sol::text, 'RECEPCION_COMPRAS',
    jsonb_build_object('estado','programada'),
    jsonb_build_object('estado','recibida_compras','origen', p_origen,
                       'programada_para', v_sol.fecha_programada_recepcion), null);

  perform app.notificar(v_sol.solicitante_id, 'recibida_compras',
    'Compras recibió tu solicitud ' || v_sol.numero,
    'Tu solicitud ' || v_sol.numero || ' ya está en la bandeja de gestión de Compras.',
    '/solicitudes/' || p_sol, p_sol, now(), 'recepcion:' || p_sol || ':v' || v_sol.version_contenido, true);
  return true;
end $$;

-- Avisos a Compras AGRUPADOS: un mensaje por persona por lote liberado.
create or replace function app.encolar_avisos_recepcion(p_lote text)
returns integer language plpgsql security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_lista text;
  v_n integer;
  v_extra integer;
begin
  select array_agg(s.id order by s.es_extraordinaria desc, s.numero),
         string_agg('• ' || s.numero || ' · ' || coalesce(a.nombre,'') ||
                    case when s.es_extraordinaria then ' · EXTRAORDINARIA' else '' end, E'\n'
                    order by s.es_extraordinaria desc, s.numero),
         count(*), count(*) filter (where s.es_extraordinaria)
    into v_ids, v_lista, v_n, v_extra
  from (select * from public.solicitudes
        where estado = 'recibida_compras' and aviso_compras_en is null
        for update skip locked) s
  left join public.areas a on a.id = s.area_id;

  if coalesce(v_n, 0) = 0 then return 0; end if;

  perform app.modo_servidor();
  update public.solicitudes set aviso_compras_en = now() where id = any (v_ids);

  perform app.notificar_compras('recepcion_ciclo',
    case when v_extra > 0 then v_n || ' solicitud(es) recibida(s), ' || v_extra || ' extraordinaria(s)'
         else v_n || ' solicitud(es) nueva(s) para gestionar' end,
    'Se liberaron a la bandeja de Compras:' || E'\n' || v_lista,
    '/gestion', null, now(), 'aviso-recepcion:' || p_lote, true);
  return v_n;
end $$;

create or replace function app.job_liberar(p_origen text)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare
  r record;
  v_lib integer := 0;
  v_avisos integer;
  v_lote text := gen_random_uuid()::text;
  v_ids jsonb := '[]'::jsonb;
begin
  for r in
    select s.id, s.numero from public.solicitudes s
    where s.estado = 'programada' and s.liberacion_programada_en <= now()
    order by s.liberacion_programada_en
    for update skip locked
  loop
    if app.liberar_solicitud(r.id, p_origen) then
      v_lib := v_lib + 1;
      v_ids := v_ids || to_jsonb(r.numero);
    end if;
  end loop;
  v_avisos := app.encolar_avisos_recepcion(v_lote);
  if v_lib > 0 or v_avisos > 0 or p_origen <> 'cron' then
    insert into public.liberaciones_log (origen, liberadas, avisos, detalle)
    values (p_origen, v_lib, v_avisos, jsonb_build_object('solicitudes', v_ids, 'lote', v_lote));
  end if;
  return jsonb_build_object('liberadas', v_lib, 'avisos', v_avisos, 'solicitudes', v_ids);
end $$;

-- Ejecución manual (si el reloj programado no está activo o para pruebas).
create or replace function public.fn_admin_ejecutar_liberacion()
returns jsonb language plpgsql security definer
set search_path = ''
as $$
begin
  if not app.puede_admin_catalogos() then
    raise exception 'Solo administración puede ejecutar la liberación manual.' using errcode = '42501';
  end if;
  return app.job_liberar('manual');
end $$;

-- ============================================================
-- D. DECISIÓN DEL JEFE
-- ============================================================
create or replace function app.aplicar_devolucion(p_sol uuid, p_motivo text)
returns void language plpgsql security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.articulos a where a.solicitud_id = p_sol
             and a.etapa in ('comprado','en_transito','recibido_parcial','recibido_total','cerrado')) then
    raise exception 'Hay artículos ya comprados o recibidos: registra una novedad posterior a la compra en lugar de una devolución.';
  end if;
  perform app.modo_servidor();
  -- Cualquier petición pendiente queda atendida por esta devolución.
  update public.solicitud_devoluciones
     set estado = 'autorizada', resuelta_por = auth.uid(), resuelta_en = now(),
         respuesta = coalesce(respuesta, 'Atendida con la devolución aplicada')
   where solicitud_id = p_sol and estado = 'pendiente';
  -- Los artículos salen de la bandeja de Compras hasta una nueva aprobación.
  update public.articulos set etapa = 'borrador'
   where solicitud_id = p_sol and etapa in ('solicitado','en_cotizacion','cotizado');
  update public.solicitud_aprobaciones
     set es_vigente = false,
         estado = case when estado = 'pendiente' then 'anulada' else estado end
   where solicitud_id = p_sol and es_vigente;
  update public.solicitudes set
    estado = 'en_correccion',
    aprobado_en = null,
    fecha_programada_recepcion = null,
    liberacion_programada_en = null,
    cierre_ciclo_en = null,
    origen_programacion = null
  where id = p_sol;
end $$;

create or replace function public.fn_decidir_solicitud(
  p_solicitud uuid, p_decision text, p_motivo text, p_version integer, p_op uuid
) returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare
  v_sol public.solicitudes%rowtype;
  v_apr public.solicitud_aprobaciones%rowtype;
  c public.calendario_config%rowtype;
  v_base timestamptz;
  v_ciclo record;
  v_ciclo_envio record;
  v_liberada boolean := false;
  v_nota text;
  v_res jsonb;
  v_motivo text := nullif(btrim(coalesce(p_motivo,'')),'');
begin
  v_res := app.op_existente(p_op);
  if v_res is not null then return v_res; end if;

  if p_decision not in ('aprobar','devolver','rechazar') then
    raise exception 'Decisión inválida.';
  end if;
  if not app.es_activo() then
    raise exception 'Tu cuenta no está activa.' using errcode = '42501';
  end if;

  select * into v_sol from public.solicitudes where id = p_solicitud for update;
  if not found then raise exception 'Solicitud no encontrada.'; end if;
  if v_sol.estado <> 'pendiente_aprobacion' then
    raise exception 'Esta solicitud ya no está pendiente de aprobación.';
  end if;
  select * into v_apr from public.solicitud_aprobaciones
   where solicitud_id = p_solicitud and es_vigente and estado = 'pendiente' for update;
  if not found or v_apr.aprobador_id <> auth.uid() then
    raise exception 'Solo el aprobador asignado a esta solicitud puede decidirla.' using errcode = '42501';
  end if;
  -- Sin autoaprobación, aunque la persona tenga varios roles.
  if v_sol.solicitante_id = auth.uid() then
    raise exception 'No se permite aprobar, devolver ni rechazar la propia solicitud.' using errcode = '42501';
  end if;
  if p_version is distinct from v_sol.version_contenido or v_apr.version <> v_sol.version_contenido then
    raise exception 'El contenido cambió desde que lo abriste. Recarga y revisa la versión vigente.' using errcode = '40001';
  end if;
  if p_decision in ('devolver','rechazar') and (v_motivo is null or char_length(v_motivo) < 5) then
    raise exception 'Indica el motivo (lo verá el solicitante).';
  end if;

  perform app.modo_servidor();

  if p_decision = 'aprobar' then
    update public.solicitud_aprobaciones
       set estado = 'aprobada', motivo = v_motivo, decidido_en = now(), decidido_por = auth.uid()
     where id = v_apr.id;

    select * into c from public.calendario_config where id;
    v_base := case when c.politica_post_corte = 'mismo_ciclo' then v_sol.ultimo_envio_en else now() end;
    select * into v_ciclo from app.calcular_ciclo(v_base, v_sol.categoria_id, v_sol.semana_lunes, v_sol.es_extraordinaria);

    if v_ciclo.origen in ('ciclo_semanal','ventana_categoria') then
      select * into v_ciclo_envio from app.calcular_ciclo(v_sol.ultimo_envio_en, v_sol.categoria_id, v_sol.semana_lunes, false);
      if v_ciclo_envio.fecha_recepcion is distinct from v_ciclo.fecha_recepcion then
        v_nota := 'Aprobada después del cierre del ciclo previsto (' || to_char(v_ciclo_envio.fecha_recepcion, 'DD/MM/YYYY') ||
                  '): pasa al siguiente ciclo habilitado.' ||
                  case when not c.politica_validada then ' Política propuesta, pendiente de validación.' else '' end;
      end if;
    end if;

    update public.solicitudes set
      estado = 'programada',
      aprobado_en = now(),
      fecha_programada_recepcion = v_ciclo.fecha_recepcion,
      liberacion_programada_en = v_ciclo.liberacion,
      cierre_ciclo_en = v_ciclo.cierre,
      origen_programacion = v_ciclo.origen
    where id = p_solicitud;

    perform app.auditar('solicitudes', p_solicitud::text, 'APROBACION_JEFE',
      jsonb_build_object('estado','pendiente_aprobacion'),
      jsonb_build_object('estado','programada','version', v_sol.version_contenido,
                         'recepcion', v_ciclo.fecha_recepcion, 'origen', v_ciclo.origen, 'nota', v_nota),
      v_motivo);

    if v_ciclo.liberacion <= now() then
      v_liberada := app.liberar_solicitud(p_solicitud, case when v_sol.es_extraordinaria then 'extraordinaria' else 'aprobacion' end);
      if v_liberada then
        perform app.encolar_avisos_recepcion('inmediato:' || p_solicitud::text || ':v' || v_sol.version_contenido);
      end if;
    end if;

    perform app.notificar(v_sol.solicitante_id, 'aprobada',
      'Solicitud aprobada: ' || v_sol.numero,
      case when v_liberada then 'Tu solicitud fue aprobada y ya está en la bandeja de Compras.'
           else 'Tu solicitud fue aprobada. Compras la recibirá el ' || to_char(v_ciclo.fecha_recepcion, 'DD/MM/YYYY') || '.' end ||
      coalesce(' ' || v_nota, ''),
      '/solicitudes/' || p_solicitud, p_solicitud, now(), 'decision:' || p_solicitud || ':v' || v_sol.version_contenido, true);

    v_res := jsonb_build_object('ok', true, 'decision', 'aprobar', 'liberada', v_liberada,
      'recepcion', v_ciclo.fecha_recepcion, 'origen', v_ciclo.origen, 'nota', v_nota);

  elsif p_decision = 'devolver' then
    update public.solicitud_aprobaciones
       set estado = 'devuelta', motivo = v_motivo, decidido_en = now(), decidido_por = auth.uid(), es_vigente = false
     where id = v_apr.id;
    insert into public.solicitud_devoluciones (solicitud_id, iniciada_por, motivo, etapa, estado, resuelta_por, resuelta_en)
    values (p_solicitud, auth.uid(), v_motivo, 'pendiente_aprobacion', 'aplicada_directa', auth.uid(), now());
    perform app.aplicar_devolucion(p_solicitud, v_motivo);
    perform app.auditar('solicitudes', p_solicitud::text, 'DEVOLUCION_JEFE',
      jsonb_build_object('estado','pendiente_aprobacion'), jsonb_build_object('estado','en_correccion'), v_motivo);
    perform app.notificar(v_sol.solicitante_id, 'devuelta',
      'Solicitud devuelta para corrección: ' || v_sol.numero,
      'Motivo: ' || v_motivo || E'\nCorrige y vuelve a enviarla a aprobación.',
      '/solicitudes/' || p_solicitud, p_solicitud, now(), 'decision:' || p_solicitud || ':v' || v_sol.version_contenido, true);
    v_res := jsonb_build_object('ok', true, 'decision', 'devolver');

  else
    update public.solicitud_aprobaciones
       set estado = 'rechazada', motivo = v_motivo, decidido_en = now(), decidido_por = auth.uid()
     where id = v_apr.id;
    update public.articulos set etapa = 'cancelado'
     where solicitud_id = p_solicitud and etapa = 'borrador';
    update public.solicitud_devoluciones
       set estado = 'negada', resuelta_por = auth.uid(), resuelta_en = now(),
           respuesta = coalesce(respuesta, 'La solicitud fue rechazada')
     where solicitud_id = p_solicitud and estado = 'pendiente';
    update public.solicitudes set estado = 'rechazada' where id = p_solicitud;
    perform app.auditar('solicitudes', p_solicitud::text, 'RECHAZO_JEFE',
      jsonb_build_object('estado','pendiente_aprobacion'), jsonb_build_object('estado','rechazada'), v_motivo);
    perform app.notificar(v_sol.solicitante_id, 'rechazada',
      'Solicitud rechazada: ' || v_sol.numero, 'Motivo: ' || v_motivo,
      '/solicitudes/' || p_solicitud, p_solicitud, now(), 'decision:' || p_solicitud || ':v' || v_sol.version_contenido, true);
    v_res := jsonb_build_object('ok', true, 'decision', 'rechazar');
  end if;

  perform app.op_guardar(p_op, 'fn_decidir_solicitud', v_res);
  return v_res;
end $$;

-- ============================================================
-- F. DEVOLUCIONES SOLICITADAS, CANCELACIÓN Y REPROGRAMACIÓN
-- ============================================================
-- El solicitante NO cambia en silencio lo enviado: pide la devolución y el
-- responsable de la etapa la autoriza (jefe antes de Compras; Compras después).
create or replace function public.fn_solicitar_devolucion(p_solicitud uuid, p_motivo text, p_op uuid)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare
  v_sol public.solicitudes%rowtype;
  v_id uuid;
  v_res jsonb;
  v_resp uuid;
begin
  v_res := app.op_existente(p_op);
  if v_res is not null then return v_res; end if;
  if char_length(btrim(coalesce(p_motivo,''))) < 5 then
    raise exception 'Explica qué necesitas corregir (mínimo 5 caracteres).';
  end if;
  select * into v_sol from public.solicitudes where id = p_solicitud for update;
  if not found or v_sol.solicitante_id <> auth.uid() or not app.es_activo() then
    raise exception 'Solicitud no encontrada.';
  end if;
  if v_sol.estado::text not in ('pendiente_aprobacion','programada','recibida_compras','enviada') then
    raise exception 'En el estado actual no aplica una devolución (si está en borrador o corrección puedes editarla directamente).';
  end if;
  if exists (select 1 from public.articulos a where a.solicitud_id = p_solicitud
             and a.etapa in ('comprado','en_transito','recibido_parcial','recibido_total','cerrado')) then
    raise exception 'Ya hay artículos comprados: registra una novedad en el artículo en lugar de pedir devolución.';
  end if;
  if exists (select 1 from public.solicitud_devoluciones d where d.solicitud_id = p_solicitud and d.estado = 'pendiente') then
    raise exception 'Ya hay una petición de devolución pendiente para esta solicitud.';
  end if;

  insert into public.solicitud_devoluciones (solicitud_id, iniciada_por, motivo, etapa)
  values (p_solicitud, auth.uid(), btrim(p_motivo), v_sol.estado::text)
  returning id into v_id;

  if v_sol.estado::text in ('pendiente_aprobacion','programada') then
    select aprobador_id into v_resp from public.solicitud_aprobaciones
     where solicitud_id = p_solicitud and es_vigente;
    perform app.notificar(v_resp, 'devolucion_pedida',
      'Petición de devolución: ' || v_sol.numero, 'El solicitante pide corregir: ' || btrim(p_motivo),
      '/aprobacion-solicitudes', p_solicitud, now(), 'devpedida:' || v_id, true);
  else
    perform app.notificar_compras('devolucion_pedida',
      'Petición de devolución: ' || v_sol.numero, 'El solicitante pide corregir: ' || btrim(p_motivo),
      '/gestion', p_solicitud, now(), 'devpedida:' || v_id, true);
  end if;

  v_res := jsonb_build_object('ok', true, 'devolucion_id', v_id);
  perform app.op_guardar(p_op, 'fn_solicitar_devolucion', v_res);
  return v_res;
end $$;

create or replace function public.fn_resolver_devolucion(
  p_devolucion uuid, p_autorizar boolean, p_respuesta text, p_op uuid
) returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare
  v_dev public.solicitud_devoluciones%rowtype;
  v_sol public.solicitudes%rowtype;
  v_ok boolean := false;
  v_res jsonb;
begin
  v_res := app.op_existente(p_op);
  if v_res is not null then return v_res; end if;
  select * into v_dev from public.solicitud_devoluciones where id = p_devolucion for update;
  if not found or v_dev.estado <> 'pendiente' then
    raise exception 'La petición de devolución no existe o ya fue resuelta.';
  end if;
  select * into v_sol from public.solicitudes where id = v_dev.solicitud_id for update;

  -- Responsable de la etapa actual.
  if v_sol.estado::text in ('pendiente_aprobacion','programada') then
    v_ok := exists (select 1 from public.solicitud_aprobaciones x
                    where x.solicitud_id = v_sol.id and x.es_vigente and x.aprobador_id = auth.uid());
  elsif app.estado_operativo(v_sol.estado) then
    v_ok := app.es_gestor();
  end if;
  if not v_ok or not app.es_activo() then
    raise exception 'Solo el responsable de la etapa actual puede resolver esta petición.' using errcode = '42501';
  end if;
  if v_sol.solicitante_id = auth.uid() then
    raise exception 'No puedes resolver tu propia petición de devolución.' using errcode = '42501';
  end if;
  if not p_autorizar and char_length(btrim(coalesce(p_respuesta,''))) < 5 then
    raise exception 'Explica por qué no se autoriza la devolución.';
  end if;

  if p_autorizar then
    perform app.aplicar_devolucion(v_sol.id, v_dev.motivo);
  end if;
  update public.solicitud_devoluciones
     set estado = case when p_autorizar then 'autorizada' else 'negada' end,
         resuelta_por = auth.uid(), resuelta_en = now(),
         respuesta = nullif(btrim(coalesce(p_respuesta,'')),'')
   where id = p_devolucion;

  perform app.auditar('solicitudes', v_sol.id::text,
    case when p_autorizar then 'DEVOLUCION_AUTORIZADA' else 'DEVOLUCION_NEGADA' end,
    jsonb_build_object('estado', v_sol.estado),
    jsonb_build_object('estado', case when p_autorizar then 'en_correccion' else v_sol.estado::text end),
    coalesce(p_respuesta, v_dev.motivo));

  perform app.notificar(v_sol.solicitante_id,
    case when p_autorizar then 'devuelta' else 'devolucion_negada' end,
    case when p_autorizar then 'Devolución autorizada: ' else 'Devolución no autorizada: ' end || v_sol.numero,
    case when p_autorizar then 'Ya puedes corregir la solicitud y reenviarla a aprobación.'
         else 'Respuesta: ' || btrim(p_respuesta) end,
    '/solicitudes/' || v_sol.id, v_sol.id, now(), 'devresuelta:' || p_devolucion, true);

  v_res := jsonb_build_object('ok', true, 'autorizada', p_autorizar);
  perform app.op_guardar(p_op, 'fn_resolver_devolucion', v_res);
  return v_res;
end $$;

-- Compras devuelve una solicitud que ya recibió (reemplaza la versión anterior).
create or replace function public.fn_devolver_a_correccion(p_solicitud uuid, p_motivo text)
returns void language plpgsql security definer
set search_path = ''
as $$
declare v_sol public.solicitudes%rowtype;
begin
  if not app.es_gestor() then
    raise exception 'Solo Compras o el administrador devuelven a corrección.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_motivo,''))) < 5 then
    raise exception 'Indica el motivo de la corrección (lo verá el solicitante).';
  end if;
  select * into v_sol from public.solicitudes where id = p_solicitud for update;
  if not found then raise exception 'Solicitud no encontrada.'; end if;
  if not app.estado_operativo(v_sol.estado) then
    raise exception 'Solo se devuelven solicitudes que ya están en la bandeja de Compras.';
  end if;
  perform app.aplicar_devolucion(p_solicitud, p_motivo);
  insert into public.solicitud_devoluciones (solicitud_id, iniciada_por, motivo, etapa, estado, resuelta_por, resuelta_en)
  values (p_solicitud, auth.uid(), btrim(p_motivo), v_sol.estado::text, 'aplicada_directa', auth.uid(), now());
  perform app.auditar('solicitudes', p_solicitud::text, 'A_CORRECCION',
    jsonb_build_object('estado', v_sol.estado), jsonb_build_object('estado','en_correccion'), p_motivo);
  perform app.notificar(v_sol.solicitante_id, 'devuelta',
    'Compras devolvió tu solicitud ' || v_sol.numero,
    'Motivo: ' || btrim(p_motivo) || E'\nCorrígela y reenvíala: pasará otra vez por la aprobación de tu jefe.',
    '/solicitudes/' || p_solicitud, p_solicitud, now(), 'devcompras:' || p_solicitud || ':v' || v_sol.version_contenido, true);
end $$;

-- Cancelación (reemplaza la anterior): el solicitante solo cancela lo que
-- aún puede editar; Compras cancela lo recibido sin compras; el jefe rechaza.
create or replace function public.fn_cancelar_solicitud(p_solicitud uuid, p_motivo text, p_version integer)
returns void language plpgsql security definer
set search_path = ''
as $$
declare
  v_sol public.solicitudes%rowtype;
  v_es_dueno boolean;
begin
  if char_length(btrim(coalesce(p_motivo,''))) < 3 then
    raise exception 'Indica el motivo de la cancelación.';
  end if;
  select * into v_sol from public.solicitudes where id = p_solicitud for update;
  if not found then raise exception 'Solicitud no encontrada.'; end if;
  if v_sol.version <> p_version then
    raise exception 'La solicitud fue modificada en otra sesión. Recarga e intenta de nuevo.' using errcode = '40001';
  end if;
  if v_sol.estado::text in ('cancelada','rechazada') then return; end if;
  v_es_dueno := v_sol.solicitante_id = auth.uid() and app.es_activo();

  if v_sol.estado::text in ('borrador','en_correccion') then
    if not (v_es_dueno or (app.es_gestor() and v_sol.recibida_compras_en is not null)) then
      raise exception 'No tienes permiso para cancelar esta solicitud.' using errcode = '42501';
    end if;
  elsif app.estado_operativo(v_sol.estado) then
    if not app.es_gestor() then
      raise exception 'La solicitud ya está en Compras: pide la devolución o la cancelación a Compras.' using errcode = '42501';
    end if;
  else
    raise exception 'La solicitud está en aprobación o programada: pide una devolución para corregirla o cancelarla.';
  end if;

  if exists (select 1 from public.articulos a where a.solicitud_id = p_solicitud
             and a.etapa in ('comprado','en_transito','recibido_parcial','recibido_total','cerrado')) then
    raise exception 'Hay artículos comprados o recibidos: cancela artículo por artículo con su resolución.';
  end if;

  perform app.modo_servidor();
  update public.articulos set etapa = 'cancelado'
   where solicitud_id = p_solicitud and etapa <> 'cancelado';
  update public.solicitud_aprobaciones
     set es_vigente = false, estado = case when estado = 'pendiente' then 'anulada' else estado end
   where solicitud_id = p_solicitud and es_vigente;
  update public.solicitud_devoluciones
     set estado = 'negada', resuelta_por = auth.uid(), resuelta_en = now(),
         respuesta = coalesce(respuesta, 'La solicitud fue cancelada')
   where solicitud_id = p_solicitud and estado = 'pendiente';
  update public.solicitudes set estado = 'cancelada' where id = p_solicitud;
  perform app.auditar('solicitudes', p_solicitud::text, 'CANCELACION',
    jsonb_build_object('estado', v_sol.estado), jsonb_build_object('estado','cancelada'), p_motivo);
  if not v_es_dueno then
    perform app.notificar(v_sol.solicitante_id, 'cancelada', 'Solicitud cancelada: ' || v_sol.numero,
      'Motivo: ' || btrim(p_motivo), '/solicitudes/' || p_solicitud, p_solicitud, now(), 'cancel:' || p_solicitud, true);
  end if;
end $$;

-- Reprogramación (reemplaza la anterior).
--  · Borrador / corrección: el solicitante cambia la semana objetivo.
--  · Programada: el aprobador, Compras o administración de catálogos la mueve
--    a otro ciclo; se recalcula la fecha con el calendario.
create or replace function public.fn_reprogramar_semana(
  p_solicitud uuid, p_semana date, p_motivo text, p_version integer
) returns void language plpgsql security definer
set search_path = ''
as $$
declare
  v_sol public.solicitudes%rowtype;
  v_ciclo record;
  v_puede boolean;
begin
  if p_semana is null or extract(isodow from p_semana) <> 1 then
    raise exception 'La semana objetivo se identifica por su lunes.';
  end if;
  if char_length(btrim(coalesce(p_motivo,''))) < 3 then
    raise exception 'Indica el motivo de la reprogramación.';
  end if;
  select * into v_sol from public.solicitudes where id = p_solicitud for update;
  if not found then raise exception 'Solicitud no encontrada.'; end if;
  if v_sol.version <> p_version then
    raise exception 'La solicitud fue modificada en otra sesión. Recarga e intenta de nuevo.' using errcode = '40001';
  end if;

  if v_sol.estado::text in ('borrador','en_correccion') then
    if not (v_sol.solicitante_id = auth.uid() and app.es_activo()) then
      raise exception 'Solo el solicitante cambia la semana objetivo de su borrador.' using errcode = '42501';
    end if;
    if v_sol.semana_lunes = p_semana then return; end if;
    perform app.modo_servidor();
    update public.solicitudes set semana_lunes = p_semana where id = p_solicitud;
    perform app.auditar('solicitudes', p_solicitud::text, 'REPROGRAMACION',
      jsonb_build_object('semana_lunes', v_sol.semana_lunes), jsonb_build_object('semana_lunes', p_semana), p_motivo);
    return;
  end if;

  if v_sol.estado <> 'programada' then
    raise exception 'Solo se reprograman solicitudes en borrador, en corrección o programadas (aún no recibidas por Compras).';
  end if;
  v_puede := app.es_gestor() or app.puede_admin_catalogos()
          or exists (select 1 from public.solicitud_aprobaciones x
                     where x.solicitud_id = p_solicitud and x.es_vigente and x.aprobador_id = auth.uid());
  if not v_puede or not app.es_activo() then
    raise exception 'No tienes permiso para reprogramar esta solicitud.' using errcode = '42501';
  end if;

  select * into v_ciclo from app.calcular_ciclo(now(), v_sol.categoria_id, p_semana, v_sol.es_extraordinaria);
  perform app.modo_servidor();
  update public.solicitudes set
    semana_lunes = p_semana,
    fecha_programada_recepcion = v_ciclo.fecha_recepcion,
    liberacion_programada_en = v_ciclo.liberacion,
    cierre_ciclo_en = v_ciclo.cierre,
    origen_programacion = v_ciclo.origen
  where id = p_solicitud;
  perform app.auditar('solicitudes', p_solicitud::text, 'REPROGRAMACION',
    jsonb_build_object('semana_lunes', v_sol.semana_lunes, 'recepcion', v_sol.fecha_programada_recepcion),
    jsonb_build_object('semana_lunes', p_semana, 'recepcion', v_ciclo.fecha_recepcion), p_motivo);
  perform app.notificar(v_sol.solicitante_id, 'reprogramada',
    'Solicitud reprogramada: ' || v_sol.numero,
    'Nueva fecha de recepción por Compras: ' || to_char(v_ciclo.fecha_recepcion, 'DD/MM/YYYY') || '. Motivo: ' || btrim(p_motivo),
    '/solicitudes/' || p_solicitud, p_solicitud, now(),
    'reprog:' || p_solicitud || ':' || v_ciclo.fecha_recepcion || ':' || v_sol.version, true);
  if v_ciclo.liberacion <= now() then
    if app.liberar_solicitud(p_solicitud, 'reprogramacion') then
      perform app.encolar_avisos_recepcion('reprog:' || p_solicitud::text || ':' || v_sol.version);
    end if;
  end if;
end $$;

-- El solicitante ya no cancela artículos después del envío (pide devolución).
update public.etapa_transiciones
   set roles = '{compras,administrador}'
 where desde = 'solicitado' and hacia = 'cancelado';

-- Compras solo cotiza artículos de solicitudes que están en su bandeja.
create or replace function app.tg_cotizaciones_operativa()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  if not app.es_servidor() and not exists (
    select 1 from public.articulos a join public.solicitudes s on s.id = a.solicitud_id
    where a.id = new.articulo_id and app.estado_operativo(s.estado)) then
    raise exception 'La solicitud no está en la bandeja de Compras (pendiente de aprobación, programada o en corrección).';
  end if;
  return new;
end $$;

drop trigger if exists tg_cotizaciones_operativa on public.cotizaciones;
create trigger tg_cotizaciones_operativa
  before insert on public.cotizaciones
  for each row execute function app.tg_cotizaciones_operativa();

-- Avisos al solicitante por compra, cambio de llegada y movimientos físicos.
create or replace function app.tg_avisos_compra()
returns trigger language plpgsql security definer
set search_path = ''
as $$
declare
  v_art record;
begin
  select a.nombre, a.solicitud_id, s.solicitante_id, s.numero into v_art
  from public.articulos a join public.solicitudes s on s.id = a.solicitud_id
  where a.id = new.articulo_id;
  if tg_op = 'INSERT' then
    perform app.notificar(v_art.solicitante_id, 'comprado', 'Artículo comprado: ' || v_art.nombre,
      'Solicitud ' || v_art.numero || '. Llegada estimada: ' ||
      coalesce(to_char(new.fecha_estimada_llegada, 'DD/MM/YYYY'), 'sin información') || '.',
      '/solicitudes/' || v_art.solicitud_id, v_art.solicitud_id, now(), 'compra:' || new.id, true);
  elsif new.fecha_estimada_llegada is distinct from old.fecha_estimada_llegada then
    perform app.notificar(v_art.solicitante_id, 'llegada_cambio', 'Cambió la llegada estimada: ' || v_art.nombre,
      'Antes: ' || coalesce(to_char(old.fecha_estimada_llegada, 'DD/MM/YYYY'), 'sin información') ||
      ' · Ahora: ' || coalesce(to_char(new.fecha_estimada_llegada, 'DD/MM/YYYY'), 'sin información'),
      '/solicitudes/' || v_art.solicitud_id, v_art.solicitud_id, now(),
      'llegada:' || new.id || ':' || new.version, true);
  end if;
  return new;
end $$;

drop trigger if exists tg_avisos_compra on public.compras;
create trigger tg_avisos_compra after insert or update on public.compras
  for each row execute function app.tg_avisos_compra();

create or replace function app.tg_avisos_movimiento()
returns trigger language plpgsql security definer
set search_path = ''
as $$
declare
  v_art record;
  v_texto text;
begin
  select a.nombre, a.solicitud_id, s.solicitante_id, s.numero into v_art
  from public.articulos a join public.solicitudes s on s.id = a.solicitud_id
  where a.id = new.articulo_id;
  v_texto := case new.tipo
    when 'recepcion' then 'Llegó al almacén: '
    when 'entrega' then 'Entregado: '
    when 'devolucion_proveedor' then 'Devuelto al proveedor: '
    else 'Retornado al almacén: ' end;
  perform app.notificar(v_art.solicitante_id, 'movimiento_' || new.tipo,
    v_texto || v_art.nombre || ' (' || new.cantidad || ')',
    'Solicitud ' || v_art.numero || '. Fecha efectiva: ' || to_char(new.fecha_efectiva, 'DD/MM/YYYY') || '.',
    '/solicitudes/' || v_art.solicitud_id, v_art.solicitud_id, new.creado_en, 'mov:' || new.id,
    new.tipo in ('recepcion','entrega'));
  return new;
end $$;

drop trigger if exists tg_avisos_movimiento on public.movimientos;
create trigger tg_avisos_movimiento after insert on public.movimientos
  for each row execute function app.tg_avisos_movimiento();

-- ============================================================
-- G. ADMINISTRACIÓN: ESTRUCTURA Y PERMISOS GRANULARES
-- ============================================================
-- Roles que solo el administrador general puede otorgar o retirar.
create or replace function app.roles_privilegiados()
returns public.rol_app[] language sql immutable
set search_path = ''
as $$ select array['administrador','admin_usuarios','admin_catalogos','consulta_global','emergencias']::public.rol_app[]; $$;

-- ¿Puede quien llama gestionar a p_usuario (y otorgar p_roles)?
create or replace function app.puede_gestionar_usuario(p_usuario uuid, p_roles public.rol_app[])
returns boolean language plpgsql stable security definer
set search_path = ''
as $$
begin
  if app.es_admin() then return true; end if;
  if not app.tiene_rol('admin_usuarios') then return false; end if;
  -- No toca a quien tenga permisos privilegiados (ni a sí mismo en ese caso).
  if exists (select 1 from public.perfil_roles r
             where r.perfil_id = p_usuario and r.rol = any (app.roles_privilegiados())) then
    return false;
  end if;
  if p_roles is not null and exists (select 1 from unnest(p_roles) x where x = any (app.roles_privilegiados())) then
    return false;
  end if;
  return true;
end $$;

create or replace function public.fn_admin_cambiar_estado_usuario(
  p_usuario uuid, p_estado public.estado_perfil, p_motivo text, p_version integer
) returns void language plpgsql security definer
set search_path = ''
as $$
declare
  v_perfil public.perfiles%rowtype;
begin
  if not app.puede_gestionar_usuario(p_usuario, null) then
    raise exception 'No tienes permiso para gestionar esta cuenta (las cuentas con permisos de administración solo las gestiona el administrador general).' using errcode = '42501';
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
  if p_estado in ('desactivado','rechazado')
     and exists (select 1 from public.perfil_roles r where r.perfil_id = p_usuario and r.rol = 'administrador')
     and v_perfil.estado = 'activo'
     and app.admins_activos() <= 1 then
    raise exception 'No puedes desactivar al último administrador activo.';
  end if;
  if p_usuario = auth.uid() and p_estado in ('desactivado','rechazado') then
    raise exception 'No puedes desactivar tu propia cuenta.';
  end if;
  update public.perfiles set estado = p_estado, actualizado_en = now(), version = version + 1 where id = p_usuario;
  perform app.auditar('perfiles', p_usuario::text, 'CAMBIO_ESTADO',
    jsonb_build_object('estado', v_perfil.estado), jsonb_build_object('estado', p_estado), p_motivo);
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
  if not app.puede_gestionar_usuario(p_usuario, p_roles) then
    raise exception 'No tienes permiso para asignar esos permisos a esta cuenta. Los permisos de administración, consulta global y emergencias solo los asigna el administrador general.' using errcode = '42501';
  end if;
  select estado into v_estado from public.perfiles where id = p_usuario for update;
  if not found then raise exception 'Usuario no encontrado.'; end if;
  select coalesce(array_agg(rol order by rol), '{}') into v_actuales from public.perfil_roles where perfil_id = p_usuario;
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
  select distinct p_usuario, r, auth.uid() from unnest(coalesce(p_roles,'{}')) as r;
  perform app.auditar('perfil_roles', p_usuario::text, 'ROLES',
    jsonb_build_object('roles', to_jsonb(v_actuales)), jsonb_build_object('roles', to_jsonb(coalesce(p_roles,'{}'))), p_motivo);
end $$;

create or replace function public.fn_admin_activar_usuario(
  p_usuario uuid, p_roles public.rol_app[], p_area uuid, p_version integer
) returns void language plpgsql security definer
set search_path = ''
as $$
declare v_perfil public.perfiles%rowtype;
begin
  if not app.puede_gestionar_usuario(p_usuario, p_roles) then
    raise exception 'No tienes permiso para activar esta cuenta con esos permisos.' using errcode = '42501';
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
  update public.perfiles set estado = 'activo', area_id = p_area, actualizado_en = now(), version = version + 1 where id = p_usuario;
  delete from public.perfil_roles where perfil_id = p_usuario;
  insert into public.perfil_roles (perfil_id, rol, asignado_por)
  select distinct p_usuario, r, auth.uid() from unnest(p_roles) as r;
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
  if not (app.puede_admin_catalogos() or app.puede_gestionar_usuario(p_usuario, null)) then
    raise exception 'No tienes permiso para cambiar el área de esta cuenta.' using errcode = '42501';
  end if;
  select * into v_perfil from public.perfiles where id = p_usuario for update;
  if not found then raise exception 'Usuario no encontrado.'; end if;
  if p_version is not null and v_perfil.version <> p_version then
    raise exception 'El registro fue modificado por otra persona. Recarga e intenta de nuevo.' using errcode = '40001';
  end if;
  if p_area is not null and not exists (select 1 from public.areas a where a.id = p_area and a.activo) then
    raise exception 'El área indicada no existe o está inactiva.';
  end if;
  if v_perfil.area_id is not distinct from p_area then return; end if;
  update public.perfiles set area_id = p_area, actualizado_en = now(), version = version + 1 where id = p_usuario;
  perform app.auditar('perfiles', p_usuario::text, 'CAMBIO_AREA',
    jsonb_build_object('area_id', v_perfil.area_id), jsonb_build_object('area_id', p_area), p_motivo);
end $$;

-- Paso 1 de la estructura: jefe y ruta superior del área. Reasigna las
-- solicitudes PENDIENTES del área al nuevo aprobador (queda auditado).
create or replace function public.fn_admin_configurar_area(
  p_area uuid, p_jefe uuid, p_superior uuid, p_motivo text
) returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare
  v_area public.areas%rowtype;
  r record;
  v_nuevo uuid;
  v_ruta text;
  v_reasig integer := 0;
  v_sin integer := 0;
begin
  if not app.puede_admin_catalogos() then
    raise exception 'Solo administración de catálogos configura jefes de área.' using errcode = '42501';
  end if;
  select * into v_area from public.areas where id = p_area for update;
  if not found then raise exception 'Área no encontrada.'; end if;
  if p_jefe is not null and not exists (select 1 from public.perfiles p where p.id = p_jefe and p.estado = 'activo') then
    raise exception 'El jefe debe tener una cuenta activa.';
  end if;
  if p_superior is not null and not exists (select 1 from public.perfiles p where p.id = p_superior and p.estado = 'activo') then
    raise exception 'La ruta superior debe tener una cuenta activa.';
  end if;
  if p_superior is not null and p_superior = p_jefe then
    raise exception 'La ruta superior debe ser una persona distinta del jefe del área.';
  end if;

  perform app.modo_servidor();
  update public.areas set jefe_id = p_jefe, aprobador_superior_id = p_superior where id = p_area;
  perform app.auditar('areas', p_area::text, 'CONFIG_APROBADORES',
    jsonb_build_object('jefe_id', v_area.jefe_id, 'aprobador_superior_id', v_area.aprobador_superior_id),
    jsonb_build_object('jefe_id', p_jefe, 'aprobador_superior_id', p_superior), p_motivo);

  for r in
    select s.id, s.numero, s.solicitante_id, x.id as aprob_id, x.aprobador_id
    from public.solicitudes s
    join public.solicitud_aprobaciones x on x.solicitud_id = s.id and x.es_vigente and x.estado = 'pendiente'
    where s.area_id = p_area and s.estado = 'pendiente_aprobacion'
    for update of s
  loop
    begin
      select o_aprobador, o_ruta into v_nuevo, v_ruta from app.resolver_aprobador(r.solicitante_id, p_area);
      if v_nuevo <> r.aprobador_id then
        update public.solicitud_aprobaciones set aprobador_id = v_nuevo, ruta = v_ruta where id = r.aprob_id;
        update public.solicitudes set aprobador_jefe_id = v_nuevo where id = r.id;
        perform app.notificar(v_nuevo, 'aprobacion_pendiente', 'Solicitud por aprobar (reasignada): ' || r.numero,
          'Se te asignó como aprobador por cambio en la estructura del área.',
          '/aprobacion-solicitudes', r.id, now(), 'reasig:' || r.aprob_id || ':' || v_nuevo, true);
        v_reasig := v_reasig + 1;
      end if;
    exception when others then
      -- Sin aprobador válido: la aprobación del jefe anterior se anula y la
      -- solicitud vuelve al solicitante (no pasa a Compras), con aviso.
      perform app.modo_servidor();
      update public.solicitud_aprobaciones set es_vigente = false, estado = 'anulada' where id = r.aprob_id;
      update public.solicitudes set estado = 'en_correccion', aprobador_jefe_id = null where id = r.id;
      insert into public.solicitud_devoluciones (solicitud_id, iniciada_por, motivo, etapa, estado, resuelta_por, resuelta_en)
      values (r.id, auth.uid(), 'Cambió la estructura del área y no hay aprobador configurado', 'pendiente_aprobacion',
              'aplicada_directa', auth.uid(), now());
      perform app.notificar(r.solicitante_id, 'devuelta', 'Solicitud sin aprobador: ' || r.numero,
        'Cambió la estructura de tu área y por ahora no hay quién apruebe. Reenvíala cuando administración configure el aprobador.',
        '/solicitudes/' || r.id, r.id, now(), 'sinaprob:' || r.aprob_id, true);
      v_sin := v_sin + 1;
    end;
  end loop;
  return jsonb_build_object('ok', true, 'reasignadas', v_reasig, 'sin_aprobador', v_sin);
end $$;

-- Paso 2: vincular solicitantes (y cualquier usuario) a un área.
create or replace function public.fn_admin_vincular_area(p_area uuid, p_usuarios uuid[], p_motivo text)
returns integer language plpgsql security definer
set search_path = ''
as $$
declare
  v_u uuid;
  v_n integer := 0;
begin
  if not (app.puede_admin_catalogos() or app.puede_admin_usuarios()) then
    raise exception 'No tienes permiso para vincular usuarios a áreas.' using errcode = '42501';
  end if;
  if p_area is not null and not exists (select 1 from public.areas a where a.id = p_area and a.activo) then
    raise exception 'El área indicada no existe o está inactiva.';
  end if;
  foreach v_u in array coalesce(p_usuarios, '{}') loop
    perform public.fn_admin_cambiar_area_usuario(v_u, p_area, coalesce(p_motivo, 'Vinculación al área desde Estructura'), null);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Asociación área ↔ centro de costo en bloque (asistente de configuración).
create or replace function public.fn_admin_asociar_cc(p_cc uuid, p_areas uuid[], p_activo boolean)
returns integer language plpgsql security definer
set search_path = ''
as $$
declare
  v_a uuid;
  v_n integer := 0;
begin
  if not app.puede_admin_catalogos() then
    raise exception 'Solo administración de catálogos asocia centros de costo.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.centros_costo c where c.id = p_cc) then
    raise exception 'Centro de costo no encontrado.';
  end if;
  foreach v_a in array coalesce(p_areas, '{}') loop
    insert into public.area_centros_costo (area_id, centro_costo_id, activo)
    values (v_a, p_cc, coalesce(p_activo, true))
    on conflict (area_id, centro_costo_id) do update set activo = excluded.activo;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ============================================================
-- H. PERFIL, HISTORIAL, INDICADORES Y VISTAS
-- ============================================================
-- Mismo contrato que antes (id, nombre, correo, estado, area_id, roles)
-- más campos nuevos al final. La sesión del frontend no cambia.
create or replace function public.fn_mi_perfil()
returns jsonb language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'nombre', p.nombre, 'correo', p.correo, 'estado', p.estado,
    'area_id', p.area_id,
    'roles', coalesce((select jsonb_agg(r.rol order by r.rol)
                       from public.perfil_roles r where r.perfil_id = p.id), '[]'::jsonb),
    'area_nombre', (select a.nombre from public.areas a where a.id = p.area_id),
    'es_jefe', (p.estado = 'activo' and (
                  exists (select 1 from public.areas a where a.activo and (a.jefe_id = p.id or a.aprobador_superior_id = p.id))
                  or exists (select 1 from public.solicitud_aprobaciones x where x.aprobador_id = p.id))),
    'notificaciones_sin_leer', (select count(*) from public.notificaciones n
                                where n.destinatario_id = p.id and n.leida_en is null)
  )
  from public.perfiles p where p.id = auth.uid();
$$;

-- Historial comprensible de estados de una solicitud.
create or replace function public.fn_historial_solicitud(p_solicitud uuid)
returns table (evento_en timestamptz, tipo text, descripcion text, actor text, motivo text)
language sql stable security definer
set search_path = ''
as $$
  with e as (
    select s.creado_en as evento_en, 'creacion'::text as tipo, 'Borrador creado' as descripcion,
           s.solicitante_id as actor_id, null::text as motivo
      from public.solicitudes s where s.id = p_solicitud
    union all
    select v.enviado_en, 'envio', 'Enviada a aprobación (versión ' || v.version || ')', v.enviado_por, v.motivo
      from public.solicitud_versiones v where v.solicitud_id = p_solicitud
    union all
    select x.decidido_en,
           'decision_' || x.estado,
           case x.estado when 'aprobada' then 'Aprobada'
                         when 'devuelta' then 'Devuelta para corrección'
                         when 'rechazada' then 'Rechazada' else x.estado end
             || ' por ' || case x.ruta when 'ruta_superior' then 'la ruta superior' else 'el jefe de área' end
             || ' (versión ' || x.version || ')',
           x.decidido_por, x.motivo
      from public.solicitud_aprobaciones x
     where x.solicitud_id = p_solicitud and x.decidido_en is not null
    union all
    select d.creado_en, 'devolucion_pedida', 'El solicitante pidió una devolución', d.iniciada_por, d.motivo
      from public.solicitud_devoluciones d where d.solicitud_id = p_solicitud and d.estado <> 'aplicada_directa'
    union all
    select d.resuelta_en, 'devolucion_' || d.estado,
           case d.estado when 'autorizada' then 'Devolución autorizada' else 'Devolución no autorizada' end,
           d.resuelta_por, d.respuesta
      from public.solicitud_devoluciones d
     where d.solicitud_id = p_solicitud and d.estado in ('autorizada','negada')
    union all
    select a.creado_en, lower(a.accion),
           case a.accion
             when 'RECEPCION_COMPRAS' then 'Recibida por Compras'
             when 'A_CORRECCION' then 'Compras la devolvió para corrección'
             when 'CANCELACION' then 'Cancelada'
             when 'REPROGRAMACION' then 'Reprogramada'
             when 'ENVIO' then 'Enviada a Compras (flujo anterior, sin aprobación previa)'
             else a.accion end,
           a.actor, a.motivo
      from public.auditoria a
     where a.tabla = 'solicitudes' and a.registro_id = p_solicitud::text
       and a.accion in ('RECEPCION_COMPRAS','A_CORRECCION','CANCELACION','REPROGRAMACION','ENVIO')
  )
  select e.evento_en, e.tipo, e.descripcion, coalesce(p.nombre, 'Sistema'), e.motivo
  from e left join public.perfiles p on p.id = e.actor_id
  where app.puede_ver_solicitud(p_solicitud) and e.evento_en is not null
  order by e.evento_en;
$$;

drop view if exists public.v_solicitudes;
create view public.v_solicitudes
with (security_invoker = true) as
select
  s.id, s.numero, s.estado, s.solicitante_id, p.nombre as solicitante_nombre,
  s.area_id, ar.nombre as area_nombre,
  s.centro_costo_id, cc.codigo as centro_costo_codigo, cc.nombre as centro_costo_nombre,
  s.justificacion, s.semana_lunes, s.fecha_declarada, s.origen,
  s.creado_en, s.enviado_en, s.actualizado_en, s.version,
  (select count(*) from public.articulos a where a.solicitud_id = s.id) as total_articulos,
  (select count(*) from public.articulos a where a.solicitud_id = s.id and a.etapa = 'cerrado') as articulos_cerrados,
  (select count(*) from public.articulos a where a.solicitud_id = s.id and a.etapa = 'cancelado') as articulos_cancelados,
  (select jsonb_object_agg(e.etapa, e.n) from (
      select a.etapa::text as etapa, count(*) as n
      from public.articulos a where a.solicitud_id = s.id group by a.etapa) e) as resumen_etapas,
  -- Nuevos (v2)
  s.flujo, s.categoria_id, cat.nombre as categoria_nombre,
  s.es_extraordinaria, s.motivo_extraordinaria,
  s.aprobador_jefe_id, pj.nombre as aprobador_jefe_nombre,
  s.ultimo_envio_en, s.aprobado_en, s.fecha_programada_recepcion, s.liberacion_programada_en,
  s.cierre_ciclo_en, s.origen_programacion, s.recibida_compras_en, s.version_contenido,
  app.estado_operativo(s.estado) as en_bandeja_compras,
  (select x.motivo from public.solicitud_aprobaciones x
    where x.solicitud_id = s.id and x.estado in ('devuelta','rechazada')
    order by x.decidido_en desc limit 1) as ultimo_motivo_jefe,
  (select d.motivo from public.solicitud_devoluciones d
    where d.solicitud_id = s.id and d.estado in ('autorizada','aplicada_directa')
    order by coalesce(d.resuelta_en, d.creado_en) desc limit 1) as ultimo_motivo_devolucion,
  exists (select 1 from public.solicitud_devoluciones d
          where d.solicitud_id = s.id and d.estado = 'pendiente') as devolucion_pendiente,
  (select min(a.fecha_requerida) from public.articulos a
    where a.solicitud_id = s.id and a.etapa <> 'cancelado') as fecha_requerida_min
from public.solicitudes s
left join public.perfiles p on p.id = s.solicitante_id
left join public.perfiles pj on pj.id = s.aprobador_jefe_id
left join public.areas ar on ar.id = s.area_id
left join public.centros_costo cc on cc.id = s.centro_costo_id
left join public.categorias_solicitud cat on cat.id = s.categoria_id;

drop view if exists public.v_articulos;
create view public.v_articulos
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
    when c.fecha_estimada_llegada is null then null
    when coalesce(m.pendiente_llegada, c.cantidad) <= 0 then 0
    when c.fecha_estimada_llegada < (now() at time zone 'America/Bogota')::date
      then ((now() at time zone 'America/Bogota')::date - c.fecha_estimada_llegada)
    else 0
  end as dias_atraso,
  (select count(*) from public.novedades n
    where n.articulo_id = a.id and n.estado <> 'resuelta') as novedades_abiertas,
  (select count(*) from public.adjuntos ad
    where ad.entidad = 'articulo' and ad.entidad_id = a.id) as adjuntos,
  -- Nuevos (v2)
  a.enlace_referencia, a.proveedor_sugerido,
  s.recibida_compras_en, s.fecha_programada_recepcion, s.flujo, s.es_extraordinaria,
  app.estado_operativo(s.estado) as en_bandeja_compras
from public.articulos a
join public.solicitudes s on s.id = a.solicitud_id
left join public.perfiles ps on ps.id = s.solicitante_id
left join public.areas ar on ar.id = coalesce(a.area_id, s.area_id)
left join public.centros_costo cc on cc.id = coalesce(a.centro_costo_id, s.centro_costo_id)
left join public.perfiles pa on pa.id = a.aprobador_id
left join public.compras c on c.articulo_id = a.id
left join public.proveedores pr on pr.id = c.proveedor_id
left join lateral app.saldos_articulo(a.id) m on true;

-- Bandeja del jefe: solicitudes pendientes asignadas a quien consulta.
create or replace view public.v_aprobaciones_solicitud
with (security_invoker = true) as
select x.id as aprobacion_id, x.solicitud_id, x.version, x.aprobador_id, x.ruta, x.estado,
       x.es_vigente, x.motivo, x.solicitada_en, x.decidido_en,
       s.numero, s.estado as solicitud_estado, s.solicitante_id, p.nombre as solicitante_nombre,
       s.area_id, ar.nombre as area_nombre, cc.codigo as centro_costo_codigo, cc.nombre as centro_costo_nombre,
       s.justificacion, s.semana_lunes, s.es_extraordinaria, s.motivo_extraordinaria,
       s.categoria_id, s.creado_en, s.ultimo_envio_en
from public.solicitud_aprobaciones x
join public.solicitudes s on s.id = x.solicitud_id
left join public.perfiles p on p.id = s.solicitante_id
left join public.areas ar on ar.id = s.area_id
left join public.centros_costo cc on cc.id = s.centro_costo_id;

-- Tiempos y anticipación (fechas distintas, nunca sustituidas entre sí).
create or replace view public.v_tiempos_solicitud
with (security_invoker = true) as
select
  s.id, s.numero, s.area_id, s.centro_costo_id, s.es_extraordinaria, s.flujo,
  s.creado_en, s.enviado_en, s.ultimo_envio_en, s.aprobado_en,
  s.fecha_programada_recepcion, s.recibida_compras_en,
  (select min(a.fecha_requerida) from public.articulos a where a.solicitud_id = s.id) as fecha_requerida_min,
  (select min(c.creado_en) from public.compras c join public.articulos a on a.id = c.articulo_id
    where a.solicitud_id = s.id) as primera_compra_en,
  (select max(c.llegada_completa_en) from public.compras c join public.articulos a on a.id = c.articulo_id
    where a.solicitud_id = s.id) as ultima_llegada_completa_en,
  -- Anticipación del solicitante: días entre la creación real y la fecha requerida.
  ((select min(a.fecha_requerida) from public.articulos a where a.solicitud_id = s.id)
     - (s.creado_en at time zone 'America/Bogota')::date) as anticipacion_dias,
  extract(epoch from (s.aprobado_en - s.ultimo_envio_en)) / 3600.0 as horas_envio_aprobacion,
  extract(epoch from (s.recibida_compras_en - s.aprobado_en)) / 3600.0 as horas_aprobacion_recepcion,
  -- Tiempos de Compras: SIEMPRE desde la recepción efectiva.
  extract(epoch from ((select min(c.creado_en) from public.compras c join public.articulos a on a.id = c.articulo_id
                        where a.solicitud_id = s.id) - s.recibida_compras_en)) / 3600.0 as horas_recepcion_compra
from public.solicitudes s
where s.enviado_en is not null;

-- Compras extraordinarias (frecuencia y gasto).
create or replace view public.v_extraordinarias
with (security_invoker = true) as
select s.id, s.numero, s.estado, s.solicitante_id, p.nombre as solicitante_nombre,
       s.area_id, ar.nombre as area_nombre, s.motivo_extraordinaria,
       (select pp.nombre from public.solicitud_aprobaciones x join public.perfiles pp on pp.id = x.decidido_por
         where x.solicitud_id = s.id and x.estado = 'aprobada' order by x.decidido_en desc limit 1) as autorizado_por,
       s.creado_en, s.ultimo_envio_en, s.aprobado_en, s.recibida_compras_en,
       (select sum(c.total) from public.compras c join public.articulos a on a.id = c.articulo_id
         where a.solicitud_id = s.id and c.moneda = 'COP') as total_cop,
       (select count(*) from public.compras c join public.articulos a on a.id = c.articulo_id
         where a.solicitud_id = s.id and c.moneda <> 'COP') as compras_otras_monedas
from public.solicitudes s
left join public.perfiles p on p.id = s.solicitante_id
left join public.areas ar on ar.id = s.area_id
where s.es_extraordinaria;

-- Resumen del tablero (invoker: cada quien cuenta solo lo que puede ver).
create or replace function public.fn_resumen_tablero()
returns jsonb language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'pendientes', (select count(*) from public.v_articulos v
                   where v.en_bandeja_compras and v.etapa in ('solicitado','en_cotizacion','cotizado')),
    'por_aprobar', (select count(*) from public.v_articulos v where v.estado_aprobacion = 'pendiente'),
    'atrasados', (select count(*) from public.v_articulos v where coalesce(v.dias_atraso, 0) > 0),
    'por_llegar', (select count(*) from public.v_articulos v
                   where v.etapa in ('comprado','en_transito','recibido_parcial')),
    'en_almacen', (select count(*) from public.v_articulos v where coalesce(v.disponible_almacen,0) > 0),
    'entregados', (select count(*) from public.v_articulos v where coalesce(v.entregado_neto,0) > 0),
    'novedades_abiertas', (select count(*) from public.novedades n where n.estado <> 'resuelta'),
    -- v2
    'aprobaciones_jefe_mias', (select count(*) from public.solicitud_aprobaciones x
                               where x.aprobador_id = auth.uid() and x.es_vigente and x.estado = 'pendiente'),
    'pendientes_aprobacion', (select count(*) from public.solicitudes s where s.estado = 'pendiente_aprobacion'),
    'programadas', (select count(*) from public.solicitudes s where s.estado = 'programada'),
    'pendientes_entrega', (select count(*) from public.v_articulos v
                           where coalesce(v.disponible_almacen,0) > 0
                             and coalesce(v.entregado_neto,0) < coalesce(v.cantidad_comprada, v.cantidad)),
    'mis_devueltas', (select count(*) from public.solicitudes s
                      where s.solicitante_id = auth.uid() and s.estado = 'en_correccion')
  );
$$;

-- Indicadores por período (invoker: respeta permisos).
create or replace function public.fn_indicadores(p_desde date, p_hasta date)
returns jsonb language sql stable
set search_path = ''
as $$
  with t as (
    select * from public.v_tiempos_solicitud
    where (creado_en at time zone 'America/Bogota')::date between p_desde and p_hasta
  )
  select jsonb_build_object(
    'solicitudes_enviadas', (select count(*) from t),
    'anticipacion_promedio_dias', (select round(avg(anticipacion_dias)::numeric, 1) from t where anticipacion_dias is not null),
    'anticipacion_con_dato', (select count(*) from t where anticipacion_dias is not null),
    'horas_envio_aprobacion', (select round(avg(horas_envio_aprobacion)::numeric, 1) from t where horas_envio_aprobacion is not null),
    'horas_aprobacion_recepcion', (select round(avg(horas_aprobacion_recepcion)::numeric, 1) from t where horas_aprobacion_recepcion is not null),
    'horas_recepcion_compra', (select round(avg(horas_recepcion_compra)::numeric, 1) from t where horas_recepcion_compra is not null),
    'extraordinarias', (select count(*) from public.v_extraordinarias e
                        where (e.creado_en at time zone 'America/Bogota')::date between p_desde and p_hasta),
    'extraordinarias_total_cop', (select coalesce(sum(e.total_cop), 0) from public.v_extraordinarias e
                        where (e.creado_en at time zone 'America/Bogota')::date between p_desde and p_hasta),
    'extraordinarias_por_area', (select coalesce(jsonb_agg(jsonb_build_object('area', x.area, 'n', x.n, 'total_cop', x.total)), '[]'::jsonb)
                        from (select coalesce(e.area_nombre,'Sin área') as area, count(*) as n, coalesce(sum(e.total_cop),0) as total
                              from public.v_extraordinarias e
                              where (e.creado_en at time zone 'America/Bogota')::date between p_desde and p_hasta
                              group by 1 order by 2 desc) x),
    'gasto_por_area_cc', (select coalesce(jsonb_agg(jsonb_build_object('area', g.area_nombre, 'cc', g.centro_costo_codigo,
                                   'moneda', g.moneda, 'total', g.total)), '[]'::jsonb)
                        from (select v.area_nombre, v.centro_costo_codigo, v.moneda, sum(v.total) as total
                              from public.v_costos_gestionados v
                              where v.fecha_compra between p_desde and p_hasta
                              group by 1, 2, 3 order by 4 desc) g)
  );
$$;

-- ============================================================
-- I. SERVICIO DE CORREO (solo service_role; lo usa la función despachar-correos)
-- ============================================================
create or replace function public.srv_correo_reclamar(p_limite integer)
returns setof public.correos_cola language plpgsql security definer
set search_path = ''
as $$
begin
  -- Correos con más de 48 h sin enviarse no salen (evita avalanchas tardías);
  -- la notificación dentro de la app se conserva.
  update public.correos_cola set estado = 'descartado', ultimo_error = coalesce(ultimo_error, 'Vencido (más de 48 h en cola)')
   where (estado in ('pendiente','error') and creado_en < now() - interval '48 hours')
      or (estado = 'enviando' and bloqueado_hasta < now() and intentos >= 5);

  return query
  update public.correos_cola c
     set estado = 'enviando', intentos = c.intentos + 1, bloqueado_hasta = now() + interval '5 minutes'
   where c.id in (
     select q.id from public.correos_cola q
      where (q.estado in ('pendiente','error') and q.proximo_intento <= now() and q.intentos < 5)
         or (q.estado = 'enviando' and q.bloqueado_hasta < now() and q.intentos < 5)
      order by q.id
      limit greatest(1, least(coalesce(p_limite, 20), 25))
      for update skip locked)
  returning c.*;
end $$;

create or replace function public.srv_correo_resultado(p_id bigint, p_ok boolean, p_error text)
returns void language plpgsql security definer
set search_path = ''
as $$
begin
  update public.correos_cola set
    estado = case when p_ok then 'enviado' when intentos >= 5 then 'descartado' else 'error' end,
    enviado_en = case when p_ok then now() else enviado_en end,
    ultimo_error = case when p_ok then null else left(coalesce(p_error,'Error desconocido'), 500) end,
    proximo_intento = case when p_ok then proximo_intento
                           else now() + (interval '5 minutes' * power(2, greatest(intentos - 1, 0))) end,
    bloqueado_hasta = null
  where id = p_id and estado = 'enviando';
end $$;

-- ============================================================
-- J. BARRERAS ADICIONALES (revisión independiente)
-- ============================================================
-- Ninguna operación de Compras sobre un artículo cuya solicitud no esté en
-- su bandeja operativa, aunque la ejecute una función del servidor
-- (fn_cambiar_etapa, fn_seleccionar_cotizacion, fn_registrar_compra,
-- fn_configurar_aprobacion). Se valida SIEMPRE, también en modo servidor.
create or replace function app.tg_articulos_operativa_v2()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  if (new.etapa is distinct from old.etapa and new.etapa::text in ('en_cotizacion','cotizado','comprado','en_transito'))
     or new.requiere_aprobacion is distinct from old.requiere_aprobacion
     or new.aprobador_id is distinct from old.aprobador_id then
    if not exists (select 1 from public.solicitudes s
                   where s.id = new.solicitud_id and app.estado_operativo(s.estado)) then
      raise exception 'La solicitud no está en la bandeja de Compras (pendiente de aprobación, programada o en corrección).';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists tg_articulos_operativa_v2 on public.articulos;
create trigger tg_articulos_operativa_v2
  before update on public.articulos
  for each row execute function app.tg_articulos_operativa_v2();

create or replace function app.tg_compras_operativa_v2()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.articulos a join public.solicitudes s on s.id = a.solicitud_id
                 where a.id = new.articulo_id and app.estado_operativo(s.estado)) then
    raise exception 'No se registra la compra: la solicitud no está aprobada y recibida por Compras.';
  end if;
  return new;
end $$;

drop trigger if exists tg_compras_operativa_v2 on public.compras;
create trigger tg_compras_operativa_v2
  before insert on public.compras
  for each row execute function app.tg_compras_operativa_v2();

-- Consulta de saldos e historial con la MISMA regla de visibilidad que
-- las tablas (Compras no consulta artículos de solicitudes no liberadas).
create or replace function public.fn_saldos_articulo(p_articulo uuid)
returns jsonb language plpgsql stable security definer
set search_path = ''
as $$
declare s record;
begin
  if not app.puede_ver_articulo(p_articulo) then
    raise exception 'Sin permiso para consultar este artículo.' using errcode = '42501';
  end if;
  select * into s from app.saldos_articulo(p_articulo);
  return to_jsonb(s);
end $$;

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
  where app.puede_ver_articulo(p_articulo)
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
-- 0016_permisos_v2.sql · Mejora v2 — privilegios mínimos
-- Requiere 0013–0015. Idempotente.
-- ============================================================

-- Supabase concede por defecto TODO (incluido TRUNCATE) sobre las tablas
-- nuevas a anon y authenticated. Se retira primero y luego se concede lo
-- mínimo. (Un ALTER DEFAULT PRIVILEGES ... IN SCHEMA no anula ese permiso
-- por defecto, por eso se hace explícito aquí.)
revoke all on
  public.area_centros_costo, public.unidades_medida, public.categorias_solicitud,
  public.ventanas_recepcion, public.calendario_config, public.calendario_no_habiles,
  public.solicitud_versiones, public.solicitud_aprobaciones, public.solicitud_devoluciones,
  public.notificaciones, public.correos_cola, public.liberaciones_log,
  public.v_solicitudes, public.v_articulos, public.v_aprobaciones_solicitud,
  public.v_tiempos_solicitud, public.v_extraordinarias
from anon, authenticated;

-- Lectura (RLS filtra filas) de tablas y vistas nuevas.
grant select on
  public.area_centros_costo, public.unidades_medida, public.categorias_solicitud,
  public.ventanas_recepcion, public.calendario_config, public.calendario_no_habiles,
  public.solicitud_versiones, public.solicitud_aprobaciones, public.solicitud_devoluciones,
  public.notificaciones, public.correos_cola, public.liberaciones_log,
  public.v_solicitudes, public.v_articulos, public.v_aprobaciones_solicitud,
  public.v_tiempos_solicitud, public.v_extraordinarias
to authenticated;

-- Escritura directa solo en catálogos (RLS exige administración de catálogos;
-- los disparadores de auditoría registran cada cambio).
grant insert, update, delete on
  public.area_centros_costo, public.unidades_medida, public.categorias_solicitud,
  public.ventanas_recepcion, public.calendario_no_habiles
to authenticated;
grant update on public.calendario_config to authenticated;

-- Versiones, aprobaciones, devoluciones, notificaciones, correos y bitácora:
-- SOLO mediante funciones del servidor (no se concede escritura alguna).

-- Nada para anon.
revoke all on all tables in schema public from anon;

-- Funciones públicas (RPC): solo usuarios autenticados; cada una revalida.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as firma
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'fn\_%' escape '\'
  loop
    execute format('revoke all on function %s from public, anon', f.firma);
    execute format('grant execute on function %s to authenticated', f.firma);
  end loop;
end $$;

-- Servicio de correo: exclusivamente service_role (función despachar-correos).
revoke all on function public.srv_correo_reclamar(integer) from public, anon, authenticated;
revoke all on function public.srv_correo_resultado(bigint, boolean, text) from public, anon, authenticated;
grant execute on function public.srv_correo_reclamar(integer) to service_role;
grant execute on function public.srv_correo_resultado(bigint, boolean, text) to service_role;

-- Esquema app: por defecto PostgreSQL da EXECUTE a PUBLIC en cada función
-- nueva; se retira a PUBLIC/anon y se concede solo lo que usan políticas,
-- vistas y disparadores que se ejecutan con el rol del usuario. Las
-- concesiones explícitas a authenticated de 0012 se conservan.
revoke execute on all functions in schema app from public, anon;
-- Igual que en 0012: authenticated puede ejecutar las funciones de app que
-- usan políticas, vistas y disparadores (el esquema app NO se expone por la
-- API); enseguida se retiran las operaciones internas.
grant execute on all functions in schema app to authenticated;

grant execute on function
  app.perfil_relacionado(uuid),
  app.es_habil(date),
  app.puede_admin_usuarios(), app.puede_admin_catalogos(), app.puede_consultar_global(),
  app.es_jefe(), app.es_aprobador_de_solicitud(uuid), app.puede_ver_solicitud(uuid),
  app.puede_ver_articulo(uuid), app.cc_permitido(uuid, uuid),
  app.estado_operativo(public.estado_solicitud), app.roles_privilegiados(),
  app.puede_ver_entidad_adjunto(public.entidad_adjunto, uuid),
  app.puede_adjuntar_entidad(public.entidad_adjunto, uuid)
to authenticated;

-- Operaciones internas: NUNCA invocables directamente por usuarios.
revoke all on function app.calcular_ciclo(timestamptz, uuid, date, boolean) from public, anon, authenticated;
revoke all on function app.notificar(uuid, text, text, text, text, uuid, timestamptz, text, boolean) from public, anon, authenticated;
revoke all on function app.notificar_compras(text, text, text, text, uuid, timestamptz, text, boolean) from public, anon, authenticated;
revoke all on function app.snapshot_solicitud(uuid) from public, anon, authenticated;
revoke all on function app.resolver_aprobador(uuid, uuid) from public, anon, authenticated;
revoke all on function app.enviar_a_aprobacion(uuid, text) from public, anon, authenticated;
revoke all on function app.liberar_solicitud(uuid, text) from public, anon, authenticated;
revoke all on function app.encolar_avisos_recepcion(text) from public, anon, authenticated;
revoke all on function app.job_liberar(text) from public, anon, authenticated;
revoke all on function app.aplicar_devolucion(uuid, text) from public, anon, authenticated;
revoke all on function app.puede_gestionar_usuario(uuid, public.rol_app[]) from public, anon, authenticated;
revoke all on function app.modo_servidor() from public, anon, authenticated;
revoke all on function app.fijar_motivo(text) from public, anon, authenticated;
revoke all on function app.auditar(text,text,text,jsonb,jsonb,text) from public, anon, authenticated;
revoke all on function app.op_guardar(uuid,text,jsonb) from public, anon, authenticated;
revoke all on function app.op_existente(uuid) from public, anon, authenticated;
revoke all on function app.actualizar_etapa_fisica(uuid) from public, anon, authenticated;

-- Nota para versiones futuras: toda función nueva debe revocar EXECUTE a
-- PUBLIC explícitamente (como arriba); no se modifica la configuración
-- global de privilegios por defecto para no afectar extensiones.
-- Fin de setup_mejora_v2.sql
