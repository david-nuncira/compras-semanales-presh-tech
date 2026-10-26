# Manual breve por rol — Compras Semanales Presh Tech

Entrar: abre la dirección de la aplicación, escribe tu correo y contraseña.
Primera vez: **Registrarme** → tu cuenta queda *pendiente* hasta que el administrador
verifique tu identidad y la active. ¿Contraseña olvidada? Pídele al administrador un
enlace de recuperación por un canal corporativo (no llegan correos automáticos).

Los estados siempre se muestran con texto (no solo color). El botón **Actualizar** de
cada pantalla trae las novedades de otras sesiones; además se refrescan solas cada
minuto mientras la pestaña esté visible.

---

## Solicitante

1. **Mis solicitudes → + Nueva solicitud**: elige área, centro de costo y la **semana
   objetivo de compra** (lunes a domingo; se guarda el lunes).
2. En la solicitud (queda en **borrador**): **+ Agregar artículo** con nombre,
   descripción (medidas, color, material), cantidad, unidad, prioridad y, si la conoces,
   fecha requerida. Adjunta imagen o ficha técnica (JPG/PNG/WebP/PDF, máx. 5 MB, 3 por
   artículo). Puedes guardar el borrador y volver después.
3. **Enviar solicitud** cuando esté completa. Después del envío ya no se edita
   directamente: si Compras la devuelve **en corrección**, verás el motivo, ajustas y
   **Reenviar**.
4. Sigue el avance por artículo (cada uno viaja independiente): etapa, aprobación,
   llegada estimada, cantidades recibidas/entregadas. “Sin información” significa que
   Compras aún no registra ese dato (no es un cero).
5. Cuando te entreguen algo, usa **Confirmar recibido** en la entrega correspondiente.
6. ¿Algo mal (producto equivocado, entrega incorrecta, faltan datos)? **Reportar
   novedad** en el artículo: queda registrada y Compras la atiende con resolución.
7. Puedes **cancelar** un artículo o la solicitud (con motivo) mientras no estén en
   compra, y **reprogramar la semana** con motivo (queda trazado).

No puedes: ver solicitudes de otras personas, cambiar precios/proveedores/decisiones ni
tu propio rol o área (eso lo gestiona el administrador).

## Compras

Pantalla **Gestión de compras**: cola completa de artículos de toda la empresa con
filtros (etapa, semana, área, centro, proveedor, solicitante, atrasados, con novedades)
y **Exportar CSV** (respeta tus filtros y permisos).

Por artículo (ábrelo desde la lista):
1. **Tomar para cotizar** → registra una o varias **cotizaciones** (proveedor, precio,
   impuestos/descuentos/otros) → **Seleccionar** la elegida (selección inequívoca; pasa a
   *cotizado*).
2. **Aprobación**: si aplica, **Configurar** (requiere aprobación + aprobador designado)
   y **Solicitar aprobación**. La compra queda bloqueada mientras esté pendiente o
   rechazada. Cambios materiales posteriores (cantidad/precio/proveedor) generan una
   nueva aprobación y conservan la anterior.
3. **Registrar compra**: cantidad, fecha, costos asociados, referencia y **llegada
   estimada**. Los totales los calcula el servidor. Cambios de fecha estimada guardan el
   historial con motivo. El importe comprado no implica pago registrado.
4. **Seguimiento**: *en tránsito*, movimientos de **recepción** (parciales), **entrega**
   al solicitante, **devolución al proveedor** (con o sin reposición) y **retorno** del
   solicitante. El sistema impide sobreentregas, dobles recepciones y saldos negativos;
   una devolución de algo ya entregado exige primero su retorno. “Entrega directa” deja
   los dos eventos (recepción + entrega).
5. **Novedades**: registra/atiende/resuelve (entrega incorrecta, producto mal
   solicitado, datos incompletos, observación) con evidencia adjunta.
6. **Cerrar artículo** cuando esté resuelto; si queda saldo pendiente o novedades
   abiertas, el cierre exige resolución documentada.
7. **Compras externas**: registra compras hechas por fuera (o regularizaciones) con su
   referencia única, si están en el sistema corporativo (sí/no/por confirmar), importe
   (vacío = sin información) y soportes; se pueden vincular a una solicitud sin que se
   cuenten dos veces. **Reportes**: costos por área/centro/mes/proveedor, por moneda
   separada, con exportación.

