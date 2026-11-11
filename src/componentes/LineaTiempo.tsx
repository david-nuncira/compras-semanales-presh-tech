import type { EtapaLinea, EstadoEtapa } from '../util/lineaTiempo.ts';
import { textoDuracion } from '../util/lineaTiempo.ts';
import { fmtFecha, fmtFechaHora } from '../util/fechas.ts';
import { Icono } from './UI.tsx';
import type { NombreIcono } from './UI.tsx';

const VISTA: Record<EstadoEtapa, { icono: NombreIcono; texto: string }> = {
  completada: { icono: 'check-circulo', texto: 'Completada' },
  actual: { icono: 'reloj', texto: 'En curso' },
  pendiente: { icono: 'calendario', texto: 'Pendiente' },
  devuelta: { icono: 'devolver', texto: 'Devuelta' },
  atrasada: { icono: 'alerta', texto: 'Atrasada' },
  rechazada: { icono: 'x-circulo', texto: 'Rechazada' },
  cancelada: { icono: 'prohibido', texto: 'Cancelada' },
  omitida: { icono: 'flecha', texto: 'No aplica' }
};

/**
 * Línea de tiempo vertical. Cada etapa muestra estado (color + ícono + texto),
 * fecha y hora en Bogotá, responsable, duración y comentario. Las etapas
 * futuras aparecen como pendientes; rechazada y cancelada nunca usan el verde.
 */
export function LineaTiempo({ etapas }: { etapas: EtapaLinea[] }) {
  return (
    <ol className="tiempo" aria-label="Línea de tiempo de la solicitud">
      {etapas.map((e) => {
        const v = VISTA[e.estado];
        return (
          <li key={e.clave} className={`tiempo-etapa tiempo-${e.estado}`} aria-current={e.estado === 'actual' || e.estado === 'atrasada' ? 'step' : undefined}>
            <span className="tiempo-marca" aria-hidden="true"><Icono nombre={v.icono} tam={16} /></span>
            <div className="tiempo-cuerpo">
              <div className="tiempo-titulo">
                <b>{e.titulo}</b>
                <span className={`tiempo-estado tiempo-estado-${e.estado}`}><Icono nombre={v.icono} tam={13} /> {v.texto}</span>
              </div>
              <div className="texto-suave">
                {e.fecha ? fmtFechaHora(e.fecha) : e.fechaPrevista ? `Prevista: ${fmtFecha(e.fechaPrevista)}` : e.estado === 'pendiente' ? 'Aún no ocurre' : 'Sin fecha registrada'}
                {e.responsable ? ` · ${e.responsable}` : ''}
                {e.duracionHoras !== null
                  ? ` · ${e.estado === 'actual' || e.estado === 'atrasada' ? 'lleva' : 'tardó'} ${textoDuracion(e.duracionHoras)}` : ''}
              </div>
              {e.comentario ? <div className="tiempo-comentario">{e.comentario}</div> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
