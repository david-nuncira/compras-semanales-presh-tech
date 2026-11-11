// Pruebas de la mejora v2 (Node 22, sin dependencias):
//   node --experimental-strip-types --test pruebas-logica/v2.test.ts
// Las fechas son de PRUEBA (no son horarios ni festivos oficiales de Presh Tech).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcularCiclo, bogota, baseAprobacion, seLibera, type ConfigCalendario, type Ventana
} from './modelo_calendario.ts';
import { esEntornoDePruebas } from '../src/config.ts';
import { validarArticulo, enlaceValido, centroInicial, solicitanteEdita, puedePedirDevolucion } from '../src/util/validaciones.ts';

// Configuración de prueba: recepción los lunes, sábado y domingo no laborables,
// liberación 07:00 y corte 08:00 del mismo día (valores inventados SOLO para la prueba).
const CFG: ConfigCalendario = {
  activo: true, dias_recepcion: [1], dias_no_laborables: [6, 7], mover_si_no_habil: true,
  hora_liberacion: '07:00', corte_dias_antes: 0, hora_corte: '08:00'
};
const SIN_FESTIVOS = new Set<string>();

// ---------- Calendario ----------
test('Calendario inactivo: lo aprobado pasa a Compras de inmediato', () => {
  const ahora = bogota('2026-10-21', '10:00');
  const c = calcularCiclo(ahora, { ...CFG, activo: false }, SIN_FESTIVOS, [], null, null, false);
  assert.equal(c.origen, 'sin_calendario');
  assert.equal(c.liberacion.getTime(), ahora.getTime());
});

test('Envío un miércoles: recepción prevista el lunes siguiente', () => {
  const c = calcularCiclo(bogota('2026-10-21', '15:00'), CFG, SIN_FESTIVOS, [], null, '2026-10-19', false);
  assert.equal(c.fecha_recepcion, '2026-10-26');
  assert.equal(c.cierre.toISOString(), bogota('2026-10-26', '08:00').toISOString());
  assert.equal(c.liberacion.toISOString(), bogota('2026-10-26', '07:00').toISOString());
});

test('Aprobada ANTES de su fecha: permanece programada hasta la liberación', () => {
  const aprobada = bogota('2026-10-22', '09:00');
  const c = calcularCiclo(aprobada, CFG, SIN_FESTIVOS, [], null, '2026-10-26', false);
  assert.equal(c.fecha_recepcion, '2026-10-26');
  assert.equal(seLibera('programada', true, c.liberacion, bogota('2026-10-25', '23:59')), false); // domingo: aún no
  assert.equal(seLibera('programada', true, c.liberacion, bogota('2026-10-26', '07:00')), true);  // lunes 07:00: sí
});

test('Sin aprobar NO se libera aunque llegue la fecha', () => {
  const lib = bogota('2026-10-26', '07:00');
  assert.equal(seLibera('pendiente_aprobacion', false, lib, bogota('2026-10-27', '10:00')), false);
  assert.equal(seLibera('programada', false, lib, bogota('2026-10-27', '10:00')), false); // aprobación no vigente
});

test('Aprobada DESPUÉS del corte con política "siguiente ciclo": pasa a la semana siguiente', () => {
  const envio = bogota('2026-10-21', '15:00');
  const aprobacion = bogota('2026-10-26', '09:30'); // corte era 26/10 08:00
  const base = baseAprobacion('siguiente_ciclo', envio, aprobacion);
  const c = calcularCiclo(base, CFG, SIN_FESTIVOS, [], null, '2026-10-26', false);
  assert.equal(c.fecha_recepcion, '2026-11-02');
});

test('Aprobada después del corte con política "mismo ciclo": conserva el ciclo y se libera ya', () => {
  const envio = bogota('2026-10-21', '15:00');
  const aprobacion = bogota('2026-10-26', '09:30');
  const c = calcularCiclo(baseAprobacion('mismo_ciclo', envio, aprobacion), CFG, SIN_FESTIVOS, [], null, '2026-10-26', false);
  assert.equal(c.fecha_recepcion, '2026-10-26');
  assert.equal(seLibera('programada', true, c.liberacion, aprobacion), true);
});

test('Aprobada justo antes del corte entra al ciclo; un minuto después ya no', () => {
  const antes = calcularCiclo(bogota('2026-10-26', '07:59'), CFG, SIN_FESTIVOS, [], null, null, false);
  const despues = calcularCiclo(bogota('2026-10-26', '08:00'), CFG, SIN_FESTIVOS, [], null, null, false);
  assert.equal(antes.fecha_recepcion, '2026-10-26');
  assert.equal(despues.fecha_recepcion, '2026-11-02');
});

