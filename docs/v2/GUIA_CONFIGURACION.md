# Guía sencilla de configuración (mejora v2)

Todo se configura desde la aplicación, en **Administración**. Nada de jefes, áreas,
centros de costo ni horarios está escrito en el código. Cada cambio queda en la auditoría.

## 0 · Quién puede configurar qué

| Permiso | Qué puede hacer |
|---|---|
| Administrador general | Todo, incluidos los permisos privilegiados |
| Administrar usuarios | Activar cuentas y dar permisos básicos (solicitante, compras, almacén, aprobador de cotización). **No** toca cuentas de administración ni da consulta global ni emergencias |
| Administrar catálogos | Estructura (jefes, personas por área, centros de costo), calendario, unidades y catálogos |
| Consulta global | Ver toda la operación enviada, sin modificar nada |

**Propuesta para las responsables de Compras** (pendiente de que la confirmen): Compras +
Consulta global + Administrar usuarios. Así ven todo y activan cuentas sin poder quitar
permisos a otros administradores. Ninguna recibe "Administrador general" por defecto.

## 1 · Estructura (Administración → Estructura)

Para cada área, en este orden:

1. **Paso 1 · Quién aprueba**
   - **Jefe de área:** aprueba las solicitudes del área antes de Compras.
   - **Ruta superior** (opcional): aprueba las solicitudes que hace el propio jefe. Si falta y el
     jefe solicita, su solicitud queda en borrador con un aviso. Nunca hay autoaprobación.
   - Si cambias el jefe, las solicitudes **pendientes** del área pasan al nuevo. Si no queda
     ningún aprobador válido, vuelven al solicitante con aviso y **no** pasan a Compras.
2. **Paso 2 · Personas del área:** selecciona a los solicitantes (Ctrl + clic para varios) y
   pulsa **Vincular seleccionadas**. Cada persona solicita solo para su área.
3. **Paso 3 · Centros de costo autorizados:** marca los que puede usar el área.
   - **Uno solo:** se selecciona automáticamente y no se puede cambiar (evita errores como
     cargar a Físico-químico lo que era de otra destinación).
   - **Varios:** el solicitante elige solo entre esos.
   - Para la asignación inicial, el recuadro "Pendientes de configuración" permite asociar un
     centro de costo (por ejemplo, el de compra semanal) a **todas** las áreas que aún no
     tienen ninguno. Hazlo solo con el código que Compras confirme.

> Empezar por **Producción** (acordado en la reunión): crea en Catálogos los centros de costo
> de sus destinaciones con los códigos y nombres oficiales de Contabilidad y márcalos en el
> paso 3 de Producción. Para Mantenimiento, confirma si es un área propia o una destinación
> de Producción antes de configurarlo.

## 2 · Calendario de recepción (Administración → Calendario)

1. **Días de recepción de Compras:** por ejemplo, lunes.
2. **Días no laborables:** por ejemplo, sábado y domingo, si aplica.
3. "Si el día de recepción es festivo, usar el siguiente día hábil": **activado**. Así queda
   "el primer día hábil de gestión".
4. **Hora de liberación:** a qué hora aparece el lote en la bandeja de Compras ese día.
5. **Hora de corte** y "días antes": lo aprobado antes de ese momento entra al ciclo.
6. **Si el jefe aprueba después del corte:** la propuesta es pasarla al siguiente ciclo. Queda
   marcada como **"pendiente de validación"** hasta que Compras la confirme; entonces marca
   la casilla de política validada.
7. Marca **Calendario activo** y guarda.
   - Mientras está inactivo, lo aprobado pasa de inmediato a Compras.
   - La vista previa de la misma pantalla muestra las próximas 8 semanas para verificar.
8. **Festivos:** agrégalos uno a uno con su fecha y descripción. No vienen precargados.
9. **Ventanas por categoría** (por ejemplo, papelería del mes siguiente):
   - Crea la categoría y luego la ventana: abre, cierra y fecha de recepción.
   - Las solicitudes de esa categoría se programan para la próxima ventana.
10. **Ejecutar liberación ahora:** sirve para probar. Normalmente el servidor lo hace solo cada 15 minutos.

## 3 · Emergencias

En **Usuarios → Permisos**, el administrador general da el permiso **"Solicitudes
extraordinarias"** solo a las personas autorizadas. Inicialmente son de Mantenimiento; las
cuentas exactas están pendientes de confirmar.

- Quien lo tiene ve una casilla "Solicitud extraordinaria" con motivo obligatorio.
- Salta el calendario, pero **sí requiere la aprobación del jefe**.
- La prioridad "Alta" no es una emergencia.
- Frecuencia y gasto se ven en el Inicio y en la Consulta global.

## 4 · Catálogos (Administración → Catálogos)

- **Unidades de medida:** vienen unidades genéricas (Unidad, Par, Caja, Metro…). Agrega, renombra o desactiva.
- **Áreas, centros de costo y proveedores:** crear, renombrar, desactivar y reactivar. Lo desactivado no aparece en solicitudes nuevas, pero se conserva en lo histórico.

## 5 · Usuarios (Administración → Usuarios y permisos)

1. La persona se registra y queda **pendiente**.
2. Verificas su identidad por un canal corporativo.
3. **Activar…** con sus permisos y su área.
4. Si va a solicitar, confirma en **Estructura** que su área tenga jefe y centro de costo.

## 6 · Correos (opcional, requiere a TI)

Las notificaciones **dentro de la app** (campana 🔔) funcionan desde el primer día. Para que
además salgan por correo, sigue `CORREOS_MICROSOFT_GRAPH.md` con TI. Cuando esté listo,
activa `correo_habilitado` (te acompaño en ese paso).
