# Plan de rediseño del frontend

Rama: `mejora/frontend-ux` (desde `main` `2650944`). Reglas: ver `CLAUDE.md`. Hallazgos: ver `AUDITORIA.md`.

## Resultado base (Fase 0, 2026-11-11, Node 24.22.1)

| Comando | Resultado |
|---|---|
| `npm ci` | **Falla**: no existe `package-lock.json` en el repo. Se trabajó con el `node_modules` que ya existía. |
| `npm run typecheck` | **11 errores**, todos en `src/paginas/AdminCatalogos.tsx` (líneas ~115–168: tipo `PostgrestFilterBuilder` frente a `Promise`). Ya existían en `main`. |
| `npm run test:logica` | **Falla por el script**: en Node 24, `node --test pruebas-logica/` trata la carpeta como módulo. Con `pruebas-logica/*.test.ts`: 39 pruebas, 38 pasan, 0 fallan. |
| `npm run build` | **Verde** (487 kB de JS, 10,9 kB de CSS). |

### Decisiones pendientes de David (afectan la regla «verde antes de cada commit»)
1. **Typecheck:** `AdminCatalogos.tsx` no está en la lista protegida. Propuesta: corregir los tipos sin cambiar la lógica, como primer commit de la Fase 1.
2. **Script de pruebas:** cambiar `test:logica` a `pruebas-logica/*.test.ts` (solo `package.json`).
3. **`package-lock.json`:** generarlo y versionarlo para que `npm ci` funcione y Cloudflare instale lo mismo.

## Fase 1 · Sistema de diseño y navegación
Alcance: tokens (color, espaciado de 4 px, radios, sombras, tipografía), ampliación de `UI.tsx` (Botón, Campo, Select, Textarea, Insignia con ícono, Tabla de datos, Panel lateral, Modal con foco, Pestañas, Estado vacío, Esqueleto, Paginación), barra lateral + menú móvil con contadores, inicio por rol, `React.lazy` por ruta, filtros en la URL, CSS de acceso sin tocar su lógica. Documentar en `SISTEMA_DE_DISENO.md`.
Verificación:
- [ ] typecheck, test:logica y build en verde
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