test('Lunes festivo: se mueve al siguiente día hábil (primer día hábil de gestión)', () => {
  const festivos = new Set(['2026-11-02']);
  const c = calcularCiclo(bogota('2026-10-28', '10:00'), CFG, festivos, [], null, '2026-11-02', false);
  assert.equal(c.fecha_recepcion, '2026-11-03');
  assert.match(c.nota ?? '', /siguiente día hábil/);
});

test('Lunes festivo sin "mover": salta al siguiente lunes hábil', () => {
  const festivos = new Set(['2026-11-02']);
  const c = calcularCiclo(bogota('2026-10-28', '10:00'), { ...CFG, mover_si_no_habil: false }, festivos, [], null, '2026-11-02', false);
  assert.equal(c.fecha_recepcion, '2026-11-09');
});

test('Corte el día anterior a las 17:00 (corte_dias_antes = 1)', () => {
  const cfg = { ...CFG, corte_dias_antes: 1, hora_corte: '17:00' };
  assert.equal(calcularCiclo(bogota('2026-10-25', '16:00'), cfg, SIN_FESTIVOS, [], null, null, false).fecha_recepcion, '2026-10-26');
  assert.equal(calcularCiclo(bogota('2026-10-25', '17:30'), cfg, SIN_FESTIVOS, [], null, null, false).fecha_recepcion, '2026-11-02');
});

test('Semana objetivo posterior: no se programa antes de esa semana', () => {
  const c = calcularCiclo(bogota('2026-10-21', '10:00'), CFG, SIN_FESTIVOS, [], null, '2026-11-16', false);
  assert.equal(c.fecha_recepcion, '2026-11-16');
});

test('Ventana de categoría (p. ej. papelería del mes siguiente)', () => {
  const v: Ventana[] = [{ categoria_id: 'pap', nombre: 'Papelería noviembre', abre_en: '2026-10-26', cierra_en: '2026-10-30', fecha_recepcion: '2026-11-03', activo: true }];
  const dentro = calcularCiclo(bogota('2026-10-28', '10:00'), CFG, SIN_FESTIVOS, v, 'pap', null, false);
  assert.equal(dentro.origen, 'ventana_categoria');
  assert.equal(dentro.fecha_recepcion, '2026-11-03');
  const tarde = calcularCiclo(bogota('2026-10-31', '10:00'), CFG, SIN_FESTIVOS, v, 'pap', null, false);
  assert.equal(tarde.origen, 'ciclo_semanal');           // sin ventana vigente → ciclo semanal
  assert.match(tarde.nota ?? '', /Sin ventana vigente/);
});

test('Emergencia: salta el calendario (no la aprobación, que se exige en el servidor)', () => {
  const ahora = bogota('2026-10-22', '22:00');
  const c = calcularCiclo(ahora, CFG, SIN_FESTIVOS, [], null, '2026-11-16', true);
  assert.equal(c.origen, 'extraordinaria');
  assert.equal(c.liberacion.getTime(), ahora.getTime());
});

test('Ejecutar la liberación dos veces no libera dos veces', () => {
  const lib = bogota('2026-10-26', '07:00');
  const ahora = bogota('2026-10-26', '07:15');
  let estado = 'programada';
  let liberadas = 0;
  for (let i = 0; i < 2; i++) {
    if (seLibera(estado, true, lib, ahora)) { estado = 'recibida_compras'; liberadas++; }
  }
  assert.equal(liberadas, 1);
});

// ---------- Guarda de entorno (vista previa nunca usa producción) ----------
test('Entorno: producción vs. vista previa de rama vs. equipo local', () => {
  assert.equal(esEntornoDePruebas('compras-presh.pages.dev'), false);
  assert.equal(esEntornoDePruebas('mejora-aprobacion-jefe.compras-presh.pages.dev'), true);
  assert.equal(esEntornoDePruebas('a1b2c3d4.compras-presh.pages.dev'), true);
  assert.equal(esEntornoDePruebas('localhost'), true);
  assert.equal(esEntornoDePruebas('compras.presh-tech.com'), false);
});

// ---------- Formularios ----------
const UNIDADES = ['Unidad', 'Par', 'Metro'];
const BASE = { nombre: 'Casco', descripcion: 'Casco dieléctrico talla M color blanco', cantidad: '2', unidad: 'Unidad',
  prioridad: 'media', fecha_requerida: '', justificacion: 'Reposición de equipo de seguridad', enlace_referencia: '', proveedor_sugerido: '' };

test('Artículo válido no tiene errores; proveedor y enlace son opcionales', () => {
  assert.deepEqual(validarArticulo(BASE, UNIDADES, '2026-10-26'), {});
});

