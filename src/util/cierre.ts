// Un pedido está CERRADO cuando ya llegó a Compras y todos sus artículos (menos los cancelados)
// están cerrados. El servidor mantiene el estado «recibida por Compras» hasta ese momento y no
// tiene un estado propio de cierre, así que se deriva de los conteos de v_solicitudes.
import type { EstadoSolicitud } from '../tipos.ts';

export interface ConteosCierre {
  estado: EstadoSolicitud | string;
  total_articulos: number;
  articulos_cerrados: number;
  articulos_cancelados: number;
}

export function pedidoCerrado(s: ConteosCierre): boolean {
  if (s.estado !== 'recibida_compras' && s.estado !== 'enviada') return false;
  const vivos = Number(s.total_articulos) - Number(s.articulos_cancelados);
  return vivos > 0 && Number(s.articulos_cerrados) >= vivos;
}
