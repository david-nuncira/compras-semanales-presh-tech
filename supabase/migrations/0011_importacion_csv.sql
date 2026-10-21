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
