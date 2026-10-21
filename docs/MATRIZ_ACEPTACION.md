# Matriz de aceptación — requisito → función → prueba → cómo se demuestra

**Leyenda de estado** (se actualiza el día del despliegue):
`[SQL]` lo demuestra la suite `supabase/pruebas/pruebas_aceptacion.sql` ejecutada en el
**proyecto de PRUEBAS** (imprime PASA/FALLA por caso) · `[LOGICA]` demostrado HOY por las
pruebas de Node (15/15) · `[MANUAL]` pasos guiados sobre la URL real.
Ninguna casilla se marca "aprobada" sin haberse ejecutado de verdad.

> Cómo correr la suite SQL: en el proyecto de PRUEBAS (ver RESPALDO_Y_RESTAURACION.md
> para crearlo) ejecuta en SQL Editor: `create table public.zz_entorno_de_pruebas (ok boolean);`
> luego pega TODO `setup_completo.sql`, y después TODO `pruebas_aceptacion.sql`. El
> resultado final es la tabla PASA/FALLA. Reejecutable (limpia sus datos ficticios).

| # | Requisito (acta/encargo) | Función/pantalla | Prueba | Demostración |
|---|---|---|---|---|
| 1 | Registro queda pendiente, sin acceso; el navegador no otorga roles | Registro + RLS `perfiles` | Cuenta pendiente no ve/crea nada; autopromoción falla | [SQL] caso 1 + [MANUAL] registrarse y verificar pantalla "pendiente" |
| 2 | Activación/desactivación por admin; bloqueo inmediato con sesión viva; cambio de roles solo admin | Administración → Usuarios (`fn_admin_*`) | Activar, desactivar y verificar pérdida de acceso inmediata; guardas de último admin | [SQL] caso 2 + [MANUAL] dos navegadores |
| 3 | Aislamiento: A no lee/edita ni descarga adjuntos de B; Compras no se asciende | RLS en todas las tablas + Storage por ruta | Lecturas vacías, 0 filas afectadas, Storage niega, autoascenso falla | [SQL] caso 3 (incluye Storage) |
| 4 | Solicitud con artículos de avance independiente; persistencia multi-sesión; estado general mixto | Mis solicitudes / v_solicitudes.resumen_etapas | 2 artículos en etapas distintas; reabrir desde otro navegador | [SQL] caso 4 + [MANUAL] otra sesión |
| 5 | Aprobación configurable bloquea compra; decisión conservada; cambio material exige nueva aprobación y conserva la anterior | Aprobaciones (`fn_configurar/solicitar/decidir_aprobacion`, `fn_registrar/actualizar_compra`) | Comprar con pendiente/rechazada falla; cambio de cantidad genera nueva pendiente; recepción bloqueada mientras tanto | [SQL] caso 5 |
| 6 | Parciales y saldos: 10 compradas → 4+6 recibidas, 3 entregadas, 1 devuelta ⇒ 6 en almacén, 3 entregadas, reposición identificada; sobreentrega rechazada; sin "10 entregadas"; cierre con pendientes exige resolución | Movimientos transaccionales (`fn_registrar_movimiento`, `fn_cerrar_articulo`) | Secuencia exacta del acta + entrega de 7 con 6 disponibles + cierre sin motivo | [SQL] caso 6 |
| 7 | Novedades (entrega incorrecta, mal solicitado, datos incompletos) con evidencia y resolución sin perder el original | Novedades + adjuntos | Crear 3 tipos, resolver, verificar texto original intacto; borrado imposible | [SQL] caso 7 + [MANUAL] evidencia adjunta |
| 8 | Correcciones de fecha/precio conservan anterior+nuevo+actor+hora; auditoría intocable para usuarios funcionales | Auditoría por disparadores + historial de fechas estimadas | Cambiar fecha estimada y precio; intentar editar auditoría como Compras y como admin | [SQL] caso 8 |
| 9 | Compra externa COP 100.000 cuenta UNA vez aun vinculada a solicitud y con 2 adjuntos | Compras externas (referencia única) + v_costos_externos | Registrar, vincular, adjuntar 2, verificar 1 fila/100.000 | [SQL] caso 9 |
| 10 | CSV: analizador correcto (codificación/comillas/multilínea), fechas ambiguas sin inventar, lote repetido no duplica, "Imagen" no crea archivos | Administración → Importación + `pruebas-logica` | Hallazgos del archivo REAL (183/12/7/leyenda); hash repetido rechazado; confirmar 2 veces importa 0 la segunda | [LOGICA] ✅ ejecutado hoy + [SQL] caso 10 |
| 11 | Concurrencia: sin pérdida silenciosa, sin saldo negativo, sin duplicados por reintento | FOR UPDATE + idempotencia op_id + versión optimista | Reintento con mismo op_id = 1 movimiento; versión vieja rechazada; y 2 sesiones simultáneas | [SQL] caso 11 (reintento+versión) + [MANUAL] concurrencia real: abre DOS pestañas del SQL Editor del proyecto de pruebas y ejecuta a la vez en ambas `select public.fn_registrar_movimiento('<id-articulo>','entrega',6,current_date,'X',null,false,gen_random_uuid());` con saldo 6: una PASA y la otra dice "Entrega rechazada: solo hay 0…" |
| 12 | Recuperación supervisada: enlace un solo uso, vencidos fallan, sin permiso no genera, auditado sin token | Edge Function + Admin → Recuperación | Generar enlace, usarlo, reusarlo (falla), dejar vencer otro (falla), intentarlo como no-admin (403) | [MANUAL] guion en GUION_DEMO.md §12; auditoría `recuperacion_acceso` sin enlace |
| 13 | Exportación respeta permisos/filtros, conserva acentos, sin fórmulas ejecutables | Exportar CSV (todas las listas) | Sanitización `=SUM`, `+`, `-`, `@`; BOM UTF-8; decimal con coma | [LOGICA] ✅ ejecutado hoy + [MANUAL] abrir un export en Excel: celda `'=2+2` no calcula |
| 14 | Publicación HTTPS, rutas directas/recarga, login, carga/descarga privada desde la URL final; sin secretos en archivos públicos | Cloudflare Pages + checklist | Lista de verificación completa | [MANUAL] GUIA_DESPLIEGUE Parte F |
| 15 | Respaldo generado y restauración demostrada en entorno separado sin tocar producción | pg_dump + respaldo.ps1 + 2º proyecto free | Dump, copia de storage, restore, verificación de datos | [MANUAL] RESPALDO_Y_RESTAURACION.md §Prueba |

## Registro de ejecución (llenar el viernes)

| # | Fecha/hora | Entorno | Resultado real | Evidencia |
|---|---|---|---|---|
| 1–11 | | Proyecto de PRUEBAS (SQL) | | captura de la tabla PASA/FALLA |
| 10 (lógica) | 2026-10-21 | Node 22 (entorno de desarrollo) | 15/15 PASA | salida `npm run test:logica` |
| 12 | | URL real | | auditoría recuperacion_acceso |
| 13 | | URL real + Excel | | archivo exportado |
| 14 | | URL real | | checklist Parte F |
| 15 | | Proyecto de PRUEBAS | | tablas y archivos restaurados |
