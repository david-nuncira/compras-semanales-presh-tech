# Mejora v2 · Diagnóstico, reglas y decisiones pendientes

## Origen de cada cambio

| Fuente | Contenido |
|---|---|
| **Feedback de la reunión** (transcripción *Feedback App*) | Área con centros de costo vinculados y no modificables por error (empezar por Producción y sus destinaciones, Mantenimiento por confirmar, el resto "compra semanal"); unidad desde catálogo; campo de enlace de compra; proveedor opcional; recepción de Compras el primer día hábil de la semana sin bloquear el envío; mensaje de recepción; fechas para papelería del mes siguiente; emergencias solo para Mantenimiento y con medición; indicador de anticipación; consulta total para las responsables de Compras sin poder quitar permisos (quedó abierto); avisos junto a la acción; adjuntos más intuitivos y visibles en Compras; devolución con historial; calendario de semanas con festivos; tablero de inicio |
| **Instrucción adicional prioritaria** | Aprobación del jefe de área antes de que la solicitud llegue a Compras |
| **Reglas propuestas para cubrir vacíos** (pendientes de validar) | Las de la sección siguiente |

## Reglas propuestas (implementadas como configuración o control, no como decisión aprobada)

1. **Sin autoaprobación**, aunque la persona tenga varios roles. El servidor lo impide siempre.
2. Si el solicitante es el jefe del área, aprueba la **ruta superior** configurada en el área.
3. Si falta el aprobador, la solicitud **queda en borrador** con el motivo visible y no pasa a Compras.
4. Si cambia el contenido de una solicitud ya enviada (por devolución), se crea una **nueva
   versión con nueva aprobación**; las anteriores se conservan.
5. **Aprobación después del corte → siguiente ciclo habilitado.** Queda marcada "pendiente de
   validación" y es configurable ("mismo ciclo" como alternativa).
6. **Centro de costo por solicitud.** Las varias destinaciones por artículo quedan bloqueadas
   hasta confirmarlo.
7. **Las aprobaciones de cotización o gasto existentes se conservan como aprobación posterior
   opcional.** No hay una segunda aprobación universal ni umbrales de monto.
8. **Históricos:** las solicitudes enviadas antes de la v2 quedan marcadas "flujo anterior".
   No se les inventa ninguna aprobación del jefe. Su recepción por Compras es su fecha de envío,
   porque así funcionaba el flujo anterior.
9. **Las peticiones de devolución las autoriza el responsable de la etapa:** el aprobador si aún
   no llegó a Compras; Compras si ya la recibió. Con artículos comprados se usa una novedad.

## Qué existía y qué cambió

| Bloque | Ya existía | Cambio v2 |
|---|---|---|
| 1 Jerarquía | 5 roles; área en el perfil | Jefe y ruta superior por área; permisos separados: consulta global, administrar usuarios (sin privilegiados), administrar catálogos y emergencias. Pantalla "Estructura" en 3 pasos |
| 2 Aprobación previa | Al enviar llegaba directo a Compras; Compras veía también borradores | Recorrido Borrador → Pendiente del jefe → Programada → Recibida por Compras → gestión. Compras solo ve lo liberado y la consulta global distingue lo que aún no es de Compras. Doble barrera en el servidor: visibilidad (RLS) y operaciones (disparadores que bloquean cotizar o comprar si no está liberada) |
| 3 Calendario | Solo semana objetivo | Ciclos, día hábil, corte, festivos, ventanas por categoría, reprogramación con calendario visual, liberación automática en el servidor cada 15 min (pg_cron) y ocho fechas diferenciadas |
| 4 Emergencias | — | Permiso específico, motivo obligatorio, salta el calendario pero no la aprobación del jefe, vista e indicadores de frecuencia y gasto |
| 5 Centros de costo | Cualquier centro para cualquier área | Asociación área ↔ centro administrable, validada en el servidor; selección automática si hay uno solo |
| 6 Formularios | Unidad en texto libre; enlace mezclado en la descripción | Catálogo de unidades, enlace de compra en su propio campo (no reemplaza las especificaciones), proveedor sugerido opcional, obligatorios y opcionales marcados, errores junto al campo |
| 7 Correcciones | Compras devolvía; el solicitante podía cancelar después de enviar | Petición de devolución autorizada por el responsable; versiones; cancelación solo en borrador o corrección; con compras se usa novedad |
| 8 Interfaz | Mensajes arriba de la página; adjuntos con selector simple | Avisos flotantes y junto a la acción; arrastrar y soltar con progreso, miniaturas y visor; historial en lenguaje sencillo; línea de avance; bandejas por rol; filtros completos en Compras |
| 9 Notificaciones e indicadores | Tablero básico | Campana con notificaciones, cola de correos idempotente con reintentos (Microsoft Graph), resumen agrupado a Compras por lote, indicadores de anticipación, tiempos por etapa, gasto y emergencias |
| 10 Almacén, histórico, auditoría | Funcionaban | Se conservan; nombres de movimientos más claros; pestaña "Pendientes de entrega"; la importación CSV sigue funcionando (al enviar, la solicitud convertida pasa por la aprobación del jefe); auditoría de jefes, asociaciones, calendario, catálogos y aprobaciones |

