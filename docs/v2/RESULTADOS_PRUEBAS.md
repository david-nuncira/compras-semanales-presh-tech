# Resultados de pruebas · mejora v2 (26-oct-2026)

**Ejecutado de verdad** en el entorno de desarrollo, que no tiene PostgreSQL ni npm, sí Node 22
y un compilador TypeScript 7:

| Prueba | Resultado |
|---|---|
| Pruebas de lógica (`node --test pruebas-logica/`) | **35/35 PASA**: 15 de la línea base y 20 nuevas |
| Compilación de tipos TypeScript del frontend (41 archivos, con declaraciones mínimas para React, el router y Supabase) | **0 errores**. Detectó y se corrigió 1 error real |
| Verificador de importaciones | 197 importaciones relativas y 419 nombres: **0 rotos** |
| Archivos de acceso sin cambios (`git diff main`) | **Vacío**: no se tocaron |

Las 20 pruebas nuevas cubren:

- **Ciclos de recepción:** envío a mitad de semana; aprobada antes de su fecha (sigue
  programada); sin aprobar no se libera; corte exacto (07:59 entra, 08:00 pasa al siguiente);
  después del corte con "siguiente ciclo" y con "mismo ciclo"; lunes festivo movido al siguiente
  día hábil o saltado; corte el día anterior; semana objetivo posterior; ventanas de papelería,
  con y sin ventana vigente; emergencia; liberación repetida sin duplicar.
- **Guarda de entorno:** producción frente a vista previa frente a equipo local.
- **Formularios:** errores por campo, el enlace no reemplaza las especificaciones, enlace
  `javascript:` rechazado, centro de costo único fijo, reglas de corrección y devolución.

> La regla del calendario se probó con un **modelo de referencia** (`pruebas-logica/modelo_calendario.ts`)
> que replica paso a paso la función SQL `app.calcular_ciclo`. La versión SQL se valida con la suite de abajo.

**Revisión independiente del SQL**, hecha por un segundo revisor sin acceso a mis conclusiones.
Encontró 13 puntos y todos se corrigieron:

- **Grave:** una solicitud del flujo anterior reenviada podía comprarse antes de la aprobación del
  jefe. Ahora se limpia su visibilidad y hay **barreras de servidor** en cotizar, comprar y
  configurar la aprobación.
- **Grave:** al quitar un jefe, sus pendientes quedaban con él. Ahora vuelven al solicitante con aviso.
- **Permisos:** las tablas nuevas heredaban permisos amplios. Ahora se retiran y se conceden solo los necesarios.
- **Suite:** usaba la fecha UTC; una prueba no probaba nada (ya prueba "programada sin aprobación
  vigente"); se agregó la prueba directa de autoaprobación.
- Otros: peticiones de devolución huérfanas, centro de costo en la importación, protección del
  jefe al crear un área, visibilidad de perfiles y correos atascados.

## EJECUTADO EN LA BASE REAL (26-oct-2026, 11:37, ensayo revertido)

Diagnóstico previo: **LISTO PARA MIGRAR** (15/15 funciones a reemplazar idénticas a la línea base,
sin funciones agregadas). Paso C (0013) aplicado: Success.

Ensayo general `02_ensayo_sin_cambios.sql` sobre la base de producción (migración 0014–0016 completa
+ suite v2 sobre los datos reales, y luego reversión intencional):

> **PASA=62 · FALLA=0 · MANUAL=1** — "Sin fallas: se puede aplicar la versión definitiva."

(El caso MANUAL es el inicio de sesión y la recuperación de contraseña, que se verifican en la vista previa.)

## Detalle de la suite (referencia)

`supabase/pruebas/pruebas_aprobacion_v2.sql`, con su resultado esperado:

| Escenario del encargo | Casos en la suite |
|---|---|
| Un borrador no llega a Compras | E1 (Compras, consulta y jefe no lo ven) |
| La solicitud llega al jefe correcto | E2 (+ notificación, bandeja del jefe, Compras no la ve, consulta la marca "no es de Compras") |
| El jefe de otra área no puede aprobarla | E3 (+ Compras tampoco) |
| No hay autoaprobación por combinación de roles | E4 (sin ruta superior queda en borrador; ruta superior; autoaprobación imposible aunque se asigne) |
| Aprobada antes de su fecha permanece programada | E5 |
| Sin aprobar no se libera al llegar la fecha | E6 (pendiente, y programada sin aprobación vigente) |
| La aprobación después del corte sigue la política | E7b (antes del corte, después del corte, base de envío) |
| La devolución permite corregir y reenviar con historial | E8 (motivo visible, versión 2, decisión anterior conservada, versión vieja rechazada) |
| Emergencia solo para autorizados | E9 (sin permiso, rechazo; con permiso, sigue necesitando al jefe; liberación inmediata; trazabilidad) |
| El centro de costo pertenece al área autorizada | E10 (+ área ajena, centro por artículo, unidad, enlace) |
| Correos y liberaciones no se duplican | E11 |
| Recepciones y entregas parciales consistentes | E12 (+ Compras no cotiza lo no liberado; avisos al solicitante) |
| Inicio de sesión y recuperación siguen funcionando | E13 (contrato de sesión, desactivación inmediata) + **manual** en la vista previa |
| Permisos granulares y migración | 1, MIG |

**Manual en la vista previa** (lista en `GUIA_APLICAR_MEJORA_V2.md`, Parte 3): inicio de sesión
con tus correcciones, recuperación con enlace de un solo uso, adjuntos con progreso y recorrido completo.
