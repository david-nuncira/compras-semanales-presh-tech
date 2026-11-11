// Pruebas del contenido de la guía paso a paso (que esté completo y sin nombres de personas):
//   node --experimental-strip-types --test pruebas-logica/guias.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLUJO_GENERAL, GUIAS, PANTALLAS } from '../src/util/guias.ts';

const RUTAS_VALIDAS = ['/nueva-solicitud', '/mis-solicitudes', '/aprobacion-solicitudes', '/gestion', '/aprobaciones', '/almacen', '/admin'];

test('Hay una guía por cada rol y cada una tiene pasos con título y texto', () => {
  assert.deepEqual(GUIAS.map((g) => g.clave), ['solicitante', 'jefe', 'compras', 'aprobador', 'almacen', 'admin']);
  for (const g of GUIAS) {
    assert.ok(g.pasos.length >= 3, g.clave);
    for (const p of g.pasos) { assert.ok(p.titulo.length > 3 && p.texto.length > 10, `${g.clave}: ${p.titulo}`); }
  }
});

test('El flujo general cubre de borrador a cierre en 10 pasos', () => {
  assert.equal(FLUJO_GENERAL.length, 10);
  assert.equal(FLUJO_GENERAL[0].titulo, 'Borrador');
  assert.equal(FLUJO_GENERAL[FLUJO_GENERAL.length - 1].titulo, 'Cierre');
});

test('Los enlaces de la guía apuntan a pantallas que existen', () => {
  for (const g of GUIAS) for (const p of g.pasos) if (p.enlace) assert.ok(RUTAS_VALIDAS.includes(p.enlace.a), p.enlace.a);
});

test('Cada pantalla principal tiene su ayuda corta', () => {
  for (const k of ['mis-solicitudes', 'por-aprobar', 'gestion', 'almacen', 'aprobaciones']) {
    assert.ok(PANTALLAS[k] && PANTALLAS[k].pasos.length >= 3, k);
  }
});

test('La guía habla de roles, no de personas: sin correos ni nombres propios', () => {
  const todo = JSON.stringify({ FLUJO_GENERAL, GUIAS, PANTALLAS });
  assert.ok(!/@/.test(todo));
  for (const nombre of ['Jhon', 'John', 'Blanca', 'Ivonne', 'Yeffer', 'David']) assert.ok(!todo.includes(nombre), nombre);
});
