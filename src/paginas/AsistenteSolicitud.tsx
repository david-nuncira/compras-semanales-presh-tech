// Nueva solicitud en 4 pasos: General · Artículos · Revisión · Envío.
// El borrador se guarda en la base desde el paso 1 (mismo mecanismo de siempre):
// cada artículo queda guardado al pulsar «Guardar», y se puede retomar después.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase, rpc, limpiarError, nuevoOp } from '../supabase.ts';
import { useSesion } from '../contexto/Sesion.tsx';
import { usePermisos } from '../permisos.ts';
import { useCatalogos, centrosDelArea } from '../datos.ts';
import type { VSolicitud, VArticulo } from '../tipos.ts';
import {
  Boton, Campo, EstadoError, Esqueleto, IndicadorGuardado, Icono, MensajeError, MensajeExito,
  ModalConfirmar, BotonConMotivo, SinPermiso
} from '../componentes/UI.tsx';
import { Adjuntos } from '../componentes/Adjuntos.tsx';
import { CalendarioSemanas } from '../componentes/CalendarioSemanas.tsx';
import { MiniaturaArticulo, useAdjuntosArticulos } from '../componentes/Miniatura.tsx';
import { etiquetaSemana, fmtFecha, fmtFechaHora, hoyBogotaISO, lunesProximaSemana } from '../util/fechas.ts';
import { fmtCantidad, parseNumero } from '../util/moneda.ts';
import { validarArticulo, centroInicial, solicitanteEdita, type ArticuloForm } from '../util/validaciones.ts';
import { mensajeEnvio, type Estimacion, type RespuestaEnvio } from '../util/envio.ts';

interface FormArticulo extends ArticuloForm { id?: string; version?: number }

const PASOS = ['General', 'Artículos', 'Revisión', 'Envío'] as const;

function articuloVacio(unidad: string): FormArticulo {
  return {
    nombre: '', descripcion: '', cantidad: '1', unidad, prioridad: 'media',
    fecha_requerida: '', justificacion: '', enlace_referencia: '', proveedor_sugerido: ''
  };
}

