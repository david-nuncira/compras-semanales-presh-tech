// Fotos de un artículo que se eligen ANTES de guardarlo: se preparan en el navegador
// (tipo, tamaño y compresión) y se suben cuando el artículo ya existe. Usa los mismos
// pasos y funciones del servidor que el apartado «Adjuntos».
import { supabase, rpc, limpiarError, nuevoOp } from '../supabase.ts';
import { comprimirSiConviene, tipoFinal, extensionDe } from './imagenes.ts';

export const TIPOS_FOTO = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_FOTOS = 3;
const MAX_ENTRADA = 25 * 1048576;
const MAX_FINAL = 5 * 1048576;

export interface FotoPendiente { id: string; nombre: string; blob: Blob; mime: string; url: string; op: string }

/** Valida y comprime una foto. Devuelve la foto lista o un mensaje en lenguaje sencillo. */
export async function prepararFoto(archivo: File): Promise<{ foto: FotoPendiente } | { error: string }> {
  if (!TIPOS_FOTO.includes(archivo.type)) return { error: `${archivo.name}: elige una imagen JPG, PNG o WebP.` };
  if (!archivo.size) return { error: `${archivo.name}: está vacía.` };
  if (archivo.size > MAX_ENTRADA) return { error: `${archivo.name}: es demasiado grande (máximo 25 MB).` };
  try {
    const blob = await comprimirSiConviene(archivo);
    if (blob.size > MAX_FINAL) return { error: `${archivo.name}: supera 5 MB incluso comprimida.` };
    const mime = tipoFinal(archivo, blob);
    return { foto: { id: nuevoOp(), nombre: archivo.name, blob, mime, url: URL.createObjectURL(blob), op: nuevoOp() } };
  } catch (e) {
    return { error: `${archivo.name}: ${limpiarError(e instanceof Error ? e.message : String(e))}` };
  }
}

/** Sube las fotos a un artículo ya guardado. Las que fallen se devuelven para avisar sin perder el artículo. */
export async function subirFotosArticulo(articuloId: string, fotos: FotoPendiente[]): Promise<{ guardadas: number; fallidas: string[] }> {
  let guardadas = 0; const fallidas: string[] = [];
  for (const f of fotos) {
    try {
      const ruta = `articulo/${articuloId}/${nuevoOp()}.${extensionDe(f.mime)}`;
      const { error } = await supabase.storage.from('adjuntos').upload(ruta, f.blob, { contentType: f.mime, upsert: false });
      if (error && !/already exists|duplicate|resource exists/i.test(error.message)) throw new Error(limpiarError(error.message));
      await rpc('fn_registrar_adjunto', {
        p_ruta: ruta, p_nombre_original: f.nombre, p_mime: f.mime, p_tamano: f.blob.size, p_op: f.op,
        p_entidad: 'articulo', p_entidad_id: articuloId
      });
      guardadas += 1;
    } catch (e) {
      fallidas.push(`${f.nombre}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { guardadas, fallidas };
}

export function liberarFotos(fotos: FotoPendiente[]) {
  for (const f of fotos) URL.revokeObjectURL(f.url);
}
