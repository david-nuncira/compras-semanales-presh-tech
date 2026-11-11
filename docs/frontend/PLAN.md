# Plan de rediseño del frontend

Rama: `mejora/frontend-ux` (desde `main` `2650944`). Reglas: ver `CLAUDE.md`. Hallazgos: ver `AUDITORIA.md`.

## Resultado base (Fase 0, 2026-11-11, Node 24.22.1)

| Comando | Resultado |
|---|---|
| `npm ci` | **Falla**: no existe `package-lock.json` en el repo. Se trabajó con el `node_modules` que ya existía. |
| `npm run typecheck` | **11 errores**, todos en `src/paginas/AdminCatalogos.tsx` (líneas ~115–168: tipo `PostgrestFilterBuilder` frente a `Promise`). Ya existían en `main`. |
| `npm run test:logica` | **Falla por el script**: en Node 24, `node --test pruebas-logica/` trata la carpeta como módulo. Con `pruebas-logica/*.test.ts`: 39 pruebas, 38 pasan, 0 fallan. |
| `npm run build` | **Verde** (487 kB de JS, 10,9 kB de CSS). |

### Corregido en el commit «Base verde» (ver «Avance»)
1. **Typecheck:** `AdminCatalogos.tsx` no está en la lista protegida. Propuesta: corregir los tipos sin cambiar la lógica, como primer commit de la Fase 1.
2. **Script de pruebas:** cambiar `test:logica` a `pruebas-logica/*.test.ts` (solo `package.json`).
3. **`package-lock.json`:** generarlo y versionarlo para que `npm ci` funcione y Cloudflare instale lo mismo.

## Fase 1 · Sistema de diseño y navegación
Alcance: tokens (color, espaciado de 4 px, radios, sombras, tipografía), ampliación de `UI.tsx` (Botón, Campo, Select, Textarea, Insignia con ícono, Tabla de datos, Panel lateral, Modal con foco, Pestañas, Estado vacío, Esqueleto, Paginación), barra lateral + menú móvil con contadores, inicio por rol, `React.lazy` por ruta, filtros en la URL, CSS de acceso sin tocar su lógica. Documentar en `SISTEMA_DE_DISENO.md`.
Verificación:
- [x] typecheck, test:logica y build en verde
- [ ] Menú solo con módulos permitidos por `permisos.ts`
- [ ] Modal: atrapa foco, Esc, devuelve foco
- [ ] Foco visible y objetivos de 44 px
- [ ] «Atrás» conserva filtros y página
- [ ] `git diff main --stat` sin archivos protegidos

## Fase 2 · Nueva solicitud y detalle
Alcance: asistente de 4 pasos (extraer de `MisSolicitudes.tsx`), borrador con «Guardado hace X», validación por campo; detalle con línea de tiempo (`fn_historial_solicitud`, aprobaciones, fechas), bloque de devolución con «Corregir y reenviar», tabla de artículos con miniaturas y galería, barra de acciones por rol, y reemplazo de `confirm()` por modal (excepto archivos protegidos).
Verificación:
- [ ] Solicitud de un artículo sigue siendo rápida
- [ ] Rechazada o cancelada nunca en verde ni al 100 %
- [ ] Errores del servidor en lenguaje humano
- [ ] Probado a 360, 768 y 1280 px

## Fase 3 · Bandejas
Alcance: Por aprobar con panel lateral (aprobar, devolver con motivo, rechazar); Gestión de compras con tabla densa, filtros, orden y edición en panel; Almacén con «recibido X de Y» y bloqueo de excesos; actualizar solo la fila afectada.
Verificación:
- [ ] Aprobación múltiple solo si el servidor la soporta (si no, `REQUIERE_BACKEND.md`)
- [ ] Posición de la lista intacta tras editar
- [ ] Los cuatro estados (carga, vacío, error, sin permiso)

## Fase 4 · Matriz de cotizaciones y tablero
Alcance: matriz de cotizaciones sobre `cotizaciones`/`fn_seleccionar_cotizacion`, con funciones puras en `src/util/` y `pruebas-logica/matriz.test.ts` (21 artículos, total 2 786 300; fila sin cotizaciones no aporta 0); tablero solo con `fn_resumen_tablero`/`fn_indicadores`/vistas, con íconos «i» y SVG con texto alternativo.
Verificación:
- [ ] Mínimo ignora celdas vacías
- [ ] Verde = seleccionada, no la más barata
- [ ] Sin cifras fijas
- [ ] Tarjetas por artículo en móvil

