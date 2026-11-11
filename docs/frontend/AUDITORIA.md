# Auditoría del frontend (Fase 0)

Rama `mejora/frontend-ux`, creada desde `main` (`2650944`). Solo lectura: no se cambió código de la app.

## Mapa de pantallas por rol

| Rol / permiso | Pantallas |
|---|---|
| Todos (activos) | Inicio (`Tablero`), Notificaciones, Detalle de solicitud |
| `solicitante` | Mis solicitudes (incluye el alta de solicitud) |
| `jefe` | Por aprobar (`AprobacionSolicitudes`) |
| `gestor` (compras o administrador) | Gestión de compras, Artículo (`ArticuloGestion`), Compras externas, Reportes, Almacén |
| `almacen` | Almacén |
| `aprobadorCotizacion` | Aprobación de cotizaciones |
| `consultaGlobal` | Consulta global, Reportes |
| `adminUsuarios` / `adminCatalogos` / `adminGeneral` | Administración: usuarios, estructura, calendario, catálogos, auditoría, recuperación, importación |
| Sin sesión | Acceso, Restablecer, Pendiente de activación |

## Problemas de UX concretos

1. **Navegación:** `App.tsx` → `Cabecera` pone hasta 9 enlaces en una sola barra horizontal que salta de línea. Es larga en escritorio y no hay menú compacto en móvil. No hay contadores de pendientes; solo la campana.
2. **Inicio:** `Tablero.tsx` es el mismo para todos los roles. No hay «lo que tienes que hacer hoy».
3. **Alta de solicitud:** `MisSolicitudes.tsx` mezcla lista y formulario en un solo componente, con 15 estados locales. No es un asistente por pasos.
4. **Detalle:** `SolicitudDetalle.tsx` (523 líneas) usa `LineaRecorrido` (chips) e `HistorialSolicitud` por separado. No hay línea de tiempo con responsable, duración y etapas futuras.
5. **Estados:** `LineaRecorrido` (`UI.tsx`) marca ✓ a todo lo anterior. Las insignias de solicitud (`InsigniaSolicitud`) llevan solo color y texto, sin ícono.
6. **Listas sin estado en la URL:** `MisSolicitudes`, `GestionCompras` y `ConsultaGlobal` guardan filtros y página en `useState`. «Atrás» pierde la posición.
7. **Sin carga diferida:** `App.tsx` importa las 22 páginas de forma estática (bundle único de 487 kB).
8. **Esqueleto de carga:** solo existe `Cargando` (texto). Faltan esqueletos, estado vacío con acción y estado de error con reintento unificados.
9. **Confirmaciones:** `confirm()` nativo en `SolicitudDetalle.tsx`, `Adjuntos.tsx` y `AdminRecuperacion.tsx` (esta última es protegida).
10. **Edición en Compras:** `GestionCompras` navega a otra pantalla (`ArticuloGestion`, 780 líneas) y se pierde la posición en la lista.

## Inconsistencias visuales

- Los colores de estado están repetidos en `estilos.css` (etapas, aprobación, solicitud) con códigos hexadecimales fijos. Solo hay 8 tokens (color) y no hay tokens de espaciado, radios, sombras ni tipografía; los valores en `rem` son arbitrarios.
- Tres formas de botón sin variante de carga. `boton-silencioso` se usa para acciones y para cerrar.
- Emojis (🛒 🔔 ✓ ✕ ⚠) como íconos, sin un conjunto coherente.
- `Modal` y `Paginador` son los únicos componentes complejos; faltan Select, Textarea, Tabla de datos, Pestañas, Panel lateral y Esqueleto.
- Un solo punto de corte responsive (640 px). No hay reglas para tablet ni pantalla grande.

## Riesgos de accesibilidad

- **Modal** (`UI.tsx`): cierra con Esc, pero no atrapa el foco, no lo devuelve al botón de origen y no tiene `aria-labelledby`.
- **Campo:** el `<label>` envuelve el mensaje de error, así que el lector de pantalla lo lee como parte del nombre; los errores no se enlazan con `aria-describedby`.
- **Foco:** `outline: #9ec5fe` sobre fondo blanco tiene poco contraste (menos de 3:1). Sobre la cabecera verde casi no se distingue.
- **Objetivos táctiles:** botones y enlaces de la cabecera miden alrededor de 30 px, no 44 px.
- **Campos en móvil:** el tamaño de letra baja a 14 px, y en iOS los campos de menos de 16 px hacen zoom automático.
- **Movimiento:** no hay `prefers-reduced-motion` (hoy hay pocas animaciones, pero se sumarán).
- **ARIA:** solo 21 usos de `aria-`/`role` en todo `src`. Las tablas no tienen `<caption>`.
- **Atributos:** `rel="noopener noreferrer"` está bien aplicado; no hay `dangerouslySetInnerHTML` ni `localStorage`.

## Contrato de datos (importante para las fases)

- `src/datos.ts` solo tiene catálogos y utilidades (97 líneas). Las páginas llaman directo a `supabase.from(...)` y `supabase.rpc(...)`: se usan 42 RPC distintas y unas 25 tablas o vistas. El contrato de la regla 4 es, en la práctica, «lo que las páginas ya llaman» más `tipos.ts`. En el rediseño solo se reutilizarán esas mismas llamadas.
- Ya existen `fn_seleccionar_cotizacion`, `fn_estimar_envio`, `fn_resumen_tablero`, `fn_indicadores`, `fn_historial_solicitud` y `fn_devolver_a_correccion`.
