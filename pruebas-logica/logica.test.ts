// Pruebas de la lógica pura (se ejecutan con Node 22, sin dependencias):
//   node --experimental-strip-types --test pruebas-logica/
// Cubren: semanas/fechas, importes, exportación CSV segura (caso 13 de la
// matriz, parte de sanitización) y el analizador del CSV histórico (caso 10)
// contra el ARCHIVO REAL aportado por el área.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import {
  lunesDeSemana, esLunes, etiquetaSemana, semanaISO, sumarDias,
  diasAtraso, fmtFecha
} from '../src/util/fechas.ts';
import { parseNumero, fmtMoneda, redondear2 } from '../src/util/moneda.ts';
import { sanitizarCelda, generarCSV } from '../src/util/csv.ts';
import {
  decodificarWindows1252, parsearCSV, analizarCSVHistorico
} from '../src/util/csvHistorico.ts';

// ---------- Fechas y semanas ----------
test('lunesDeSemana: cualquier día cae en su lunes', () => {
  assert.equal(lunesDeSemana('2026-10-21'), '2026-10-19'); // miércoles → lunes
  assert.equal(lunesDeSemana('2026-10-19'), '2026-10-19'); // lunes → lunes
  assert.equal(lunesDeSemana('2026-10-25'), '2026-10-19'); // domingo → lunes anterior
});

test('esLunes valida formato, existencia y día', () => {
  assert.equal(esLunes('2026-10-19'), true);
  assert.equal(esLunes('2026-10-20'), false);
  assert.equal(esLunes('2026-02-30'), false);  // fecha inexistente
  assert.equal(esLunes('26/10/2026'), false);  // formato incorrecto
});

test('semanaISO: anclas conocidas', () => {
  assert.deepEqual(semanaISO('2025-12-29'), { anio: 2026, semana: 1 });  // lunes de la S1 de 2026
  assert.deepEqual(semanaISO('2026-12-28'), { anio: 2026, semana: 53 }); // 2026 tiene 53 semanas ISO
  assert.deepEqual(semanaISO('2024-01-01'), { anio: 2024, semana: 1 });
});

test('etiquetaSemana es legible y trae el año', () => {
  const e = etiquetaSemana('2026-10-26');
  assert.match(e, /Semana del 26 oct al 1 nov 2026/);
  assert.match(e, /2026-S44/);
});

test('sumarDias cruza meses y años', () => {
  assert.equal(sumarDias('2026-12-28', 7), '2027-01-04');
});

test('diasAtraso: sin información nunca es 0 días de atraso', () => {
  assert.equal(diasAtraso(null), null);
  assert.equal(diasAtraso(undefined), null);
  const hoy = new Date('2026-10-21T12:00:00-05:00');
  assert.equal(diasAtraso('2026-10-15', hoy), 6);
  assert.equal(diasAtraso('2026-10-25', hoy), 0); // aún no vence
});

test('fmtFecha tolera vacíos', () => {
  assert.equal(fmtFecha(null), 'sin información');
  assert.equal(fmtFecha('2026-10-21'), '21/10/2026');
});

// ---------- Importes ----------
test('parseNumero entiende formatos colombianos y neutros', () => {
  assert.equal(parseNumero('1.234.567,89'), 1234567.89);
  assert.equal(parseNumero('1234567.89'), 1234567.89);
  assert.equal(parseNumero('50000'), 50000);
  assert.equal(parseNumero('1,5'), 1.5);
  assert.equal(parseNumero('1,234.56'), 1234.56);
  assert.equal(parseNumero(''), null);
  assert.equal(parseNumero('abc'), null);
  assert.equal(parseNumero('12a'), null);
  assert.equal(parseNumero('1..2'), null);
});

test('fmtMoneda presenta COP es-CO y tolera monedas raras', () => {
  const v = fmtMoneda(100000, 'COP');
  assert.ok(v.includes('100.000'), v);
  assert.equal(fmtMoneda(null), 'sin información');
  assert.ok(fmtMoneda(10, 'XXX').length > 0);
});

test('redondear2', () => {
  assert.equal(redondear2(10.005), 10.01);
  assert.equal(redondear2(0.1 + 0.2), 0.3);
});

// ---------- Exportación CSV segura (caso 13: fórmulas inyectadas) ----------
test('sanitizarCelda neutraliza fórmulas', () => {
  assert.equal(sanitizarCelda('=SUM(A1:A9)'), "'=SUM(A1:A9)");
  assert.equal(sanitizarCelda('+57 300'), "'+57 300");
  assert.equal(sanitizarCelda('-5'), "'-5");
  assert.equal(sanitizarCelda('@import'), "'@import");
  assert.equal(sanitizarCelda('\tx'), "'\tx");
  assert.equal(sanitizarCelda('texto normal'), 'texto normal');
});

