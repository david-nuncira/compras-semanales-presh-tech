// Acceso a datos compartido (catálogos, actualización periódica moderada).
import { useCallback, useEffect, useState } from 'react';
import { supabase, limpiarError } from './supabase.ts';
import type { Area, CentroCosto, Proveedor } from './tipos.ts';

export interface Catalogos {
  areas: Area[];
  centros: CentroCosto[];
  proveedores: Proveedor[];
}

export function useCatalogos(incluirInactivos = false) {
  const [cat, setCat] = useState<Catalogos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cargar = useCallback(async () => {
    const [a, c, p] = await Promise.all([
      supabase.from('areas').select('*').order('nombre'),
      supabase.from('centros_costo').select('*').order('codigo'),
      supabase.from('proveedores').select('*').order('nombre')
    ]);
    const e = a.error ?? c.error ?? p.error;
    if (e) { setError(limpiarError(e.message)); return; }
    const filtra = <T extends { activo: boolean }>(xs: T[]) =>
      incluirInactivos ? xs : xs.filter((x) => x.activo);
    setCat({
      areas: filtra((a.data ?? []) as Area[]),
      centros: filtra((c.data ?? []) as CentroCosto[]),
      proveedores: filtra((p.data ?? []) as Proveedor[])
    });
  }, [incluirInactivos]);
  useEffect(() => { void cargar(); }, [cargar]);
  return { cat, error, recargar: cargar };
}

/**
 * Ejecuta `fn` ahora y cada `ms` mientras la pestaña esté visible
 * (actualización visible y periódica moderada, sin tiempo real).
 */
export function useActualizacionPeriodica(fn: () => void | Promise<void>, ms = 60000, deps: unknown[] = []) {
  useEffect(() => {
    void fn();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void fn();
    }, ms);
    const alVolver = () => { if (document.visibilityState === 'visible') void fn(); };
    document.addEventListener('visibilitychange', alVolver);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', alVolver); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Perfiles visibles (para selects de aprobador, solicitante en filtros, etc.). */
export interface PerfilBreve { id: string; nombre: string; estado: string; }

export async function listarPerfiles(): Promise<PerfilBreve[]> {
  const { data, error } = await supabase
    .from('perfiles').select('id, nombre, estado').order('nombre');
  if (error) throw new Error(limpiarError(error.message));
  return (data ?? []) as PerfilBreve[];
}

export async function listarAprobadores(): Promise<PerfilBreve[]> {
  const { data, error } = await supabase
    .from('perfil_roles').select('perfil_id, perfiles:perfil_id (id, nombre, estado)')
    .eq('rol', 'aprobador');
  if (error) throw new Error(limpiarError(error.message));
  const filas = (data ?? []) as unknown as Array<{ perfiles: PerfilBreve | null }>;
  return filas.map((f) => f.perfiles).filter((p): p is PerfilBreve => !!p && p.estado === 'activo');
}
