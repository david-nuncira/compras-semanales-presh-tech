import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { supabase, rpc, limpiarError, nuevoOp } from '../supabase.ts';
import type { Adjunto, EntidadAdjunto } from '../tipos.ts';
import { comprimirSiConviene, tipoFinal, extensionDe } from '../util/imagenes.ts';
import { MensajeError, Cargando, EstadoError, Modal } from './UI.tsx';
import { useNotificaciones } from './Notificaciones.tsx';
import { fmtFechaHora } from '../util/fechas.ts';
import './cotizaciones.css';

const TIPOS_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
interface Preparado { id: string; nombre: string; blob: Blob; mime: string; url: string; op: string; ruta: string | null; subida: boolean; }
interface Vista { url: string; nombre: string; mime: string; }
const tamano = (bytes: number) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** Cada miniatura se obtiene con la sesión vigente, sin publicar URLs del bucket. */
function MiniaturaPrivada({ adjunto }: { adjunto: Adjunto }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let activa = true, creada: string | null = null;
    if (adjunto.mime.startsWith('image/')) void supabase.storage.from('adjuntos').download(adjunto.ruta).then(({ data, error }) => {
      if (!activa || error || !data) return;
      creada = URL.createObjectURL(data); setUrl(creada);
    }).catch(() => {});
    return () => { activa = false; if (creada) URL.revokeObjectURL(creada); };
  }, [adjunto.ruta, adjunto.mime]);
  return url ? <img src={url} alt="" loading="lazy" onError={() => setUrl(null)} /> : <span className="archivo-formato" aria-hidden="true">{adjunto.mime === 'application/pdf' ? 'PDF' : 'IMG'}</span>;
}

