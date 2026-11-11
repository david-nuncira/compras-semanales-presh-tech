// Resumen de pendientes compartido por el menú (contadores) y el Inicio.
// Usa SOLO datos que ya existen: fn_resumen_tablero y conteos de v_articulos.
import { createContext, useCallback, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { supabase, limpiarError } from '../supabase.ts';
import { useSesion } from './Sesion.tsx';
import { usePermisos } from '../permisos.ts';
import { useActualizacionPeriodica } from '../datos.ts';

export interface ResumenTablero {
  pendientes: number; por_aprobar: number; atrasados: number; por_llegar: number;
  en_almacen: number; entregados: number; novedades_abiertas: number;
  aprobaciones_jefe_mias?: number; pendientes_aprobacion?: number; programadas?: number;
  pendientes_entrega?: number; mis_devueltas?: number;
}

interface ValorResumen {
  resumen: ResumenTablero | null;
  /** Artículos recibidos por Compras que aún no se cotizan (solo Compras). */
  sinCotizar: number | null;
  /** Artículos del solicitante con saldo en almacén para recoger (solo solicitante). */
  paraRecoger: number | null;
  hora: string;
  error: string | null;
  recargar: () => Promise<void>;
}

const Ctx = createContext<ValorResumen>({
  resumen: null, sinCotizar: null, paraRecoger: null, hora: '', error: null, recargar: async () => {}
});

export function useResumen(): ValorResumen {
  return useContext(Ctx);
}

export function ProveedorResumen({ children }: { children: ReactNode }) {
  const { perfil, esActivo, sesion } = useSesion();
  const p = usePermisos();
  const [resumen, setResumen] = useState<ResumenTablero | null>(null);
  const [sinCotizar, setSinCotizar] = useState<number | null>(null);
  const [paraRecoger, setParaRecoger] = useState<number | null>(null);
  const [hora, setHora] = useState('');
  const [error, setError] = useState<string | null>(null);
  const activo = !!sesion && !!perfil && esActivo;
  const perfilId = perfil?.id ?? null;

  const cargar = useCallback(async () => {
    if (!activo) return;
    const { data, error: e } = await supabase.rpc('fn_resumen_tablero');
    if (e) { setError(limpiarError(e.message)); return; }
    setError(null);
    if (data) {
      setResumen(data as ResumenTablero);
      setHora(new Date().toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' }));
    }
    if (p.gestor) {
      const { count } = await supabase.from('v_articulos').select('id', { count: 'exact', head: true })
        .eq('en_bandeja_compras', true).eq('etapa', 'solicitado');
      setSinCotizar(count ?? null);
    }
    if (p.solicitante && perfilId) {
      const { count, error: e2 } = await supabase.from('v_articulos').select('id', { count: 'exact', head: true })
        .eq('solicitante_id', perfilId).gt('disponible_almacen', 0);
      setParaRecoger(e2 ? null : (count ?? null));
    }
  }, [activo, p.gestor, p.solicitante, perfilId]);

  useActualizacionPeriodica(cargar, 60000, [cargar]);

  return <Ctx.Provider value={{ resumen, sinCotizar, paraRecoger, hora, error, recargar: cargar }}>{children}</Ctx.Provider>;
}
