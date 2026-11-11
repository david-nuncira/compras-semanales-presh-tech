// Línea de tiempo de una solicitud (lógica pura, probada en pruebas-logica/).
// Usa SOLO datos que ya entrega el servidor: v_solicitudes, v_articulos,
// fn_historial_solicitud y fn_historial_articulo. No calcula fechas de negocio:
// las fechas previstas las calcula el servidor; aquí solo se muestran.
import type { EstadoSolicitud, Etapa, EventoHistorial } from './../tipos.ts';

export type EstadoEtapa =
  | 'completada' | 'actual' | 'pendiente' | 'devuelta' | 'atrasada' | 'rechazada' | 'cancelada' | 'omitida';

export interface EtapaLinea {
  clave: string;
  titulo: string;
  estado: EstadoEtapa;
  /** Fecha real del hito (ISO). Nulo si aún no ocurre. */
  fecha: string | null;
  /** Fecha prevista por el servidor (solo etapa «Programada»). */
  fechaPrevista: string | null;
  responsable: string | null;
  /** Horas desde la etapa anterior (completada) o hasta ahora (actual). */
  duracionHoras: number | null;
  comentario: string | null;
}

export interface SolicitudLinea {
  estado: EstadoSolicitud;
  flujo: 'anterior' | 'aprobacion_previa';
  creado_en: string;
  enviado_en: string | null;
  ultimo_envio_en: string | null;
  aprobado_en: string | null;
  fecha_programada_recepcion: string | null;
  recibida_compras_en: string | null;
  solicitante_nombre: string | null;
  aprobador_jefe_nombre: string | null;
  ultimo_motivo_jefe: string | null;
  ultimo_motivo_devolucion: string | null;
}

export interface ArticuloLinea {
  etapa: Etapa;
  fecha_compra: string | null;
  primera_llegada: string | null;
  ultima_llegada: string | null;
  cerrado_en: string | null;
  dias_atraso: number | null;
  recibido_neto: number | null;
  entregado_neto: number | null;
  disponible_almacen: number | null;
}

/** Fila de fn_historial_articulo (solo lo necesario). */
export interface EventoArticuloLinea {
  creado_en: string;
  tabla: string;
  actor_nombre: string;
  nuevo?: Record<string, unknown> | null;
}

export interface EntradaLinea {
  sol: SolicitudLinea;
  articulos: ArticuloLinea[];
  eventos: EventoHistorial[];
  eventosArticulos?: EventoArticuloLinea[];
  /** Hora actual (ISO); se recibe como dato para que la función sea pura. */
  ahora: string;
}

const RANGO: Record<Etapa, number> = {
  cancelado: -2, borrador: -1, solicitado: 0, en_cotizacion: 1, cotizado: 2, comprado: 3,
  en_transito: 4, recibido_parcial: 5, recibido_total: 6, cerrado: 7
};

const TITULOS: Array<[string, string]> = [
  ['borrador', 'Borrador'],
  ['aprobacion', 'Aprobación del jefe'],
  ['programada', 'Aprobada y programada'],
  ['recibida', 'Recibida por Compras'],
  ['cotizacion', 'Cotización'],
  ['compra', 'Compra'],
  ['seguimiento', 'Seguimiento de la compra'],
  ['llegada', 'Llegada'],
  ['entrega', 'Entrega'],
  ['almacen', 'Almacén'],
  ['cierre', 'Cierre']
];

const horasEntre = (desde: string, hasta: string): number | null => {
  const a = Date.parse(desde); const b = Date.parse(hasta);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, (b - a) / 3600000);
};

const minimo = (xs: Array<string | null | undefined>): string | null => {
  const v = xs.filter((x): x is string => !!x).sort();
  return v.length ? v[0] : null;
};
const maximo = (xs: Array<string | null | undefined>): string | null => {
  const v = xs.filter((x): x is string => !!x).sort();
  return v.length ? v[v.length - 1] : null;
};

