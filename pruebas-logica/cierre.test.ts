// Pruebas de cuándo un pedido figura como CERRADO:
//   node --experimental-strip-types --test pruebas-logica/cierre.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pedidoCerrado } from '../src/util/cierre.ts';

const base = { estado: 'recibida_compras', total_articulos: 3, articulos_cerrados: 3, articulos_cancelados: 0 };

test('Todos los artículos cerrados: el pedido figura cerrado', () => {
  assert.equal(pedidoCerrado(base), true);
  assert.equal(pedidoCerrado({ ...base, estado: 'enviada' }), true);
});

test('Los artículos cancelados no cuentan: 2 cerrados + 1 cancelado = cerrado', () => {
  assert.equal(pedidoCerrado({ ...base, articulos_cerrados: 2, articulos_cancelados: 1 }), true);
});

test('Si falta algún artículo por cerrar, sigue abierto', () => {
  assert.equal(pedidoCerrado({ ...base, articulos_cerrados: 2 }), false);
  assert.equal(pedidoCerrado({ ...base, articulos_cerrados: 0 }), false);
});

test('Un pedido sin artículos vivos no se da por cerrado', () => {
  assert.equal(pedidoCerrado({ ...base, total_articulos: 2, articulos_cerrados: 0, articulos_cancelados: 2 }), false);
  assert.equal(pedidoCerrado({ ...base, total_articulos: 0, articulos_cerrados: 0 }), false);
});

test('Rechazada, cancelada, borrador y en aprobación nunca figuran como cerradas', () => {
  for (const estado of ['rechazada', 'cancelada', 'borrador', 'pendiente_aprobacion', 'programada', 'en_correccion']) {
    assert.equal(pedidoCerrado({ ...base, estado }), false, estado);
  }
});

test('Los conteos que llegan como texto del servidor también funcionan', () => {
  assert.equal(pedidoCerrado({ estado: 'recibida_compras', total_articulos: '2' as unknown as number, articulos_cerrados: '2' as unknown as number, articulos_cancelados: '0' as unknown as number }), true);
});