export function Adjuntos({ entidad, entidadId, puedeSubir, maxArchivos = 3, cotizacionId, titulo, alCambiar, alOcupado, alPendientes }: {
  entidad: EntidadAdjunto; entidadId: string; puedeSubir: boolean; maxArchivos?: number;
  cotizacionId?: string; titulo?: string; alCambiar?: () => void; alOcupado?: (valor: boolean) => void; alPendientes?: (cantidad: number) => void;
}) {
  const [lista, setLista] = useState<Adjunto[] | null>(null), [error, setError] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false), [trabajando, setTrabajando] = useState(false), [preparando, setPreparando] = useState(false);
  const [pendientes, setPendientes] = useState<Preparado[]>([]), [arrastrando, setArrastrando] = useState(false);
  const [porEliminar, setPorEliminar] = useState<Adjunto | null>(null), [vista, setVista] = useState<Vista | null>(null);
  const contenedor = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null), bloqueo = useRef(false), pendientesRef = useRef<Preparado[]>([]), montado = useRef(true);
  const onOcupadoRef = useRef(alOcupado); onOcupadoRef.current = alOcupado;
  const onPendientesRef = useRef(alPendientes); onPendientesRef.current = alPendientes;
  const ayudaId = useId();
  const { notificar } = useNotificaciones();
  const ocupado = subiendo || trabajando || preparando;
  useEffect(() => { onOcupadoRef.current?.(ocupado); }, [ocupado]);
  useEffect(() => { pendientesRef.current = pendientes; onPendientesRef.current?.(pendientes.length); }, [pendientes]);
  useEffect(() => { montado.current = true; return () => { montado.current = false; pendientesRef.current.forEach(p => URL.revokeObjectURL(p.url)); onOcupadoRef.current?.(false); onPendientesRef.current?.(0); }; }, []);
  useEffect(() => () => { if (vista) URL.revokeObjectURL(vista.url); }, [vista]);
  useEffect(() => {
    const avisar = (e: BeforeUnloadEvent) => { if (pendientesRef.current.length || bloqueo.current) e.preventDefault(); };
    window.addEventListener('beforeunload', avisar); return () => window.removeEventListener('beforeunload', avisar);
  }, []);
  const cargar = useCallback(async (limpiar = true) => {
    if (limpiar) setError(null);
    try {
      let consulta = supabase.from('adjuntos').select('*').eq('entidad', entidad).eq('entidad_id', entidadId);
      if (entidad === 'articulo') consulta = cotizacionId ? consulta.eq('cotizacion_id', cotizacionId) : consulta.is('cotizacion_id', null);
      const { data, error: e } = await consulta.order('creado_en', { ascending: true });
      if (e) throw new Error(limpiarError(e.message));
      if (montado.current) setLista((data ?? []) as Adjunto[]);
    } catch (e) { if (montado.current) setError(e instanceof Error ? e.message : String(e)); }
  }, [entidad, entidadId, cotizacionId]);
  useEffect(() => { setLista(null); setPendientes(prev => { prev.forEach(p => URL.revokeObjectURL(p.url)); return []; }); void cargar(); }, [cargar]);

  async function preparar(archivos: File[]) {
    if (bloqueo.current || !puedeSubir || !lista) return;
    bloqueo.current = true; setPreparando(true); setError(null);
    const nuevos: Preparado[] = [], errores: string[] = [];
    const disponibles = maxArchivos - lista.length - pendientesRef.current.length;
    try {
      for (const archivo of archivos.slice(0, Math.max(0, disponibles))) {
        if (!TIPOS_PERMITIDOS.includes(archivo.type)) { errores.push(`${archivo.name}: elige JPG, PNG, WebP o PDF.`); continue; }
        if (!archivo.size) { errores.push(`${archivo.name}: está vacío.`); continue; }
        if (archivo.size > 25 * 1048576) { errores.push(`${archivo.name}: es demasiado grande. Usa un archivo de hasta 5 MB o una imagen menor de 25 MB para comprimir.`); continue; }
        const blob = await comprimirSiConviene(archivo), mime = tipoFinal(archivo, blob);
        if (blob.size > 5 * 1048576) { errores.push(`${archivo.name}: supera 5 MB incluso tras comprimirlo.`); continue; }
        nuevos.push({ id: nuevoOp(), nombre: archivo.name, blob, mime, url: URL.createObjectURL(blob), op: nuevoOp(), ruta: null, subida: false });
      }
      if (archivos.length > disponibles) errores.push(`Puedes adjuntar hasta ${maxArchivos} archivos en este apartado. Solo se prepararon los que caben.`);
      if (montado.current) { setPendientes(prev => [...prev, ...nuevos]); if (nuevos.length) contenedor.current?.dispatchEvent(new Event('input', { bubbles: true })); if (errores.length) setError(errores.join(' ')); }
      else nuevos.forEach(p => URL.revokeObjectURL(p.url));
    } catch (e) { nuevos.forEach(p => URL.revokeObjectURL(p.url)); setError(limpiarError(e instanceof Error ? e.message : String(e))); }
    finally { bloqueo.current = false; setPreparando(false); if (inputRef.current) inputRef.current.value = ''; }
  }

  async function subirPendientes() {
    if (bloqueo.current || !pendientes.length || !puedeSubir) return;
    bloqueo.current = true; setSubiendo(true); setError(null);
    let guardados = 0;
    try {
      for (const preparado of pendientesRef.current) {
        const ruta = preparado.ruta ?? `${entidad}/${entidadId}/${nuevoOp()}.${extensionDe(preparado.mime)}`;
        // La ruta y op se conservan ante una respuesta ambigua: el reintento no duplica el registro.
        preparado.ruta = ruta;
        setPendientes(prev => prev.map(p => p.id === preparado.id ? { ...p, ruta } : p));
        if (!preparado.subida) {
          const { error: eSubida } = await supabase.storage.from('adjuntos').upload(ruta, preparado.blob, { contentType: preparado.mime, upsert: false });
          if (eSubida && !/already exists|duplicate|resource exists/i.test(eSubida.message)) throw new Error(limpiarError(eSubida.message));
          preparado.subida = true;
          setPendientes(prev => prev.map(p => p.id === preparado.id ? { ...p, subida: true } : p));
        }
        const args = { p_ruta: ruta, p_nombre_original: preparado.nombre, p_mime: preparado.mime, p_tamano: preparado.blob.size, p_op: preparado.op };
        await rpc(cotizacionId ? 'fn_registrar_adjunto_cotizacion' : 'fn_registrar_adjunto', cotizacionId ? { ...args, p_cotizacion: cotizacionId } : { ...args, p_entidad: entidad, p_entidad_id: entidadId });
        guardados++; URL.revokeObjectURL(preparado.url);
        setPendientes(prev => prev.filter(p => p.id !== preparado.id));
      }
      notificar(`${guardados === 1 ? 'Archivo guardado' : `${guardados} archivos guardados`} correctamente.`, 'exito');
    } catch (e) {
      setError(`${guardados ? `${guardados} archivo(s) guardado(s). ` : ''}${limpiarError(e instanceof Error ? e.message : String(e))} Conservamos los archivos pendientes para que puedas reintentar.`);
    } finally { bloqueo.current = false; setSubiendo(false); await cargar(false); alCambiar?.(); }
  }

  function descargarBlob(url: string, nombre: string, revocar = true) {
    const enlace = document.createElement('a'); enlace.href = url; enlace.download = nombre; document.body.appendChild(enlace); enlace.click(); enlace.remove();
    if (revocar) setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  async function abrir(a: Adjunto, previsualizar = false) {
    if (bloqueo.current) return;
    bloqueo.current = true; setTrabajando(true); setError(null);
    try {
      const { data, error: e } = await supabase.storage.from('adjuntos').download(a.ruta);
      if (e || !data) throw new Error('No pudimos abrir el archivo. Comprueba tu conexión y que tu cuenta siga activa.');
      const url = URL.createObjectURL(new Blob([data], { type: a.mime }));
      if (previsualizar) setVista({ url, nombre: a.nombre_original, mime: a.mime }); else descargarBlob(url, a.nombre_original);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { bloqueo.current = false; setTrabajando(false); }
  }
  async function eliminar() {
    if (!porEliminar || bloqueo.current) return;
    bloqueo.current = true; setTrabajando(true); setError(null);
    try {
      await rpc('fn_eliminar_adjunto', { p_adjunto: porEliminar.id, p_motivo: 'Retirado desde el apartado de adjuntos' });
      const { error: e } = await supabase.storage.from('adjuntos').remove([porEliminar.ruta]);
      setPorEliminar(null);
      notificar(e ? 'El adjunto se retiró. Informa al administrador: no pudimos confirmar la limpieza del archivo.' : 'Adjunto eliminado correctamente.', e ? 'aviso' : 'exito');
      await cargar(); alCambiar?.();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { bloqueo.current = false; setTrabajando(false); }
  }
  if (lista === null) return <div><MensajeError texto={error} />{error ? <EstadoError alReintentar={() => void cargar()} /> : <Cargando texto="Cargando adjuntos…" />}</div>;
  return <section ref={contenedor} className="adjuntos adjuntos-nuevos" aria-label={titulo ?? 'Archivos de referencia'}>
    <div className="seccion-cabecera"><h4>{titulo ?? 'Archivos de referencia'} <span className="insignia-suave">{lista.length} de {maxArchivos}</span></h4><button className="boton-silencioso" type="button" disabled={ocupado} onClick={() => void cargar()}>Actualizar adjuntos</button></div>
    {lista.length ? <ul className="archivos-cuadricula">{lista.map(a => <li key={a.id} className="archivo-tarjeta">
      <button type="button" className="archivo-miniatura" disabled={ocupado} aria-label={`Vista previa de ${a.nombre_original}`} onClick={() => void abrir(a, true)}><MiniaturaPrivada adjunto={a} /><span>Vista previa</span></button>
      <div className="archivo-datos"><strong>{a.nombre_original}</strong><span className="texto-suave">{tamano(a.tamano_bytes)} · {fmtFechaHora(a.creado_en)}</span><span className="archivo-guardado">✓ Guardado · acceso privado</span></div>
      <div className="archivo-acciones"><button type="button" className="boton-silencioso" disabled={ocupado} onClick={() => void abrir(a)}>Descargar</button>{puedeSubir ? <button type="button" className="boton-silencioso" disabled={ocupado} onClick={() => setPorEliminar(a)} aria-label={`Eliminar ${a.nombre_original}`}>Eliminar</button> : null}</div>
    </li>)}</ul> : <p className="texto-suave">Todavía no hay archivos guardados en este apartado.</p>}
    {puedeSubir && lista.length + pendientes.length < maxArchivos ? <div className={`archivo-zona ${arrastrando ? 'archivo-zona-activa' : ''}`} onDragOver={e => { e.preventDefault(); if (!ocupado) setArrastrando(true); }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setArrastrando(false); }} onDrop={e => { e.preventDefault(); setArrastrando(false); if (!ocupado) void preparar(Array.from(e.dataTransfer.files)); }}>
      <span className="archivo-zona-icono" aria-hidden="true">↑</span><strong>Arrastra tus archivos aquí</strong><span className="texto-suave">o selecciónalos desde tu equipo</span>
      <button type="button" className="boton-secundario" disabled={ocupado} onClick={() => inputRef.current?.click()}>Seleccionar archivos</button>
      <input className="archivo-input" tabIndex={-1} ref={inputRef} type="file" aria-label="Seleccionar archivos adjuntos" aria-describedby={ayudaId} accept="image/jpeg,image/png,image/webp,application/pdf" multiple disabled={ocupado} onChange={e => void preparar(Array.from(e.target.files ?? []))} />
      <span className="campo-ayuda" id={ayudaId}>JPG, PNG, WebP o PDF · hasta 5 MB por archivo · máximo {maxArchivos}. Verás una vista previa antes de subir.</span>
    </div> : null}
    {pendientes.length ? <div className="archivos-pendientes"><div className="seccion-cabecera"><h4>Listos para revisar <span className="insignia-suave">Sin subir</span></h4><span className="texto-suave">Los archivos se guardan al pulsar «Subir».</span></div>
      <ul className="archivos-cuadricula">{pendientes.map(p => <li key={p.id} className="archivo-tarjeta archivo-pendiente">
        <button className="archivo-miniatura" type="button" disabled={ocupado} aria-label={`Revisar ${p.nombre}`} onClick={() => setVista({ url: URL.createObjectURL(p.blob), nombre: p.nombre, mime: p.mime })}>{p.mime.startsWith('image/') ? <img src={p.url} alt="" /> : <span className="archivo-formato" aria-hidden="true">PDF</span>}<span>Vista previa</span></button>
        <div className="archivo-datos"><strong>{p.nombre}</strong><span className="texto-suave">{tamano(p.blob.size)} · {p.mime === 'application/pdf' ? 'Documento PDF' : 'Imagen preparada'}</span><span className="archivo-por-subir">● Pendiente de subir</span></div>
        <div className="archivo-acciones"><button type="button" className="boton-silencioso" disabled={ocupado} aria-label={`Quitar ${p.nombre} de la selección`} onClick={() => { URL.revokeObjectURL(p.url); setPendientes(prev => prev.filter(x => x.id !== p.id)); }}>Quitar de la selección</button></div>
      </li>)}</ul><button type="button" className="boton-primario" disabled={ocupado} onClick={() => void subirPendientes()}>{subiendo ? 'Subiendo archivos…' : `Subir ${pendientes.length === 1 ? 'archivo' : `${pendientes.length} archivos`}`}</button>
    </div> : null}
    {ocupado ? <Cargando texto={preparando ? 'Preparando las vistas previas…' : subiendo ? 'Guardando archivos de forma privada…' : 'Abriendo archivo…'} /> : null}<MensajeError texto={error} />
    <Modal titulo="Vista previa del adjunto" abierto={!!vista} alCerrar={() => setVista(null)}>{vista ? <div className="archivo-vista"><p><strong>{vista.nombre}</strong></p>{vista.mime === 'application/pdf' ? <><iframe className="archivo-pdf" src={vista.url} title={`Documento PDF: ${vista.nombre}`} sandbox="allow-same-origin" /><p className="campo-ayuda">Si el navegador no muestra el PDF, puedes descargarlo.</p></> : <img className="adjunto-preview" src={vista.url} alt={vista.nombre} />}<button type="button" className="boton-secundario" onClick={() => descargarBlob(vista.url, vista.nombre, false)}>Descargar archivo</button></div> : null}</Modal>
    <Modal titulo="Eliminar adjunto" abierto={!!porEliminar} ocupado={trabajando} alCerrar={() => setPorEliminar(null)}><p>¿Quieres retirar <strong>{porEliminar?.nombre_original}</strong>? La acción quedará registrada.</p><div className="modal-acciones"><button type="button" className="boton-secundario" onClick={() => setPorEliminar(null)}>Cancelar</button><button type="button" className="boton-peligro" disabled={trabajando} onClick={() => void eliminar()}>{trabajando ? 'Eliminando…' : 'Eliminar adjunto'}</button></div></Modal>
  </section>;
}
