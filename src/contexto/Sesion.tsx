import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../supabase.ts';
import type { MiPerfil, Rol } from '../tipos.ts';

interface ValorSesion {
  sesion: Session | null;
  perfil: MiPerfil | null;
  cargando: boolean;
  tiene: (rol: Rol) => boolean;
  esActivo: boolean;
  recargarPerfil: () => Promise<void>;
  salir: () => Promise<void>;
}

const Ctx = createContext<ValorSesion>({
  sesion: null, perfil: null, cargando: true,
  tiene: () => false, esActivo: false,
  recargarPerfil: async () => {}, salir: async () => {}
});

export function useSesion(): ValorSesion {
  return useContext(Ctx);
}

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [sesion, setSesion] = useState<Session | null>(null);
  const [perfil, setPerfil] = useState<MiPerfil | null>(null);
  const [cargando, setCargando] = useState(true);
  const sesionRef = useRef<Session | null>(null);

  const recargarPerfil = useCallback(async () => {
    if (!sesionRef.current) { setPerfil(null); return; }
    const { data, error } = await supabase.rpc('fn_mi_perfil');
    if (!error && data) {
      setPerfil(data as MiPerfil);
    } else if (!error) {
      setPerfil(null);
    }
  }, []);

  useEffect(() => {
    let vivo = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!vivo) return;
      sesionRef.current = data.session;
      setSesion(data.session);
      if (data.session) await recargarPerfil();
      setCargando(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (_evento, s) => {
      sesionRef.current = s;
      setSesion(s);
      if (s) await recargarPerfil(); else setPerfil(null);
    });
    return () => { vivo = false; sub.subscription.unsubscribe(); };
  }, [recargarPerfil]);

  // Revalidación periódica moderada: detecta activaciones/desactivaciones
  // hechas desde otra sesión mientras la pantalla está visible.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible' && sesionRef.current) void recargarPerfil();
    }, 60000);
    const alVolver = () => { if (sesionRef.current) void recargarPerfil(); };
    document.addEventListener('visibilitychange', alVolver);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', alVolver); };
  }, [recargarPerfil]);

  const tiene = useCallback((rol: Rol) =>
    !!perfil && perfil.estado === 'activo' && perfil.roles.includes(rol), [perfil]);

  const salir = useCallback(async () => {
    await supabase.auth.signOut();
    setPerfil(null);
  }, []);

  return (
    <Ctx.Provider value={{
      sesion, perfil, cargando, tiene,
      esActivo: !!perfil && perfil.estado === 'activo',
      recargarPerfil, salir
    }}>
      {children}
    </Ctx.Provider>
  );
}
