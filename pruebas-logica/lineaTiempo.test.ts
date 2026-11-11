// Pruebas de la línea de tiempo de la solicitud (lógica pura, sin dependencias):
//   node --experimental-strip-types --test pruebas-logica/lineaTiempo.test.ts
// Los nombres y fechas son de PRUEBA.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  construirLineaTiempo, textoDuracion,
  type SolicitudLinea, type ArticuloLinea, type EntradaLinea
} from '../src/util/lineaTiempo.ts';

const SOL: SolicitudLinea = {
  estado: 'borrador', flujo: 'aprobacion_previa', creado_en: '2026-03-02T14:00:00Z',
  enviado_en: null, ultimo_envio_en: null, aprobado_en: null, fecha_programada_recepcion: null,
  recibida_compras_en: null, solicitante_nombre: 'Solicitante de prueba', aprobador_jefe_nombre: 'Jefe de prueba',
  ultimo_motivo_jefe: null, ultimo_motivo_devolucion: null
};
const ART = (extra: Partial<ArticuloLinea> = {}): ArticuloLinea => ({
  etapa: 'solicitado', fecha_compra: null, primera_llegada: null, ultima_llegada: null, cerrado_en: null,
  dias_atraso: null, recibido_neto: null, entregado_neto: null, disponible_almacen: null, ...extra
});
const entrada = (sol: Partial<SolicitudLinea>, articulos: ArticuloLinea[] = [], extra: Partial<EntradaLinea> = {}): EntradaLinea => ({
  sol: { ...SOL, ...sol }, articulos, eventos: [], ahora: '2026-03-10T14:00:00Z', ...extra
});
const estados = (e: EntradaLinea) => construirLineaTiempo(e).map((x) => x.estado);

test('siempre muestra las 11 etapas del flujo, en orden', () => {
  const t = construirLineaTiempo(entrada({}));
  assert.deepEqual(t.map((x) => x.clave), ['borrador', 'aprobacion', 'programada', 'recibida', 'cotizacion',
    'compra', 'seguimiento', 'llegada', 'entrega', 'almacen', 'cierre']);
});

test('borrador: la primera etapa es la actual y las futuras quedan pendientes', () => {
  const e = estados(entrada({}));
  assert.equal(e[0], 'actual');
  assert.ok(e.slice(1).every((x) => x === 'pendiente'));
});

test('pendiente de aprobación: borrador completada, aprobación actual, el resto pendiente', () => {
  const t = construirLineaTiempo(entrada({ estado: 'pendiente_aprobacion', enviado_en: '2026-03-03T15:00:00Z', ultimo_envio_en: '2026-03-03T15:00:00Z' }));
  assert.equal(t[0].estado, 'completada');
  assert.equal(t[1].estado, 'actual');
  assert.equal(t[1].responsable, 'Jefe de prueba');
  assert.ok(t.slice(2).every((x) => x.estado === 'pendiente'));
});

test('devuelta: el solicitante corrige y la aprobación figura devuelta con su motivo', () => {
  const t = construirLineaTiempo(entrada({
    estado: 'en_correccion', enviado_en: '2026-03-03T15:00:00Z', ultimo_envio_en: '2026-03-03T15:00:00Z',
    ultimo_motivo_jefe: 'Falta la especificación'
  }, [], { eventos: [{ evento_en: '2026-03-04T10:00:00Z', tipo: 'decision_devuelta', descripcion: 'Devuelta', actor: 'Jefe de prueba', motivo: 'Falta la especificación' }] }));
  assert.equal(t[0].estado, 'actual');
  assert.equal(t[1].estado, 'devuelta');
  assert.equal(t[1].comentario, 'Falta la especificación');
  assert.equal(t[1].fecha, '2026-03-04T10:00:00Z');
  assert.ok(t.slice(2).every((x) => x.estado === 'pendiente'));
});

test('rechazada: nunca se pinta como completada ni avanza; lo posterior queda pendiente', () => {
  const t = construirLineaTiempo(entrada({
    estado: 'rechazada', enviado_en: '2026-03-03T15:00:00Z', ultimo_envio_en: '2026-03-03T15:00:00Z',
    aprobado_en: '2026-03-03T16:00:00Z', ultimo_motivo_jefe: 'No procede'
  }));
  assert.equal(t[1].estado, 'rechazada');
  assert.equal(t[1].comentario, 'No procede');
  assert.ok(t.slice(2).every((x) => x.estado === 'pendiente'));
  assert.ok(!t.slice(1).some((x) => x.estado === 'completada'));
});

test('cancelada: la etapa donde se canceló figura cancelada y no hay éxito posterior', () => {
  const t = construirLineaTiempo(entrada({
    estado: 'cancelada', enviado_en: '2026-03-03T15:00:00Z', ultimo_envio_en: '2026-03-03T15:00:00Z',
    aprobado_en: '2026-03-03T16:00:00Z'
  }, [], { eventos: [{ evento_en: '2026-03-05T09:00:00Z', tipo: 'cancelacion', descripcion: 'Cancelada', actor: 'Solicitante de prueba', motivo: 'Ya no se necesita' }] }));
  const c = t.find((x) => x.estado === 'cancelada');
  assert.ok(c);
  assert.equal(c!.comentario, 'Ya no se necesita');
  assert.equal(t.filter((x) => x.estado === 'completada').length, t.findIndex((x) => x.estado === 'cancelada'));
  assert.ok(!t.slice(t.findIndex((x) => x.estado === 'cancelada') + 1).some((x) => x.estado !== 'pendiente'));
});

