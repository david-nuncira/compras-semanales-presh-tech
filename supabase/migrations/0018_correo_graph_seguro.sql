-- 0018_correo_graph_seguro.sql
-- Delta sobre V2. Reutiliza notificaciones/correos_cola; no crea otra bandeja.
begin;
alter table public.correos_cola add column if not exists reclamo_id uuid;
alter table public.correos_cola add column if not exists iniciado_en timestamptz;
alter table public.correos_cola add column if not exists request_id uuid;
alter table public.correos_cola drop constraint if exists correo_estado;
alter table public.correos_cola add constraint correo_estado
 check(estado in('pendiente','enviando','enviado','error','descartado','incierto'));
revoke insert,update,delete,truncate,references,trigger on public.correos_cola from public,anon,authenticated;

-- Conserva la firma V2, con fuente autoritativa de correo y enlaces internos.
create or replace function app.notificar(
 p_dest uuid,p_tipo text,p_titulo text,p_cuerpo text,p_enlace text,
 p_sol uuid,p_evento timestamptz,p_clave text,p_correo boolean
) returns void language plpgsql security definer set search_path='' as $$
declare v_correo text;v_url text;v_enlace text;
begin
 if p_dest is null or p_clave is null then return; end if;
 if not exists(select 1 from public.perfiles where id=p_dest and estado='activo') then return; end if;
 v_enlace:=case when p_enlace ~ '^/[a-z0-9/-]*$' and p_enlace !~ '^//' then p_enlace else '/notificaciones' end;
 insert into public.notificaciones(destinatario_id,tipo,titulo,cuerpo,enlace,solicitud_id,evento_en,clave_dedupe)
 values(p_dest,p_tipo,left(p_titulo,200),p_cuerpo,v_enlace,p_sol,coalesce(p_evento,now()),p_clave)
 on conflict(clave_dedupe) do nothing;
 if p_correo and app.config_bool('correo_habilitado',false) then
  select email into v_correo from auth.users where id=p_dest;
  if v_correo ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
   v_url:=rtrim(coalesce((select valor#>>'{}' from public.configuracion where clave='url_aplicacion'),''),'/');
   if v_url !~ '^https://[a-zA-Z0-9.-]+(:[0-9]+)?$' then v_url:=''; end if;
   insert into public.correos_cola(destinatario_id,correo,asunto,cuerpo_texto,clave_dedupe)
   values(p_dest,v_correo,'[Compras Semanales] '||left(p_titulo,150),coalesce(p_cuerpo,'')||
    case when v_url<>'' then E'\n\nAbrir: '||v_url||v_enlace else '' end||
    E'\n\nFecha del evento: '||to_char(coalesce(p_evento,now()) at time zone 'America/Bogota','DD/MM/YYYY HH24:MI')||
    E'\n\nMensaje automático. Revisa y decide dentro de la aplicación.','correo:'||p_clave)
   on conflict(clave_dedupe) do nothing;
  end if;
 end if;
end $$;
revoke all on function app.notificar(uuid,text,text,text,text,uuid,timestamptz,text,boolean) from public,anon,authenticated;

create or replace function public.srv_correo_reclamar(p_limite integer)
returns setof public.correos_cola language plpgsql security definer set search_path='' as $$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Operación exclusiva del servicio de correo.'; end if;
 if not app.config_bool('correo_habilitado',false) then return; end if;
 -- Graph sendMail no ofrece clave de idempotencia: nunca reenviar automáticamente
 -- un lote que pudo salir. Su estado exige conciliación con Elementos enviados.
 update public.correos_cola set estado='incierto',ultimo_error='El envío comenzó pero no fue confirmado. Revisar el buzón antes de reenviar.',
 bloqueado_hasta=null,reclamo_id=null
 where estado='enviando' and bloqueado_hasta<now() and iniciado_en is not null;
 update public.correos_cola set estado='error',bloqueado_hasta=null,reclamo_id=null,proximo_intento=now()
 where estado='enviando' and bloqueado_hasta<now() and iniciado_en is null;
 update public.correos_cola c set estado='descartado',ultimo_error='Aviso vencido, intentos agotados o cuenta de destino modificada.'
 where c.estado in('pendiente','error') and(c.creado_en<now()-interval '48 hours' or c.intentos>=5
 or not exists(select 1 from public.perfiles p join auth.users u on u.id=p.id
 where p.id=c.destinatario_id and p.estado='activo' and lower(btrim(u.email))=lower(btrim(c.correo))));
 return query update public.correos_cola c set estado='enviando',intentos=c.intentos+1,
 bloqueado_hasta=now()+interval '5 minutes',reclamo_id=gen_random_uuid(),request_id=gen_random_uuid(),iniciado_en=null
 where c.id in(select q.id from public.correos_cola q where q.estado in('pendiente','error')
 and q.proximo_intento<=now() and q.intentos<5 order by q.id
 limit greatest(1,least(coalesce(p_limite,5),5)) for update skip locked) returning c.*;
end $$;
revoke all on function public.srv_correo_reclamar(integer) from public,anon,authenticated;
grant execute on function public.srv_correo_reclamar(integer) to service_role;

create or replace function public.srv_correo_autorizar_envio(p_id bigint,p_reclamo_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Operación exclusiva del servicio de correo.'; end if;
 if not app.config_bool('correo_habilitado',false) then return false; end if;
 update public.correos_cola c set iniciado_en=now()
 where c.id=p_id and c.reclamo_id=p_reclamo_id and c.estado='enviando'
 and c.bloqueado_hasta>now() and c.iniciado_en is null and exists(
 select 1 from public.perfiles p join auth.users u on u.id=p.id where p.id=c.destinatario_id
 and p.estado='activo' and lower(btrim(u.email))=lower(btrim(c.correo)));
 return found;
end $$;
revoke all on function public.srv_correo_autorizar_envio(bigint,uuid) from public,anon,authenticated;
grant execute on function public.srv_correo_autorizar_envio(bigint,uuid) to service_role;

create or replace function public.srv_correo_confirmar(p_id bigint,p_reclamo_id uuid,p_resultado text,p_error text default null)
returns void language plpgsql security definer set search_path='' as $$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Operación exclusiva del servicio de correo.'; end if;
 if p_resultado is null or p_resultado not in('aceptado','error','incierto') then raise exception 'Resultado de envío no válido.'; end if;
 update public.correos_cola set estado=case when p_resultado='aceptado' then 'enviado' when p_resultado='incierto' then 'incierto'
 when intentos>=5 then 'descartado' else 'error' end,
 enviado_en=case when p_resultado='aceptado' then now() else enviado_en end,
 ultimo_error=case when p_resultado='aceptado' then null else left(coalesce(p_error,'Envío sin confirmar.'),500) end,
 proximo_intento=case when p_resultado='error' then now()+interval '5 minutes'*power(2,greatest(intentos-1,0)) else proximo_intento end,
 bloqueado_hasta=null,reclamo_id=null
 where id=p_id and reclamo_id=p_reclamo_id and estado='enviando'
 and(p_resultado<>'aceptado' or iniciado_en is not null);
 if not found then raise exception 'El lote cambió o ya fue confirmado.'; end if;
end $$;
revoke all on function public.srv_correo_confirmar(bigint,uuid,text,text) from public,anon,authenticated;
grant execute on function public.srv_correo_confirmar(bigint,uuid,text,text) to service_role;
-- El worker antiguo no identifica el reclamo y podría confirmar envíos de otro proceso.
revoke all on function public.srv_correo_resultado(bigint,boolean,text) from public,anon,authenticated,service_role;

create or replace function public.srv_correo_estado()
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not app.es_admin() then raise exception 'Solo administración puede revisar el servicio de correo.'; end if;
 return jsonb_build_object('habilitado',app.config_bool('correo_habilitado',false),
 'estados',coalesce((select jsonb_object_agg(x.estado,x.total) from(select estado,count(*) total from public.correos_cola group by estado)x),'{}'::jsonb));
end $$;
revoke all on function public.srv_correo_estado() from public,anon;
grant execute on function public.srv_correo_estado() to authenticated;

-- La V2 ya notifica toda la aprobación de cabecera; aquí solo aprobación financiera.
create or replace function app.tg_aviso_aprobacion_financiera()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_art public.articulos;v_sol public.solicitudes;
begin
 select * into strict v_art from public.articulos where id=new.articulo_id;
 select * into strict v_sol from public.solicitudes where id=v_art.solicitud_id;
 if tg_op='INSERT' and new.estado='pendiente' then
 perform app.notificar(new.aprobador_id,'cotizacion_pendiente','Cotización pendiente de aprobación',
 v_sol.numero||' · '||v_art.nombre||'. Revisa el valor y los documentos de soporte.','/aprobaciones',v_sol.id,now(),
 'financiera:'||new.id||':pendiente:'||new.aprobador_id,true);
 elsif tg_op='UPDATE' and old.estado is distinct from new.estado and new.estado in('aprobada','rechazada') then
 perform app.notificar(v_sol.solicitante_id,'cotizacion_resuelta','Cotización '||new.estado::text,
 v_sol.numero||' · '||v_art.nombre||'. Abre la solicitud para revisar la decisión.','/solicitudes/'||v_sol.id,v_sol.id,now(),
 'financiera:'||new.id||':'||new.estado||':'||v_sol.solicitante_id,true);
 perform app.notificar_compras('cotizacion_resuelta','Decisión de cotización: '||new.estado::text,
 v_sol.numero||' · '||v_art.nombre||'. Consulta el comentario y el estado de aprobación.','/gestion/articulo/'||v_art.id,v_sol.id,now(),
 'financiera-compras:'||new.id||':'||new.estado,true);
 end if;return new;
end $$;
revoke all on function app.tg_aviso_aprobacion_financiera() from public,anon,authenticated;
drop trigger if exists tg_aviso_aprobacion_financiera on public.aprobaciones;
create trigger tg_aviso_aprobacion_financiera after insert or update on public.aprobaciones
 for each row execute function app.tg_aviso_aprobacion_financiera();
commit;
