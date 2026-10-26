// MODELO DE REFERENCIA del cálculo de ciclo de recepción.
// Replica, paso a paso, la función SQL app.calcular_ciclo (migración 0015)
// para poder probar la REGLA con Node en cualquier equipo. La aplicación
// usa siempre la versión del servidor; este archivo no se publica.
// Zona: America/Bogota = UTC−5 todo el año (Colombia no tiene horario de verano).

export interface ConfigCalendario {
  activo: boolean;
  dias_recepcion: number[];      // ISO 1=lunes … 7=domingo
  dias_no_laborables: number[];
  mover_si_no_habil: boolean;
  hora_liberacion: string;       // 'HH:MM'
  corte_dias_antes: number;
  hora_corte: string;            // 'HH:MM'
}
export interface Ventana { categoria_id: string; nombre: string; abre_en: string; cierra_en: string; fecha_recepcion: string; activo: boolean; }
export interface Ciclo { fecha_recepcion: string; liberacion: Date; cierre: Date; origen: string; nota: string | null; }

const MS_DIA = 86400000;

export function bogota(fechaISO: string, hora: string): Date {
  const [a, m, d] = fechaISO.split('-').map(Number);
  const [h, mi] = hora.split(':').map(Number);
  return new Date(Date.UTC(a, m - 1, d, h + 5, mi));   // Bogotá → UTC (+5 h)
}
export function fechaBogota(t: Date): string {
  return new Date(t.getTime() - 5 * 3600000).toISOString().slice(0, 10);
}
function sumar(fechaISO: string, dias: number): string {
  return new Date(Date.parse(fechaISO + 'T00:00:00Z') + dias * MS_DIA).toISOString().slice(0, 10);
}
function isodow(fechaISO: string): number {
  const d = new Date(fechaISO + 'T00:00:00Z').getUTCDay();
  return d === 0 ? 7 : d;
}

export function esHabil(fecha: string, cfg: ConfigCalendario, noHabiles: Set<string>): boolean {
  return !noHabiles.has(fecha) && !cfg.dias_no_laborables.includes(isodow(fecha));
}

export function calcularCiclo(
  base: Date, cfg: ConfigCalendario | null, noHabiles: Set<string>, ventanas: Ventana[],
  categoria: string | null, semanaMin: string | null, extra: boolean
): Ciclo {
  const baseFecha = fechaBogota(base);
  if (extra) return { fecha_recepcion: baseFecha, liberacion: base, cierre: base, origen: 'extraordinaria', nota: null };
  if (!cfg || !cfg.activo) return { fecha_recepcion: baseFecha, liberacion: base, cierre: base, origen: 'sin_calendario', nota: null };

  const desde = semanaMin && semanaMin > baseFecha ? semanaMin : baseFecha;
  let tieneVentanas = false;
  if (categoria) {
    tieneVentanas = ventanas.some((v) => v.categoria_id === categoria && v.activo);
    if (tieneVentanas) {
      const candidatas = ventanas
        .filter((v) => v.categoria_id === categoria && v.activo && v.fecha_recepcion >= desde)
        .sort((a, b) => a.fecha_recepcion.localeCompare(b.fecha_recepcion) || a.abre_en.localeCompare(b.abre_en));
      for (const w of candidatas) {
        const cierre = bogota(w.cierra_en, cfg.hora_corte);
        if (base < cierre) {
          return { fecha_recepcion: w.fecha_recepcion, liberacion: bogota(w.fecha_recepcion, cfg.hora_liberacion), cierre, origen: 'ventana_categoria', nota: `Ventana "${w.nombre}"` };
        }
      }
    }
  }

  for (let i = 0; i <= 200; i++) {
    const d = sumar(desde, i);
    if (!cfg.dias_recepcion.includes(isodow(d))) continue;
    let e = d;
    if (!esHabil(e, cfg, noHabiles)) {
      if (!cfg.mover_si_no_habil) continue;
      let k = 0;
      while (!esHabil(e, cfg, noHabiles) && k < 31) { e = sumar(e, 1); k++; }
      if (!esHabil(e, cfg, noHabiles)) continue;
    }
    const cierre = bogota(sumar(e, -cfg.corte_dias_antes), cfg.hora_corte);
    if (base < cierre) {
      return {
        fecha_recepcion: e, liberacion: bogota(e, cfg.hora_liberacion), cierre, origen: 'ciclo_semanal',
        nota: tieneVentanas ? 'Sin ventana vigente para la categoría: se usa el ciclo semanal.'
          : e !== d ? 'El día de recepción no era hábil: se pasa al siguiente día hábil.' : null
      };
    }
  }
  throw new Error('No hay un ciclo de recepción disponible en los próximos 200 días.');
}

/** Política post-corte (fn_decidir_solicitud): base del cálculo al aprobar. */
export function baseAprobacion(politica: 'siguiente_ciclo' | 'mismo_ciclo', envio: Date, aprobacion: Date): Date {
  return politica === 'mismo_ciclo' ? envio : aprobacion;
}

/** Condición de liberación (app.liberar_solicitud): aprobada vigente + fecha llegada. */
export function seLibera(estado: string, aprobacionVigenteAprobada: boolean, liberacion: Date | null, ahora: Date): boolean {
  return estado === 'programada' && aprobacionVigenteAprobada && liberacion !== null && liberacion <= ahora;
}
