import { Formulario, EstadoError } from '../componentes/UI.tsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase, rpc, limpiarError, nuevoOp } from '../supabase.ts';
import { useSesion } from '../contexto/Sesion.tsx';
import { useCatalogos, useActualizacionPeriodica, listarAprobadores } from '../datos.ts';
import type { PerfilBreve } from '../datos.ts';
import type { VArticulo, Cotizacion, Aprobacion, Movimiento, Novedad, TipoMovimiento, TipoNovedad, Proveedor } from '../tipos.ts';
import { ETIQUETA_MOVIMIENTO, ETIQUETA_NOVEDAD } from '../tipos.ts';
import {
  Campo, MensajeError, MensajeExito, Cargando, Modal,
  InsigniaEtapa, InsigniaAprobacion, BotonConMotivo
} from '../componentes/UI.tsx';
import { Adjuntos } from '../componentes/Adjuntos.tsx';
import { etiquetaSemana, fmtFecha, fmtFechaHora, hoyBogotaISO } from '../util/fechas.ts';
import { fmtMoneda, fmtCantidad, parseNumero, redondear2 } from '../util/moneda.ts';

interface HistorialFila {
  creado_en: string; tabla: string; accion: string; actor_nombre: string;
  motivo: string | null; anterior: Record<string, unknown> | null; nuevo: Record<string, unknown> | null;
}

