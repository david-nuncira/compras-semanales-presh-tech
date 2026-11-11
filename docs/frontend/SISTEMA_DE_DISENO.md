# Sistema de diseño

Los estilos están en `src/estilos.css` (tokens en `:root`) y los componentes en `src/componentes/UI.tsx`. Se amplía `UI.tsx`; no se duplica. Todas las clases anteriores siguen funcionando.

## Tokens

| Grupo | Tokens |
|---|---|
| Color base | `--tinta`, `--tinta-suave`, `--fondo`, `--tarjeta`, `--superficie-2`, `--borde`, `--borde-fuerte`, `--primario`, `--primario-claro`, `--foco` |
| Estados | `--exito`, `--aviso`, `--peligro`, `--info`, `--neutro` (cada uno con variante `-claro`) |
| Espaciado (4 px) | `--e1` (4) · `--e2` (8) · `--e3` (12) · `--e4` (16) · `--e5` · `--e6` · `--e8` · `--e10` |
| Radios / sombras | `--radio-s/m/l/pill`, `--sombra-1/2/3` |
| Tipografía | `--fs-s` (14 px), `--fs-m` (15 px, cuerpo), `--fs-l`, `--fs-xl`, `--fs-2xl`; campos a 16 px en pantallas de 640 px o menos |
| Medidas | `--alto-control` (40 px), `--alto-tactil` (44 px, en pantallas de 1023 px o menos y táctiles), `--alto-fila` (56 px), `--ancho-lateral` |

El foco visible es un contorno de 3 px (`--foco`) en todo lo interactivo. Con `prefers-reduced-motion` se desactivan las animaciones.

## Componentes (`UI.tsx`)

| Componente | Uso |
|---|---|
| `Boton` | `variante`: `primario`, `secundario`, `peligro`, `fantasma`; `cargando` muestra un indicador, deshabilita y marca `aria-busy`. |
| `Campo` | Etiqueta, `requerido`/`opcional`, `ayuda`, `error`. La ayuda y el error quedan fuera de la etiqueta y enlazados con `aria-describedby`; marca `aria-invalid`. |
| `Select`, `Textarea` | Se usan dentro de `Campo`. `Select` recibe `opciones` e `inicial`; `Textarea` muestra contador si tiene `maxLength` y `contador`. |
| `Insignia` | `tono` (exito, aviso, error, info, neutro) + `icono` + texto. |
| `InsigniaSolicitud`, `InsigniaEtapa`, `InsigniaAprobacion` | Estados con color + ícono + texto. Rechazada y cancelada usan tono de error, nunca de éxito. |
| `TablaDatos` | Columnas, esqueleto si `filas` es `null`, error con reintento, vacío con acción, fila de altura fija y desplazamiento horizontal solo dentro del contenedor. |
| `PanelLateral` | Vista rápida o edición sin salir de la lista. Mismas reglas de foco que `Modal`. |
| `Modal` | Atrapa el foco, se cierra con Esc y devuelve el foco a quien lo abrió. Bloquea el scroll del fondo. |
| `Pestanas` | Roles `tablist`/`tab`, flechas, Inicio y Fin. |
| `EstadoVacio`, `Esqueleto`, `EstadoError`, `SinPermiso`, `Cargando` | Los cuatro estados de cada pantalla. |
| `Paginador` | `nav` con total exacto y botones táctiles. |
| `Icono` | SVG propio (sin dependencias). Oculto a lectores salvo que se pase `titulo`. |
| `MensajeError`, `MensajeExito`, `BotonConMotivo` | Sin cambios de uso. |

## Navegación y marco (`Navegacion.tsx`)

- Barra lateral en pantallas de 1024 px o más; en menos, barra superior con botón de menú y cajón (atrapa el foco y cierra con Esc o al cambiar de ruta).
- Solo muestra los módulos que permite `permisos.ts`. La seguridad real sigue en el servidor.
- Contadores de pendientes (`contexto/Resumen.tsx`, una sola consulta compartida): Mis solicitudes (devueltas), Por aprobar, Gestión de compras, Aprobación de cotizaciones, Almacén (pendientes de entrega) y Notificaciones. Datos de `fn_resumen_tablero` y conteos de `v_articulos`.
- Enlace «Saltar al contenido» para teclado.

## Filtros en la URL

`useEstadoURL` (`src/util/estadoUrl.ts`) guarda filtros, búsqueda y página en la URL, con `replace`. Lo usan Mis solicitudes, Gestión de compras y Consulta global. Pendiente de aplicar a otras listas en las fases 3 y 4.
