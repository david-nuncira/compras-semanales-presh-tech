// Zona de fotos DENTRO del formulario del artículo: se pueden elegir (o tomar con la cámara)
// antes de guardar; se suben al guardar el artículo.
import { useRef, useState } from 'react';
import { Boton, Icono } from './UI.tsx';
import { prepararFoto, liberarFotos, MAX_FOTOS, type FotoPendiente } from '../util/fotos.ts';

export function FotosDelFormulario({ fotos, alCambiar, maximo = MAX_FOTOS, deshabilitado }: {
  fotos: FotoPendiente[]; alCambiar: (fotos: FotoPendiente[]) => void; maximo?: number; deshabilitado?: boolean;
}) {
  const galeria = useRef<HTMLInputElement>(null);
  const camara = useRef<HTMLInputElement>(null);
  const [errores, setErrores] = useState<string[]>([]);
  const [preparando, setPreparando] = useState(false);
  const caben = Math.max(0, maximo - fotos.length);

  async function agregar(archivos: File[]) {
    if (!archivos.length) return;
    setPreparando(true);
    const nuevas: FotoPendiente[] = []; const msgs: string[] = [];
    for (const a of archivos.slice(0, caben)) {
      const r = await prepararFoto(a);
      if ('foto' in r) nuevas.push(r.foto); else msgs.push(r.error);
    }
    if (archivos.length > caben) msgs.push(`Puedes adjuntar hasta ${maximo} fotos por artículo; solo se tomaron las que caben.`);
    setErrores(msgs); setPreparando(false);
    if (nuevas.length) alCambiar([...fotos, ...nuevas]);
    if (galeria.current) galeria.current.value = '';
    if (camara.current) camara.current.value = '';
  }

  function quitar(id: string) {
    const f = fotos.find((x) => x.id === id);
    if (f) liberarFotos([f]);
    alCambiar(fotos.filter((x) => x.id !== id));
  }

  return (
    <fieldset className="fotos-formulario" disabled={deshabilitado}>
      <legend>Fotos del artículo <span className="marca-opcional">(opcional, hasta {maximo})</span></legend>
      {fotos.length > 0 ? (
        <ul className="fotos-lista" aria-label="Fotos listas para guardar con el artículo">
          {fotos.map((f) => (
            <li key={f.id}>
              <img src={f.url} alt={`Vista previa de ${f.nombre}`} />
              <button type="button" className="boton-silencioso" onClick={() => quitar(f.id)} aria-label={`Quitar ${f.nombre}`}>Quitar</button>
            </li>
          ))}
        </ul>
      ) : null}
      {caben > 0 ? (
        <div className="acciones-fila">
          <Boton onClick={() => galeria.current?.click()} disabled={preparando}><Icono nombre="mas" /> Elegir fotos</Boton>
          <Boton onClick={() => camara.current?.click()} disabled={preparando}><Icono nombre="mas" /> Tomar foto con la cámara</Boton>
          <input ref={galeria} className="archivo-input" tabIndex={-1} type="file" accept="image/jpeg,image/png,image/webp" multiple
            aria-label="Elegir fotos del artículo" onChange={(e) => void agregar(Array.from(e.target.files ?? []))} />
          <input ref={camara} className="archivo-input" tabIndex={-1} type="file" accept="image/*" capture="environment"
            aria-label="Tomar foto con la cámara" onChange={(e) => void agregar(Array.from(e.target.files ?? []))} />
        </div>
      ) : <p className="texto-suave">Ya tienes el máximo de fotos para este artículo.</p>}
      <p className="campo-ayuda" role="status">{preparando ? 'Preparando las fotos…' : 'Las fotos se guardan junto con el artículo. JPG, PNG o WebP de hasta 5 MB.'}</p>
      {errores.length > 0 ? <p className="campo-error" role="alert">{errores.join(' ')}</p> : null}
    </fieldset>
  );
}
