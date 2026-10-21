// Utilidades de fechas y semanas (lunes a domingo), presentación es-CO,
// zona horaria America/Bogota. Módulo puro: sin dependencias.

const ZONA = 'America/Bogota';

/** Fecha "de hoy" en Bogotá como AAAA-MM-DD (independiente del reloj del navegador en otra zona). */
export function hoyBogotaISO(ahora: Date = new Date()): string {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(ahora);
  return f; // en-CA produce AAAA-MM-DD
}

/** Convierte AAAA-MM-DD a Date UTC a medianoche (para aritmética estable de días). */
export function aFechaUTC(iso: string): Date {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}

/** AAAA-MM-DD del Date UTC. */
export function aISO(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/** Lunes (ISO) de la semana a la que pertenece la fecha AAAA-MM-DD. */
export function lunesDeSemana(iso: string): string {
  const f = aFechaUTC(iso);
  const dia = f.getUTCDay(); // 0=domingo … 6=sábado
  const retroceso = dia === 0 ? 6 : dia - 1;
  f.setUTCDate(f.getUTCDate() - retroceso);
  return aISO(f);
}

/** Lunes de la PRÓXIMA semana respecto a hoy (propuesta por defecto para "semana objetivo"). */
export function lunesProximaSemana(ahora: Date = new Date()): string {
  const lunesActual = lunesDeSemana(hoyBogotaISO(ahora));
  return sumarDias(lunesActual, 7);
}

export function sumarDias(iso: string, dias: number): string {
  const f = aFechaUTC(iso);
  f.setUTCDate(f.getUTCDate() + dias);
  return aISO(f);
}

/** Número de semana ISO-8601 y año ISO de un lunes dado. */
export function semanaISO(isoLunes: string): { anio: number; semana: number } {
  const f = aFechaUTC(isoLunes);
  // Algoritmo ISO-8601: la semana del jueves.
  const jueves = new Date(f);
  jueves.setUTCDate(f.getUTCDate() + 3);
  const anio = jueves.getUTCFullYear();
  const primerEnero = new Date(Date.UTC(anio, 0, 1));
  const semana = Math.ceil(((jueves.getTime() - primerEnero.getTime()) / 86400000 + 1) / 7);
  return { anio, semana };
}

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** "Semana del 26 oct al 1 nov 2026 (2026-S44)". */
export function etiquetaSemana(isoLunes: string): string {
  const lunes = aFechaUTC(isoLunes);
  const domingo = aFechaUTC(sumarDias(isoLunes, 6));
  const { anio, semana } = semanaISO(isoLunes);
  const dl = lunes.getUTCDate(), ml = MESES_CORTOS[lunes.getUTCMonth()];
  const dd = domingo.getUTCDate(), md = MESES_CORTOS[domingo.getUTCMonth()];
  const tramo = ml === md
    ? `${dl} al ${dd} ${md}`
    : `${dl} ${ml} al ${dd} ${md}`;
  return `Semana del ${tramo} ${domingo.getUTCFullYear()} (${anio}-S${String(semana).padStart(2, '0')})`;
}

/** ¿La cadena es un AAAA-MM-DD válido y además lunes? */
export function esLunes(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const f = aFechaUTC(iso);
  if (aISO(f) !== iso) return false; // fecha inexistente (p. ej. 2026-02-30)
  return f.getUTCDay() === 1;
}

/** Fecha corta para tablas: 21/10/2026 (es-CO). Acepta AAAA-MM-DD o ISO completo. */
export function fmtFecha(iso: string | null | undefined): string {
  if (!iso) return 'sin información';
  const soloFecha = iso.length <= 10 ? iso : null;
  const d = soloFecha ? aFechaUTC(soloFecha) : new Date(iso);
  if (Number.isNaN(d.getTime())) return 'sin información';
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: soloFecha ? 'UTC' : ZONA, day: '2-digit', month: '2-digit', year: 'numeric'
  }).format(d);
}

/** Fecha y hora para auditoría/eventos: 21/10/2026, 3:45 p. m. (hora de Bogotá). */
export function fmtFechaHora(iso: string | null | undefined): string {
  if (!iso) return 'sin información';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'sin información';
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: ZONA, day: '2-digit', month: '2-digit', year: 'numeric',
    hour: 'numeric', minute: '2-digit'
  }).format(d);
}

/** Días de atraso (entero) entre una fecha estimada y hoy; null = sin información. */
export function diasAtraso(fechaEstimadaISO: string | null | undefined, ahora: Date = new Date()): number | null {
  if (!fechaEstimadaISO) return null;
  const hoy = aFechaUTC(hoyBogotaISO(ahora));
  const est = aFechaUTC(fechaEstimadaISO);
  const diff = Math.floor((hoy.getTime() - est.getTime()) / 86400000);
  return diff > 0 ? diff : 0;
}
