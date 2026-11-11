import {
  Children, cloneElement, isValidElement, useCallback, useEffect, useId, useRef, useState
} from 'react';
import type {
  ButtonHTMLAttributes, KeyboardEvent as TeclaReact, ReactElement, ReactNode,
  SelectHTMLAttributes, TextareaHTMLAttributes
} from 'react';
import type { Etapa, EstadoAprobacion, EstadoSolicitud } from '../tipos.ts';
import { ETIQUETA_ETAPA, ETIQUETA_APROBACION, ETIQUETA_ESTADO_SOLICITUD, RECORRIDO } from '../tipos.ts';

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
   Mensajes
   ============================================================ */

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
      <span className="mensaje-texto"><Icono nombre="alerta" /> {texto}</span>
      {flotante ? <button type="button" className="boton-silencioso boton-icono" aria-label="Cerrar aviso"
        onClick={() => { setOculto(texto); alCerrar?.(); }}><Icono nombre="x" /></button> : null}
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
      <span className="mensaje-texto"><Icono nombre="check-circulo" /> {texto}</span>
      {flotante ? <button type="button" className="boton-silencioso boton-icono" aria-label="Cerrar aviso"
        onClick={() => { setOculto(texto); alCerrar?.(); }}><Icono nombre="x" /></button> : null}
    </p>
  );
}

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

export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return <p className="cargando" role="status">{texto}</p>;
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
export function EstadoVacio({ titulo, texto, accion }: { titulo: string; texto?: string; accion?: ReactNode }) {
  return (
    <div className="estado-vacio">
      <Icono nombre="documento" tam={28} />
      <h3>{titulo}</h3>
      {texto ? <p className="texto-suave">{texto}</p> : null}
      {accion ? <div className="acciones-fila">{accion}</div> : null}
    </div>
  );
}

