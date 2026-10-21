-- ============================================================
-- 0012_endurecimiento.sql
-- Privilegios mínimos: anon no toca nada; authenticated solo lo que
-- las políticas permiten; escrituras sensibles únicamente por RPC.
-- (RLS ya está activo en todas las tablas; esto reduce además la
-- superficie de API: sin GRANT no hay operación posible.)
-- ============================================================

-- anon: ninguna operación sobre datos (el registro/login lo hace Auth, no la API de datos).
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

-- Punto de partida limpio para authenticated.
revoke all on all tables in schema public from authenticated;

-- Lectura general (las políticas RLS filtran filas).
grant select on
  public.configuracion, public.perfiles, public.perfil_roles,
  public.areas, public.centros_costo, public.proveedores,
  public.solicitudes, public.articulos, public.etapa_transiciones,
  public.cotizaciones, public.aprobaciones, public.compras,
  public.compra_fechas_estimadas, public.movimientos, public.novedades,
  public.adjuntos, public.compras_externas, public.auditoria,
  public.importacion_lotes, public.importacion_filas, public.importacion_mapeo_estados,
  public.v_usuarios_admin, public.v_articulos, public.v_solicitudes,
  public.v_costos_gestionados, public.v_costos_externos, public.v_historico_csv
to authenticated;

-- Escrituras directas permitidas (siempre bajo RLS + disparadores de protección):
grant insert, update, delete on public.areas, public.centros_costo, public.proveedores to authenticated;
grant insert, update, delete on public.solicitudes to authenticated;
grant insert, update, delete on public.articulos to authenticated;
grant insert, update, delete on public.cotizaciones to authenticated;
grant insert on public.novedades to authenticated;
-- Todo lo demás (perfiles, roles, aprobaciones, compras, movimientos, adjuntos,
-- compras externas, auditoría, operaciones, importación) SOLO mediante RPC.

-- Secuencias usadas por inserciones directas.
grant usage on sequence public.solicitudes_consecutivo_seq to authenticated;
grant usage on sequence public.compras_externas_consecutivo_seq to authenticated;

-- Esquema auxiliar: utilizable, no modificable.
grant usage on schema app to authenticated;
revoke create on schema app from public;

-- Funciones del esquema app: por defecto PostgreSQL concede EXECUTE a PUBLIC;
-- se retira y se concede solo a authenticated (las políticas y disparadores
-- se ejecutan con el rol del usuario que consulta). Las funciones de contexto
-- privilegiado quedan fuera del alcance de authenticated.
revoke all on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated;
revoke all on function app.modo_servidor() from authenticated;
revoke all on function app.fijar_motivo(text) from authenticated;
revoke all on function app.auditar(text,text,text,jsonb,jsonb,text) from authenticated;
revoke all on function app.op_guardar(uuid,text,jsonb) from authenticated;
revoke all on function app.op_existente(uuid) from authenticated;
alter default privileges in schema app revoke all on functions from public;

-- Las funciones públicas (RPC) requieren sesión; cada una revalida permisos.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as firma
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'fn\_%' escape '\'
  loop
    execute format('revoke all on function %s from public, anon', f.firma);
    execute format('grant execute on function %s to authenticated', f.firma);
  end loop;
end $$;

-- Garantía adicional: nadie (ni siquiera con GRANT accidental futuro) edita
-- auditoría ni operaciones por la API: sin políticas de escritura y sin GRANT.
revoke insert, update, delete on public.auditoria from authenticated;
revoke all on public.operaciones from authenticated;

-- Evitar que futuros objetos hereden permisos amplios por defecto.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon;