## Fase 5 · Verificación y PR
Alcance: salida real de comandos, `git diff main --stat`, revisión a 360/768/1280, push, PR sin fusionar, `GUIA_CAMBIOS.md`, lista de pruebas manuales en Cloudflare.
Verificación:
- [ ] Ningún archivo protegido ni `supabase/` en el diff
- [ ] Tabla de pantallas con evidencia en el PR

## Avance

- **Fase 0:** hecho: rama creada, `CLAUDE.md` copiado a la raíz, `AUDITORIA.md`, `PLAN.md`, `REQUIERE_BACKEND.md`. Probado: los cuatro comandos de base (resultado arriba). Pendiente: las tres decisiones de arriba.
- **Base corregida (antes de la Fase 1):** hecho: `AdminCatalogos.tsx` (solo el tipo del parámetro de `ejecutar`, de `Promise` a `PromiseLike`; sin cambio de lógica), script `test:logica` con `pruebas-logica/*.test.ts` y `package-lock.json` generado. Probado: `npm ci` OK, typecheck con 0 errores, pruebas 38 pasan / 0 fallan / 1 omitida, build OK. Pendiente: el glob del script requiere Node 22 o superior para `node --test`; con Node 20 habría que listar los archivos.
- **Fase 1 (sistema de diseño y navegación):**
  - Hecho: tokens CSS; componentes nuevos en `UI.tsx` (Boton, Select, Textarea, Insignia con ícono, TablaDatos, PanelLateral, Modal con foco, Pestanas, EstadoVacio, Esqueleto, EstadoError, SinPermiso, Icono); menú lateral en escritorio y cajón en móvil con contadores y enlace «Saltar al contenido» (`Navegacion.tsx`, `contexto/Resumen.tsx`); Inicio con «Lo que tienes que hacer hoy» por rol; `React.lazy` por ruta (el paquete principal bajó de 487 kB a 310 kB); filtros, búsqueda y página en la URL en Mis solicitudes, Gestión de compras y Consulta global (`util/estadoUrl.ts`); CSS de acceso con los tokens, sin tocar su lógica. Documentado en `SISTEMA_DE_DISENO.md`.
  - Probado: typecheck 0 errores; `test:logica` 38 pasan / 0 fallan / 1 omitida; build OK; `RedirigirRecuperacion` y `useEsperaPerfil` sin cambios. En el navegador solo se vio la pantalla de Acceso (sin errores de consola; a 375 px sin scroll horizontal, botón de 44 px y campos de 16 px).
  - Pendiente: **no se vio con sesión iniciada** (menú, Inicio, contadores, cajón móvil y las listas con filtros en la URL); queda para la revisión manual en la vista previa de la rama. El contador «artículos para recoger» del solicitante usa `v_articulos.disponible_almacen > 0` filtrado por solicitante; hay que confirmar que coincide con lo que el solicitante espera. Migrar `confirm()` y las pestañas manuales de otras pantallas, y filtros en URL del resto de listas, va en las fases 2 a 4.
- **Fase 2 (nueva solicitud y detalle):**
  - Hecho: asistente de 4 pasos en `/nueva-solicitud` y `/nueva-solicitud/:id` (General, Artículos, Revisión, Envío) con borrador guardado en la base desde el paso 1, «Guardado hace X», validación al salir de cada campo, agregar/editar/duplicar/eliminar artículos, fotos con arrastrar, galería y cámara (`capture`), fecha estimada con `fn_estimar_envio` y confirmación de qué sigue. Mis solicitudes ya no usa el modal: enlaza al asistente y ofrece «Continuar» y «Corregir y reenviar». Detalle: línea de tiempo vertical de 11 etapas (`util/lineaTiempo.ts`, probada), bloque destacado de devolución con «Corregir y reenviar» y versiones anteriores, tabla de artículos con miniatura (carga diferida), galería y detalle desplegable, historial detallado, y confirmaciones en diálogo accesible en vez de `confirm()` (Adjuntos y eliminar artículo; `AdminRecuperacion` es protegida y no se tocó).
  - Probado: typecheck 0 errores; `test:logica` 53 pasan / 0 fallan / 1 omitida (15 pruebas nuevas de la línea de tiempo: rechazada y cancelada nunca como éxito, etapas futuras pendientes, devuelta, flujo anterior, atraso, duraciones); build OK. Solo se vio en el navegador la pantalla de Acceso.
  - Pendiente: **probar con sesión iniciada** el asistente completo (crear borrador, agregar artículo con foto, duplicar, revisar, enviar), el detalle de una solicitud devuelta, rechazada y en Compras, y la cámara en el celular. Filas añadidas a `REQUIERE_BACKEND.md`. El detalle conserva los modales de edición existentes (corrección rápida) además del asistente.
