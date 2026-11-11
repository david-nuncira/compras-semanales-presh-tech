import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, rpc, limpiarError, nuevoOp } from '../supabase.ts';
import { useSesion } from '../contexto/Sesion.tsx';
import { useResumen } from '../contexto/Resumen.tsx';
import { useActualizacionPeriodica } from '../datos.ts';
import type { AprobacionSolicitud, VArticulo, Devolucion } from '../tipos.ts';
import {
  Boton, BotonConMotivo, Campo, EstadoVacio, Icono, MensajeError, MensajeExito, PanelLateral, TablaDatos,
  type ColumnaDatos
} from '../componentes/UI.tsx';
import { Adjuntos } from '../componentes/Adjuntos.tsx';
import { MiniaturaArticulo, useAdjuntosArticulos } from '../componentes/Miniatura.tsx';
import { etiquetaSemana, fmtFecha, fmtFechaHora } from '../util/fechas.ts';
import { fmtCantidad } from '../util/moneda.ts';
import { useEstadoURL } from '../util/estadoUrl.ts';

type Decision = 'aprobar' | 'devolver' | 'rechazar';
const VACIO_URL: { ver: string } = { ver: '' };
const ESTADO_DECIDIDO: Record<Decision, string> = { aprobar: 'aprobada', devolver: 'devuelta', rechazar: 'rechazada' };

/**
 * Bandeja del jefe de área: solo lo asignado a quien consulta (lo filtra el servidor).
 * Lista compacta; la vista rápida y la decisión ocurren en un panel lateral para
 * no salir de la lista. Tras decidir solo se quita esa fila (no se recarga todo).
 */
