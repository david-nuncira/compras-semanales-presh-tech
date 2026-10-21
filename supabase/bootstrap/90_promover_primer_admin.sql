-- ============================================================
-- 90_promover_primer_admin.sql
-- PROCEDIMIENTO INICIAL CONTROLADO (entorno de confianza).
-- Se ejecuta UNA vez en el SQL Editor de Supabase por el responsable
-- técnico del proyecto, DESPUÉS de que el administrador funcional se
-- haya registrado en la aplicación (su cuenta queda "pendiente").
--
-- 1) En el panel de Supabase: Authentication → Users → localizar el
--    correo del administrador (david.nuncira@presh-tech.com) y copiar
--    su UUID (columna "UID").
-- 2) Reemplazar abajo PEGAR-UUID-AQUI por ese UUID (entre comillas).
-- 3) Ejecutar. El resultado debe decir: "Administrador promovido: ..."
--
-- NUNCA promover un UUID sin verificar a quién pertenece.
-- Este mismo procedimiento sirve para RECUPERAR el acceso si algún día
-- no queda ningún administrador activo (lo ejecuta el responsable técnico;
-- ningún usuario funcional puede ascenderse a sí mismo).
-- ============================================================

do $$
declare
  v_texto text := 'PEGAR-UUID-AQUI';
  v_uuid uuid;
  v_correo text;
begin
  if v_texto !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Reemplaza PEGAR-UUID-AQUI por el UID copiado de Authentication → Users (formato 8-4-4-4-12).';
  end if;
  v_uuid := v_texto::uuid;
  select email into v_correo from auth.users where id = v_uuid;
  if v_correo is null then
    raise exception 'No existe un usuario con UUID %. Verifica en Authentication → Users.', v_uuid;
  end if;

  insert into public.perfiles (id, nombre, correo, estado)
  values (v_uuid, 'Administrador', v_correo, 'activo')
  on conflict (id) do update set estado = 'activo', actualizado_en = now(), version = public.perfiles.version + 1;

  insert into public.perfil_roles (perfil_id, rol, asignado_por)
  values (v_uuid, 'administrador', null), (v_uuid, 'solicitante', null)
  on conflict (perfil_id, rol) do nothing;

  insert into public.auditoria (tabla, registro_id, accion, actor, motivo, anterior, nuevo)
  values ('perfiles', v_uuid::text, 'BOOTSTRAP_ADMIN', null,
          'Promoción inicial ejecutada por el responsable técnico en el SQL Editor',
          null, jsonb_build_object('estado','activo','roles', jsonb_build_array('administrador','solicitante')));

  raise notice 'Administrador promovido: % (%)', v_correo, v_uuid;
end $$;
