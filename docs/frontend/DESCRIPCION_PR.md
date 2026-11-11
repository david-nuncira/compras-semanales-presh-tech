# Rediseño del frontend (mejora/frontend-ux → main)

**No fusionar** hasta completar la revisión manual en la vista previa de Cloudflare (banda roja: usa la base real).

## Resumen
Sistema de diseño con tokens y componentes, navegación lateral con contadores, Inicio por rol, asistente de nueva solicitud en 4 pasos, detalle con línea de tiempo, bandejas con panel lateral, matriz de cotizaciones y panel analítico. Sin cambios de backend ni dependencias nuevas.

## Pantallas
Leyenda: **Implementado** = código terminado y compilado. **Probado (lógica)** = pruebas automáticas. **Revisión manual** = falta recorrerlo con sesión iniciada (no se pudo hacer sin credenciales).

| Pantalla | Implementado | Probado | Evidencia / pendiente |
|---|---|---|---|
| Acceso, Restablecer, Pendiente (solo CSS) | Sí | Acceso medido a 360/768/1280 px | Sin scroll horizontal, botones de 44 px, campos de 16 px, sin errores de consola. Lógica intacta. |
| Menú lateral, contadores, Inicio por rol | Sí | Compila | Revisión manual |
| Mis solicitudes (filtros en URL) | Sí | Compila | Revisión manual |
| Nueva solicitud (asistente de 4 pasos) | Sí | Compila | Revisión manual: crear borrador, foto, duplicar, enviar |
| Detalle de solicitud (línea de tiempo, devolución, tabla) | Sí | 15 pruebas de la línea de tiempo | Revisión manual con solicitud devuelta, rechazada y en Compras |
| Por aprobar (jefe) | Sí | Compila | Revisión manual; sin aprobación múltiple (el servidor no la soporta) |
| Gestión de compras (panel, orden, filas) | Sí | Compila | Revisión manual |
| Almacén (recibido X de Y, bloqueo de entregas) | Sí | Compila | Revisión manual |
| Matriz de cotizaciones | Sí | 11 pruebas con los datos reales de la hoja (21 artículos, total 2.786.300) | Revisión manual con una solicitud con cotizaciones |
| Panel analítico del Inicio | Sí | 12 pruebas de cálculo | Revisión manual; definiciones de estimado/comprometido/ejecutado por confirmar con Compras |

## Verificación (salida real)
- `npm ci` OK · `npm run typecheck` 0 errores · `npm run test:logica` 77 pruebas: 76 pasan, 0 fallan, 1 omitida · `npm run build` OK.
- Paquete principal: 316,7 kB (antes 487 kB); cada pantalla se carga al abrirla.
- Contraste de los tokens calculado: AA en todos los pares (borde de campos ajustado a 3,7:1).

## Archivos modificados
- **Documentos:** `CLAUDE.md`, `docs/frontend/*` (auditoría, plan, sistema de diseño, requiere backend, guía de cambios).
- **Configuración:** `package.json` (script `test:logica` con patrón de archivos), `package-lock.json` (nuevo).
- **Núcleo de interfaz:** `src/estilos.css`, `src/componentes/UI.tsx`, `Navegacion.tsx`, `Graficos.tsx`, `LineaTiempo.tsx`, `Miniatura.tsx`, `PanelAnalitico.tsx`, `Adjuntos.tsx`, `src/contexto/Resumen.tsx`, `src/App.tsx`.
- **Pantallas:** `Tablero`, `MisSolicitudes`, `AsistenteSolicitud` (nueva), `SolicitudDetalle`, `AprobacionSolicitudes`, `GestionCompras`, `ArticuloGestion`, `Almacen`, `ConsultaGlobal`, `MatrizCotizaciones` (nueva), `AdminCatalogos` (solo un tipo de TypeScript).
- **Utilidades y pruebas:** `src/util/{estadoUrl,envio,lineaTiempo,matriz,tablero}.ts`, `pruebas-logica/{lineaTiempo,matriz,tablero}.test.ts`.

## Archivos protegidos: intactos
`git diff main --stat` sobre `supabase/`, `public/`, `src/contexto/Sesion.tsx`, `src/supabase.ts`, `src/config.ts`, `Acceso.tsx`, `Restablecer.tsx`, `PendienteActivacion.tsx` y `AdminRecuperacion.tsx`: **sin cambios**. En `App.tsx`, `RedirigirRecuperacion` y `useEsperaPerfil` son idénticos.

## Dependencias
Ninguna nueva. Gráficos en SVG propio.

## Pendiente del backend (resumen de `REQUIERE_BACKEND.md`)
Historial por etapa con responsable; contenido de versiones anteriores; editar datos generales de un borrador; indicador de entregas del solicitante; centro de costo destino por artículo; aprobación de la matriz completa; filtros de área/centro de costo en `fn_indicadores` y `fn_resumen_tablero`; importes estimado/comprometido/ejecutado calculados en servidor; aprobación múltiple.

## Pendiente del frontend
`window.prompt` al renombrar en `AdminCatalogos`; `window.confirm` en `AdminRecuperacion` (protegida); filtros en URL en el resto de listas.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
