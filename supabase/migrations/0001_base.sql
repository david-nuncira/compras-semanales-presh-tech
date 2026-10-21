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