test('La justificación es obligatoria', () => {
  assert.match(validarArticulo({ ...BASE, justificacion: '' }, UNIDADES, '2026-10-26').justificacion ?? '', /Explica para qué/);
  assert.match(validarArticulo({ ...BASE, justificacion: '   ' }, UNIDADES, '2026-10-26').justificacion ?? '', /Explica para qué/);
  assert.match(validarArticulo({ ...BASE, justificacion: 'ok' }, UNIDADES, '2026-10-26').justificacion ?? '', /mínimo 5/);
  assert.equal(validarArticulo({ ...BASE, justificacion: 'Para el equipo' }, UNIDADES, '2026-10-26').justificacion, undefined);
});

test('En mantenimiento el centro de costo destino es obligatorio; en compras semanales no se pide', () => {
  assert.match(validarArticulo(BASE, UNIDADES, '2026-10-26', { exigirDestino: true }).centro_costo_id ?? '', /centro de costo/);
  assert.equal(validarArticulo({ ...BASE, centro_costo_id: 'cc1' }, UNIDADES, '2026-10-26', { exigirDestino: true }).centro_costo_id, undefined);
  assert.equal(validarArticulo(BASE, UNIDADES, '2026-10-26').centro_costo_id, undefined);
});

test('Errores junto a cada campo', () => {
  const e = validarArticulo({ ...BASE, nombre: '', descripcion: '', cantidad: '0', unidad: 'galones raros',
    fecha_requerida: '2026-01-01', enlace_referencia: 'www.sin-protocolo.com' }, UNIDADES, '2026-10-26');
  assert.ok(e.nombre && e.descripcion && e.cantidad && e.unidad && e.fecha_requerida && e.enlace_referencia);
});

test('Un enlace NO reemplaza las especificaciones', () => {
  const e = validarArticulo({ ...BASE, descripcion: 'https://tienda.example/producto/123' }, UNIDADES, '2026-10-26');
  assert.match(e.descripcion ?? '', /no reemplaza/);
  assert.equal(enlaceValido('https://tienda.example/x?y=1'), true);
  assert.equal(enlaceValido('javascript:alert(1)'), false);
  assert.equal(enlaceValido(''), true);
});

test('Centro de costo: uno solo → fijo; varios → a elegir', () => {
  assert.deepEqual(centroInicial(['cc1']), { valor: 'cc1', bloqueado: true });
  assert.deepEqual(centroInicial(['cc1', 'cc2']), { valor: '', bloqueado: false });
  assert.deepEqual(centroInicial([]), { valor: '', bloqueado: false });
});

test('Correcciones: edita en borrador/devuelta; después pide devolución; con compras, novedad', () => {
  assert.equal(solicitanteEdita('borrador'), true);
  assert.equal(solicitanteEdita('en_correccion'), true);
  assert.equal(solicitanteEdita('pendiente_aprobacion'), false);
  assert.equal(solicitanteEdita('recibida_compras'), false);
  assert.equal(puedePedirDevolucion('programada', false), true);
  assert.equal(puedePedirDevolucion('recibida_compras', true), false);  // ya hay compras → novedad
  assert.equal(puedePedirDevolucion('borrador', false), false);
});

// ---------- Resolución de configuración con un solo proyecto ----------
import { resolverConfig } from '../src/config.ts';
const PROD = { SUPABASE_URL: 'https://real.supabase.co', SUPABASE_ANON_KEY: 'clave-publica-real-xxxxxxxxxxxxxxxx', TURNSTILE_SITE_KEY: '0xABC' };

test('Producción siempre usa config.js', () => {
  const r = resolverConfig('compras-presh.pages.dev', PROD, { USAR_CONFIGURACION_DE_PRODUCCION: true });
  assert.equal(r.entorno, 'produccion');
  assert.equal(r.config.SUPABASE_URL, PROD.SUPABASE_URL);
});

test('Vista previa con un solo proyecto: solo si se declara a propósito', () => {
  const r = resolverConfig('mejora-x.compras-presh.pages.dev', PROD, { USAR_CONFIGURACION_DE_PRODUCCION: true });
  assert.equal(r.entorno, 'vista_previa_real');
  assert.equal(r.bloqueada, false);
  assert.equal(r.config.SUPABASE_URL, PROD.SUPABASE_URL);
});

test('Vista previa que copia la URL de producción sin declararlo: bloqueada', () => {
  const r = resolverConfig('mejora-x.compras-presh.pages.dev', PROD, { SUPABASE_URL: PROD.SUPABASE_URL, SUPABASE_ANON_KEY: 'x' });
  assert.equal(r.bloqueada, true);
});

test('Vista previa con proyecto de pruebas propio: lo usa', () => {
  const r = resolverConfig('mejora-x.compras-presh.pages.dev', PROD, { SUPABASE_URL: 'https://pruebas.supabase.co', SUPABASE_ANON_KEY: 'k' });
  assert.equal(r.entorno, 'pruebas');
  assert.equal(r.config.SUPABASE_URL, 'https://pruebas.supabase.co');
});
