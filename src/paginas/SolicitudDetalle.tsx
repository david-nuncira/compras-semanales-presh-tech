import { useCallback, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase, rpc, limpiarError, nuevoOp } from '../supabase.ts';
import { useSesion } from '../contexto/Sesion.tsx';
import { useCatalogos, useActualizacionPeriodica } from '../datos.ts';
import type { VSolicitud, VArticulo, Movimiento, Novedad, TipoNovedad } from '../tipos.ts';
import {
  ETIQUETA_ESTADO_SOLICITUD, ETIQUETA_MOVIMIENTO, ETIQUETA_NOVEDAD
} from '../tipos.ts';
import {
  Campo, MensajeError, MensajeExito, Cargando, Modal,
  InsigniaEtapa, InsigniaAprobacion, BotonConMotivo
} from '../componentes/UI.tsx';
import { Adjuntos } from '../componentes/Adjuntos.tsx';
import { etiquetaSemana, fmtFecha, fmtFechaHora, lunesDeSemana } from '../util/fechas.ts';
import { fmtMoneda, fmtCantidad, parseNumero } from '../util/moneda.ts';

interface FormArticulo {
  id?: string; version?: number;
  nombre: string; descripcion: string; cantidad: string; unidad: string;
  prioridad: 'baja' | 'media' | 'alta'; fecha_requerida: string; justificacion: string;
}

const ARTICULO_VACIO: FormArticulo = {
  nombre: '', descripcion: '', cantidad: '1', unidad: 'unidad',
  prioridad: 'media', fecha_requerida: '', justificacion: ''
};

