import { EstadoVacio } from '../componentes/UI.tsx';
import { EstadoError } from '../componentes/UI.tsx';
import { Formulario } from '../componentes/UI.tsx';
import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, rpc, limpiarError, nuevoOp } from '../supabase.ts';
import { useSesion } from '../contexto/Sesion.tsx';
import { useActualizacionPeriodica } from '../datos.ts';
import type { Aprobacion } from '../tipos.ts';
import { Campo, MensajeError, MensajeExito, Cargando, Modal } from '../componentes/UI.tsx';
import { fmtFechaHora } from '../util/fechas.ts';
import { fmtMoneda, fmtCantidad } from '../util/moneda.ts';

interface AprobacionConContexto extends Aprobacion {
  articulos: {
    id: string; nombre: string; solicitud_id: string;
    solicitudes: { numero: string; solicitante_id: string } | null;
  } | null;
}

export function Aprobaciones() {
  const { perfil } = useSesion();
  const [pendientes, setPendientes] = useState<AprobacionConContexto[] | null>(null);
  const [historicas, setHistoricas] = useState<AprobacionConContexto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [decision, setDecision] = useState<null | { ap: AprobacionConContexto; aprobar: boolean; comentario: string }>(null);
  const [mError, setMError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    setError(null);
    try {
    if (!perfil) return;
    const base = supabase.from('aprobaciones')
      .select('*, articulos:articulo_id (id, nombre, solicitud_id, solicitudes:solicitud_id (numero, solicitante_id))')
      .eq('aprobador_id', perfil.id);
    const [rp, rh] = await Promise.all([
      base.eq('estado', 'pendiente').eq('es_vigente', true).order('creado_en'),
      supabase.from('aprobaciones')
        .select('*, articulos:articulo_id (id, nombre, solicitud_id, solicitudes:solicitud_id (numero, solicitante_id))')
        .eq('aprobador_id', perfil.id).neq('estado', 'pendiente')
        .order('decidido_en', { ascending: false }).limit(30)
    ]);
    if (rp.error) { setError(limpiarError(rp.error.message)); return; }
    setPendientes((rp.data ?? []) as unknown as AprobacionConContexto[]);
    setHistoricas((rh.data ?? []) as unknown as AprobacionConContexto[]);
    } catch (e) { setError(limpiarError(e instanceof Error ? e.message : String(e))); }
  }, [perfil]);

  useActualizacionPeriodica(cargar, 60000, [cargar]);

  function versionTexto(ap: Aprobacion): string {
    const v = ap.version_aprobada as Record<string, unknown>;
    return `${fmtCantidad(Number(v.cantidad ?? 0))} ${String(v.unidad ?? '')} de "${String(v.articulo ?? '')}" · proveedor ${String(v.proveedor ?? '—')} · ${fmtMoneda(Number(v.precio_unitario ?? NaN), String(v.moneda ?? 'COP'))} c/u · total estimado ${fmtMoneda(Number(v.total_estimado ?? NaN), String(v.moneda ?? 'COP'))}`;
  }

  async function decidir(e: React.FormEvent) {
    e.preventDefault();
    if (!decision) return;
    setMError(null);
    if (!decision.aprobar && decision.comentario.trim().length < 5) {
      setMError('El rechazo exige un motivo.'); return;
    }
    setOcupado(true);
    try {
      await rpc('fn_decidir_aprobacion', {
        p_aprobacion: decision.ap.id, p_aprobar: decision.aprobar,
        p_comentario: decision.comentario.trim() || null, p_op: nuevoOp()
      });
      setDecision(null);
      setExito(decision.aprobar ? 'Aprobación registrada.' : 'Rechazo registrado.');
      await cargar();
    } catch (err) {
      setMError(err instanceof Error ? err.message : String(err));
    } finally {
      setOcupado(false);
    }
  }

  const esPropia = (ap: AprobacionConContexto) =>
    ap.articulos?.solicitudes?.solicitante_id === perfil?.id;

  return (
    <div className="contenido">
      <h1>Aprobaciones</h1>
      <p className="texto-suave">Solo decides las aprobaciones asignadas a ti. La decisión guarda qué se aprobó exactamente (artículo, cantidad, proveedor e importe).</p>
      <MensajeError texto={error} />
      <MensajeExito texto={exito} />
      <h2>Pendientes</h2>
      {!pendientes ? (error ? <EstadoError alReintentar={() => void cargar()} /> : <Cargando />) : pendientes.length === 0 ? (
        <EstadoVacio titulo="Sin registros en esta vista">No tienes aprobaciones pendientes.</EstadoVacio>
      ) : pendientes.map((ap) => (
        <div className="tarjeta" key={ap.id}>
          <p>
            <b>{ap.articulos?.solicitudes?.numero}</b> · <Link to={`/gestion/articulo/${ap.articulo_id}`}>{ap.articulos?.nombre}</Link>
            {' '}· solicitada {fmtFechaHora(ap.creado_en)}
          </p>
          <p>{versionTexto(ap)}</p>
          {esPropia(ap) ? (
            <p className="mensaje mensaje-error">Esta aprobación corresponde a tu propia solicitud: el sistema no te permitirá decidirla; pide a Compras reasignarla.</p>
          ) : null}
          <div className="acciones-fila">
            <button type="button" className="boton-primario" onClick={() => { setMError(null); setDecision({ ap, aprobar: true, comentario: '' }); }}>Aprobar…</button>
            <button type="button" className="boton-peligro" onClick={() => { setMError(null); setDecision({ ap, aprobar: false, comentario: '' }); }}>Rechazar…</button>
          </div>
        </div>
      ))}
      <h2>Decididas recientemente</h2>
      {historicas.length === 0 ? <p className="texto-suave">Sin decisiones aún.</p> : (
        <ul>
          {historicas.map((ap) => (
            <li key={ap.id}>
              {ap.decidido_en ? fmtFechaHora(ap.decidido_en) : ''} · <b>{ap.estado}</b> · {ap.articulos?.solicitudes?.numero} · {ap.articulos?.nombre}
              {ap.comentario ? ` · "${ap.comentario}"` : ''}
            </li>
          ))}
        </ul>
      )}

      <Modal titulo={decision?.aprobar ? 'Confirmar aprobación' : 'Confirmar rechazo'} abierto={!!decision} alCerrar={() => setDecision(null)}>
        {decision ? (
          <Formulario className="formulario" onSubmit={decidir}>
            <p>{versionTexto(decision.ap)}</p>
            <Campo etiqueta={decision.aprobar ? 'Comentario (opcional)' : 'Motivo del rechazo (obligatorio)'} requerido={!decision.aprobar}>
              <textarea rows={3} value={decision.comentario} onChange={(e) => setDecision({ ...decision, comentario: e.target.value })} />
            </Campo>
            <MensajeError texto={mError} />
            <div className="modal-acciones">
              <button type="button" className="boton-secundario" onClick={() => setDecision(null)}>Cancelar</button>
              <button type="submit" className={decision.aprobar ? 'boton-primario' : 'boton-peligro'} disabled={ocupado}>
                {ocupado ? 'Guardando…' : decision.aprobar ? 'Aprobar' : 'Rechazar'}
              </button>
            </div>
          </Formulario>
        ) : null}
      </Modal>
    </div>
  );
}
