import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Etapa, EstadoAprobacion } from '../tipos.ts';
import { ETIQUETA_ETAPA, ETIQUETA_APROBACION } from '../tipos.ts';

/** Mensaje de error accesible (texto, no solo color). */
export function MensajeError({ texto }: { texto: string | null }) {
  if (!texto) return null;
  return <p className="mensaje mensaje-error" role="alert">⚠ {texto}</p>;
}

export function MensajeExito({ texto }: { texto: string | null }) {
  if (!texto) return null;
  return <p className="mensaje mensaje-exito" role="status">✓ {texto}</p>;
}

export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return <p className="cargando" role="status">{texto}</p>;
}

/** Insignia de etapa: texto siempre visible además del color. */
export function InsigniaEtapa({ etapa }: { etapa: Etapa }) {
  return <span className={`insignia etapa-${etapa}`}>{ETIQUETA_ETAPA[etapa]}</span>;
}

export function InsigniaAprobacion({ estado }: { estado: EstadoAprobacion }) {
  if (estado === 'no_requiere') return <span className="insignia-suave">No requiere</span>;
  return <span className={`insignia aprobacion-${estado}`}>Aprobación: {ETIQUETA_APROBACION[estado]}</span>;
}

/** Diálogo modal sencillo y accesible. */
export function Modal({ titulo, abierto, alCerrar, children }: {
  titulo: string; abierto: boolean; alCerrar: () => void; children: ReactNode;
}) {
  useEffect(() => {
    if (!abierto) return;
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') alCerrar(); };
    document.addEventListener('keydown', tecla);
    return () => document.removeEventListener('keydown', tecla);
  }, [abierto, alCerrar]);
  if (!abierto) return null;
  return (
    <div className="modal-fondo" onClick={alCerrar}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={titulo}
           onClick={(e) => e.stopPropagation()}>
        <div className="modal-cabecera">
          <h3>{titulo}</h3>
          <button type="button" className="boton-silencioso" onClick={alCerrar} aria-label="Cerrar">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Campo con etiqueta visible y error asociado. */
export function Campo({ etiqueta, requerido, error, children }: {
  etiqueta: string; requerido?: boolean; error?: string | null; children: ReactNode;
}) {
  return (
    <label className="campo">
      <span className="campo-etiqueta">{etiqueta}{requerido ? ' *' : ''}</span>
      {children}
      {error ? <span className="campo-error">{error}</span> : null}
    </label>
  );
}

/** Botón que pide un motivo antes de ejecutar una acción sensible. */
export function BotonConMotivo({ etiqueta, titulo, descripcion, onConfirmar, clase }: {
  etiqueta: string; titulo: string; descripcion?: string;
  onConfirmar: (motivo: string) => Promise<void>; clase?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  return (
    <>
      <button type="button" className={clase ?? 'boton-secundario'} onClick={() => { setAbierto(true); setMotivo(''); setError(null); }}>
        {etiqueta}
      </button>
      <Modal titulo={titulo} abierto={abierto} alCerrar={() => setAbierto(false)}>
        {descripcion ? <p>{descripcion}</p> : null}
        <Campo etiqueta="Motivo" requerido>
          <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} />
        </Campo>
        <MensajeError texto={error} />
        <div className="modal-acciones">
          <button type="button" className="boton-secundario" onClick={() => setAbierto(false)}>Cancelar</button>
          <button type="button" className="boton-primario" disabled={ocupado || motivo.trim().length === 0}
            onClick={async () => {
              setOcupado(true); setError(null);
              try { await onConfirmar(motivo.trim()); setAbierto(false); }
              catch (e) { setError(e instanceof Error ? e.message : String(e)); }
              finally { setOcupado(false); }
            }}>
            {ocupado ? 'Guardando…' : 'Confirmar'}
          </button>
        </div>
      </Modal>
    </>
  );
}

/** Paginación con total exacto sobre el conjunto autorizado completo. */
export function Paginador({ pagina, porPagina, total, alCambiar }: {
  pagina: number; porPagina: number; total: number; alCambiar: (p: number) => void;
}) {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  return (
    <div className="paginador">
      <span>{total} registro{total === 1 ? '' : 's'} en total · página {pagina} de {paginas}</span>
      <span>
        <button type="button" className="boton-silencioso" disabled={pagina <= 1} onClick={() => alCambiar(pagina - 1)}>← Anterior</button>
        <button type="button" className="boton-silencioso" disabled={pagina >= paginas} onClick={() => alCambiar(pagina + 1)}>Siguiente →</button>
      </span>
    </div>
  );
}
