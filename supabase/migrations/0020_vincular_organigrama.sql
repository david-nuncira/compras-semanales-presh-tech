-- Vinculación del organigrama a cuentas corporativas activas. No crea ni activa usuarios.
begin;
alter table public.organigrama_personas add column if not exists correo_esperado text;
alter table public.organigrama_personas add column if not exists area_sistema text;
update public.organigrama_personas set correo_esperado=replace(id,'-','.')||'@presh-tech.com',
 area_sistema=case area_nombre when 'Gerencia General' then 'GERENCIA' when 'Comercial' then 'COMERCIAL'
 when 'Logística' then 'LOGÍSTICA Y COMPRAS' when 'Ensamble y Manufactura' then 'PRODUCCIÓN'
 when 'Administrativa y Gestión Humana' then 'GESTIÓN HUMANA Y ADMINISTRACIÓN'
 when 'Proceso Fisicoquímico' then 'TFQ' when 'Investigación' then 'I+D' else area_nombre end
 where correo_esperado is null;
create or replace function public.fn_sincronizar_organigrama()
returns jsonb language plpgsql security definer set search_path='' as $$
declare persona record; responsable uuid; superior uuid; area uuid; cuenta uuid; vinculadas integer:=0; faltantes jsonb:='[]';
begin
 if not app.es_admin() then raise exception 'Solo administración aplica la estructura.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('sincronizar-organigrama',0));
 select p.id into superior from public.perfiles p join auth.users u on u.id=p.id join public.organigrama_personas o on lower(u.email)=lower(o.correo_esperado)
 where o.id='yeffer-gaona' and p.estado='activo';
 for persona in select * from public.organigrama_personas where activo order by id loop
  select p.id into cuenta from public.perfiles p join auth.users u on u.id=p.id where lower(btrim(u.email))=lower(persona.correo_esperado) and p.estado='activo';
  if cuenta is null then faltantes:=faltantes||jsonb_build_array(jsonb_build_object('nombre',persona.nombre,'correo',persona.correo_esperado));continue;end if;
  select a.id into area from public.areas a where a.activo and upper(a.nombre)=upper(persona.area_sistema);
  select p.id into responsable from public.organigrama_personas o join auth.users u on lower(u.email)=lower(o.correo_esperado) join public.perfiles p on p.id=u.id where o.nombre=persona.jefe_nombre and p.estado='activo';
  update public.perfiles set cargo=persona.cargo,area_id=coalesce(area,area_id),jefe_id=coalesce(responsable,jefe_id)
  where id=cuenta and (cargo is distinct from persona.cargo or (area is not null and area_id is distinct from area) or (responsable is not null and jefe_id is distinct from responsable));
  if persona.id in('yeffer-gaona','elvis-luque','sindi-sanchez','javier-diaz','nicolas-diaz','andrea-leon','ivonne-suta') then
   insert into public.perfil_roles(perfil_id,rol,asignado_por) values(cuenta,'aprobador',auth.uid()) on conflict do nothing;
   if persona.id<>'yeffer-gaona' and area is not null and exists(select 1 from public.areas where id=area and(jefe_id is distinct from cuenta or(superior is not null and aprobador_superior_id is distinct from superior))) then
    perform public.fn_admin_configurar_area(area,cuenta,superior,'Organigrama y responsables indicados por David Nuncira');
   end if;
  end if;
  vinculadas:=vinculadas+1;
 end loop;
 if superior is not null then update public.configuracion_aprobaciones set gerente_id=superior,actualizado_en=now() where id and gerente_id is distinct from superior;end if;
 perform app.auditar('organigrama_personas','estructura','SINCRONIZAR',null,jsonb_build_object('cuentas_vinculadas',vinculadas,'faltantes',faltantes),'Aplicación del organigrama autorizado por David Nuncira');
 return jsonb_build_object('vinculadas',vinculadas,'faltantes',faltantes);
end $$;
revoke all on function public.fn_sincronizar_organigrama() from public,anon;
grant execute on function public.fn_sincronizar_organigrama() to authenticated;
notify pgrst,'reload schema';
commit;
