import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type {
  ButtonHTMLAttributes, KeyboardEvent as TeclaReact, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes
} from 'react';
import { createPortal } from 'react-dom';
import type { Etapa, EstadoAprobacion, EstadoSolicitud } from '../tipos.ts';
import { ETIQUETA_ETAPA, ETIQUETA_APROBACION, ETIQUETA_ESTADO_SOLICITUD, RECORRIDO } from '../tipos.ts';
import { textoHace } from '../util/envio.ts';
import { Campo, Formulario } from './Formularios.tsx';
import { useMensajeNotificado, useNotificaciones } from './Notificaciones.tsx';
export { Campo, Formulario } from './Formularios.tsx';

/* ============================================================
   Íconos (SVG en línea, sin dependencias). Siempre acompañan a
   un texto; por defecto están ocultos para lectores de pantalla.
   ============================================================ */
const TRAZOS = {
  inicio: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  documento: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
  check: 'M5 12l5 5 9-10',
  'check-circulo': 'M12 3a9 9 0 100 18 9 9 0 000-18zM8 12l3 3 5-6',
  x: 'M6 6l12 12M18 6L6 18',
  'x-circulo': 'M12 3a9 9 0 100 18 9 9 0 000-18zM9 9l6 6M15 9l-6 6',
  alerta: 'M12 3l10 18H2zM12 10v5M12 18v.5',
  info: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 11v6M12 7.5v.5',
  reloj: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2',
  calendario: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  devolver: 'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3',
  prohibido: 'M12 3a9 9 0 100 18 9 9 0 000-18zM5.6 5.6l12.8 12.8',
  carrito: 'M3 4h2l2 12h11l2-8H6M9 20v.5M17 20v.5',
  camion: 'M3 6h11v9H3zM14 9h4l3 3v3h-7M7 19v.5M17 19v.5',
  caja: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
  candado: 'M6 11h12v9H6zM8 11V8a4 4 0 018 0v3',
  buscar: 'M11 4a7 7 0 100 14 7 7 0 000-14zM16 16l5 5',
  grafico: 'M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3',
  engranaje: 'M12 9a3 3 0 100 6 3 3 0 000-6zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2',
  campana: 'M6 17V11a6 6 0 0112 0v6l2 2H4zM10 21h4',
  menu: 'M4 6h16M4 12h16M4 18h16',
  mas: 'M12 5v14M5 12h14',
  salir: 'M10 4H5v16h5M15 8l4 4-4 4M19 12H9',
  usuarios: 'M9 11a3 3 0 100-6 3 3 0 000 6zM3 20a6 6 0 0112 0M17 8a3 3 0 010 6M21 20a5 5 0 00-4-5',
  aprobar: 'M5 4h14v16H5zM9 12l2 2 4-5',
  flecha: 'M5 12h14M13 6l6 6-6 6'
} as const;

export type NombreIcono = keyof typeof TRAZOS;

export function Icono({ nombre, tam = 16, titulo }: { nombre: NombreIcono; tam?: number; titulo?: string }) {
  return (
    <svg className="icono" width={tam} height={tam} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      role={titulo ? 'img' : undefined} aria-label={titulo} aria-hidden={titulo ? undefined : true} focusable="false">
      <path d={TRAZOS[nombre]} />
    </svg>
  );
}

/* ============================================================
   Mensajes: se muestran como avisos del sistema de notificaciones
   ============================================================ */
export function MensajeError({ texto }: { texto: string | null; flotante?: boolean; alCerrar?: () => void }) { useMensajeNotificado(texto, 'error'); return null; }
export function MensajeExito({ texto }: { texto: string | null; flotante?: boolean; alCerrar?: () => void }) { useMensajeNotificado(texto, 'exito'); return null; }

/* ============================================================
   Insignias de estado: SIEMPRE color + ícono + texto.
   Una solicitud rechazada o cancelada nunca usa el tono de éxito.
   ============================================================ */
