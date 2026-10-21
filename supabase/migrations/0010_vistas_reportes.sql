-- ============================================================
-- 0010_vistas_reportes.sql
-- Vistas con security_invoker (PG15+): NUNCA evaden RLS.
-- Atrasos solo con fecha estimada conocida; "sin información" ≠ 0.
-- Costos por área/centro de costo/período separando compras externas;
-- sin sumar monedas distintas (se agrupa por moneda).
-- ============================================================

-- Artículos con su contexto completo (gestión y listas).
create or replace view public.v_articulos
with (security_invoker = true) as
select
  a.id, a.solicitud_id, s.numero as solicitud_numero, s.estado as solicitud_estado,
  s.semana_lunes, s.solicitante_id, ps.nombre as solicitante_nombre,
  coalesce(a.area_id, s.area_id) as area_id, ar.nombre as area_nombre,
  coalesce(a.centro_costo_id, s.centro_costo_id) as centro_costo_id,
  cc.codigo as centro_costo_codigo, cc.nombre as centro_costo_nombre,
  a.nombre, a.descripcion, a.cantidad, a.unidad, a.prioridad, a.fecha_requerida,
  a.justificacion, a.etapa, a.requiere_aprobacion, a.aprobador_id,
  pa.nombre as aprobador_nombre,
  a.origen, a.estatus_historico, a.cerrado_en, a.cerrado_motivo,
  a.creado_en, a.actualizado_en, a.version,
  app.estado_aprobacion(a.id) as estado_aprobacion,
  c.id as compra_id, c.proveedor_id, pr.nombre as proveedor_nombre,
  c.moneda, c.precio_unitario, c.cantidad as cantidad_comprada,
  c.subtotal, c.impuestos, c.descuentos, c.otros_cargos, c.total,
  c.fecha_compra, c.referencia, c.fecha_estimada_llegada, c.llegada_completa_en,
  c.version as compra_version,
  m.recibido_bruto, m.devuelto_proveedor, m.recibido_neto,
  m.entregado_bruto, m.retornado, m.entregado_neto,
  m.disponible_almacen, m.pendiente_llegada,
  (select min(mv.fecha_efectiva) from public.movimientos mv
    where mv.articulo_id = a.id and mv.tipo = 'recepcion' and not mv.anulado) as primera_llegada,
  (select max(mv.fecha_efectiva) from public.movimientos mv
    where mv.articulo_id = a.id and mv.tipo = 'recepcion' and not mv.anulado) as ultima_llegada,
  case
    when c.id is null then null
    when c.fecha_estimada_llegada is null then null  -- "sin información"
    when coalesce(m.pendiente_llegada, c.cantidad) <= 0 then 0
    when c.fecha_estimada_llegada < (now() at time zone 'America/Bogota')::date
      then ((now() at time zone 'America/Bogota')::date - c.fecha_estimada_llegada)
    else 0
  end as dias_atraso,
  (select count(*) from public.novedades n
    where n.articulo_id = a.id and n.estado <> 'resuelta') as novedades_abiertas,
  (select count(*) from public.adjuntos ad
    where ad.entidad = 'articulo' and ad.entidad_id = a.id) as adjuntos
from public.articulos a
join public.solicitudes s on s.id = a.solicitud_id
left join public.perfiles ps on ps.id = s.solicitante_id
left join public.areas ar on ar.id = coalesce(a.area_id, s.area_id)
left join public.centros_costo cc on cc.id = coalesce(a.centro_costo_id, s.centro_costo_id)
left join public.perfiles pa on pa.id = a.aprobador_id
left join public.compras c on c.articulo_id = a.id
left join public.proveedores pr on pr.id = c.proveedor_id
left join lateral app.saldos_articulo(a.id) m on true;

