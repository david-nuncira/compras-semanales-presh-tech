// Pedido de MANTENIMIENTO: la hoja «Formato solicitud de compra» hecha en pantalla, sin Excel ni archivos.
//   1. El solicitante llena cantidad, artículo, destino, imagen, justificación y descripción (columnas B a G).
//   2. Compras envía a cotizar y captura el precio de cada proveedor (columnas H a J).
//   3. El aprobador aprueba lo elegido (mínimo y total, columnas K y L); si la compra supera el límite, aprueba gerencia.
//   4. Con lo aprobado (en verde) se genera la orden de compra por proveedor.
// Todo usa las funciones que ya existen en el servidor; las reglas de montos y permisos las valida el servidor.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { supabase, rpc, limpiarError, nuevoOp } from '../supabase.ts';
import { useSesion } from '../contexto/Sesion.tsx';
import { useCatalogos, listarPerfiles } from '../datos.ts';
import type { PerfilBreve } from '../datos.ts';
import { usePermisos } from '../permisos.ts';
import type { Aprobacion, Cotizacion, VArticulo, VSolicitud } from '../tipos.ts';
import {
  Boton, BotonConMotivo, EstadoError, EstadoVacio, Esqueleto, Icono, MensajeError, MensajeExito, ModalConfirmar
} from '../componentes/UI.tsx';
import { MiniaturaArticulo, useAdjuntosArticulos } from '../componentes/Miniatura.tsx';
import { EncabezadoFormato } from '../componentes/FormatoSolicitud.tsx';
import { construirMatriz, type FilaMatriz } from '../util/matriz.ts';
import { esCentroMantenimiento, estadoPasosMantenimiento, PASOS_MANTENIMIENTO } from '../util/mantenimiento.ts';
import { fmtFecha, hoyBogotaISO } from '../util/fechas.ts';
import { fmtCantidad, fmtMoneda, parseNumero, redondear2 } from '../util/moneda.ts';

const pesos = (n: number | null) => (n === null ? '—' : fmtMoneda(n, 'COP'));
const COMPRADAS = ['comprado', 'en_transito', 'recibido_parcial', 'recibido_total', 'cerrado'];
const importeDe = (c: Cotizacion) => redondear2(c.precio_unitario * c.cantidad) + c.impuestos + c.otros_cargos - c.descuentos;

type EstadoFila = 'comprado' | 'sin_elegir' | 'sin_solicitud' | 'espera' | 'rechazado' | 'aprobado';

interface Config { gerente_id: string | null; suplente_id: string | null; umbral_cop: number }