export type Tono = 'exito' | 'aviso' | 'error' | 'info' | 'neutro';

export function Insignia({ tono, icono, children }: { tono: Tono; icono: NombreIcono; children: ReactNode }) {
  return <span className={`insignia insignia-${tono}`}><Icono nombre={icono} tam={14} />{children}</span>;
}

const VISTA_SOLICITUD: Record<EstadoSolicitud, { tono: Tono; icono: NombreIcono }> = {
  borrador: { tono: 'neutro', icono: 'documento' },
  pendiente_aprobacion: { tono: 'aviso', icono: 'reloj' },
  programada: { tono: 'info', icono: 'calendario' },
  recibida_compras: { tono: 'info', icono: 'check-circulo' },
  enviada: { tono: 'info', icono: 'check-circulo' },
  en_correccion: { tono: 'aviso', icono: 'devolver' },
  rechazada: { tono: 'error', icono: 'x-circulo' },
  cancelada: { tono: 'error', icono: 'prohibido' }
};

/** Estado de la solicitud con color, ícono y texto. */
export function InsigniaSolicitud({ estado }: { estado: EstadoSolicitud }) {
  const v = VISTA_SOLICITUD[estado] ?? { tono: 'neutro' as Tono, icono: 'info' as NombreIcono };
  return <Insignia tono={v.tono} icono={v.icono}>{ETIQUETA_ESTADO_SOLICITUD[estado] ?? estado}</Insignia>;
}

const VISTA_ETAPA: Record<Etapa, { tono: Tono; icono: NombreIcono }> = {
  borrador: { tono: 'neutro', icono: 'documento' },
  solicitado: { tono: 'info', icono: 'reloj' },
  en_cotizacion: { tono: 'aviso', icono: 'documento' },
  cotizado: { tono: 'aviso', icono: 'check' },
  comprado: { tono: 'info', icono: 'carrito' },
  en_transito: { tono: 'info', icono: 'camion' },
  recibido_parcial: { tono: 'info', icono: 'caja' },
  recibido_total: { tono: 'exito', icono: 'check-circulo' },
  cerrado: { tono: 'neutro', icono: 'candado' },
  cancelado: { tono: 'error', icono: 'prohibido' }
};

/** Insignia de etapa: color, ícono y texto. */
export function InsigniaEtapa({ etapa }: { etapa: Etapa }) {
  const v = VISTA_ETAPA[etapa] ?? { tono: 'neutro' as Tono, icono: 'info' as NombreIcono };
  return <Insignia tono={v.tono} icono={v.icono}>{ETIQUETA_ETAPA[etapa]}</Insignia>;
}

const VISTA_APROBACION: Record<Exclude<EstadoAprobacion, 'no_requiere'>, { tono: Tono; icono: NombreIcono }> = {
  sin_solicitar: { tono: 'neutro', icono: 'documento' },
  pendiente: { tono: 'aviso', icono: 'reloj' },
  aprobada: { tono: 'exito', icono: 'check-circulo' },
  rechazada: { tono: 'error', icono: 'x-circulo' },
  reemplazada: { tono: 'neutro', icono: 'devolver' }
};