-- Solicitudes con avance mixto (sin marcar todo por un único artículo).
create or replace view public.v_solicitudes
with (security_invoker = true) as
select
  s.id, s.numero, s.estado, s.solicitante_id, p.nombre as solicitante_nombre,
  s.area_id, ar.nombre as area_nombre,
  s.centro_costo_id, cc.codigo as centro_costo_codigo, cc.nombre as centro_costo_nombre,
  s.justificacion, s.semana_lunes, s.fecha_declarada, s.origen,
  s.creado_en, s.enviado_en, s.actualizado_en, s.version,
  (select count(*) from public.articulos a where a.solicitud_id = s.id) as total_articulos,
  (select count(*) from public.articulos a where a.solicitud_id = s.id
     and a.etapa in ('cerrado')) as articulos_cerrados,
  (select count(*) from public.articulos a where a.solicitud_id = s.id
     and a.etapa = 'cancelado') as articulos_cancelados,
  (select jsonb_object_agg(e.etapa, e.n) from (
      select a.etapa::text as etapa, count(*) as n
      from public.articulos a where a.solicitud_id = s.id group by a.etapa
   ) e) as resumen_etapas
from public.solicitudes s
left join public.perfiles p on p.id = s.solicitante_id
left join public.areas ar on ar.id = s.area_id
left join public.centros_costo cc on cc.id = s.centro_costo_id;

-- Costos comprados (gestionados aquí) por área/centro de costo/mes/moneda.
create or replace view public.v_costos_gestionados
with (security_invoker = true) as
select
  'gestionada'::text as fuente,
  date_trunc('month', c.fecha_compra)::date as mes,
  coalesce(a.area_id, s.area_id) as area_id, ar.nombre as area_nombre,
  coalesce(a.centro_costo_id, s.centro_costo_id) as centro_costo_id,
  cc.codigo as centro_costo_codigo,
  c.moneda,
  c.total, c.fecha_compra, c.id as compra_id, a.id as articulo_id,
  a.nombre as articulo_nombre, pr.nombre as proveedor_nombre,
  s.numero as solicitud_numero
from public.compras c
join public.articulos a on a.id = c.articulo_id
join public.solicitudes s on s.id = a.solicitud_id
left join public.areas ar on ar.id = coalesce(a.area_id, s.area_id)
left join public.centros_costo cc on cc.id = coalesce(a.centro_costo_id, s.centro_costo_id)
left join public.proveedores pr on pr.id = c.proveedor_id
where a.etapa <> 'cancelado';

-- Costos externos (una sola vez por referencia única; importe null = sin información).
create or replace view public.v_costos_externos
with (security_invoker = true) as
select
  ce.tipo::text as fuente,
  date_trunc('month', ce.fecha_compra)::date as mes,
  ce.area_id, ar.nombre as area_nombre,
  ce.centro_costo_id, cc.codigo as centro_costo_codigo,
  ce.moneda, ce.importe_total as total, ce.fecha_compra,
  ce.id as compra_externa_id, ce.referencia, ce.articulo_texto,
  coalesce(pr.nombre, ce.proveedor_texto) as proveedor_nombre,
  ce.registrada_corporativo, ce.solicitud_id
from public.compras_externas ce
left join public.areas ar on ar.id = ce.area_id
left join public.centros_costo cc on cc.id = ce.centro_costo_id
left join public.proveedores pr on pr.id = ce.proveedor_id;

-- Resumen para el tablero: SECURITY INVOKER a propósito, para que las
-- vistas (security_invoker) apliquen la RLS del usuario que consulta.
-- Cuenta sobre TODO el conjunto autorizado, no solo la página visible.
create or replace function public.fn_resumen_tablero()
returns jsonb language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'pendientes', (select count(*) from public.v_articulos v
                   where v.etapa in ('solicitado','en_cotizacion','cotizado')),
    'por_aprobar', (select count(*) from public.v_articulos v
                    where v.estado_aprobacion = 'pendiente'),
    'atrasados', (select count(*) from public.v_articulos v
                  where coalesce(v.dias_atraso, 0) > 0),
    'por_llegar', (select count(*) from public.v_articulos v
                   where v.etapa in ('comprado','en_transito','recibido_parcial')),
    'en_almacen', (select count(*) from public.v_articulos v
                   where coalesce(v.disponible_almacen,0) > 0),
    'entregados', (select count(*) from public.v_articulos v
                   where coalesce(v.entregado_neto,0) > 0),
    'novedades_abiertas', (select count(*) from public.novedades n
                           where n.estado <> 'resuelta')
  );
$$;