test('cancelada siendo borrador: la etapa de borrador figura cancelada', () => {
  const t = construirLineaTiempo(entrada({ estado: 'cancelada' }));
  assert.equal(t[0].estado, 'cancelada');
});

test('flujo anterior: aprobación y programación figuran omitidas, no inventadas', () => {
  const t = construirLineaTiempo(entrada({
    estado: 'enviada', flujo: 'anterior', enviado_en: '2026-03-03T15:00:00Z', recibida_compras_en: '2026-03-03T15:00:00Z'
  }, [ART()]));
  assert.equal(t[1].estado, 'omitida');
  assert.equal(t[2].estado, 'omitida');
  assert.equal(t[3].estado, 'completada');
  assert.equal(t[4].estado, 'actual');
});

test('programada: muestra la fecha prevista que calculó el servidor, sin recalcularla', () => {
  const t = construirLineaTiempo(entrada({
    estado: 'programada', enviado_en: '2026-03-03T15:00:00Z', ultimo_envio_en: '2026-03-03T15:00:00Z',
    aprobado_en: '2026-03-04T10:00:00Z', fecha_programada_recepcion: '2026-03-09'
  }));
  assert.equal(t[1].estado, 'completada');
  assert.equal(t[2].estado, 'actual');
  assert.equal(t[2].fechaPrevista, '2026-03-09');
});

test('en Compras: avanza por los artículos y cuenta cuántos van en cada etapa', () => {
  const t = construirLineaTiempo(entrada({
    estado: 'recibida_compras', enviado_en: '2026-03-03T15:00:00Z', ultimo_envio_en: '2026-03-03T15:00:00Z',
    aprobado_en: '2026-03-04T10:00:00Z', recibida_compras_en: '2026-03-09T12:00:00Z'
  }, [ART({ etapa: 'cotizado' }), ART({ etapa: 'en_cotizacion' })]));
  assert.equal(t[3].estado, 'completada');
  assert.equal(t[4].estado, 'actual');
  assert.equal(t[4].comentario, '1 de 2 artículos');
  assert.ok(t.slice(5).every((x) => x.estado === 'pendiente'));
});

test('un artículo cancelado no cuenta para el avance', () => {
  const e = estados(entrada({
    estado: 'recibida_compras', enviado_en: '2026-03-03T15:00:00Z', ultimo_envio_en: '2026-03-03T15:00:00Z',
    aprobado_en: '2026-03-04T10:00:00Z', recibida_compras_en: '2026-03-09T12:00:00Z'
  }, [ART({ etapa: 'comprado', fecha_compra: '2026-03-10' }), ART({ etapa: 'cancelado' })]));
  assert.equal(e[4], 'completada');
  assert.equal(e[5], 'completada');
  assert.equal(e[6], 'actual');
});

test('atraso: el seguimiento actual se marca atrasado si el servidor reporta días de atraso', () => {
  const e = estados(entrada({
    estado: 'recibida_compras', enviado_en: '2026-03-03T15:00:00Z', ultimo_envio_en: '2026-03-03T15:00:00Z',
    aprobado_en: '2026-03-04T10:00:00Z', recibida_compras_en: '2026-03-09T12:00:00Z'
  }, [ART({ etapa: 'en_transito', fecha_compra: '2026-03-10', dias_atraso: 3 })]));
  assert.equal(e[6], 'atrasada');
});

test('todo cerrado: las once etapas quedan completadas', () => {
  const t = construirLineaTiempo(entrada({
    estado: 'recibida_compras', enviado_en: '2026-03-03T15:00:00Z', ultimo_envio_en: '2026-03-03T15:00:00Z',
    aprobado_en: '2026-03-04T10:00:00Z', recibida_compras_en: '2026-03-09T12:00:00Z'
  }, [ART({ etapa: 'cerrado', fecha_compra: '2026-03-10', primera_llegada: '2026-03-12', ultima_llegada: '2026-03-12',
    cerrado_en: '2026-03-15T10:00:00Z', recibido_neto: 4, entregado_neto: 4, disponible_almacen: 0 })]));
  assert.ok(t.every((x) => x.estado === 'completada'));
  assert.equal(t[10].fecha, '2026-03-15T10:00:00Z');
});

test('duración: horas desde la etapa anterior; la actual cuenta hasta ahora', () => {
  const t = construirLineaTiempo(entrada({
    estado: 'pendiente_aprobacion', enviado_en: '2026-03-03T15:00:00Z', ultimo_envio_en: '2026-03-03T15:00:00Z'
  }));
  // Aprobación en curso: desde el envío (3-mar 15:00) hasta ahora (10-mar 14:00) = 167 h.
  assert.equal(t[1].duracionHoras, 167);
});

test('textoDuracion', () => {
  assert.equal(textoDuracion(null), '');
  assert.equal(textoDuracion(0.2), 'menos de 1 h');
  assert.equal(textoDuracion(5), '5 h');
  assert.equal(textoDuracion(72), '3,0 días');
});
