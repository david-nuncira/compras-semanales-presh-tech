import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, limpiarError } from '../supabase.ts';
import { useCatalogos } from '../datos.ts';
import { usePermisos } from '../permisos.ts';
import { Campo, MensajeError, MensajeExito, Cargando } from '../componentes/UI.tsx';
import { AdminNav } from '../componentes/AdminNav.tsx';

/** Pide un texto nuevo con un cuadro simple (renombrar sin perder historia). */
function pedirTexto(pregunta: string, actual: string): string | null {
  const v = window.prompt(pregunta, actual);
  if (v === null) return null;
  const t = v.trim();
  return t.length >= 2 && t !== actual ? t : null;
}

/**
 * Catálogos administrables: áreas, centros de costo y proveedores.
 * Los registros no se borran: se desactivan (conservan su historia).
 */
export function AdminCatalogos() {
  const { cat, error: errorCat, recargar } = useCatalogos(true);
  const permisos = usePermisos();
  const [nUnidad, setNUnidad] = useState({ nombre: '', abreviatura: '' });
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [nArea, setNArea] = useState('');
  const [nCCCodigo, setNCCCodigo] = useState('');
  const [nCCNombre, setNCCNombre] = useState('');
  const [nProv, setNProv] = useState({ nombre: '', identificacion: '', contacto: '', telefono: '', correo: '' });

  async function ejecutar(fn: () => Promise<{ error: { message: string } | null }>, msj: string) {
    setError(null); setExito(null);
    const { error: e } = await fn();
    if (e) { setError(limpiarError(e.message)); return; }
    setExito(msj);
    await recargar();
  }

  if (!cat) return <div className="contenido"><AdminNav /><Cargando /></div>;

  return (
    <div className="contenido">
      <h1>Administración · Catálogos</h1>
      <AdminNav />
      <p className="texto-suave">
        Los catálogos oficiales los define Compras/la empresa; los de demostración son
        claramente ficticios. Desactivar no borra la historia: un catálogo inactivo no aparece en
        solicitudes nuevas, pero los registros antiguos lo conservan. Los jefes y los centros de
        costo permitidos por área se configuran en <Link to="/admin/estructura">Estructura</Link>.
      </p>
      <MensajeError texto={errorCat ?? error} flotante alCerrar={() => setError(null)} />
      <MensajeExito texto={exito} flotante alCerrar={() => setExito(null)} />

      <div className="tarjeta">
        <h2>Unidades de medida</h2>
        <form className="filtros" onSubmit={(e) => { e.preventDefault();
          if (nUnidad.nombre.trim().length < 1) { setError('Escribe el nombre de la unidad.'); return; }
          void ejecutar(() => supabase.from('unidades_medida').insert({ nombre: nUnidad.nombre.trim(), abreviatura: nUnidad.abreviatura.trim() || null }), 'Unidad creada.')
            .then(() => setNUnidad({ nombre: '', abreviatura: '' }));
        }}>
          <Campo etiqueta="Nombre" requerido><input value={nUnidad.nombre} onChange={(e) => setNUnidad({ ...nUnidad, nombre: e.target.value })} /></Campo>
          <Campo etiqueta="Abreviatura" opcional><input value={nUnidad.abreviatura} onChange={(e) => setNUnidad({ ...nUnidad, abreviatura: e.target.value })} /></Campo>
          <button type="submit" className="boton-primario">Agregar</button>
        </form>
        <ul>
          {cat.unidades.map((u) => (
            <li key={u.id}>
              {u.nombre}{u.abreviatura ? ` (${u.abreviatura})` : ''}{u.activo ? '' : ' (inactiva)'}
              {' '}<button type="button" className="boton-silencioso" onClick={() => {
                const t = pedirTexto('Nuevo nombre de la unidad', u.nombre);
                if (t) void ejecutar(() => supabase.from('unidades_medida').update({ nombre: t }).eq('id', u.id).eq('version', u.version), 'Unidad renombrada.');
              }}>Renombrar</button>
              <button type="button" className="boton-silencioso" onClick={() =>
                void ejecutar(() => supabase.from('unidades_medida').update({ activo: !u.activo }).eq('id', u.id).eq('version', u.version),
                  u.activo ? 'Unidad desactivada.' : 'Unidad reactivada.')}>
                {u.activo ? 'Desactivar' : 'Reactivar'}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="tarjeta">
        <h2>Áreas</h2>
        <form className="filtros" onSubmit={(e) => { e.preventDefault();
          if (nArea.trim().length < 2) { setError('Nombre de área muy corto.'); return; }
          void ejecutar(() => supabase.from('areas').insert({ nombre: nArea.trim() }), 'Área creada.').then(() => setNArea(''));
        }}>
          <Campo etiqueta="Nueva área"><input value={nArea} onChange={(e) => setNArea(e.target.value)} /></Campo>
          <button type="submit" className="boton-primario">Agregar</button>
        </form>
        <ul>
          {cat.areas.map((a) => (
            <li key={a.id}>
              {a.nombre} {a.activo ? '' : ' (inactiva)'}
              {' '}<button type="button" className="boton-silencioso" onClick={() => {
                const t = pedirTexto('Nuevo nombre del área', a.nombre);
                if (t) void ejecutar(() => supabase.from('areas').update({ nombre: t }).eq('id', a.id).eq('version', a.version), 'Área renombrada.');
              }}>Renombrar</button>
              {' '}<button type="button" className="boton-silencioso" onClick={() =>
                void ejecutar(() => supabase.from('areas').update({ activo: !a.activo }).eq('id', a.id).eq('version', a.version),
                  a.activo ? 'Área desactivada.' : 'Área reactivada.')}>
                {a.activo ? 'Desactivar' : 'Reactivar'}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="tarjeta">
        <h2>Centros de costo</h2>
        <form className="filtros" onSubmit={(e) => { e.preventDefault();
          if (nCCCodigo.trim().length < 2 || nCCNombre.trim().length < 2) { setError('Código y nombre son obligatorios.'); return; }
          void ejecutar(() => supabase.from('centros_costo').insert({ codigo: nCCCodigo.trim(), nombre: nCCNombre.trim() }), 'Centro de costo creado.')
            .then(() => { setNCCCodigo(''); setNCCNombre(''); });
        }}>
          <Campo etiqueta="Código"><input value={nCCCodigo} onChange={(e) => setNCCCodigo(e.target.value)} /></Campo>
          <Campo etiqueta="Nombre"><input value={nCCNombre} onChange={(e) => setNCCNombre(e.target.value)} /></Campo>
          <button type="submit" className="boton-primario">Agregar</button>
        </form>
        <ul>
          {cat.centros.map((c) => (
            <li key={c.id}>
              <b>{c.codigo}</b> · {c.nombre} {c.activo ? '' : ' (inactivo)'}
              {' '}<button type="button" className="boton-silencioso" onClick={() => {
                const t = pedirTexto(`Nuevo nombre para ${c.codigo}`, c.nombre);
                if (t) void ejecutar(() => supabase.from('centros_costo').update({ nombre: t }).eq('id', c.id).eq('version', c.version), 'Centro de costo renombrado.');
              }}>Renombrar</button>
              {' '}<button type="button" className="boton-silencioso" onClick={() =>
                void ejecutar(() => supabase.from('centros_costo').update({ activo: !c.activo }).eq('id', c.id).eq('version', c.version),
                  c.activo ? 'Centro desactivado.' : 'Centro reactivado.')}>
                {c.activo ? 'Desactivar' : 'Reactivar'}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="tarjeta">
        <h2>Proveedores</h2>
        <p className="texto-suave">El registro de proveedor es informativo; no constituye validación legal ni fiscal. Compras también puede crearlos desde su gestión.</p>
        <form className="formulario" onSubmit={(e) => { e.preventDefault();
          if (nProv.nombre.trim().length < 2) { setError('Nombre de proveedor obligatorio.'); return; }
          void ejecutar(() => supabase.from('proveedores').insert({
            nombre: nProv.nombre.trim(),
            identificacion: nProv.identificacion.trim() || null,
            contacto: nProv.contacto.trim() || null,
            telefono: nProv.telefono.trim() || null,
            correo: nProv.correo.trim() || null
          }), 'Proveedor creado.').then(() => setNProv({ nombre: '', identificacion: '', contacto: '', telefono: '', correo: '' }));
        }}>
          <div className="fila-campos">
            <Campo etiqueta="Nombre" requerido><input value={nProv.nombre} onChange={(e) => setNProv({ ...nProv, nombre: e.target.value })} /></Campo>
            <Campo etiqueta="Identificación (texto informativo)"><input value={nProv.identificacion} onChange={(e) => setNProv({ ...nProv, identificacion: e.target.value })} /></Campo>
            <Campo etiqueta="Contacto"><input value={nProv.contacto} onChange={(e) => setNProv({ ...nProv, contacto: e.target.value })} /></Campo>
            <Campo etiqueta="Teléfono"><input value={nProv.telefono} onChange={(e) => setNProv({ ...nProv, telefono: e.target.value })} /></Campo>
            <Campo etiqueta="Correo"><input value={nProv.correo} onChange={(e) => setNProv({ ...nProv, correo: e.target.value })} /></Campo>
          </div>
          <div><button type="submit" className="boton-primario">Agregar proveedor</button></div>
        </form>
        <ul>
          {cat.proveedores.map((p) => (
            <li key={p.id}>
              {p.nombre}{p.identificacion ? ` · ${p.identificacion}` : ''}{p.activo ? '' : ' (inactivo)'}
              {' '}{permisos.adminCatalogos ? (
                <button type="button" className="boton-silencioso" onClick={() =>
                  void ejecutar(() => supabase.from('proveedores').update({ activo: !p.activo }).eq('id', p.id).eq('version', p.version),
                    p.activo ? 'Proveedor desactivado.' : 'Proveedor reactivado.')}>
                  {p.activo ? 'Desactivar' : 'Reactivar'}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
