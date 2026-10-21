// Analizador del CSV histórico "SST - FORMATO SOLICITUD DE COMPRAS".
// Analizador CSV correcto (comillas, texto multilínea, separador ;),
// decodificación Windows-1252 y extracción de hallazgos SIN inventar datos.
// Módulo puro: funciona en el navegador y en Node (pruebas).

// --- Decodificación Windows-1252 (difiere de Latin-1 en 0x80–0x9F) ---
const CP1252_ALTOS: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160,
  0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153,
  0x9e: 0x017e, 0x9f: 0x0178
};

export function decodificarWindows1252(bytes: Uint8Array): string {
  let salida = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b >= 0x80 && b <= 0x9f) {
      salida += String.fromCharCode(CP1252_ALTOS[b] ?? b);
    } else {
      salida += String.fromCharCode(b);
    }
  }
  return salida;
}

// --- Analizador CSV (RFC 4180 adaptado a ; y a comillas dobles escapadas) ---
export function parsearCSV(texto: string, separador: string = ';'): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = '';
  let enComillas = false;
  let i = 0;
  const n = texto.length;
  while (i < n) {
    const c = texto[i];
    if (enComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i += 2; continue; }
        enComillas = false; i++; continue;
      }
      campo += c; i++; continue;
    }
    if (c === '"' && campo === '') { enComillas = true; i++; continue; }
    if (c === separador) { fila.push(campo); campo = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = ''; i++; continue; }
    campo += c; i++;
  }
  if (campo !== '' || fila.length > 0) { fila.push(campo); filas.push(fila); }
  return filas;
}

// --- Modelo de la revisión ---
export interface FilaHistorico {
  numeroFila: number;            // índice del registro lógico en el archivo (desde 1)
  fechaTexto: string;
  nombre: string;
  cantidadTexto: string;
  imagenTexto: string;
  descripcion: string;
  justificacion: string;
  observacionCompras: string;
  estatusOriginal: string;
  extraNotas: string;            // columnas sin encabezado útil
  problemas: string[];
  datosOriginales: Record<string, string>;
}

export interface ResultadoAnalisis {
  totalRegistrosLogicos: number;
  indiceEncabezado: number;      // índice (0-based) de la fila de encabezado detectada
  columnasDetectadas: string[];
  filas: FilaHistorico[];        // solo registros de datos (tras el encabezado)
  filasConNombre: number;
  estatusDistintos: Record<string, number>;
  leyendaColumnaFinal: string[];
  advertenciasGlobales: string[];
}

const RE_FECHA_OK = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
const RE_CANTIDAD_OK = /^\d{1,7}([.,]\d{1,2})?$/;

function esFechaReal(t: string): boolean {
  const [d, m, a] = t.split('/').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31 || a < 2000 || a > 2100) return false;
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCDate() === d && f.getUTCMonth() === m - 1;
}

/** Analiza el archivo completo y produce el informe de revisión. */
export function analizarCSVHistorico(bytes: Uint8Array): ResultadoAnalisis {
  const texto = decodificarWindows1252(bytes);
  const registros = parsearCSV(texto, ';');
  const advertencias: string[] = [];

  // Encabezado: primera fila cuyo contenido incluya "Fecha" y "Nombre articulo".
  let idxEnc = -1;
  for (let i = 0; i < Math.min(registros.length, 10); i++) {
    const limpios = registros[i].map((c) => c.trim().toLowerCase());
    if (limpios.some((c) => c === 'fecha') && limpios.some((c) => c.startsWith('nombre articulo'))) {
      idxEnc = i; break;
    }
  }
  if (idxEnc === -1) {
    advertencias.push('No se encontró la fila de encabezado esperada ("Fecha", "Nombre articulo"); se asume la fila 4 del formato conocido.');
    idxEnc = Math.min(3, Math.max(registros.length - 1, 0));
  }

  const encabezado = registros[idxEnc] ?? [];
  const columnas = encabezado.map((c, i) => (c.trim() === '' ? `(columna ${i + 1} sin título)` : c.trim()));

  // Posiciones conocidas del formato (0-based): 1 Fecha, 2 Nombre, 3 Cant.,
  // 4 Imagen, 5 Descripción, 6 Justificación, 7 Observación Compras, 8 Estatus,
  // 9.. valores sueltos sin encabezado, 24 leyenda de estados.
  const filas: FilaHistorico[] = [];
  const estatus: Record<string, number> = {};
  const leyenda = new Set<string>();

  // La leyenda de estados empieza en la última columna de la PROPIA fila
  // de encabezado y continúa en las primeras filas de datos.
  const col24Encabezado = (encabezado[24] ?? '').trim();
  if (col24Encabezado !== '') leyenda.add(col24Encabezado);

  for (let i = idxEnc + 1; i < registros.length; i++) {
    const r = registros[i];
    const get = (k: number) => (r[k] ?? '').trim();
    const nombre = get(2);
    const col24 = get(24);
    if (col24 !== '') leyenda.add(col24);
    if (nombre === '' && r.every((c) => c.trim() === '')) continue; // fila totalmente vacía

    const extra = r.slice(9, 24).map((c) => c.trim()).filter((c) => c !== '').join(' | ');
    const problemas: string[] = [];
    const fechaTexto = get(1);
    const cantidadTexto = get(3);
    const imagenTexto = get(4);
    const estatusOriginal = get(8);

    if (nombre === '') problemas.push('sin nombre de artículo');
    if (fechaTexto === '') problemas.push('fecha ausente');
    else if (!RE_FECHA_OK.test(fechaTexto) || !esFechaReal(fechaTexto)) {
      problemas.push(`fecha ambigua o mal escrita: ${fechaTexto}`);
    }
    if (cantidadTexto === '') problemas.push('cantidad ausente');
    else if (!RE_CANTIDAD_OK.test(cantidadTexto)) problemas.push(`cantidad no numérica: ${cantidadTexto}`);
    if (estatusOriginal === '' && nombre !== '') problemas.push('estatus vacío');
    if (imagenTexto !== '') problemas.push('la columna Imagen trae texto, no un archivo');
    if (extra !== '') problemas.push('valores fuera de las columnas del formato');

    if (nombre !== '') {
      estatus[estatusOriginal || '(vacío)'] = (estatus[estatusOriginal || '(vacío)'] ?? 0) + 1;
    }

    const datosOriginales: Record<string, string> = {};
    r.forEach((c, k) => { if (c.trim() !== '') datosOriginales[`c${k + 1}`] = c; });

    filas.push({
      numeroFila: i + 1,
      fechaTexto,
      nombre,
      cantidadTexto,
      imagenTexto,
      descripcion: get(5),
      justificacion: get(6),
      observacionCompras: get(7),
      estatusOriginal,
      extraNotas: extra,
      problemas,
      datosOriginales
    });
  }

  if (leyenda.size > 0) {
    advertencias.push(
      `La última columna contiene una leyenda de estados (${[...leyenda].join(', ')}); se conserva como referencia y NO se interpreta como estado de cada artículo.`
    );
  }

  return {
    totalRegistrosLogicos: registros.length,
    indiceEncabezado: idxEnc,
    columnasDetectadas: columnas,
    filas,
    filasConNombre: filas.filter((f) => f.nombre !== '').length,
    estatusDistintos: estatus,
    leyendaColumnaFinal: [...leyenda],
    advertenciasGlobales: advertencias
  };
}
