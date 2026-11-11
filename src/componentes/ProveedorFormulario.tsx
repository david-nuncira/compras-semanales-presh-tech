// Crear o editar un proveedor desde cualquier pantalla (cotizar, comprar, hoja de mantenimiento
// o administración). Usa la tabla `proveedores`, que Compras y administración pueden gestionar.
import { useEffect, useState } from 'react';
import { supabase, limpiarError } from '../supabase.ts';
import type { Proveedor } from '../tipos.ts';
import { Boton, Campo, Formulario, Modal } from './UI.tsx';

interface Valores { nombre: string; identificacion: string; contacto: string; telefono: string; correo: string }
const VACIO: Valores = { nombre: '', identificacion: '', contacto: '', telefono: '', correo: '' };

export function ProveedorFormulario({ abierto, alCerrar, proveedor, alGuardar }: {
  abierto: boolean; alCerrar: () => void;
  /** Si viene un proveedor, se edita; si no, se crea uno nuevo. */
  proveedor?: Proveedor | null;
  alGuardar: (guardado: Proveedor) => void | Promise<void>;
}) {
  const [v, setV] = useState<Valores>(VACIO);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    if (!abierto) return;
    setV(proveedor ? {
      nombre: proveedor.nombre, identificacion: proveedor.identificacion ?? '', contacto: proveedor.contacto ?? '',
      telefono: proveedor.telefono ?? '', correo: proveedor.correo ?? ''
    } : VACIO);
  }, [abierto, proveedor]);

  async function guardar() {
    const fila = {
      nombre: v.nombre.trim(), identificacion: v.identificacion.trim() || null, contacto: v.contacto.trim() || null,
      telefono: v.telefono.trim() || null, correo: v.correo.trim() || null
    };
    setOcupado(true);
    try {
      const consulta = proveedor
        ? supabase.from('proveedores').update(fila).eq('id', proveedor.id).eq('version', proveedor.version).select('*')
        : supabase.from('proveedores').insert(fila).select('*');
      const { data, error } = await consulta;
      if (error) {
        const dup = /duplicate|unique|ya existe/i.test(error.message);
        throw new Error(dup ? 'Ya existe un proveedor con ese nombre. Búscalo en la lista.' : limpiarError(error.message));
      }
      const guardado = (data ?? [])[0] as Proveedor | undefined;
      if (!guardado) throw new Error('El proveedor cambió en otra sesión; recarga la lista e inténtalo de nuevo.');
      await alGuardar(guardado);
      alCerrar();
    } finally { setOcupado(false); }
  }

  return (
    <Modal titulo={proveedor ? 'Editar proveedor' : 'Agregar proveedor nuevo'} abierto={abierto} alCerrar={alCerrar} ocupado={ocupado}>
      <Formulario className="formulario" onSubmit={guardar}>
        <p className="texto-suave">El registro es informativo: no es una validación legal ni fiscal del proveedor.</p>
        <Campo etiqueta="Nombre del proveedor" requerido>
          <input value={v.nombre} minLength={2} maxLength={200} autoComplete="off" onChange={(e) => setV({ ...v, nombre: e.target.value })} />
        </Campo>
        <div className="fila-campos">
          <Campo etiqueta="NIT o identificación" opcional><input value={v.identificacion} maxLength={60} onChange={(e) => setV({ ...v, identificacion: e.target.value })} /></Campo>
          <Campo etiqueta="Persona de contacto" opcional><input value={v.contacto} maxLength={120} onChange={(e) => setV({ ...v, contacto: e.target.value })} /></Campo>
          <Campo etiqueta="Teléfono" opcional><input type="tel" value={v.telefono} maxLength={40} onChange={(e) => setV({ ...v, telefono: e.target.value })} /></Campo>
          <Campo etiqueta="Correo" opcional><input type="email" value={v.correo} maxLength={160} onChange={(e) => setV({ ...v, correo: e.target.value })} /></Campo>
        </div>
        <div className="modal-acciones">
          <button type="button" className="boton-secundario" onClick={alCerrar}>Cancelar</button>
          <Boton type="submit" variante="primario" cargando={ocupado}>{proveedor ? 'Guardar cambios' : 'Agregar proveedor'}</Boton>
        </div>
      </Formulario>
    </Modal>
  );
}
