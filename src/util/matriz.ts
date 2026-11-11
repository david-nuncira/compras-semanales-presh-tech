// Lógica pura de la matriz de cotizaciones (probada en pruebas-logica/matriz.test.ts).
// Trabaja SOLO con cotizaciones que ya existen: no inventa precios ni proveedores.
//
// Reglas:
//  - Mínimo = el menor de los precios cotizados. Una celda vacía NO es 0: no cuenta.
//  - Total de la fila = mínimo × cantidad, en pesos enteros.
//  - «Seleccionada» (verde en pantalla) es la cotización marcada por Compras
//    (es_seleccionada), no necesariamente la más barata.
//  - La referencia de un artículo NO es única: nada aquí se agrupa por referencia.
//  - Solo se comparan precios de la misma moneda (por defecto COP).

export interface ArticuloMatriz { id: string; cantidad: number }

export interface CotizacionMatriz {
  articulo_id: string; proveedor_id: string; moneda: string; precio_unitario: number;
  es_seleccionada: boolean; creado_en: string;
}

export interface CeldaMatriz {
  proveedorId: string;
  precio: number;
  /** Es la cotización seleccionada por Compras (no implica que sea la más barata). */
  seleccionada: boolean;
  /** Empata o es el menor precio de la fila. */
  esMinimo: boolean;
}

export interface FilaMatriz {
  articuloId: string;
  cantidad: number;
  celdas: Record<string, CeldaMatriz>;
  /** Menor precio cotizado; nulo si el artículo no tiene cotizaciones. */
  minimo: number | null;
  /** Mínimo × cantidad en pesos enteros; nulo si no hay mínimo. */
  total: number | null;
  seleccionadaProveedorId: string | null;
  /** Cotizaciones de otra moneda que no se comparan. */
  fueraDeMoneda: number;
}

export interface ResultadoMatriz {
  proveedoresIds: string[];
  filas: FilaMatriz[];
  /** Suma de los totales de fila (mínimo × cantidad). */
  totalGeneral: number;
  articulosSinCotizacion: number;
  /** Suma de precio seleccionado × cantidad, solo de las filas con selección. */
  totalSeleccionado: number;
  articulosSeleccionados: number;
}

/** El menor valor presente. `null`/`undefined`/NaN son celdas vacías: no cuentan (no son 0). */
export function minimoPrecios(valores: Array<number | null | undefined>): number | null {
  let min: number | null = null;
  for (const v of valores) {
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    if (min === null || v < min) min = v;
  }
  return min;
}

/** Total de una fila en pesos enteros. Sin mínimo no hay total (no se inventa 0). */
export function totalFila(minimo: number | null, cantidad: number): number | null {
  if (minimo === null || !Number.isFinite(cantidad)) return null;
  return Math.round(minimo * cantidad);
}

export function construirMatriz(
  articulos: ArticuloMatriz[],
  cotizaciones: CotizacionMatriz[],
  ordenProveedores: string[] = [],
  moneda = 'COP'
): ResultadoMatriz {
  // Una cotización vigente por (artículo, proveedor): la seleccionada, o la más reciente.
  const vigentes = new Map<string, CotizacionMatriz>();
  const fuera = new Map<string, number>();
  for (const c of cotizaciones) {
    if (c.moneda !== moneda) { fuera.set(c.articulo_id, (fuera.get(c.articulo_id) ?? 0) + 1); continue; }
    if (!Number.isFinite(c.precio_unitario) || c.precio_unitario < 0) continue;
    const k = `${c.articulo_id}|${c.proveedor_id}`;
    const previa = vigentes.get(k);
    const mejor = !previa
      || (c.es_seleccionada && !previa.es_seleccionada)
      || (c.es_seleccionada === previa.es_seleccionada && c.creado_en > previa.creado_en);
    if (mejor) vigentes.set(k, c);
  }

  const usados = new Set<string>();
  for (const c of vigentes.values()) usados.add(c.proveedor_id);
  const proveedoresIds = [
    ...ordenProveedores.filter((p) => usados.has(p)),
    ...[...usados].filter((p) => !ordenProveedores.includes(p)).sort()
  ];

  let totalGeneral = 0; let totalSeleccionado = 0; let articulosSeleccionados = 0; let sinCotizacion = 0;
  const filas: FilaMatriz[] = articulos.map((a) => {
    const celdas: Record<string, CeldaMatriz> = {};
    for (const p of proveedoresIds) {
      const c = vigentes.get(`${a.id}|${p}`);
      if (c) celdas[p] = { proveedorId: p, precio: c.precio_unitario, seleccionada: c.es_seleccionada, esMinimo: false };
    }
    const minimo = minimoPrecios(Object.values(celdas).map((c) => c.precio));
    for (const c of Object.values(celdas)) c.esMinimo = minimo !== null && c.precio === minimo;
    const sel = Object.values(celdas).find((c) => c.seleccionada) ?? null;
    const total = totalFila(minimo, a.cantidad);
    if (total === null) sinCotizacion += 1; else totalGeneral += total;
    if (sel) { articulosSeleccionados += 1; totalSeleccionado += totalFila(sel.precio, a.cantidad) ?? 0; }
    return {
      articuloId: a.id, cantidad: a.cantidad, celdas, minimo, total,
      seleccionadaProveedorId: sel?.proveedorId ?? null, fueraDeMoneda: fuera.get(a.id) ?? 0
    };
  });

  return { proveedoresIds, filas, totalGeneral, articulosSinCotizacion: sinCotizacion, totalSeleccionado, articulosSeleccionados };
}
