import { Formulario } from '../componentes/UI.tsx';
import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, rpc, limpiarError, nuevoOp } from '../supabase.ts';
import { useSesion } from '../contexto/Sesion.tsx';
import { useActualizacionPeriodica } from '../datos.ts';
import type { AprobacionSolicitud, VArticulo, Devolucion } from '../tipos.ts';
import { Campo, MensajeError, MensajeExito, Cargando, Modal } from '../componentes/UI.tsx';
import { Adjuntos } from '../componentes/Adjuntos.tsx';
import { etiquetaSemana, fmtFecha, fmtFechaHora } from '../util/fechas.ts';
import { fmtCantidad } from '../util/moneda.ts';

type Decision = 'aprobar' | 'devolver' | 'rechazar';

/** Bandeja del jefe de área: solo lo asignado a quien consulta (lo filtra el servidor). */
export function AprobacionSolicitudes() {
  const { perfil } = useSesion();
  const [pendientes, setPendientes] = useState<AprobacionSolicitud[] | null>(null);
  const [decididas, setDecididas] = useState<AprobacionSolicitud[]>([]);
  const [articulos, setArticulos] = useState<Record<string, VArticulo[]>>({});
  const [devoluciones, setDevoluciones] = useState<Array<Devolucion & { numero?: string }>>([]);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Record<string, { ok: boolean; texto: string }>>({});
  const [decision, setDecision] = useState<null | { ap: AprobacionSolicitud; tipo: Decision; motivo: string }>(null);
  const [mError, setMError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    if (!perfil) return;
    const [rp, rd] = await Promise.all([
      supabase.from('v_aprobaciones_solicitud').select('*')
        .eq('aprobador_id', perfil.id).eq('es_vigente', true).eq('estado', 'pendiente')
        .order('es_extraordinaria', { ascending: false }).order('solicitada_en'),
      supabase.from('v_aprobaciones_solicitud').select('*')
        .eq('aprobador_id', perfil.id).neq('estado', 'pendiente')
        .order('decidido_en', { ascending: false }).limit(30)
    ]);
    if (rp.error) { setError(limpiarError(rp.error.message)); return; }
    const pend = (rp.data ?? []) as AprobacionSolicitud[];
    setPendientes(pend);
    setDecididas((rd.data ?? []) as AprobacionSolicitud[]);
    if (pend.length > 0) {
      const { data: arts } = await supabase.from('v_articulos').select('*')
        .in('solicitud_id', pend.map((p) => p.solicitud_id)).neq('etapa', 'cancelado').order('creado_en');
      const porSol: Record<string, VArticulo[]> = {};
      for (const a of (arts ?? []) as VArticulo[]) (porSol[a.solicitud_id] ??= []).push(a);
      setArticulos(porSol);
    }
    // Peticiones de devolución de solicitudes que me toca autorizar.
    const { data: misVigentes } = await supabase.from('solicitud_aprobaciones').select('solicitud_id')
      .eq('aprobador_id', perfil.id).eq('es_vigente', true);
    const ids = (misVigentes ?? []).map((x: { solicitud_id: string }) => x.solicitud_id);
    if (ids.length > 0) {
      const { data: devs } = await supabase.from('solicitud_devoluciones').select('*')
        .in('solicitud_id', ids).eq('estado', 'pendiente');
      const { data: sols } = await supabase.from('solicitudes').select('id, numero').in('id', ids);
      const nums = new Map(((sols ?? []) as Array<{ id: string; numero: string }>).map((x) => [x.id, x.numero]));
      setDevoluciones(((devs ?? []) as Devolucion[]).map((d) => ({ ...d, numero: nums.get(d.solicitud_id) })));
    } else {
      setDevoluciones([]);
    }
  }, [perfil]);

  useActualizacionPeriodica(cargar, 60000, [cargar]);

  async function decidir(e: React.FormEvent) {
    e.preventDefault();
    if (!decision) return;
    setMError(null);
    if (decision.tipo !== 'aprobar' && decision.motivo.trim().length < 5) {
      setMError('Escribe el motivo: el solicitante lo verá.'); return;
    }
    setOcupado(true);
    try {
      const r = await rpc<{ liberada?: boolean; recepcion?: string; nota?: string | null }>('fn_decidir_solicitud', {
        p_solicitud: decision.ap.solicitud_id, p_decision: decision.tipo,
        p_motivo: decision.motivo.trim() || null, p_version: decision.ap.version, p_op: nuevoOp()
      });
      const texto = decision.tipo === 'aprobar'
        ? (r.liberada ? 'Aprobada: ya está en la bandeja de Compras.' : `Aprobada y programada: Compras la recibirá el ${fmtFecha(r.recepcion ?? null)}.`) + (r.nota ? ` ${r.nota}` : '')
        : decision.tipo === 'devolver' ? 'Devuelta al solicitante con tu motivo.' : 'Rechazada; el solicitante verá tu motivo.';
      setResultado((x) => ({ ...x, [decision.ap.solicitud_id]: { ok: true, texto } }));
      setDecision(null);
      await cargar();
    } catch (err) {
      setMError(err instanceof Error ? err.message : String(err));
    } finally {
      setOcupado(false);
    }
  }

  async function resolverDevolucion(d: Devolucion, autorizar: boolean) {
    const respuesta = autorizar ? '' : (window.prompt('Explica por qué no autorizas la devolución (mínimo 5 caracteres):') ?? '');
    if (!autorizar && respuesta.trim().length < 5) return;
    try {
      await rpc('fn_resolver_devolucion', { p_devolucion: d.id, p_autorizar: autorizar, p_respuesta: respuesta || null, p_op: nuevoOp() });
      setResultado((x) => ({ ...x, ['dev:' + d.id]: { ok: true, texto: autorizar ? 'Devolución autorizada.' : 'Devolución no autorizada.' } }));
      await cargar();
    } catch (err) {
      setResultado((x) => ({ ...x, ['dev:' + d.id]: { ok: false, texto: err instanceof Error ? err.message : String(err) } }));
    }
  }

  const ultimos = Object.entries(resultado).filter(([k]) => !pendientes?.some((p) => p.solicitud_id === k));

  return (
    <div className="contenido">
      <h1>Pendientes de mi aprobación</h1>
      <p className="texto-suave">
        Solicitudes de tu área (o de la ruta superior que tienes asignada). Ninguna llega a Compras sin tu
        decisión. No puedes decidir tus propias solicitudes. Devolver y rechazar exigen un motivo que verá el solicitante.
      </p>
      <MensajeError texto={error} flotante />
      {ultimos.map(([k, r]) => r.ok ? <MensajeExito key={k} texto={r.texto} flotante /> : <MensajeError key={k} texto={r.texto} flotante />)}

      {devoluciones.length > 0 ? (
        <div className="tarjeta">
          <h2>Peticiones de devolución por resolver</h2>
          {devoluciones.map((d) => (
            <div key={d.id} className="acciones-fila" style={{ borderBottom: '1px dashed var(--borde)', padding: '0.4rem 0' }}>
              <span><b>{d.numero}</b> · {fmtFechaHora(d.creado_en)} · “{d.motivo}”</span>
              <button type="button" className="boton-primario" onClick={() => void resolverDevolucion(d, true)}>Autorizar corrección</button>
              <button type="button" className="boton-secundario" onClick={() => void resolverDevolucion(d, false)}>No autorizar…</button>
            </div>
          ))}
        </div>
      ) : null}

      {!pendientes ? <Cargando /> : pendientes.length === 0 ? (
        <div className="tarjeta"><p>No tienes solicitudes pendientes de aprobación.</p></div>
      ) : pendientes.map((ap) => {
        const arts = articulos[ap.solicitud_id] ?? [];
        const r = resultado[ap.solicitud_id];
        return (
          <div className="tarjeta" key={ap.aprobacion_id}>
            <div className="acciones-fila">
              <h3 style={{ margin: 0 }}>{ap.numero}</h3>
              {ap.es_extraordinaria ? <span className="insignia insignia-extra">Extraordinaria</span> : null}
              {ap.ruta === 'ruta_superior' ? <span className="insignia-suave">Ruta superior (solicitud del jefe del área)</span> : null}
              {ap.version > 1 ? <span className="insignia-suave">Versión {ap.version} (tras corrección)</span> : null}
            </div>
            <p className="texto-suave">
              {ap.solicitante_nombre} · {ap.area_nombre} · {ap.centro_costo_codigo} {ap.centro_costo_nombre} ·
              {' '}{etiquetaSemana(ap.semana_lunes)} · creada {fmtFechaHora(ap.creado_en)} · enviada {fmtFechaHora(ap.ultimo_envio_en)}
            </p>
            {ap.justificacion ? <p>Justificación: {ap.justificacion}</p> : null}
            {ap.es_extraordinaria ? <p><b>Motivo de la emergencia:</b> {ap.motivo_extraordinaria}</p> : null}
            <div className="tabla-envoltura">
              <table className="tabla">
                <thead><tr><th>Artículo</th><th>Especificaciones</th><th className="numero">Cantidad</th><th>Prioridad</th><th>Requerido</th><th>Enlace</th></tr></thead>
                <tbody>
                  {arts.map((a) => (
                    <tr key={a.id}>
                      <td>{a.nombre}{a.adjuntos > 0 ? ` · 📎${a.adjuntos}` : ''}</td>
                      <td>{a.descripcion}{a.justificacion ? <div className="texto-suave">Justificación: {a.justificacion}</div> : null}</td>
                      <td className="numero">{fmtCantidad(a.cantidad)} {a.unidad}</td>
                      <td>{a.prioridad}</td>
                      <td>{a.fecha_requerida ? fmtFecha(a.fecha_requerida) : '—'}</td>
                      <td>{a.enlace_referencia ? <a href={a.enlace_referencia} target="_blank" rel="noopener noreferrer">Abrir</a> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="acciones-fila" style={{ marginTop: '0.5rem' }}>
              <button type="button" className="boton-primario" onClick={() => { setMError(null); setDecision({ ap, tipo: 'aprobar', motivo: '' }); }}>Aprobar…</button>
              <button type="button" className="boton-secundario" onClick={() => { setMError(null); setDecision({ ap, tipo: 'devolver', motivo: '' }); }}>Devolver para corrección…</button>
              <button type="button" className="boton-peligro" onClick={() => { setMError(null); setDecision({ ap, tipo: 'rechazar', motivo: '' }); }}>Rechazar…</button>
              <button type="button" className="boton-silencioso" onClick={() => setAbierta(abierta === ap.solicitud_id ? null : ap.solicitud_id)}>
                {abierta === ap.solicitud_id ? 'Ocultar adjuntos' : 'Ver imágenes y documentos'}
              </button>
              <Link to={`/solicitudes/${ap.solicitud_id}`}>Ver detalle completo →</Link>
            </div>
            {r ? (r.ok ? <MensajeExito texto={r.texto} /> : <MensajeError texto={r.texto} />) : null}
            {abierta === ap.solicitud_id ? arts.map((a) => (
              <div key={a.id}><Adjuntos entidad="articulo" entidadId={a.id} puedeSubir={false} titulo={`Adjuntos de “${a.nombre}”`} /></div>
            )) : null}
          </div>
        );
      })}

      <h2>Decididas recientemente</h2>
      {decididas.length === 0 ? <p className="texto-suave">Sin decisiones aún.</p> : (
        <div className="tabla-envoltura">
          <table className="tabla">
            <thead><tr><th>Fecha</th><th>Solicitud</th><th>Solicitante</th><th>Decisión</th><th>Motivo</th><th>Estado actual</th></tr></thead>
            <tbody>
              {decididas.map((d) => (
                <tr key={d.aprobacion_id}>
                  <td>{d.decidido_en ? fmtFechaHora(d.decidido_en) : '—'}</td>
                  <td><Link to={`/solicitudes/${d.solicitud_id}`}>{d.numero}</Link> (v{d.version})</td>
                  <td>{d.solicitante_nombre}</td>
                  <td>{d.estado}</td>
                  <td>{d.motivo ?? ''}</td>
                  <td>{d.solicitud_estado}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal titulo={decision ? (decision.tipo === 'aprobar' ? `Aprobar ${decision.ap.numero}` : decision.tipo === 'devolver' ? `Devolver ${decision.ap.numero}` : `Rechazar ${decision.ap.numero}`) : ''}
        abierto={!!decision} alCerrar={() => setDecision(null)}>
        {decision ? (
          <Formulario className="formulario" onSubmit={decidir}>
            {decision.tipo === 'aprobar' ? (
              <p>Se aprueba la versión {decision.ap.version} tal como está. Pasará a Compras en su fecha de recepción
                {decision.ap.es_extraordinaria ? ' (extraordinaria: de inmediato)' : ''}. Si luego cambia el contenido, necesitará una nueva aprobación.</p>
            ) : decision.tipo === 'devolver' ? (
              <p>El solicitante podrá corregir y reenviar; la versión actual queda en el historial.</p>
            ) : (
              <p>La solicitud termina aquí y no llega a Compras.</p>
            )}
            <Campo etiqueta={decision.tipo === 'aprobar' ? 'Comentario' : 'Motivo (lo verá el solicitante)'}
              requerido={decision.tipo !== 'aprobar'} opcional={decision.tipo === 'aprobar'}>
              <textarea rows={3} value={decision.motivo} onChange={(e) => setDecision({ ...decision, motivo: e.target.value })} />
            </Campo>
            <MensajeError texto={mError} />
            <div className="modal-acciones">
              <button type="button" className="boton-secundario" onClick={() => setDecision(null)}>Cancelar</button>
              <button type="submit" className={decision.tipo === 'rechazar' ? 'boton-peligro' : 'boton-primario'} disabled={ocupado}>
                {ocupado ? 'Guardando…' : decision.tipo === 'aprobar' ? 'Aprobar' : decision.tipo === 'devolver' ? 'Devolver' : 'Rechazar'}
              </button>
            </div>
          </Formulario>
        ) : null}
      </Modal>
    </div>
  );
}