export function AsistenteSolicitud() {
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const navegar = useNavigate();
  const { perfil } = useSesion();
  const permisos = usePermisos();
  const { cat } = useCatalogos();
  const titulo = useRef<HTMLHeadingElement>(null);

  const pasoUrl = parseInt(params.get('paso') ?? '', 10);
  const paso = !id ? 1 : Math.min(4, Math.max(1, Number.isFinite(pasoUrl) ? pasoUrl : 2));
  const irAPaso = useCallback((n: number) => setParams({ paso: String(n) }, { replace: true }), [setParams]);

  const [sol, setSol] = useState<VSolicitud | null>(null);
  const [articulos, setArticulos] = useState<VArticulo[]>([]);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [cargando, setCargando] = useState(!!id);
  const [guardadoEn, setGuardadoEn] = useState<number | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [refrescoFotos, setRefrescoFotos] = useState(0);

  // ---- Paso 1 ----
  const areaId = perfil?.area_id ?? null;
  const areaNombre = perfil?.area_nombre ?? cat?.areas.find((a) => a.id === areaId)?.nombre ?? null;
  const centros = useMemo(() => centrosDelArea(cat, areaId), [cat, areaId]);
  const inicialCC = centroInicial(centros.map((c) => c.id));
  const [ccId, setCcId] = useState('');
  const [categoria, setCategoria] = useState('');
  const [justificacion, setJustificacion] = useState('');
  const [semana, setSemana] = useState(lunesProximaSemana());
  const [extra, setExtra] = useState(false);
  const [motivoExtra, setMotivoExtra] = useState('');
  const [tocadosG, setTocadosG] = useState<Record<string, boolean>>({});
  const [intentoG, setIntentoG] = useState(false);
  const [errorPaso, setErrorPaso] = useState<string | null>(null);

  useEffect(() => { if (!id && !ccId) setCcId(inicialCC.valor); }, [id, inicialCC.valor, ccId]);

  const erroresG: Record<string, string> = {};
  if (!areaId) erroresG.area = 'Tu usuario no tiene área asignada. Pide a administración que te vincule.';
  if (!ccId) erroresG.cc = centros.length === 0
    ? 'Tu área no tiene centros de costo autorizados. Avisa a administración.' : 'Elige el centro de costo.';
  if (extra && motivoExtra.trim().length < 10) erroresG.motivoExtra = 'Describe la emergencia (mínimo 10 caracteres).';
  const verG = (k: string) => (tocadosG[k] || intentoG ? erroresG[k] : undefined);
  const tocarG = (k: string) => setTocadosG((t) => ({ ...t, [k]: true }));

  // ---- Paso 2 ----
  const unidades = cat?.unidades ?? [];
  const unidadesActivas = unidades.map((u) => u.nombre);
  const unidadInicial = unidades.find((u) => u.nombre.toLowerCase() === 'unidad')?.nombre ?? unidades[0]?.nombre ?? '';
  const [form, setForm] = useState<FormArticulo>(() => articuloVacio(''));
  const [tocadosA, setTocadosA] = useState<Record<string, boolean>>({});
  const [intentoA, setIntentoA] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [recien, setRecien] = useState<string | null>(null);
  const [porEliminar, setPorEliminar] = useState<VArticulo | null>(null);
  const nombreRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setForm((f) => (f.unidad || f.id ? f : { ...f, unidad: unidadInicial })); }, [unidadInicial]);

  const erroresA = validarArticulo(form, unidadesActivas, hoyBogotaISO());
  const verA = (k: keyof ArticuloForm) => (tocadosA[k] || intentoA ? erroresA[k] : undefined);
  const tocarA = (k: keyof ArticuloForm) => setTocadosA((t) => ({ ...t, [k]: true }));
  const formVirgen = form.nombre.trim() === '' && form.descripcion.trim() === '' && !form.id;

  // ---- Paso 3 y 4 ----
  const [estimacion, setEstimacion] = useState<Estimacion | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [enviada, setEnviada] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!id) return;
    const [rs, ra] = await Promise.all([
      supabase.from('v_solicitudes').select('*').eq('id', id).maybeSingle(),
      supabase.from('v_articulos').select('*').eq('solicitud_id', id).order('creado_en')
    ]);
    if (rs.error) { setErrorCarga(limpiarError(rs.error.message)); setCargando(false); return; }
    if (!rs.data) { setErrorCarga('No existe o tu cuenta no tiene permiso para verla.'); setCargando(false); return; }
    setErrorCarga(null);
    setSol(rs.data as VSolicitud);
    setArticulos(((ra.data ?? []) as VArticulo[]).filter((a) => a.etapa !== 'cancelado'));
    setCargando(false);
  }, [id]);

  useEffect(() => { void cargar(); }, [cargar]);
  useEffect(() => { titulo.current?.focus(); }, [paso]);

  const editable = !!sol && !!perfil && sol.solicitante_id === perfil.id && solicitanteEdita(sol.estado);
  const { porArticulo } = useAdjuntosArticulos(articulos.map((a) => a.id), refrescoFotos);

  // Fecha estimada de recepción por Compras: solo si existe la función (fn_estimar_envio).
  useEffect(() => {
    if (!sol || !editable || paso < 3) { setEstimacion(null); return; }
    supabase.rpc('fn_estimar_envio', { p_solicitud: sol.id }).then(({ data, error }) => {
      if (!error && data) setEstimacion(data as Estimacion);
    });
  }, [sol, editable, paso, articulos.length]);

  const ultimoCambio = useMemo(() => {
    const fechas = [sol?.creado_en, ...articulos.map((a) => a.creado_en)].filter((x): x is string => !!x).map((x) => Date.parse(x));
    return fechas.length ? Math.max(...fechas) : null;
  }, [sol, articulos]);
  const guardadoMostrado = guardadoEn ?? ultimoCambio;

  async function crearBorrador() {
    setIntentoG(true); setErrorPaso(null);
    if (Object.keys(erroresG).length > 0) return;
    setGuardando(true);
    try {
      const { data, error } = await supabase.from('solicitudes').insert({
        area_id: areaId, centro_costo_id: ccId, categoria_id: categoria || null,
        justificacion: justificacion.trim() || null, semana_lunes: semana,
        es_extraordinaria: extra, motivo_extraordinaria: extra ? motivoExtra.trim() : null
      }).select('id').single();
      if (error) throw new Error(limpiarError(error.message));
      setGuardadoEn(Date.now());
      navegar(`/nueva-solicitud/${(data as { id: string }).id}?paso=2`, { replace: true });
    } catch (e) {
      setErrorPaso(`No se pudo guardar el borrador: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setGuardando(false); }
  }

  async function guardarArticulo(): Promise<boolean> {
    if (!sol) return false;
    setIntentoA(true); setErrorPaso(null);
    if (Object.keys(erroresA).length > 0) {
      document.getElementById('formulario-articulo')?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return false;
    }
    const fila = {
      nombre: form.nombre.trim(), descripcion: form.descripcion.trim(), cantidad: parseNumero(form.cantidad),
      unidad: form.unidad.trim(), prioridad: form.prioridad, fecha_requerida: form.fecha_requerida || null,
      justificacion: form.justificacion.trim() || null, enlace_referencia: form.enlace_referencia.trim() || null,
      proveedor_sugerido: form.proveedor_sugerido.trim() || null
    };
    setGuardando(true);
    try {
      let nuevoId: string | null = null;
      if (form.id) {
        const { data, error } = await supabase.from('articulos').update(fila)
          .eq('id', form.id).eq('version', form.version ?? 0).select('id');
        if (error) throw new Error(limpiarError(error.message));
        if (!data || data.length === 0) throw new Error('El artículo fue modificado en otra sesión; recarga e intenta de nuevo.');
      } else {
        const { data, error } = await supabase.from('articulos').insert({ ...fila, solicitud_id: sol.id }).select('id').single();
        if (error) throw new Error(limpiarError(error.message));
        nuevoId = (data as { id: string }).id;
      }
      setGuardadoEn(Date.now());
      setAviso(form.id ? 'Artículo actualizado.' : 'Artículo guardado en el borrador. Aún no se ha enviado a nadie.');
      setRecien(nuevoId ?? form.id ?? null);
      setForm(articuloVacio(unidadInicial)); setTocadosA({}); setIntentoA(false);
      await cargar();
      return true;
    } catch (e) {
      setErrorPaso(`No se pudo guardar el artículo: ${e instanceof Error ? e.message : String(e)} Lo que escribiste sigue aquí.`);
      return false;
    } finally { setGuardando(false); }
  }

  function duplicar(a: VArticulo) {
    setForm({
      nombre: a.nombre, descripcion: a.descripcion ?? '', cantidad: String(a.cantidad), unidad: a.unidad,
      prioridad: a.prioridad, fecha_requerida: a.fecha_requerida ?? '', justificacion: a.justificacion ?? '',
      enlace_referencia: a.enlace_referencia ?? '', proveedor_sugerido: a.proveedor_sugerido ?? ''
    });
    setTocadosA({}); setIntentoA(false); setAviso('Copia lista: cambia lo que haga falta y guárdala.');
    nombreRef.current?.focus();
  }

  function editar(a: VArticulo) {
    setForm({
      id: a.id, version: a.version, nombre: a.nombre, descripcion: a.descripcion ?? '', cantidad: String(a.cantidad),
      unidad: a.unidad, prioridad: a.prioridad, fecha_requerida: a.fecha_requerida ?? '', justificacion: a.justificacion ?? '',
      enlace_referencia: a.enlace_referencia ?? '', proveedor_sugerido: a.proveedor_sugerido ?? ''
    });
    setTocadosA({}); setIntentoA(false); setAviso(null);
    nombreRef.current?.focus();
  }

  async function eliminar(a: VArticulo) {
    const { error } = await supabase.from('articulos').delete().eq('id', a.id);
    if (error) throw new Error(limpiarError(error.message));
    setGuardadoEn(Date.now());
    setAviso('Artículo eliminado del borrador.');
    await cargar();
  }

  async function enviar() {
    if (!sol) return;
    setEnviando(true); setErrorPaso(null);
    try {
      const r = sol.estado === 'borrador'
        ? await rpc<RespuestaEnvio>('fn_enviar_solicitud', { p_solicitud: sol.id, p_version: sol.version, p_op: nuevoOp() })
        : await rpc<RespuestaEnvio>('fn_reenviar_solicitud', { p_solicitud: sol.id, p_comentario: 'Corrección atendida por el solicitante', p_op: nuevoOp() });
      setEnviada(mensajeEnvio(r));
    } catch (e) {
      setErrorPaso(`${e instanceof Error ? e.message : String(e)} La solicitud NO se envió: sigue guardada como borrador.`);
    } finally { setEnviando(false); }
  }

  if (!permisos.solicitante) return <div className="contenido"><SinPermiso /></div>;
  if (cargando) return <div className="contenido"><Esqueleto lineas={5} /></div>;
  if (errorCarga) return <div className="contenido"><EstadoError mensaje={errorCarga} alReintentar={() => { setCargando(true); void cargar(); }} /></div>;
  if (id && sol && !editable) {
    return (
      <div className="contenido"><div className="tarjeta">
        <h1>{sol.numero}</h1>
        <p>Esta solicitud ya no se puede editar aquí (estado actual: {sol.estado.replace(/_/g, ' ')}).</p>
        <Link className="boton-primario enlace-boton" to={`/solicitudes/${sol.id}`}>Ver la solicitud</Link>
      </div></div>
    );
  }

  const conDevolucion = sol?.estado === 'en_correccion';
  const puedeEnviar = articulos.length > 0 && !estimacion?.problema;
  const idsFormulario = { nombre: 'art-nombre' };

  return (
    <div className="contenido">
      <div className="acciones-fila" style={{ justifyContent: 'space-between' }}>
        <h1 ref={titulo} tabIndex={-1} style={{ margin: 0 }}>
          {sol ? (conDevolucion ? `Corregir ${sol.numero}` : `Nueva solicitud · ${sol.numero}`) : 'Nueva solicitud'}
        </h1>
        {sol ? <IndicadorGuardado cuando={guardadoMostrado} guardando={guardando} /> : null}
      </div>

      <ol className="pasos" aria-label="Pasos de la solicitud">
        {PASOS.map((p, i) => {
          const n = i + 1;
          const bloqueado = !sol && n > 1;
          return (
            <li key={p} className={n === paso ? 'paso-actual' : n < paso ? 'paso-hecho' : ''} aria-current={n === paso ? 'step' : undefined}>
              <button type="button" disabled={bloqueado || !!enviada} onClick={() => irAPaso(n)}>
                <span className="paso-numero">{n < paso ? <Icono nombre="check" tam={14} /> : n}</span> {p}
              </button>
            </li>
          );
        })}
      </ol>

      {conDevolucion ? (
        <div className="mensaje mensaje-error" role="status">
          <span className="mensaje-texto"><Icono nombre="devolver" /> <b>Devuelta para corrección.</b> Motivo: {sol?.ultimo_motivo_devolucion ?? sol?.ultimo_motivo_jefe ?? 'sin motivo registrado'}.
            Ajusta lo necesario y reenvíala: pasará otra vez por tu jefe.</span>
        </div>
      ) : null}
      <MensajeError texto={errorPaso} />

      {/* ======================= Paso 1: General ======================= */}
      {paso === 1 ? (
        <section className="tarjeta" aria-labelledby="t-paso">
          <h2 id="t-paso">1 · Datos generales</h2>
          {sol ? (
            <>
              <div className="fechas">
                <div><b>Área · centro de costo</b>{sol.area_nombre} · {sol.centro_costo_codigo} {sol.centro_costo_nombre}</div>
                {sol.categoria_nombre ? <div><b>Categoría</b>{sol.categoria_nombre}</div> : null}
                <div><b>Semana objetivo</b>{etiquetaSemana(sol.semana_lunes)}</div>
              </div>
              {sol.justificacion ? <p>Justificación: {sol.justificacion}</p> : null}
              <p className="texto-suave">Los datos generales quedan fijos al crear el borrador. Si te equivocaste de centro de costo, cancela este borrador y crea otro.
                La semana objetivo se puede cambiar desde la solicitud.</p>
              <div className="acciones-fila">
                {conDevolucion ? null : (
                  <BotonConMotivo etiqueta="Cancelar este borrador" clase="boton-peligro" titulo="Cancelar solicitud"
                    descripcion="Se cancelan todos sus artículos. Queda registrado."
                    onConfirmar={async (motivo) => {
                      await rpc('fn_cancelar_solicitud', { p_solicitud: sol.id, p_motivo: motivo, p_version: sol.version });
                      navegar('/mis-solicitudes');
                    }} />
                )}
              </div>
            </>
          ) : (
            <form className="formulario" noValidate onSubmit={(e) => { e.preventDefault(); void crearBorrador(); }}>
              <p className="leyenda-campos"><span className="marca-obligatorio">* obligatorio</span> · Guardar el borrador NO lo envía a nadie.</p>
              <div className="fila-campos">
                <Campo etiqueta="Área" requerido error={verG('area')} ayuda="Es el área a la que estás vinculado; la aprueba su jefe.">
                  <input value={areaNombre ?? 'Sin área asignada'} readOnly />
                </Campo>
                <Campo etiqueta="Centro de costo" requerido error={verG('cc')}
                  ayuda={inicialCC.bloqueado ? 'Tu área tiene un único centro de costo autorizado.' : 'Solo aparecen los autorizados para tu área.'}>
                  <select value={ccId} onChange={(e) => setCcId(e.target.value)} onBlur={() => tocarG('cc')} disabled={inicialCC.bloqueado}>
                    <option value="">— Selecciona —</option>
                    {centros.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
                  </select>
                </Campo>
              </div>
              {cat && cat.categorias.length > 0 ? (
                <Campo etiqueta="Categoría" opcional ayuda="Algunas categorías (p. ej. papelería) tienen fechas especiales de recepción.">
                  <select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                    <option value="">— Ninguna —</option>
                    {cat.categorias.map((k) => <option key={k.id} value={k.id}>{k.nombre}</option>)}
                  </select>
                </Campo>
              ) : null}
              {permisos.emergencias ? (
                <div className="tarjeta" style={{ marginBottom: 0 }}>
                  <label className="campo-casilla">
                    <input type="checkbox" checked={extra} onChange={(e) => setExtra(e.target.checked)} />
                    <span><b>Solicitud extraordinaria (emergencia)</b><br />
                      <span className="campo-ayuda">No espera el calendario de Compras, pero SÍ requiere la aprobación de tu jefe. Úsala solo para emergencias reales; la prioridad “Alta” no es una emergencia.</span></span>
                  </label>
                  {extra ? (
                    <Campo etiqueta="Motivo de la emergencia" requerido error={verG('motivoExtra')}>
                      <textarea rows={2} value={motivoExtra} onChange={(e) => setMotivoExtra(e.target.value)} onBlur={() => tocarG('motivoExtra')} />
                    </Campo>
                  ) : null}
                </div>
              ) : null}
              <fieldset className="grupo-semana">
                <legend>Semana objetivo de compra <span className="marca-obligatorio">* obligatorio</span></legend>
                <p className="campo-ayuda">Cada tarjeta indica cuándo la recibiría Compras si tu jefe la aprueba antes del cierre.</p>
                <CalendarioSemanas valor={semana} alCambiar={setSemana} categoria={categoria || null} extraordinaria={extra} />
              </fieldset>
              <Campo etiqueta="Justificación general" opcional>
                <textarea rows={2} value={justificacion} onChange={(e) => setJustificacion(e.target.value)} />
              </Campo>
              <div className="acciones-fila">
                <Boton type="submit" variante="primario" cargando={guardando}>Guardar borrador y continuar</Boton>
                <Link className="boton-secundario enlace-boton" to="/mis-solicitudes">Cancelar</Link>
              </div>
            </form>
          )}
          {sol ? <div className="acciones-fila pie-paso"><Boton variante="primario" onClick={() => irAPaso(2)}>Continuar a los artículos →</Boton></div> : null}
        </section>
      ) : null}

      {/* ======================= Paso 2: Artículos ======================= */}
      {paso === 2 && sol ? (
        <section className="tarjeta" aria-labelledby="t-paso">
          <h2 id="t-paso">2 · Artículos ({articulos.length})</h2>
          {articulos.length > 0 ? (
            <ul className="lista-articulos">
              {articulos.map((a) => {
                const puedeEditar = ['borrador', 'solicitado', 'en_cotizacion'].includes(a.etapa);
                return (
                  <li key={a.id} className="articulo-fila">
                    <MiniaturaArticulo nombre={a.nombre} adjuntos={porArticulo[a.id]} />
                    <div className="articulo-datos">
                      <b>{a.nombre}</b>
                      <div className="texto-suave">{fmtCantidad(a.cantidad)} {a.unidad}{a.proveedor_sugerido ? ` · proveedor sugerido: ${a.proveedor_sugerido}` : ''}</div>
                      <details open={recien === a.id}>
                        <summary>Fotos ({(porArticulo[a.id] ?? []).length}) · agregar o ver</summary>
                        <Adjuntos entidad="articulo" entidadId={a.id} puedeSubir={puedeEditar} alCambiar={() => setRefrescoFotos((n) => n + 1)} />
                      </details>
                    </div>
                    <div className="articulo-acciones">
                      {puedeEditar ? <Boton variante="fantasma" onClick={() => editar(a)}>Editar</Boton> : null}
                      <Boton variante="fantasma" onClick={() => duplicar(a)}>Duplicar</Boton>
                      {sol.estado === 'borrador' && a.etapa === 'borrador'
                        ? <Boton variante="fantasma" onClick={() => setPorEliminar(a)}>Eliminar</Boton> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : <p className="texto-suave">Aún no hay artículos. Llena el formulario y guarda el primero: una solicitud de un solo artículo toma menos de un minuto.</p>}

          <form id="formulario-articulo" className="formulario formulario-articulo" noValidate
            onSubmit={(e) => { e.preventDefault(); void guardarArticulo(); }}>
            <h3>{form.id ? 'Editar artículo' : articulos.length > 0 ? 'Agregar otro artículo' : 'Agregar el primer artículo'}</h3>
            <p className="leyenda-campos"><span className="marca-obligatorio">* obligatorio</span> · los demás son opcionales.</p>
            <Campo etiqueta="Nombre del artículo" requerido error={verA('nombre')}>
              <input id={idsFormulario.nombre} ref={nombreRef} value={form.nombre} maxLength={300} autoComplete="off"
                onChange={(e) => setForm({ ...form, nombre: e.target.value })} onBlur={() => tocarA('nombre')} />
            </Campo>
            <div className="fila-campos">
              <Campo etiqueta="Cantidad" requerido error={verA('cantidad')}>
                <input inputMode="decimal" value={form.cantidad} onChange={(e) => setForm({ ...form, cantidad: e.target.value })} onBlur={() => tocarA('cantidad')} />
              </Campo>
              <Campo etiqueta="Unidad de medida" requerido error={verA('unidad')}>
                <select value={form.unidad} onChange={(e) => setForm({ ...form, unidad: e.target.value })} onBlur={() => tocarA('unidad')}>
                  {!unidadesActivas.some((u) => u.toLowerCase() === form.unidad.toLowerCase())
                    ? <option value={form.unidad}>{form.unidad || '— Selecciona —'}</option> : null}
                  {unidades.map((u) => <option key={u.id} value={u.nombre}>{u.nombre}{u.abreviatura ? ` (${u.abreviatura})` : ''}</option>)}
                </select>
              </Campo>
            </div>
            <Campo etiqueta="Especificaciones (medidas, material, color y demás características)" requerido error={verA('descripcion')}
              ayuda="Describe el artículo aunque tengas un enlace: el enlace va en su propio campo.">
              <textarea rows={3} value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} onBlur={() => tocarA('descripcion')} />
            </Campo>
            <Campo etiqueta="Enlace de compra o referencia" opcional error={verA('enlace_referencia')} ayuda="Ej.: https://… (no reemplaza las especificaciones).">
              <input type="url" value={form.enlace_referencia} onChange={(e) => setForm({ ...form, enlace_referencia: e.target.value })} onBlur={() => tocarA('enlace_referencia')} />
            </Campo>
            <Campo etiqueta="Proveedor sugerido" opcional error={verA('proveedor_sugerido')} ayuda="Si no lo sabes, déjalo vacío; Compras lo define.">
              <input value={form.proveedor_sugerido} onChange={(e) => setForm({ ...form, proveedor_sugerido: e.target.value })} onBlur={() => tocarA('proveedor_sugerido')} />
            </Campo>
            <details className="mas-opciones">
              <summary>Más opciones: prioridad, fecha requerida y justificación</summary>
              <div className="fila-campos">
                <Campo etiqueta="Prioridad propuesta" requerido>
                  <select value={form.prioridad} onChange={(e) => setForm({ ...form, prioridad: e.target.value })}>
                    <option value="baja">Baja</option><option value="media">Media</option><option value="alta">Alta</option>
                  </select>
                </Campo>
                <Campo etiqueta="Fecha requerida" opcional error={verA('fecha_requerida')}>
                  <input type="date" value={form.fecha_requerida} onChange={(e) => setForm({ ...form, fecha_requerida: e.target.value })} onBlur={() => tocarA('fecha_requerida')} />
                </Campo>
              </div>
              <Campo etiqueta="Justificación del artículo" opcional>
                <textarea rows={2} value={form.justificacion} onChange={(e) => setForm({ ...form, justificacion: e.target.value })} />
              </Campo>
            </details>
            <p className="texto-suave">Las fotos se agregan desde el artículo, justo después de guardarlo (galería, arrastrar o cámara del celular).</p>
            <MensajeExito texto={aviso} />
            <div className="acciones-fila">
              {form.id ? (
                <>
                  <Boton type="submit" variante="primario" cargando={guardando}>Guardar cambios</Boton>
                  <Boton onClick={() => { setForm(articuloVacio(unidadInicial)); setTocadosA({}); setIntentoA(false); }}>Cancelar edición</Boton>
                </>
              ) : (
                <>
                  <Boton type="submit" variante={articulos.length === 0 ? 'primario' : 'secundario'} cargando={guardando}>Guardar y agregar otro</Boton>
                  <Boton variante={formVirgen && articulos.length > 0 ? 'primario' : 'secundario'} disabled={guardando || (formVirgen && articulos.length === 0)}
                    onClick={async () => { if (formVirgen) { if (articulos.length > 0) irAPaso(3); } else if (await guardarArticulo()) irAPaso(3); }}>
                    {formVirgen ? 'Continuar a la revisión →' : 'Guardar y continuar →'}
                  </Boton>
                </>
              )}
            </div>
          </form>
          <div className="acciones-fila pie-paso"><Boton onClick={() => irAPaso(1)}>← Datos generales</Boton></div>
          <ModalConfirmar abierto={!!porEliminar} titulo="Eliminar artículo" peligro etiqueta="Eliminar"
            texto={`¿Eliminar "${porEliminar?.nombre ?? ''}" del borrador? No se puede deshacer.`}
            alConfirmar={async () => { if (porEliminar) await eliminar(porEliminar); }} alCerrar={() => setPorEliminar(null)} />
        </section>
      ) : null}

      {/* ======================= Paso 3: Revisión ======================= */}
      {paso === 3 && sol ? (
        <section className="tarjeta" aria-labelledby="t-paso">
          <h2 id="t-paso">3 · Revisa antes de enviar</h2>
          <div className="fechas">
            <div><b>Área · centro de costo</b>{sol.area_nombre} · {sol.centro_costo_codigo} {sol.centro_costo_nombre}</div>
            {sol.categoria_nombre ? <div><b>Categoría</b>{sol.categoria_nombre}</div> : null}
            <div><b>Semana objetivo</b>{etiquetaSemana(sol.semana_lunes)}</div>
            {sol.es_extraordinaria ? <div><b>Tipo</b>Extraordinaria: {sol.motivo_extraordinaria}</div> : null}
          </div>
          {sol.justificacion ? <p>Justificación: {sol.justificacion}</p> : null}
          {articulos.length === 0 ? (
            <div className="mensaje mensaje-error"><span className="mensaje-texto"><Icono nombre="alerta" /> Agrega al menos un artículo para poder enviar.</span></div>
          ) : (
            <div className="tabla-envoltura" tabIndex={0} role="region" aria-label="Artículos de la solicitud">
              <table className="tabla tabla-datos">
                <caption className="solo-lectores">Artículos de la solicitud</caption>
                <thead><tr><th scope="col">Foto</th><th scope="col">Artículo</th><th scope="col" className="numero">Cantidad</th><th scope="col" className="oculto-movil">Especificaciones</th></tr></thead>
                <tbody>
                  {articulos.map((a) => (
                    <tr key={a.id}>
                      <td><MiniaturaArticulo nombre={a.nombre} adjuntos={porArticulo[a.id]} /></td>
                      <td><b>{a.nombre}</b>{a.enlace_referencia ? <div><a href={a.enlace_referencia} target="_blank" rel="noopener noreferrer">Enlace de referencia</a></div> : null}</td>
                      <td className="numero">{fmtCantidad(a.cantidad)} {a.unidad}</td>
                      <td className="oculto-movil texto-suave celda-recortada">{a.descripcion}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {estimacion ? (
            estimacion.problema ? (
              <div className="mensaje mensaje-error"><span className="mensaje-texto"><Icono nombre="alerta" /> No se puede enviar todavía: {estimacion.problema}</span></div>
            ) : (
              <p className="estimacion">
                <Icono nombre="calendario" /> La recibirá <b>{estimacion.aprobador}</b>
                {estimacion.ruta === 'ruta_superior' ? ' (ruta superior, porque eres el jefe del área)' : ''}.
                {estimacion.origen === 'ciclo_semanal' || estimacion.origen === 'ventana_categoria'
                  ? <> Si la aprueba antes del {fmtFechaHora(estimacion.cierre)}, Compras la recibirá el <b>{fmtFecha(estimacion.recepcion_prevista)}</b>.</>
                  : estimacion.origen === 'extraordinaria' ? ' Extraordinaria: pasa a Compras al aprobarse.' : ' Pasa a Compras al aprobarse.'}
                {estimacion.nota ? ` ${estimacion.nota}` : ''}
              </p>
            )
          ) : null}
          <div className="acciones-fila pie-paso">
            <Boton onClick={() => irAPaso(2)}>← Volver a los artículos</Boton>
            <Boton variante="primario" disabled={!puedeEnviar} onClick={() => irAPaso(4)}>Continuar al envío →</Boton>
          </div>
        </section>
      ) : null}

      {/* ======================= Paso 4: Envío ======================= */}
      {paso === 4 && sol ? (
        <section className="tarjeta" aria-labelledby="t-paso">
          <h2 id="t-paso">4 · Enviar al jefe</h2>
          {enviada ? (
            <div role="status">
              <div className="mensaje mensaje-exito"><span className="mensaje-texto"><Icono nombre="check-circulo" /> <b>¡Solicitud enviada!</b> {enviada}</span></div>
              <h3>¿Qué sigue?</h3>
              <ol className="siguientes">
                <li>Tu jefe recibe un aviso y decide: aprobar, devolverte la solicitud con un motivo o rechazarla.</li>
                <li>Si la devuelve, te avisamos aquí y en la campana: la corriges y la reenvías.</li>
                <li>Una vez aprobada, Compras la recibe en la fecha programada y empieza la cotización.</li>
              </ol>
              <div className="acciones-fila">
                <Link className="boton-primario enlace-boton" to={`/solicitudes/${sol.id}`}>Ver el seguimiento</Link>
                <Link className="boton-secundario enlace-boton" to="/nueva-solicitud">Crear otra solicitud</Link>
                <Link className="boton-secundario enlace-boton" to="/mis-solicitudes">Mis solicitudes</Link>
              </div>
            </div>
          ) : (
            <>
              <p>Vas a enviar <b>{articulos.length}</b> artículo(s) a aprobación{estimacion?.aprobador ? <> de <b>{estimacion.aprobador}</b></> : ' de tu jefe'}.
                Después de enviar no podrás cambiarla en silencio: si algo cambia, tu jefe o Compras deben autorizar la devolución.</p>
              {estimacion && !estimacion.problema && estimacion.recepcion_prevista
                ? <p className="estimacion"><Icono nombre="calendario" /> Recepción prevista por Compras: <b>{fmtFecha(estimacion.recepcion_prevista)}</b> (si se aprueba antes del cierre).</p> : null}
              <div className="acciones-fila">
                <Boton onClick={() => irAPaso(3)}>← Volver a la revisión</Boton>
                <Boton variante="primario" cargando={enviando} disabled={!puedeEnviar} onClick={() => void enviar()}>
                  {enviando ? 'Enviando…' : conDevolucion ? 'Reenviar a aprobación' : 'Enviar a aprobación'}
                </Boton>
              </div>
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
