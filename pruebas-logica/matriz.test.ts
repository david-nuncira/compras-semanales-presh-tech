// Pruebas de la matriz de cotizaciones con los datos reales de la hoja de Mantenimiento:
//   node --experimental-strip-types --test pruebas-logica/matriz.test.ts
// Formato de cada fila: cantidad | Solutrans | Inv. García | Ferreoriente  (null = sin cotizar).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  construirMatriz, minimoPrecios, totalFila, type ArticuloMatriz, type CotizacionMatriz
} from '../src/util/matriz.ts';

const SOLUTRANS = 'prov-solutrans';
const GARCIA = 'prov-garcia';
const FERREORIENTE = 'prov-ferreoriente';
const ORDEN = [SOLUTRANS, GARCIA, FERREORIENTE];

const EXCEL: Array<[number, number | null, number | null, number | null]> = [
  [4, 35900, 22000, null], [3, null, 225600, null], [50, 250, 350, null], [3, 16650, 13800, null],
  [4, 4250, 5500, null], [1, 110300, 95000, null], [20, 2100, 7200, 3000], [20, 3550, 8700, 3900],
  [10, 12150, 2000, null], [10, 13900, 2800, null], [10, 19450, 8900, null], [10, 26000, 4800, null],
  [10, 5300, 3500, null], [10, 20650, 4200, null], [10, 22700, 12800, null], [4, 9500, 4000, 3900],
  [3, 4800, 4000, null], [20, 1800, 3200, 2250], [20, 3000, 4300, 2750], [20, 43500, 55600, 45300],
  [20, 18200, 20000, 19500]
];

function datosExcel() {
  const articulos: ArticuloMatriz[] = [];
  const cotizaciones: CotizacionMatriz[] = [];
  EXCEL.forEach(([cantidad, a, b, c], i) => {
    const id = `art-${i + 1}`;
    articulos.push({ id, cantidad });
    [[SOLUTRANS, a], [GARCIA, b], [FERREORIENTE, c]].forEach(([prov, precio]) => {
      if (precio !== null) cotizaciones.push({
        articulo_id: id, proveedor_id: prov as string, moneda: 'COP', precio_unitario: precio as number,
        es_seleccionada: false, creado_en: '2026-03-01T10:00:00Z'
      });
    });
  });
  return { articulos, cotizaciones };
}

test('la hoja real tiene 21 artículos y un total de 2.786.300', () => {
  const { articulos, cotizaciones } = datosExcel();
  const m = construirMatriz(articulos, cotizaciones, ORDEN);
  assert.equal(m.filas.length, 21);
  assert.equal(m.totalGeneral, 2786300);
  assert.equal(m.articulosSinCotizacion, 0);
  assert.deepEqual(m.proveedoresIds, ORDEN);
});

test('el mínimo es el menor precio cotizado y el total es mínimo × cantidad', () => {
  const { articulos, cotizaciones } = datosExcel();
  const m = construirMatriz(articulos, cotizaciones, ORDEN);
  assert.equal(m.filas[0].minimo, 22000);      // 4 × 22.000
  assert.equal(m.filas[0].total, 88000);
  assert.equal(m.filas[6].minimo, 2100);       // 20 × 2.100 (hay tres precios)
  assert.equal(m.filas[6].total, 42000);
  assert.equal(m.filas[19].total, 870000);     // 20 × 43.500
});

test('una celda vacía no cuenta como 0 en el mínimo', () => {
  assert.equal(minimoPrecios([null, 225600, null]), 225600);
  assert.equal(minimoPrecios([undefined, 350, 250]), 250);
  assert.equal(minimoPrecios([null, null]), null);
  const { articulos, cotizaciones } = datosExcel();
  const m = construirMatriz(articulos, cotizaciones, ORDEN);
  // Fila 2: solo cotizó un proveedor; el mínimo es su precio, no 0.
  assert.equal(m.filas[1].minimo, 225600);
  assert.equal(m.filas[1].total, 676800);
  assert.equal(Object.keys(m.filas[1].celdas).length, 1);
});

test('una fila sin cotizaciones no aporta 0 como mínimo: no tiene mínimo ni total', () => {
  const m = construirMatriz(
    [{ id: 'a', cantidad: 5 }, { id: 'b', cantidad: 2 }],
    [{ articulo_id: 'b', proveedor_id: 'p1', moneda: 'COP', precio_unitario: 1000, es_seleccionada: false, creado_en: '2026-01-01' }],
    ['p1']
  );
  assert.equal(m.filas[0].minimo, null);
  assert.equal(m.filas[0].total, null);
  assert.equal(m.articulosSinCotizacion, 1);
  assert.equal(m.totalGeneral, 2000);
  assert.equal(totalFila(null, 5), null);
});

