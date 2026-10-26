import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Etapa, EstadoAprobacion, EstadoSolicitud } from '../tipos.ts';
import { ETIQUETA_ETAPA, ETIQUETA_APROBACION, ETIQUETA_ESTADO_SOLICITUD, RECORRIDO } from '../tipos.ts';

/**
 * Mensaje de error accesible (texto, no solo color).
 * flotante: se muestra fijo en pantalla (abajo a la derecha) para que se vea
 * sin tener que desplazarse hasta el inicio de la página.
 */
export function MensajeError({ texto, flotante, alCerrar }: { texto: string | null; flotante?: boolean; alCerrar?: () => void }) {
  const [oculto, setOculto] = useState<string | null>(null);
  if (!texto || oculto === texto) return null;
  return (
    <p className={`mensaje mensaje-error${flotante ? ' mensaje-flotante' : ''}`} role="alert">
      ⚠ {texto}
      {flotante ? <button type="button" className="boton-silencioso" aria-label="Cerrar aviso"
        onClick={() => { setOculto(texto); alCerrar?.(); }}>✕</button> : null}
    </p>
  );
}

export function MensajeExito({ texto, flotante, alCerrar }: { texto: string | null; flotante?: boolean; alCerrar?: () => void }) {
  const [oculto, setOculto] = useState<string | null>(null);
  useEffect(() => {
    if (!flotante || !texto) return;
    const t = setTimeout(() => setOculto(texto), 9000);
    return () => clearTimeout(t);
  }, [flotante, texto]);
  if (!texto || oculto === texto) return null;
  return (
    <p className={`mensaje mensaje-exito${flotante ? ' mensaje-flotante' : ''}`} role="status">
      ✓ {texto}
      {flotante ? <button type="button" className="boton-silencioso" aria-label="Cerrar aviso"
        onClick={() => { setOculto(texto); alCerrar?.(); }}>✕</button> : null}
    </p>
  );
}

/** Estado de la solicitud con texto y color. */
export function InsigniaSolicitud({ estado }: { estado: EstadoSolicitud }) {
  return <span className={`insignia sol-${estado}`}>{ETIQUETA_ESTADO_SOLICITUD[estado] ?? estado}</span>;
}

/** Línea de avance del recorrido principal. */
export function LineaRecorrido({ estado, resumen }: { estado: EstadoSolicitud; resumen: Record<string, number> | null }) {
  const etapas = resumen ?? {};
  const hay = (xs: string[]) => xs.some((x) => (etapas[x] ?? 0) > 0);
  let actual = 0;
  if (estado === 'pendiente_aprobacion') actual = 1;
  else if (estado === 'programada') actual = 2;
  else if (estado === 'recibida_compras' || estado === 'enviada') {
    actual = 3;
    if (hay(['en_cotizacion', 'cotizado', 'comprado', 'en_transito'])) actual = 4;
    if (hay(['recibido_parcial', 'recibido_total'])) actual = 5;
    const vivos = Object.entries(etapas).filter(([k]) => k !== 'cancelado').reduce((s, [, n]) => s + n, 0);
    if (vivos > 0 && (etapas['cerrado'] ?? 0) === vivos) actual = 6;
  }
  const finalNegativo = estado === 'rechazada' || estado === 'cancelada';
  return (
    <ol className="recorrido" aria-label="Avance de la solicitud">
      {RECORRIDO.map((p, i) => (
        <li key={p.clave} className={finalNegativo ? 'recorrido-inactivo' : i < actual ? 'recorrido-hecho' : i === actual ? 'recorrido-actual' : ''}
            aria-current={!finalNegativo && i === actual ? 'step' : undefined}>
          <span>{i < actual && !finalNegativo ? '✓ ' : ''}{p.titulo}</span>
        </li>
      ))}
      {estado === 'en_correccion' ? <li className="recorrido-alerta"><span>↩ Devuelta para corrección</span></li> : null}
      {finalNegativo ? <li className="recorrido-alerta"><span>✕ {ETIQUETA_ESTADO_SOLICITUD[estado]}</span></li> : null}
    </ol>
  );
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

/** Campo con etiqueta visible, marca de obligatorio/opcional, ayuda y error junto al campo. */
export function Campo({ etiqueta, requerido, opcional, ayuda, error, children }: {
  etiqueta: string; requerido?: boolean; opcional?: boolean; ayuda?: string;
  error?: string | null; children: ReactNode;
}) {
  return (
    <label className={`campo${error ? ' campo-con-error' : ''}`}>
      <span className="campo-etiqueta">
        {etiqueta}
        {requerido ? <span className="marca-obligatorio" title="Obligatorio"> * obligatorio</span> : null}
        {opcional ? <span className="marca-opcional"> (opcional)</span> : null}
      </span>
      {children}
      {ayuda && !error ? <span className="campo-ayuda">{ayuda}</span> : null}
      {error ? <span className="campo-error" role="alert">⚠ {error}</span> : null}
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
  const [hecho, setHecho] = useState<string | null>(null);
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
              try { await onConfirmar(motivo.trim()); setAbierto(false); setHecho(`${titulo}: guardado.`); }
              catch (e) { setError(e instanceof Error ? e.message : String(e)); }
              finally { setOcupado(false); }
            }}>
            {ocupado ? 'Guardando…' : 'Confirmar'}
          </button>
        </div>
      </Modal>
      <MensajeExito texto={hecho} flotante alCerrar={() => setHecho(null)} />
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