/** Ejecuta una operación por elemento, una tras otra, y reporta qué salió bien y qué no. */
async function enSecuencia<T>(items: T[], f: (x: T) => Promise<void>, etiqueta: (x: T) => string) {
  let ok = 0; const fallos: string[] = [];
  for (const x of items) {
    try { await f(x); ok += 1; } catch (e) { fallos.push(`${etiqueta(x)}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return { ok, fallos };
}

/** Celda de precio editable: se guarda al salir del campo o con Enter. */
function CeldaPrecio({ valor, etiqueta, editable, guardando, alGuardar }: {
  valor: number | undefined; etiqueta: string; editable: boolean; guardando: boolean; alGuardar: (n: number) => void;
}) {
  const [texto, setTexto] = useState(valor === undefined ? '' : String(valor));
  const ref = useRef(valor);
  useEffect(() => { if (ref.current !== valor) { ref.current = valor; setTexto(valor === undefined ? '' : String(valor)); } }, [valor]);
  if (!editable) return <span>{valor === undefined ? <span className="texto-suave">— <span className="solo-lectores">sin cotizar</span></span> : pesos(valor)}</span>;
  const confirmar = () => {
    const n = parseNumero(texto);
    if (texto.trim() === '' || n === null || n < 0 || n === valor) { setTexto(valor === undefined ? '' : String(valor)); return; }
    alGuardar(n);
  };
  return (
    <input className="celda-editable" inputMode="decimal" value={texto} aria-label={etiqueta} placeholder="—" disabled={guardando}
      onChange={(e) => setTexto(e.target.value)} onBlur={confirmar}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }} />
  );
}

export function PedidoMantenimiento() {
  const { id } = useParams<{ id: string }>();
  const { perfil } = useSesion();
  const permisos = usePermisos();
  const { cat } = useCatalogos(true);
  const [sol, setSol] = useState<VSolicitud | null>(null);
  const [articulos, setArticulos] = useState<VArticulo[] | null>(null);
  const [cotizaciones, setCotizaciones] = useState<Cotizacion[]>([]);
  const [aprobaciones, setAprobaciones] = useState<Aprobacion[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [personas, setPersonas] = useState<PerfilBreve[]>([]);
  const [extras, setExtras] = useState<string[]>([]);
  const [nuevoProveedor, setNuevoProveedor] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [noEncontrada, setNoEncontrada] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [fechaCompra, setFechaCompra] = useState(hoyBogotaISO());
  const [referencia, setReferencia] = useState('');
  const [fechaLlegada, setFechaLlegada] = useState('');
  const [confirmarOrden, setConfirmarOrden] = useState(false);

  const cargar = useCallback(async () => {
    if (!id) return;
    setError(null);
    const [rs, ra, rc] = await Promise.all([
      supabase.from('v_solicitudes').select('*').eq('id', id).maybeSingle(),
      supabase.from('v_articulos').select('*').eq('solicitud_id', id).neq('etapa', 'cancelado').order('creado_en'),
      supabase.rpc('fn_configuracion_aprobaciones')
    ]);
    if (rs.error || ra.error) { setError(limpiarError((rs.error ?? ra.error)!.message)); return; }
    if (!rs.data) { setNoEncontrada(true); return; }
    const arts = (ra.data ?? []) as VArticulo[];
    setSol(rs.data as VSolicitud); setArticulos(arts);
    if (!rc.error && rc.data) setConfig(rc.data as Config);
    const cots: Cotizacion[] = []; const aps: Aprobacion[] = [];
    for (let i = 0; i < arts.length; i += 80) {
      const ids = arts.slice(i, i + 80).map((a) => a.id);
      const [c, a] = await Promise.all([
        supabase.from('cotizaciones').select('*').in('articulo_id', ids).order('creado_en'),
        supabase.from('aprobaciones').select('*').in('articulo_id', ids).eq('es_vigente', true)
      ]);
      if (c.error) { setError(limpiarError(c.error.message)); return; }
      cots.push(...((c.data ?? []) as Cotizacion[])); aps.push(...((a.data ?? []) as Aprobacion[]));
    }
    setCotizaciones(cots); setAprobaciones(aps);
  }, [id]);

  useEffect(() => { void cargar(); }, [cargar]);
  useEffect(() => { listarPerfiles().then(setPersonas).catch(() => {}); }, []);

  const esMtto = !!sol && esCentroMantenimiento({ codigo: sol.centro_costo_codigo, nombre: sol.centro_costo_nombre });
  const umbral = config?.umbral_cop ?? 500000;
  const nombreProveedor = useMemo(() => new Map((cat?.proveedores ?? []).map((p) => [p.id, p.nombre])), [cat]);
  const nombreCentro = useMemo(() => new Map((cat?.centros ?? []).map((c) => [c.id, c.nombre || c.codigo])), [cat]);
  const nombrePersona = (pid: string | null | undefined) => personas.find((p) => p.id === pid)?.nombre ?? 'el aprobador designado';

  const matriz = useMemo(() => construirMatriz(
    (articulos ?? []).map((a) => ({ id: a.id, cantidad: a.cantidad })),
    cotizaciones.map((c) => ({ id: c.id, articulo_id: c.articulo_id, proveedor_id: c.proveedor_id, moneda: c.moneda,
      precio_unitario: Number(c.precio_unitario), es_seleccionada: c.es_seleccionada, creado_en: c.creado_en })),
    (cat?.proveedores ?? []).map((p) => p.id)
  ), [articulos, cotizaciones, cat]);
  const proveedoresCols = useMemo(() => [...matriz.proveedoresIds, ...extras.filter((e) => !matriz.proveedoresIds.includes(e))], [matriz, extras]);
  const { porArticulo } = useAdjuntosArticulos((articulos ?? []).map((a) => a.id));

  const filaDe = useMemo(() => new Map(matriz.filas.map((f) => [f.articuloId, f])), [matriz]);
  const elegida = (aid: string) => cotizaciones.find((c) => c.articulo_id === aid && c.es_seleccionada) ?? null;
  const aprobDe = (aid: string) => aprobaciones.find((a) => a.articulo_id === aid && a.es_vigente) ?? null;
  const requiereGerencia = (c: Cotizacion) => c.moneda.trim() !== 'COP' || importeDe(c) > umbral;

  /** Situación de cada artículo frente a la hoja. */
  const estadoDe = useCallback((a: VArticulo): EstadoFila => {
    if (COMPRADAS.includes(a.etapa)) return 'comprado';
    const c = elegida(a.id);
    if (!c) return 'sin_elegir';
    if (!requiereGerencia(c)) return 'aprobado';
    const ap = aprobDe(a.id);
    if (!ap) return 'sin_solicitud';
    if (ap.estado === 'aprobada') return 'aprobado';
    if (ap.estado === 'rechazada') return 'rechazado';
    return 'espera';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cotizaciones, aprobaciones, umbral]);

  const resumen = useMemo(() => {
    const arts = articulos ?? [];
    const estados = arts.map((a) => ({ a, e: estadoDe(a) }));
    return {
      estados,
      pasos: estadoPasosMantenimiento({
        total: arts.length,
        enCotizacionOMas: arts.filter((a) => !['borrador', 'solicitado'].includes(a.etapa)).length,
        conCotizacion: arts.filter((a) => Object.keys(filaDe.get(a.id)?.celdas ?? {}).length > 0).length,
        seleccionados: estados.filter(({ a, e }) => e !== 'sin_elegir' || COMPRADAS.includes(a.etapa)).length,
        aprobados: estados.filter(({ e }) => e === 'aprobado' || e === 'comprado').length,
        comprados: estados.filter(({ e }) => e === 'comprado').length
      })
    };
  }, [articulos, estadoDe, filaDe]);

  if (!id) return null;
  if (error && !sol) return <div className="contenido"><EstadoError mensaje={error} alReintentar={() => void cargar()} /></div>;
  if (noEncontrada) return <div className="contenido"><EstadoVacio titulo="Solicitud no encontrada" texto="No existe o tu cuenta no tiene permiso para verla."
    accion={<Link className="boton-secundario enlace-boton" to="/gestion">Ir a Gestión de compras</Link>} /></div>;
  if (!sol || !articulos) return <div className="contenido"><Esqueleto lineas={8} etiqueta="Cargando la hoja de mantenimiento…" /></div>;
  // Compras semanales sigue el flujo normal: se gestiona por artículo.
  if (!esMtto) return <Navigate to={`/solicitudes/${sol.id}/cotizaciones`} replace />;

  const esGestor = permisos.gestor;
  const soyAprobador = permisos.aprobadorCotizacion;
  const yo = perfil?.id ?? '';
  const arts = articulos;
  const aprobadores = [...new Set(aprobaciones.filter((a) => a.estado === 'aprobada').map((a) => nombrePersona(a.aprobador_id)))];
  const puedeCotizar = (a: VArticulo) => esGestor && ['en_cotizacion', 'cotizado'].includes(a.etapa);
  const porEnviar = arts.filter((a) => a.etapa === 'solicitado');
  const sinElegirConPrecio = arts.filter((a) => a.etapa === 'cotizado' || a.etapa === 'en_cotizacion')
    .filter((a) => !elegida(a.id) && filaDe.get(a.id)?.minimo !== null && filaDe.get(a.id)?.minimo !== undefined);
  const propias = aprobaciones.filter((a) => a.estado === 'pendiente' && a.aprobador_id === yo);
  const aprobadasListas = resumen.estados.filter(({ a, e }) => e === 'aprobado' && !COMPRADAS.includes(a.etapa) && a.etapa === 'cotizado');
  const totalElegido = arts.reduce((s, a) => { const c = elegida(a.id); return s + (c && !COMPRADAS.includes(a.etapa) ? importeDe(c) : 0); }, 0);
  const superan = arts.filter((a) => { const c = elegida(a.id); return !!c && !COMPRADAS.includes(a.etapa) && requiereGerencia(c); });
  const gerente = nombrePersona(config?.gerente_id ?? null);

  async function ejecutar(clave: string, f: () => Promise<void>, textoOk: string) {
    if (ocupado) return;
    setOcupado(clave); setErrMsg(null); setOkMsg(null);
    try { await f(); setOkMsg(textoOk); } catch (e) { setErrMsg(e instanceof Error ? e.message : String(e)); }
    finally { setOcupado(null); await cargar(); }
  }
  async function lote<T>(clave: string, items: T[], f: (x: T) => Promise<void>, etiqueta: (x: T) => string, textoOk: (n: number) => string) {
    if (ocupado) return;
    setOcupado(clave); setErrMsg(null); setOkMsg(null);
    const r = await enSecuencia(items, f, etiqueta);
    if (r.ok > 0) setOkMsg(textoOk(r.ok));
    if (r.fallos.length > 0) setErrMsg(`${r.fallos.length} no se pudo(ieron): ${r.fallos.join(' · ')}`);
    setOcupado(null); await cargar();
  }

  const enviarACotizar = () => lote('enviar', porEnviar,
    (a) => rpc('fn_cambiar_etapa', { p_articulo: a.id, p_hacia: 'en_cotizacion', p_motivo: null, p_version: a.version }).then(() => undefined),
    (a) => a.nombre, (n) => `${n} artículo(s) enviados a cotizar.`);

  async function guardarPrecio(a: VArticulo, proveedorId: string, precio: number) {
    const clave = `${a.id}|${proveedorId}`;
    setGuardando(clave); setErrMsg(null);
    try {
      const { error: e } = await supabase.from('cotizaciones').insert({
        id: crypto.randomUUID(), articulo_id: a.id, proveedor_id: proveedorId, moneda: 'COP', precio_unitario: precio,
        cantidad: a.cantidad, impuestos: 0, descuentos: 0, otros_cargos: 0, notas: null
      });
      if (e) throw new Error(limpiarError(e.message));
      setOkMsg(`Precio guardado: ${a.nombre} · ${nombreProveedor.get(proveedorId) ?? 'proveedor'} · ${pesos(precio)}.`);
    } catch (e) { setErrMsg(e instanceof Error ? e.message : String(e)); }
    finally { setGuardando(null); await cargar(); }
  }

  const elegir = (a: VArticulo, cotizacionId: string) => ejecutar(`elegir|${a.id}`,
    () => rpc('fn_seleccionar_cotizacion', { p_cotizacion: cotizacionId, p_version_articulo: a.version }).then(() => undefined),
    'Proveedor elegido. Si supera el límite, se envió a gerencia para su aprobación.');

  const elegirMinimos = () => lote('minimos', sinElegirConPrecio, async (a) => {
    const f = filaDe.get(a.id); const celda = f ? Object.values(f.celdas).find((c) => c.esMinimo && c.cotizacionId) : undefined;
    if (!celda?.cotizacionId) throw new Error('no hay una cotización mínima para elegir');
    await rpc('fn_seleccionar_cotizacion', { p_cotizacion: celda.cotizacionId, p_version_articulo: a.version });
  }, (a) => a.nombre, (n) => `${n} proveedor(es) elegidos (el más barato de cada fila).`);

  const decidir = (ap: Aprobacion, aprobar: boolean, comentario: string | null) =>
    rpc('fn_decidir_aprobacion', { p_aprobacion: ap.id, p_aprobar: aprobar, p_comentario: comentario, p_op: nuevoOp() }).then(() => undefined);
  const aprobarTodo = () => lote('aprobar', propias, (ap) => decidir(ap, true, null),
    (ap) => arts.find((a) => a.id === ap.articulo_id)?.nombre ?? 'artículo', (n) => `${n} aprobación(es) registradas.`);
  const pedirAprobacion = (a: VArticulo) => ejecutar(`pedir|${a.id}`,
    () => rpc('fn_solicitar_aprobacion', { p_articulo: a.id, p_op: nuevoOp() }).then(() => undefined), 'Aprobación enviada al responsable designado.');

  const registrarOrden = () => lote('orden', aprobadasListas.map(({ a }) => a), async (a) => {
    const c = elegida(a.id);
    if (!c) throw new Error('no tiene cotización elegida');
    await rpc('fn_registrar_compra', {
      p_articulo: a.id, p_cantidad: c.cantidad, p_fecha_compra: fechaCompra, p_impuestos: c.impuestos, p_descuentos: c.descuentos,
      p_otros_cargos: c.otros_cargos, p_referencia: referencia.trim() || null, p_fecha_estimada: fechaLlegada || null,
      p_version_articulo: a.version, p_op: nuevoOp()
    });
  }, (a) => a.nombre, (n) => `Orden de compra registrada: ${n} artículo(s) comprados.`);

  // ---- Orden de compra: lo aprobado (por registrar) y lo ya comprado, agrupado por proveedor ----
  interface LineaOrden { id: string; nombre: string; cantidad: number; unidad: string; precio: number; total: number; registrada: boolean }
  const ordenPorProveedor = new Map<string, LineaOrden[]>();
  for (const { a, e } of resumen.estados) {
    if (e === 'comprado') {
      const k = a.proveedor_nombre ?? 'Proveedor';
      (ordenPorProveedor.get(k) ?? ordenPorProveedor.set(k, []).get(k)!).push({
        id: a.id, nombre: a.nombre, cantidad: a.cantidad_comprada ?? a.cantidad, unidad: a.unidad, precio: a.precio_unitario ?? 0, total: a.total ?? 0, registrada: true });
    } else if (e === 'aprobado') {
      const c = elegida(a.id); if (!c) continue;
      const k = nombreProveedor.get(c.proveedor_id) ?? 'Proveedor';
      (ordenPorProveedor.get(k) ?? ordenPorProveedor.set(k, []).get(k)!).push({
        id: a.id, nombre: a.nombre, cantidad: c.cantidad, unidad: a.unidad, precio: c.precio_unitario, total: importeDe(c), registrada: false });
    }
  }
  const totalOrden = [...ordenPorProveedor.values()].flat().reduce((s, l) => s + l.total, 0);

  const imprimir = () => {
    document.body.classList.add('imprimiendo-orden');
    const quitar = () => { document.body.classList.remove('imprimiendo-orden'); window.removeEventListener('afterprint', quitar); };
    window.addEventListener('afterprint', quitar); window.print();
  };

  const celdaEstado = (a: VArticulo, e: EstadoFila) => {
    const c = elegida(a.id);
    switch (e) {
      case 'comprado': return <span className="insignia insignia-exito"><Icono nombre="check-circulo" tam={14} />Comprado</span>;
      case 'aprobado': return <span className="insignia insignia-exito"><Icono nombre="check-circulo" tam={14} />Aprobado{c && !requiereGerencia(c) ? ' (no requiere más)' : ''}</span>;
      case 'espera': return <span className="insignia insignia-aviso"><Icono nombre="reloj" tam={14} />Espera a {nombrePersona(aprobDe(a.id)?.aprobador_id)}</span>;
      case 'rechazado': return <span className="insignia insignia-error"><Icono nombre="x-circulo" tam={14} />Rechazado{aprobDe(a.id)?.comentario ? `: ${aprobDe(a.id)!.comentario}` : ''}</span>;
      case 'sin_solicitud': return <span className="insignia insignia-aviso"><Icono nombre="alerta" tam={14} />Falta enviar a gerencia</span>;
      default: return <span className="insignia insignia-neutro"><Icono nombre="documento" tam={14} />Sin elegir</span>;
    }
  };

  return (
    <div className="contenido contenido-ancho pagina-hoja">
      <p><Link to="/gestion">← Gestión de compras</Link> · <Link to={`/solicitudes/${sol.id}`}>{sol.numero}</Link></p>
      <h1>Pedido de mantenimiento · {sol.numero}</h1>
      <MensajeExito texto={okMsg} />
      <MensajeError texto={errMsg} />

      <ol className="pasos pasos-hoja" aria-label="Pasos del pedido de mantenimiento">
        {PASOS_MANTENIMIENTO.map((p, i) => {
          const est = resumen.pasos[i];
          return (
            <li key={p.clave} className={est === 'actual' ? 'paso-actual' : est === 'hecho' ? 'paso-hecho' : ''} aria-current={est === 'actual' ? 'step' : undefined}>
              <div><span className="paso-numero">{est === 'hecho' ? <Icono nombre="check" tam={14} /> : i + 1}</span> <b>{p.titulo}</b></div>
              <small>{p.quien}</small>
            </li>
          );
        })}
      </ol>

      {(() => { const k = resumen.pasos.findIndex((x) => x === 'actual'); const p = PASOS_MANTENIMIENTO[k]; return p
        ? <p className="guia-paso" role="status"><Icono nombre="info" /> <b>Ahora toca: {p.titulo}.</b> {p.quien}: {p.detalle}</p>
        : <p className="guia-paso" role="status"><Icono nombre="check-circulo" /> <b>Pedido completo.</b> Todos los pasos están hechos.</p>; })()}
      <EncabezadoFormato sol={sol} aprobadoPor={aprobadores.length ? aprobadores.join(', ') : null} />

      {esGestor ? (
        <div className="acciones-fila acciones-hoja">
          {porEnviar.length > 0 ? <Boton variante="primario" cargando={ocupado === 'enviar'} onClick={() => void enviarACotizar()}>
            Enviar a proveedores para cotizar ({porEnviar.length})</Boton> : null}
          <label className="campo-inline">Proveedor a cotizar
            <select value={nuevoProveedor} onChange={(e) => setNuevoProveedor(e.target.value)}>
              <option value="">— Agregar columna —</option>
              {(cat?.proveedores ?? []).filter((p) => p.activo && !proveedoresCols.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </label>
          <Boton disabled={!nuevoProveedor} onClick={() => { setExtras((x) => [...x, nuevoProveedor]); setNuevoProveedor(''); }}>Agregar proveedor</Boton>
          {sinElegirConPrecio.length > 0 ? <Boton cargando={ocupado === 'minimos'} onClick={() => void elegirMinimos()}>
            Elegir el más barato de cada artículo ({sinElegirConPrecio.length})</Boton> : null}
        </div>
      ) : null}
      {porEnviar.length > 0 && !esGestor ? <p className="texto-suave">Compras aún no envía estos artículos a cotizar.</p> : null}

      {arts.length === 0 ? <EstadoVacio titulo="Este pedido no tiene artículos" /> : (
        <div className="matriz-envoltura" tabIndex={0} role="region" aria-label="Hoja de mantenimiento; se desplaza dentro de este recuadro">
          <table className="tabla matriz">
            <caption className="solo-lectores">Artículos, cotización de cada proveedor, mínimo, total y estado de aprobación</caption>
            <thead>
              <tr>
                <th scope="col" className="matriz-fija matriz-c1">Cant.</th>
                <th scope="col" className="matriz-fija matriz-c2">Nombre artículo</th>
                <th scope="col">Centro de costo</th>
                <th scope="col">Imagen</th>
                <th scope="col">Justificación</th>
                <th scope="col">Descripción (medidas, color, material)</th>
                {proveedoresCols.map((p) => <th scope="col" key={p} className="numero">{nombreProveedor.get(p) ?? 'Proveedor'}</th>)}
                <th scope="col" className="numero">Mínimo</th>
                <th scope="col" className="numero">Total</th>
                <th scope="col">Estado</th>
                <th scope="col">Acción</th>
              </tr>
            </thead>
            <tbody>
              {arts.map((a) => {
                const f: FilaMatriz = filaDe.get(a.id)!;
                const e = estadoDe(a);
                const c = elegida(a.id);
                const ap = aprobDe(a.id);
                const verde = e === 'aprobado' || e === 'comprado';
                return (
                  <tr key={a.id}>
                    <td className="matriz-fija matriz-c1 numero">{fmtCantidad(a.cantidad)}</td>
                    <td className="matriz-fija matriz-c2">{a.nombre}</td>
                    <td>{nombreCentro.get(a.centro_costo_id ?? '') ?? '—'}</td>
                    <td><MiniaturaArticulo nombre={a.nombre} adjuntos={porArticulo[a.id]} /></td>
                    <td className="celda-recortada">{a.justificacion ?? '—'}</td>
                    <td className="celda-recortada">{a.descripcion}{a.referencia ? <span className="texto-suave"> · ref. {a.referencia}</span> : null}</td>
                    {proveedoresCols.map((p) => {
                      const celda = f.celdas[p];
                      const esElegida = !!celda?.seleccionada;
                      const editable = puedeCotizar(a) && !esElegida;
                      return (
                        <td key={p} className={`numero${esElegida ? (verde ? ' matriz-sel' : ' matriz-espera') : ''}`}>
                          <span className="matriz-precio">
                            <CeldaPrecio valor={celda?.precio} editable={editable} guardando={guardando === `${a.id}|${p}`}
                              etiqueta={`Precio de ${nombreProveedor.get(p) ?? 'proveedor'} para ${a.nombre}`} alGuardar={(n) => void guardarPrecio(a, p, n)} />
                            {esElegida ? <span className={`matriz-marca ${verde ? 'matriz-marca-sel' : 'matriz-marca-espera'}`}>
                              <Icono nombre={verde ? 'check-circulo' : 'reloj'} tam={13} /> {verde ? 'Aprobada' : 'Elegida'}</span> : null}
                            {celda?.esMinimo && !esElegida ? <span className="matriz-marca matriz-marca-min">mínimo</span> : null}
                            {esGestor && celda?.cotizacionId && !esElegida && puedeCotizar(a) && !c ? (
                              <button type="button" className="boton-silencioso" disabled={!!ocupado} onClick={() => void elegir(a, celda.cotizacionId!)}>Elegir</button>
                            ) : null}
                          </span>
                        </td>
                      );
                    })}
                    <td className="numero">{pesos(f.minimo)}</td>
                    <td className="numero"><b>{pesos(f.total)}</b></td>
                    <td>{celdaEstado(a, e)}</td>
                    <td>
                      {ap && ap.estado === 'pendiente' && ap.aprobador_id === yo ? (
                        <div className="acciones-fila">
                          <Boton variante="primario" disabled={!!ocupado} onClick={() => void ejecutar(`ap|${a.id}`, () => decidir(ap, true, null), 'Aprobación registrada.')}>Aprobar</Boton>
                          <BotonConMotivo etiqueta="Rechazar" clase="boton-peligro" titulo={`Rechazar ${a.nombre}`} descripcion="Explica el motivo: Compras lo verá."
                            onConfirmar={async (motivo) => { await decidir(ap, false, motivo); await cargar(); }} />
                        </div>
                      ) : e === 'sin_solicitud' && esGestor ? (
                        <Boton disabled={!!ocupado} onClick={() => void pedirAprobacion(a)}>Pedir aprobación</Boton>
                      ) : c && esGestor && e !== 'comprado' ? <Link to={`/gestion/articulo/${a.id}`} className="texto-suave">Soportes</Link> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={6 + proveedoresCols.length} className="numero">Total (suma de los mínimos)</th>
                <td className="numero">—</td>
                <td className="numero"><b>{pesos(matriz.totalGeneral)}</b></td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {matriz.articulosSinCotizacion > 0 ? <p className="texto-suave">{matriz.articulosSinCotizacion} artículo(s) sin cotizar: no suman al total (no se cuentan como cero).</p> : null}

      {/* ---------- Totaliza la compra ---------- */}
      <section className="tarjeta" aria-labelledby="totaliza">
        <h2 id="totaliza">Totaliza la compra</h2>
        <div className="indicadores">
          <div className="indicador"><div className="indicador-titulo">Total de lo elegido</div><div className="indicador-valor">{pesos(totalElegido)}</div>
            <div className="texto-suave">{arts.filter((a) => elegida(a.id) && !COMPRADAS.includes(a.etapa)).length} de {arts.length} artículos con proveedor elegido</div></div>
          <div className="indicador"><div className="indicador-titulo">Límite sin gerencia (por artículo)</div><div className="indicador-valor">{pesos(umbral)}</div>
            <div className="texto-suave">Lo que lo supera lo aprueba {gerente}.</div></div>
        </div>
        {superan.length > 0 ? (
          <div className="estimacion" role="status"><Icono nombre="info" /> {superan.length} artículo(s) superan el límite y necesitan aprobación de gerencia
            ({superan.map((a) => a.nombre).slice(0, 3).join(', ')}{superan.length > 3 ? '…' : ''}). Al elegir el proveedor, se envían solos.</div>
        ) : null}
        {soyAprobador && propias.length > 0 ? (
          <div className="acciones-fila"><Boton variante="primario" cargando={ocupado === 'aprobar'} onClick={() => void aprobarTodo()}>Aprobar todo lo que me corresponde ({propias.length})</Boton>
            <span className="texto-suave">Se aprueba artículo por artículo; si alguno falla se te avisa cuál.</span></div>
        ) : null}
      </section>

      {/* ---------- Orden de compra ---------- */}
      <section className="tarjeta orden-compra" aria-labelledby="orden">
        <h2 id="orden">Orden de compra</h2>
        {ordenPorProveedor.size === 0 ? (
          <p className="texto-suave">Aún no hay artículos aprobados (en verde). Cuando el aprobador apruebe lo elegido, aparecerá aquí agrupado por proveedor.</p>
        ) : (
          <>
            <p className="texto-suave">Centro de costo: {sol.centro_costo_nombre ?? sol.centro_costo_codigo} · Pedido {sol.numero} · Elaborado por {sol.solicitante_nombre ?? '—'}{referencia ? ` · Orden ${referencia}` : ''}</p>
            {[...ordenPorProveedor.entries()].map(([prov, lineas]) => (
              <div key={prov} className="orden-proveedor">
                <h3>{prov}</h3>
                <div className="tabla-envoltura" tabIndex={0} role="region" aria-label={`Orden de compra para ${prov}`}>
                  <table className="tabla">
                    <caption className="solo-lectores">Artículos de la orden de compra para {prov}</caption>
                    <thead><tr><th scope="col">Cant.</th><th scope="col">Artículo</th><th scope="col" className="numero">Precio unitario</th><th scope="col" className="numero">Total</th><th scope="col">Estado</th></tr></thead>
                    <tbody>{lineas.map((l) => (
                      <tr key={l.id}><td className="numero">{fmtCantidad(l.cantidad)} {l.unidad}</td><td>{l.nombre}</td><td className="numero">{pesos(l.precio)}</td><td className="numero">{pesos(l.total)}</td>
                        <td>{l.registrada ? <span className="insignia insignia-exito"><Icono nombre="check-circulo" tam={14} />Registrada</span> : <span className="insignia insignia-aviso"><Icono nombre="reloj" tam={14} />Por registrar</span>}</td></tr>
                    ))}</tbody>
                    <tfoot><tr><th scope="row" colSpan={3} className="numero">Total {prov}</th><td className="numero"><b>{pesos(lineas.reduce((s, l) => s + l.total, 0))}</b></td><td /></tr></tfoot>
                  </table>
                </div>
              </div>
            ))}
            <p><b>Total de la orden: {pesos(totalOrden)}</b></p>
          </>
        )}
        {esGestor && aprobadasListas.length > 0 ? (
          <div className="formulario orden-formulario">
            <div className="fila-campos">
              <label className="campo-inline">Fecha de compra<input type="date" value={fechaCompra} onChange={(e) => setFechaCompra(e.target.value)} /></label>
              <label className="campo-inline">N.º de orden (opcional)<input value={referencia} maxLength={80} onChange={(e) => setReferencia(e.target.value)} /></label>
              <label className="campo-inline">Llegada estimada (opcional)<input type="date" value={fechaLlegada} onChange={(e) => setFechaLlegada(e.target.value)} /></label>
            </div>
            <div className="acciones-fila">
              <Boton variante="primario" disabled={!fechaCompra || !!ocupado} onClick={() => setConfirmarOrden(true)}>Generar la orden de compra con lo aprobado ({aprobadasListas.length})</Boton>
            </div>
          </div>
        ) : null}
        {ordenPorProveedor.size > 0 ? <div className="acciones-fila no-imprimir"><Boton onClick={imprimir}>Imprimir la orden</Boton></div> : null}
      </section>

      <ModalConfirmar abierto={confirmarOrden} titulo="Generar la orden de compra" etiqueta="Registrar la compra"
        texto={`Se registrará la compra de ${aprobadasListas.length} artículo(s) aprobados, por ${pesos(aprobadasListas.reduce((s, { a }) => { const c = elegida(a.id); return s + (c ? importeDe(c) : 0); }, 0))}, con fecha ${fmtFecha(fechaCompra)}. Después los artículos pasan a «comprado».`}
        alConfirmar={async () => { await registrarOrden(); }} alCerrar={() => setConfirmarOrden(false)} />
    </div>
  );
}
