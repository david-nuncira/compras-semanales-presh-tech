// Contenido de la guía paso a paso (lenguaje sencillo, sin nombres de personas: solo roles).
// Se muestra en la página «Ayuda» y como ayuda corta en cada pantalla principal.

export interface PasoGuia { titulo: string; texto: string; enlace?: { a: string; texto: string } }
export interface GuiaRol { clave: 'solicitante' | 'jefe' | 'compras' | 'aprobador' | 'almacen' | 'admin'; titulo: string; para: string; pasos: PasoGuia[] }

/** El camino completo de un pedido, de principio a fin. */
export const FLUJO_GENERAL: Array<{ titulo: string; quien: string; texto: string }> = [
  { titulo: 'Borrador', quien: 'Solicitante', texto: 'Crea el pedido y agrega cada artículo con su foto, justificación y descripción. Todavía no lo ve nadie.' },
  { titulo: 'Aprobación del jefe', quien: 'Jefe de área', texto: 'El jefe revisa la necesidad y decide: aprueba, devuelve para corregir (con motivo) o rechaza (con motivo).' },
  { titulo: 'Programada', quien: 'Sistema', texto: 'Si se aprobó, el pedido espera la fecha de recepción de Compras (la calcula el sistema según el calendario).' },
  { titulo: 'Recibida por Compras', quien: 'Compras', texto: 'En esa fecha el pedido aparece en la bandeja de Compras.' },
  { titulo: 'Cotización', quien: 'Compras', texto: 'Compras pide precios a los proveedores y los compara. En mantenimiento se hace en la hoja de mantenimiento.' },
  { titulo: 'Aprobación de la compra', quien: 'Gerencia', texto: 'Si una compra supera el límite por artículo, la aprueba gerencia. Si no lo supera, sigue sola.' },
  { titulo: 'Compra', quien: 'Compras', texto: 'Compras registra la compra (fecha, importes, referencia y llegada estimada).' },
  { titulo: 'Seguimiento y llegada', quien: 'Compras y Almacén', texto: 'Se sigue el envío y Almacén registra lo que llega.' },
  { titulo: 'Entrega', quien: 'Almacén y solicitante', texto: 'Almacén entrega y quien pidió confirma que lo recibió.' },
  { titulo: 'Cierre', quien: 'Compras', texto: 'Cuando todo se entregó, el artículo se cierra y el pedido figura como «Cerrada».' }
];

