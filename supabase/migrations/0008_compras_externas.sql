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
