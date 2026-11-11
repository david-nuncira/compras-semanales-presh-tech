// Miniaturas de artículos y galería ampliada. Las fotos son privadas: se
// descargan con la sesión (nunca enlaces públicos) y solo cuando la miniatura
// entra en pantalla (carga diferida).
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, limpiarError } from '../supabase.ts';
import type { Adjunto } from '../tipos.ts';
import { Boton, Icono, Modal } from './UI.tsx';

/** Adjuntos de varios artículos en UNA sola consulta, agrupados por artículo. */
export function useAdjuntosArticulos(ids: string[], refresco = 0) {
  const [porArticulo, setPorArticulo] = useState<Record<string, Adjunto[]>>({});
  const [error, setError] = useState<string | null>(null);
  const clave = ids.join(',');
  useEffect(() => {
    if (ids.length === 0) { setPorArticulo({}); return; }
    let vivo = true;
    supabase.from('adjuntos').select('*').eq('entidad', 'articulo').is('cotizacion_id', null).in('entidad_id', ids)
      .order('creado_en', { ascending: true })
      .then(({ data, error: e }) => {
        if (!vivo) return;
        if (e) { setError(limpiarError(e.message)); return; }
        setError(null);
        const g: Record<string, Adjunto[]> = {};
        for (const a of (data ?? []) as Adjunto[]) (g[a.entidad_id] ??= []).push(a);
        setPorArticulo(g);
      });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave, refresco]);
  return { porArticulo, error };
}

/** Descarga autenticada de una imagen a una URL local temporal. */
async function urlDeAdjunto(a: Adjunto): Promise<string | null> {
  const { data } = await supabase.storage.from('adjuntos').download(a.ruta);
  return data ? URL.createObjectURL(data) : null;
}

/**
 * Miniatura de la primera imagen del artículo. Sin foto: ícono neutro.
 * Al hacer clic abre la galería con todas las imágenes.
 */
export function MiniaturaArticulo({ nombre, adjuntos }: { nombre: string; adjuntos: Adjunto[] | undefined }) {
  const imagenes = (adjuntos ?? []).filter((a) => a.mime.startsWith('image/'));
  const primera = imagenes[0];
  const caja = useRef<HTMLButtonElement | HTMLSpanElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [galeria, setGaleria] = useState(false);

  useEffect(() => {
    const el = caja.current;
    if (!el || !primera) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const obs = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) { setVisible(true); obs.disconnect(); } });
    obs.observe(el);
    return () => obs.disconnect();
  }, [primera?.id]);

  useEffect(() => {
    if (!visible || !primera) return;
    let vivo = true; let creada: string | null = null;
    void urlDeAdjunto(primera).then((u) => { if (!vivo) { if (u) URL.revokeObjectURL(u); return; } creada = u; setUrl(u); });
    return () => { vivo = false; if (creada) URL.revokeObjectURL(creada); };
  }, [visible, primera?.id]);

  if (!primera) {
    return <span className="miniatura-articulo miniatura-vacia" ref={caja as React.RefObject<HTMLSpanElement>}
      role="img" aria-label="Sin foto"><Icono nombre="documento" tam={22} /></span>;
  }
  return (
    <>
      <button type="button" className="miniatura-articulo" ref={caja as React.RefObject<HTMLButtonElement>}
        onClick={() => setGaleria(true)} aria-label={`Ver ${imagenes.length > 1 ? `las ${imagenes.length} fotos` : 'la foto'} de ${nombre}`}>
        {url ? <img src={url} alt="" loading="lazy" /> : <span className="esqueleto-linea" style={{ width: '100%', height: '100%' }} />}
        {imagenes.length > 1 ? <span className="miniatura-conteo">{imagenes.length}</span> : null}
      </button>
      {galeria ? <GaleriaImagenes titulo={nombre} imagenes={imagenes} alCerrar={() => setGaleria(false)} /> : null}
    </>
  );
}

/** Vista ampliada con navegación entre las imágenes del artículo. */
export function GaleriaImagenes({ titulo, imagenes, alCerrar }: { titulo: string; imagenes: Adjunto[]; alCerrar: () => void }) {
  const [i, setI] = useState(0);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const actual = imagenes[i];
  const cerrar = useCallback(alCerrar, [alCerrar]);

  useEffect(() => {
    if (!actual || urls[actual.id]) return;
    let vivo = true;
    void urlDeAdjunto(actual).then((u) => { if (vivo && u) setUrls((x) => ({ ...x, [actual.id]: u })); });
    return () => { vivo = false; };
  }, [actual?.id]);
  useEffect(() => () => { Object.values(urls).forEach((u) => URL.revokeObjectURL(u)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal titulo={`${titulo} · foto ${i + 1} de ${imagenes.length}`} abierto alCerrar={cerrar}>
      <div className="galeria-visor" aria-live="polite">
        {actual && urls[actual.id]
          ? <img className="visor-imagen" src={urls[actual.id]} alt={`${titulo}: ${actual.nombre_original}`} />
          : <p className="cargando" role="status">Cargando imagen…</p>}
      </div>
      {imagenes.length > 1 ? (
        <div className="modal-acciones" style={{ justifyContent: 'space-between' }}>
          <Boton onClick={() => setI((i - 1 + imagenes.length) % imagenes.length)}>← Anterior</Boton>
          <Boton onClick={() => setI((i + 1) % imagenes.length)}>Siguiente →</Boton>
        </div>
      ) : null}
    </Modal>
  );
}
