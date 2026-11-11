// Pruebas del reconocimiento de pedidos de mantenimiento y de los pasos de la hoja:
//   node --experimental-strip-types --test pruebas-logica/mantenimiento.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  esCentroMantenimiento, esTextoMantenimiento, estadoPasosMantenimiento, PASOS_MANTENIMIENTO
} from '../src/util/mantenimiento.ts';

test('Reconoce mantenimiento por nombre o código, con o sin tildes y mayúsculas', () => {
  assert.equal(esCentroMantenimiento({ codigo: 'MTTO', nombre: 'Mantenimiento' }), true);
  assert.equal(esCentroMantenimiento({ codigo: '4001', nombre: 'MANTENIMIENTO PLANTA' }), true);
  assert.equal(esCentroMantenimiento({ codigo: 'MANTENIMIENTO', nombre: '' }), true);
  assert.equal(esTextoMantenimiento('Mantenimiento'), true);
  assert.equal(esTextoMantenimiento('mantenímiento'), true);
});

test('Compras semanales y otros centros siguen el flujo normal', () => {
  assert.equal(esCentroMantenimiento({ codigo: 'CS', nombre: 'Compras semanales' }), false);
  assert.equal(esCentroMantenimiento({ codigo: 'EMP', nombre: 'Empaque' }), false);
  assert.equal(esCentroMantenimiento(null), false);
  assert.equal(esCentroMantenimiento(undefined), false);
  assert.equal(esCentroMantenimiento({ codigo: null, nombre: null }), false);
});

test('La hoja tiene seis pasos con responsables por rol, sin nombres de personas', () => {
  assert.equal(PASOS_MANTENIMIENTO.length, 6);
  assert.deepEqual(PASOS_MANTENIMIENTO.map((p) => p.clave), ['llenado', 'envio', 'cotizacion', 'seleccion', 'totaliza', 'orden']);
});

const base = { total: 4, enCotizacionOMas: 0, conCotizacion: 0, seleccionados: 0, aprobados: 0, comprados: 0 };

test('Recién llenada: el primer paso está hecho y el envío a proveedores es el actual', () => {
  assert.deepEqual(estadoPasosMantenimiento(base), ['hecho', 'actual', 'pendiente', 'pendiente', 'pendiente', 'pendiente']);
});

test('Cotizando: el envío está hecho y se están capturando precios', () => {
  assert.deepEqual(estadoPasosMantenimiento({ ...base, enCotizacionOMas: 4, conCotizacion: 2 }),
    ['hecho', 'hecho', 'actual', 'pendiente', 'pendiente', 'pendiente']);
});

test('Todo cotizado pero sin elegir proveedor: toca seleccionar y aprobar', () => {
  assert.deepEqual(estadoPasosMantenimiento({ ...base, enCotizacionOMas: 4, conCotizacion: 4 }),
    ['hecho', 'hecho', 'hecho', 'actual', 'pendiente', 'pendiente']);
});

test('Seleccionado pero sin aprobar: sigue en selección y aprobación', () => {
  assert.deepEqual(estadoPasosMantenimiento({ ...base, enCotizacionOMas: 4, conCotizacion: 4, seleccionados: 4, aprobados: 1 }),
    ['hecho', 'hecho', 'hecho', 'actual', 'pendiente', 'pendiente']);
});

test('Todo aprobado: ya se puede generar la orden de compra', () => {
  assert.deepEqual(estadoPasosMantenimiento({ ...base, enCotizacionOMas: 4, conCotizacion: 4, seleccionados: 4, aprobados: 4 }),
    ['hecho', 'hecho', 'hecho', 'hecho', 'hecho', 'actual']);
});

test('Todo comprado: los seis pasos quedan hechos', () => {
  assert.deepEqual(estadoPasosMantenimiento({ total: 4, enCotizacionOMas: 4, conCotizacion: 4, seleccionados: 4, aprobados: 4, comprados: 4 }),
    ['hecho', 'hecho', 'hecho', 'hecho', 'hecho', 'hecho']);
});

test('Sin artículos no hay nada hecho', () => {
  assert.ok(estadoPasosMantenimiento({ ...base, total: 0 }).every((e) => e !== 'hecho'));
});