test('verde = cotización seleccionada, no la más barata', () => {
  const m = construirMatriz(
    [{ id: 'a', cantidad: 10 }],
    [
      { articulo_id: 'a', proveedor_id: 'barato', moneda: 'COP', precio_unitario: 1000, es_seleccionada: false, creado_en: '2026-01-01' },
      { articulo_id: 'a', proveedor_id: 'elegido', moneda: 'COP', precio_unitario: 1500, es_seleccionada: true, creado_en: '2026-01-01' }
    ],
    ['barato', 'elegido']
  );
  const f = m.filas[0];
  assert.equal(f.seleccionadaProveedorId, 'elegido');
  assert.equal(f.celdas['elegido'].seleccionada, true);
  assert.equal(f.celdas['elegido'].esMinimo, false);
  assert.equal(f.celdas['barato'].seleccionada, false);
  assert.equal(f.celdas['barato'].esMinimo, true);
  assert.equal(f.total, 10000);               // el total sigue siendo mínimo × cantidad
  assert.equal(m.totalSeleccionado, 15000);   // y el total seleccionado es aparte
  assert.equal(m.articulosSeleccionados, 1);
});

test('sin selección registrada nada se pinta como seleccionado', () => {
  const { articulos, cotizaciones } = datosExcel();
  const m = construirMatriz(articulos, cotizaciones, ORDEN);
  assert.ok(m.filas.every((f) => f.seleccionadaProveedorId === null));
  assert.equal(m.articulosSeleccionados, 0);
});

test('dos artículos distintos pueden compartir referencia: la matriz no agrupa por referencia', () => {
  // Misma «3FECIN02» en dos artículos: cada uno conserva su propia fila y su propio total.
  const m = construirMatriz(
    [{ id: 'x1', cantidad: 3 }, { id: 'x2', cantidad: 4 }],
    [
      { articulo_id: 'x1', proveedor_id: 'p1', moneda: 'COP', precio_unitario: 16650, es_seleccionada: false, creado_en: '2026-01-01' },
      { articulo_id: 'x2', proveedor_id: 'p1', moneda: 'COP', precio_unitario: 4250, es_seleccionada: false, creado_en: '2026-01-01' }
    ],
    ['p1']
  );
  assert.equal(m.filas.length, 2);
  assert.equal(m.filas[0].total, 49950);
  assert.equal(m.filas[1].total, 17000);
});

test('varias cotizaciones del mismo proveedor: gana la seleccionada y, si no, la más reciente', () => {
  const m = construirMatriz(
    [{ id: 'a', cantidad: 1 }, { id: 'b', cantidad: 1 }],
    [
      { articulo_id: 'a', proveedor_id: 'p', moneda: 'COP', precio_unitario: 900, es_seleccionada: false, creado_en: '2026-01-01' },
      { articulo_id: 'a', proveedor_id: 'p', moneda: 'COP', precio_unitario: 800, es_seleccionada: false, creado_en: '2026-02-01' },
      { articulo_id: 'b', proveedor_id: 'p', moneda: 'COP', precio_unitario: 500, es_seleccionada: true, creado_en: '2026-01-01' },
      { articulo_id: 'b', proveedor_id: 'p', moneda: 'COP', precio_unitario: 400, es_seleccionada: false, creado_en: '2026-03-01' }
    ],
    ['p']
  );
  assert.equal(m.filas[0].minimo, 800);
  assert.equal(m.filas[1].minimo, 500);
});

test('otras monedas no se comparan con COP', () => {
  const m = construirMatriz(
    [{ id: 'a', cantidad: 2 }],
    [
      { articulo_id: 'a', proveedor_id: 'p1', moneda: 'USD', precio_unitario: 10, es_seleccionada: false, creado_en: '2026-01-01' },
      { articulo_id: 'a', proveedor_id: 'p2', moneda: 'COP', precio_unitario: 40000, es_seleccionada: false, creado_en: '2026-01-01' }
    ],
    ['p1', 'p2']
  );
  assert.equal(m.filas[0].minimo, 40000);
  assert.equal(m.filas[0].fueraDeMoneda, 1);
  assert.deepEqual(m.proveedoresIds, ['p2']);
});

test('el total es un entero COP: se redondea el producto', () => {
  assert.equal(totalFila(1234.5, 3), 3704);
  assert.equal(totalFila(100, 2.5), 250);
  assert.ok(Number.isInteger(totalFila(333.33, 3) as number));
});

test('proveedores nuevos aparecen después de los conocidos, en orden estable', () => {
  const m = construirMatriz(
    [{ id: 'a', cantidad: 1 }],
    [
      { articulo_id: 'a', proveedor_id: 'zeta', moneda: 'COP', precio_unitario: 5, es_seleccionada: false, creado_en: '2026-01-01' },
      { articulo_id: 'a', proveedor_id: 'conocido', moneda: 'COP', precio_unitario: 6, es_seleccionada: false, creado_en: '2026-01-01' },
      { articulo_id: 'a', proveedor_id: 'alfa', moneda: 'COP', precio_unitario: 7, es_seleccionada: false, creado_en: '2026-01-01' }
    ],
    ['conocido']
  );
  assert.deepEqual(m.proveedoresIds, ['conocido', 'alfa', 'zeta']);
});
