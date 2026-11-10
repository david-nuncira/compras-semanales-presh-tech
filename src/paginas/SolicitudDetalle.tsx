import { Formulario } from '../componentes/UI.tsx';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase, rpc, limpiarError, nuevoOp } from '../supabase.ts';
import { useSesion } from '../contexto/Sesion.tsx';
import { usePermisos } from '../permisos.ts';
import { useCatalogos, useActualizacionPeriodica } from '../datos.ts';
import type { VSolicitud, VArticulo, Movimiento, Novedad, TipoNovedad, Devolucion } from '../tipos.ts';
import { ETIQUETA_MOVIMIENTO, ETIQUETA_NOVEDAD } from '../tipos.ts';
import {
  Campo, MensajeError, MensajeExito, Cargando, Modal, InsigniaEtapa, InsigniaAprobacion,
  InsigniaSolicitud, LineaRecorrido, BotonConMotivo
} from '../componentes/UI.tsx';
import { Adjuntos } from '../componentes/Adjuntos.tsx';
import { CalendarioSemanas } from '../componentes/CalendarioSemanas.tsx';
import { HistorialSolicitud } from '../componentes/HistorialSolicitud.tsx';
import { etiquetaSemana, fmtFecha, fmtFechaHora, hoyBogotaISO } from '../util/fechas.ts';
import { fmtMoneda, fmtCantidad, parseNumero } from '../util/moneda.ts';
import {
  validarArticulo, solicitanteEdita, puedePedirDevolucion, type ArticuloForm, type ErroresArticulo
} from '../util/validaciones.ts';

interface FormArticulo extends ArticuloForm { id?: string; version?: number; }

const ARTICULO_VACIO: FormArticulo = {
  nombre: '', descripcion: '', cantidad: '1', unidad: 'Unidad', prioridad: 'media',
  fecha_requerida: '', justificacion: '', enlace_referencia: '', proveedor_sugerido: ''
};

interface Estimacion {
  aprobador: string | null; ruta: string | null; problema: string | null;
  recepcion_prevista: string | null; cierre: string | null; origen: string; nota: string | null;
}

function mensajeEnvio(r: { aprobador?: string; recepcion_prevista?: string; cierre?: string; origen?: string; nota?: string | null }): string {
  const base = `Tu solicitud fue enviada a aprobación de ${r.aprobador ?? 'tu jefe'}.`;
  if (r.origen === 'ciclo_semanal' || r.origen === 'ventana_categoria') {
    return `${base} Su recepción por Compras está prevista para el ${fmtFecha(r.recepcion_prevista ?? null)}, siempre que esté aprobada antes del cierre del ciclo (${fmtFechaHora(r.cierre ?? null)}).${r.nota ? ' ' + r.nota : ''}`;
  }
  if (r.origen === 'extraordinaria') return `${base} Es extraordinaria: pasará a Compras en cuanto se apruebe.`;
  return `${base} Pasará a Compras en cuanto se apruebe.`;
}

type ResumenSiguientePaso = { icono: string; etiqueta: string; titulo: string; descripcion: string; tono: string };

/** Traduce el estado técnico a una instrucción concreta para la persona usuaria. */
function siguientePasoSolicitud(s: VSolicitud, esDueno: boolean, editable: boolean, articulosActivos: number, problema?: string | null): ResumenSiguientePaso {
  if (editable && articulosActivos === 0) {
    return { icono: '1', etiqueta: 'PRIMER PASO', titulo: 'Agrega lo que necesitas', descripcion: 'Empieza con el primer artículo. El borrador todavía es privado y puedes corregirlo cuando quieras.', tono: 'inicio' };
  }
  if (editable && problema) {
    return { icono: '!', etiqueta: 'ANTES DE ENVIAR', titulo: 'Falta una configuración por completar', descripcion: problema, tono: 'atencion' };
  }
  if (editable) {
    return { icono: '2', etiqueta: 'SIGUIENTE PASO', titulo: 'Revisa y envía a tu jefe', descripcion: 'Cuando estés conforme con los artículos, envíala. Tu jefe la revisará antes de que llegue a Compras.', tono: 'listo' };
  }
  if (s.estado === 'pendiente_aprobacion' || s.estado === 'programada') {
    return { icono: '✓', etiqueta: 'EN REVISIÓN', titulo: 'Tu jefe está revisando la solicitud', descripcion: 'No necesitas hacer nada por ahora. Te avisaremos cuando cambie el estado.', tono: 'revision' };
  }
  if (s.estado === 'recibida_compras' || s.estado === 'enviada') {
    return { icono: '→', etiqueta: 'EN COMPRAS', titulo: 'Compras continúa con el proceso', descripcion: 'El equipo revisará las opciones de compra y podrás ver el avance desde esta misma pantalla.', tono: 'compras' };
  }
  if (s.estado === 'en_correccion' && esDueno) {
    return { icono: '↩', etiqueta: 'REQUIERE TU ATENCIÓN', titulo: 'Corrige y vuelve a enviar', descripcion: 'Revisa el comentario, ajusta lo necesario y envíala de nuevo. El historial se conserva.', tono: 'atencion' };
  }
  if (s.estado === 'rechazada' || s.estado === 'cancelada') {
    return { icono: 'i', etiqueta: 'SOLICITUD CERRADA', titulo: 'Esta solicitud no continúa', descripcion: 'Puedes revisar el motivo en el historial. Si necesitas algo distinto, crea una nueva solicitud.', tono: 'cerrada' };
  }
  return { icono: 'i', etiqueta: 'SEGUIMIENTO', titulo: 'Consulta el avance aquí', descripcion: 'Esta pantalla reúne la información, los documentos y el historial de la solicitud.', tono: 'neutro' };
}

