import { useCallback, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { supabase } from '../supabase.ts';
import { useSesion } from '../contexto/Sesion.tsx';
import { useActualizacionPeriodica } from '../datos.ts';
import { useNotificaciones } from './Notificaciones.tsx';
import type { Notificacion } from '../tipos.ts';

/** Solo consulta el buzón propio; la RLS del servidor determina las filas visibles. */
export function CampanaAvisos() {
  const { perfil } = useSesion();
  const { notificar } = useNotificaciones();
  const [sinLeer, setSinLeer] = useState(perfil?.notificaciones_sin_leer ?? 0);
  const visto = useRef<{ usuario: string; ultimo: number } | null>(null);
  const cargar = useCallback(async () => {
    if (!perfil || perfil.estado !== 'activo') return;
    try {
      const [conteo, ultimas] = await Promise.all([
        supabase.from('notificaciones').select('id', { count: 'exact', head: true }).is('leida_en', null),
        supabase.from('notificaciones').select('*').order('id', { ascending: false }).limit(10)
      ]);
      if (conteo.error || ultimas.error) return;
      setSinLeer(conteo.count ?? 0);
      const filas = (ultimas.data ?? []) as Notificacion[];
      if (visto.current?.usuario === perfil.id) {
        for (const n of [...filas].reverse()) {
          if (n.id > visto.current.ultimo && !n.leida_en) notificar(`${n.titulo}. ${n.cuerpo ?? ''} Consulta la campana para abrir el detalle.`, 'info', `inbox-${n.id}`);
        }
      }
      visto.current = { usuario: perfil.id, ultimo: Math.max(visto.current?.usuario === perfil.id ? visto.current.ultimo : 0, ...filas.map(n => n.id)) };
    } catch { /* El buzón ofrece reintento explícito; no interrumpir la operación en curso. */ }
  }, [perfil?.id, perfil?.estado, notificar]);
  useActualizacionPeriodica(cargar, 30000, [cargar]);
  return <NavLink to="/notificaciones" className="campana" aria-label={`Notificaciones: ${sinLeer} sin leer`}><span aria-hidden="true">♧</span><span>Avisos</span>{sinLeer ? <span className="contador">{sinLeer > 99 ? '99+' : sinLeer}</span> : null}</NavLink>;
}
