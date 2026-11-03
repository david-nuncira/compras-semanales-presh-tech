import { parseNumero } from './moneda.ts';
export interface ReglaCampo { requerido?: boolean; minimo?: number; maximo?: number; tipo?: string; positivo?: boolean; min?: number; max?: number; }
export function validarValor(valor: string, regla: ReglaCampo): string | null {
  const v = valor.trim();
  if (!v) return regla.requerido ? 'Completa este campo para continuar.' : null;
  if (regla.minimo && v.length < regla.minimo) return `Escribe al menos ${regla.minimo} caracteres.`;
  if (regla.maximo && v.length > regla.maximo) return `Usa un máximo de ${regla.maximo} caracteres.`;
  if (regla.tipo === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Escribe un correo válido, por ejemplo nombre@empresa.com.';
  if (regla.positivo || regla.tipo === 'number') {
    const numero = parseNumero(v);
    if (numero === null || !Number.isFinite(numero)) return 'Escribe una cantidad válida.';
    if (regla.positivo && numero <= 0) return 'La cantidad debe ser mayor que cero.';
    if (regla.min !== undefined && numero < regla.min) return `El valor mínimo es ${regla.min}.`;
    if (regla.max !== undefined && numero > regla.max) return `El valor máximo es ${regla.max}.`;
  }
  return null;
}