export const GUIAS: GuiaRol[] = [
  {
    clave: 'solicitante', titulo: 'Si pides compras (solicitante)', para: 'Para crear pedidos y seguirlos hasta que lleguen.',
    pasos: [
      { titulo: 'Empieza un pedido', texto: 'Entra a «Mis solicitudes» y pulsa «Nueva solicitud».', enlace: { a: '/nueva-solicitud', texto: 'Nueva solicitud' } },
      { titulo: 'Paso 1: datos generales', texto: 'Elige el centro de costo, escribe la justificación general y elige la semana en que lo necesitas. «Compras semanales» sigue el flujo normal; «mantenimiento» usa la hoja de mantenimiento.' },
      { titulo: 'Paso 2: artículos', texto: 'Para cada artículo pon el nombre, la cantidad, una foto, para qué se necesita (justificación) y sus medidas o características. En mantenimiento elige también el centro de costo al que se carga. Pulsa «Guardar y agregar otro» para sumar más.' },
      { titulo: 'Paso 3: revisa', texto: 'Mira el resumen. Si algo está mal, vuelve al paso anterior con los botones de arriba.' },
      { titulo: 'Paso 4: envía', texto: 'Pulsa «Enviar a aprobación». Tu jefe recibe el aviso.' },
      { titulo: 'Sigue el avance', texto: 'Abre el pedido y mira la línea de tiempo: dice en qué etapa va y quién lo tiene. Si te lo devuelven, corrígelo y reenvíalo con «Corregir y reenviar».', enlace: { a: '/mis-solicitudes', texto: 'Mis solicitudes' } },
      { titulo: 'Confirma lo que recibes', texto: 'Cuando Almacén te entregue, entra al pedido y pulsa «Confirmar recibido». Si algo llegó mal, usa «Reportar novedad».' },
      { titulo: 'Corregir o borrar', texto: 'Un borrador se puede editar o eliminar desde «Mis solicitudes». Un pedido ya enviado no se edita en silencio: pide la devolución con un motivo.' }
    ]
  },
  {
    clave: 'jefe', titulo: 'Si eres jefe de área', para: 'Para aprobar los pedidos de tu equipo.',
    pasos: [
      { titulo: 'Entra a «Por aprobar»', texto: 'Verás los pedidos que esperan tu decisión. El número rojo del menú te avisa cuántos hay.', enlace: { a: '/aprobacion-solicitudes', texto: 'Por aprobar' } },
      { titulo: 'Pulsa «Revisar»', texto: 'Se abre un panel con los artículos, sus fotos, la justificación y las características.' },
      { titulo: 'Decide', texto: 'Aprueba si todo está bien. Devuelve si hay que corregir algo (escribe qué). Rechaza si no procede (escribe por qué). El solicitante ve tu motivo.' },
      { titulo: 'Después', texto: 'Lo aprobado pasa a Compras en la fecha programada. Abajo ves las decisiones recientes.' }
    ]
  },
  {
    clave: 'compras', titulo: 'Si trabajas en Compras', para: 'Para cotizar, comprar y dar seguimiento.',
    pasos: [
      { titulo: 'Abre «Gestión de compras»', texto: 'Aquí están los pedidos ya aprobados. Usa los filtros y el orden para encontrarlos.', enlace: { a: '/gestion', texto: 'Gestión de compras' } },
      { titulo: 'Toma el artículo', texto: 'Pulsa el nombre del artículo y luego «Tomar para cotizar». En pedidos de mantenimiento usa «Abrir la hoja de mantenimiento».' },
      { titulo: 'Registra las cotizaciones', texto: 'Agrega el precio de cada proveedor. Si el proveedor no está en la lista, pulsa «Agregar proveedor nuevo». Sube los soportes.' },
      { titulo: 'Elige el proveedor', texto: 'Selecciona la cotización ganadora. Si supera el límite por artículo, se envía sola a gerencia; si no, puedes comprar.' },
      { titulo: 'Registra la compra', texto: 'Pon la fecha, los importes, la referencia y la llegada estimada. Para montos pequeños existe la compra directa.' },
      { titulo: 'Seguimiento', texto: 'Marca «en tránsito» cuando salga. Almacén registra la llegada. Cuando todo se entregue, cierra el artículo.' },
      { titulo: 'Proveedores', texto: 'Con el botón «Proveedores» puedes agregar, editar, desactivar o eliminar proveedores.' }
    ]
  },
  {
    clave: 'aprobador', titulo: 'Si apruebas compras (gerencia)', para: 'Para decidir las compras que superan el límite.',
    pasos: [
      { titulo: 'Entra a «Aprobaciones»', texto: 'Verás las cotizaciones o gastos que esperan tu decisión.', enlace: { a: '/aprobaciones', texto: 'Aprobaciones' } },
      { titulo: 'Revisa', texto: 'Mira el proveedor, los importes y los soportes adjuntos.' },
      { titulo: 'Decide', texto: 'Aprueba o rechaza. Si rechazas, escribe el motivo: Compras lo verá. No puedes aprobar tus propias solicitudes.' }
    ]
  },
  {
    clave: 'almacen', titulo: 'Si trabajas en Almacén', para: 'Para registrar lo que llega y lo que se entrega.',
    pasos: [
      { titulo: 'Entra a «Almacén»', texto: 'Hay cuatro vistas: por llegar, disponibles, pendientes de entrega y con entregas.', enlace: { a: '/almacen', texto: 'Almacén' } },
      { titulo: 'Abre el artículo', texto: 'Pulsa su nombre. Verás cuánto se compró, cuánto llegó («recibido X de Y») y cuánto hay disponible.' },
      { titulo: 'Registra la recepción', texto: 'Con «Registrar movimiento» elige «Recepción del proveedor», la cantidad y la fecha.' },
      { titulo: 'Entrega', texto: 'Registra la entrega al solicitante. No se puede entregar más de lo disponible. Quien pidió confirma que lo recibió.' },
      { titulo: 'Si algo está mal', texto: 'Registra una novedad (entrega incorrecta, datos incompletos…).' }
    ]
  },
  {
    clave: 'admin', titulo: 'Si administras el sistema', para: 'Para mantener personas, estructura y catálogos.',
    pasos: [
      { titulo: 'Usuarios y permisos', texto: 'Activa las cuentas nuevas y asigna roles.', enlace: { a: '/admin', texto: 'Administración' } },
      { titulo: 'Estructura', texto: 'Define las áreas, quién es el jefe de cada una y qué centros de costo puede usar.' },
      { titulo: 'Catálogos', texto: 'Mantén áreas, centros de costo, unidades y proveedores (con «Editar o eliminar proveedores»).' },
      { titulo: 'Calendario', texto: 'Configura las fechas de recepción de Compras y los festivos.' },
      { titulo: 'Auditoría y recuperación', texto: 'Consulta quién hizo qué y ayuda a recuperar accesos.' }
    ]
  }
];

/** Ayuda corta de cada pantalla principal. */
export const PANTALLAS: Record<string, { titulo: string; pasos: string[] }> = {
  'mis-solicitudes': { titulo: 'Mis solicitudes: qué hacer aquí', pasos: [
    'Pulsa «Empezar mi solicitud» para crear un pedido nuevo.',
    'Usa las pestañas para ver tus borradores, los devueltos y los que ya están en Compras.',
    'En cada fila: «Ver» abre el seguimiento, «Editar» corrige un borrador o un pedido devuelto y «Eliminar» borra un borrador.',
    'El estado «Cerrada» significa que el pedido ya terminó.'
  ] },
  'por-aprobar': { titulo: 'Por aprobar: qué hacer aquí', pasos: [
    'Pulsa «Revisar» en un pedido para ver sus artículos y fotos.',
    'Elige «Aprobar», «Devolver» (con motivo) o «Rechazar» (con motivo).',
    'Lo aprobado pasa a Compras en la fecha programada.'
  ] },
  'gestion': { titulo: 'Gestión de compras: qué hacer aquí', pasos: [
    'Filtra o busca el artículo y pulsa su nombre para abrir la ficha.',
    'Toma el artículo para cotizar, registra las cotizaciones y elige el proveedor.',
    'Registra la compra y haz seguimiento hasta que llegue.',
    '¿El proveedor no está? Usa el botón «Proveedores» o «Agregar proveedor nuevo» al cotizar.'
  ] },
  'almacen': { titulo: 'Almacén: qué hacer aquí', pasos: [
    'Elige una vista: por llegar, disponibles, pendientes de entrega o con entregas.',
    'Pulsa el artículo para registrar la recepción o la entrega.',
    'No se puede entregar más de lo disponible.'
  ] },
  'aprobaciones': { titulo: 'Aprobaciones: qué hacer aquí', pasos: [
    'Abre cada cotización y revisa proveedor, importes y soportes.',
    'Aprueba o rechaza; si rechazas, escribe el motivo.',
    'Compras ve tu decisión y continúa con la compra.'
  ] }
};
