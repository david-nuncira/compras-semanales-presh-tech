import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Etapa, EstadoAprobacion, EstadoSolicitud } from '../tipos.ts';
import { ETIQUETA_ETAPA, ETIQUETA_APROBACION, ETIQUETA_ESTADO_SOLICITUD, RECORRIDO } from '../tipos.ts';
import { Campo, Formulario } from './Formularios.tsx';
import { useMensajeNotificado, useNotificaciones } from './Notificaciones.tsx';
export { Campo, Formulario } from './Formularios.tsx';

export function MensajeError({ texto }: { texto: string | null; flotante?: boolean; alCerrar?: () => void }) { useMensajeNotificado(texto, 'error'); return null; }
export function MensajeExito({ texto }: { texto: string | null; flotante?: boolean; alCerrar?: () => void }) { useMensajeNotificado(texto, 'exito'); return null; }
export function Cargando({ texto = 'Cargando información…' }: { texto?: string }) {
  return <div className="cargando" role="status"><span className="indicador-carga" aria-hidden="true" />{texto}</div>;
}
export function EstadoError({ alReintentar }: { alReintentar: () => void }) {
  return <div className="estado-vacio" role="status"><span className="estado-icono" aria-hidden="true">!</span>
    <h2>No pudimos cargar esta información</h2><p>Comprueba tu conexión y vuelve a intentarlo. Tus registros se conservan.</p>
    <button className="boton-secundario" type="button" onClick={alReintentar}>Volver a intentar</button></div>;
}
export function EstadoVacio({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return <div className="estado-vacio"><span className="estado-icono" aria-hidden="true">▤</span><h2>{titulo}</h2>{children ? <p>{children}</p> : null}</div>;
}
export function InsigniaEtapa({ etapa }: { etapa: Etapa }) {
  return <span className={`insignia etapa-${etapa}`}>{ETIQUETA_ETAPA[etapa]}</span>;
}
export function InsigniaAprobacion({ estado }: { estado: EstadoAprobacion }) {
  if (estado === 'no_requiere') return <span className="insignia-suave">No requiere</span>;
  return <span className={`insignia aprobacion-${estado}`}>Aprobación: {ETIQUETA_APROBACION[estado]}</span>;
}

const pilaModales: HTMLDivElement[] = [];
let overflowAnterior = '';
function actualizarPilaModales() {
  pilaModales.forEach((elemento, indice) => {
    const secundario = indice !== pilaModales.length - 1;
    elemento.inert = secundario;
    elemento.setAttribute('aria-hidden', String(secundario));
    if (elemento.parentElement) elemento.parentElement.style.zIndex = String(1000 + indice * 10);
  });
}

/** Un diálogo conserva el foco y exige confirmar el descarte de cambios. */
export function Modal({ titulo, abierto, alCerrar, children, ocupado = false }: {
  titulo: string; abierto: boolean; alCerrar: () => void; children: ReactNode; ocupado?: boolean;
}) {
  const dialogo = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const cambios = useRef(false);
  const cerrarRef = useRef(alCerrar);
  cerrarRef.current = alCerrar;
  const ocupadoRef = useRef(ocupado);
  ocupadoRef.current = ocupado;
  const [confirmarSalida, setConfirmarSalida] = useState(false);
  const confirmacionRef = useRef(confirmarSalida);
  confirmacionRef.current = confirmarSalida;
  const { registrarModal, notificar } = useNotificaciones();
  const pedirCerrar = useCallback(() => {
    if (ocupadoRef.current || dialogo.current?.querySelector('form[aria-busy="true"]')) {
      notificar('Espera a que termine la operación antes de cerrar esta ventana.', 'info', 'modal-ocupado'); return;
    }
    if (cambios.current) setConfirmarSalida(true); else cerrarRef.current();
  }, [notificar]);
  useEffect(() => {
    if (!abierto) return;
    cambios.current = false;
    setConfirmarSalida(false);
    const anterior = document.activeElement as HTMLElement | null;
    const elemento = dialogo.current;
    if (!elemento) return;
    if (!pilaModales.length) overflowAnterior = document.body.style.overflow;
    pilaModales.push(elemento);
    actualizarPilaModales();
    document.body.style.overflow = 'hidden';
    const quitarHost = host.current ? registrarModal(host.current) : () => {};
    const frame = requestAnimationFrame(() => (dialogo.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.modal-cerrar)') ?? dialogo.current)?.focus());
    function teclado(e: KeyboardEvent) {
      if (pilaModales[pilaModales.length - 1] !== elemento) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (confirmacionRef.current) setConfirmarSalida(false); else pedirCerrar();
      }
      if (e.key === 'Tab' && dialogo.current) {
        const area = confirmacionRef.current ? dialogo.current.querySelector('[data-confirmacion]') ?? dialogo.current : dialogo.current;
        const lista = Array.from(area.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]')).filter((el) => el.getClientRects().length > 0);
        const primero = lista[0], ultimo = lista[lista.length - 1];
        if (!primero) { e.preventDefault(); dialogo.current.focus(); }
        else if (e.shiftKey && (document.activeElement === primero || !area.contains(document.activeElement))) { e.preventDefault(); ultimo.focus(); }
        else if (!e.shiftKey && (document.activeElement === ultimo || !area.contains(document.activeElement))) { e.preventDefault(); primero.focus(); }
      }
    }
    const descarga = (e: BeforeUnloadEvent) => { if (cambios.current) e.preventDefault(); };
    document.addEventListener('keydown', teclado);
    window.addEventListener('beforeunload', descarga);
    return () => { cancelAnimationFrame(frame); quitarHost(); document.removeEventListener('keydown', teclado); window.removeEventListener('beforeunload', descarga);
      const eraSuperior = pilaModales[pilaModales.length - 1] === elemento;
      const indice = pilaModales.indexOf(elemento); if (indice >= 0) pilaModales.splice(indice, 1);
      actualizarPilaModales();
      if (!pilaModales.length) document.body.style.overflow = overflowAnterior;
      if (eraSuperior && anterior?.isConnected) anterior.focus();
    };
  }, [abierto, pedirCerrar, registrarModal]);
  useEffect(() => {
    if (confirmarSalida) dialogo.current?.querySelector<HTMLElement>('[data-confirmacion] button')?.focus();
    else if (abierto && cambios.current) dialogo.current?.focus();
  }, [confirmarSalida, abierto]);
  if (!abierto) return null;
  return createPortal(<div className="modal-fondo" onClick={(e) => { if (e.target === e.currentTarget) pedirCerrar(); }}>
    <div ref={dialogo} className="modal" role="dialog" aria-modal="true" aria-label={titulo} tabIndex={-1}
      onInputCapture={() => { cambios.current = true; }} onChangeCapture={() => { cambios.current = true; }}
      onClickCapture={(e) => {
        const boton = (e.target as HTMLElement).closest('button');
        if (boton?.textContent?.trim() === 'Cancelar') { e.preventDefault(); e.stopPropagation(); pedirCerrar(); }
      }}>
      <div className="modal-cabecera"><div><span className="sobre-titulo">COMPRAS · PRESH TECH</span><h2>{titulo}</h2></div>
        <button type="button" className="boton-silencioso modal-cerrar" onClick={pedirCerrar} aria-label="Cerrar ventana">×</button></div>
      <div className="modal-cuerpo" {...(confirmarSalida ? { inert: '' } : {})}>{children}</div>
      {confirmarSalida ? <div className="confirmar-salida" data-confirmacion role="alertdialog" aria-label="Descartar cambios sin guardar" aria-modal="true">
        <h3>Tienes cambios sin guardar</h3><p>Puedes seguir editando o descartar lo que escribiste.</p><div className="acciones-fila">
          <button className="boton-secundario" type="button" onClick={() => setConfirmarSalida(false)}>Seguir editando</button>
          <button className="boton-peligro" type="button" onClick={() => { cambios.current = false; cerrarRef.current(); }}>Descartar cambios</button>
        </div></div> : null}
      <div ref={host} />
    </div>
  </div>, document.body);
}

export function BotonConMotivo({ etiqueta, titulo, descripcion, onConfirmar, clase }: {
  etiqueta: string; titulo: string; descripcion?: string; onConfirmar: (motivo: string) => Promise<void>; clase?: string;
}) {
  const [abierto, setAbierto] = useState(false), [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null), [ocupado, setOcupado] = useState(false);
  const bloqueo = useRef(false);
  const { notificar } = useNotificaciones();
  return <>
    <button type="button" className={clase ?? 'boton-secundario'} onClick={() => { setAbierto(true); setMotivo(''); setError(null); }}>{etiqueta}</button>
    <Modal titulo={titulo} abierto={abierto} alCerrar={() => setAbierto(false)} ocupado={ocupado}>
      {descripcion ? <p>{descripcion}</p> : null}
      <Formulario className="formulario" onSubmit={async () => {
        if (bloqueo.current) return;
        bloqueo.current = true; setOcupado(true); setError(null);
        try { await onConfirmar(motivo.trim()); setAbierto(false); notificar('La acción quedó registrada correctamente.', 'exito'); }
        catch (e) { setError(e instanceof Error ? e.message : String(e)); }
        finally { bloqueo.current = false; setOcupado(false); }
      }}>
        <Campo etiqueta="Motivo" requerido ayuda="Explica la razón de esta acción. Quedará en el historial."><textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} /></Campo>
        <MensajeError texto={error} />
        <div className="modal-acciones"><button type="button" className="boton-secundario" onClick={() => setAbierto(false)}>Cancelar</button>
          <button type="submit" className="boton-primario" disabled={ocupado}>{ocupado ? 'Guardando…' : 'Confirmar'}</button></div>
      </Formulario>
    </Modal>
  </>;
}
export function Paginador({ pagina, porPagina, total, alCambiar }: { pagina: number; porPagina: number; total: number; alCambiar: (p: number) => void }) {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  return <div className="paginador"><span>{total} registro{total === 1 ? '' : 's'} · Página {pagina} de {paginas}</span><span>
    <button type="button" className="boton-secundario" disabled={pagina <= 1} onClick={() => alCambiar(pagina - 1)}>← Anterior</button>
    <button type="button" className="boton-secundario" disabled={pagina >= paginas} onClick={() => alCambiar(pagina + 1)}>Siguiente →</button>
  </span></div>;
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
