import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { mensajeUsuario } from '../util/errores.ts';

type Tipo = 'exito' | 'error' | 'aviso' | 'info';
interface Aviso { id: string; tipo: Tipo; texto: string; clave?: string; }
interface Servicio {
  notificar: (texto: string, tipo?: Tipo, clave?: string) => void;
  cerrar: (id: string) => void;
  cerrarClave: (clave: string) => void;
  registrarModal: (host: HTMLElement) => () => void;
}
const Ctx = createContext<Servicio | null>(null);
export function useNotificaciones() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('Falta ProveedorNotificaciones.');
  return ctx;
}
const titulos: Record<Tipo, string> = { exito: 'Listo', error: 'Necesitamos tu atención', aviso: 'Ten en cuenta', info: 'Información' };
const iconos: Record<Tipo, string> = { exito: '✓', error: '!', aviso: '!', info: 'i' };

function Notificacion({ aviso, cerrar }: { aviso: Aviso; cerrar: (id: string) => void }) {
  const [hover, setHover] = useState(false);
  const [foco, setFoco] = useState(false);
  const restante = useRef(aviso.tipo === 'exito' ? 6000 : 9000);
  useEffect(() => {
    if (aviso.tipo === 'error' || hover || foco) return;
    const inicio = Date.now();
    const timer = window.setTimeout(() => cerrar(aviso.id), restante.current);
    return () => { window.clearTimeout(timer); restante.current = Math.max(0, restante.current - (Date.now() - inicio)); };
  }, [aviso.id, aviso.tipo, cerrar, hover, foco]);
  return (
    <div className={`notificacion notificacion-${aviso.tipo}`} role={aviso.tipo === 'error' ? 'alert' : 'status'}
      aria-atomic="true" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onFocusCapture={() => setFoco(true)} onBlurCapture={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setFoco(false); }}>
      <span className="notificacion-icono" aria-hidden="true">{iconos[aviso.tipo]}</span>
      <div><strong>{titulos[aviso.tipo]}</strong><p>{aviso.texto}</p></div>
      <button type="button" className="notificacion-cerrar" onClick={() => cerrar(aviso.id)} aria-label={`Cerrar notificación: ${aviso.texto}`}>×</button>
    </div>
  );
}

export function ProveedorNotificaciones({ children }: { children: ReactNode }) {
  const secuencia = useRef(0);
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const hosts = useRef<HTMLElement[]>([]);
  const contenedor = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = contenedor.current; if (!el) return;
    const medir = () => document.documentElement.style.setProperty('--altura-avisos', avisos.length ? `${el.getBoundingClientRect().height + 20}px` : '0px');
    medir(); const observador = new ResizeObserver(medir); observador.observe(el);
    return () => { observador.disconnect(); document.documentElement.style.setProperty('--altura-avisos', '0px'); };
  }, [avisos.length, host]);
  const cerrar = useCallback((id: string) => setAvisos((xs) => xs.filter((x) => x.id !== id)), []);
  const cerrarClave = useCallback((clave: string) => setAvisos((xs) => xs.filter((x) => x.clave !== clave)), []);
  const registrarModal = useCallback((el: HTMLElement) => {
    hosts.current.push(el);
    setHost(el);
    return () => {
      hosts.current = hosts.current.filter((x) => x !== el);
      setHost(hosts.current[hosts.current.length - 1] ?? null);
    };
  }, []);
  const notificar = useCallback((mensaje: string, tipo: Tipo = 'info', clave?: string) => {
    const texto = tipo === 'error' ? mensajeUsuario(mensaje) : mensaje;
    const id = `aviso-${++secuencia.current}`;
    setAvisos((xs) => {
      if (xs.some((x) => x.texto === texto && x.tipo === tipo && x.clave === clave)) return xs;
      return [...xs.filter((x) => !clave || x.clave !== clave), { id, texto, tipo, clave }].slice(-3);
    });
  }, []);
  return <Ctx.Provider value={{ notificar, cerrar, cerrarClave, registrarModal }}>
    {children}
    {createPortal(<section ref={contenedor} className="notificaciones" aria-label="Notificaciones">
      {avisos.map((aviso) => <Notificacion key={aviso.id} aviso={aviso} cerrar={cerrar} />)}
    </section>, host ?? document.body)}
  </Ctx.Provider>;
}

/** Puente para los estados existentes: una notificación por cambio, fuera del render. */
export function useMensajeNotificado(texto: string | null, tipo: Tipo) {
  const { notificar, cerrarClave } = useNotificaciones();
  const clave = useId();
  useEffect(() => {
    if (texto) notificar(texto, tipo, clave);
    else cerrarClave(clave);
    return () => cerrarClave(clave);
  }, [texto, tipo, clave, notificar, cerrarClave]);
}
