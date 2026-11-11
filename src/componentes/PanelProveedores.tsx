// Administrar proveedores (crear, editar, desactivar y eliminar) desde Gestión de compras
// y desde el panel de administración. Solo Compras y administración pueden escribir (lo valida el servidor).
import { useMemo, useState } from 'react';
import { supabase, limpiarError } from '../supabase.ts';
import { useCatalogos } from '../datos.ts';
import type { Proveedor } from '../tipos.ts';
import { Boton, Campo, EstadoVacio, Icono, Insignia, MensajeError, MensajeExito, ModalConfirmar, PanelLateral } from './UI.tsx';
import { ProveedorFormulario } from './ProveedorFormulario.tsx';

function Contenido() {
  const { cat, error, recargar } = useCatalogos(true);
  const [buscar, setBuscar] = useState('');
  const [edicion, setEdicion] = useState<Proveedor | 'nuevo' | null>(null);
  const [porEliminar, setPorEliminar] = useState<Proveedor | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const lista = useMemo(() => (cat?.proveedores ?? []).filter((p) =>
    !buscar.trim() || `${p.nombre} ${p.identificacion ?? ''}`.toLowerCase().includes(buscar.trim().toLowerCase())), [cat, buscar]);

  async function alternarActivo(p: Proveedor) {
    setAviso(null); setFallo(null);
    const { data, error: e } = await supabase.from('proveedores').update({ activo: !p.activo }).eq('id', p.id).eq('version', p.version).select('id');
    if (e) { setFallo(limpiarError(e.message)); return; }
    if (!data || data.length === 0) { setFallo('El proveedor cambió en otra sesión; recarga e inténtalo de nuevo.'); return; }
    setAviso(p.activo ? `${p.nombre} se desactivó: ya no aparece al cotizar, pero conserva su historia.` : `${p.nombre} se reactivó.`);
    await recargar();
  }

  async function eliminar(p: Proveedor) {
    const { data, error: e } = await supabase.from('proveedores').delete().eq('id', p.id).select('id');
    if (e) {
      const enUso = /foreign key|violates|referenc|está en uso/i.test(e.message);
      throw new Error(enUso ? 'Este proveedor ya tiene cotizaciones o compras, así que no se puede eliminar. Desactívalo: dejará de aparecer pero conservará su historia.' : limpiarError(e.message));
    }
    if (!data || data.length === 0) throw new Error('No se pudo eliminar el proveedor (revisa tus permisos).');
    setAviso(`${p.nombre} se eliminó.`);
    await recargar();
  }

  return (
    <div className="revision">
      <MensajeError texto={error ?? fallo} />
      <MensajeExito texto={aviso} />
      <div className="acciones-fila">
        <Boton variante="primario" onClick={() => setEdicion('nuevo')}><Icono nombre="mas" /> Agregar proveedor</Boton>
      </div>
      <Campo etiqueta="Buscar proveedor"><input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Nombre o NIT" /></Campo>
      {!cat ? <p className="cargando" role="status">Cargando proveedores…</p> : lista.length === 0 ? (
        <EstadoVacio titulo="No hay proveedores" texto={buscar ? 'Prueba con otro texto.' : 'Agrega el primero con el botón de arriba.'} />
      ) : (
        <ul className="lista-proveedores">
          {lista.map((p) => (
            <li key={p.id}>
              <div>
                <b>{p.nombre}</b> {p.activo
                  ? <Insignia tono="exito" icono="check-circulo">Activo</Insignia>
                  : <Insignia tono="neutro" icono="prohibido">Inactivo</Insignia>}
                <div className="texto-suave">{[p.identificacion, p.contacto, p.telefono, p.correo].filter(Boolean).join(' · ') || 'Sin más datos'}</div>
              </div>
              <div className="acciones-fila">
                <Boton variante="fantasma" onClick={() => setEdicion(p)}>Editar</Boton>
                <Boton variante="fantasma" onClick={() => void alternarActivo(p)}>{p.activo ? 'Desactivar' : 'Reactivar'}</Boton>
                <Boton variante="fantasma" onClick={() => setPorEliminar(p)}>Eliminar</Boton>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ProveedorFormulario abierto={!!edicion} alCerrar={() => setEdicion(null)} proveedor={edicion && edicion !== 'nuevo' ? edicion : null}
        alGuardar={async (g) => { setAviso(edicion === 'nuevo' ? `${g.nombre} se agregó.` : `${g.nombre} se actualizó.`); await recargar(); }} />
      <ModalConfirmar abierto={!!porEliminar} titulo="Eliminar proveedor" peligro etiqueta="Eliminar"
        texto={`¿Eliminar a ${porEliminar?.nombre ?? 'este proveedor'}? Solo se puede si no tiene cotizaciones ni compras. No se puede deshacer.`}
        alConfirmar={async () => { if (porEliminar) await eliminar(porEliminar); }} alCerrar={() => setPorEliminar(null)} />
    </div>
  );
}

export function PanelProveedores({ abierto, alCerrar }: { abierto: boolean; alCerrar: () => void }) {
  return <PanelLateral titulo="Proveedores" abierto={abierto} alCerrar={alCerrar}>{abierto ? <Contenido /> : null}</PanelLateral>;
}