- **Fase 3 (bandejas de trabajo):**
  - Hecho: **Por aprobar** con lista compacta y panel lateral de vista rápida (artículos con miniatura, adjuntos, aprobar / devolver con motivo / rechazar con motivo sin salir de la lista; el panel queda en la URL `?ver=`); **Gestión de compras** con tabla densa (miniaturas, orden por columna con `aria-sort`, filtros principales y «Más filtros», búsqueda, paginación, atrasos con borde ámbar y texto), ficha del artículo en panel lateral (`?articulo=`) sin perder la posición; **Almacén** con pestañas, «recibido X de Y» con barra de avance y la ficha en panel. En la ficha del artículo ya no se puede registrar una entrega mayor que lo disponible en almacén (ni una entrega directa mayor que lo que falta por llegar): error junto al campo y botón desactivado. Tras cada acción solo se actualiza la fila afectada (`refrescarFila`; en Por aprobar la fila sale de pendientes y entra a «Decididas»). Los diálogos anidados (modal dentro de panel) ya responden a Esc de uno en uno. `window.prompt` de devoluciones reemplazado por un diálogo con motivo. Los cuatro estados (carga con esqueleto, vacío con acción, error con reintento, sin permiso) en las tres bandejas.
  - Probado: typecheck 0 errores; `test:logica` 53 pasan / 0 fallan / 1 omitida; build OK. Sin sesión iniciada no se pudo recorrer en el navegador.
  - Pendiente: **probar con sesión iniciada** (decidir una solicitud desde el panel, abrir una ficha desde Gestión y desde Almacén, registrar una entrega mayor que el saldo y comprobar el bloqueo, ordenar y paginar, «Atrás» desde una ficha). Aprobación múltiple no se ofrece porque el servidor no la soporta (ver `REQUIERE_BACKEND.md`).
- **Fase 4 (matriz de cotizaciones y tablero):**
  - Hecho (A) **Matriz**: `/solicitudes/:id/cotizaciones` (enlaces desde el detalle y desde Gestión de compras). Encabezado con fecha, centro de costo general, elaborado por, aprobado por y versión; columnas Cant., Artículo, Centro de costo destino, Imagen, Justificación, Descripción/referencia, una por proveedor (salen de las cotizaciones existentes, no están escritas en el código), Mínimo y Total; fila de totales. Encabezados y las dos primeras columnas fijos, desplazamiento solo dentro del recuadro, panel lateral con todas las cotizaciones del artículo, y en pantallas de menos de 768 px una tarjeta por artículo con la comparación. Verde con ícono y texto «Seleccionada» = cotización seleccionada (no la más barata); el mínimo se marca aparte (subrayado y texto). La lógica es pura en `src/util/matriz.ts`; `pruebas-logica/matriz.test.ts` usa los datos reales de la hoja: 21 artículos y total 2.786.300, celdas vacías no cuentan como 0, fila sin cotizaciones sin mínimo ni total, referencia repetida sin agrupar.
  - Hecho (B) **Tablero**: nuevo `PanelAnalitico` en el Inicio (Compras y consulta global) con filtros de fechas, área y centro de costo guardados en la URL; estimado, comprometido y ejecutado diferenciados por trama (punteado, rayado, sólido) además del color; costos por área o centro de costo; flujo de artículos por etapa; tiempos del servidor (`fn_indicadores`). Gráficos en SVG con título, descripción y tabla equivalente. Cada indicador del Inicio y del panel lleva el ícono «i» (se abre con clic o teclado) que explica qué mide. Sin cifras fijas: todo sale de `v_articulos`, cotizaciones seleccionadas y `fn_indicadores`. Cálculos puros en `src/util/tablero.ts` con `pruebas-logica/tablero.test.ts`.
  - Probado: typecheck 0 errores; `test:logica` 76 pasan / 0 fallan / 1 omitida (23 pruebas nuevas); build OK. No se vio en el navegador con datos reales (requiere sesión).
  - Pendiente: revisión manual con sesión (matriz de una solicitud con cotizaciones reales, panel con y sin filtros, lectura de los «i» y de los gráficos con lector de pantalla). Limitaciones en `REQUIERE_BACKEND.md`: destino por artículo, aprobación de la matriz, filtros de servidor y cálculo de importes en servidor. Las definiciones de estimado, comprometido y ejecutado son mías (ver el «i»); conviene que Compras las confirme.
