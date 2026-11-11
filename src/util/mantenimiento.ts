// Pedidos de MANTENIMIENTO: siguen el formato de la hoja «Formato solicitud de compra»
// (artículo con destino, justificación y comparación de proveedores). Los pedidos de
// compras semanales siguen el flujo normal.
//
// Hoy el servidor no marca qué centro de costo es de mantenimiento (ver REQUIERE_BACKEND.md),
// así que se reconoce por el nombre o el código del centro de costo configurado en la base.

const sinTildes = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** ¿Este texto (nombre o código de un centro de costo) corresponde a mantenimiento? */
export function esTextoMantenimiento(texto: string | null | undefined): boolean {
  return !!texto && sinTildes(texto).includes('mantenimiento');
}

export function esCentroMantenimiento(c: { codigo?: string | null; nombre?: string | null } | null | undefined): boolean {
  return !!c && (esTextoMantenimiento(c.nombre) || esTextoMantenimiento(c.codigo));
}

/** Pasos de la hoja de mantenimiento, en el orden en que se hacen (los responsables salen de roles, no de nombres). */
export const PASOS_MANTENIMIENTO = [
  { clave: 'llenado', titulo: 'Solicitud llenada', quien: 'Solicitante', detalle: 'Cantidad, artículo, destino, imagen, justificación y descripción.' },
  { clave: 'envio', titulo: 'Envío a proveedores', quien: 'Compras', detalle: 'Se pide cotización a cada proveedor.' },
  { clave: 'cotizacion', titulo: 'Cotizaciones', quien: 'Compras', detalle: 'Se captura el precio de cada proveedor.' },
  { clave: 'seleccion', titulo: 'Selección y aprobación', quien: 'Aprobador', detalle: 'Se elige el proveedor de cada artículo y se aprueba.' },
  { clave: 'totaliza', titulo: 'Totaliza la compra', quien: 'Compras y gerencia', detalle: 'Se suma lo elegido; si supera el límite, aprueba gerencia.' },
  { clave: 'orden', titulo: 'Orden de compra', quien: 'Compras', detalle: 'Se genera con lo aprobado (en verde).' }
] as const;

export type EstadoPaso = 'hecho' | 'actual' | 'pendiente';

export interface EntradaPasos {
  total: number;
  /** Artículos que ya salieron de «solicitado» (ya se enviaron a cotizar o más adelante). */
  enCotizacionOMas: number;
  conCotizacion: number;
  seleccionados: number;
  /** Seleccionados que ya no esperan aprobación (no la requieren, o está aprobada). */
  aprobados: number;
  /** Artículos con la compra ya registrada. */
  comprados: number;
}

/** Estado de cada paso, en orden: lo anterior completo = hecho; el primero incompleto = actual. */
export function estadoPasosMantenimiento(e: EntradaPasos): EstadoPaso[] {
  const t = e.total;
  const completo = t > 0 ? [
    true,
    e.enCotizacionOMas >= t,
    e.conCotizacion >= t,
    e.seleccionados >= t && e.aprobados >= t,
    e.seleccionados >= t && e.aprobados >= t,
    e.comprados >= t
  ] : [false, false, false, false, false, false];
  const primero = completo.findIndex((c) => !c);
  return completo.map((c, i) => (c ? 'hecho' : i === primero ? 'actual' : 'pendiente'));
}
