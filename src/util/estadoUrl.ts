// Guarda filtros, búsqueda y página de una lista en la URL (query params),
// para que «Atrás» y recargar conserven la posición. Usa `replace` para no
// llenar el historial con cada tecla.
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

type Valor = string | boolean;

/** `vacio` debe ser una constante de módulo (referencia estable). */
export function useEstadoURL<T extends { [K in keyof T]: Valor }>(vacio: T) {
  const base = vacio as Record<string, Valor>;
  const [params, setParams] = useSearchParams();

  const estado = useMemo(() => {
    const e: Record<string, Valor> = {};
    for (const k of Object.keys(vacio)) {
      e[k] = typeof base[k] === 'boolean' ? params.get(k) === '1' : (params.get(k) ?? (base[k] as string));
    }
    return e as T;
  }, [params, base]);

  const pagina = Math.max(1, parseInt(params.get('pagina') ?? '1', 10) || 1);

  /** Cambia filtros y vuelve a la página 1. */
  const cambiar = useCallback((p: Partial<T>, opciones?: { conservarPagina?: boolean }) => {
    setParams((prev) => {
      const n = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(p)) {
        if (v === base[k] || v === '' || v === false) n.delete(k);
        else n.set(k, v === true ? '1' : String(v));
      }
      if (!opciones?.conservarPagina) n.delete('pagina');
      return n;
    }, { replace: true });
  }, [setParams, base]);

  const irAPagina = useCallback((numero: number) => {
    setParams((prev) => {
      const n = new URLSearchParams(prev);
      if (numero <= 1) n.delete('pagina'); else n.set('pagina', String(numero));
      return n;
    }, { replace: true });
  }, [setParams]);

  const limpiar = useCallback(() => setParams(new URLSearchParams(), { replace: true }), [setParams]);

  return { estado, pagina, cambiar, irAPagina, limpiar };
}