- **Fase 5 (verificación y PR), 2026-11-11:**
  - Salida real: `npm ci` OK; `npm run typecheck` 0 errores; `npm run test:logica` 77 pruebas, 76 pasan, 0 fallan, 1 omitida; `npm run build` OK (paquete principal 316,7 kB frente a 487 kB al inicio; cada pantalla en su propio archivo).
  - `git diff main`: ningún cambio en `supabase/`, `public/`, `Sesion.tsx`, `supabase.ts`, `config.ts`, `Acceso.tsx`, `Restablecer.tsx`, `PendienteActivacion.tsx` ni `AdminRecuperacion.tsx`; `RedirigirRecuperacion` y `useEsperaPerfil` idénticos. Sí cambian `package.json` y `package-lock.json` (script de pruebas y lockfile), sin dependencias nuevas.
  - Contraste calculado (WCAG) para los pares de color de los tokens: todos cumplen AA salvo el borde de los campos (2,1:1), que se oscureció a `#7a8696` (3,7:1). Foco 6,7:1.
  - Ancho: la pantalla de Acceso se midió a 360, 768 y 1280 px sin scroll horizontal, botones de 44 px y campos de 16 px en móvil. **Las demás pantallas no se pudieron recorrer en el navegador porque requieren sesión**; su revisión queda en la lista manual.
  - Reglas: sin `dangerouslySetInnerHTML`, sin `localStorage`, enlaces externos con `rel="noopener noreferrer"`, imágenes con `alt`.
  - Pendiente: `window.prompt` al renombrar en `AdminCatalogos` y `window.confirm` en `AdminRecuperacion` (protegida); filtros en URL de las demás listas; pestañas manuales de Consulta global y Mis solicitudes sin el componente `Pestanas`.
- **Cierre de pendientes menores (después de la Fase 5):** el `window.prompt` de renombrar en `AdminCatalogos` pasó a un diálogo accesible con validación; las pestañas de Mis solicitudes y Consulta global usan el componente `Pestanas` (flechas, Inicio y Fin, `aria-selected`). Verificado: typecheck 0 errores, 76 pruebas pasan, build OK. Siguen pendientes `window.confirm` en `AdminRecuperacion` (protegida) y filtros en URL del resto de listas.
- **Fusión con `main` (2026-11-11):** `main` traía otro rediseño en paralelo (experiencia guiada, avisos, formularios con validación, organigrama y migraciones 0017–0020). Se fusionó `origin/main` en esta rama y se resolvieron a mano 11 archivos. Criterio: **lo nuevo de `main` se conserva** (Modal con pila y confirmación de descarte, `Formulario`/`Campo` con validación, avisos centralizados, `Adjuntos` con vista previa y cotizaciones, organigrama, campana de avisos, backend) y **mi sistema se aplica donde choca** (menú lateral, componentes, asistente de nueva solicitud, línea de tiempo, bandejas con panel, matriz y panel analítico).
  - `UI.tsx`: base mía + `MensajeError/Exito`, `Cargando`, `Campo/Formulario`, `Modal` y `BotonConMotivo` de `main`. `PanelLateral` ahora usa el `Modal` de `main` con la variante `lateral`. `EstadoVacio`/`EstadoError` aceptan ambas formas de uso.
  - `App.tsx`: mi estructura (menú lateral, carga por ruta) + ruta `/admin/organigrama`; la `CampanaAvisos` de `main` va en la barra móvil. `Adjuntos`, `AdminCatalogos`: versión de `main` (+ cámara en `Adjuntos`; las miniaturas ignoran los adjuntos de cotizaciones). `ArticuloGestion`: versión de `main` + panel lateral y bloqueo de entregas. `Tablero`, `MisSolicitudes`, `AprobacionSolicitudes`, `SolicitudDetalle`: mi versión + encabezados y bloques guiados de `main` (bienvenida, tarea principal, guía «Así avanza una compra», «siguiente paso», resumen de aprobaciones, formularios con `Formulario`). No se trajo la lista de pasos (checklist) del detalle porque el asistente ya cubre ese recorrido.
  - `estilos.css`: se conservaron ambos conjuntos; al final hay una sección de reconciliación (foco visible AA, texto suave con contraste ≥ 4,5:1, panel lateral, ancho de la matriz). El resto de grises pequeños de la paleta de `main` no se auditó uno por uno.
  - Verificado tras la fusión: typecheck 0 errores; `test:logica` 94 pruebas (93 pasan, 0 fallan, 1 omitida; incluye las de `main`); build OK. Archivos protegidos y `supabase/` idénticos a `origin/main`; `RedirigirRecuperacion` y `useEsperaPerfil` idénticos. **Sin revisión visual con sesión iniciada**: la mezcla de dos rediseños puede dejar detalles de estilo por pulir.