export function SolicitudDetalle() {
  const { id } = useParams<{ id: string }>();
  const navegar = useNavigate();
  const { perfil } = useSesion();
  const permisos = usePermisos();
  const { cat } = useCatalogos();

  const [sol, setSol] = useState<VSolicitud | null>(null);
  const [articulos, setArticulos] = useState<VArticulo[]>([]);
  const [entregas, setEntregas] = useState<Movimiento[]>([]);
  const [novedades, setNovedades] = useState<Novedad[]>([]);
  const [devoluciones, setDevoluciones] = useState<Devolucion[]>([]);
  const [estimacion, setEstimacion] = useState<Estimacion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);
  const [noEncontrada, setNoEncontrada] = useState(false);
  const [refrescoHist, setRefrescoHist] = useState(0);
  const [enviando, setEnviando] = useState(false);

  const [modalArt, setModalArt] = useState<FormArticulo | null>(null);
  const [erroresArt, setErroresArt] = useState<ErroresArticulo>({});
  const [errorArt, setErrorArt] = useState<string | null>(null);
  const [modalNovedad, setModalNovedad] = useState<{ articuloId: string; tipo: TipoNovedad; descripcion: string } | null>(null);
  const [modalSemana, setModalSemana] = useState<{ semana: string; motivo: string } | null>(null);

  const esDueno = !!sol && !!perfil && sol.solicitante_id === perfil.id;
  const editable = esDueno && !!sol && solicitanteEdita(sol.estado);
  const hayComprados = articulos.some((a) => ['comprado', 'en_transito', 'recibido_parcial', 'recibido_total', 'cerrado'].includes(a.etapa));
  const unidadesActivas = (cat?.unidades ?? []).map((u) => u.nombre);

  const cargar = useCallback(async () => {
    if (!id) return;
    const [rs, ra, rd] = await Promise.all([
      supabase.from('v_solicitudes').select('*').eq('id', id).maybeSingle(),
      supabase.from('v_articulos').select('*').eq('solicitud_id', id).order('creado_en'),
      supabase.from('solicitud_devoluciones').select('*').eq('solicitud_id', id).order('creado_en', { ascending: false })
    ]);
    if (rs.error) { setError(limpiarError(rs.error.message)); return; }
    if (!rs.data) { setNoEncontrada(true); return; }
    const s = rs.data as VSolicitud;
    setSol(s);
    const arts = (ra.data ?? []) as VArticulo[];
    setArticulos(arts);
    setDevoluciones((rd.data ?? []) as Devolucion[]);
    if (arts.length > 0) {
      const ids = arts.map((a) => a.id);
      const [rm, rn] = await Promise.all([
        supabase.from('movimientos').select('*').in('articulo_id', ids).eq('tipo', 'entrega').eq('anulado', false)
          .order('creado_en', { ascending: false }),
        supabase.from('novedades').select('*').in('articulo_id', ids).order('creado_en', { ascending: false })
      ]);
      setEntregas((rm.data ?? []) as Movimiento[]);
      setNovedades((rn.data ?? []) as Novedad[]);
    } else {
      setEntregas([]); setNovedades([]);
    }
    setRefrescoHist((n) => n + 1);
  }, [id]);

  useActualizacionPeriodica(cargar, 60000, [cargar]);

  // Vista previa del envío (aprobador y fecha prevista) mientras se edita.
  useEffect(() => {
    if (!sol || !editable) { setEstimacion(null); return; }
    supabase.rpc('fn_estimar_envio', { p_solicitud: sol.id }).then(({ data, error: e }) => {
      if (!e && data) setEstimacion(data as Estimacion);
    });
  }, [sol, editable]);

  if (noEncontrada) {
    return <div className="contenido"><div className="tarjeta">
      <h2>Solicitud no encontrada</h2>
      <p>No existe o tu cuenta no tiene permiso para verla.</p>
    </div></div>;
  }
  if (!sol) return <div className="contenido"><Cargando /></div>;
  const s = sol;
  const articulosActivos = articulos.filter((a) => a.etapa !== 'cancelado').length;
  const siguiente = siguientePasoSolicitud(s, esDueno, editable, articulosActivos, estimacion?.problema);

  async function accion(fn: () => Promise<unknown>, textoOk: string) {
    setResultado(null);
    try { await fn(); setResultado({ ok: true, texto: textoOk }); await cargar(); }
    catch (e) { setResultado({ ok: false, texto: e instanceof Error ? e.message : String(e) }); }
  }

  async function enviar() {
    setResultado(null); setEnviando(true);
    try {
      const r = s.estado === 'borrador'
        ? await rpc<Record<string, string>>('fn_enviar_solicitud', { p_solicitud: s.id, p_version: s.version, p_op: nuevoOp() })
        : await rpc<Record<string, string>>('fn_reenviar_solicitud', { p_solicitud: s.id, p_comentario: 'Corrección atendida por el solicitante', p_op: nuevoOp() });
      setResultado({ ok: true, texto: mensajeEnvio(r) });
      await cargar();
    } catch (e) {
      setResultado({ ok: false, texto: (e instanceof Error ? e.message : String(e)) + ' La solicitud NO se envió: sigue guardada aquí.' });
    } finally {
      setEnviando(false);
    }
  }

  async function guardarArticulo(e: React.FormEvent) {
    e.preventDefault();
    if (!modalArt) return;
    setErrorArt(null);
    const errs = validarArticulo(modalArt, unidadesActivas, hoyBogotaISO());
    setErroresArt(errs);
    if (Object.keys(errs).length > 0) return;
    const fila = {
      nombre: modalArt.nombre.trim(),
      descripcion: modalArt.descripcion.trim(),
      cantidad: parseNumero(modalArt.cantidad),
      unidad: modalArt.unidad.trim(),
      prioridad: modalArt.prioridad,
      fecha_requerida: modalArt.fecha_requerida || null,
      justificacion: modalArt.justificacion.trim() || null,
      enlace_referencia: modalArt.enlace_referencia.trim() || null,
      proveedor_sugerido: modalArt.proveedor_sugerido.trim() || null
    };
    try {
      if (modalArt.id) {
        const { data, error: e1 } = await supabase.from('articulos').update(fila)
          .eq('id', modalArt.id).eq('version', modalArt.version ?? 0).select('id');
        if (e1) throw new Error(limpiarError(e1.message));
        if (!data || data.length === 0) throw new Error('El artículo fue modificado en otra sesión; recarga e intenta de nuevo.');
      } else {
        const { error: e2 } = await supabase.from('articulos').insert({ ...fila, solicitud_id: s.id });
        if (e2) throw new Error(limpiarError(e2.message));
      }
      setModalArt(null);
      setResultado({ ok: true, texto: modalArt.id ? 'Artículo actualizado.' : 'Artículo agregado al borrador (aún no se ha enviado).' });
      await cargar();
    } catch (err) {
      setErrorArt(err instanceof Error ? err.message : String(err));
    }
  }

  async function eliminarArticulo(a: VArticulo) {
    if (!window.confirm(`¿Eliminar el artículo "${a.nombre}" del borrador?`)) return;
    await accion(async () => {
      const { error: e1 } = await supabase.from('articulos').delete().eq('id', a.id);
      if (e1) throw new Error(limpiarError(e1.message));
    }, 'Artículo eliminado del borrador.');
  }

  async function crearNovedad(e: React.FormEvent) {
    e.preventDefault();
    if (!modalNovedad) return;
    if (modalNovedad.descripcion.trim().length < 5) { setErrorArt('Describe la novedad (mínimo 5 caracteres).'); return; }
    const { error: e1 } = await supabase.from('novedades').insert({
      articulo_id: modalNovedad.articuloId, tipo: modalNovedad.tipo, descripcion: modalNovedad.descripcion.trim()
    });
    if (e1) { setErrorArt(limpiarError(e1.message)); return; }
    setModalNovedad(null);
    setResultado({ ok: true, texto: 'Novedad registrada; Compras la atenderá.' });
    await cargar();
  }

  const devPendiente = devoluciones.find((d) => d.estado === 'pendiente');
  const entregasSinConfirmar = entregas.filter(() => esDueno).filter((m) => !m.confirmado_por_solicitante);

  return (
    <div className="contenido">
      <section className={`solicitud-heroe solicitud-heroe-${siguiente.tono}`} aria-label="Resumen de la solicitud">
        <div className="solicitud-identidad">
          <button type="button" className="volver-contexto" onClick={() => navegar(-1)}>← Volver</button>
          <span className="sobre-titulo">SOLICITUD DE COMPRA</span>
          <div className="acciones-fila solicitud-titulo"><h1>{s.numero}</h1><InsigniaSolicitud estado={s.estado} /></div>
          <div className="solicitud-etiquetas">
            {s.es_extraordinaria ? <span className="insignia insignia-extra">Extraordinaria</span> : null}
            {s.flujo === 'anterior' ? <span className="insignia-suave">Flujo anterior</span> : null}
            {s.origen === 'importacion_csv' ? <span className="insignia-suave">Registro histórico</span> : null}
          </div>
        </div>
        <div className="siguiente-paso">
          <span className="siguiente-paso-icono" aria-hidden="true">{siguiente.icono}</span>
          <div><span className="sobre-titulo">{siguiente.etiqueta}</span><h2>{siguiente.titulo}</h2><p>{siguiente.descripcion}</p></div>
          {esDueno && editable && articulosActivos === 0 ? <button type="button" className="boton-primario" onClick={() => { setErroresArt({}); setErrorArt(null); setModalArt({ ...ARTICULO_VACIO }); }}>Agregar primer artículo</button> : null}
          {esDueno && editable && articulosActivos > 0 ? <button type="button" className="boton-primario" onClick={() => void enviar()} disabled={enviando || !!estimacion?.problema}>{enviando ? 'Enviando…' : s.estado === 'borrador' ? 'Enviar a mi jefe' : 'Reenviar a mi jefe'}</button> : null}
        </div>
      </section>
      <LineaRecorrido estado={s.estado} resumen={s.resumen_etapas} />

      {s.estado === 'en_correccion' ? (
        <div className="mensaje mensaje-error">
          <b>Devuelta para corrección.</b> Motivo: {s.ultimo_motivo_devolucion ?? s.ultimo_motivo_jefe ?? 'sin motivo registrado'}.
          {esDueno ? ' Ajusta lo necesario y usa “Reenviar a aprobación”: pasará otra vez por tu jefe y se conserva la versión anterior.' : ''}
        </div>
      ) : null}
      {s.estado === 'rechazada' ? (
        <div className="mensaje mensaje-error"><b>Rechazada.</b> Motivo: {s.ultimo_motivo_jefe ?? 'sin motivo registrado'}.</div>
      ) : null}
      {devPendiente ? (
        <div className="mensaje mensaje-error">
          Hay una petición de devolución pendiente ({fmtFechaHora(devPendiente.creado_en)}): “{devPendiente.motivo}”.
          La debe autorizar {['pendiente_aprobacion', 'programada'].includes(s.estado) ? 'el aprobador' : 'Compras'}.
        </div>
      ) : null}

      <div className="tarjeta">
        <div className="fechas">
          <div><b>Área · centro de costo</b>{s.area_nombre} · {s.centro_costo_codigo} {s.centro_costo_nombre}</div>
          <div><b>Solicitante</b>{s.solicitante_nombre}</div>
          <div><b>Aprobador asignado</b>{s.aprobador_jefe_nombre ?? (s.flujo === 'anterior' ? 'No aplicó (flujo anterior)' : 'Se asigna al enviar')}</div>
          {s.categoria_nombre ? <div><b>Categoría</b>{s.categoria_nombre}</div> : null}
          <div><b>Creación real</b>{fmtFechaHora(s.creado_en)}</div>
          <div><b>Envío a aprobación</b>{s.flujo === 'anterior' ? `${fmtFechaHora(s.enviado_en)} (directo a Compras)` : s.ultimo_envio_en ? fmtFechaHora(s.ultimo_envio_en) : 'aún no enviada'}
            {s.enviado_en && s.ultimo_envio_en && s.enviado_en !== s.ultimo_envio_en ? <span className="texto-suave"> · primer envío {fmtFechaHora(s.enviado_en)}</span> : null}</div>
          <div><b>Aprobación</b>{s.aprobado_en ? fmtFechaHora(s.aprobado_en) : 'sin información'}</div>
          <div><b>Semana objetivo</b>{etiquetaSemana(s.semana_lunes)}</div>
          <div><b>Recepción programada</b>{s.fecha_programada_recepcion ? fmtFecha(s.fecha_programada_recepcion) : 'sin información'}
            {s.cierre_ciclo_en && s.estado === 'programada' ? <span className="texto-suave"> · cierre {fmtFechaHora(s.cierre_ciclo_en)}</span> : null}</div>
          <div><b>Recepción efectiva por Compras</b>{s.recibida_compras_en ? fmtFechaHora(s.recibida_compras_en) : 'sin información'}</div>
          <div><b>Fecha requerida (más próxima)</b>{s.fecha_requerida_min ? fmtFecha(s.fecha_requerida_min) : 'sin información'}</div>
        </div>
        {s.justificacion ? <p>Justificación: {s.justificacion}</p> : null}
        {s.es_extraordinaria && s.motivo_extraordinaria ? <p>Motivo de la emergencia: {s.motivo_extraordinaria}</p> : null}
      </div>

      {/* ---------- Acciones del solicitante (con resultado junto a ellas) ---------- */}
      {esDueno ? (
        <section className="tarjeta zona-accion-solicitud">
          <div className="zona-accion-cabecera"><div><span className="sobre-titulo">TU LISTA DE PASOS</span><h2>{editable ? 'Completa la solicitud sin perderte' : 'Acciones disponibles'}</h2></div>{editable ? <span className="insignia-suave">{articulosActivos} artículo{articulosActivos === 1 ? '' : 's'} agregado{articulosActivos === 1 ? '' : 's'}</span> : null}</div>
          {editable ? <ol className="checklist-solicitud" aria-label="Pasos del borrador">
            <li className={articulosActivos > 0 ? 'completo' : 'actual'}><span>{articulosActivos > 0 ? '✓' : '1'}</span><div><b>Agrega los artículos</b><small>{articulosActivos > 0 ? 'Ya puedes revisarlos o agregar más.' : 'Indica nombre, características y cantidad.'}</small></div></li>
            <li className={articulosActivos > 0 ? 'actual' : ''}><span>2</span><div><b>Revísalos con calma</b><small>Antes de enviarla puedes editar, eliminar o adjuntar referencias.</small></div></li>
            <li className={articulosActivos > 0 && !estimacion?.problema ? 'actual' : ''}><span>3</span><div><b>Envíala a aprobación</b><small>Tu jefe la verá primero; Compras continúa después.</small></div></li>
          </ol> : null}
          <div className="acciones-fila">
            {editable ? (
              <>
                <button type="button" className="boton-secundario" onClick={() => { setErroresArt({}); setErrorArt(null); setModalArt({ ...ARTICULO_VACIO }); }}>
                  + Agregar artículo
                </button>
                <button type="button" className="boton-primario" onClick={() => void enviar()}
                  disabled={enviando || articulos.filter((a) => a.etapa !== 'cancelado').length === 0 || !!estimacion?.problema}>
                  {enviando ? 'Enviando…' : s.estado === 'borrador' ? 'Enviar a aprobación' : 'Reenviar a aprobación'}
                </button>
                <button type="button" className="boton-secundario" onClick={() => setModalSemana({ semana: s.semana_lunes, motivo: '' })}>
                  Cambiar semana objetivo
                </button>
                <BotonConMotivo etiqueta="Cancelar solicitud" clase="boton-peligro" titulo="Cancelar solicitud"
                  descripcion="Se cancelan todos sus artículos. Queda registrado."
                  onConfirmar={async (motivo) => {
                    await rpc('fn_cancelar_solicitud', { p_solicitud: s.id, p_motivo: motivo, p_version: s.version });
                    await cargar();
                  }} />
              </>
            ) : null}
            {!editable && puedePedirDevolucion(s.estado, hayComprados) && !devPendiente ? (
              <BotonConMotivo etiqueta="Pedir devolución para corregir" titulo="Pedir devolución"
                descripcion={`Lo enviado no se cambia en silencio: ${['pendiente_aprobacion', 'programada'].includes(s.estado) ? 'tu aprobador' : 'Compras'} debe autorizar la devolución. Explica qué necesitas corregir.`}
                onConfirmar={async (motivo) => {
                  await rpc('fn_solicitar_devolucion', { p_solicitud: s.id, p_motivo: motivo, p_op: nuevoOp() });
                  await cargar();
                }} />
            ) : null}
            {!editable && hayComprados ? (
              <span className="texto-suave">Hay artículos comprados: para cambios usa “Reportar novedad” en el artículo.</span>
            ) : null}
            <button type="button" className="boton-secundario" onClick={() => void cargar()}>Actualizar</button>
          </div>
          {editable && estimacion ? (
            estimacion.problema ? (
              <p className="mensaje mensaje-error resultado-accion">No se puede enviar todavía: {estimacion.problema}</p>
            ) : (
              <p className="texto-suave resultado-accion">
                Al enviar, la recibirá <b>{estimacion.aprobador}</b>{estimacion.ruta === 'ruta_superior' ? ' (ruta superior, porque eres el jefe del área)' : ''}.
                {estimacion.origen === 'ciclo_semanal' || estimacion.origen === 'ventana_categoria'
                  ? <> Si la aprueba antes del {fmtFechaHora(estimacion.cierre)}, Compras la recibirá el <b>{fmtFecha(estimacion.recepcion_prevista)}</b>.</>
                  : estimacion.origen === 'extraordinaria' ? ' Extraordinaria: pasa a Compras al aprobarse.' : ' Pasa a Compras al aprobarse.'}
                {estimacion.nota ? ` ${estimacion.nota}` : ''}
              </p>
            )
          ) : null}
          {resultado ? (resultado.ok
            ? <MensajeExito texto={resultado.texto} />
            : <MensajeError texto={resultado.texto} />) : null}
          <MensajeError texto={error} flotante />
        </section>
      ) : (
        <>
          {resultado ? (resultado.ok ? <MensajeExito texto={resultado.texto} flotante /> : <MensajeError texto={resultado.texto} flotante />) : null}
          <MensajeError texto={error} flotante />
        </>
      )}

      {entregasSinConfirmar.length > 0 ? (
        <div className="tarjeta">
          <h2>Entregas por confirmar</h2>
          {entregasSinConfirmar.map((m) => {
            const art = articulos.find((a) => a.id === m.articulo_id);
            return (
              <p key={m.id} className="acciones-fila">
                {fmtFecha(m.fecha_efectiva)} · {fmtCantidad(m.cantidad)} × {art?.nombre ?? 'artículo'} (recibe: {m.contraparte ?? '—'})
                <button type="button" className="boton-primario"
                  onClick={() => void accion(() => rpc('fn_confirmar_entrega', { p_movimiento: m.id }), 'Entrega confirmada.')}>
                  Confirmar recibido
                </button>
              </p>
            );
          })}
        </div>
      ) : null}

      <h2>Artículos ({articulos.length})</h2>
      {articulos.map((a) => (
        <div className="tarjeta" key={a.id}>
          <div className="acciones-fila">
            <h3 style={{ margin: 0 }}>{a.nombre}</h3>
            {a.etapa !== 'borrador' ? <InsigniaEtapa etapa={a.etapa} /> : null}
            {a.requiere_aprobacion ? <InsigniaAprobacion estado={a.estado_aprobacion} /> : null}
            {a.novedades_abiertas > 0 ? <span className="insignia aprobacion-pendiente">{a.novedades_abiertas} novedad(es) abierta(s)</span> : null}
            {(a.dias_atraso ?? 0) > 0 ? <span className="atraso">Atraso: {a.dias_atraso} día(s)</span> : null}
          </div>
          <p>Cantidad: <b>{fmtCantidad(a.cantidad)} {a.unidad}</b> · Prioridad: {a.prioridad}
            {a.fecha_requerida ? <> · Requerido para {fmtFecha(a.fecha_requerida)}</> : null}</p>
          <p className="texto-suave">Especificaciones: {a.descripcion}</p>
          {a.enlace_referencia ? <p>Enlace de compra/referencia: <a href={a.enlace_referencia} target="_blank" rel="noopener noreferrer">{a.enlace_referencia}</a></p> : null}
          {a.proveedor_sugerido ? <p className="texto-suave">Proveedor sugerido: {a.proveedor_sugerido}</p> : null}
          {a.justificacion ? <p className="texto-suave">Justificación: {a.justificacion}</p> : null}
          {a.estatus_historico ? <p className="texto-suave">Estado histórico declarado: “{a.estatus_historico}”</p> : null}
          {a.compra_id ? (
            <p>Comprado: {fmtCantidad(a.cantidad_comprada)} a {a.proveedor_nombre} · {fmtMoneda(a.precio_unitario, a.moneda ?? 'COP')} c/u ·
              total {fmtMoneda(a.total, a.moneda ?? 'COP')} ({fmtFecha(a.fecha_compra)}) · Llegada estimada: {a.fecha_estimada_llegada ? fmtFecha(a.fecha_estimada_llegada) : 'sin información'}</p>
          ) : null}
          {(a.recibido_neto ?? 0) > 0 || (a.entregado_neto ?? 0) > 0 ? (
            <p>Recibido neto {fmtCantidad(a.recibido_neto)} · En almacén {fmtCantidad(a.disponible_almacen)} · Entregado {fmtCantidad(a.entregado_neto)} · Pendiente por llegar {fmtCantidad(a.pendiente_llegada)}</p>
          ) : null}
          <div className="acciones-fila">
            {editable && ['borrador', 'solicitado', 'en_cotizacion'].includes(a.etapa) ? (
              <button type="button" className="boton-secundario" onClick={() => {
                setErroresArt({}); setErrorArt(null);
                setModalArt({
                  id: a.id, version: a.version, nombre: a.nombre, descripcion: a.descripcion ?? '',
                  cantidad: String(a.cantidad), unidad: a.unidad, prioridad: a.prioridad,
                  fecha_requerida: a.fecha_requerida ?? '', justificacion: a.justificacion ?? '',
                  enlace_referencia: a.enlace_referencia ?? '', proveedor_sugerido: a.proveedor_sugerido ?? ''
                });
              }}>Editar</button>
            ) : null}
            {editable && s.estado === 'borrador' && a.etapa === 'borrador' ? (
              <button type="button" className="boton-peligro" onClick={() => void eliminarArticulo(a)}>Eliminar</button>
            ) : null}
            {esDueno && !['borrador', 'cancelado'].includes(a.etapa) ? (
              <button type="button" className="boton-secundario" onClick={() => { setErrorArt(null); setModalNovedad({ articuloId: a.id, tipo: 'entrega_incorrecta', descripcion: '' }); }}>
                Reportar novedad
              </button>
            ) : null}
            {(permisos.gestor || permisos.almacen || permisos.consultaGlobal) && s.recibida_compras_en ? (
              <Link to={`/gestion/articulo/${a.id}`}>Abrir en gestión →</Link>
            ) : null}
          </div>
          <Adjuntos entidad="articulo" entidadId={a.id}
            puedeSubir={(editable && a.etapa !== 'cancelado') || ((permisos.gestor || permisos.almacen) && !!s.recibida_compras_en && !['cerrado', 'cancelado'].includes(a.etapa))} />
          {novedades.filter((n) => n.articulo_id === a.id).length > 0 ? (
            <>
              <h4>Novedades</h4>
              <ul>
                {novedades.filter((n) => n.articulo_id === a.id).map((n) => (
                  <li key={n.id}>
                    <b>{ETIQUETA_NOVEDAD[n.tipo]}</b> · {n.estado === 'resuelta' ? 'Resuelta' : n.estado === 'en_atencion' ? 'En atención' : 'Abierta'}
                    {' — '}{n.descripcion}
                    {n.resolucion ? <> · <i>Resolución: {n.resolucion}</i></> : null}
                    <span className="texto-suave"> ({fmtFechaHora(n.creado_en)})</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {entregas.filter((m) => m.articulo_id === a.id).length > 0 ? (
            <>
              <h4>Entregas</h4>
              <ul>
                {entregas.filter((m) => m.articulo_id === a.id).map((m) => (
                  <li key={m.id}>
                    {ETIQUETA_MOVIMIENTO[m.tipo]} · {fmtCantidad(m.cantidad)} · {fmtFecha(m.fecha_efectiva)} · recibe {m.contraparte ?? '—'}
                    {m.confirmado_por_solicitante ? ' · ✓ confirmada' : ' · sin confirmar'}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ))}
      {articulos.length === 0 ? <div className="tarjeta"><p>Aún no hay artículos. {editable ? 'Agrega el primero con “+ Agregar artículo”.' : ''}</p></div> : null}

      <div className="tarjeta">
        <h2>Historial</h2>
        <HistorialSolicitud solicitudId={s.id} refresco={refrescoHist} />
      </div>

      <p><button type="button" className="boton-secundario" onClick={() => navegar(-1)}>← Volver</button></p>

      {/* ---------- Formulario de artículo ---------- */}
      <Modal titulo={modalArt?.id ? 'Editar artículo' : 'Agregar artículo'} abierto={!!modalArt} alCerrar={() => setModalArt(null)}>
        {modalArt ? (
          <Formulario className="formulario" onSubmit={guardarArticulo} noValidate>
            <p className="leyenda-campos"><span className="marca-obligatorio">* obligatorio</span> · los demás son opcionales.</p>
            <Campo etiqueta="Nombre del artículo" requerido error={erroresArt.nombre}>
              <input value={modalArt.nombre} maxLength={300} onChange={(e) => setModalArt({ ...modalArt, nombre: e.target.value })} />
            </Campo>
            <Campo etiqueta="Especificaciones (medidas, material, color y demás características)" requerido error={erroresArt.descripcion}
              ayuda="Describe el artículo aunque tengas un enlace: el enlace va en su propio campo.">
              <textarea rows={3} value={modalArt.descripcion} onChange={(e) => setModalArt({ ...modalArt, descripcion: e.target.value })} />
            </Campo>
            <div className="fila-campos">
              <Campo etiqueta="Cantidad" requerido error={erroresArt.cantidad}>
                <input inputMode="decimal" value={modalArt.cantidad} onChange={(e) => setModalArt({ ...modalArt, cantidad: e.target.value })} />
              </Campo>
              <Campo etiqueta="Unidad de medida" requerido error={erroresArt.unidad}>
                <select value={modalArt.unidad} onChange={(e) => setModalArt({ ...modalArt, unidad: e.target.value })}>
                  {!unidadesActivas.some((u) => u.toLowerCase() === modalArt.unidad.toLowerCase())
                    ? <option value={modalArt.unidad}>{modalArt.unidad || '— Selecciona —'}</option> : null}
                  {(cat?.unidades ?? []).map((u) => <option key={u.id} value={u.nombre}>{u.nombre}{u.abreviatura ? ` (${u.abreviatura})` : ''}</option>)}
                </select>
              </Campo>
              <Campo etiqueta="Prioridad propuesta" requerido>
                <select value={modalArt.prioridad} onChange={(e) => setModalArt({ ...modalArt, prioridad: e.target.value })}>
                  <option value="baja">Baja</option>
                  <option value="media">Media</option>
                  <option value="alta">Alta</option>
                </select>
              </Campo>
              <Campo etiqueta="Fecha requerida" opcional error={erroresArt.fecha_requerida}>
                <input type="date" value={modalArt.fecha_requerida} onChange={(e) => setModalArt({ ...modalArt, fecha_requerida: e.target.value })} />
              </Campo>
            </div>
            <Campo etiqueta="Justificación" opcional>
              <textarea rows={2} value={modalArt.justificacion} onChange={(e) => setModalArt({ ...modalArt, justificacion: e.target.value })} />
            </Campo>
            <Campo etiqueta="Enlace de compra o referencia" opcional error={erroresArt.enlace_referencia} ayuda="Ej.: https://… (no reemplaza las especificaciones).">
              <input type="url" value={modalArt.enlace_referencia} onChange={(e) => setModalArt({ ...modalArt, enlace_referencia: e.target.value })} />
            </Campo>
            <Campo etiqueta="Proveedor sugerido" opcional error={erroresArt.proveedor_sugerido} ayuda="Si no lo sabes, déjalo vacío; Compras lo define.">
              <input value={modalArt.proveedor_sugerido} onChange={(e) => setModalArt({ ...modalArt, proveedor_sugerido: e.target.value })} />
            </Campo>
            <p className="texto-suave">Las fotos y fichas técnicas se adjuntan desde la tarjeta del artículo, después de guardarlo.</p>
            <MensajeError texto={errorArt} />
            <div className="modal-acciones">
              <button type="button" className="boton-secundario" onClick={() => setModalArt(null)}>Cancelar</button>
              <button type="submit" className="boton-primario">Guardar en el borrador</button>
            </div>
          </Formulario>
        ) : null}
      </Modal>

      <Modal titulo="Cambiar semana objetivo" abierto={!!modalSemana} alCerrar={() => setModalSemana(null)}>
        {modalSemana ? (
          <Formulario className="formulario" onSubmit={async (e) => {
            e.preventDefault();
            if (modalSemana.motivo.trim().length < 3) { setErrorArt('Indica el motivo del cambio.'); return; }
            setErrorArt(null);
            try {
              await rpc('fn_reprogramar_semana', { p_solicitud: s.id, p_semana: modalSemana.semana, p_motivo: modalSemana.motivo.trim(), p_version: s.version });
              setModalSemana(null);
              setResultado({ ok: true, texto: `Semana objetivo cambiada a ${etiquetaSemana(modalSemana.semana)}.` });
              await cargar();
            } catch (err) { setErrorArt(err instanceof Error ? err.message : String(err)); }
          }}>
            <CalendarioSemanas valor={modalSemana.semana} alCambiar={(v) => setModalSemana({ ...modalSemana, semana: v })}
              categoria={s.categoria_id} extraordinaria={s.es_extraordinaria} />
            <Campo etiqueta="Motivo del cambio" requerido>
              <input value={modalSemana.motivo} onChange={(e) => setModalSemana({ ...modalSemana, motivo: e.target.value })} />
            </Campo>
            <MensajeError texto={errorArt} />
            <div className="modal-acciones">
              <button type="button" className="boton-secundario" onClick={() => setModalSemana(null)}>Cancelar</button>
              <button type="submit" className="boton-primario">Guardar semana</button>
            </div>
          </Formulario>
        ) : null}
      </Modal>

      <Modal titulo="Reportar novedad" abierto={!!modalNovedad} alCerrar={() => setModalNovedad(null)}>
        {modalNovedad ? (
          <Formulario className="formulario" onSubmit={crearNovedad}>
            <Campo etiqueta="Tipo de novedad" requerido>
              <select value={modalNovedad.tipo} onChange={(e) => setModalNovedad({ ...modalNovedad, tipo: e.target.value as TipoNovedad })}>
                <option value="entrega_incorrecta">Entrega incorrecta</option>
                <option value="producto_mal_solicitado">Producto mal solicitado</option>
                <option value="datos_incompletos">Datos incompletos</option>
                <option value="observacion">Observación general</option>
              </select>
            </Campo>
            <Campo etiqueta="Descripción" requerido>
              <textarea rows={3} value={modalNovedad.descripcion} onChange={(e) => setModalNovedad({ ...modalNovedad, descripcion: e.target.value })} />
            </Campo>
            <p className="texto-suave">Si el artículo ya se compró, la corrección se registra como novedad posterior a la compra; el historial original no se modifica.</p>
            <MensajeError texto={errorArt} />
            <div className="modal-acciones">
              <button type="button" className="boton-secundario" onClick={() => setModalNovedad(null)}>Cancelar</button>
              <button type="submit" className="boton-primario">Registrar novedad</button>
            </div>
          </Formulario>
        ) : null}
      </Modal>
    </div>
  );
}
