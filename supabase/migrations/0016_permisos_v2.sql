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
