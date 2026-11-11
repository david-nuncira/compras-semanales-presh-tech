import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, rpc, limpiarError } from '../supabase.ts';
import { useSesion } from '../contexto/Sesion.tsx';
import { useActualizacionPeriodica } from '../datos.ts';
import type { Notificacion } from '../tipos.ts';
import { MensajeError, Cargando } from '../componentes/UI.tsx';
import { fmtFechaHora } from '../util/fechas.ts';

export function Notificaciones() {
  const { recargarPerfil } = useSesion();
  const [lista, setLista] = useState<Notificacion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const { data, error: e } = await supabase.from('notificaciones').select('*')
      .order('creado_en', { ascending: false }).limit(100);
    if (e) { setError(limpiarError(e.message)); return; }
    setLista((data ?? []) as Notificacion[]);
  }, []);
  useActualizacionPeriodica(cargar, 60000, [cargar]);

  async function marcar(ids: number[] | null) {
    try { await rpc('fn_marcar_notificaciones', { p_ids: ids }); await cargar(); await recargarPerfil(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <div className="contenido">
      <h1>Notificaciones</h1>
      <div className="acciones-fila">
        <button type="button" className="boton-secundario" onClick={() => void marcar(null)}>Marcar todas como leídas</button>
        <button type="button" className="boton-secundario" onClick={() => void cargar()}>Actualizar</button>
      </div>
      <MensajeError texto={error} flotante />
      {!lista ? <Cargando /> : lista.length === 0 ? <p className="texto-suave">No tienes notificaciones.</p> : (
        <div className="tarjeta">
          {lista.map((n) => (
            <div key={n.id} className={`buzon-aviso${n.leida_en ? '' : ' no-leida'}`}>
              <div className="acciones-fila">
                <b>{n.titulo}</b>
                {!n.leida_en ? <span className="insignia-suave">Nueva</span> : null}
              </div>
              {n.cuerpo ? <div style={{ whiteSpace: 'pre-line' }}>{n.cuerpo}</div> : null}
              <div className="texto-suave">Ocurrió: {fmtFechaHora(n.evento_en)}</div>
              <div className="acciones-fila">
                {n.enlace ? <Link to={n.enlace} onClick={() => { if (!n.leida_en) void marcar([n.id]); }}>Abrir →</Link> : null}
                {!n.leida_en ? <button type="button" className="boton-silencioso" onClick={() => void marcar([n.id])}>Marcar como leída</button> : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
