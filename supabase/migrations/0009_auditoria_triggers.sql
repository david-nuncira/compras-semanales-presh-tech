-- ============================================================
-- 0009_auditoria_triggers.sql
-- Adjunta el disparador genérico de auditoría a las tablas de negocio.
-- La auditoría la generan disparadores del servidor con el actor
-- autenticado (auth.uid()); nunca un actor enviado por el cliente.
-- ============================================================

do $$
declare t text;
begin
  foreach t in array array[
    'perfiles','perfil_roles','areas','centros_costo','proveedores',
    'solicitudes','articulos','cotizaciones','compras','movimientos',
    'novedades','adjuntos','compras_externas'
  ] loop
    execute format('drop trigger if exists tg_aud_%s on public.%I', t, t);
    execute format(
      'create trigger tg_aud_%s after insert or update or delete on public.%I
         for each row execute function app.tg_auditar()', t, t);
  end loop;
end $$;

-- aprobaciones: las escribe solo el servidor; auditamos INSERT y UPDATE.
drop trigger if exists tg_aud_aprobaciones on public.aprobaciones;
create trigger tg_aud_aprobaciones after insert or update on public.aprobaciones
  for each row execute function app.tg_auditar();

-- compra_fechas_estimadas ya es un historial en sí misma: sin disparador.

-- ------------------------------------------------------------
-- Historial consultable de un artículo (para pantalla de detalle):
-- cambios relevantes con valores anteriores/nuevos, respetando permisos.
-- ------------------------------------------------------------
create or replace function public.fn_historial_articulo(p_articulo uuid)
returns table (
  creado_en timestamptz, tabla text, accion text, actor_nombre text,
  motivo text, anterior jsonb, nuevo jsonb
) language sql stable security definer
set search_path = ''
as $$
  select a.creado_en, a.tabla, a.accion,
         coalesce(p.nombre, 'Sistema') as actor_nombre,
         a.motivo, a.anterior, a.nuevo
  from public.auditoria a
  left join public.perfiles p on p.id = a.actor
  where (app.es_gestor() or app.tiene_rol('almacen')
         or app.es_dueno_articulo(p_articulo) or app.es_aprobador_de(p_articulo))
    and (
      (a.tabla = 'articulos' and a.registro_id = p_articulo::text)
      or (a.tabla = 'cotizaciones' and a.registro_id in
            (select id::text from public.cotizaciones where articulo_id = p_articulo))
      or (a.tabla = 'compras' and a.registro_id in
            (select id::text from public.compras where articulo_id = p_articulo))
      or (a.tabla = 'movimientos' and a.registro_id in
            (select id::text from public.movimientos where articulo_id = p_articulo))
      or (a.tabla = 'novedades' and a.registro_id in
            (select id::text from public.novedades where articulo_id = p_articulo))
      or (a.tabla = 'aprobaciones' and a.registro_id in
            (select id::text from public.aprobaciones where articulo_id = p_articulo))
    )
  order by a.creado_en desc
  limit 500;
$$;
