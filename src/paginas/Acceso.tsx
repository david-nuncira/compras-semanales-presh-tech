import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, limpiarError } from '../supabase.ts';
import { CONFIG } from '../config.ts';
import { useSesion } from '../contexto/Sesion.tsx';
import { Campo, MensajeError, MensajeExito } from '../componentes/UI.tsx';

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: {
        sitekey: string;
        callback: (token: string) => void;
        'expired-callback'?: () => void;
        'error-callback'?: () => void;
      }) => string;
      reset: (id?: string) => void;
    };
  }
}

/** Widget Turnstile (anti-robots). El token lo valida el SERVIDOR de Auth. */
function Turnstile({ onToken }: { onToken: (t: string | null) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const idRef = useRef<string | null>(null);
  useEffect(() => {
    if (!CONFIG.TURNSTILE_SITE_KEY || !ref.current) return;
    let cancelado = false;
    function montar() {
      if (cancelado || !ref.current || !window.turnstile) return;
      idRef.current = window.turnstile.render(ref.current, {
        sitekey: CONFIG.TURNSTILE_SITE_KEY,
        callback: (t) => onToken(t),
        'expired-callback': () => onToken(null),
        'error-callback': () => onToken(null)
      });
    }
    if (window.turnstile) { montar(); }
    else {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      s.async = true;
      s.onload = montar;
      document.head.appendChild(s);
    }
    return () => { cancelado = true; };
  }, [onToken]);
  if (!CONFIG.TURNSTILE_SITE_KEY) return null;
  return <div ref={ref} />;
}

export function Acceso() {
  const { sesion, perfil, esActivo } = useSesion();
  const navegar = useNavigate();
  const [modo, setModo] = useState<'entrar' | 'registro'>('entrar');
  const [nombre, setNombre] = useState('');
  const [correo, setCorreo] = useState('');
  const [clave, setClave] = useState('');
  const [clave2, setClave2] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (sesion && perfil) navegar(esActivo ? '/' : '/pendiente', { replace: true });
  }, [sesion, perfil, esActivo, navegar]);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setExito(null);
    if (CONFIG.TURNSTILE_SITE_KEY && !token) {
      setError('Completa la verificación "No soy un robot".'); return;
    }
    setOcupado(true);
    try {
      if (modo === 'registro') {
        if (nombre.trim().length < 3) throw new Error('Escribe tu nombre completo.');
        if (clave.length < 10) throw new Error('La contraseña debe tener al menos 10 caracteres.');
        if (clave !== clave2) throw new Error('Las contraseñas no coinciden.');
        const { error: e1 } = await supabase.auth.signUp({
          email: correo.trim().toLowerCase(),
          password: clave,
          options: {
            captchaToken: token ?? undefined,
            data: { nombre: nombre.trim() }
          }
        });
        if (e1) throw new Error(traducirAuth(e1.message));
        setExito('Registro recibido. Tu cuenta queda PENDIENTE: el administrador verificará tu identidad por un canal corporativo y la activará. Escribir un correo de la empresa no otorga acceso por sí solo.');
      } else {
        const { error: e2 } = await supabase.auth.signInWithPassword({
          email: correo.trim().toLowerCase(),
          password: clave,
          options: { captchaToken: token ?? undefined }
        });
        if (e2) throw new Error(traducirAuth(e2.message));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      if (window.turnstile) window.turnstile.reset();
      setToken(null);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="acceso">
      <p className="marca-grande">🛒 Compras Semanales Presh Tech</p>
      <div className="acciones-fila" role="tablist">
        <button type="button" className={modo === 'entrar' ? 'boton-primario' : 'boton-secundario'}
          onClick={() => { setModo('entrar'); setError(null); setExito(null); }}>Iniciar sesión</button>
        <button type="button" className={modo === 'registro' ? 'boton-primario' : 'boton-secundario'}
          onClick={() => { setModo('registro'); setError(null); setExito(null); }}>Registrarme</button>
      </div>
      <form className="formulario" onSubmit={enviar}>
        {modo === 'registro' ? (
          <Campo etiqueta="Nombre completo" requerido>
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="name" maxLength={120} />
          </Campo>
        ) : null}
        <Campo etiqueta="Correo corporativo" requerido>
          <input type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} autoComplete="username" />
        </Campo>
        <Campo etiqueta="Contraseña" requerido>
          <input type="password" value={clave} onChange={(e) => setClave(e.target.value)}
            autoComplete={modo === 'registro' ? 'new-password' : 'current-password'} minLength={modo === 'registro' ? 10 : undefined} />
        </Campo>
        {modo === 'registro' ? (
          <Campo etiqueta="Repite la contraseña" requerido>
            <input type="password" value={clave2} onChange={(e) => setClave2(e.target.value)} autoComplete="new-password" />
          </Campo>
        ) : null}
        <Turnstile onToken={setToken} />
        <MensajeError texto={error} />
        <MensajeExito texto={exito} />
        <button type="submit" className="boton-primario" disabled={ocupado}>
          {ocupado ? 'Procesando…' : modo === 'registro' ? 'Crear cuenta (queda pendiente de activación)' : 'Entrar'}
        </button>
      </form>
      <hr className="separador" />
      <p className="texto-suave">
        ¿Olvidaste tu contraseña? La recuperación es supervisada: pídesela al
        administrador por un canal corporativo; te entregará un enlace de un
        solo uso para definir una nueva.
      </p>
    </div>
  );
}

function traducirAuth(m: string): string {
  const t = m.toLowerCase();
  if (t.includes('invalid login credentials')) return 'Correo o contraseña incorrectos.';
  if (t.includes('user already registered')) return 'Ese correo ya está registrado. Si no recuerdas la contraseña, pide la recuperación supervisada al administrador.';
  if (t.includes('captcha')) return 'La verificación anti-robots falló; intenta de nuevo.';
  if (t.includes('password should be')) return 'La contraseña no cumple el mínimo configurado.';
  if (t.includes('rate limit') || t.includes('too many')) return 'Demasiados intentos; espera un momento e intenta de nuevo.';
  return limpiarError(m);
}
