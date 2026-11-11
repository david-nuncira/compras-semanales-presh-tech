// Cálculos del tablero (lógica pura, probada en pruebas-logica/tablero.test.ts).
// Todo sale de filas reales de v_articulos y de cotizaciones seleccionadas: no hay cifras fijas.
//
// Definiciones (las mismas que explican los íconos «i» en pantalla):
//  - Estimado: valor de la cotización SELECCIONADA de artículos aún sin comprar
//    (en cotización o cotizados).
//  - Comprometido: valor comprado que todavía no se ha recibido.
//  - Ejecutado: valor comprado que ya se recibió (proporcional a lo recibido neto).
// Cada moneda se totaliza por separado; los importes ausentes cuentan como «sin información», no como cero.
import type { Etapa } from '../tipos.ts';

export interface ArticuloTablero {
  id: string;
  etapa: Etapa;
  total: number | null;
  moneda: string | null;
  cantidad_comprada: number | null;
  recibido_neto: number | null;
  dias_atraso: number | null;
  novedades_abiertas: number;
  es_extraordinaria: boolean;
  area_id: string | null;
  area_nombre: string | null;
  centro_costo_id: string | null;
  centro_costo_codigo: string | null;
}

export interface EstimadoArticulo { articuloId: string; moneda: string; total: number }

export interface Montos { estimado: number; comprometido: number; ejecutado: number }

const PENDIENTES_GESTION: Etapa[] = ['solicitado', 'en_cotizacion', 'cotizado'];
const POR_LLEGAR: Etapa[] = ['comprado', 'en_transito', 'recibido_parcial'];
const SIN_COMPRA: Etapa[] = ['en_cotizacion', 'cotizado'];
const COMPRADAS: Etapa[] = ['comprado', 'en_transito', 'recibido_parcial', 'recibido_total', 'cerrado'];

/** Reparte el valor de una compra entre comprometido (falta recibir) y ejecutado (ya recibido). */
export function montosDeCompra(a: Pick<ArticuloTablero, 'etapa' | 'total' | 'cantidad_comprada' | 'recibido_neto'>):
  { comprometido: number; ejecutado: number } | null {
  if (!COMPRADAS.includes(a.etapa)) return null;
  if (a.total === null || a.total === undefined || !Number.isFinite(Number(a.total))) return null;
  const total = Number(a.total);
  const comprada = a.cantidad_comprada ?? 0;
  const fraccion = comprada > 0 ? Math.min(1, Math.max(0, (a.recibido_neto ?? 0) / comprada)) : 0;
  if (a.etapa === 'recibido_total') return { comprometido: 0, ejecutado: total };
  if (a.etapa === 'cerrado') return { comprometido: 0, ejecutado: Math.round(total * fraccion) };
  if (a.etapa === 'recibido_parcial') {
    const ejecutado = Math.round(total * fraccion);
    return { comprometido: total - ejecutado, ejecutado };
  }
  return { comprometido: total, ejecutado: 0 };
}

export interface GrupoCosto { clave: string; etiqueta: string; estimado: number; comprometido: number; ejecutado: number }

export interface ResumenTablero {
  porMoneda: Record<string, Montos>;
  /** Compras sin importe registrado: se informan aparte, no se suman como cero. */
  sinImporte: number;
  /** Artículos aún sin comprar y sin cotización seleccionada: no aportan al estimado. */
  sinEstimado: number;
  flujo: {
    total: number; pendientes: number; atrasados: number; porLlegar: number; conNovedades: number;
    extraordinarias: number; porEtapa: Partial<Record<Etapa, number>>;
  };
  /** Por área o centro de costo, solo en la moneda indicada. */
  grupos: GrupoCosto[];
}

export function resumirTablero(
  articulos: ArticuloTablero[],
  estimados: EstimadoArticulo[],
  agrupar: 'area' | 'centro_costo' = 'area',
  monedaGrupos = 'COP'
): ResumenTablero {
  const porMoneda: Record<string, Montos> = {};
  const montos = (m: string) => (porMoneda[m] ??= { estimado: 0, comprometido: 0, ejecutado: 0 });
  const grupos = new Map<string, GrupoCosto>();
  const grupoDe = (a: ArticuloTablero) => {
    const clave = (agrupar === 'area' ? a.area_id : a.centro_costo_id) ?? 'sin';
    const etiqueta = (agrupar === 'area' ? a.area_nombre : a.centro_costo_codigo) ?? (agrupar === 'area' ? 'Sin área' : 'Sin centro de costo');
    let g = grupos.get(clave);
    if (!g) { g = { clave, etiqueta, estimado: 0, comprometido: 0, ejecutado: 0 }; grupos.set(clave, g); }
    return g;
  };
  const estimadoPor = new Map(estimados.map((e) => [e.articuloId, e]));

  const flujo: ResumenTablero['flujo'] = { total: 0, pendientes: 0, atrasados: 0, porLlegar: 0, conNovedades: 0, extraordinarias: 0, porEtapa: {} };
  let sinImporte = 0; let sinEstimado = 0;

  for (const a of articulos) {
    if (a.etapa === 'cancelado' || a.etapa === 'borrador') continue;
    flujo.total += 1;
    flujo.porEtapa[a.etapa] = (flujo.porEtapa[a.etapa] ?? 0) + 1;
    if (PENDIENTES_GESTION.includes(a.etapa)) flujo.pendientes += 1;
    if (POR_LLEGAR.includes(a.etapa)) flujo.porLlegar += 1;
    if ((a.dias_atraso ?? 0) > 0) flujo.atrasados += 1;
    if (a.novedades_abiertas > 0) flujo.conNovedades += 1;
    if (a.es_extraordinaria) flujo.extraordinarias += 1;

    if (SIN_COMPRA.includes(a.etapa)) {
      const e = estimadoPor.get(a.id);
      if (!e) { sinEstimado += 1; continue; }
      montos(e.moneda).estimado += e.total;
      if (e.moneda === monedaGrupos) grupoDe(a).estimado += e.total;
      continue;
    }
    const m = montosDeCompra(a);
    if (COMPRADAS.includes(a.etapa) && m === null) { sinImporte += 1; continue; }
    if (!m) continue;
    const moneda = a.moneda ?? monedaGrupos;
    montos(moneda).comprometido += m.comprometido;
    montos(moneda).ejecutado += m.ejecutado;
    if (moneda === monedaGrupos) { const g = grupoDe(a); g.comprometido += m.comprometido; g.ejecutado += m.ejecutado; }
  }

  return {
    porMoneda, sinImporte, sinEstimado, flujo,
    grupos: [...grupos.values()].sort((x, y) =>
      (y.comprometido + y.ejecutado + y.estimado) - (x.comprometido + x.ejecutado + x.estimado) || x.etiqueta.localeCompare(y.etiqueta))
  };
}
