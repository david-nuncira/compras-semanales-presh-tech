import { useEffect, useState } from 'react';
import { proximosCiclos } from '../datos.ts';
import type { CicloCalendario } from '../tipos.ts';
import { fmtFecha, fmtFechaHora, sumarDias, semanaISO } from '../util/fechas.ts';
import { Cargando, MensajeError } from './UI.tsx';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function tramo(lunes: string): string {
  const [, m1, d1] = lunes.split('-').map(Number);
  const dom = sumarDias(lunes, 6);
  const [, m2, d2] = dom.split('-').map(Number);
  return m1 === m2 ? `${d1}–${d2} ${MESES[m1 - 1]}` : `${d1} ${MESES[m1 - 1]} – ${d2} ${MESES[m2 - 1]}`;
}

/**
 * Calendario visual de semanas: cada tarjeta muestra la semana, la fecha en
 * que Compras la recibiría y el cierre para aprobar. Los datos los calcula el
 * servidor con la configuración vigente (festivos, ventanas, corte).
 */
export function CalendarioSemanas({ valor, alCambiar, categoria, extraordinaria, semanas = 8 }: {
  valor: string; alCambiar: (lunes: string) => void;
  categoria: string | null; extraordinaria: boolean; semanas?: number;
}) {
  const [ciclos, setCiclos] = useState<CicloCalendario[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setCiclos(null); setError(null);
    proximosCiclos(categoria, semanas, extraordinaria)
      .then((c) => { if (vivo) setCiclos(c); })
      .catch((e) => { if (vivo) setError(e instanceof Error ? e.message : String(e)); });
    return () => { vivo = false; };
  }, [categoria, extraordinaria, semanas]);

  if (error) return <MensajeError texto={`No se pudo consultar el calendario: ${error}`} />;
  if (!ciclos) return <Cargando texto="Consultando el calendario de recepción…" />;

  const sinCalendario = ciclos.length > 0 && ciclos[0].origen === 'sin_calendario';
  return (
    <div>
      {sinCalendario ? (
        <p className="texto-suave">
          El calendario de recepción aún no está activo: una vez aprobada por tu jefe, la
          solicitud pasa a Compras de inmediato. La semana objetivo queda como referencia.
        </p>
      ) : null}
      {extraordinaria ? (
        <p className="texto-suave">Solicitud extraordinaria: no espera el calendario; pasa a Compras en cuanto tu jefe la apruebe.</p>
      ) : null}
      <div className="calendario-semanas" role="radiogroup" aria-label="Semana objetivo">
        {ciclos.map((c) => {
          const { anio, semana } = semanaISO(c.semana_lunes);
          const sel = c.semana_lunes === valor;
          return (
            <button type="button" key={c.semana_lunes} role="radio" aria-checked={sel}
              className={`semana-opcion${sel ? ' seleccionada' : ''}`}
              onClick={() => alCambiar(c.semana_lunes)}>
              <span className="semana-titulo">{sel ? '● ' : ''}Semana {tramo(c.semana_lunes)}</span>
              <span className="semana-detalle">{anio}-S{String(semana).padStart(2, '0')}</span>
              {c.origen === 'ciclo_semanal' || c.origen === 'ventana_categoria' ? (
                <>
                  <span className="semana-detalle">Recepción Compras: <b>{fmtFecha(c.fecha_recepcion)}</b></span>
                  <span className="semana-detalle">Aprobar antes de: {fmtFechaHora(c.cierre)}</span>
                </>
              ) : null}
              {c.nota ? <span className="semana-festivo">{c.nota}</span> : null}
              {c.no_habiles.map((n) => (
                <span key={n.fecha} className="semana-festivo">No hábil {fmtFecha(n.fecha)}: {n.descripcion}</span>
              ))}
            </button>
          );
        })}
      </div>
    </div>
  );
}
