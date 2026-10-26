import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, rpc, limpiarError, nuevoOp } from '../supabase.ts';
import { CONFIG } from '../config.ts';
import type { Adjunto, EntidadAdjunto } from '../tipos.ts';
import { comprimirSiConviene, tipoFinal, extensionDe } from '../util/imagenes.ts';
import { MensajeError, MensajeExito, Cargando, Modal } from './UI.tsx';
import { fmtFechaHora } from '../util/fechas.ts';

const TIPOS_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_MB = 5;

interface Carga { nombre: string; progreso: number; estado: 'subiendo' | 'registrando' | 'error'; error?: string; }

/**
 * Sube con XMLHttpRequest al endpoint autenticado de Storage para mostrar
 * el progreso real. Usa el JWT de la sesión vigente (las políticas RLS del
 * bucket se evalúan en cada petición).
 */
function subirConProgreso(ruta: string, cuerpo: Blob, tipo: string, token: string,
                          alAvanzar: (p: number) => void): Promise<void> {
  return new Promise((resolver, rechazar) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${CONFIG.SUPABASE_URL}/storage/v1/object/adjuntos/${ruta.split('/').map(encodeURIComponent).join('/')}`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('apikey', CONFIG.SUPABASE_ANON_KEY);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.setRequestHeader('Content-Type', tipo);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) alAvanzar(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) { resolver(); return; }
      let msj = `El almacenamiento rechazó el archivo (${xhr.status}).`;
      try { const j = JSON.parse(xhr.responseText); if (j?.message) msj = limpiarError(String(j.message)); } catch { /* sin detalle */ }
      if (xhr.status === 403 || xhr.status === 400) msj += ' Verifica que puedas adjuntar en este estado y que no superes el límite de archivos.';
      rechazar(new Error(msj));
    };
    xhr.onerror = () => rechazar(new Error('Se perdió la conexión durante la subida. Intenta de nuevo.'));
    xhr.send(cuerpo);
  });
}

/**
 * Adjuntos privados de una entidad: arrastrar y soltar, progreso, vista previa
 * de imágenes y apertura de PDF. Descarga SIEMPRE autenticada (sin enlaces
 * públicos ni firmados reutilizables).
 */
export function Adjuntos({ entidad, entidadId, puedeSubir, maxArchivos = 3, titulo = 'Imágenes y documentos' }: {
  entidad: EntidadAdjunto; entidadId: string; puedeSubir: boolean; maxArchivos?: number; titulo?: string;
}) {
  const [lista, setLista] = useState<Adjunto[] | null>(null);
  const [miniaturas, setMiniaturas] = useState<Record<string, string>>({});
  const [cargas, setCargas] = useState<Carga[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [arrastrando, setArrastrando] = useState(false);
  const [visor, setVisor] = useState<{ url: string; nombre: string } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const urlsRef = useRef<string[]>([]);

  const cargar = useCallback(async () => {
    const { data, error: e } = await supabase
      .from('adjuntos').select('*')
      .eq('entidad', entidad).eq('entidad_id', entidadId)
      .order('creado_en', { ascending: true });
    if (e) { setError(limpiarError(e.message)); return; }
    setLista((data ?? []) as Adjunto[]);
  }, [entidad, entidadId]);

  useEffect(() => { void cargar(); }, [cargar]);

  // Miniaturas de imágenes (descarga autenticada → URL local temporal).
  useEffect(() => {
    let vivo = true;
    (async () => {
      for (const a of lista ?? []) {
        if (!a.mime.startsWith('image/') || miniaturas[a.id]) continue;
        const { data } = await supabase.storage.from('adjuntos').download(a.ruta);
        if (!vivo || !data) continue;
        const url = URL.createObjectURL(data);
        urlsRef.current.push(url);
        setMiniaturas((m) => ({ ...m, [a.id]: url }));
      }
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lista]);

  useEffect(() => () => { urlsRef.current.forEach((u) => URL.revokeObjectURL(u)); }, []);

  const restantes = Math.max(0, maxArchivos - (lista?.length ?? 0));

  async function subirArchivos(archivos: File[]) {
    setError(null); setExito(null);
    if (archivos.length === 0) return;
    if (archivos.length > restantes) {
      setError(`Puedes adjuntar ${restantes} archivo(s) más (máximo ${maxArchivos}).`);
      archivos = archivos.slice(0, restantes);
      if (archivos.length === 0) return;
    }
    const { data: ses } = await supabase.auth.getSession();
    const token = ses.session?.access_token;
    if (!token) { setError('Tu sesión venció. Vuelve a iniciar sesión.'); return; }

    let ok = 0;
    for (const archivo of archivos) {
      const idx = cargas.length + ok;
      const actualizar = (c: Partial<Carga>) => setCargas((xs) => {
        const copia = [...xs];
        copia[idx] = { ...(copia[idx] ?? { nombre: archivo.name, progreso: 0, estado: 'subiendo' }), ...c } as Carga;
        return copia;
      });
      actualizar({ nombre: archivo.name, progreso: 0, estado: 'subiendo' });
      try {
        if (!TIPOS_PERMITIDOS.includes(archivo.type)) {
          throw new Error(`"${archivo.name}": solo JPG, PNG, WebP o PDF.`);
        }
        const comprimido = await comprimirSiConviene(archivo);
        if (comprimido.size > MAX_MB * 1024 * 1024) {
          throw new Error(`"${archivo.name}" supera ${MAX_MB} MB incluso comprimido.`);
        }
        const mime = tipoFinal(archivo, comprimido);
        const ruta = `${entidad}/${entidadId}/${crypto.randomUUID()}.${extensionDe(mime)}`;
        await subirConProgreso(ruta, comprimido, mime, token, (p) => actualizar({ progreso: p }));
        actualizar({ estado: 'registrando', progreso: 100 });
        try {
          await rpc('fn_registrar_adjunto', {
            p_entidad: entidad, p_entidad_id: entidadId, p_ruta: ruta,
            p_nombre_original: archivo.name, p_mime: mime, p_tamano: comprimido.size, p_op: nuevoOp()
          });
        } catch (eRegistro) {
          // Sin registros falsos: si no quedó registrado, se retira el archivo.
          await supabase.storage.from('adjuntos').remove([ruta]);
          throw eRegistro;
        }
        ok++;
      } catch (e) {
        actualizar({ estado: 'error', error: e instanceof Error ? e.message : String(e) });
      }
    }
    setCargas((xs) => xs.filter((c) => c.estado === 'error'));
    if (ok > 0) setExito(`${ok} archivo(s) adjuntado(s) correctamente.`);
    if (inputRef.current) inputRef.current.value = '';
    await cargar();
  }

  async function abrir(a: Adjunto) {
    setError(null);
    const { data, error: e } = await supabase.storage.from('adjuntos').download(a.ruta);
    if (e || !data) { setError('No fue posible abrir el archivo (verifica que tu cuenta siga activa).'); return; }
    const url = URL.createObjectURL(data);
    urlsRef.current.push(url);
    if (a.mime.startsWith('image/')) { setVisor({ url, nombre: a.nombre_original }); return; }
    window.open(url, '_blank', 'noopener');
  }

  async function descargar(a: Adjunto) {
    const { data, error: e } = await supabase.storage.from('adjuntos').download(a.ruta);
    if (e || !data) { setError('No fue posible descargar el archivo.'); return; }
    const url = URL.createObjectURL(data);
    const enlace = document.createElement('a');
    enlace.href = url; enlace.download = a.nombre_original;
    document.body.appendChild(enlace); enlace.click(); document.body.removeChild(enlace);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function eliminar(a: Adjunto) {
    if (!window.confirm(`¿Eliminar el adjunto "${a.nombre_original}"?`)) return;
    setError(null);
    try {
      await rpc('fn_eliminar_adjunto', { p_adjunto: a.id, p_motivo: 'Eliminado por quien lo subió' });
      await supabase.storage.from('adjuntos').remove([a.ruta]);
      setExito('Adjunto eliminado.');
      await cargar();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  if (lista === null) return <Cargando texto="Cargando adjuntos…" />;

  return (
    <div className="adjuntos">
      <h4>{titulo} ({lista.length}/{maxArchivos})</h4>
      {lista.length === 0 ? <p className="texto-suave">Sin adjuntos.</p> : (
        <div className="galeria-adjuntos">
          {lista.map((a) => (
            <div className="ficha-adjunto" key={a.id}>
              <button type="button" className="miniatura" style={{ border: 'none', cursor: 'pointer', width: '100%' }}
                onClick={() => void abrir(a)} aria-label={`Abrir ${a.nombre_original}`}>
                {a.mime.startsWith('image/')
                  ? (miniaturas[a.id] ? <img src={miniaturas[a.id]} alt={a.nombre_original} /> : '🖼')
                  : '📄'}
              </button>
              <div style={{ overflowWrap: 'anywhere' }}>{a.nombre_original}</div>
              <div className="texto-suave">{(a.tamano_bytes / 1024).toFixed(0)} KB · {fmtFechaHora(a.creado_en)}</div>
              <div className="acciones-fila">
                <button type="button" className="boton-silencioso" onClick={() => void abrir(a)}>Ver</button>
                <button type="button" className="boton-silencioso" onClick={() => void descargar(a)}>Descargar</button>
                {puedeSubir ? <button type="button" className="boton-silencioso" onClick={() => void eliminar(a)}>Eliminar</button> : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {cargas.map((c, i) => (
        <div key={i} className="ficha-adjunto" style={{ marginBottom: '0.4rem' }}>
          <div>{c.nombre} — {c.estado === 'subiendo' ? `subiendo ${c.progreso}%` : c.estado === 'registrando' ? 'registrando…' : 'no se pudo adjuntar'}</div>
          {c.estado !== 'error' ? <div className="progreso"><span style={{ width: `${c.progreso}%` }} /></div> : null}
          {c.error ? <div className="campo-error">⚠ {c.error}</div> : null}
        </div>
      ))}

      {puedeSubir && restantes > 0 ? (
        <div
          className={`zona-carga${arrastrando ? ' activa' : ''}`}
          role="button" tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); } }}
          onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
          onDragLeave={() => setArrastrando(false)}
          onDrop={(e) => { e.preventDefault(); setArrastrando(false); void subirArchivos(Array.from(e.dataTransfer.files)); }}
        >
          <b>Arrastra aquí fotos o PDF</b> o haz clic para elegirlos
          <div className="texto-suave">JPG, PNG, WebP o PDF · máximo {MAX_MB} MB cada uno · puedes agregar {restantes} más</div>
          <input ref={inputRef} type="file" multiple hidden
            accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
            onChange={(e) => void subirArchivos(Array.from(e.target.files ?? []))} />
        </div>
      ) : null}
      <MensajeError texto={error} />
      <MensajeExito texto={exito} />

      <Modal titulo={visor?.nombre ?? ''} abierto={!!visor} alCerrar={() => setVisor(null)}>
        {visor ? <img className="visor-imagen" src={visor.url} alt={visor.nombre} /> : null}
      </Modal>
    </div>
  );
}