## Aprobador

Pantalla **Aprobaciones**: verás solo lo asignado a ti. Cada tarjeta muestra exactamente
qué apruebas (artículo, cantidad, proveedor, importe estimado). **Aprobar** o
**Rechazar** (el rechazo exige motivo). No puedes decidir tu propia solicitud. Si
Compras cambia algo material después, te llegará una nueva aprobación (la tuya anterior
queda en el historial).

## Almacén

Pantalla **Almacén**: pestañas *Por llegar*, *Disponibles* y *Con entregas*. Desde la
ficha del artículo registras **recepciones** (pueden ser parciales), **entregas** (quién
recibe es obligatorio), **devoluciones al proveedor** y **retornos**. La fecha efectiva
la declaras tú; la fecha técnica la pone el servidor. El sistema te avisa si intentas
entregar más de lo disponible o recibir más de lo comprado.

## Administrador

- **Usuarios**: activa cuentas tras verificar identidad por canal corporativo, asigna
  permisos (pueden coexistir), cambia áreas, desactiva/reactiva (bloqueo inmediato).
- **Catálogos**: áreas, centros de costo y proveedores (desactivar, nunca borrar).
- **Auditoría**: consulta quién cambió qué, cuándo y con qué motivo (solo lectura).
- **Recuperación de acceso**: genera enlaces de un solo uso tras verificar identidad.
- **Importación CSV**: analiza el formato histórico, registra lotes en la zona de
  revisión, aprueba filas, confirma (sin duplicados) y, si un renglón sigue vivo, lo
  convierte en solicitud nueva.
- No puedes editar ni borrar la auditoría, ni quedarte sin administradores activos.
  Detalles y procedimientos: `PRIMER_ADMINISTRADOR.md`.

---

## Cambios de la versión 2 (aprobación del jefe y calendario)

**Solicitante**
- El botón ahora dice **“Enviar a aprobación”**: tu solicitud va primero a tu jefe de área, no
  directo a Compras. Antes de enviar ves quién la aprobará y para qué fecha la recibiría Compras.
- Guardar un borrador no envía nada. Puedes enviar cualquier día; Compras la recibe en su fecha
  de recepción (calendario visual de semanas).
- Si tu jefe o Compras la **devuelven**, ves el motivo en la solicitud y en la pestaña
  “Devueltas”; corriges y la reenvías (queda la versión anterior en el historial).
- Después de enviar ya no puedes cambiarla ni cancelarla directamente: usa **“Pedir devolución
  para corregir”**. Si ya hay artículos comprados, usa **“Reportar novedad”**.
- El área es la tuya; el centro de costo se elige solo entre los autorizados para tu área
  (si es uno solo, queda fijo). La unidad se elige de la lista; el enlace de compra va en su
  propio campo y no reemplaza las especificaciones; el proveedor sugerido es opcional.
- Adjuntos: arrastra las fotos o PDF; ves el progreso y una miniatura.

**Jefe de área (o ruta superior)**
- Menú **“Por aprobar (jefe)”**: ves la solicitud completa con sus adjuntos y decides
  **Aprobar**, **Devolver para corrección** (motivo obligatorio) o **Rechazar** (motivo obligatorio).
- También resuelves las peticiones de devolución de solicitudes que aprobaste y que aún no llegan a Compras.
- No puedes decidir tus propias solicitudes: van a la ruta superior de tu área.

**Compras**
- La bandeja **solo** muestra solicitudes aprobadas y liberadas según el calendario (las
  extraordinarias primero). Lo pendiente de aprobación no te llega.
- Recibes un resumen agrupado por cada lote liberado (campana y, si TI lo habilita, correo).
- Si devuelves una solicitud, al reenviarse pasa otra vez por el jefe.

**Almacén**: pestañas *Por llegar*, *Disponibles en almacén*, *Pendientes de entrega* y *Con
entregas*; los movimientos tienen nombres más claros (ingreso al almacén, entrega al
solicitante, devolución al proveedor, retorno al almacén).

**Consulta global**: menú “Consulta global” con todo lo enviado; cada solicitud indica si ya
es de Compras o no. No permite modificar nada.

**Administración**: ver `docs/v2/GUIA_CONFIGURACION.md` (estructura, calendario, emergencias, catálogos y permisos separados).
