// Tipos espejo del esquema (solo lo que usa la interfaz).

export type Rol =
  | 'administrador' | 'solicitante' | 'compras' | 'aprobador' | 'almacen'
  | 'consulta_global' | 'admin_usuarios' | 'admin_catalogos' | 'emergencias';
export type EstadoPerfil = 'pendiente' | 'activo' | 'desactivado' | 'rechazado';
// 'enviada' = flujo anterior (llegó a Compras sin aprobación previa del jefe).
export type EstadoSolicitud =
  | 'borrador' | 'pendiente_aprobacion' | 'programada' | 'recibida_compras'
  | 'enviada' | 'en_correccion' | 'rechazada' | 'cancelada';
export type Etapa =
  | 'borrador' | 'solicitado' | 'en_cotizacion' | 'cotizado' | 'comprado'
  | 'en_transito' | 'recibido_parcial' | 'recibido_total' | 'cerrado' | 'cancelado';
export type EstadoAprobacion = 'no_requiere' | 'sin_solicitar' | 'pendiente' | 'aprobada' | 'rechazada' | 'reemplazada';
export type TipoMovimiento = 'recepcion' | 'entrega' | 'devolucion_proveedor' | 'retorno_solicitante';
export type TipoNovedad = 'datos_incompletos' | 'producto_mal_solicitado' | 'entrega_incorrecta' | 'observacion';
export type EstadoNovedad = 'abierta' | 'en_atencion' | 'resuelta';
export type EntidadAdjunto = 'articulo' | 'novedad' | 'compra' | 'compra_externa';

export interface MiPerfil {
  id: string;
  nombre: string;
  correo: string | null;
  estado: EstadoPerfil;
  area_id: string | null;
  roles: Rol[];
  // v2 (opcionales: si el servidor aún no los envía, la app sigue funcionando)
  area_nombre?: string | null;
  es_jefe?: boolean;
  notificaciones_sin_leer?: number;
}

export interface Area {
  id: string; nombre: string; activo: boolean; version: number;
  jefe_id?: string | null; aprobador_superior_id?: string | null; descripcion?: string | null;
}
export interface AreaCentro { area_id: string; centro_costo_id: string; activo: boolean; }
export interface UnidadMedida { id: string; nombre: string; abreviatura: string | null; activo: boolean; version: number; }
export interface CategoriaSolicitud { id: string; nombre: string; descripcion: string | null; activo: boolean; version: number; }
export interface VentanaRecepcion {
  id: string; categoria_id: string; nombre: string; abre_en: string; cierra_en: string;
  fecha_recepcion: string; activo: boolean;
}
export interface CicloCalendario {
  semana_lunes: string; fecha_recepcion: string; liberacion: string; cierre: string;
  origen: 'extraordinaria' | 'sin_calendario' | 'ciclo_semanal' | 'ventana_categoria';
  nota: string | null; no_habiles: Array<{ fecha: string; descripcion: string }>;
}
export interface AprobacionSolicitud {
  aprobacion_id: string; solicitud_id: string; version: number; aprobador_id: string;
  ruta: 'jefe_area' | 'ruta_superior';
  estado: 'pendiente' | 'aprobada' | 'devuelta' | 'rechazada' | 'reemplazada' | 'anulada';
  es_vigente: boolean; motivo: string | null; solicitada_en: string; decidido_en: string | null;
  numero: string; solicitud_estado: EstadoSolicitud; solicitante_id: string; solicitante_nombre: string | null;
  area_id: string; area_nombre: string | null; centro_costo_codigo: string | null; centro_costo_nombre: string | null;
  justificacion: string | null; semana_lunes: string; es_extraordinaria: boolean; motivo_extraordinaria: string | null;
  categoria_id: string | null; creado_en: string; ultimo_envio_en: string | null;
}
export interface Devolucion {
  id: string; solicitud_id: string; iniciada_por: string; motivo: string; etapa: string;
  estado: 'pendiente' | 'autorizada' | 'negada' | 'aplicada_directa';
  resuelta_por: string | null; resuelta_en: string | null; respuesta: string | null; creado_en: string;
}
export interface Notificacion {
  id: number; tipo: string; titulo: string; cuerpo: string | null; enlace: string | null;
  solicitud_id: string | null; evento_en: string; creado_en: string; leida_en: string | null;
}
export interface EventoHistorial { evento_en: string; tipo: string; descripcion: string; actor: string; motivo: string | null; }
export interface CentroCosto { id: string; codigo: string; nombre: string; activo: boolean; version: number; }
export interface Proveedor {
  id: string; nombre: string; identificacion: string | null; contacto: string | null;
  telefono: string | null; correo: string | null; notas: string | null; activo: boolean; version: number;
}

