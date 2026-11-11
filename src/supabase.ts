import { createClient } from '@supabase/supabase-js';
import { CONFIG } from './config.ts';
import { mensajeUsuario } from './util/errores.ts';

// Cliente único. La sesión usa el mecanismo oficial de Auth del navegador;
// los DATOS de negocio viven exclusivamente en PostgreSQL (nunca en el navegador).
export const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

/** Llama una función RPC y convierte el error en Error con mensaje en español. */
export async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(limpiarError(error.message));
  return data as T;
}

/** Los RAISE de PostgreSQL llegan como "P0001: mensaje"; se limpia el prefijo. */
export function limpiarError(m: string): string {
  return mensajeUsuario(m);
}

export function nuevoOp(): string {
  return crypto.randomUUID();
}
