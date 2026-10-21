// Tipos espejo del esquema (solo lo que usa la interfaz).

export type Rol = 'administrador' | 'solicitante' | 'compras' | 'aprobador' | 'almacen';
export type EstadoPerfil = 'pendiente' | 'activo' | 'desactivado' | 'rechazado';
export type EstadoSolicitud = 'borrador' | 'enviada' | 'en_correccion' | 'cancelada';
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
}

export interface Area { id: string; nombre: string; activo: boolean; version: number; }
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
  recepcion: 'Recepción del proveedor',
  entrega: 'Entrega al solicitante',
  devolucion_proveedor: 'Devolución al proveedor',
  retorno_solicitante: 'Retorno del solicitante'
};

export const ETIQUETA_NOVEDAD: Record<TipoNovedad, string> = {
  datos_incompletos: 'Datos incompletos',
  producto_mal_solicitado: 'Producto mal solicitado',
  entrega_incorrecta: 'Entrega incorrecta',
  observacion: 'Observación general'
};

export const ETIQUETA_ESTADO_SOLICITUD: Record<EstadoSolicitud, string> = {
  borrador: 'Borrador',
  enviada: 'Enviada',
  en_correccion: 'En corrección',
  cancelada: 'Cancelada'
};

export const ETIQUETA_ROL: Record<Rol, string> = {
  administrador: 'Administrador',
  solicitante: 'Solicitante',
  compras: 'Compras',
  aprobador: 'Aprobador',
  almacen: 'Almacén'
};
