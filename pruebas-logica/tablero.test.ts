// Pruebas de los cálculos del tablero (lógica pura):
//   node --experimental-strip-types --test pruebas-logica/tablero.test.ts
// Los datos son de PRUEBA.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montosDeCompra, resumirTablero, type ArticuloTablero } from '../src/util/tablero.ts';

const ART = (id: string, extra: Partial<ArticuloTablero> = {}): ArticuloTablero => ({
  id, etapa: 'solicitado', total: null, moneda: 'COP', cantidad_comprada: null, recibido_neto: null,
  dias_atraso: null, novedades_abiertas: 0, es_extraordinaria: false,
  area_id: 'a1', area_nombre: 'Área 1', centro_costo_id: 'c1', centro_costo_codigo: 'CC1', ...extra
});

test('comprado o en tránsito: todo es comprometido, nada ejecutado', () => {
  assert.deepEqual(montosDeCompra({ etapa: 'comprado', total: 1000, cantidad_comprada: 10, recibido_neto: 0 }), { comprometido: 1000, ejecutado: 0 });
  assert.deepEqual(montosDeCompra({ etapa: 'en_transito', total: 1000, cantidad_comprada: 10, recibido_neto: null }), { comprometido: 1000, ejecutado: 0 });
});

test('recibido parcial: se reparte en proporción a lo recibido', () => {
  assert.deepEqual(montosDeCompra({ etapa: 'recibido_parcial', total: 1000, cantidad_comprada: 10, recibido_neto: 4 }), { comprometido: 600, ejecutado: 400 });
});

test('recibido total: todo es ejecutado', () => {
  assert.deepEqual(montosDeCompra({ etapa: 'recibido_total', total: 1000, cantidad_comprada: 10, recibido_neto: 10 }), { comprometido: 0, ejecutado: 1000 });
});

test('cerrado: lo recibido es ejecutado y no queda comprometido', () => {
  assert.deepEqual(montosDeCompra({ etapa: 'cerrado', total: 1000, cantidad_comprada: 10, recibido_neto: 10 }), { comprometido: 0, ejecutado: 1000 });
  assert.deepEqual(montosDeCompra({ etapa: 'cerrado', total: 1000, cantidad_comprada: 10, recibido_neto: 5 }), { comprometido: 0, ejecutado: 500 });
});

test('antes de la compra no hay comprometido ni ejecutado; sin importe no se inventa 0', () => {
  assert.equal(montosDeCompra({ etapa: 'cotizado', total: 1000, cantidad_comprada: null, recibido_neto: null }), null);
  assert.equal(montosDeCompra({ etapa: 'comprado', total: null, cantidad_comprada: 5, recibido_neto: 0 }), null);
});

test('el resumen separa estimado, comprometido y ejecutado y no los mezcla', () => {
  const r = resumirTablero(
    [
      ART('1', { etapa: 'cotizado' }),
      ART('2', { etapa: 'comprado', total: 2000, cantidad_comprada: 4 }),
      ART('3', { etapa: 'recibido_total', total: 3000, cantidad_comprada: 3, recibido_neto: 3 }),
      ART('4', { etapa: 'recibido_parcial', total: 1000, cantidad_comprada: 10, recibido_neto: 5 })
    ],
    [{ articuloId: '1', moneda: 'COP', total: 500 }]
  );
  assert.deepEqual(r.porMoneda['COP'], { estimado: 500, comprometido: 2500, ejecutado: 3500 });
});

test('el estimado solo cuenta artículos aún sin comprar', () => {
  const r = resumirTablero(
    [ART('1', { etapa: 'comprado', total: 100, cantidad_comprada: 1 })],
    [{ articuloId: '1', moneda: 'COP', total: 999 }]
  );
  assert.equal(r.porMoneda['COP'].estimado, 0);
});

test('cancelados y borradores no entran; sin cotización seleccionada no aporta al estimado', () => {
  const r = resumirTablero(
    [ART('1', { etapa: 'cancelado', total: 5000 }), ART('2', { etapa: 'borrador' }), ART('3', { etapa: 'en_cotizacion' })],
    []
  );
  assert.equal(r.flujo.total, 1);
  assert.equal(r.sinEstimado, 1);
  assert.deepEqual(r.porMoneda, {});
});

test('compras sin importe se cuentan aparte y no suman como cero', () => {
  const r = resumirTablero([ART('1', { etapa: 'comprado', total: null, cantidad_comprada: 2 })], []);
  assert.equal(r.sinImporte, 1);
  assert.deepEqual(r.porMoneda, {});
});

test('cada moneda se totaliza por separado', () => {
  const r = resumirTablero(
    [ART('1', { etapa: 'comprado', total: 100, moneda: 'COP', cantidad_comprada: 1 }),
     ART('2', { etapa: 'comprado', total: 50, moneda: 'USD', cantidad_comprada: 1 })],
    []
  );
  assert.equal(r.porMoneda['COP'].comprometido, 100);
  assert.equal(r.porMoneda['USD'].comprometido, 50);
});

test('el flujo cuenta pendientes, atrasados, por llegar, novedades y extraordinarias', () => {
  const r = resumirTablero(
    [
      ART('1', { etapa: 'solicitado' }), ART('2', { etapa: 'cotizado', dias_atraso: 2 }),
      ART('3', { etapa: 'en_transito', total: 10, cantidad_comprada: 1, novedades_abiertas: 2, es_extraordinaria: true }),
      ART('4', { etapa: 'cerrado', total: 10, cantidad_comprada: 1, recibido_neto: 1 })
    ],
    []
  );
  assert.equal(r.flujo.total, 4);
  assert.equal(r.flujo.pendientes, 2);
  assert.equal(r.flujo.atrasados, 1);
  assert.equal(r.flujo.porLlegar, 1);
  assert.equal(r.flujo.conNovedades, 1);
  assert.equal(r.flujo.extraordinarias, 1);
  assert.equal(r.flujo.porEtapa['cerrado'], 1);
});

test('los grupos se ordenan por valor y respetan el criterio elegido', () => {
  const arts = [
    ART('1', { etapa: 'comprado', total: 100, cantidad_comprada: 1, area_id: 'x', area_nombre: 'X', centro_costo_id: 'c1', centro_costo_codigo: 'A' }),
    ART('2', { etapa: 'comprado', total: 900, cantidad_comprada: 1, area_id: 'y', area_nombre: 'Y', centro_costo_id: 'c1', centro_costo_codigo: 'A' })
  ];
  const porArea = resumirTablero(arts, [], 'area');
  assert.deepEqual(porArea.grupos.map((g) => g.etiqueta), ['Y', 'X']);
  const porCC = resumirTablero(arts, [], 'centro_costo');
  assert.equal(porCC.grupos.length, 1);
  assert.equal(porCC.grupos[0].comprometido, 1000);
});
