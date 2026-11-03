-- 0017_financiero.sql. Requiere mejora v2 (0013-0016) ya aplicada.
-- Adición transaccional; conserva calendario, jerarquía y datos existentes.
begin;
create table if not exists public.configuracion_aprobaciones (
 id boolean primary key default true check(id), gerente_id uuid references public.perfiles(id),
 suplente_id uuid references public.perfiles(id), umbral_cop numeric not null default 500000 check(umbral_cop=500000),
 actualizado_en timestamptz not null default now()
);
insert into public.configuracion_aprobaciones(id) values(true) on conflict do nothing;
alter table public.configuracion_aprobaciones enable row level security;
drop policy if exists config_aprobaciones_select on public.configuracion_aprobaciones;
create policy config_aprobaciones_select on public.configuracion_aprobaciones for select to authenticated using(app.es_activo());
grant select on public.configuracion_aprobaciones to authenticated;
alter table public.adjuntos add column if not exists cotizacion_id uuid references public.cotizaciones(id) on delete restrict;
create index if not exists adjuntos_cotizacion on public.adjuntos(cotizacion_id);

create or replace function app.aprobador_gerencia(p_articulo uuid)
returns uuid language plpgsql stable security definer set search_path='' as $$
declare solicitante uuid; config public.configuracion_aprobaciones%rowtype;
begin
 select s.solicitante_id into solicitante from public.articulos a join public.solicitudes s on s.id=a.solicitud_id where a.id=p_articulo;
 select * into config from public.configuracion_aprobaciones where id=true;
 if config.gerente_id is not null and config.gerente_id<>solicitante and app.rol_de(config.gerente_id,'aprobador') then return config.gerente_id; end if;
 if config.suplente_id is not null and config.suplente_id<>solicitante and app.rol_de(config.suplente_id,'aprobador') then return config.suplente_id; end if;
 raise exception 'Configura a Yeffer o al gerente suplente como aprobador activo, distinto del solicitante.';
end $$;
create or replace function app.exigir_aprobacion_jefe(p_articulo uuid)
returns void language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.articulos a join public.solicitudes s on s.id=a.solicitud_id where a.id=p_articulo and app.estado_operativo(s.estado) and s.recibida_compras_en is not null) then
  raise exception 'El jefe de área debe aprobar la solicitud antes de pasar a Compras.';
 end if;
