// Validaciones de formularios (puras; también se validan en el servidor).
import { parseNumero } from './moneda.ts';

export interface ArticuloForm {
  nombre: string; descripcion: string; cantidad: string; unidad: string;
  prioridad: string; fecha_requerida: string; justificacion: string;
  enlace_referencia: string; proveedor_sugerido: string;
}

export type ErroresArticulo = Partial<Record<keyof ArticuloForm, string>>;

export function enlaceValido(texto: string): boolean {
  const t = texto.trim();
  if (t === '') return true;              // opcional
  if (t.length > 1000) return false;
  return /^https?:\/\/[^\s]+$/i.test(t);
}

/** Errores por campo, para mostrarlos junto a cada campo. */
export function validarArticulo(f: ArticuloForm, unidadesActivas: string[], hoyISO: string): ErroresArticulo {
  const e: ErroresArticulo = {};
  if (f.nombre.trim().length < 2) e.nombre = 'Escribe el nombre del artículo.';
  if (f.descripcion.trim().length < 3) {
    e.descripcion = 'Describe medidas, material, color u otras características.';
  } else if (/^https?:\/\/\S+$/i.test(f.descripcion.trim())) {
    e.descripcion = 'Un enlace no reemplaza las especificaciones: describe el artículo y pon el enlace en su campo.';
  }
  const cantidad = parseNumero(f.cantidad);
  if (cantidad === null || cantidad <= 0) e.cantidad = 'Escribe una cantidad mayor que cero (ej. 3 o 2,5).';
  if (!unidadesActivas.some((u) => u.toLowerCase() === f.unidad.trim().toLowerCase())) {
    e.unidad = 'Elige la unidad de medida de la lista.';
  }
  if (f.fecha_requerida && f.fecha_requerida < hoyISO) e.fecha_requerida = 'La fecha requerida no puede estar en el pasado.';
  if (!enlaceValido(f.enlace_referencia)) e.enlace_referencia = 'El enlace debe empezar por http:// o https:// y no tener espacios.';
  if (f.proveedor_sugerido.trim().length > 200) e.proveedor_sugerido = 'Máximo 200 caracteres.';
  return e;
}

/** Centro de costo inicial: si el área tiene uno solo, se fija automáticamente. */
export function centroInicial(permitidos: string[]): { valor: string; bloqueado: boolean } {
  if (permitidos.length === 1) return { valor: permitidos[0], bloqueado: true };
  return { valor: '', bloqueado: false };
}

/** Puede el solicitante editar directamente su solicitud. */
export function solicitanteEdita(estado: string): boolean {
  return estado === 'borrador' || estado === 'en_correccion';
}

/** Puede pedir devolución (ya envió, aún no hay compras). */
export function puedePedirDevolucion(estado: string, hayComprados: boolean): boolean {
  return ['pendiente_aprobacion', 'programada', 'recibida_compras', 'enviada'].includes(estado) && !hayComprados;
}