export function AprobacionSolicitudes() {
  const { perfil } = useSesion();
  const { recargar: recargarContadores } = useResumen();
  const { estado: url, cambiar } = useEstadoURL(VACIO_URL);
  const [pendientes, setPendientes] = useState<AprobacionSolicitud[] | null>(null);
  const [decididas, setDecididas] = useState<AprobacionSolicitud[]>([]);
  const [articulos, setArticulos] = useState<Record<string, VArticulo[]>>({});
  const [devoluciones, setDevoluciones] = useState<Array<Devolucion & { numero?: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [decision, setDecision] = useState<null | { tipo: Decision; motivo: string }>(null);
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
    setError(null);
    const pend = (rp.data ?? []) as AprobacionSolicitud[];
    setPendientes(pend);
    setDecididas((rd.data ?? []) as AprobacionSolicitud[]);
    if (pend.length > 0) {
      const { data: arts } = await supabase.from('v_articulos').select('*')
        .in('solicitud_id', pend.map((p) => p.solicitud_id)).neq('etapa', 'cancelado').order('creado_en');
      const porSol: Record<string, VArticulo[]> = {};
      for (const a of (arts ?? []) as VArticulo[]) (porSol[a.solicitud_id] ??= []).push(a);
      setArticulos(porSol);
    } else setArticulos({});
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

  const abierta = pendientes?.find((p) => p.solicitud_id === url.ver) ?? null;
  const artsAbierta = abierta ? (articulos[abierta.solicitud_id] ?? []) : [];
  const idsArticulos = useMemo(() => Object.values(articulos).flat().map((a) => a.id), [articulos]);
  const { porArticulo } = useAdjuntosArticulos(idsArticulos);

  const abrir = (ap: AprobacionSolicitud) => { setDecision(null); setMError(null); cambiar({ ver: ap.solicitud_id }); };
  const cerrar = () => { setDecision(null); setMError(null); cambiar({ ver: '' }); };

  async function decidir(e: React.FormEvent) {
    e.preventDefault();
    if (!abierta || !decision) return;
    setMError(null);
    if (decision.tipo !== 'aprobar' && decision.motivo.trim().length < 5) {
      setMError('Escribe el motivo (mínimo 5 caracteres): el solicitante lo verá.'); return;
    }
    setOcupado(true);
    try {
      const r = await rpc<{ liberada?: boolean; recepcion?: string; nota?: string | null }>('fn_decidir_solicitud', {
        p_solicitud: abierta.solicitud_id, p_decision: decision.tipo,
        p_motivo: decision.motivo.trim() || null, p_version: abierta.version, p_op: nuevoOp()
      });
      const texto = decision.tipo === 'aprobar'
        ? (r.liberada ? 'Aprobada: ya está en la bandeja de Compras.' : `Aprobada y programada: Compras la recibirá el ${fmtFecha(r.recepcion ?? null)}.`) + (r.nota ? ` ${r.nota}` : '')
        : decision.tipo === 'devolver' ? 'Devuelta al solicitante con tu motivo.' : 'Rechazada; el solicitante verá tu motivo.';
      // Solo se actualiza la fila afectada: sale de pendientes y entra a «Decididas».
      const idDecidida = abierta.aprobacion_id;
      setPendientes((xs) => (xs ? xs.filter((x) => x.aprobacion_id !== idDecidida) : xs));
      setAviso({ ok: true, texto: `${abierta.numero}: ${texto}` });
      setDecision(null);
      cambiar({ ver: '' });
      void supabase.from('v_aprobaciones_solicitud').select('*').eq('aprobacion_id', idDecidida).maybeSingle().then(({ data }) => {
        if (data) setDecididas((xs) => [data as AprobacionSolicitud, ...xs.filter((x) => x.aprobacion_id !== idDecidida)].slice(0, 30));
        else setDecididas((xs) => [{ ...abierta, estado: ESTADO_DECIDIDO[decision.tipo] as AprobacionSolicitud['estado'], decidido_en: new Date().toISOString(), motivo: decision.motivo.trim() || null }, ...xs].slice(0, 30));
      });
      void recargarContadores();
    } catch (err) {
      setMError(err instanceof Error ? err.message : String(err));
    } finally {
      setOcupado(false);
    }
  }

  async function resolverDevolucion(d: Devolucion & { numero?: string }, autorizar: boolean, respuesta: string | null) {
    await rpc('fn_resolver_devolucion', { p_devolucion: d.id, p_autorizar: autorizar, p_respuesta: respuesta, p_op: nuevoOp() });
    setDevoluciones((xs) => xs.filter((x) => x.id !== d.id));
    setAviso({ ok: true, texto: `${d.numero ?? 'Solicitud'}: ${autorizar ? 'devolución autorizada.' : 'devolución no autorizada.'}` });
  }

  const columnas: ColumnaDatos<AprobacionSolicitud>[] = [
    { clave: 'numero', titulo: 'Solicitud', render: (ap) => (
      <>
        <b>{ap.numero}</b>
        <div className="insignias-col">
          {ap.es_extraordinaria ? <span className="insignia insignia-extra">Extraordinaria</span> : null}
          {ap.ruta === 'ruta_superior' ? <span className="insignia-suave">Ruta superior</span> : null}
          {ap.version > 1 ? <span className="insignia-suave">Versión {ap.version}</span> : null}
        </div>
      </>
    ) },
    { clave: 'solicitante', titulo: 'Solicitante', render: (ap) => ap.solicitante_nombre },
    { clave: 'area', titulo: 'Área · CC', ocultoMovil: true, render: (ap) => `${ap.area_nombre ?? ''} · ${ap.centro_costo_codigo ?? ''}` },
    { clave: 'semana', titulo: 'Semana', ocultoMovil: true, render: (ap) => etiquetaSemana(ap.semana_lunes) },
    { clave: 'enviada', titulo: 'Enviada', render: (ap) => fmtFechaHora(ap.ultimo_envio_en) },
    { clave: 'articulos', titulo: 'Artículos', numerico: true, render: (ap) => (articulos[ap.solicitud_id] ?? []).length },
    { clave: 'accion', titulo: 'Acción', render: (ap) => (
      <Boton variante="primario" onClick={() => abrir(ap)} aria-label={`Revisar ${ap.numero}`}>Revisar</Boton>
    ) }
  ];

  return (
    <div className="contenido">
      <section className="cabecera-aprobaciones">
        <div><span className="sobre-titulo">APROBACIÓN DE JEFATURA</span><h1>Ayuda a que las compras avancen</h1>
          <p>Revisa la necesidad, verifica los artículos y decide. Ninguna solicitud llega a Compras sin tu aprobación.</p>
          <ol className="mini-ruta mini-ruta-aprobacion" aria-label="Cómo aprobar una solicitud"><li><span>1</span><div><b>Revisa</b><small>La necesidad y los artículos.</small></div></li><li><span>2</span><div><b>Decide</b><small>Aprueba, devuelve o rechaza.</small></div></li><li><span>3</span><div><b>Deja un comentario</b><small>Si necesita una corrección.</small></div></li></ol>
        </div>
        <div className="contador-aprobaciones" aria-label="Solicitudes pendientes"><span>Por revisar ahora</span><b>{pendientes?.length ?? '—'}</b><small>{pendientes?.length === 1 ? 'solicitud espera tu decisión' : 'solicitudes esperan tu decisión'}</small></div>
      </section>
      <MensajeError texto={pendientes ? error : null} flotante />
      {aviso ? (aviso.ok
        ? <MensajeExito texto={aviso.texto} flotante alCerrar={() => setAviso(null)} />
        : <MensajeError texto={aviso.texto} flotante alCerrar={() => setAviso(null)} />) : null}

      {devoluciones.length > 0 ? (
        <section className="tarjeta" aria-labelledby="dev-lista">
          <h2 id="dev-lista">Peticiones de devolución por resolver</h2>
          {devoluciones.map((d) => (
            <div key={d.id} className="acciones-fila fila-devolucion">
              <span><b>{d.numero}</b> · {fmtFechaHora(d.creado_en)} · “{d.motivo}”</span>
              <BotonConMotivo etiqueta="No autorizar…" titulo={`No autorizar la devolución de ${d.numero ?? 'la solicitud'}`}
                descripcion="Explica por qué no autorizas la devolución (mínimo 5 caracteres). El solicitante lo verá."
                onConfirmar={async (motivo) => {
                  if (motivo.length < 5) throw new Error('Escribe al menos 5 caracteres.');
                  await resolverDevolucion(d, false, motivo);
                }} />
              <Boton variante="primario" onClick={() => void resolverDevolucion(d, true, null).catch((err) => setAviso({ ok: false, texto: err instanceof Error ? err.message : String(err) }))}>
                Autorizar corrección
              </Boton>
            </div>
          ))}
        </section>
      ) : null}

      <TablaDatos titulo="Solicitudes pendientes de mi aprobación" columnas={columnas} filas={pendientes} clave={(ap) => ap.aprobacion_id}
        error={pendientes ? null : error} alReintentar={() => void cargar()}
        vacio={<EstadoVacio titulo="No tienes solicitudes pendientes de aprobación" texto="Cuando un integrante de tu área envíe una solicitud, aparecerá aquí y en la campana."
          accion={<Link className="boton-secundario enlace-boton" to="/">Volver al inicio</Link>} />} />

      <h2>Decididas recientemente</h2>
      {decididas.length === 0 ? <p className="texto-suave">Sin decisiones aún.</p> : (
        <div className="tabla-envoltura" tabIndex={0} role="region" aria-label="Decisiones recientes">
          <table className="tabla">
            <caption className="solo-lectores">Decisiones recientes</caption>
            <thead><tr><th scope="col">Fecha</th><th scope="col">Solicitud</th><th scope="col">Solicitante</th><th scope="col">Decisión</th><th scope="col">Motivo</th><th scope="col">Estado actual</th></tr></thead>
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

      <PanelLateral titulo={abierta ? `Revisar ${abierta.numero}` : 'Revisar solicitud'} abierto={!!abierta} alCerrar={cerrar}>
        {abierta ? (
          <div className="revision">
            <div className="insignias-col">
              {abierta.es_extraordinaria ? <span className="insignia insignia-extra">Extraordinaria</span> : null}
              {abierta.ruta === 'ruta_superior' ? <span className="insignia-suave">Ruta superior (solicitud del jefe del área)</span> : null}
              {abierta.version > 1 ? <span className="insignia-suave">Versión {abierta.version} (tras corrección)</span> : null}
            </div>
            <p className="texto-suave">
              {abierta.solicitante_nombre} · {abierta.area_nombre} · {abierta.centro_costo_codigo} {abierta.centro_costo_nombre} ·
              {' '}{etiquetaSemana(abierta.semana_lunes)} · creada {fmtFechaHora(abierta.creado_en)} · enviada {fmtFechaHora(abierta.ultimo_envio_en)}
            </p>
            {abierta.justificacion ? <p>Justificación: {abierta.justificacion}</p> : null}
            {abierta.es_extraordinaria ? <p><b>Motivo de la emergencia:</b> {abierta.motivo_extraordinaria}</p> : null}

            <h3>Artículos ({artsAbierta.length})</h3>
            <ul className="lista-revision">
              {artsAbierta.map((a) => (
                <li key={a.id}>
                  <MiniaturaArticulo nombre={a.nombre} adjuntos={porArticulo[a.id]} />
                  <div>
                    <b>{a.nombre}</b> · {fmtCantidad(a.cantidad)} {a.unidad}
                    <div className="texto-suave">{a.descripcion}</div>
                    <div className="texto-suave">
                      Prioridad {a.prioridad}{a.fecha_requerida ? ` · requerido ${fmtFecha(a.fecha_requerida)}` : ''}
                      {a.enlace_referencia ? <> · <a href={a.enlace_referencia} target="_blank" rel="noopener noreferrer">enlace</a></> : null}
                    </div>
                    {a.justificacion ? <div className="texto-suave">Justificación: {a.justificacion}</div> : null}
                  </div>
                </li>
              ))}
            </ul>
            {artsAbierta.some((a) => (porArticulo[a.id] ?? []).length > 0) ? (
              <details>
                <summary>Ver imágenes y documentos</summary>
                {artsAbierta.map((a) => (
                  <div key={a.id}><Adjuntos entidad="articulo" entidadId={a.id} puedeSubir={false} titulo={`Adjuntos de “${a.nombre}”`} /></div>
                ))}
              </details>
            ) : null}
            <p><Link to={`/solicitudes/${abierta.solicitud_id}`}>Ver detalle completo →</Link></p>

            <hr className="separador" />
            {!decision ? (
              <div className="acciones-fila" role="group" aria-label="Decisión">
                <Boton variante="primario" onClick={() => { setMError(null); setDecision({ tipo: 'aprobar', motivo: '' }); }}><Icono nombre="check-circulo" /> Aprobar…</Boton>
                <Boton onClick={() => { setMError(null); setDecision({ tipo: 'devolver', motivo: '' }); }}><Icono nombre="devolver" /> Devolver para corrección…</Boton>
                <Boton variante="peligro" onClick={() => { setMError(null); setDecision({ tipo: 'rechazar', motivo: '' }); }}><Icono nombre="x-circulo" /> Rechazar…</Boton>
              </div>
            ) : (
              <form className="formulario" onSubmit={decidir} noValidate>
                <h3>{decision.tipo === 'aprobar' ? 'Aprobar' : decision.tipo === 'devolver' ? 'Devolver para corrección' : 'Rechazar'}</h3>
                {decision.tipo === 'aprobar' ? (
                  <p>Se aprueba la versión {abierta.version} tal como está. Pasará a Compras en su fecha de recepción
                    {abierta.es_extraordinaria ? ' (extraordinaria: de inmediato)' : ''}. Si luego cambia el contenido, necesitará una nueva aprobación.</p>
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
                <div className="acciones-fila">
                  <Boton onClick={() => { setDecision(null); setMError(null); }}>Cancelar</Boton>
                  <Boton type="submit" variante={decision.tipo === 'rechazar' ? 'peligro' : 'primario'} cargando={ocupado}>
                    {decision.tipo === 'aprobar' ? 'Confirmar aprobación' : decision.tipo === 'devolver' ? 'Confirmar devolución' : 'Confirmar rechazo'}
                  </Boton>
                </div>
              </form>
            )}
          </div>
        ) : null}
      </PanelLateral>
    </div>
  );
}
