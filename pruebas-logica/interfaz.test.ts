import test from 'node:test';
import assert from 'node:assert/strict';
import { validarValor } from '../src/util/validacion.ts';
import { mensajeUsuario } from '../src/util/errores.ts';

test('un campo obligatorio vacío o con espacios impide el envío', () => {
  assert.ok(validarValor('', { requerido: true }));
  assert.ok(validarValor('   ', { requerido: true }));
  assert.equal(validarValor('', {}), null);
});
test('los mínimos se aplican al contenido útil del campo', () => {
  assert.ok(validarValor(' a ', { minimo: 2 }));
  assert.equal(validarValor(' Área ', { minimo: 2 }), null);
});
test('el correo se valida solo cuando hay contenido', () => {
  assert.equal(validarValor('', { tipo: 'email' }), null);
  assert.ok(validarValor('contacto@', { tipo: 'email' }));
  assert.equal(validarValor('contacto@example.test', { tipo: 'email' }), null);
});
test('las cantidades conservan el formato colombiano y deben ser positivas', () => {
  assert.equal(validarValor('1.234,5', { positivo: true }), null);
  assert.equal(validarValor('1,5', { positivo: true }), null);
  for (const valor of ['abc', '0', '-1', '1,2,3']) assert.ok(validarValor(valor, { positivo: true }));
});
test('un importe cero válido no se confunde con un dato faltante', () => {
  assert.equal(validarValor('0', { tipo: 'number', min: 0, requerido: true }), null);
  assert.ok(validarValor('no es un número', { tipo: 'number' }));
});
test('el servidor no expone restricciones SQL ni nombres de tablas al usuario', () => {
  for (const texto of ['duplicate key value violates unique constraint proveedor_nombre', 'permission denied for table perfiles', 'null value in column nombre violates not-null constraint']) {
    const mensaje = mensajeUsuario(texto);
    assert.doesNotMatch(mensaje, /constraint|perfiles|SQLSTATE|23505|duplicate key/);
    assert.match(mensaje, /Revisa|cuenta|Actualiza/);
  }
});
test('un fallo de red comunica un resultado incierto y evita afirmar que no se guardó', () => {
  const mensaje = mensajeUsuario(new TypeError('Failed to fetch'));
  assert.match(mensaje, /confirmar el resultado/);
  assert.match(mensaje, /antes de repetir/);
});
test('las reglas de negocio en español conservan la explicación útil', () => {
  assert.equal(mensajeUsuario('P0001: El artículo fue modificado; recarga antes de continuar.'), 'El artículo fue modificado; recarga antes de continuar.');
  assert.ok(mensajeUsuario(null).length > 0);
});