export interface VSolicitud {
  id: string; numero: string; estado: EstadoSolicitud;
  solicitante_id: string; solicitante_nombre: string | null;
  area_id: string; area_nombre: string | null;
  centro_costo_id: string; centro_costo_codigo: string | null; centro_costo_nombre: string | null;
  justificacion: string | null; semana_lunes: string; fecha_declarada: string | null;
  origen: string; creado_en: string; enviado_en: string | null; version: number;
  total_articulos: number; articulos_cerrados: number; articulos_cancelados: number;
  resumen_etapas: Record<string, number> | null;
  // v2
  flujo: 'anterior' | 'aprobacion_previa';
  categoria_id: string | null; categoria_nombre: string | null;
  es_extraordinaria: boolean; motivo_extraordinaria: string | null;
  aprobador_jefe_id: string | null; aprobador_jefe_nombre: string | null;
  ultimo_envio_en: string | null; aprobado_en: string | null;
  fecha_programada_recepcion: string | null; liberacion_programada_en: string | null;
  cierre_ciclo_en: string | null; origen_programacion: string | null;
  recibida_compras_en: string | null; version_contenido: number;
  en_bandeja_compras: boolean;
  ultimo_motivo_jefe: string | null; ultimo_motivo_devolucion: string | null;
  devolucion_pendiente: boolean; fecha_requerida_min: string | null;
}

export interface VArticulo {
  id: string; solicitud_id: string; solicitud_numero: string; solicitud_estado: EstadoSolicitud;
  semana_lunes: string; solicitante_id: string; solicitante_nombre: string | null;
  area_id: string; area_nombre: string | null;
  centro_costo_id: string; centro_costo_codigo: string | null; centro_costo_nombre: string | null;
  nombre: string; descripcion: string | null; cantidad: number; unidad: string;
  prioridad: 'baja' | 'media' | 'alta'; fecha_requerida: string | null; justificacion: string | null;
  etapa: Etapa; requiere_aprobacion: boolean; aprobador_id: string | null; aprobador_nombre: string | null;
  origen: string; estatus_historico: string | null; cerrado_en: string | null; cerrado_motivo: string | null;
  creado_en: string; version: number;
  estado_aprobacion: EstadoAprobacion;
  compra_id: string | null; proveedor_id: string | null; proveedor_nombre: string | null;
  moneda: string | null; precio_unitario: number | null; cantidad_comprada: number | null;
  subtotal: number | null; impuestos: number | null; descuentos: number | null; otros_cargos: number | null;
  total: number | null; fecha_compra: string | null; referencia: string | null;
  fecha_estimada_llegada: string | null; llegada_completa_en: string | null; compra_version: number | null;
  recibido_bruto: number | null; devuelto_proveedor: number | null; recibido_neto: number | null;
  entregado_bruto: number | null; retornado: number | null; entregado_neto: number | null;
  disponible_almacen: number | null; pendiente_llegada: number | null;
  primera_llegada: string | null; ultima_llegada: string | null;
  dias_atraso: number | null; novedades_abiertas: number; adjuntos: number;
  // v2
  enlace_referencia: string | null; proveedor_sugerido: string | null;
  recibida_compras_en: string | null; fecha_programada_recepcion: string | null;
  flujo: 'anterior' | 'aprobacion_previa'; es_extraordinaria: boolean; en_bandeja_compras: boolean;
}

export interface Cotizacion {
  id: string; articulo_id: string; proveedor_id: string; moneda: string;
  precio_unitario: number; cantidad: number; impuestos: number; descuentos: number;
  otros_cargos: number; notas: string | null; es_seleccionada: boolean; version: number;
  creado_en: string;
}

export interface Aprobacion {
  id: string; articulo_id: string; aprobador_id: string; solicitada_por: string;
  estado: 'pendiente' | 'aprobada' | 'rechazada' | 'reemplazada'; es_vigente: boolean;
  version_aprobada: Record<string, unknown>; comentario: string | null;
  decidido_en: string | null; creado_en: string;
}

export interface Movimiento {
  id: string; articulo_id: string; tipo: TipoMovimiento; cantidad: number;
  fecha_efectiva: string; creado_en: string; responsable_id: string;
  contraparte: string | null; observacion: string | null; permite_reposicion: boolean;
  confirmado_por_solicitante: boolean | null; confirmado_en: string | null;
  anulado: boolean; anulado_motivo: string | null;
}

export interface Novedad {
  id: string; articulo_id: string; tipo: TipoNovedad; descripcion: string;
  estado: EstadoNovedad; resolucion: string | null; creado_por: string; creado_en: string;
  resuelto_en: string | null; version: number;
}

export interface Adjunto {
  cotizacion_id?: string | null;
  id: string; entidad: EntidadAdjunto; entidad_id: string; ruta: string;
  nombre_original: string; mime: string; tamano_bytes: number; subido_por: string; creado_en: string;
}

export interface CompraExterna {
  id: string; referencia: string; tipo: 'externa' | 'regularizacion';
  registrada_corporativo: 'si' | 'no' | 'por_confirmar';
  area_id: string; centro_costo_id: string; proveedor_id: string | null; proveedor_texto: string | null;
  articulo_texto: string; cantidad: number; unidad: string; moneda: string;
  importe_total: number | null; fecha_compra: string; observacion: string | null;
  solicitud_id: string | null; creado_en: string; version: number;
}