end $$;
create or replace function app.snapshot_financiero(p_articulo uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('articulo',a.nombre,'descripcion',a.descripcion,'unidad',a.unidad,
 'cotizacion_id',q.id,'proveedor_id',coalesce(c.proveedor_id,q.proveedor_id),'moneda',coalesce(c.moneda,q.moneda)::text,
 'precio_unitario',coalesce(c.precio_unitario,q.precio_unitario),'cantidad',coalesce(c.cantidad,q.cantidad),
 'impuestos',coalesce(c.impuestos,q.impuestos),'descuentos',coalesce(c.descuentos,q.descuentos),'otros_cargos',coalesce(c.otros_cargos,q.otros_cargos),
 'total_estimado',coalesce(c.total,round(q.precio_unitario*q.cantidad,2)+q.impuestos+q.otros_cargos-q.descuentos),
 'adjuntos',coalesce((select jsonb_agg(jsonb_build_object('id',ad.id,'ruta',ad.ruta,'nombre',ad.nombre_original) order by ad.id) from public.adjuntos ad where ad.cotizacion_id=q.id),'[]'::jsonb))
 from public.articulos a left join public.cotizaciones q on q.articulo_id=a.id and q.es_seleccionada
 left join public.compras c on c.articulo_id=a.id where a.id=p_articulo;
$$;
create or replace function app.encolar_gerencia(p_articulo uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare gerente uuid; snap jsonb; ap public.aprobaciones%rowtype; result uuid;
begin
 perform 1 from public.articulos where id=p_articulo for update;
 gerente:=app.aprobador_gerencia(p_articulo); snap:=app.snapshot_financiero(p_articulo);
 if snap->>'total_estimado' is null then raise exception 'Selecciona una cotización o registra un importe primero.'; end if;
 select * into ap from public.aprobaciones where articulo_id=p_articulo and es_vigente;
 if found and ap.estado in('pendiente','aprobada') and ap.aprobador_id=gerente and ap.version_aprobada=snap then return ap.id; end if;
 perform app.modo_servidor();
 update public.articulos set requiere_aprobacion=true,aprobador_id=gerente where id=p_articulo;
 update public.aprobaciones set es_vigente=false,estado=case when estado='pendiente' then 'reemplazada' else estado end where articulo_id=p_articulo and es_vigente;
 insert into public.aprobaciones(articulo_id,aprobador_id,solicitada_por,version_aprobada) values(p_articulo,gerente,auth.uid(),snap) returning id into result;
 return result;
end $$;
-- Conserva los contratos históricos internamente; no expone RPC que evadan la regla.
do $$ begin
 if to_regprocedure('app.legacy_seleccionar_cotizacion(uuid,integer)') is null then
  alter function public.fn_seleccionar_cotizacion(uuid,integer) set schema app;
  alter function app.fn_seleccionar_cotizacion(uuid,integer) rename to legacy_seleccionar_cotizacion;
 end if;
 if to_regprocedure('app.legacy_registrar_compra(uuid,numeric,date,numeric,numeric,numeric,text,date,integer,uuid)') is null then
  alter function public.fn_registrar_compra(uuid,numeric,date,numeric,numeric,numeric,text,date,integer,uuid) set schema app;
  alter function app.fn_registrar_compra(uuid,numeric,date,numeric,numeric,numeric,text,date,integer,uuid) rename to legacy_registrar_compra;
 end if;
 if to_regprocedure('app.legacy_actualizar_compra(uuid,numeric,numeric,numeric,numeric,numeric,text,text,integer)') is null then
  alter function public.fn_actualizar_compra(uuid,numeric,numeric,numeric,numeric,numeric,text,text,integer) set schema app;
  alter function app.fn_actualizar_compra(uuid,numeric,numeric,numeric,numeric,numeric,text,text,integer) rename to legacy_actualizar_compra;
 end if;
end $$;
revoke all on function app.legacy_seleccionar_cotizacion(uuid,integer),app.legacy_registrar_compra(uuid,numeric,date,numeric,numeric,numeric,text,date,integer,uuid),app.legacy_actualizar_compra(uuid,numeric,numeric,numeric,numeric,numeric,text,text,integer) from public,anon,authenticated;

create or replace function public.fn_seleccionar_cotizacion(p_cotizacion uuid,p_version_articulo integer)
returns void language plpgsql security definer set search_path='' as $$
declare q public.cotizaciones%rowtype; art public.articulos%rowtype; importe numeric;
begin
 if not app.es_gestor() then raise exception 'Solo Compras selecciona cotizaciones.' using errcode='42501'; end if;
 select * into q from public.cotizaciones where id=p_cotizacion;
 if not found then raise exception 'Cotización no encontrada.'; end if;
 select * into art from public.articulos where id=q.articulo_id for update;
 perform app.exigir_aprobacion_jefe(art.id);
 perform app.legacy_seleccionar_cotizacion(p_cotizacion,p_version_articulo);
 importe:=round(q.precio_unitario*q.cantidad,2)+q.impuestos+q.otros_cargos-q.descuentos;
 if importe<0 then raise exception 'El total de la cotización no puede ser negativo.'; end if;
 if q.moneda<>'COP' or importe>500000 then perform app.encolar_gerencia(art.id);
 else
  perform app.modo_servidor();
  update public.articulos set requiere_aprobacion=false,aprobador_id=null where id=art.id;
  update public.aprobaciones set es_vigente=false,estado=case when estado='pendiente' then 'reemplazada' else estado end where articulo_id=art.id and es_vigente;
 end if;
end $$;
create or replace function public.fn_configurar_aprobacion(p_articulo uuid,p_requiere boolean,p_aprobador uuid,p_version integer)
returns void language plpgsql security definer set search_path='' as $$
begin
 raise exception 'La aprobación se calcula automáticamente al seleccionar la cotización: gerencia por encima de $500.000 COP; el jefe de área revisa antes del envío a Compras.';
end $$;
create or replace function public.fn_solicitar_aprobacion(p_articulo uuid,p_op uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare snap jsonb; result uuid; res jsonb;
begin
 if not app.es_gestor() then raise exception 'Solo Compras solicita aprobaciones.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_op::text,0));
 select resultado into res from public.operaciones where op_id=p_op and actor=auth.uid() and funcion='fn_solicitar_aprobacion'; if res is not null then return res; end if;
 perform 1 from public.articulos where id=p_articulo for update;
 perform app.exigir_aprobacion_jefe(p_articulo); snap:=app.snapshot_financiero(p_articulo);
 if snap->>'moneda'='COP' and (snap->>'total_estimado')::numeric<=500000 then raise exception 'Esta compra no requiere aprobación adicional de gerencia.'; end if;
 result:=app.encolar_gerencia(p_articulo);res:=jsonb_build_object('ok',true,'aprobacion_id',result);
 perform app.op_guardar(p_op,'fn_solicitar_aprobacion',res);return res;
end $$;
create or replace function public.fn_decidir_aprobacion(p_aprobacion uuid,p_aprobar boolean,p_comentario text,p_op uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ap public.aprobaciones%rowtype; aid uuid; res jsonb; solicitante uuid;
begin
 if not app.tiene_rol('aprobador') then raise exception 'Requiere aprobador activo.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_op::text,0));
 select resultado into res from public.operaciones where op_id=p_op and actor=auth.uid() and funcion='fn_decidir_aprobacion';if res is not null then return res; end if;
 select articulo_id into aid from public.aprobaciones where id=p_aprobacion;
 perform 1 from public.articulos where id=aid for update;
 select * into ap from public.aprobaciones where id=p_aprobacion for update;
 if not found or ap.aprobador_id<>auth.uid() then raise exception 'Solo el aprobador designado puede decidir.' using errcode='42501';end if;
 select s.solicitante_id into solicitante from public.articulos a join public.solicitudes s on s.id=a.solicitud_id where a.id=aid;
 if solicitante=auth.uid() then raise exception 'No puedes aprobar tu propia solicitud.';end if;
 if not ap.es_vigente or ap.estado<>'pendiente' then raise exception 'La aprobación ya fue decidida o reemplazada.';end if;
 perform app.exigir_aprobacion_jefe(aid);
 if p_aprobar is null then raise exception 'Indica la decisión.';end if;
 if not p_aprobar and nullif(btrim(p_comentario),'') is null then raise exception 'Indica el motivo del rechazo.';end if;
 if ap.version_aprobada is distinct from app.snapshot_financiero(aid) then raise exception 'Los importes o soportes cambiaron. Compras debe solicitar una nueva aprobación.';end if;
 update public.aprobaciones set estado=case when p_aprobar then 'aprobada'::public.estado_aprobacion else 'rechazada'::public.estado_aprobacion end,comentario=nullif(btrim(p_comentario),''),decidido_en=now() where id=p_aprobacion;
 perform app.auditar('aprobaciones',p_aprobacion::text,case when p_aprobar then 'APROBADA' else 'RECHAZADA' end,null,jsonb_build_object('estado',case when p_aprobar then 'aprobada' else 'rechazada' end),p_comentario);
 res:=jsonb_build_object('ok',true);perform app.op_guardar(p_op,'fn_decidir_aprobacion',res);return res;
end $$;
create or replace function public.fn_registrar_compra(p_articulo uuid,p_cantidad numeric,p_fecha_compra date,p_impuestos numeric,p_descuentos numeric,p_otros_cargos numeric,p_referencia text,p_fecha_estimada date,p_version_articulo integer,p_op uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare snap jsonb; ap public.aprobaciones%rowtype; q public.cotizaciones%rowtype; importe numeric; res jsonb;
begin
 if not app.es_gestor() then raise exception 'Solo Compras registra compras.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_op::text,0));
 select resultado into res from public.operaciones where op_id=p_op and actor=auth.uid() and funcion='fn_registrar_compra';if res is not null then return res; end if;
 perform 1 from public.articulos where id=p_articulo for update;
 perform app.exigir_aprobacion_jefe(p_articulo);
 select * into q from public.cotizaciones where articulo_id=p_articulo and es_seleccionada;
 if not found then raise exception 'Selecciona cotización o usa Compra directa para importes de hasta $500.000 COP.';end if;
 importe:=round(q.precio_unitario*p_cantidad,2)+coalesce(p_impuestos,0)+coalesce(p_otros_cargos,0)-coalesce(p_descuentos,0);
 if q.moneda<>'COP' or importe>500000 then
  select * into ap from public.aprobaciones where articulo_id=p_articulo and es_vigente;
  snap:=app.snapshot_financiero(p_articulo);
  if not found or ap.estado<>'aprobada' or ap.version_aprobada is distinct from snap then raise exception 'La compra requiere aprobación vigente de gerencia con los mismos importes y soportes.';end if;
  if (snap->>'cantidad')::numeric is distinct from p_cantidad or (snap->>'impuestos')::numeric is distinct from coalesce(p_impuestos,0) or (snap->>'descuentos')::numeric is distinct from coalesce(p_descuentos,0) or (snap->>'otros_cargos')::numeric is distinct from coalesce(p_otros_cargos,0) then raise exception 'La compra difiere de la aprobación. Actualiza cotización y solicita nuevamente.';end if;
 end if;
 return app.legacy_registrar_compra(p_articulo,p_cantidad,p_fecha_compra,p_impuestos,p_descuentos,p_otros_cargos,p_referencia,p_fecha_estimada,p_version_articulo,p_op);
end $$;

create or replace function public.fn_registrar_compra_directa(p_articulo uuid,p_proveedor uuid,p_precio_unitario numeric,p_cantidad numeric,p_impuestos numeric,p_descuentos numeric,p_otros_cargos numeric,p_fecha_compra date,p_referencia text,p_fecha_estimada date,p_version_articulo integer,p_op uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare art public.articulos%rowtype; importe numeric; subtotal numeric; cid uuid; res jsonb;
begin
 if not app.es_gestor() then raise exception 'Solo Compras registra compras.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_op::text,0));
 select resultado into res from public.operaciones where op_id=p_op and actor=auth.uid() and funcion='fn_registrar_compra_directa';if res is not null then return res;end if;
 select * into art from public.articulos where id=p_articulo for update;
 if not found or art.version<>p_version_articulo then raise exception 'El artículo cambió. Recarga antes de comprar.' using errcode='40001';end if;
 perform app.exigir_aprobacion_jefe(p_articulo);
 if art.etapa not in('solicitado','en_cotizacion','cotizado') then raise exception 'El artículo no está disponible para comprar.';end if;
 if exists(select 1 from public.compras where articulo_id=p_articulo) then raise exception 'El artículo ya tiene una compra.';end if;
 if exists(select 1 from public.cotizaciones where articulo_id=p_articulo and es_seleccionada) then raise exception 'Existe una cotización seleccionada. Registra la compra a partir de ella.';end if;
 if not exists(select 1 from public.proveedores where id=p_proveedor and activo) then raise exception 'Selecciona un proveedor activo.';end if;
 if p_precio_unitario is null or p_precio_unitario<0 or p_cantidad is null or p_cantidad<=0 or coalesce(p_impuestos,0)<0 or coalesce(p_descuentos,0)<0 or coalesce(p_otros_cargos,0)<0 or p_fecha_compra is null then raise exception 'Revisa cantidad, importes y fecha de compra.';end if;
 if round(p_precio_unitario,2)<>p_precio_unitario or round(p_cantidad,2)<>p_cantidad then raise exception 'Usa como máximo dos decimales.';end if;
 subtotal:=round(p_precio_unitario*p_cantidad,2);importe:=subtotal+coalesce(p_impuestos,0)+coalesce(p_otros_cargos,0)-coalesce(p_descuentos,0);
 if importe<0 or importe>500000 then raise exception 'La compra directa permite hasta $500.000 COP. Registra una cotización para la aprobación de gerencia si supera el límite.';end if;
 perform app.modo_servidor();
 update public.articulos set requiere_aprobacion=false,aprobador_id=null where id=p_articulo;
 update public.aprobaciones set es_vigente=false,estado=case when estado='pendiente' then 'reemplazada' else estado end where articulo_id=p_articulo and es_vigente;
 insert into public.compras(articulo_id,proveedor_id,moneda,precio_unitario,cantidad,subtotal,impuestos,descuentos,otros_cargos,total,fecha_compra,referencia,fecha_estimada_llegada,responsable_id)
 values(p_articulo,p_proveedor,'COP',p_precio_unitario,p_cantidad,subtotal,coalesce(p_impuestos,0),coalesce(p_descuentos,0),coalesce(p_otros_cargos,0),importe,p_fecha_compra,nullif(btrim(p_referencia),''),p_fecha_estimada,auth.uid()) returning id into cid;
 if p_fecha_estimada is not null then insert into public.compra_fechas_estimadas(compra_id,fecha_estimada,motivo) values(cid,p_fecha_estimada,'Registro inicial de compra directa');end if;
 update public.articulos set etapa='comprado' where id=p_articulo;
 perform app.auditar('compras',cid::text,'COMPRA_DIRECTA',null,jsonb_build_object('total',importe,'moneda','COP','articulo_id',p_articulo),null);
 res:=jsonb_build_object('ok',true,'compra_id',cid,'total',importe);perform app.op_guardar(p_op,'fn_registrar_compra_directa',res);return res;
end $$;
create or replace function public.fn_actualizar_compra(p_compra uuid,p_cantidad numeric,p_precio_unitario numeric,p_impuestos numeric,p_descuentos numeric,p_otros_cargos numeric,p_referencia text,p_motivo text,p_version integer)
returns void language plpgsql security definer set search_path='' as $$
declare c public.compras%rowtype; material boolean; importe numeric;
begin
 if not app.es_gestor() then raise exception 'Solo Compras modifica compras.' using errcode='42501';end if;
 select * into c from public.compras where id=p_compra;
 if not found then raise exception 'Compra no encontrada.';end if;
 perform 1 from public.articulos where id=c.articulo_id for update;
 select * into c from public.compras where id=p_compra for update;
 perform app.exigir_aprobacion_jefe(c.articulo_id);
 material:=p_cantidad is distinct from c.cantidad or p_precio_unitario is distinct from c.precio_unitario or coalesce(p_impuestos,0) is distinct from c.impuestos or coalesce(p_descuentos,0) is distinct from c.descuentos or coalesce(p_otros_cargos,0) is distinct from c.otros_cargos;
 perform app.legacy_actualizar_compra(p_compra,p_cantidad,p_precio_unitario,p_impuestos,p_descuentos,p_otros_cargos,p_referencia,p_motivo,p_version);
 importe:=round(p_precio_unitario*p_cantidad,2)+coalesce(p_impuestos,0)+coalesce(p_otros_cargos,0)-coalesce(p_descuentos,0);
 if material then
  if c.moneda<>'COP' or importe>500000 then perform app.encolar_gerencia(c.articulo_id);
  else
   perform app.modo_servidor();
   update public.articulos set requiere_aprobacion=false,aprobador_id=null where id=c.articulo_id;
   update public.aprobaciones set es_vigente=false,estado=case when estado='pendiente' then 'reemplazada' else estado end where articulo_id=c.articulo_id and es_vigente;
  end if;
 end if;
end $$;
create or replace function app.aprobacion_bloquea(p_articulo uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select a.requiere_aprobacion and not exists(select 1 from public.aprobaciones ap where ap.articulo_id=a.id and ap.es_vigente and ap.estado='aprobada' and ap.version_aprobada=app.snapshot_financiero(a.id)) from public.articulos a where a.id=p_articulo),true);
$$;

-- Ningún cliente puede modificar una cotización seleccionada: conserva su evidencia.
create or replace function app.tg_cotizacion_evidencia()
returns trigger language plpgsql security definer set search_path='' as $$
declare aid uuid;
begin
 aid:=case when tg_op='DELETE' then old.articulo_id else new.articulo_id end;
 perform 1 from public.articulos where id=aid for update;
 perform app.exigir_aprobacion_jefe(aid);
 if tg_op='DELETE' then
  if app.cotizacion_evidencia_fija(old.id) then raise exception 'La cotización seleccionada se conserva como evidencia. Crea otra alternativa.';end if;
  return old;
 end if;
 if tg_op='UPDATE' then
  if old.articulo_id<>new.articulo_id then raise exception 'La cotización no puede cambiar de artículo.';end if;
  if app.cotizacion_evidencia_fija(old.id) and (new.proveedor_id is distinct from old.proveedor_id or new.moneda is distinct from old.moneda or new.precio_unitario is distinct from old.precio_unitario or new.cantidad is distinct from old.cantidad or new.impuestos is distinct from old.impuestos or new.descuentos is distinct from old.descuentos or new.otros_cargos is distinct from old.otros_cargos or new.notas is distinct from old.notas) then
   raise exception 'La cotización seleccionada conserva sus importes y notas. Crea y selecciona otra alternativa para una nueva aprobación.';
  end if;
 end if;
 if round(new.precio_unitario*new.cantidad,2)+new.impuestos+new.otros_cargos-new.descuentos<0 then raise exception 'El total de la cotización no puede ser negativo.';end if;
 return new;
end $$;
drop trigger if exists tg_00_cotizacion_evidencia on public.cotizaciones;
create trigger tg_00_cotizacion_evidencia before insert or update or delete on public.cotizaciones for each row execute function app.tg_cotizacion_evidencia();
create or replace function public.fn_registrar_adjunto_cotizacion(p_cotizacion uuid,p_ruta text,p_nombre_original text,p_mime text,p_tamano bigint,p_op uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.cotizaciones%rowtype; e public.entidad_adjunto; aid uuid; adj uuid;res jsonb;
begin
 if not app.es_gestor() then raise exception 'Solo Compras adjunta soportes de cotización.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_op::text,0));
 select resultado into res from public.operaciones where op_id=p_op and actor=auth.uid() and funcion='fn_registrar_adjunto_cotizacion';if res is not null then return res;end if;
 select * into q from public.cotizaciones where id=p_cotizacion;
 if not found then raise exception 'Cotización no encontrada.';end if;
 perform 1 from public.articulos where id=q.articulo_id for update;
 select * into q from public.cotizaciones where id=p_cotizacion for update;
 perform app.exigir_aprobacion_jefe(q.articulo_id);
 if app.cotizacion_evidencia_fija(q.id) or exists(select 1 from public.compras where articulo_id=q.articulo_id) then raise exception 'Los soportes seleccionados se conservan. Crea una cotización alternativa para cambiar la evidencia.';end if;
 select o_entidad,o_id into e,aid from app.ruta_entidad(p_ruta);
 if e<>'articulo' or aid<>q.articulo_id then raise exception 'La ruta no corresponde al artículo de la cotización.';end if;
 if p_mime not in('image/jpeg','image/png','image/webp','application/pdf') or p_tamano is null or p_tamano<=0 or p_tamano>app.config_num('max_tamano_adjunto_mb',5)*1024*1024 then raise exception 'Revisa el tipo y tamaño del archivo (JPG, PNG, WebP o PDF; máximo 5 MB).';end if;
 if not exists(select 1 from storage.objects where bucket_id='adjuntos' and name=p_ruta) then raise exception 'El archivo aún no existe en almacenamiento.';end if;
 if (select count(*) from public.adjuntos where cotizacion_id=q.id)>=3 then raise exception 'Máximo tres soportes por cotización.';end if;
 insert into public.adjuntos(entidad,entidad_id,cotizacion_id,ruta,nombre_original,mime,tamano_bytes,subido_por)
 values('articulo',q.articulo_id,q.id,p_ruta,left(coalesce(p_nombre_original,'archivo'),200),p_mime,p_tamano,auth.uid()) returning id into adj;
 res:=jsonb_build_object('ok',true,'adjunto_id',adj);perform app.op_guardar(p_op,'fn_registrar_adjunto_cotizacion',res);return res;
end $$;

create or replace function app.cotizacion_evidencia_fija(p_cotizacion uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.cotizaciones q where q.id=p_cotizacion and(q.es_seleccionada or exists(select 1 from public.aprobaciones ap where ap.articulo_id=q.articulo_id and ap.version_aprobada->>'cotizacion_id'=q.id::text) or exists(select 1 from public.compras c where c.cotizacion_id=q.id)));
$$;
-- Los soportes de una cotización enviada no se borran ni sustituyen en el historial.
create or replace function app.tg_adjunto_evidencia_fija()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.cotizacion_id is not null and app.cotizacion_evidencia_fija(old.cotizacion_id) then raise exception 'Este soporte forma parte de una cotización seleccionada o aprobada y se conserva como evidencia. Crea una alternativa para cambiarlo.';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
drop trigger if exists tg_adjunto_evidencia_fija on public.adjuntos;
create trigger tg_adjunto_evidencia_fija before update or delete on public.adjuntos for each row execute function app.tg_adjunto_evidencia_fija();
-- La validación de Storage se aplica también si el cliente intenta borrar el objeto sin la fila.
create or replace function app.storage_puede_subir(p_ruta text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare e public.entidad_adjunto; i uuid; maximo integer;
begin
 begin select o_entidad,o_id into e,i from app.ruta_entidad(p_ruta);exception when others then return false;end;
 if e='articulo' then
  maximo:=app.config_num('max_adjuntos_por_articulo',3)::integer+3*(select count(*)::integer from public.cotizaciones where articulo_id=i);
  if(select count(*) from public.adjuntos where entidad='articulo' and entidad_id=i)>=maximo then return false;end if;
 end if;
 return app.puede_adjuntar_entidad(e,i);
end $$;
create or replace function app.storage_puede_borrar(p_ruta text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare e public.entidad_adjunto; i uuid; creador uuid; cot uuid;
begin
 begin select o_entidad,o_id into e,i from app.ruta_entidad(p_ruta);exception when others then return false;end;
 select subido_por,cotizacion_id into creador,cot from public.adjuntos where ruta=p_ruta;
 if cot is not null and app.cotizacion_evidencia_fija(cot) then return false;end if;
 if creador is null then return app.puede_adjuntar_entidad(e,i);end if;
 return app.es_admin() or(creador=auth.uid() and app.puede_adjuntar_entidad(e,i));
end $$;

alter table public.perfiles add column if not exists cargo text;
alter table public.perfiles add column if not exists jefe_id uuid references public.perfiles(id);
create or replace function public.fn_admin_configurar_persona(p_usuario uuid,p_cargo text,p_jefe uuid,p_area uuid,p_version integer)
returns void language plpgsql security definer set search_path='' as $$
declare actual uuid;
begin
 if not app.es_admin() then raise exception 'Solo administración modifica la organización.' using errcode='42501';end if;
 perform 1 from public.perfiles where id=p_usuario and version=p_version for update;
 if not found then raise exception 'El perfil cambió. Recarga.' using errcode='40001';end if;
 if p_jefe=p_usuario then raise exception 'La persona no puede ser su propio jefe.';end if;
 if p_jefe is not null and not exists(select 1 from public.perfiles where id=p_jefe and estado='activo') then raise exception 'El jefe debe tener una cuenta activa.';end if;
 if p_area is not null and not exists(select 1 from public.areas where id=p_area and activo) then raise exception 'Área no disponible.';end if;
 if char_length(coalesce(p_cargo,''))>160 then raise exception 'Cargo demasiado largo.';end if;
 actual:=p_jefe;
 for i in 1..40 loop
  exit when actual is null;
  if actual=p_usuario then raise exception 'La relación produce un ciclo de jefes.';end if;
  select jefe_id into actual from public.perfiles where id=actual;
  if i=40 and actual is not null then raise exception 'Revisa la cadena de jefes.';end if;
 end loop;
 update public.perfiles set cargo=nullif(btrim(p_cargo),''),jefe_id=p_jefe,area_id=p_area,version=version+1,actualizado_en=now() where id=p_usuario;
end $$;
create or replace function public.fn_admin_configurar_gerencia(p_gerente uuid,p_suplente uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not app.es_admin() then raise exception 'Solo administración configura gerencia.' using errcode='42501';end if;
 if p_gerente is not null and not app.rol_de(p_gerente,'aprobador') then raise exception 'Gerencia debe tener permiso de aprobador activo.';end if;
 if p_suplente is not null and not app.rol_de(p_suplente,'aprobador') then raise exception 'El suplente debe tener permiso de aprobador activo.';end if;
 if p_gerente is not null and p_gerente=p_suplente then raise exception 'El suplente debe ser otra persona.';end if;
 update public.configuracion_aprobaciones set gerente_id=p_gerente,suplente_id=p_suplente,actualizado_en=now() where id;
 perform app.auditar('configuracion_aprobaciones','true','GERENCIA',null,jsonb_build_object('gerente_id',p_gerente,'suplente_id',p_suplente),null);
end $$;
create or replace function public.fn_configuracion_aprobaciones()
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('gerente_id',gerente_id,'suplente_id',suplente_id,'umbral_cop',umbral_cop) from public.configuracion_aprobaciones where id and app.es_activo();
$$;
-- Contrato v2 conservado: o_ruta usa jefe_area/ruta_superior incluso con jefe individual.
create or replace function app.resolver_aprobador(p_solicitante uuid,p_area uuid,out o_aprobador uuid,out o_ruta text)
language plpgsql stable security definer set search_path='' as $$
declare a public.areas%rowtype; individual uuid;
begin
 select * into a from public.areas where id=p_area and activo;
 if not found then raise exception 'El área no está disponible.';end if;
 select jefe_id into individual from public.perfiles where id=p_solicitante;
 o_aprobador:=coalesce(individual,a.jefe_id);o_ruta:='jefe_area';
 if o_aprobador is null or o_aprobador=p_solicitante or not exists(select 1 from public.perfiles where id=o_aprobador and estado='activo') then
  o_aprobador:=a.aprobador_superior_id;o_ruta:='ruta_superior';
 end if;
 if o_aprobador is null or o_aprobador=p_solicitante or not exists(select 1 from public.perfiles where id=o_aprobador and estado='activo') then raise exception 'No hay jefe o ruta superior activa y distinta del solicitante. Pide a administración configurarla; la solicitud queda en borrador.';end if;
end $$;

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
  perform pg_advisory_xact_lock(hashtextextended(p_op::text,0));
  select resultado into v_res from public.operaciones where op_id=p_op and actor=auth.uid() and funcion='fn_registrar_adjunto';
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
    perform 1 from public.articulos where id=p_entidad_id for update;
    v_max_n := app.config_num('max_adjuntos_por_articulo', 3);
    if (select count(*) from public.adjuntos a
        where a.entidad = 'articulo' and a.entidad_id = p_entidad_id and a.cotizacion_id is null) >= v_max_n then
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


create or replace view public.v_usuarios_admin with(security_invoker=true) as
 select p.id,p.nombre,p.correo,p.estado,p.area_id,a.nombre as area_nombre,p.creado_en,p.actualizado_en,p.version,
 coalesce((select array_agg(r.rol order by r.rol) from public.perfil_roles r where r.perfil_id=p.id),'{}') as roles,
 p.cargo,p.jefe_id
 from public.perfiles p left join public.areas a on a.id=p.area_id;
create or replace function app.es_jefe()
returns boolean language sql stable security definer set search_path='' as $$
 select app.es_activo() and(exists(select 1 from public.areas a where a.activo and(a.jefe_id=auth.uid() or a.aprobador_superior_id=auth.uid())) or exists(select 1 from public.perfiles p where p.jefe_id=auth.uid()) or exists(select 1 from public.solicitud_aprobaciones x where x.aprobador_id=auth.uid()));
$$;
create or replace function public.fn_mi_perfil()
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',p.id,'nombre',p.nombre,'correo',p.correo,'estado',p.estado,'area_id',p.area_id,
 'roles',coalesce((select jsonb_agg(r.rol order by r.rol) from public.perfil_roles r where r.perfil_id=p.id),'[]'::jsonb),
 'area_nombre',(select a.nombre from public.areas a where a.id=p.area_id),'es_jefe',app.es_jefe(),
 'notificaciones_sin_leer',(select count(*) from public.notificaciones n where n.destinatario_id=p.id and n.leida_en is null),
 'cargo',p.cargo,'jefe_id',p.jefe_id)
 from public.perfiles p where p.id=auth.uid();
$$;
revoke all on public.configuracion_aprobaciones from public,anon,authenticated;
grant select on public.configuracion_aprobaciones to authenticated;
revoke all on function app.aprobador_gerencia(uuid),app.exigir_aprobacion_jefe(uuid),app.snapshot_financiero(uuid),app.encolar_gerencia(uuid),app.cotizacion_evidencia_fija(uuid) from public,anon,authenticated;
revoke all on function app.tg_cotizacion_evidencia(),app.tg_adjunto_evidencia_fija() from public,anon,authenticated;
-- Solo los helpers que usan políticas/vistas conservan EXECUTE de authenticated.
revoke all on function app.storage_puede_subir(text),app.storage_puede_borrar(text),app.aprobacion_bloquea(uuid),app.es_jefe() from public,anon;
grant execute on function app.storage_puede_subir(text),app.storage_puede_borrar(text),app.aprobacion_bloquea(uuid),app.es_jefe() to authenticated;
do $$ declare f record;begin
 for f in select p.oid::regprocedure as firma from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('fn_admin_configurar_persona','fn_admin_configurar_gerencia','fn_configuracion_aprobaciones','fn_registrar_compra_directa','fn_registrar_adjunto_cotizacion','fn_seleccionar_cotizacion','fn_configurar_aprobacion','fn_solicitar_aprobacion','fn_decidir_aprobacion','fn_registrar_compra','fn_actualizar_compra','fn_registrar_adjunto','fn_mi_perfil') loop
 execute format('revoke all on function %s from public,anon',f.firma);
 execute format('grant execute on function %s to authenticated',f.firma);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
