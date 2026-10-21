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
