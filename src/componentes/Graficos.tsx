// Gráficos en SVG puro (sin dependencias). Cada gráfico tiene título y descripción
// para lectores de pantalla (role="img") y una tabla equivalente. Los tipos de valor
// se distinguen por TRAMA además del color: sólido, rayado y punteado.
import { useId } from 'react';
import type { ReactNode } from 'react';

export type Trama = 'solido' | 'rayado' | 'punteado';

const RELLENO: Record<Trama, string> = {
  solido: 'url(#trama-solido)', rayado: 'url(#trama-rayado)', punteado: 'url(#trama-punteado)'
};

/** Definiciones de tramas; se incluye una vez por gráfico con ids únicos. */
function Tramas({ id }: { id: string }) {
  return (
    <defs>
      <pattern id={`${id}-solido`} width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" style={{ fill: 'var(--exito)' }} /></pattern>
      <pattern id={`${id}-rayado`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="8" height="8" style={{ fill: 'var(--aviso-claro)' }} /><rect width="4" height="8" style={{ fill: 'var(--aviso)' }} />
      </pattern>
      <pattern id={`${id}-punteado`} width="6" height="6" patternUnits="userSpaceOnUse">
        <rect width="6" height="6" style={{ fill: 'var(--info-claro)' }} /><circle cx="3" cy="3" r="1.3" style={{ fill: 'var(--info)' }} />
      </pattern>
    </defs>
  );
}
const rellenoDe = (id: string, t: Trama) => RELLENO[t].replace('#trama', `#${id}`);
const BORDE: Record<Trama, string> = { solido: 'var(--exito)', rayado: 'var(--aviso)', punteado: 'var(--info)' };

export interface BarraDato { etiqueta: string; valor: number; trama: Trama; texto: string }

/** Barras horizontales: una barra por dato, con su valor escrito al final. */
export function GraficoBarras({ titulo, descripcion, datos, vacio }: {
  titulo: string; descripcion: string; datos: BarraDato[]; vacio?: ReactNode;
}) {
  const id = useId().replace(/:/g, '');
  if (datos.length === 0 || datos.every((d) => d.valor === 0)) return <>{vacio ?? <p className="texto-suave">Sin datos para graficar.</p>}</>;
  const ancho = 640; const margenIzq = 170; const margenDer = 120; const alto = 34;
  const max = Math.max(...datos.map((d) => d.valor), 1);
  const util = ancho - margenIzq - margenDer;
  return (
    <figure className="grafico">
      <svg viewBox={`0 0 ${ancho} ${datos.length * alto + 8}`} role="img" aria-labelledby={`${id}-t ${id}-d`} preserveAspectRatio="xMinYMin meet">
        <title id={`${id}-t`}>{titulo}</title>
        <desc id={`${id}-d`}>{descripcion}</desc>
        <Tramas id={id} />
        {datos.map((d, i) => {
          const w = Math.max(d.valor > 0 ? 2 : 0, (d.valor / max) * util);
          const y = i * alto + 4;
          return (
            <g key={d.etiqueta}>
              <text x={margenIzq - 8} y={y + 18} textAnchor="end" className="grafico-etiqueta">{d.etiqueta.length > 24 ? `${d.etiqueta.slice(0, 23)}…` : d.etiqueta}</text>
              <rect x={margenIzq} y={y} width={w} height={24} rx={3} fill={rellenoDe(id, d.trama)} stroke={BORDE[d.trama]} strokeWidth={1.5} />
              <text x={margenIzq + w + 8} y={y + 17} className="grafico-valor">{d.texto}</text>
            </g>
          );
        })}
      </svg>
      <figcaption className="solo-lectores">{titulo}. {descripcion}</figcaption>
    </figure>
  );
}

export interface GrupoApilado { etiqueta: string; ejecutado: number; comprometido: number; textoEjecutado: string; textoComprometido: string }

/** Barras apiladas por grupo: ejecutado (sólido) + comprometido (rayado). */
export function GraficoApilado({ titulo, descripcion, grupos, vacio }: {
  titulo: string; descripcion: string; grupos: GrupoApilado[]; vacio?: ReactNode;
}) {
  const id = useId().replace(/:/g, '');
  if (grupos.length === 0 || grupos.every((g) => g.ejecutado + g.comprometido === 0)) return <>{vacio ?? <p className="texto-suave">Sin datos para graficar.</p>}</>;
  const ancho = 640; const margenIzq = 170; const margenDer = 24; const alto = 34;
  const max = Math.max(...grupos.map((g) => g.ejecutado + g.comprometido), 1);
  const util = ancho - margenIzq - margenDer;
  return (
    <figure className="grafico">
      <svg viewBox={`0 0 ${ancho} ${grupos.length * alto + 8}`} role="img" aria-labelledby={`${id}-t ${id}-d`} preserveAspectRatio="xMinYMin meet">
        <title id={`${id}-t`}>{titulo}</title>
        <desc id={`${id}-d`}>{descripcion}</desc>
        <Tramas id={id} />
        {grupos.map((g, i) => {
          const y = i * alto + 4;
          const wE = (g.ejecutado / max) * util; const wC = (g.comprometido / max) * util;
          return (
            <g key={g.etiqueta}>
              <text x={margenIzq - 8} y={y + 18} textAnchor="end" className="grafico-etiqueta">{g.etiqueta.length > 24 ? `${g.etiqueta.slice(0, 23)}…` : g.etiqueta}</text>
              {wE > 0 ? <rect x={margenIzq} y={y} width={wE} height={24} fill={rellenoDe(id, 'solido')} stroke={BORDE.solido} strokeWidth={1.5} /> : null}
              {wC > 0 ? <rect x={margenIzq + wE} y={y} width={wC} height={24} fill={rellenoDe(id, 'rayado')} stroke={BORDE.rayado} strokeWidth={1.5} /> : null}
            </g>
          );
        })}
      </svg>
      <figcaption className="solo-lectores">{titulo}. {descripcion}</figcaption>
    </figure>
  );
}

/** Leyenda con la misma trama que el gráfico (nunca solo color). */
export function Leyenda({ items }: { items: Array<{ trama: Trama; texto: string }> }) {
  const id = useId().replace(/:/g, '');
  return (
    <ul className="leyenda-grafico" aria-label="Leyenda">
      {items.map((it) => (
        <li key={it.texto}>
          <svg width="22" height="14" aria-hidden="true"><Tramas id={id} /><rect width="22" height="14" rx="2" fill={rellenoDe(id, it.trama)} stroke={BORDE[it.trama]} strokeWidth={1.5} /></svg>
          {it.texto}
        </li>
      ))}
    </ul>
  );
}