test('generarCSV: BOM, comillas escapadas, ; y CRLF, acentos intactos', () => {
  const filas = [{ a: 'nombre "comillas"', b: '=2+2', c: 1234.5, d: 'acentos: áéíóú ñ' }];
  const csv = generarCSV(filas, [
    { titulo: 'Texto', valor: (f) => f.a },
    { titulo: 'Fórmula', valor: (f) => f.b },
    { titulo: 'Número', valor: (f) => f.c },
    { titulo: 'Acentos', valor: (f) => f.d }
  ]);
  assert.ok(csv.startsWith('﻿'));
  assert.ok(csv.includes('"nombre ""comillas"""'));
  assert.ok(csv.includes('"\'=2+2"'));          // fórmula neutralizada
  assert.ok(csv.includes('"1234,5"'));          // decimal con coma
  assert.ok(csv.includes('áéíóú ñ'));
  assert.ok(csv.includes('\r\n'));
});

// ---------- Decodificación Windows-1252 ----------
test('decodificarWindows1252: Ñ, tildes y comillas tipográficas', () => {
  const bytes = new Uint8Array([0xd1, 0x20, 0xe9, 0x20, 0x93, 0x41, 0x94, 0x20, 0x80]);
  assert.equal(decodificarWindows1252(bytes), 'Ñ é “A” €');
});

// ---------- Analizador CSV (comillas y multilínea) ----------
test('parsearCSV maneja comillas dobles y saltos de línea dentro de celdas', () => {
  const texto = 'a;"texto\ncon salto";c\r\n"""cita""";x;y\r\n';
  const filas = parsearCSV(texto, ';');
  assert.equal(filas.length, 2);
  assert.equal(filas[0][1], 'texto\ncon salto');
  assert.equal(filas[1][0], '"cita"');
});

// ---------- Contra el ARCHIVO REAL del área ----------
const RUTA_REAL = '/sessions/compassionate-youthful-mayer/mnt/uploads/SST - FORMATO SOLICITUD DE COMPRAS(Hoja1).csv';

test('archivo real: estructura y hallazgos reproducidos sin inventar datos', (t) => {
  if (!existsSync(RUTA_REAL)) {
    t.skip('archivo real no disponible en este entorno');
    return;
  }
  const bytes = new Uint8Array(readFileSync(RUTA_REAL));
  const r = analizarCSVHistorico(bytes);

  assert.equal(r.totalRegistrosLogicos, 198);
  assert.equal(r.indiceEncabezado, 3);
  assert.equal(r.filasConNombre, 183);

  // Estados con variantes de escritura, tal como están en el archivo.
  assert.equal(r.estatusDistintos['ENTREGADO'], 123);
  assert.equal(r.estatusDistintos['Entregado'], 14);
  assert.equal(r.estatusDistintos['ALMACÉN'], 12);
  assert.equal(r.estatusDistintos['En Almacen'], 5);
  assert.equal(r.estatusDistintos['EN COTIZACIÓN'], 4);
  assert.equal(r.estatusDistintos['En cotización'], 13);
  assert.equal(r.estatusDistintos['Pte. Por llegar'], 3);
  assert.equal(r.estatusDistintos['(vacío)'], 9);

  const conNombre = r.filas.filter((f) => f.nombre !== '');
  const sinFecha = conNombre.filter((f) => f.problemas.some((p) => p === 'fecha ausente')).length;
  const fechasRotas = conNombre.filter((f) => f.problemas.some((p) => p.startsWith('fecha ambigua'))).length;
  assert.equal(sinFecha, 12);
  assert.equal(fechasRotas, 7); // 13-ene ×2, 26/052025 ×3, 21-ago ×2

  // "Imagen" o "Se envía por correo" son texto, no archivos.
  const imagenTexto = conNombre.filter((f) => f.imagenTexto !== '').length;
  assert.ok(imagenTexto >= 100, `columna Imagen con texto en ${imagenTexto} filas`);
  assert.ok(conNombre.filter((f) => f.imagenTexto === 'Se envía por correo').length >= 5);

  // La leyenda de la última columna se detecta y NO se mezcla con los datos.
  assert.deepEqual(
    [...r.leyendaColumnaFinal].sort(),
    ['En Almacen', 'En cotización', 'Entregado', 'Pte. Por llegar'].sort()
  );

  // Cantidades no numéricas quedan marcadas (p. ej. "25 metros").
  assert.ok(conNombre.some((f) => f.problemas.some((p) => p.includes('25 metros'))));
});