export function ArticuloGestion() {
  const { id } = useParams<{ id: string }>();
  const { tiene } = useSesion();
  const { cat, error: errorCatalogos, recargar: recargarCatalogos } = useCatalogos();
  const esGestor = tiene('compras') || tiene('administrador');
  const esAlmacen = tiene('almacen');

  const [a, setA] = useState<VArticulo | null>(null);
  const [cotizaciones, setCotizaciones] = useState<Cotizacion[]>([]);
  const [aprobaciones, setAprobaciones] = useState<Aprobacion[]>([]);
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [novedades, setNovedades] = useState<Novedad[]>([]);
  const [historial, setHistorial] = useState<HistorialFila[]>([]);
  const [fechasEstimadas, setFechasEstimadas] = useState<Array<{ fecha_estimada: string | null; motivo: string | null; creado_en: string }>>([]);
  const [aprobadores, setAprobadores] = useState<PerfilBreve[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [noEncontrado, setNoEncontrado] = useState(false);

  // modales
  const [mCot, setMCot] = useState<null | { id: string; proveedor: string; precio: string; cantidad: string; moneda: string; impuestos: string; descuentos: string; otros: string; notas: string }>(null);
  const [mDocumentos, setMDocumentos] = useState<Cotizacion | null>(null);
  const [docsOcupados, setDocsOcupados] = useState(false), [docsPendientes, setDocsPendientes] = useState(0);
  const [mDirecta, setMDirecta] = useState<null | { proveedor: string; precio: string; cantidad: string; impuestos: string; descuentos: string; otros: string; fecha: string; referencia: string; estimada: string; op: string }>(null);
  const bloqueo = useRef(false);
  const [mAprob, setMAprob] = useState<null | { requiere: boolean; aprobador: string }>(null);
  const [mCompra, setMCompra] = useState<null | { cantidad: string; fecha: string; impuestos: string; descuentos: string; otros: string; referencia: string; estimada: string }>(null);
  const [mEditCompra, setMEditCompra] = useState<null | { cantidad: string; precio: string; impuestos: string; descuentos: string; otros: string; referencia: string; motivo: string }>(null);
  const [mMov, setMMov] = useState<null | { tipo: TipoMovimiento | 'entrega_directa'; cantidad: string; fecha: string; contraparte: string; observacion: string; reposicion: boolean }>(null);
  const [mNov, setMNov] = useState<null | { tipo: TipoNovedad; descripcion: string }>(null);
  const [mError, setMError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    setError(null);
    try {
    if (!id) return;
    const r = await supabase.from('v_articulos').select('*').eq('id', id).maybeSingle();
    if (r.error) { setError(limpiarError(r.error.message)); return; }
    if (!r.data) { setNoEncontrado(true); return; }
    const art = r.data as VArticulo;
    setA(art); setNoEncontrado(false);
    const [rc, rap, rm, rn, rh] = await Promise.all([
      supabase.from('cotizaciones').select('*').eq('articulo_id', id).order('creado_en'),
      supabase.from('aprobaciones').select('*').eq('articulo_id', id).order('creado_en', { ascending: false }),
      supabase.from('movimientos').select('*').eq('articulo_id', id).order('creado_en', { ascending: false }),
      supabase.from('novedades').select('*').eq('articulo_id', id).order('creado_en', { ascending: false }),
      supabase.rpc('fn_historial_articulo', { p_articulo: id })
    ]);
    const fallo = [rc, rap, rm, rn, rh].find(res => res.error)?.error;
    if (fallo) throw new Error(limpiarError(fallo.message));
    setCotizaciones((rc.data ?? []) as Cotizacion[]);
    setAprobaciones((rap.data ?? []) as Aprobacion[]);
    setMovimientos((rm.data ?? []) as Movimiento[]);
    setNovedades((rn.data ?? []) as Novedad[]);
    setHistorial((rh.data ?? []) as HistorialFila[]);
    if (art.compra_id) {
      const rf = await supabase.from('compra_fechas_estimadas').select('fecha_estimada, motivo, creado_en')
        .eq('compra_id', art.compra_id).order('creado_en', { ascending: false });
      if (rf.error) throw new Error(limpiarError(rf.error.message));
      setFechasEstimadas((rf.data ?? []) as typeof fechasEstimadas);
    } else setFechasEstimadas([]);
    } catch (e) { setError(limpiarError(e instanceof Error ? e.message : String(e))); }
  }, [id]);

  useActualizacionPeriodica(cargar, 60000, [cargar]);
  useEffect(() => { listarAprobadores().then(setAprobadores).catch(() => {}); }, []);

  if (noEncontrado) {
    return <div className="contenido"><div className="tarjeta"><h2>Artículo no encontrado</h2>
      <p>No existe o tu cuenta no tiene permiso para verlo.</p></div></div>;
  }
  if (!a) return <div className="contenido"><MensajeError texto={error} />{error ? <EstadoError alReintentar={() => void cargar()} /> : <Cargando />}</div>;

  const cotSeleccionada = cotizaciones.find((c) => c.es_seleccionada) ?? null;
  const puedeGestionar = esGestor && a.en_bandeja_compras;
  const totalCot = (c: Cotizacion) => redondear2(redondear2(c.precio_unitario * c.cantidad) + Number(c.impuestos) + Number(c.otros_cargos) - Number(c.descuentos));
  const requiereGerencia = (c: Cotizacion) => c.moneda.trim() !== 'COP' || totalCot(c) > 500000;
  const cotProtegida = (c: Cotizacion) => c.es_seleccionada || !!a.compra_id || aprobaciones.some(ap => ap.version_aprobada.cotizacion_id === c.id);
  const bloquearCompra = a.requiere_aprobacion && a.estado_aprobacion !== 'aprobada';
  const permitirDirecta = puedeGestionar && !a.compra_id && !cotSeleccionada && ['solicitado','en_cotizacion','cotizado'].includes(a.etapa);
  const totalFormulario = (f: { precio: string; cantidad: string; impuestos: string; descuentos: string; otros: string }) => {
    const numeros = [f.precio, f.cantidad, f.impuestos || '0', f.descuentos || '0', f.otros || '0'].map(parseNumero);
    return numeros.some(n => n === null) ? null : redondear2(redondear2(numeros[0]! * numeros[1]!) + numeros[2]! + numeros[4]! - numeros[3]!);
  };

  async function accion(fn: () => Promise<unknown>, mensajeExito: string) {
    if (bloqueo.current) return false;
    bloqueo.current = true; setError(null); setExito(null); setOcupado(true);
    try { await fn(); setExito(mensajeExito); await cargar(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); return false; }
    finally { bloqueo.current = false; setOcupado(false); }
  }

  async function guardarCotizacion(e: React.FormEvent) {
    e.preventDefault();
    if (!mCot || !a || bloqueo.current) return;
    setMError(null);
    const precio = parseNumero(mCot.precio);
    const cantidad = parseNumero(mCot.cantidad);
    const impuestos = mCot.impuestos ? parseNumero(mCot.impuestos) : 0;
    const descuentos = mCot.descuentos ? parseNumero(mCot.descuentos) : 0;
    const otros = mCot.otros ? parseNumero(mCot.otros) : 0;
    if (!mCot.proveedor) { setMError('Selecciona el proveedor.'); return; }
    if (precio === null || precio < 0) { setMError('Precio unitario inválido.'); return; }
    if (cantidad === null || cantidad <= 0) { setMError('Cantidad inválida.'); return; }
    if (impuestos === null || descuentos === null || otros === null || impuestos < 0 || descuentos < 0 || otros < 0) { setMError('Los impuestos, descuentos y cargos deben ser importes positivos o cero.'); return; }
    if (redondear2(precio * cantidad) + impuestos + otros - descuentos < 0) { setMError('El descuento no puede superar el valor de la cotización.'); return; }
    if (!/^[A-Z]{3}$/.test(mCot.moneda.trim().toUpperCase())) { setMError('Moneda inválida (código de 3 letras).'); return; }
    bloqueo.current = true; setOcupado(true);
    try {
      const { data: guardada, error: e1 } = await supabase.from('cotizaciones').insert({
        id: mCot.id, articulo_id: a.id, proveedor_id: mCot.proveedor,
        moneda: mCot.moneda.trim().toUpperCase(),
        precio_unitario: precio, cantidad, impuestos, descuentos, otros_cargos: otros,
        notas: mCot.notas.trim() || null
      }).select('*').single();
      let cot = guardada as Cotizacion | null;
      if (e1) {
        // El id nace al abrir el formulario y permite recuperar una escritura cuya respuesta se perdió.
        const previa = await supabase.from('cotizaciones').select('*').eq('id', mCot.id).maybeSingle();
        if (!previa.data || previa.error) throw new Error(limpiarError(e1.message));
        cot = previa.data as Cotizacion;
      }
      if (!cot) throw new Error('No pudimos confirmar la cotización. Conservamos los datos para que puedas verificar e intentar de nuevo.');
      setMCot(null); setMDocumentos(cot); setDocsOcupados(false); setDocsPendientes(0);
      setExito('Cotización guardada. Revisa y sube los soportes antes de seleccionarla.');
      await cargar();
    } catch (err) { setMError(err instanceof Error ? err.message : String(err)); }
    finally { bloqueo.current = false; setOcupado(false); }
  }

  async function seleccionar(c: Cotizacion) {
    if (docsOcupados || docsPendientes) { setMError('Sube o quita los archivos pendientes antes de seleccionar la cotización.'); return; }
    const ok = await accion(() => rpc('fn_seleccionar_cotizacion', { p_cotizacion: c.id, p_version_articulo: a!.version }), requiereGerencia(c) ? 'Cotización seleccionada y enviada automáticamente a Gerencia para aprobación.' : 'Cotización seleccionada. Revisa los requisitos para registrar la compra.');
    if (ok) setMDocumentos(null);
  }

  async function registrarMovimiento(e: React.FormEvent) {
    e.preventDefault();
    if (!mMov || !a) return;
    setMError(null);
    const cantidad = parseNumero(mMov.cantidad);
    if (cantidad === null || cantidad <= 0) { setMError('Cantidad inválida.'); return; }
    if (!mMov.fecha) { setMError('Indica la fecha efectiva.'); return; }
    setOcupado(true);
    try {
      if (mMov.tipo === 'entrega_directa') {
        await rpc('fn_entrega_directa', {
          p_articulo: a.id, p_cantidad: cantidad, p_fecha_efectiva: mMov.fecha,
          p_receptor: mMov.contraparte.trim(), p_observacion: mMov.observacion.trim() || null, p_op: nuevoOp()
        });
      } else {
        await rpc('fn_registrar_movimiento', {
          p_articulo: a.id, p_tipo: mMov.tipo, p_cantidad: cantidad,
          p_fecha_efectiva: mMov.fecha, p_contraparte: mMov.contraparte.trim() || null,
          p_observacion: mMov.observacion.trim() || null,
          p_permite_reposicion: mMov.reposicion, p_op: nuevoOp()
        });
      }
      setMMov(null);
      setExito('Movimiento registrado.');
      await cargar();
    } catch (err) { setMError(err instanceof Error ? err.message : String(err)); }
    finally { setOcupado(false); }
  }

  const saldos = {
    comprado: a.cantidad_comprada ?? 0,
    recibidoNeto: a.recibido_neto ?? 0,
    disponible: a.disponible_almacen ?? 0,
    entregado: a.entregado_neto ?? 0,
    pendiente: a.pendiente_llegada ?? 0
  };

  return (
    <div className="contenido">
      <p><Link to={esGestor ? '/gestion' : tiene('aprobador') ? '/aprobaciones' : '/mis-solicitudes'}>← {esGestor ? 'Gestión de compras' : tiene('aprobador') ? 'Mis aprobaciones' : 'Mis solicitudes'}</Link> · <Link to={`/solicitudes/${a.solicitud_id}`}>{a.solicitud_numero}</Link></p>
      <div className="acciones-fila">
        <h1 style={{ margin: 0 }}>{a.nombre}</h1>
        <InsigniaEtapa etapa={a.etapa} />
        <InsigniaAprobacion estado={a.estado_aprobacion} />
        {(a.dias_atraso ?? 0) > 0 ? <span className="atraso">Atraso: {a.dias_atraso} día(s)</span> : null}
      </div>
      <p className="texto-suave">
        {a.solicitante_nombre} · {a.area_nombre} · {a.centro_costo_codigo} · {etiquetaSemana(a.semana_lunes)} ·
        solicitado {fmtCantidad(a.cantidad)} {a.unidad} · prioridad {a.prioridad}
        {a.fecha_requerida ? ` · requerido ${fmtFecha(a.fecha_requerida)}` : ''}
      </p>
      {!a.en_bandeja_compras ? <div className="cotizacion-ayuda" role="status"><strong>Esta solicitud sigue en aprobación o programación.</strong><p>Compras podrá gestionarla cuando el jefe la apruebe y llegue al ciclo de recepción. Estado: {a.solicitud_estado}.</p></div> : null}
      {a.es_extraordinaria ? <p><span className="insignia insignia-extra">Extraordinaria</span></p> : null}
      <p><b>Especificaciones:</b> {a.descripcion}</p>
      {a.enlace_referencia && /^https?:\/\//i.test(a.enlace_referencia) ? <p>Referencia de compra: <a href={a.enlace_referencia} target="_blank" rel="noopener noreferrer">Abrir enlace del solicitante ↗</a></p> : null}
      {a.proveedor_sugerido ? <p className="texto-suave">Proveedor sugerido: {a.proveedor_sugerido}</p> : null}
      {a.recibida_compras_en ? <p className="texto-suave">Recibida por Compras: {fmtFechaHora(a.recibida_compras_en)}</p> : null}
      {a.justificacion ? <p className="texto-suave">Justificación: {a.justificacion}</p> : null}
      {a.estatus_historico ? <p className="texto-suave">Estado histórico declarado (CSV): “{a.estatus_historico}”</p> : null}
      {a.cerrado_en ? <p className="texto-suave">Cerrado {fmtFechaHora(a.cerrado_en)}{a.cerrado_motivo ? ` · motivo: ${a.cerrado_motivo}` : ''}</p> : null}

      <MensajeError texto={error} />
      <MensajeExito texto={exito} />

      {/* ------- Acciones de etapa ------- */}
      {puedeGestionar ? (
        <div className="acciones-fila" style={{ margin: '0.6rem 0' }}>
          {a.etapa === 'solicitado' ? (
            <button type="button" className="boton-primario" disabled={ocupado}
              onClick={() => void accion(() => rpc('fn_cambiar_etapa', { p_articulo: a.id, p_hacia: 'en_cotizacion', p_motivo: null, p_version: a.version }), 'Artículo en cotización.')}>
              Tomar para cotizar
            </button>
          ) : null}
          {a.etapa === 'en_cotizacion' ? (
            <BotonConMotivo etiqueta="Devolver a la cola" titulo="Devolver a solicitado"
              onConfirmar={async (m) => { await rpc('fn_cambiar_etapa', { p_articulo: a.id, p_hacia: 'solicitado', p_motivo: m, p_version: a.version }); await cargar(); }} />
          ) : null}
          {a.etapa === 'cotizado' ? (
            <BotonConMotivo etiqueta="Reabrir cotización" titulo="Volver a en cotización"
              onConfirmar={async (m) => { await rpc('fn_cambiar_etapa', { p_articulo: a.id, p_hacia: 'en_cotizacion', p_motivo: m, p_version: a.version }); await cargar(); }} />
          ) : null}
          {a.etapa === 'comprado' ? (
            <button type="button" className="boton-secundario" disabled={ocupado}
              onClick={() => void accion(() => rpc('fn_cambiar_etapa', { p_articulo: a.id, p_hacia: 'en_transito', p_motivo: null, p_version: a.version }), 'Marcado en tránsito.')}>
              Marcar en tránsito
            </button>
          ) : null}
          {['recibido_parcial', 'recibido_total'].includes(a.etapa) ? (
            <BotonConMotivo etiqueta="Cerrar artículo" titulo="Cerrar artículo"
              descripcion={saldos.pendiente > 0 || a.novedades_abiertas > 0
                ? `Atención: hay ${fmtCantidad(saldos.pendiente)} pendiente(s) por llegar y ${a.novedades_abiertas} novedad(es) abierta(s); el motivo debe documentar la resolución.`
                : 'Cierre normal (si no hay pendientes, el motivo es opcional: escribe "Cierre normal").'}
              onConfirmar={async (m) => { await rpc('fn_cerrar_articulo', { p_articulo: a.id, p_motivo: m, p_version: a.version }); await cargar(); }} />
          ) : null}
          {['solicitado', 'en_cotizacion', 'cotizado', 'comprado'].includes(a.etapa) ? (
            <BotonConMotivo etiqueta="Cancelar artículo" clase="boton-peligro" titulo="Cancelar artículo"
              onConfirmar={async (m) => { await rpc('fn_cambiar_etapa', { p_articulo: a.id, p_hacia: 'cancelado', p_motivo: m, p_version: a.version }); await cargar(); }} />
          ) : null}
          {a.etapa === 'cancelado' ? (
            <BotonConMotivo etiqueta="Reabrir (a solicitado)" titulo="Reabrir artículo"
              onConfirmar={async (m) => { await rpc('fn_cambiar_etapa', { p_articulo: a.id, p_hacia: 'solicitado', p_motivo: m, p_version: a.version }); await cargar(); }} />
          ) : null}
          {a.etapa === 'cerrado' && tiene('administrador') ? (
            <BotonConMotivo etiqueta="Reabrir artículo" titulo="Reabrir artículo cerrado"
              onConfirmar={async (m) => { await rpc('fn_reabrir_articulo', { p_articulo: a.id, p_motivo: m, p_version: a.version }); await cargar(); }} />
          ) : null}
          {a.en_bandeja_compras && ['solicitado', 'en_cotizacion', 'cotizado'].includes(a.etapa) ? (
            <BotonConMotivo etiqueta="Devolver solicitud a corrección" titulo="Devolver la solicitud completa a corrección"
              descripcion="El solicitante podrá editar y reenviar. Solo si ningún artículo está comprado o recibido. Al reenviarla volverá al jefe del área."
              onConfirmar={async (m) => { await rpc('fn_devolver_a_correccion', { p_solicitud: a.solicitud_id, p_motivo: m }); await cargar(); }} />
          ) : null}
          <button type="button" className="boton-secundario" onClick={() => void cargar()}>Actualizar</button>
        </div>
      ) : null}

      {/* ------- Cotizaciones ------- */}
      <div className="tarjeta">
        <div className="acciones-fila">
          <h2 style={{ margin: 0 }}>Cotizaciones y soportes</h2>
          {puedeGestionar && !a.compra_id && ['solicitado', 'en_cotizacion', 'cotizado'].includes(a.etapa) ? (
            <button type="button" className="boton-secundario" onClick={() => {
              setMError(null);
              setMCot({ id: nuevoOp(), proveedor: '', precio: '', cantidad: String(a.cantidad), moneda: 'COP', impuestos: '', descuentos: '', otros: '', notas: '' });
            }}>+ Agregar cotización</button>
          ) : null}
        </div>
        <div className="cotizacion-ayuda"><strong>Una ruta clara según el monto</strong><p>Hasta $500.000 COP, cotizar es opcional: puedes registrar una compra directa con proveedor e importe.</p><p>Si el total supera $500.000 COP, selecciona una cotización: se enviará automáticamente a Yeffer o al gerente suplente configurado, con sus soportes. En otra moneda también se requiere Gerencia.</p></div>
        {cotizaciones.length === 0 ? <p className="texto-suave">Aún no hay cotizaciones. Puedes agregar una con sus soportes o usar compra directa si cumple el límite.</p> : (
          <div className="tabla-envoltura">
            <table className="tabla">
              <thead><tr>
                <th>Proveedor</th><th>Moneda</th><th className="numero">Precio unit.</th>
                <th className="numero">Cantidad</th><th className="numero">Impuestos</th>
                <th className="numero">Descuentos</th><th className="numero">Otros</th>
                <th className="numero">Total estimado</th><th>Notas</th><th>Soportes</th><th>Selección</th>
              </tr></thead>
              <tbody>
                {cotizaciones.map((c) => {
                  const prov = cat?.proveedores.find((p: Proveedor) => p.id === c.proveedor_id);
                  return (
                    <tr key={c.id}>
                      <td>{prov?.nombre ?? '—'}</td>
                      <td>{c.moneda}</td>
                      <td className="numero">{fmtMoneda(c.precio_unitario, c.moneda)}</td>
                      <td className="numero">{fmtCantidad(c.cantidad)}</td>
                      <td className="numero">{fmtMoneda(c.impuestos, c.moneda)}</td>
                      <td className="numero">{fmtMoneda(c.descuentos, c.moneda)}</td>
                      <td className="numero">{fmtMoneda(c.otros_cargos, c.moneda)}</td>
                      <td className="numero"><b>{fmtMoneda(totalCot(c), c.moneda)}</b></td>
                      <td>{c.notas ?? ''}</td>
                      <td><button type="button" className="boton-silencioso" disabled={ocupado} onClick={() => { setMError(null); setDocsPendientes(0); setDocsOcupados(false); setMDocumentos(c); }}>Ver cotización y archivos</button></td>
                      <td>
                        {c.es_seleccionada ? <span className="insignia aprobacion-aprobada">Seleccionada</span>
                          : puedeGestionar && !a.compra_id ? (
                            <button type="button" className="boton-silencioso" disabled={ocupado}
                              onClick={() => { setMError(null); setDocsPendientes(0); setDocsOcupados(false); setMDocumentos(c); }}>
                              Revisar y seleccionar
                            </button>
                          ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {cotSeleccionada ? <div className="cotizacion-seleccionada"><span className="sobre-titulo">COTIZACIÓN SELECCIONADA</span><div className="cotizacion-total"><span>{cat?.proveedores.find(p => p.id === cotSeleccionada.proveedor_id)?.nombre ?? 'Proveedor seleccionado'}</span><strong>{fmtMoneda(totalCot(cotSeleccionada), cotSeleccionada.moneda)}</strong></div><p>{cotSeleccionada.notas ?? 'Sin notas adicionales.'}</p><Adjuntos entidad="articulo" entidadId={a.id} cotizacionId={cotSeleccionada.id} puedeSubir={false} titulo="Soportes disponibles para la aprobación" /></div> : null}
        <p className="texto-suave">Los importes mostrados son estimados de cotización; el importe comprado se registra aparte y nada aquí implica un pago.</p>
      </div>

      {/* ------- Aprobación ------- */}
      <div className="tarjeta">
        <div className="acciones-fila">
          <h2 style={{ margin: 0 }}>Aprobación del monto</h2>
          {puedeGestionar && !['cerrado', 'cancelado'].includes(a.etapa) && !a.compra_id && (!cotSeleccionada || !requiereGerencia(cotSeleccionada)) ? (
            <button type="button" className="boton-secundario" onClick={() => {
              setMError(null);
              setMAprob({ requiere: a.requiere_aprobacion, aprobador: a.aprobador_id ?? '' });
            }}>Revisión adicional (opcional)</button>
          ) : null}
          {puedeGestionar && a.requiere_aprobacion && cotSeleccionada && ['cotizado'].includes(a.etapa)
            && ['sin_solicitar', 'rechazada'].includes(a.estado_aprobacion) ? (
            <button type="button" className="boton-primario" disabled={ocupado}
              onClick={() => void accion(() => rpc('fn_solicitar_aprobacion', { p_articulo: a.id, p_op: nuevoOp() }), 'Aprobación enviada al responsable designado.')}>
              Reenviar a aprobación
            </button>
          ) : null}
        </div>
        {!a.requiere_aprobacion ? <p className="texto-suave">No se requiere una aprobación adicional del monto. La aprobación inicial del jefe queda en el historial de la solicitud.</p> : (
          <p>Aprobador designado: <b>{a.aprobador_nombre ?? '—'}</b> · Estado: <InsigniaAprobacion estado={a.estado_aprobacion} /></p>
        )}
        {aprobaciones.length > 0 ? (
          <ul>
            {aprobaciones.map((ap) => (
              <li key={ap.id}>
                {fmtFechaHora(ap.creado_en)} · <b>{ap.estado}</b>{ap.es_vigente ? ' (vigente)' : ''}
                {ap.decidido_en ? ` · decidida ${fmtFechaHora(ap.decidido_en)}` : ''}
                {ap.comentario ? ` · "${ap.comentario}"` : ''}
                <span className="texto-suave cotizacion-version"> · evidencia revisada: {String((ap.version_aprobada as { cantidad?: unknown }).cantidad ?? '—')} ×
                  {' '}{String((ap.version_aprobada as { proveedor?: unknown }).proveedor ?? '—')} a
                  {' '}{fmtMoneda(Number((ap.version_aprobada as { precio_unitario?: unknown }).precio_unitario ?? NaN), String((ap.version_aprobada as { moneda?: unknown }).moneda ?? 'COP'))}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* ------- Compra ------- */}
      <div className="tarjeta">
        <div className="acciones-fila">
          <h2 style={{ margin: 0 }}>Compra</h2>
          {puedeGestionar && a.etapa === 'cotizado' && cotSeleccionada && !a.compra_id ? (
            <button type="button" className="boton-primario" disabled={ocupado || bloquearCompra} title={bloquearCompra ? 'Espera la aprobación vigente antes de registrar la compra.' : undefined} onClick={() => {
              setMError(null);
              setMCompra({
                cantidad: String(cotSeleccionada?.cantidad ?? a.cantidad),
                fecha: hoyBogotaISO(), impuestos: String(cotSeleccionada?.impuestos ?? 0), descuentos: String(cotSeleccionada?.descuentos ?? 0), otros: String(cotSeleccionada?.otros_cargos ?? 0),
                referencia: '', estimada: ''
              });
            }}>Registrar compra</button>
          ) : null}
          {permitirDirecta ? <button type="button" className="boton-primario" disabled={ocupado} onClick={() => { setMError(null); setMDirecta({ proveedor: '', precio: '', cantidad: String(a.cantidad), impuestos: '', descuentos: '', otros: '', fecha: hoyBogotaISO(), referencia: '', estimada: '', op: nuevoOp() }); }}>Registrar compra sin cotización</button> : null}
          {puedeGestionar && a.compra_id ? (
            <>
              <button type="button" className="boton-secundario" onClick={() => {
                setMError(null);
                setMEditCompra({
                  cantidad: String(a.cantidad_comprada ?? ''), precio: String(a.precio_unitario ?? ''),
                  impuestos: String(a.impuestos ?? 0), descuentos: String(a.descuentos ?? 0),
                  otros: String(a.otros_cargos ?? 0), referencia: a.referencia ?? '', motivo: ''
                });
              }}>Modificar compra (con motivo)</button>
              <BotonConMotivo etiqueta="Actualizar fecha estimada" titulo="Nueva fecha estimada de llegada"
                descripcion="Escribe la nueva fecha AAAA-MM-DD dentro del motivo, junto con la razón del cambio. El valor anterior se conserva."
                onConfirmar={async (m) => {
                  const f = m.match(/\d{4}-\d{2}-\d{2}/)?.[0];
                  if (!f) throw new Error('Incluye la nueva fecha (AAAA-MM-DD) en el texto.');
                  await rpc('fn_actualizar_fecha_estimada', { p_compra: a.compra_id, p_fecha: f, p_motivo: m, p_version: a.compra_version });
                  await cargar();
                }} />
            </>
          ) : null}
        </div>
        {!a.compra_id ? (
          <p className="texto-suave">
            {cotSeleccionada ? (bloquearCompra ? 'La compra está bloqueada hasta recibir una aprobación vigente del monto. Los aprobadores pueden consultar la cotización y sus archivos en esta página.' : 'Cotización lista. Revisa proveedor, cantidades y total antes de registrar la compra.') : 'Sin compra registrada. Hasta $500.000 COP puedes comprar sin cotización; para montos mayores agrega y selecciona una cotización.'}
          </p>
        ) : (
          <>
            <p>
              <b>{fmtCantidad(a.cantidad_comprada)}</b> × {fmtMoneda(a.precio_unitario, a.moneda ?? 'COP')} a <b>{a.proveedor_nombre}</b>
              {' '}· subtotal {fmtMoneda(a.subtotal, a.moneda ?? 'COP')} · impuestos {fmtMoneda(a.impuestos, a.moneda ?? 'COP')}
              {' '}· descuentos {fmtMoneda(a.descuentos, a.moneda ?? 'COP')} · otros {fmtMoneda(a.otros_cargos, a.moneda ?? 'COP')}
              {' '}· <b>total {fmtMoneda(a.total, a.moneda ?? 'COP')}</b> (importe comprado; no implica pago registrado)
            </p>
            <p>
              Fecha de compra {fmtFecha(a.fecha_compra)} · referencia {a.referencia ?? '—'} ·
              llegada estimada <b>{a.fecha_estimada_llegada ? fmtFecha(a.fecha_estimada_llegada) : 'sin información'}</b>
              {a.llegada_completa_en ? <> · llegada completa {fmtFechaHora(a.llegada_completa_en)}</> : null}
              {a.primera_llegada ? <> · primera recepción {fmtFecha(a.primera_llegada)} · última {fmtFecha(a.ultima_llegada)}</> : null}
            </p>
            {fechasEstimadas.length > 1 ? (
              <details>
                <summary>Historial de fechas estimadas ({fechasEstimadas.length})</summary>
                <ul>
                  {fechasEstimadas.map((f, i) => (
                    <li key={i}>{f.fecha_estimada ? fmtFecha(f.fecha_estimada) : 'sin información'} · {fmtFechaHora(f.creado_en)} · {f.motivo ?? ''}</li>
                  ))}
                </ul>
              </details>
            ) : null}
            <Adjuntos entidad="compra" entidadId={a.compra_id} puedeSubir={puedeGestionar} maxArchivos={3} />
          </>
        )}
      </div>

      {/* ------- Movimientos y saldos ------- */}
      <div className="tarjeta">
        <div className="acciones-fila">
          <h2 style={{ margin: 0 }}>Almacén y movimientos</h2>
          {(puedeGestionar || esAlmacen) && a.compra_id && !['cerrado', 'cancelado'].includes(a.etapa) ? (
            <button type="button" className="boton-primario" onClick={() => {
              setMError(null);
              setMMov({ tipo: 'recepcion', cantidad: '', fecha: hoyBogotaISO(), contraparte: '', observacion: '', reposicion: false });
            }}>+ Registrar movimiento</button>
          ) : null}
        </div>
        <div className="tablero">
          <div className="ficha"><b>{fmtCantidad(saldos.comprado)}</b> comprado</div>
          <div className="ficha"><b>{fmtCantidad(saldos.recibidoNeto)}</b> recibido neto</div>
          <div className="ficha"><b>{fmtCantidad(saldos.disponible)}</b> disponible en almacén</div>
          <div className="ficha"><b>{fmtCantidad(saldos.entregado)}</b> entregado</div>
          <div className="ficha"><b>{fmtCantidad(saldos.pendiente)}</b> pendiente por llegar</div>
        </div>
        {movimientos.length === 0 ? <p className="texto-suave">Sin movimientos.</p> : (
          <div className="tabla-envoltura">
            <table className="tabla">
              <thead><tr>
                <th>Tipo</th><th className="numero">Cantidad</th><th>Fecha efectiva</th>
                <th>Registrado (servidor)</th><th>Contraparte</th><th>Observación</th><th>Estado</th><th></th>
              </tr></thead>
              <tbody>
                {movimientos.map((m) => (
                  <tr key={m.id} style={m.anulado ? { opacity: 0.55, textDecoration: 'line-through' } : undefined}>
                    <td>{ETIQUETA_MOVIMIENTO[m.tipo]}{m.permite_reposicion ? ' (permite reposición)' : ''}</td>
                    <td className="numero">{fmtCantidad(m.cantidad)}</td>
                    <td>{fmtFecha(m.fecha_efectiva)}</td>
                    <td>{fmtFechaHora(m.creado_en)}</td>
                    <td>{m.contraparte ?? '—'}</td>
                    <td>{m.observacion ?? ''}{m.anulado ? ` · ANULADO: ${m.anulado_motivo}` : ''}</td>
                    <td>{m.tipo === 'entrega' ? (m.confirmado_por_solicitante ? '✓ confirmada' : 'sin confirmar') : ''}</td>
                    <td>
                      {puedeGestionar && !m.anulado ? (
                        <BotonConMotivo etiqueta="Anular" clase="boton-silencioso" titulo="Anular movimiento"
                          descripcion="El registro original se conserva marcado como anulado."
                          onConfirmar={async (mo) => { await rpc('fn_anular_movimiento', { p_movimiento: m.id, p_motivo: mo, p_op: nuevoOp() }); await cargar(); }} />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ------- Novedades ------- */}
      <div className="tarjeta">
        <div className="acciones-fila">
          <h2 style={{ margin: 0 }}>Novedades</h2>
          {(puedeGestionar || esAlmacen) && !['borrador', 'cancelado'].includes(a.etapa) ? (
            <button type="button" className="boton-secundario" onClick={() => { setMError(null); setMNov({ tipo: 'observacion', descripcion: '' }); }}>
              + Registrar novedad
            </button>
          ) : null}
        </div>
        {novedades.length === 0 ? <p className="texto-suave">Sin novedades.</p> : novedades.map((n) => (
          <div key={n.id} style={{ borderTop: '1px dashed var(--borde)', paddingTop: '0.5rem', marginTop: '0.5rem' }}>
            <p>
              <b>{ETIQUETA_NOVEDAD[n.tipo]}</b> · {n.estado === 'abierta' ? 'Abierta' : n.estado === 'en_atencion' ? 'En atención' : 'Resuelta'}
              {' '}· {fmtFechaHora(n.creado_en)}
            </p>
            <p>{n.descripcion}</p>
            {n.resolucion ? <p><i>Resolución: {n.resolucion}</i></p> : null}
            <div className="acciones-fila">
              {(puedeGestionar || esAlmacen) && n.estado === 'abierta' ? (
                <button type="button" className="boton-secundario" disabled={ocupado}
                  onClick={() => void accion(() => rpc('fn_atender_novedad', { p_novedad: n.id, p_version: n.version }), 'Novedad en atención.')}>
                  Tomar en atención
                </button>
              ) : null}
              {(puedeGestionar || esAlmacen) && n.estado !== 'resuelta' ? (
                <BotonConMotivo etiqueta="Resolver" titulo="Resolver novedad"
                  descripcion="Describe la resolución (queda como registro permanente)."
                  onConfirmar={async (m) => { await rpc('fn_resolver_novedad', { p_novedad: n.id, p_resolucion: m, p_version: n.version }); await cargar(); }} />
              ) : null}
              {esGestor && n.estado === 'resuelta' ? (
                <BotonConMotivo etiqueta="Reabrir" titulo="Reabrir novedad"
                  onConfirmar={async (m) => { await rpc('fn_reabrir_novedad', { p_novedad: n.id, p_motivo: m, p_version: n.version }); await cargar(); }} />
              ) : null}
            </div>
            <Adjuntos entidad="novedad" entidadId={n.id} puedeSubir={(puedeGestionar || esAlmacen) && n.estado !== 'resuelta'} maxArchivos={3} />
          </div>
        ))}
        <p className="texto-suave">Una corrección de solicitud y una devolución física son operaciones distintas: la novedad documenta; los movimientos mueven unidades.</p>
      </div>

      {/* ------- Adjuntos del artículo ------- */}
      <div className="tarjeta">
        <Adjuntos entidad="articulo" entidadId={a.id} puedeSubir={puedeGestionar && !['cerrado', 'cancelado'].includes(a.etapa)} />
      </div>

      {/* ------- Historial ------- */}
      <div className="tarjeta">
        <h2>Historial de cambios</h2>
        {historial.length === 0 ? <p className="texto-suave">Sin registros.</p> : (
          <div className="tabla-envoltura">
            <table className="tabla">
              <thead><tr><th>Fecha (servidor)</th><th>Qué</th><th>Acción</th><th>Quién</th><th>Motivo</th><th>Antes → Después</th></tr></thead>
              <tbody>
                {historial.map((h, i) => (
                  <tr key={i}>
                    <td>{fmtFechaHora(h.creado_en)}</td>
                    <td>{h.tabla}</td>
                    <td>{h.accion}</td>
                    <td>{h.actor_nombre}</td>
                    <td>{h.motivo ?? ''}</td>
                    <td className="texto-suave" style={{ maxWidth: 380, overflowWrap: 'anywhere' }}>
                      {h.anterior ? JSON.stringify(h.anterior) : '—'} → {h.nuevo ? JSON.stringify(h.nuevo) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ============ MODALES ============ */}
      <Modal titulo="Agregar cotización" abierto={!!mCot} ocupado={ocupado} alCerrar={() => setMCot(null)}>
        {mCot ? (
          <><ol className="cotizacion-pasos" aria-label="Pasos de la cotización"><li className="actual" aria-current="step">1. Datos e importe</li><li>2. Soportes y envío</li></ol>{errorCatalogos ? <><MensajeError texto={errorCatalogos} /><button type="button" className="boton-secundario" onClick={() => void recargarCatalogos()}>Recargar proveedores</button></> : null}<Formulario className="formulario" onSubmit={guardarCotizacion} onChangeCapture={() => setMError(null)}>
            <Campo etiqueta="Proveedor" requerido>
              <select value={mCot.proveedor} onChange={(e) => setMCot({ ...mCot, proveedor: e.target.value })}>
                <option value="">— Selecciona —</option>
                {cat?.proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </Campo>
            <div className="fila-campos">
              <Campo etiqueta="Precio unitario" requerido>
                <input inputMode="decimal" data-numero="true" min="0" value={mCot.precio} onChange={(e) => setMCot({ ...mCot, precio: e.target.value })} />
              </Campo>
              <Campo etiqueta="Cantidad a cotizar" requerido>
                <input inputMode="decimal" data-numero="true" data-positivo="true" value={mCot.cantidad} onChange={(e) => setMCot({ ...mCot, cantidad: e.target.value })} />
              </Campo>
              <Campo etiqueta="Moneda" requerido>
                <input value={mCot.moneda} minLength={3} pattern="[A-Za-z]{3}" maxLength={3} onChange={(e) => setMCot({ ...mCot, moneda: e.target.value.toUpperCase() })} />
              </Campo>
            </div>
            <div className="fila-campos">
              <Campo etiqueta="Impuestos"><input inputMode="decimal" data-numero="true" value={mCot.impuestos} onChange={(e) => setMCot({ ...mCot, impuestos: e.target.value })} placeholder="0" /></Campo>
              <Campo etiqueta="Descuentos"><input inputMode="decimal" data-numero="true" value={mCot.descuentos} onChange={(e) => setMCot({ ...mCot, descuentos: e.target.value })} placeholder="0" /></Campo>
              <Campo etiqueta="Otros cargos"><input inputMode="decimal" data-numero="true" value={mCot.otros} onChange={(e) => setMCot({ ...mCot, otros: e.target.value })} placeholder="0" /></Campo>
            </div>
            <div className="cotizacion-total"><span>Total estimado</span><strong>{totalFormulario(mCot) === null ? 'Completa los importes' : fmtMoneda(totalFormulario(mCot), mCot.moneda || 'COP')}</strong></div><p className="campo-ayuda">{mCot.moneda.trim().toUpperCase() !== 'COP' || (totalFormulario(mCot) ?? 0) > 500000 ? 'Al seleccionar esta cotización, Gerencia recibirá automáticamente la aprobación con sus soportes.' : 'Puedes usar esta cotización o realizar una compra directa hasta $500.000 COP.'}</p>
            <Campo etiqueta="Notas"><textarea rows={2} value={mCot.notas} onChange={(e) => setMCot({ ...mCot, notas: e.target.value })} /></Campo>
            <MensajeError texto={mError} />
            <div className="modal-acciones">
              <button type="button" className="boton-secundario" onClick={() => setMCot(null)}>Cancelar</button>
              <button type="submit" className="boton-primario" disabled={ocupado}>{ocupado ? 'Guardando…' : 'Guardar y agregar soportes'}</button>
            </div>
          </Formulario></>
        ) : null}
      </Modal>

      <Modal titulo="Cotización: soportes y envío" abierto={!!mDocumentos} ocupado={ocupado || docsOcupados} alCerrar={() => setMDocumentos(null)}>
        {mDocumentos ? <>
          <ol className="cotizacion-pasos" aria-label="Pasos de la cotización"><li>1. Datos guardados ✓</li><li className="actual" aria-current="step">2. Soportes y envío</li></ol>
          <dl className="cotizacion-revision"><div><dt>Proveedor</dt><dd>{cat?.proveedores.find(p => p.id === mDocumentos.proveedor_id)?.nombre ?? 'Proveedor de la cotización'}</dd></div><div><dt>Total estimado</dt><dd>{fmtMoneda(totalCot(mDocumentos), mDocumentos.moneda)}</dd></div><div><dt>Cantidad y precio unitario</dt><dd>{fmtCantidad(mDocumentos.cantidad)} × {fmtMoneda(mDocumentos.precio_unitario, mDocumentos.moneda)}</dd></div><div><dt>Ruta de aprobación</dt><dd>{requiereGerencia(mDocumentos) ? 'Gerencia · envío automático al seleccionar' : 'Sin aprobación adicional por monto'}</dd></div></dl>
          {mDocumentos.notas ? <p>{mDocumentos.notas}</p> : null}
          <div className="cotizacion-ayuda"><strong>{cotProtegida(mDocumentos) ? 'Evidencia de la cotización' : 'Agrega los soportes antes de seleccionar'}</strong><p>{cotProtegida(mDocumentos) ? 'Los soportes de una cotización seleccionada o utilizada en una aprobación se conservan. Si necesitas cambiar la evidencia, crea otra alternativa.' : 'Selecciona imágenes o PDF, revisa su vista previa y pulsa Subir. Quien apruebe podrá ver los archivos guardados.'}</p></div>
          <Adjuntos key={mDocumentos.id} entidad="articulo" entidadId={a.id} cotizacionId={mDocumentos.id} puedeSubir={puedeGestionar && !cotProtegida(mDocumentos)} titulo="Archivos de esta cotización" alOcupado={setDocsOcupados} alPendientes={setDocsPendientes} alCambiar={() => void cargar()} />
          <MensajeError texto={mError} />
          {docsPendientes > 0 ? <p className="campo-ayuda">Tienes {docsPendientes} archivo(s) sin subir. Súbelos o quítalos antes de enviar la cotización.</p> : null}
          <div className="modal-acciones"><button type="button" className="boton-secundario" onClick={() => setMDocumentos(null)} disabled={ocupado || docsOcupados || docsPendientes > 0}>{docsPendientes ? 'Sube o quita los archivos para cerrar' : 'Volver al artículo'}</button>{puedeGestionar && !mDocumentos.es_seleccionada && !a.compra_id ? <button type="button" className="boton-primario" disabled={ocupado || docsOcupados || docsPendientes > 0} onClick={() => void seleccionar(mDocumentos)}>{ocupado ? 'Enviando…' : requiereGerencia(mDocumentos) ? 'Seleccionar y enviar a Gerencia' : 'Seleccionar esta cotización'}</button> : null}</div>
        </> : null}
      </Modal>

      <Modal titulo="Compra sin cotización" abierto={!!mDirecta} ocupado={ocupado} alCerrar={() => setMDirecta(null)}>
        {mDirecta ? <Formulario className="formulario" onChangeCapture={() => setMError(null)} onSubmit={async e => {
          e.preventDefault(); if (bloqueo.current) return; setMError(null);
          const precio = parseNumero(mDirecta.precio), cantidad = parseNumero(mDirecta.cantidad), impuestos = parseNumero(mDirecta.impuestos || '0'), descuentos = parseNumero(mDirecta.descuentos || '0'), otros = parseNumero(mDirecta.otros || '0');
          const total = totalFormulario(mDirecta);
          if (!mDirecta.proveedor || precio === null || precio < 0 || cantidad === null || cantidad <= 0 || impuestos === null || descuentos === null || otros === null || impuestos < 0 || descuentos < 0 || otros < 0 || !mDirecta.fecha) { setMError('Completa proveedor, fecha, cantidad y todos los importes con valores válidos.'); return; }
          if (total === null || total < 0) { setMError('El total no puede ser negativo. Revisa el descuento.'); return; }
          if (total > 500000) { setMError('Esta compra supera $500.000 COP. Agrega una cotización y selecciónala para solicitar la aprobación de Gerencia. Conservamos tus datos.'); return; }
          bloqueo.current = true; setOcupado(true);
          try {
            await rpc('fn_registrar_compra_directa', { p_articulo: a.id, p_proveedor: mDirecta.proveedor, p_precio_unitario: precio, p_cantidad: cantidad, p_impuestos: impuestos, p_descuentos: descuentos, p_otros_cargos: otros, p_fecha_compra: mDirecta.fecha, p_referencia: mDirecta.referencia.trim() || null, p_fecha_estimada: mDirecta.estimada || null, p_version_articulo: a.version, p_op: mDirecta.op });
            setMDirecta(null); setExito('Compra directa registrada. Puedes agregar sus soportes en la sección de compra.'); await cargar();
          } catch (e) { setMError(e instanceof Error ? e.message : String(e)); }
          finally { bloqueo.current = false; setOcupado(false); }
        }}>
          <div className="cotizacion-ayuda"><strong>Compra directa hasta $500.000 COP</strong><p>La solicitud ya debe contar con la aprobación del jefe. Registra proveedor, cantidad e importe; el servidor comprueba el total antes de guardar.</p></div>
          {errorCatalogos ? <><MensajeError texto={errorCatalogos} /><button type="button" className="boton-secundario" onClick={() => void recargarCatalogos()}>Recargar proveedores</button></> : null}
          <Campo etiqueta="Proveedor" requerido><select value={mDirecta.proveedor} onChange={e => setMDirecta({ ...mDirecta, proveedor: e.target.value })}><option value="">— Selecciona —</option>{cat?.proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></Campo>
          <div className="fila-campos"><Campo etiqueta="Precio unitario en COP" requerido><input inputMode="decimal" data-numero="true" min="0" value={mDirecta.precio} onChange={e => setMDirecta({ ...mDirecta, precio: e.target.value })} /></Campo><Campo etiqueta="Cantidad a comprar" requerido><input inputMode="decimal" data-numero="true" data-positivo="true" value={mDirecta.cantidad} onChange={e => setMDirecta({ ...mDirecta, cantidad: e.target.value })} /></Campo></div>
          <div className="fila-campos"><Campo etiqueta="Impuestos"><input inputMode="decimal" data-numero="true" min="0" placeholder="0" value={mDirecta.impuestos} onChange={e => setMDirecta({ ...mDirecta, impuestos: e.target.value })} /></Campo><Campo etiqueta="Descuentos"><input inputMode="decimal" data-numero="true" min="0" placeholder="0" value={mDirecta.descuentos} onChange={e => setMDirecta({ ...mDirecta, descuentos: e.target.value })} /></Campo><Campo etiqueta="Otros cargos"><input inputMode="decimal" data-numero="true" min="0" placeholder="0" value={mDirecta.otros} onChange={e => setMDirecta({ ...mDirecta, otros: e.target.value })} /></Campo></div>
          <div className="cotizacion-total"><span>Total de la compra</span><strong>{totalFormulario(mDirecta) === null ? 'Completa los importes' : fmtMoneda(totalFormulario(mDirecta), 'COP')}</strong></div>
          {(totalFormulario(mDirecta) ?? 0) > 500000 ? <p className="campo-error" role="status">Supera el límite de compra directa. Para este monto necesitas una cotización y aprobación de Gerencia.</p> : null}
          <div className="fila-campos"><Campo etiqueta="Fecha de compra" requerido><input type="date" value={mDirecta.fecha} onChange={e => setMDirecta({ ...mDirecta, fecha: e.target.value })} /></Campo><Campo etiqueta="Llegada estimada (opcional)"><input type="date" value={mDirecta.estimada} onChange={e => setMDirecta({ ...mDirecta, estimada: e.target.value })} /></Campo></div>
          <Campo etiqueta="Referencia o soporte"><input value={mDirecta.referencia} onChange={e => setMDirecta({ ...mDirecta, referencia: e.target.value })} /></Campo>
          <MensajeError texto={mError} /><div className="modal-acciones"><button type="button" className="boton-secundario" onClick={() => setMDirecta(null)}>Cancelar</button><button type="submit" className="boton-primario" disabled={ocupado}>{ocupado ? 'Registrando…' : 'Registrar compra directa'}</button></div>
        </Formulario> : null}
      </Modal>

      <Modal titulo="Configurar aprobación" ocupado={ocupado} abierto={!!mAprob} alCerrar={() => setMAprob(null)}>
        {mAprob ? (
          <Formulario className="formulario" onSubmit={async (e) => {
            e.preventDefault(); setMError(null);
            try {
              if (mAprob.requiere && !mAprob.aprobador) throw new Error('Designa el aprobador.');
              await rpc('fn_configurar_aprobacion', {
                p_articulo: a.id, p_requiere: mAprob.requiere,
                p_aprobador: mAprob.requiere ? mAprob.aprobador : null, p_version: a.version
              });
              setMAprob(null); setExito('Aprobación configurada.'); await cargar();
            } catch (err) { setMError(err instanceof Error ? err.message : String(err)); }
          }}>
            <label className="campo">
              <span className="campo-etiqueta">
                <input type="checkbox" checked={mAprob.requiere}
                  onChange={(e) => setMAprob({ ...mAprob, requiere: e.target.checked })} /> Requiere aprobación
              </span>
            </label>
            {mAprob.requiere ? (
              <Campo etiqueta="Aprobador designado" requerido>
                <select value={mAprob.aprobador} onChange={(e) => setMAprob({ ...mAprob, aprobador: e.target.value })}>
                  <option value="">— Selecciona —</option>
                  {aprobadores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </Campo>
            ) : null}
            <p className="texto-suave">El aprobador no puede decidir sobre su propia solicitud (configuración del piloto).</p>
            <MensajeError texto={mError} />
            <div className="modal-acciones">
              <button type="button" className="boton-secundario" onClick={() => setMAprob(null)}>Cancelar</button>
              <button type="submit" className="boton-primario">Guardar</button>
            </div>
          </Formulario>
        ) : null}
      </Modal>

      <Modal titulo="Registrar compra" ocupado={ocupado} abierto={!!mCompra} alCerrar={() => setMCompra(null)}>
        {mCompra && cotSeleccionada ? (
          <Formulario className="formulario" onSubmit={async (e) => {
            e.preventDefault(); setMError(null);
            const cantidad = parseNumero(mCompra.cantidad);
            const imp = mCompra.impuestos ? parseNumero(mCompra.impuestos) : 0;
            const desc = mCompra.descuentos ? parseNumero(mCompra.descuentos) : 0;
            const otros = mCompra.otros ? parseNumero(mCompra.otros) : 0;
            if (cantidad === null || cantidad <= 0) { setMError('Cantidad inválida.'); return; }
            if (imp === null || desc === null || otros === null) { setMError('Importes inválidos.'); return; }
            if (!mCompra.fecha) { setMError('Indica la fecha de compra.'); return; }
            setOcupado(true);
            try {
              await rpc('fn_registrar_compra', {
                p_articulo: a.id, p_cantidad: cantidad, p_fecha_compra: mCompra.fecha,
                p_impuestos: imp, p_descuentos: desc, p_otros_cargos: otros,
                p_referencia: mCompra.referencia.trim() || null,
                p_fecha_estimada: mCompra.estimada || null,
                p_version_articulo: a.version, p_op: nuevoOp()
              });
              setMCompra(null); setExito('Compra registrada.'); await cargar();
            } catch (err) { setMError(err instanceof Error ? err.message : String(err)); }
            finally { setOcupado(false); }
          }}>
            <p>
              Cotización seleccionada: <b>{fmtMoneda(cotSeleccionada.precio_unitario, cotSeleccionada.moneda)}</b> c/u
              ({cotSeleccionada.moneda}). El subtotal y el total los calcula y valida el servidor.
            </p>
            <div className="fila-campos">
              <Campo etiqueta="Cantidad a comprar" requerido>
                <input inputMode="decimal" data-numero="true" data-positivo="true" value={mCompra.cantidad} onChange={(e) => setMCompra({ ...mCompra, cantidad: e.target.value })} />
              </Campo>
              <Campo etiqueta="Fecha de compra" requerido>
                <input type="date" value={mCompra.fecha} onChange={(e) => setMCompra({ ...mCompra, fecha: e.target.value })} />
              </Campo>
              <Campo etiqueta="Llegada estimada (opcional)">
                <input type="date" value={mCompra.estimada} onChange={(e) => setMCompra({ ...mCompra, estimada: e.target.value })} />
              </Campo>
            </div>
            <div className="fila-campos">
              <Campo etiqueta="Impuestos"><input inputMode="decimal" data-numero="true" value={mCompra.impuestos} onChange={(e) => setMCompra({ ...mCompra, impuestos: e.target.value })} placeholder="0" /></Campo>
              <Campo etiqueta="Descuentos"><input inputMode="decimal" data-numero="true" value={mCompra.descuentos} onChange={(e) => setMCompra({ ...mCompra, descuentos: e.target.value })} placeholder="0" /></Campo>
              <Campo etiqueta="Otros cargos"><input inputMode="decimal" data-numero="true" value={mCompra.otros} onChange={(e) => setMCompra({ ...mCompra, otros: e.target.value })} placeholder="0" /></Campo>
            </div>
            <Campo etiqueta="Referencia o soporte (número de orden, factura, etc.)">
              <input value={mCompra.referencia} onChange={(e) => setMCompra({ ...mCompra, referencia: e.target.value })} />
            </Campo>
            <MensajeError texto={mError} />
            <div className="modal-acciones">
              <button type="button" className="boton-secundario" onClick={() => setMCompra(null)}>Cancelar</button>
              <button type="submit" className="boton-primario" disabled={ocupado}>{ocupado ? 'Guardando…' : 'Registrar compra'}</button>
            </div>
          </Formulario>
        ) : <p>Selecciona primero una cotización.</p>}
      </Modal>

      <Modal titulo="Modificar compra" ocupado={ocupado} abierto={!!mEditCompra} alCerrar={() => setMEditCompra(null)}>
        {mEditCompra ? (
          <Formulario className="formulario" onSubmit={async (e) => {
            e.preventDefault(); setMError(null);
            const cantidad = parseNumero(mEditCompra.cantidad);
            const precio = parseNumero(mEditCompra.precio);
            const imp = parseNumero(mEditCompra.impuestos || '0');
            const desc = parseNumero(mEditCompra.descuentos || '0');
            const otros = parseNumero(mEditCompra.otros || '0');
            if (cantidad === null || precio === null || imp === null || desc === null || otros === null) { setMError('Valores inválidos.'); return; }
            if (mEditCompra.motivo.trim().length < 5) { setMError('Explica el motivo de la modificación.'); return; }
            setOcupado(true);
            try {
              await rpc('fn_actualizar_compra', {
                p_compra: a.compra_id, p_cantidad: cantidad, p_precio_unitario: precio,
                p_impuestos: imp, p_descuentos: desc, p_otros_cargos: otros,
                p_referencia: mEditCompra.referencia.trim() || null,
                p_motivo: mEditCompra.motivo.trim(), p_version: a.compra_version
              });
              setMEditCompra(null);
              setExito('Compra modificada. Si el cambio fue material y el artículo requiere aprobación, se generó una nueva aprobación pendiente (la anterior se conserva).');
              await cargar();
            } catch (err) { setMError(err instanceof Error ? err.message : String(err)); }
            finally { setOcupado(false); }
          }}>
            <div className="fila-campos">
              <Campo etiqueta="Cantidad comprada" requerido><input inputMode="decimal" data-numero="true" data-positivo="true" value={mEditCompra.cantidad} onChange={(e) => setMEditCompra({ ...mEditCompra, cantidad: e.target.value })} /></Campo>
              <Campo etiqueta="Precio unitario" requerido><input inputMode="decimal" data-numero="true" value={mEditCompra.precio} onChange={(e) => setMEditCompra({ ...mEditCompra, precio: e.target.value })} /></Campo>
            </div>
            <div className="fila-campos">
              <Campo etiqueta="Impuestos"><input inputMode="decimal" data-numero="true" value={mEditCompra.impuestos} onChange={(e) => setMEditCompra({ ...mEditCompra, impuestos: e.target.value })} /></Campo>
              <Campo etiqueta="Descuentos"><input inputMode="decimal" data-numero="true" value={mEditCompra.descuentos} onChange={(e) => setMEditCompra({ ...mEditCompra, descuentos: e.target.value })} /></Campo>
              <Campo etiqueta="Otros cargos"><input inputMode="decimal" data-numero="true" value={mEditCompra.otros} onChange={(e) => setMEditCompra({ ...mEditCompra, otros: e.target.value })} /></Campo>
            </div>
            <Campo etiqueta="Referencia"><input value={mEditCompra.referencia} onChange={(e) => setMEditCompra({ ...mEditCompra, referencia: e.target.value })} /></Campo>
            <Campo etiqueta="Motivo de la modificación" requerido>
              <textarea rows={2} value={mEditCompra.motivo} onChange={(e) => setMEditCompra({ ...mEditCompra, motivo: e.target.value })} />
            </Campo>
            <p className="texto-suave">No se puede fijar la cantidad por debajo de lo ya recibido neto. Cambios materiales con aprobación obligatoria exigen nueva aprobación.</p>
            <MensajeError texto={mError} />
            <div className="modal-acciones">
              <button type="button" className="boton-secundario" onClick={() => setMEditCompra(null)}>Cancelar</button>
              <button type="submit" className="boton-primario" disabled={ocupado}>Guardar cambios</button>
            </div>
          </Formulario>
        ) : null}
      </Modal>

      <Modal titulo="Registrar movimiento" ocupado={ocupado} abierto={!!mMov} alCerrar={() => setMMov(null)}>
        {mMov ? (
          <Formulario className="formulario" onSubmit={registrarMovimiento}>
            <Campo etiqueta="Tipo de movimiento" requerido>
              <select value={mMov.tipo} onChange={(e) => setMMov({ ...mMov, tipo: e.target.value as typeof mMov.tipo })}>
                <option value="recepcion">Recepción del proveedor</option>
                <option value="entrega">Entrega al solicitante (desde almacén)</option>
                <option value="entrega_directa">Entrega directa (recepción + entrega en un paso)</option>
                <option value="devolucion_proveedor">Devolución al proveedor</option>
                <option value="retorno_solicitante">Retorno del solicitante</option>
              </select>
            </Campo>
            <div className="fila-campos">
              <Campo etiqueta="Cantidad" requerido>
                <input inputMode="decimal" data-numero="true" data-positivo="true" value={mMov.cantidad} onChange={(e) => setMMov({ ...mMov, cantidad: e.target.value })} />
              </Campo>
              <Campo etiqueta="Fecha efectiva (declarada)" requerido>
                <input type="date" value={mMov.fecha} onChange={(e) => setMMov({ ...mMov, fecha: e.target.value })} />
              </Campo>
            </div>
            <Campo etiqueta={mMov.tipo.startsWith('entrega') ? 'Quién recibe (obligatorio en entregas)' : 'Contraparte (origen/destino)'}>
              <input value={mMov.contraparte} onChange={(e) => setMMov({ ...mMov, contraparte: e.target.value })} />
            </Campo>
            <Campo etiqueta={['devolucion_proveedor', 'retorno_solicitante'].includes(mMov.tipo) ? 'Motivo/observación (obligatorio)' : 'Observación'}>
              <textarea rows={2} value={mMov.observacion} onChange={(e) => setMMov({ ...mMov, observacion: e.target.value })} />
            </Campo>
            {mMov.tipo === 'devolucion_proveedor' ? (
              <label className="campo"><span className="campo-etiqueta">
                <input type="checkbox" checked={mMov.reposicion} onChange={(e) => setMMov({ ...mMov, reposicion: e.target.checked })} />
                {' '}El proveedor repondrá las unidades devueltas
              </span></label>
            ) : null}
            <p className="texto-suave">
              La fecha técnica la fija el servidor. Saldos actuales: {fmtCantidad(saldos.disponible)} en almacén,
              {' '}{fmtCantidad(saldos.entregado)} entregado, {fmtCantidad(saldos.pendiente)} por llegar.
            </p>
            <MensajeError texto={mError} />
            <div className="modal-acciones">
              <button type="button" className="boton-secundario" onClick={() => setMMov(null)}>Cancelar</button>
              <button type="submit" className="boton-primario" disabled={ocupado}>{ocupado ? 'Guardando…' : 'Registrar'}</button>
            </div>
          </Formulario>
        ) : null}
      </Modal>

      <Modal titulo="Registrar novedad" ocupado={ocupado} abierto={!!mNov} alCerrar={() => setMNov(null)}>
        {mNov ? (
          <Formulario className="formulario" onSubmit={async (e) => {
            e.preventDefault(); setMError(null);
            try {
              if (mNov.descripcion.trim().length < 5) throw new Error('Describe la novedad (mínimo 5 caracteres).');
              const { error: e1 } = await supabase.from('novedades').insert({
                articulo_id: a.id, tipo: mNov.tipo, descripcion: mNov.descripcion.trim()
              });
              if (e1) throw new Error(limpiarError(e1.message));
              setMNov(null); setExito('Novedad registrada.'); await cargar();
            } catch (err) { setMError(err instanceof Error ? err.message : String(err)); }
          }}>
            <Campo etiqueta="Tipo" requerido>
              <select value={mNov.tipo} onChange={(e) => setMNov({ ...mNov, tipo: e.target.value as TipoNovedad })}>
                <option value="datos_incompletos">Datos incompletos</option>
                <option value="producto_mal_solicitado">Producto mal solicitado</option>
                <option value="entrega_incorrecta">Entrega incorrecta</option>
                <option value="observacion">Observación general</option>
              </select>
            </Campo>
            <Campo etiqueta="Descripción" requerido>
              <textarea rows={3} value={mNov.descripcion} onChange={(e) => setMNov({ ...mNov, descripcion: e.target.value })} />
            </Campo>
            <MensajeError texto={mError} />
            <div className="modal-acciones">
              <button type="button" className="boton-secundario" onClick={() => setMNov(null)}>Cancelar</button>
              <button type="submit" className="boton-primario">Registrar</button>
            </div>
          </Formulario>
        ) : null}
      </Modal>
    </div>
  );
}
