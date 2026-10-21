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