/** Error de carga con opción de reintentar. */
export function EstadoError({ mensaje, alReintentar }: { mensaje: string; alReintentar?: () => void }) {
  return (
    <div className="estado-error" role="alert">
      <Icono nombre="alerta" tam={22} />
      <div>
        <p><b>No se pudo cargar.</b> {mensaje}</p>
        {alReintentar ? <Boton variante="secundario" onClick={alReintentar}>Reintentar</Boton> : null}
      </div>
    </div>
  );
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

/**
 * Campo con etiqueta visible, marca de obligatorio/opcional, ayuda y error
 * junto al campo. La ayuda y el error quedan enlazados al control con
 * aria-describedby, fuera de la etiqueta.
 */
export function Campo({ etiqueta, requerido, opcional, ayuda, error, children }: {
  etiqueta: string; requerido?: boolean; opcional?: boolean; ayuda?: string;
  error?: string | null; children: ReactNode;
}) {
  const id = useId();
  const idAyuda = `${id}-ayuda`;
  const idError = `${id}-error`;
  const unico = Children.count(children) === 1 ? Children.toArray(children)[0] : null;
  const control = isValidElement(unico) && typeof unico.type === 'string' ? (unico as ReactElement<Record<string, unknown>>) : null;
  const describe = error ? idError : ayuda ? idAyuda : undefined;
  const contenido = control
    ? cloneElement(control, {
        'aria-describedby': [control.props['aria-describedby'] as string | undefined, describe].filter(Boolean).join(' ') || undefined,
        'aria-invalid': error ? true : control.props['aria-invalid'],
        'aria-required': requerido ? true : control.props['aria-required']
      })
    : children;
  return (
    <div className={`campo${error ? ' campo-con-error' : ''}`}>
      <label className="campo-rotulo">
        <span className="campo-etiqueta">
          {etiqueta}
          {requerido ? <span className="marca-obligatorio"> * obligatorio</span> : null}
          {opcional ? <span className="marca-opcional"> (opcional)</span> : null}
        </span>
        {contenido}
      </label>
      {ayuda && !error ? <span id={idAyuda} className="campo-ayuda">{ayuda}</span> : null}
      {error ? <span id={idError} className="campo-error" role="alert"><Icono nombre="alerta" tam={14} /> {error}</span> : null}
    </div>
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
export function useDialogoAccesible(abierto: boolean, alCerrar: () => void, ref: React.RefObject<HTMLElement>) {
  const cerrarRef = useRef(alCerrar);
  cerrarRef.current = alCerrar;
  useEffect(() => {
    if (!abierto) return;
    const previo = document.activeElement as HTMLElement | null;
    const contenedor = ref.current;
    const lista = () => Array.from(contenedor?.querySelectorAll<HTMLElement>(ENFOCABLES) ?? []);
    const cuerpo = contenedor?.querySelector<HTMLElement>('[data-cuerpo]');
    (cuerpo?.querySelector<HTMLElement>(ENFOCABLES) ?? lista()[0] ?? contenedor)?.focus();
    const tecla = (e: KeyboardEvent) => {
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
      document.body.style.overflow = desbordeAnterior;
      if (previo && document.contains(previo)) previo.focus();
    };
  }, [abierto, ref]);
}

/** Diálogo modal accesible: atrapa el foco, se cierra con Esc y devuelve el foco. */
export function Modal({ titulo, abierto, alCerrar, children }: {
  titulo: string; abierto: boolean; alCerrar: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const idTitulo = useId();
  useDialogoAccesible(abierto, alCerrar, ref);
  if (!abierto) return null;
  return (
    <div className="modal-fondo" onMouseDown={(e) => { if (e.target === e.currentTarget) alCerrar(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={idTitulo} ref={ref} tabIndex={-1}>
        <div className="modal-cabecera">
          <h3 id={idTitulo}>{titulo}</h3>
          <button type="button" className="boton-silencioso boton-icono" onClick={alCerrar} aria-label="Cerrar"><Icono nombre="x" /></button>
        </div>
        <div data-cuerpo>{children}</div>
      </div>
    </div>
  );
}

/** Panel lateral (derecha) para vista rápida o edición sin salir de la lista. */
export function PanelLateral({ titulo, abierto, alCerrar, children, pie }: {
  titulo: string; abierto: boolean; alCerrar: () => void; children: ReactNode; pie?: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const idTitulo = useId();
  useDialogoAccesible(abierto, alCerrar, ref);
  if (!abierto) return null;
  return (
    <div className="modal-fondo panel-fondo" onMouseDown={(e) => { if (e.target === e.currentTarget) alCerrar(); }}>
      <aside className="panel-lateral" role="dialog" aria-modal="true" aria-labelledby={idTitulo} ref={ref} tabIndex={-1}>
        <div className="modal-cabecera">
          <h3 id={idTitulo}>{titulo}</h3>
          <button type="button" className="boton-silencioso boton-icono" onClick={alCerrar} aria-label="Cerrar panel"><Icono nombre="x" /></button>
        </div>
        <div className="panel-cuerpo" data-cuerpo>{children}</div>
        {pie ? <div className="modal-acciones">{pie}</div> : null}
      </aside>
    </div>
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
  const cerrar = useCallback(() => setAbierto(false), []);
  return (
    <>
      <button type="button" className={clase ?? 'boton-secundario'} onClick={() => { setAbierto(true); setMotivo(''); setError(null); }}>
        {etiqueta}
      </button>
      <Modal titulo={titulo} abierto={abierto} alCerrar={cerrar}>
        {descripcion ? <p>{descripcion}</p> : null}
        <Campo etiqueta="Motivo" requerido>
          <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} />
        </Campo>
        <MensajeError texto={error} />
        <div className="modal-acciones">
          <button type="button" className="boton-secundario" onClick={cerrar}>Cancelar</button>
          <Boton variante="primario" cargando={ocupado} disabled={motivo.trim().length === 0}
            onClick={async () => {
              setOcupado(true); setError(null);
              try { await onConfirmar(motivo.trim()); setAbierto(false); setHecho(`${titulo}: guardado.`); }
              catch (e) { setError(e instanceof Error ? e.message : String(e)); }
              finally { setOcupado(false); }
            }}>
            {ocupado ? 'Guardando…' : 'Confirmar'}
          </Boton>
        </div>
      </Modal>
      <MensajeExito texto={hecho} flotante alCerrar={() => setHecho(null)} />
    </>
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
}

/**
 * Tabla de datos con fila de altura fija, esqueleto mientras carga (filas = null),
 * estado de error con reintento y estado vacío con acción sugerida.
 * Solo la tabla se desplaza horizontalmente dentro de su contenedor.
 */
export function TablaDatos<T>({ titulo, columnas, filas, clave, error, alReintentar, vacio }: {
  titulo: string; columnas: ColumnaDatos<T>[]; filas: T[] | null; clave: (fila: T) => string;
  error?: string | null; alReintentar?: () => void; vacio?: ReactNode;
}) {
  if (error) return <EstadoError mensaje={error} alReintentar={alReintentar} />;
  if (filas && filas.length === 0) return <>{vacio ?? <EstadoVacio titulo="No hay registros" />}</>;
  return (
    <div className="tabla-envoltura" tabIndex={0} role="region" aria-label={titulo}>
      <table className="tabla tabla-datos">
        <caption className="solo-lectores">{titulo}</caption>
        <thead>
          <tr>{columnas.map((c) => (
            <th key={c.clave} scope="col" className={c.numerico ? 'numero' : undefined} style={c.ancho ? { width: c.ancho } : undefined}>{c.titulo}</th>
          ))}</tr>
        </thead>
        <tbody>
          {filas === null
            ? Array.from({ length: 5 }, (_, i) => (
                <tr key={i} aria-hidden="true">{columnas.map((c) => <td key={c.clave}><span className="esqueleto-linea" style={{ height: 14 }} /></td>)}</tr>
              ))
            : filas.map((f) => (
                <tr key={clave(f)}>{columnas.map((c) => <td key={c.clave} className={c.numerico ? 'numero' : undefined}>{c.render(f)}</td>)}</tr>
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