## Decisiones de negocio pendientes (para responder)

| # | Pregunta | Mientras tanto |
|---|---|---|
| 1 | **¿Quién aprueba las solicitudes de cada jefe de área?** (por ejemplo, Nicolás) ¿Una persona por área o una única ruta superior? | Se configura por área; si falta, la solicitud del jefe queda en borrador |
| 2 | **Jefe de cada área**, en especial Producción y Mantenimiento | Ninguno precargado |
| 3 | **¿Qué cuentas tienen permiso de emergencia?** La reunión menciona a Mantenimiento, pero no identifica con claridad las cuentas | Nadie lo tiene |
| 4 | **Permisos de las responsables de Compras:** ¿Compras + consulta global + administrar usuarios, o algo distinto? | Nadie recibe administración total por defecto |
| 5 | **Calendario:** día de recepción, hora de liberación, hora de corte, días no laborables y festivos | Calendario inactivo (lo aprobado pasa de inmediato) |
| 6 | **Política después del corte:** ¿siguiente ciclo (propuesta) o mismo ciclo? | Siguiente ciclo, marcada sin validar |
| 7 | **Centros de costo de Producción y sus destinaciones** (códigos y nombres de Contabilidad); relación de Mantenimiento; código de "compra semanal" para las demás áreas | Se configuran desde Estructura; no se inventaron códigos |
| 8 | **¿El centro de costo se asigna por solicitud o por artículo?** | Por solicitud |
| 9 | **¿Un líder de área debe ver todas las solicitudes de su área** (no solo las que aprueba)? | Ve las que le toca aprobar |
| 10 | **Ventanas de papelería:** fechas de solicitud y de recepción de cada mes | Ninguna configurada |
| 11 | **Correo:** ¿TI autoriza la aplicación de Microsoft Graph y qué buzón remitente se usa? | Solo notificaciones dentro de la app |
| 12 | **¿Un cambio material hecho por Compras** (cantidad o precio) debe volver a la aprobación del jefe, o basta la aprobación de cotización existente? | Basta la aprobación de cotización configurada por artículo |

## Limitaciones conocidas

- **Recuperación de contraseña:** sigue reservada al administrador general. La función de
  recuperación no se modificó, para no tocar tus correcciones. Extenderla a "Administrar
  usuarios" es un cambio separado.
- **Jefe desactivado:** sus solicitudes pendientes quedan esperando. La pantalla Estructura lo
  advierte y, al asignar el nuevo jefe, se reasignan solas.
- **Pausa del plan gratuito:** si el proyecto se pausa por inactividad, el reloj programado se
  detiene hasta que se reanude. No está documentado si las ejecuciones de cron cuentan como actividad.
- **Vistas previas de Cloudflare:** son públicas por defecto. Hay que restringir ramas (guía,
  Parte 2); la app además se niega a usar producción desde una vista previa.
