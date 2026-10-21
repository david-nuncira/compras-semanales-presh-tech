import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, rpc, limpiarError, nuevoOp } from '../supabase.ts';
import type { Adjunto, EntidadAdjunto } from '../tipos.ts';
import { comprimirSiConviene, tipoFinal, extensionDe } from '../util/imagenes.ts';
import { MensajeError, Cargando } from './UI.tsx';
import { fmtFechaHora } from '../util/fechas.ts';

const TIPOS_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_MB = 5;

/**
 * Adjuntos privados de una entidad. Descarga SIEMPRE autenticada por petición
 * (storage.download con el JWT vigente); sin enlaces públicos ni firmados.
 */
export function Adjuntos({ entidad, entidadId, puedeSubir, maxArchivos = 3 }: {
  entidad: EntidadAdjunto; entidadId: string; puedeSubir: boolean; maxArchivos?: number;
}) {
  const [lista, setLista] = useState<Adjunto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const cargar = useCallback(async () => {
    const { data, error: e } = await supabase
      .from('adjuntos').select('*')
      .eq('entidad', entidad).eq('entidad_id', entidadId)
      .order('creado_en', { ascending: true });
    if (e) { setError(limpiarError(e.message)); return; }
    setLista((data ?? []) as Adjunto[]);
  }, [entidad, entidadId]);

  useEffect(() => { void cargar(); }, [cargar]);

  async function subir(archivo: File) {
    setError(null);
    if (!TIPOS_PERMITIDOS.includes(archivo.type)) {
      setError('Solo se permiten archivos JPG, PNG, WebP o PDF.'); return;
    }
    const comprimido = await comprimirSiConviene(archivo);
    if (comprimido.size > MAX_MB * 1024 * 1024) {
      setError(`El archivo supera el máximo de ${MAX_MB} MB incluso tras comprimirlo.`); return;
    }
    const mime = tipoFinal(archivo, comprimido);
    const ruta = `${entidad}/${entidadId}/${crypto.randomUUID()}.${extensionDe(mime)}`;
    setSubiendo(true);
    try {
      const { error: eSubida } = await supabase.storage.from('adjuntos')
        .upload(ruta, comprimido, { contentType: mime, upsert: false });
      if (eSubida) throw new Error(limpiarError(eSubida.message));
      try {
        await rpc('fn_registrar_adjunto', {
          p_entidad: entidad, p_entidad_id: entidadId, p_ruta: ruta,
          p_nombre_original: archivo.name, p_mime: mime,
          p_tamano: comprimido.size, p_op: nuevoOp()
        });
      } catch (eRegistro) {
        // Carga fallida a mitad de camino: se retira el objeto para no dejar
        // registros falsos ni archivos huérfanos.
        await supabase.storage.from('adjuntos').remove([ruta]);
        throw eRegistro;
      }
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubiendo(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function descargar(a: Adjunto) {
    setError(null);
    const { data, error: e } = await supabase.storage.from('adjuntos').download(a.ruta);
    if (e || !data) {
      setError('No fue posible descargar el archivo (verifica que tu cuenta siga activa).');
      return;
    }
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
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (lista === null) return <Cargando texto="Cargando adjuntos…" />;

  return (
    <div className="adjuntos">
      <h4>Adjuntos ({lista.length}/{maxArchivos})</h4>
      {lista.length === 0 ? <p className="texto-suave">Sin adjuntos.</p> : (
        <ul className="lista-adjuntos">
          {lista.map((a) => (
            <li key={a.id}>
              <button type="button" className="enlace" onClick={() => void descargar(a)}>
                {a.nombre_original}
              </button>
              <span className="texto-suave"> · {(a.tamano_bytes / 1024).toFixed(0)} KB · {fmtFechaHora(a.creado_en)}</span>
              {puedeSubir ? (
                <button type="button" className="boton-silencioso" onClick={() => void eliminar(a)} aria-label={`Eliminar ${a.nombre_original}`}>🗑</button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {puedeSubir && lista.length < maxArchivos ? (
        <p>
          <input ref={inputRef} type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
            disabled={subiendo}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void subir(f); }} />
          {subiendo ? <span> Subiendo…</span> : <span className="texto-suave"> JPG, PNG, WebP o PDF · máx. {MAX_MB} MB</span>}
        </p>
      ) : null}
      <MensajeError texto={error} />
    </div>
  );
}