export function InsigniaAprobacion({ estado }: { estado: EstadoAprobacion }) {
  if (estado === 'no_requiere') return <span className="insignia-suave">No requiere</span>;
  const v = VISTA_APROBACION[estado];
  return <Insignia tono={v.tono} icono={v.icono}>Aprobación: {ETIQUETA_APROBACION[estado]}</Insignia>;
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

/* ============================================================
   Estados de pantalla: carga, vacío, error, sin permiso
   ============================================================ */

export function Cargando({ texto = 'Cargando información…' }: { texto?: string }) {
  return <div className="cargando" role="status"><span className="indicador-carga" aria-hidden="true" />{texto}</div>;
}

/** Esqueleto de carga: bloques grises que ocupan el lugar del contenido. */
export function Esqueleto({ lineas = 3, alto = 16, etiqueta = 'Cargando…' }: { lineas?: number; alto?: number; etiqueta?: string }) {
  return (
    <div className="esqueleto" role="status" aria-busy="true">
      <span className="solo-lectores">{etiqueta}</span>
      {Array.from({ length: lineas }, (_, i) => (
        <span key={i} className="esqueleto-linea" style={{ height: alto, width: i === lineas - 1 && lineas > 1 ? '60%' : '100%' }} />
      ))}
    </div>
  );
}

/** Estado vacío con una acción sugerida. */
export function EstadoVacio({ titulo, texto, accion, children }: { titulo: string; texto?: string; accion?: ReactNode; children?: ReactNode }) {
  const detalle = texto ?? children;
  return <div className="estado-vacio"><span className="estado-icono" aria-hidden="true">▤</span><h2>{titulo}</h2>
    {detalle ? <p>{detalle}</p> : null}{accion ? <div className="acciones-fila" style={{ justifyContent: 'center' }}>{accion}</div> : null}</div>;
}

/** Error de carga con opción de reintentar. */
export function EstadoError({ mensaje, alReintentar }: { mensaje?: string; alReintentar?: () => void }) {
  return <div className="estado-vacio" role="alert"><span className="estado-icono" aria-hidden="true">!</span>
    <h2>No pudimos cargar esta información</h2>
    <p>{mensaje ? mensaje + ' ' : ''}Comprueba tu conexión y vuelve a intentarlo. Tus registros se conservan.</p>
    {alReintentar ? <button className="boton-secundario" type="button" onClick={alReintentar}>Volver a intentar</button> : null}</div>;
}


/** Pantalla sin permiso (la seguridad real está en el servidor). */
export function SinPermiso({ texto }: { texto?: string }) {
  return (
    <div className="tarjeta estado-sin-permiso" role="alert">
      <Icono nombre="candado" tam={24} />
      <h2>Sin permiso</h2>
      <p>{texto ?? 'Tu cuenta no tiene el permiso necesario para esta sección. Si crees que es un error, contacta al administrador.'}</p>
    </div>
  );
}

/* ============================================================
   Botón y campos de formulario
   ============================================================ */
export type VarianteBoton = 'primario' | 'secundario' | 'peligro' | 'fantasma';
const CLASE_BOTON: Record<VarianteBoton, string> = {
  primario: 'boton-primario', secundario: 'boton-secundario', peligro: 'boton-peligro', fantasma: 'boton-silencioso'
};

export function Boton({ variante = 'secundario', cargando, children, className, disabled, type = 'button', ...resto }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variante?: VarianteBoton; cargando?: boolean }) {
  return (
    <button type={type} {...resto} disabled={disabled || cargando} aria-busy={cargando || undefined}
      className={`${CLASE_BOTON[variante]}${cargando ? ' boton-cargando' : ''}${className ? ` ${className}` : ''}`}>
      {cargando ? <span className="giro" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export interface OpcionSelect { valor: string; etiqueta: string; deshabilitada?: boolean }

/** Select con lista de opciones y texto inicial opcional. Úsalo dentro de <Campo>. */
export function Select({ opciones, inicial, ...resto }:
  Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> & { opciones: OpcionSelect[]; inicial?: string }) {
  return (
    <select {...resto}>
      {inicial !== undefined ? <option value="">{inicial}</option> : null}
      {opciones.map((o) => <option key={o.valor} value={o.valor} disabled={o.deshabilitada}>{o.etiqueta}</option>)}
    </select>
  );
}

/** Textarea con contador de caracteres cuando hay límite. Úsalo dentro de <Campo>. */
export function Textarea({ contador, ...resto }: TextareaHTMLAttributes<HTMLTextAreaElement> & { contador?: boolean }) {
  const largo = String(resto.value ?? '').length;
  return (
    <>
      <textarea rows={3} {...resto} />
      {contador && resto.maxLength ? <span className="campo-ayuda" aria-live="polite">{largo} / {resto.maxLength}</span> : null}
    </>
  );
}

/* ============================================================
   Modal y panel lateral accesibles
   ============================================================ */
const ENFOCABLES = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Atrapa el foco dentro del contenedor, cierra con Esc, bloquea el scroll del
 * fondo y devuelve el foco al elemento que abrió el diálogo.
 */
const PILA_DIALOGOS: symbol[] = [];

export function useDialogoAccesible(abierto: boolean, alCerrar: () => void, ref: React.RefObject<HTMLElement>) {
  const cerrarRef = useRef(alCerrar);
  cerrarRef.current = alCerrar;
  useEffect(() => {
    if (!abierto) return;
    const previo = document.activeElement as HTMLElement | null;
    const contenedor = ref.current;
    // Con diálogos anidados (p. ej. un modal dentro de un panel) solo el de arriba responde.
    const ficha = Symbol('dialogo');
    PILA_DIALOGOS.push(ficha);
    const lista = () => Array.from(contenedor?.querySelectorAll<HTMLElement>(ENFOCABLES) ?? []);
    const cuerpo = contenedor?.querySelector<HTMLElement>('[data-cuerpo]');
    (cuerpo?.querySelector<HTMLElement>(ENFOCABLES) ?? lista()[0] ?? contenedor)?.focus();
    const tecla = (e: KeyboardEvent) => {
      if (PILA_DIALOGOS[PILA_DIALOGOS.length - 1] !== ficha) return;
      if (e.key === 'Escape') { e.stopPropagation(); cerrarRef.current(); return; }
      if (e.key !== 'Tab') return;
      const f = lista();
      if (f.length === 0) { e.preventDefault(); contenedor?.focus(); return; }
      const primero = f[0]; const ultimo = f[f.length - 1];
      const activo = document.activeElement;
      if (e.shiftKey && (activo === primero || activo === contenedor)) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && activo === ultimo) { e.preventDefault(); primero.focus(); }
    };
    document.addEventListener('keydown', tecla);
    const desbordeAnterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', tecla);
      const pos = PILA_DIALOGOS.indexOf(ficha);
      if (pos >= 0) PILA_DIALOGOS.splice(pos, 1);
      document.body.style.overflow = desbordeAnterior;
      if (previo && document.contains(previo)) previo.focus();
    };
  }, [abierto, ref]);
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
export function Modal({ titulo, abierto, alCerrar, children, ocupado = false, lateral = false }: {
  titulo: string; abierto: boolean; alCerrar: () => void; children: ReactNode; ocupado?: boolean; lateral?: boolean;
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
  return createPortal(<div className={`modal-fondo${lateral ? ' panel-fondo' : ''}`} onClick={(e) => { if (e.target === e.currentTarget) pedirCerrar(); }}>
    <div ref={dialogo} className={`modal${lateral ? ' panel-lateral' : ''}`} role="dialog" aria-modal="true" aria-label={titulo} tabIndex={-1}
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

/** Panel lateral (derecha) para vista rápida o edición sin salir de la lista. */
export function PanelLateral({ titulo, abierto, alCerrar, children }: {
  titulo: string; abierto: boolean; alCerrar: () => void; children: ReactNode;
}) {
  return <Modal titulo={titulo} abierto={abierto} alCerrar={alCerrar} lateral>{children}</Modal>;
}


/**
 * Confirmación accesible para acciones irreversibles (reemplaza a confirm()).
 * Si falla, el error se muestra dentro del diálogo y no se cierra.
 */
export function ModalConfirmar({ abierto, titulo, texto, etiqueta = 'Confirmar', peligro, alConfirmar, alCerrar }: {
  abierto: boolean; titulo: string; texto: ReactNode; etiqueta?: string; peligro?: boolean;
  alConfirmar: () => Promise<void>; alCerrar: () => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (abierto) setError(null); }, [abierto]);
  return (
    <Modal titulo={titulo} abierto={abierto} alCerrar={alCerrar}>
      <p>{texto}</p>
      <MensajeError texto={error} />
      <div className="modal-acciones">
        <button type="button" className="boton-secundario" onClick={alCerrar}>Cancelar</button>
        <Boton variante={peligro ? 'peligro' : 'primario'} cargando={ocupado}
          onClick={async () => {
            setOcupado(true); setError(null);
            try { await alConfirmar(); alCerrar(); }
            catch (e) { setError(e instanceof Error ? e.message : String(e)); }
            finally { setOcupado(false); }
          }}>{etiqueta}</Boton>
      </div>
    </Modal>
  );
}

/** «Guardado hace X»: se actualiza solo cada 20 segundos. */
export function IndicadorGuardado({ cuando, guardando }: { cuando: number | null; guardando?: boolean }) {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 20000); return () => clearInterval(t); }, []);
  if (guardando) return <span className="texto-suave" role="status">Guardando…</span>;
  if (!cuando) return <span className="texto-suave">Borrador sin guardar</span>;
  return <span className="texto-suave" role="status"><Icono nombre="check" tam={14} /> Guardado {textoHace(cuando, ahora)}</span>;
}

/** Ícono «i»: al pulsarlo (o con Enter/Espacio) explica qué mide un indicador. Esc lo cierra. */
export function Ayuda({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  const [abierto, setAbierto] = useState(false);
  const id = useId();
  return (
    <span className="ayuda">
      <button type="button" className="ayuda-boton" aria-expanded={abierto} aria-controls={abierto ? id : undefined}
        aria-label={`¿Qué mide «${etiqueta}»?`} onClick={() => setAbierto(!abierto)}
        onKeyDown={(e) => { if (e.key === 'Escape') setAbierto(false); }}>
        <Icono nombre="info" tam={16} />
      </button>
      {abierto ? <span id={id} role="note" className="ayuda-texto">{children}</span> : null}
    </span>
  );
}

/** Ficha de un indicador: valor grande, título y el ícono «i» con su explicación. */
export function Indicador({ titulo, valor, ayuda, detalle }: {
  titulo: string; valor: ReactNode; ayuda: ReactNode; detalle?: ReactNode;
}) {
  return (
    <div className="indicador">
      <div className="indicador-titulo"><span>{titulo}</span><Ayuda etiqueta={titulo}>{ayuda}</Ayuda></div>
      <div className="indicador-valor">{valor}</div>
      {detalle ? <div className="texto-suave">{detalle}</div> : null}
    </div>
  );
}

/* ============================================================
   Pestañas, tabla de datos y paginación
   ============================================================ */
export interface DefPestana { id: string; titulo: string; contador?: number }

/**
 * Pestañas accesibles (flechas, Inicio y Fin). El contenido va en un
 * <PanelPestana> con el mismo id.
 */
export function Pestanas({ pestanas, activa, alCambiar, etiqueta }: {
  pestanas: DefPestana[]; activa: string; alCambiar: (id: string) => void; etiqueta: string;
}) {
  const base = useId();
  const teclas = (e: TeclaReact<HTMLDivElement>) => {
    const i = pestanas.findIndex((p) => p.id === activa);
    let n = -1;
    if (e.key === 'ArrowRight') n = (i + 1) % pestanas.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + pestanas.length) % pestanas.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = pestanas.length - 1;
    if (n < 0) return;
    e.preventDefault();
    alCambiar(pestanas[n].id);
    document.getElementById(`${base}-tab-${pestanas[n].id}`)?.focus();
  };
  return (
    <div className="pestanas" role="tablist" aria-label={etiqueta} onKeyDown={teclas}>
      {pestanas.map((p) => (
        <button key={p.id} type="button" role="tab" id={`${base}-tab-${p.id}`} aria-selected={p.id === activa}
          aria-controls={`${base}-panel-${p.id}`} tabIndex={p.id === activa ? 0 : -1}
          className={`pestana${p.id === activa ? ' pestana-activa' : ''}`} onClick={() => alCambiar(p.id)}>
          {p.titulo}{p.contador !== undefined ? <span className="pestana-contador"> {p.contador}</span> : null}
        </button>
      ))}
    </div>
  );
}

export interface ColumnaDatos<T> {
  clave: string; titulo: string; render: (fila: T) => ReactNode; numerico?: boolean; ancho?: string;
  /** Muestra un botón de orden en el encabezado (requiere `alOrdenar` en la tabla). */
  ordenable?: boolean;
  /** Oculta la columna en pantallas pequeñas. */
  ocultoMovil?: boolean;
}

/**
 * Tabla de datos con fila de altura fija, esqueleto mientras carga (filas = null),
 * estado de error con reintento y estado vacío con acción sugerida.
 * Solo la tabla se desplaza horizontalmente dentro de su contenedor.
 */
export function TablaDatos<T>({ titulo, columnas, filas, clave, error, alReintentar, vacio, orden, alOrdenar, claseFila }: {
  titulo: string; columnas: ColumnaDatos<T>[]; filas: T[] | null; clave: (fila: T) => string;
  error?: string | null; alReintentar?: () => void; vacio?: ReactNode;
  orden?: { clave: string; dir: 'asc' | 'desc' }; alOrdenar?: (clave: string) => void;
  claseFila?: (fila: T) => string | undefined;
}) {
  const clases = (c: ColumnaDatos<T>) => [c.numerico ? 'numero' : '', c.ocultoMovil ? 'oculto-movil' : ''].filter(Boolean).join(' ') || undefined;
  if (error) return <EstadoError mensaje={error} alReintentar={alReintentar} />;
  if (filas && filas.length === 0) return <>{vacio ?? <EstadoVacio titulo="No hay registros" />}</>;
  return (
    <div className="tabla-envoltura" tabIndex={0} role="region" aria-label={titulo}>
      <table className="tabla tabla-datos">
        <caption className="solo-lectores">{titulo}</caption>
        <thead>
          <tr>{columnas.map((c) => {
            const activa = !!orden && orden.clave === c.clave;
            return (
              <th key={c.clave} scope="col" className={clases(c)} style={c.ancho ? { width: c.ancho } : undefined}
                aria-sort={c.ordenable && activa ? (orden!.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                {c.ordenable && alOrdenar
                  ? <button type="button" className="th-orden" onClick={() => alOrdenar(c.clave)}>{c.titulo} <span aria-hidden="true">{activa ? (orden!.dir === 'asc' ? '▲' : '▼') : '↕'}</span></button>
                  : c.titulo}
              </th>
            );
          })}</tr>
        </thead>
        <tbody>
          {filas === null
            ? Array.from({ length: 5 }, (_, i) => (
                <tr key={i} aria-hidden="true">{columnas.map((c) => <td key={c.clave} className={clases(c)}><span className="esqueleto-linea" style={{ height: 14 }} /></td>)}</tr>
              ))
            : filas.map((f) => (
                <tr key={clave(f)} className={claseFila?.(f)}>{columnas.map((c) => <td key={c.clave} className={clases(c)}>{c.render(f)}</td>)}</tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}

/** Paginación con total exacto sobre el conjunto autorizado completo. */
export function Paginador({ pagina, porPagina, total, alCambiar }: {
  pagina: number; porPagina: number; total: number; alCambiar: (p: number) => void;
}) {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  return (
    <nav className="paginador" aria-label="Paginación">
      <span aria-live="polite">{total} registro{total === 1 ? '' : 's'} en total · página {pagina} de {paginas}</span>
      <span className="paginador-botones">
        <button type="button" className="boton-secundario" disabled={pagina <= 1} onClick={() => alCambiar(pagina - 1)}>← Anterior</button>
        <button type="button" className="boton-secundario" disabled={pagina >= paginas} onClick={() => alCambiar(pagina + 1)}>Siguiente →</button>
      </span>
    </nav>
  );
}
