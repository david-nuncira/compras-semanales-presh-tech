// Mensajes del envío a aprobación (compartidos por el asistente y el detalle).
import { fmtFecha, fmtFechaHora } from './fechas.ts';

/** Respuesta de fn_estimar_envio. */
export interface Estimacion {
  aprobador: string | null; ruta: string | null; problema: string | null;
  recepcion_prevista: string | null; cierre: string | null; origen: string; nota: string | null;
}

/** Respuesta de fn_enviar_solicitud / fn_reenviar_solicitud. */
export interface RespuestaEnvio {
  aprobador?: string; recepcion_prevista?: string; cierre?: string; origen?: string; nota?: string | null;
}

export function mensajeEnvio(r: RespuestaEnvio): string {
  const base = `Tu solicitud fue enviada a aprobación de ${r.aprobador ?? 'tu jefe'}.`;
  if (r.origen === 'ciclo_semanal' || r.origen === 'ventana_categoria') {
    return `${base} Su recepción por Compras está prevista para el ${fmtFecha(r.recepcion_prevista ?? null)}, siempre que esté aprobada antes del cierre del ciclo (${fmtFechaHora(r.cierre ?? null)}).${r.nota ? ' ' + r.nota : ''}`;
  }
  if (r.origen === 'extraordinaria') return `${base} Es extraordinaria: pasará a Compras en cuanto se apruebe.`;
  return `${base} Pasará a Compras en cuanto se apruebe.`;
}

/** Texto relativo en español: «hace 3 min». */
export function textoHace(desde: number, ahora: number): string {
  const s = Math.max(0, Math.round((ahora - desde) / 1000));
  if (s < 10) return 'justo ahora';
  if (s < 60) return `hace ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}