export interface VUsuarioAdmin {
  cargo?: string | null; jefe_id?: string | null;
  id: string; nombre: string; correo: string | null; estado: EstadoPerfil;
  area_id: string | null; area_nombre: string | null; creado_en: string; version: number; roles: Rol[];
}

export interface Saldos {
  comprado: number; recibido_bruto: number; devuelto_proveedor: number; recibido_neto: number;
  entregado_bruto: number; retornado: number; entregado_neto: number;
  disponible_almacen: number; pendiente_llegada: number;
}

// Etiquetas en español (texto SIEMPRE junto al color).
export const ETIQUETA_ETAPA: Record<Etapa, string> = {
  borrador: 'Borrador',
  solicitado: 'Solicitado',
  en_cotizacion: 'En cotización',
  cotizado: 'Cotizado',
  comprado: 'Comprado',
  en_transito: 'En tránsito',
  recibido_parcial: 'Recibido parcial',
  recibido_total: 'Recibido total',
  cerrado: 'Cerrado',
  cancelado: 'Cancelado'
};

export const ETIQUETA_APROBACION: Record<EstadoAprobacion, string> = {
  no_requiere: 'No requiere',
  sin_solicitar: 'Sin solicitar',
  pendiente: 'Pendiente',
  aprobada: 'Aprobada',
  rechazada: 'Rechazada',
  reemplazada: 'Reemplazada'
};

export const ETIQUETA_MOVIMIENTO: Record<TipoMovimiento, string> = {
  recepcion: 'Ingreso al almacén (recibido del proveedor)',
  entrega: 'Entrega al solicitante',
  devolucion_proveedor: 'Devolución al proveedor (sale del almacén)',
  retorno_solicitante: 'Retorno al almacén (lo devuelve el solicitante)'
};

export const ETIQUETA_NOVEDAD: Record<TipoNovedad, string> = {
  datos_incompletos: 'Datos incompletos',
  producto_mal_solicitado: 'Producto mal solicitado',
  entrega_incorrecta: 'Entrega incorrecta',
  observacion: 'Observación general'
};

export const ETIQUETA_ESTADO_SOLICITUD: Record<EstadoSolicitud, string> = {
  borrador: 'Borrador',
  pendiente_aprobacion: 'Pendiente de aprobación del jefe',
  programada: 'Aprobada y programada para Compras',
  recibida_compras: 'Recibida por Compras',
  enviada: 'Recibida por Compras (flujo anterior, sin aprobación previa)',
  en_correccion: 'Devuelta para corrección',
  rechazada: 'Rechazada',
  cancelada: 'Cancelada'
};

// Orden del recorrido principal (para la línea de avance).
export const RECORRIDO: Array<{ clave: string; titulo: string }> = [
  { clave: 'borrador', titulo: 'Borrador' },
  { clave: 'pendiente_aprobacion', titulo: 'Aprobación del jefe' },
  { clave: 'programada', titulo: 'Programada' },
  { clave: 'recibida_compras', titulo: 'Recibida por Compras' },
  { clave: 'gestion', titulo: 'Cotización y compra' },
  { clave: 'entrega', titulo: 'Recepción y entrega' },
  { clave: 'cierre', titulo: 'Cierre' }
];

export const ETIQUETA_ROL: Record<Rol, string> = {
  administrador: 'Administrador general',
  solicitante: 'Solicitante',
  compras: 'Compras (gestionar compras)',
  aprobador: 'Aprobador de cotización/gasto',
  almacen: 'Almacén',
  consulta_global: 'Consulta global (solo lectura)',
  admin_usuarios: 'Administrar usuarios (sin permisos privilegiados)',
  admin_catalogos: 'Administrar catálogos, estructura y calendario',
  emergencias: 'Solicitudes extraordinarias'
};

export const DESCRIPCION_ROL: Record<Rol, string> = {
  administrador: 'Todo, incluida la asignación de permisos privilegiados. No puede borrar el historial.',
  solicitante: 'Crea solicitudes para su área, adjunta soportes, pide devoluciones y confirma entregas.',
  compras: 'Gestiona solo las solicitudes aprobadas y liberadas: cotizaciones, compra, seguimiento y novedades.',
  aprobador: 'Decide aprobaciones POSTERIORES de cotización o gasto que Compras le asigne (no es el jefe de área).',
  almacen: 'Registra ingresos, entregas, devoluciones y retornos.',
  consulta_global: 'Ve toda la operación enviada (incluye pendientes de aprobación, claramente marcadas) sin modificar nada.',
  admin_usuarios: 'Activa cuentas y asigna permisos básicos. No toca cuentas ni permisos de administración, consulta global o emergencias.',
  admin_catalogos: 'Áreas, jefes, solicitantes por área, centros de costo, unidades, categorías y calendario.',
  emergencias: 'Puede marcar una solicitud como extraordinaria (salta el calendario, no la aprobación del jefe).'
};

// Permisos que solo asigna el administrador general.
export const ROLES_PRIVILEGIADOS: Rol[] = ['administrador', 'admin_usuarios', 'admin_catalogos', 'consulta_global', 'emergencias'];
