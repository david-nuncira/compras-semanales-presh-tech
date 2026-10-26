import { useEffect, useState } from 'react';
import { supabase, limpiarError } from '../supabase.ts';
import type { EventoHistorial } from '../tipos.ts';
import { fmtFechaHora } from '../util/fechas.ts';
import { Cargando, MensajeError } from './UI.tsx';

/** Historial de estados en lenguaje sencillo (quién, cuándo, qué y por qué). */
export function HistorialSolicitud({ solicitudId, refresco }: { solicitudId: string; refresco?: number }) {
  const [eventos, setEventos] = useState<EventoHistorial[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    supabase.rpc('fn_historial_solicitud', { p_solicitud: solicitudId }).then(({ data, error: e }) => {
      if (!vivo) return;
      if (e) setError(limpiarError(e.message)); else setEventos((data ?? []) as EventoHistorial[]);
    });
    return () => { vivo = false; };
  }, [solicitudId, refresco]);
  if (error) return <MensajeError texto={error} />;
  if (!eventos) return <Cargando texto="Cargando historial…" />;
  if (eventos.length === 0) return <p className="texto-suave">Sin eventos registrados.</p>;
  return (
    <ul className="historial">
      {eventos.map((e, i) => (
        <li key={i}>
          <b>{e.descripcion}</b>
          <div className="texto-suave">{fmtFechaHora(e.evento_en)} · {e.actor}</div>
          {e.motivo ? <div>Motivo: {e.motivo}</div> : null}
        </li>
      ))}
    </ul>
  );
}
