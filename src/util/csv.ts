// Exportación CSV compatible con Excel en español (separador ;, BOM UTF-8)
// con protección contra inyección de fórmulas (OWASP CSV Injection).

export interface ColumnaCSV<T> {
  titulo: string;
  valor: (fila: T) => string | number | null | undefined;
}

/** Neutraliza celdas que Excel interpretaría como fórmula (= + - @ TAB CR). */
export function sanitizarCelda(valor: string): string {
  if (/^[=+\-@\t\r]/.test(valor)) {
    return `'${valor}`;
  }
  return valor;
}

function celda(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '""';
  const texto = typeof v === 'number'
    ? String(v).replace('.', ',')   // decimales con coma para Excel es-CO
    : sanitizarCelda(String(v));
  return `"${texto.replace(/"/g, '""')}"`;
}

/** Genera el contenido CSV (separador ; + CRLF + BOM) listo para descargar. */
export function generarCSV<T>(filas: T[], columnas: ColumnaCSV<T>[]): string {
  const BOM = '﻿';
  const lineas: string[] = [];
  lineas.push(columnas.map((c) => celda(c.titulo)).join(';'));
  for (const fila of filas) {
    lineas.push(columnas.map((c) => celda(c.valor(fila))).join(';'));
  }
  return BOM + lineas.join('\r\n') + '\r\n';
}

/** Descarga en el navegador (no usable en pruebas de Node; separado por eso). */
export function descargarCSV(nombreArchivo: string, contenido: string): void {
  const blob = new Blob([contenido], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
