// Compresión de imágenes en el navegador antes de subirlas (cuando es viable).
// PDF y archivos pequeños pasan sin tocar. Nunca aumenta el tamaño.

const UMBRAL_BYTES = 1024 * 1024; // 1 MB
const LADO_MAXIMO = 2000;         // px

export async function comprimirSiConviene(archivo: File): Promise<Blob> {
  if (!archivo.type.startsWith('image/')) return archivo;
  if (archivo.size <= UMBRAL_BYTES) return archivo;
  try {
    const mapa = await createImageBitmap(archivo);
    const escala = Math.min(1, LADO_MAXIMO / Math.max(mapa.width, mapa.height));
    const ancho = Math.max(1, Math.round(mapa.width * escala));
    const alto = Math.max(1, Math.round(mapa.height * escala));
    const lienzo = document.createElement('canvas');
    lienzo.width = ancho; lienzo.height = alto;
    const ctx = lienzo.getContext('2d');
    if (!ctx) return archivo;
    ctx.drawImage(mapa, 0, 0, ancho, alto);
    const blob: Blob | null = await new Promise((res) =>
      lienzo.toBlob(res, 'image/jpeg', 0.82)
    );
    if (blob && blob.size < archivo.size) return blob;
    return archivo;
  } catch {
    return archivo; // si el navegador no puede, se sube el original (≤ 5 MB)
  }
}

/** Tipo final tras compresión (JPEG si se comprimió). */
export function tipoFinal(original: File, resultado: Blob): string {
  return resultado === original ? original.type : 'image/jpeg';
}

export function extensionDe(mime: string): string {
  switch (mime) {
    case 'image/jpeg': return 'jpg';
    case 'image/png': return 'png';
    case 'image/webp': return 'webp';
    case 'application/pdf': return 'pdf';
    default: return 'bin';
  }
}