export function SolicitudDetalle() {
  const { id } = useParams<{ id: string }>();
  const navegar = useNavigate();
  const { perfil, tiene } = useSesion();
  const { cat } = useCatalogos();

  const [sol, setSol] = useState<VSolicitud | null>(null);
  const [articulos, setArticulos] = useState<VArticulo[]>([]);
  const [entregas, setEntregas] = useState<Movimiento[]>([]);
  const [novedades, setNovedades] = useState<Novedad[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [noEncontrada, setNoEncontrada] = useState(false);

  const [modalArt, setModalArt] = useState<FormArticulo | null>(null);
  const [errorArt, setErrorArt] = useState<string | null>(null);
  const [modalNovedad, setModalNovedad] = useState<{ articuloId: string; tipo: TipoNovedad; descripcion: string } | null>(null);

  const esDueno = !!sol && !!perfil && sol.solicitante_id === perfil.id;
  const editable = esDueno && (sol?.estado === 'borrador' || sol?.estado === 'en_correccion');

  const cargar = useCallback(async () => {
    if (!id) return;
    const [rs, ra] = await Promise.all([
      supabase.from('v_solicitudes').select('*').eq('id', id).maybeSingle(),
      supabase.from('v_articulos').select('*').eq('solicitud_id', id).order('creado_en')
    ]);
    if (rs.error) { setError(limpiarError(rs.error.message)); return; }
    if (!rs.data) { setNoEncontrada(true); return; }
    setSol(rs.data as VSolicitud);
    const arts = (ra.data ?? []) as VArticulo[];
    setArticulos(arts);
    if (arts.length > 0) {
      const ids = arts.map((a) => a.id);
      const [rm, rn] = await Promise.all([
        supabase.from('movimientos').select('*').in('articulo_id', ids)
          .eq('tipo', 'entrega').eq('anulado', false).order('creado_en', { ascending: false }),
        supabase.from('novedades').select('*').in('articulo_id', ids).order('creado_en', { ascending: false })
      ]);
      setEntregas((rm.data ?? []) as Movimiento[]);
      setNovedades((rn.data ?? []) as Novedad[]);
    } else {
      setEntregas([]); setNovedades([]);
    }
  }, [id]);

  useActualizacionPeriodica(cargar, 60000, [cargar]);

  if (noEncontrada) {
    return <div className="contenido"><div className="tarjeta">
      <h2>Solicitud no encontrada</h2>
      <p>No existe o tu cuenta no tiene permiso para verla.</p>
    </div></div>;
  }
  if (!sol) return <div className="contenido"><Cargando /></div>;

  async function guardarArticulo(e: React.FormEvent) {
    e.preventDefault();
    if (!modalArt || !sol) return;
    setErrorArt(null);
    const cantidad = parseNumero(modalArt.cantidad);
    if (modalArt.nombre.trim().length < 2) { setErrorArt('Escribe el nombre del artículo.'); return; }
    if (modalArt.descripcion.trim().length < 3) { setErrorArt('Describe medidas, color, material o especificaciones.'); return; }
    if (cantidad === null || cantidad <= 0) { setErrorArt('Cantidad inválida.'); return; }
    try {
      if (modalArt.id) {
        const { data, error: e1 } = await supabase.from('articulos').update({
          nombre: modalArt.nombre.trim(),
          descripcion: modalArt.descripcion.trim(),
          cantidad,
          unidad: modalArt.unidad.trim() || 'unidad',
          prioridad: modalArt.prioridad,
          fecha_requerida: modalArt.fecha_requerida || null,
          justificacion: modalArt.justificacion.trim() || null
        }).eq('id', modalArt.id).eq('version', modalArt.version ?? 0).select('id');
        if (e1) throw new Error(limpiarError(e1.message));
        if (!data || data.length === 0) throw new Error('El artículo fue modificado por otra persona; recarga e intenta de nuevo.');
      } else {
        const { error: e2 } = await supabase.from('articulos').insert({
          solicitud_id: sol.id,
          nombre: modalArt.nombre.trim(),
          descripcion: modalArt.descripcion.trim(),
          cantidad,
          unidad: modalArt.unidad.trim() || 'unidad',
          prioridad: modalArt.prioridad,
          fecha_requerida: modalArt.fecha_requerida || null,
          justificacion: modalArt.justificacion.trim() || null
        });
        if (e2) throw new Error(limpiarError(e2.message));
      }
      setModalArt(null);
      await cargar();
    } catch (err) {
      setErrorArt(err instanceof Error ? err.message : String(err));
    }
  }

  async function eliminarArticulo(a: VArticulo) {
    if (!window.confirm(`¿Eliminar el artículo "${a.nombre}" del borrador?`)) return;
    const { error: e1 } = await supabase.from('articulos').delete().eq('id', a.id);
    if (e1) setError(limpiarError(e1.message)); else await cargar();
  }

  async function enviar() {
    if (!sol) return;
    setError(null); setExito(null);
    try {
      const r = sol.estado === 'borrador'
        ? await rpc<{ ok: boolean; numero: string }>('fn_enviar_solicitud', { p_solicitud: sol.id, p_version: sol.version, p_op: nuevoOp() })
        : await rpc<{ ok: boolean }>('fn_reenviar_solicitud', { p_solicitud: sol.id, p_comentario: 'Corrección atendida por el solicitante', p_op: nuevoOp() });
      void r;
      setExito(sol.estado === 'borrador' ? 'Solicitud enviada a Compras.' : 'Solicitud reenviada tras la corrección.');
      await cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function crearNovedad(e: React.FormEvent) {
    e.preventDefault();
    if (!modalNovedad) return;
    setError(null);
    try {
      if (modalNovedad.descripcion.trim().length < 5) throw new Error('Describe la novedad (mínimo 5 caracteres).');
      const { error: e1 } = await supabase.from('novedades').insert({
        articulo_id: modalNovedad.articuloId,
        tipo: modalNovedad.tipo,
        descripcion: modalNovedad.descripcion.trim()
      });
      if (e1) throw new Error(limpiarError(e1.message));
      setModalNovedad(null);
      setExito('Novedad registrada; Compras la atenderá.');
      await cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const entregasSinConfirmar = entregas.filter((m) => esDueno && !m.confirmado_por_solicitante);

  return (
    <div className="contenido">
      <div className="acciones-fila">
        <h1>{sol.numero}</h1>
        <span className="insignia-suave">{ETIQUETA_ESTADO_SOLICITUD[sol.estado]}</span>
        {sol.origen === 'importacion_csv' ? <span className="insignia-suave">Origen: histórico CSV</span> : null}
      </div>
      <p className="texto-suave">
        {sol.area_nombre} · {sol.centro_costo_codigo} {sol.centro_costo_nombre} · {etiquetaSemana(sol.semana_lunes)}
        {' · '}creada {fmtFechaHora(sol.creado_en)} por {sol.solicitante_nombre}
        {sol.fecha_declarada ? ` · fecha declarada ${fmtFecha(sol.fecha_declarada)}` : ''}
      </p>
      {sol.justificacion ? <p>Justificación: {sol.justificacion}</p> : null}
      <MensajeError texto={error} />
      <MensajeExito texto={exito} />

      {sol.estado === 'en_correccion' && esDueno ? (
        <div className="mensaje mensaje-error">
          Compras devolvió esta solicitud para corrección. Revisa el historial de cada
          artículo, ajusta lo necesario y usa “Reenviar solicitud”.
        </div>
      ) : null}

      <div className="acciones-fila" style={{ margin: '0.6rem 0' }}>
        {editable ? (
          <>
            <button type="button" className="boton-primario" onClick={() => { setModalArt({ ...ARTICULO_VACIO }); setErrorArt(null); }}>
              + Agregar artículo
            </button>
            <button type="button" className="boton-primario" onClick={() => void enviar()} disabled={articulos.length === 0}>
              {sol.estado === 'borrador' ? 'Enviar solicitud' : 'Reenviar solicitud'}
            </button>
          </>
        ) : null}
        {esDueno && sol.estado !== 'cancelada' ? (
          <BotonConMotivo etiqueta="Reprogramar semana" titulo="Reprogramar semana objetivo"
            descripcion={`Semana actual: ${etiquetaSemana(sol.semana_lunes)}. Indica la nueva semana en el motivo con el formato AAAA-MM-DD (cualquier día de esa semana) y la razón.`}
            onConfirmar={async (motivo) => {
              const fecha = motivo.match(/\d{4}-\d{2}-\d{2}/)?.[0];
              if (!fecha) throw new Error('Incluye la nueva fecha (AAAA-MM-DD) dentro del motivo.');
              await rpc('fn_reprogramar_semana', {
                p_solicitud: sol.id, p_semana: lunesDeSemana(fecha), p_motivo: motivo, p_version: sol.version
              });
              await cargar();
            }} />
        ) : null}
        {esDueno && (sol.estado === 'borrador' || sol.estado === 'enviada') ? (
          <BotonConMotivo etiqueta="Cancelar solicitud" clase="boton-peligro" titulo="Cancelar solicitud"
            descripcion="Se cancelarán todos sus artículos. Esta acción queda registrada."
            onConfirmar={async (motivo) => {
              await rpc('fn_cancelar_solicitud', { p_solicitud: sol.id, p_motivo: motivo, p_version: sol.version });
              await cargar();
            }} />
        ) : null}
        <button type="button" className="boton-secundario" onClick={() => void cargar()}>Actualizar</button>
      </div>

      {entregasSinConfirmar.length > 0 ? (
        <div className="tarjeta">
          <h2>Entregas por confirmar</h2>
          {entregasSinConfirmar.map((m) => {
            const art = articulos.find((a) => a.id === m.articulo_id);
            return (
              <p key={m.id} className="acciones-fila">
                {fmtFecha(m.fecha_efectiva)} · {fmtCantidad(m.cantidad)} × {art?.nombre ?? 'artículo'} (recibe: {m.contraparte ?? '—'})
                <button type="button" className="boton-primario" onClick={async () => {
                  try { await rpc('fn_confirmar_entrega', { p_movimiento: m.id }); await cargar(); }
                  catch (err) { setError(err instanceof Error ? err.message : String(err)); }
                }}>Confirmar recibido</button>
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
            <InsigniaEtapa etapa={a.etapa} />
            <InsigniaAprobacion estado={a.estado_aprobacion} />
            {a.novedades_abiertas > 0 ? <span className="insignia aprobacion-pendiente">{a.novedades_abiertas} novedad(es) abierta(s)</span> : null}
            {(a.dias_atraso ?? 0) > 0 ? <span className="atraso">Atraso: {a.dias_atraso} día(s)</span> : null}
          </div>
          <p>
            Cantidad solicitada: <b>{fmtCantidad(a.cantidad)} {a.unidad}</b> · Prioridad: {a.prioridad}
            {a.fecha_requerida ? <> · Requerido para {fmtFecha(a.fecha_requerida)}</> : null}
          </p>
          <p className="texto-suave">{a.descripcion}</p>
          {a.justificacion ? <p className="texto-suave">Justificación: {a.justificacion}</p> : null}
          {a.estatus_historico ? <p className="texto-suave">Estado histórico declarado: “{a.estatus_historico}”</p> : null}

          {a.compra_id ? (
            <p>
              Comprado: {fmtCantidad(a.cantidad_comprada)} a {a.proveedor_nombre} ·
              {' '}{fmtMoneda(a.precio_unitario, a.moneda ?? 'COP')} c/u · total {fmtMoneda(a.total, a.moneda ?? 'COP')}
              {' '}({fmtFecha(a.fecha_compra)}) ·
              {' '}Estimada de llegada: {a.fecha_estimada_llegada ? fmtFecha(a.fecha_estimada_llegada) : 'sin información'}
            </p>
          ) : null}
          {(a.recibido_neto ?? 0) > 0 || (a.entregado_neto ?? 0) > 0 ? (
            <p>
              Recibido neto {fmtCantidad(a.recibido_neto)} · En almacén {fmtCantidad(a.disponible_almacen)} ·
              Entregado {fmtCantidad(a.entregado_neto)} · Pendiente por llegar {fmtCantidad(a.pendiente_llegada)}
            </p>
          ) : null}

          <div className="acciones-fila">
            {editable && ['borrador', 'solicitado', 'en_cotizacion'].includes(a.etapa) ? (
              <button type="button" className="boton-secundario" onClick={() => {
                setErrorArt(null);
                setModalArt({
                  id: a.id, version: a.version, nombre: a.nombre,
                  descripcion: a.descripcion ?? '', cantidad: String(a.cantidad),
                  unidad: a.unidad, prioridad: a.prioridad,
                  fecha_requerida: a.fecha_requerida ?? '', justificacion: a.justificacion ?? ''
                });
              }}>Editar</button>
            ) : null}
            {editable && a.etapa === 'borrador' ? (
              <button type="button" className="boton-peligro" onClick={() => void eliminarArticulo(a)}>Eliminar</button>
            ) : null}
            {esDueno && a.etapa === 'solicitado' && sol.estado === 'enviada' ? (
              <BotonConMotivo etiqueta="Cancelar artículo" clase="boton-peligro" titulo={`Cancelar "${a.nombre}"`}
                onConfirmar={async (motivo) => {
                  await rpc('fn_cambiar_etapa', { p_articulo: a.id, p_hacia: 'cancelado', p_motivo: motivo, p_version: a.version });
                  await cargar();
                }} />
            ) : null}
            {esDueno && !['borrador', 'cancelado'].includes(a.etapa) ? (
              <button type="button" className="boton-secundario" onClick={() =>
                setModalNovedad({ articuloId: a.id, tipo: 'datos_incompletos', descripcion: '' })}>
                Reportar novedad
              </button>
            ) : null}
            {(tiene('compras') || tiene('administrador')) ? (
              <Link to={`/gestion/articulo/${a.id}`}>Abrir en gestión →</Link>
            ) : null}
          </div>

          <Adjuntos entidad="articulo" entidadId={a.id}
            puedeSubir={(esDueno && !['cerrado', 'cancelado'].includes(a.etapa)) || tiene('compras') || tiene('administrador')} />

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
                    {m.confirmado_por_solicitante ? ' · ✓ confirmada por el solicitante' : ' · sin confirmar'}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ))}

      {articulos.length === 0 ? (
        <div className="tarjeta"><p>Aún no hay artículos. {editable ? 'Agrega el primero.' : ''}</p></div>
      ) : null}

      <p><button type="button" className="boton-secundario" onClick={() => navegar(-1)}>← Volver</button></p>

      <Modal titulo={modalArt?.id ? 'Editar artículo' : 'Agregar artículo'} abierto={!!modalArt} alCerrar={() => setModalArt(null)}>
        {modalArt ? (
          <form className="formulario" onSubmit={guardarArticulo}>
            <Campo etiqueta="Nombre del artículo" requerido>
              <input value={modalArt.nombre} onChange={(e) => setModalArt({ ...modalArt, nombre: e.target.value })} maxLength={300} />
            </Campo>
            <Campo etiqueta="Descripción (medidas, color, material, especificaciones)" requerido>
              <textarea rows={3} value={modalArt.descripcion} onChange={(e) => setModalArt({ ...modalArt, descripcion: e.target.value })} />
            </Campo>
            <div className="fila-campos">
              <Campo etiqueta="Cantidad" requerido>
                <input inputMode="decimal" value={modalArt.cantidad} onChange={(e) => setModalArt({ ...modalArt, cantidad: e.target.value })} />
              </Campo>
              <Campo etiqueta="Unidad">
                <input value={modalArt.unidad} onChange={(e) => setModalArt({ ...modalArt, unidad: e.target.value })} placeholder="unidad, par, metro…" />
              </Campo>
              <Campo etiqueta="Prioridad propuesta">
                <select value={modalArt.prioridad} onChange={(e) => setModalArt({ ...modalArt, prioridad: e.target.value as FormArticulo['prioridad'] })}>
                  <option value="baja">Baja</option>
                  <option value="media">Media</option>
                  <option value="alta">Alta</option>
                </select>
              </Campo>
              <Campo etiqueta="Fecha requerida (si se conoce)">
                <input type="date" value={modalArt.fecha_requerida} onChange={(e) => setModalArt({ ...modalArt, fecha_requerida: e.target.value })} />
              </Campo>
            </div>
            <Campo etiqueta="Justificación del artículo">
              <textarea rows={2} value={modalArt.justificacion} onChange={(e) => setModalArt({ ...modalArt, justificacion: e.target.value })} />
            </Campo>
            <MensajeError texto={errorArt} />
            <div className="modal-acciones">
              <button type="button" className="boton-secundario" onClick={() => setModalArt(null)}>Cancelar</button>
              <button type="submit" className="boton-primario">Guardar</button>
            </div>
            {modalArt.id ? <p className="texto-suave">Los adjuntos se gestionan desde la tarjeta del artículo.</p> : null}
          </form>
        ) : null}
      </Modal>

      <Modal titulo="Reportar novedad" abierto={!!modalNovedad} alCerrar={() => setModalNovedad(null)}>
        {modalNovedad ? (
          <form className="formulario" onSubmit={crearNovedad}>
            <Campo etiqueta="Tipo de novedad" requerido>
              <select value={modalNovedad.tipo} onChange={(e) => setModalNovedad({ ...modalNovedad, tipo: e.target.value as TipoNovedad })}>
                <option value="datos_incompletos">Datos incompletos</option>
                <option value="producto_mal_solicitado">Producto mal solicitado</option>
                <option value="entrega_incorrecta">Entrega incorrecta</option>
                <option value="observacion">Observación general</option>
              </select>
            </Campo>
            <Campo etiqueta="Descripción" requerido>
              <textarea rows={3} value={modalNovedad.descripcion} onChange={(e) => setModalNovedad({ ...modalNovedad, descripcion: e.target.value })} />
            </Campo>
            <p className="texto-suave">Después de crearla podrás adjuntar evidencia desde la tarjeta del artículo (sección de novedades de Gestión) si eres de Compras, o pedirle a Compras que la adjunte.</p>
            <div className="modal-acciones">
              <button type="button" className="boton-secundario" onClick={() => setModalNovedad(null)}>Cancelar</button>
              <button type="submit" className="boton-primario">Registrar novedad</button>
            </div>
          </form>
        ) : null}
      </Modal>
    </div>
  );
}
