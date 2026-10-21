// Formato e interpretación de importes. Los cálculos de verdad viven en el
// servidor (numeric); aquí solo presentación y validación de entradas.

/** $ 1.234.567,89 (es-CO). Monedas distintas se muestran con su código. */
export function fmtMoneda(valor: number | string | null | undefined, moneda: string = 'COP'): string {
  if (valor === null || valor === undefined || valor === '') return 'sin información';
  const n = typeof valor === 'string' ? Number(valor) : valor;
  if (!Number.isFinite(n)) return 'sin información';
  try {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency', currency: moneda, minimumFractionDigits: 0, maximumFractionDigits: 2
    }).format(n);
  } catch {
    // Código de moneda no reconocido por Intl: se muestra plano.
    return `${moneda} ${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(n)}`;
  }
}

export function fmtCantidad(valor: number | string | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return '—';
  const n = typeof valor === 'string' ? Number(valor) : valor;
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(n);
}

/**
 * Interpreta lo que escribe el usuario en un campo de importe o cantidad.
 * Acepta "1.234.567,89", "1234567.89", "50000", "1,5".
 * Devuelve null si no es interpretable (el formulario muestra error, no adivina).
 */
export function parseNumero(texto: string): number | null {
  const t = texto.trim().replace(/\s/g, '');
  if (t === '') return null;
  if (!/^[0-9.,]+$/.test(t)) return null;
  const ultimaComa = t.lastIndexOf(',');
  const ultimoPunto = t.lastIndexOf('.');
  let normal: string;
  if (ultimaComa === -1 && ultimoPunto === -1) {
    normal = t;
  } else if (ultimaComa > ultimoPunto) {
    // Coma decimal (es-CO): puntos = miles.
    normal = t.replace(/\./g, '').replace(',', '.');
  } else {
    // Punto decimal: comas = miles.
    normal = t.replace(/,/g, '');
  }
  if (!/^\d+(\.\d+)?$/.test(normal)) return null;
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

/** Redondeo a 2 decimales para previsualizar totales (el servidor es la fuente de verdad). */
export function redondear2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