export function construirLineaTiempo(e: EntradaLinea): EtapaLinea[] {
  const { sol, eventos } = e;
  const evArt = e.eventosArticulos ?? [];
  const vivos = e.articulos.filter((a) => a.etapa !== 'cancelado');
  const total = vivos.length;
  const desde = (n: number) => vivos.filter((a) => RANGO[a.etapa] >= n).length;
  const anterior = sol.flujo === 'anterior';
  const tieneEnvio = !!(sol.enviado_en || sol.ultimo_envio_en);
  const ultimoEvento = (...tipos: string[]) =>
    [...eventos].reverse().find((x) => tipos.includes(x.tipo)) ?? null;
  const primerEvArt = (tabla: string, tipo?: string) =>
    [...evArt].filter((x) => x.tabla === tabla && (!tipo || x.nuevo?.tipo === tipo))
      .sort((a, b) => a.creado_en.localeCompare(b.creado_en))[0] ?? null;

  const entregados = vivos.filter((a) => RANGO[a.etapa] >= 6 && (a.recibido_neto ?? 0) > 0
    && (a.entregado_neto ?? 0) >= (a.recibido_neto ?? 0)).length;
  const entregaCompleta = total > 0 && entregados === total;
  const sinSaldo = vivos.every((a) => (a.disponible_almacen ?? 0) <= 0);

  // ¿Qué etapas están completas según los datos?
  let completa: boolean[] = [
    sol.estado !== 'borrador' && sol.estado !== 'en_correccion' && !(sol.estado === 'cancelada' && !tieneEnvio),
    anterior ? tieneEnvio : (!!sol.aprobado_en && !['pendiente_aprobacion', 'en_correccion', 'rechazada'].includes(sol.estado)),
    anterior ? tieneEnvio : !!sol.recibida_compras_en,
    !!sol.recibida_compras_en || (anterior && ['recibida_compras', 'enviada'].includes(sol.estado)),
    total > 0 && desde(2) === total,
    total > 0 && desde(3) === total,
    total > 0 && desde(5) === total,
    total > 0 && desde(6) === total,
    entregaCompleta,
    entregaCompleta && sinSaldo,
    total > 0 && desde(7) === total
  ];
  // Una solicitud devuelta o rechazada no avanza más allá de lo que el estado permite.
  if (sol.estado === 'en_correccion') completa = completa.map(() => false);
  if (sol.estado === 'rechazada') completa = completa.map((_, i) => i === 0);
  if (sol.estado === 'borrador') completa = completa.map(() => false);
  // Las etapas son secuenciales: no hay «completada» después de una pendiente.
  const primeraPendiente = completa.findIndex((c) => !c);
  if (primeraPendiente >= 0) completa = completa.map((_, i) => i < primeraPendiente);

  const atraso = vivos.some((a) => (a.dias_atraso ?? 0) > 0);

  const etapas: EtapaLinea[] = TITULOS.map(([clave, titulo], i) => {
    let estado: EstadoEtapa = completa[i] ? 'completada' : i === primeraPendiente ? 'actual' : 'pendiente';
    if (completa[i] && anterior && (clave === 'aprobacion' || clave === 'programada')) estado = 'omitida';
    if (estado === 'actual' && sol.estado === 'rechazada') estado = 'rechazada';
    if (estado === 'actual' && sol.estado === 'cancelada') estado = 'cancelada';
    if (estado === 'actual' && (clave === 'seguimiento' || clave === 'llegada') && atraso) estado = 'atrasada';
    return {
      clave, titulo, estado, fecha: null, fechaPrevista: null, responsable: null, duracionHoras: null, comentario: null
    };
  });
  const por = (c: string) => etapas.find((x) => x.clave === c)!;

  // En corrección: el solicitante corrige (actual) y la aprobación figura como devuelta.
  if (sol.estado === 'en_correccion') {
    por('aprobacion').estado = 'devuelta';
  }

  // ---- Fechas, responsables y comentarios (todo viene del servidor) ----
  const b = por('borrador');
  b.fecha = sol.creado_en; b.responsable = sol.solicitante_nombre;
  if (sol.estado === 'en_correccion') b.comentario = 'Esperando la corrección del solicitante.';

  const a = por('aprobacion');
  if (a.estado === 'omitida') a.comentario = 'No aplicó: flujo anterior, sin aprobación previa.';
  else if (a.estado === 'completada') {
    a.fecha = sol.aprobado_en; a.responsable = ultimoEvento('decision_aprobada')?.actor ?? sol.aprobador_jefe_nombre;
  } else if (a.estado === 'devuelta') {
    const ev = ultimoEvento('decision_devuelta', 'a_correccion', 'devolucion_autorizada');
    a.fecha = ev?.evento_en ?? null; a.responsable = ev?.actor ?? sol.aprobador_jefe_nombre;
    a.comentario = sol.ultimo_motivo_devolucion ?? sol.ultimo_motivo_jefe ?? ev?.motivo ?? 'Sin motivo registrado.';
  } else if (a.estado === 'rechazada') {
    const ev = ultimoEvento('decision_rechazada');
    a.fecha = ev?.evento_en ?? null; a.responsable = ev?.actor ?? sol.aprobador_jefe_nombre;
    a.comentario = sol.ultimo_motivo_jefe ?? ev?.motivo ?? 'Sin motivo registrado.';
  } else if (a.estado === 'actual') {
    a.fecha = sol.ultimo_envio_en ?? sol.enviado_en; a.responsable = sol.aprobador_jefe_nombre;
    a.comentario = 'Esperando la decisión del jefe.';
  }

  const p = por('programada');
  p.fechaPrevista = sol.fecha_programada_recepcion;
  if (p.estado === 'omitida') p.comentario = 'No aplicó: flujo anterior.';
  else if (p.estado === 'completada') p.fecha = sol.aprobado_en;

  const r = por('recibida');
  if (r.estado === 'completada' || r.estado === 'actual') {
    r.fecha = sol.recibida_compras_en;
    r.responsable = ultimoEvento('recepcion_compras')?.actor ?? null;
  }

  const cot = primerEvArt('cotizaciones');
  const comp = primerEvArt('compras');
  const lleg = primerEvArt('movimientos', 'recepcion');
  const entr = primerEvArt('movimientos', 'entrega');
  const datos: Record<string, { fecha: string | null; resp: string | null; n: number }> = {
    cotizacion: { fecha: cot?.creado_en ?? null, resp: cot?.actor_nombre ?? null, n: desde(2) },
    compra: { fecha: minimo(vivos.map((x) => x.fecha_compra)) ?? comp?.creado_en ?? null, resp: comp?.actor_nombre ?? null, n: desde(3) },
    seguimiento: { fecha: minimo(vivos.map((x) => x.fecha_compra)), resp: comp?.actor_nombre ?? null, n: desde(5) },
    llegada: { fecha: minimo(vivos.map((x) => x.primera_llegada)), resp: lleg?.actor_nombre ?? null, n: desde(6) },
    entrega: { fecha: entr?.creado_en ?? null, resp: entr?.actor_nombre ?? null, n: entregados },
    almacen: { fecha: minimo(vivos.map((x) => x.primera_llegada)), resp: lleg?.actor_nombre ?? null, n: vivos.filter((x) => (x.disponible_almacen ?? 0) <= 0 && RANGO[x.etapa] >= 6).length },
    cierre: { fecha: maximo(vivos.map((x) => x.cerrado_en)), resp: null, n: desde(7) }
  };
  for (const [clave, d] of Object.entries(datos)) {
    const et = por(clave);
    if (et.estado === 'pendiente' || et.estado === 'cancelada') continue;
    et.fecha = et.estado === 'completada' && clave === 'llegada' ? (maximo(vivos.map((x) => x.ultima_llegada)) ?? d.fecha) : d.fecha;
    et.responsable = d.resp;
    if (total > 1 || et.estado !== 'completada') et.comentario = `${d.n} de ${total} artículos`;
    if (et.estado === 'atrasada') et.comentario = `${et.comentario}. Hay artículos con atraso.`;
  }

  if (sol.estado === 'cancelada') {
    const c = etapas.find((x) => x.estado === 'cancelada');
    if (c) {
      const ev = ultimoEvento('cancelacion');
      c.fecha = ev?.evento_en ?? null; c.responsable = ev?.actor ?? null;
      c.comentario = ev?.motivo ?? 'Solicitud cancelada.';
    }
  }

  // ---- Duraciones: desde el último hito con fecha hasta este (o hasta ahora si está en curso) ----
  let previa: string | null = null;
  for (const et of etapas) {
    if (et.estado === 'pendiente' || et.estado === 'omitida') continue;
    const envio = sol.ultimo_envio_en ?? sol.enviado_en;
    if (et.estado === 'actual' || et.estado === 'atrasada') {
      // En curso: desde que empezó esta etapa (o desde la anterior) hasta ahora.
      const base = (et.clave === 'aprobacion' ? et.fecha : null) ?? previa;
      if (base) et.duracionHoras = horasEntre(base, e.ahora);
    } else if (et.fecha) {
      const base = et.clave === 'aprobacion' ? (envio ?? previa) : previa;
      if (base) et.duracionHoras = horasEntre(base, et.fecha);
    }
    if (et.fecha) previa = et.fecha;
  }
  return etapas;
}

/** Texto corto de duración (p. ej. «3 h», «2,5 días»). */
export function textoDuracion(horas: number | null): string {
  if (horas === null) return '';
  if (horas < 1) return 'menos de 1 h';
  if (horas < 48) return `${Math.round(horas)} h`;
  return `${(horas / 24).toFixed(1).replace('.', ',')} días`;
}
