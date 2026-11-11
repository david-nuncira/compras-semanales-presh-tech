import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabase.ts';
import { useCatalogos } from '../datos.ts';
import { AdminNav } from '../componentes/AdminNav.tsx';
import { UnidadesCatalogo } from '../componentes/UnidadesCatalogo.tsx';
import { usePermisos } from '../permisos.ts';
import { Campo, Formulario, MensajeError, Cargando, EstadoError } from '../componentes/UI.tsx';
import { useNotificaciones } from '../componentes/Notificaciones.tsx';

export function AdminCatalogos() {
  const { cat, error: errorCat, recargar } = useCatalogos(true);
  const permisos = usePermisos();
  const { notificar, cerrarClave } = useNotificaciones();
  const [ocupado, setOcupado] = useState(false);
  const bloqueo = useRef(false);
  const [nArea, setNArea] = useState('');
  const [nCCCodigo, setNCCCodigo] = useState(''), [nCCNombre, setNCCNombre] = useState('');
  const vacio = { nombre: '', identificacion: '', contacto: '', telefono: '', correo: '' };
  const [nProv, setNProv] = useState(vacio);

  async function ejecutar(fn: () => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>, mensaje: string): Promise<boolean> {
    if (bloqueo.current) return false;
    bloqueo.current = true; setOcupado(true); cerrarClave('catalogos-resultado');
    try {
      const { data, error } = await fn();
      if (error) throw new Error(error.message);
      if (!data?.length) throw new Error('El registro cambió o ya no está disponible. Actualiza la lista antes de intentarlo de nuevo.');
      notificar(mensaje, 'exito', 'catalogos-resultado');
      await recargar();
      return true;
    } catch (error) {
      notificar(error instanceof Error ? error.message : 'No pudimos confirmar el resultado. Actualiza la lista antes de repetir la operación.', 'error', 'catalogos-resultado');
      return false;
    } finally { bloqueo.current = false; setOcupado(false); }
  }
  if (!cat) return <div className="contenido"><MensajeError texto={errorCat} />{errorCat ? <EstadoError alReintentar={() => void recargar()} /> : <Cargando texto="Cargando catálogos…" />}</div>;
  return <div className="contenido">
    <span className="sobre-titulo">CONFIGURACIÓN DEL EQUIPO</span><h1>Catálogos</h1>
    <p className="texto-suave">Organiza las opciones que tu equipo utiliza al solicitar y gestionar compras.</p>
    <AdminNav />
    <UnidadesCatalogo /><MensajeError texto={errorCat} />
    <div className="aviso-contexto"><span aria-hidden="true">i</span><p>Desactivar una opción la oculta en nuevas solicitudes y conserva su historial. Los campos con * son obligatorios.</p></div>
    <section className="tarjeta" aria-labelledby="titulo-areas"><div className="seccion-cabecera"><div><span className="sobre-titulo">01 · ORGANIZACIÓN</span><h2 id="titulo-areas">Áreas</h2></div><span className="insignia-suave">{cat.areas.length} registradas</span></div>
      <Formulario className="formulario formulario-catalogo" onSubmit={async () => {
        if (await ejecutar(() => supabase.from('areas').insert({ nombre: nArea.trim() }).select('id'), 'Área creada correctamente.')) setNArea('');
      }}>
        <fieldset disabled={ocupado} className="filtros">
          <Campo etiqueta="Nombre del área" requerido ayuda="Por ejemplo, Producción o Comercial."><input value={nArea} onChange={(e) => setNArea(e.target.value)} minLength={2} maxLength={120} placeholder="Escribe el nombre del área" /></Campo>
          <button type="submit" className="boton-primario">{ocupado ? 'Guardando…' : 'Agregar área'}</button>
        </fieldset>
      </Formulario>
      <ul className="lista-catalogo">{cat.areas.map((a) => <li key={a.id}><div><strong>{a.nombre}</strong><span className={`estado-registro${a.activo ? '' : ' inactivo'}`}>{a.activo ? 'Activa' : 'Inactiva'}</span></div><button type="button" disabled={ocupado} className="boton-silencioso" onClick={() => void ejecutar(() => supabase.from('areas').update({ activo: !a.activo }).eq('id', a.id).eq('version', a.version).select('id'), a.activo ? 'Área desactivada.' : 'Área reactivada.')}>{a.activo ? 'Desactivar' : 'Reactivar'}</button></li>)}</ul>
      {cat.areas.length === 0 ? <p className="texto-suave">Agrega la primera área para que esté disponible en las solicitudes.</p> : null}
    </section>
    <section className="tarjeta" aria-labelledby="titulo-centros"><div className="seccion-cabecera"><div><span className="sobre-titulo">02 · ASIGNACIÓN DEL GASTO</span><h2 id="titulo-centros">Centros de costo</h2></div><span className="insignia-suave">{cat.centros.length} registrados</span></div>
      <Formulario className="formulario formulario-catalogo" onSubmit={async () => {
        if (await ejecutar(() => supabase.from('centros_costo').insert({ codigo: nCCCodigo.trim(), nombre: nCCNombre.trim() }).select('id'), 'Centro de costo creado correctamente.')) { setNCCCodigo(''); setNCCNombre(''); }
      }}>
        <fieldset disabled={ocupado} className="filtros"><Campo etiqueta="Código" requerido><input value={nCCCodigo} onChange={(e) => setNCCCodigo(e.target.value)} minLength={2} placeholder="Código oficial" /></Campo><Campo etiqueta="Nombre del centro" requerido><input value={nCCNombre} onChange={(e) => setNCCNombre(e.target.value)} minLength={2} placeholder="Nombre del centro de costo" /></Campo><button type="submit" className="boton-primario">{ocupado ? 'Guardando…' : 'Agregar centro'}</button></fieldset>
      </Formulario>
      <ul className="lista-catalogo">{cat.centros.map((c) => <li key={c.id}><div><strong>{c.codigo}</strong><span>{c.nombre}</span><span className={`estado-registro${c.activo ? '' : ' inactivo'}`}>{c.activo ? 'Activo' : 'Inactivo'}</span></div><button type="button" disabled={ocupado} className="boton-silencioso" onClick={() => void ejecutar(() => supabase.from('centros_costo').update({ activo: !c.activo }).eq('id', c.id).eq('version', c.version).select('id'), c.activo ? 'Centro desactivado.' : 'Centro reactivado.')}>{c.activo ? 'Desactivar' : 'Reactivar'}</button></li>)}</ul>
      {cat.centros.length === 0 ? <p className="texto-suave">Agrega un centro para identificar a dónde se asigna cada compra.</p> : null}
    </section>
    <section className="tarjeta" aria-labelledby="titulo-proveedores"><div className="seccion-cabecera"><div><span className="sobre-titulo">03 · RED DE PROVEEDORES</span><h2 id="titulo-proveedores">Proveedores</h2></div><span className="insignia-suave">{cat.proveedores.length} registrados</span></div>
      <p className="texto-suave">Guarda sus datos para reutilizarlos al cotizar. Este registro es informativo y no constituye validación legal ni fiscal.</p>
      <Formulario className="formulario" onSubmit={async () => {
        if (await ejecutar(() => supabase.from('proveedores').insert({ nombre: nProv.nombre.trim(), identificacion: nProv.identificacion.trim() || null, contacto: nProv.contacto.trim() || null, telefono: nProv.telefono.trim() || null, correo: nProv.correo.trim() || null }).select('id'), 'Proveedor guardado correctamente.')) setNProv(vacio);
      }}>
        <fieldset disabled={ocupado} className="formulario"><div className="fila-campos">
          <Campo etiqueta="Nombre del proveedor" requerido><input value={nProv.nombre} onChange={(e) => setNProv({ ...nProv, nombre: e.target.value })} minLength={2} placeholder="Razón social o nombre" /></Campo>
          <Campo etiqueta="Identificación" ayuda="Dato informativo, si lo conoces."><input value={nProv.identificacion} onChange={(e) => setNProv({ ...nProv, identificacion: e.target.value })} /></Campo>
          <Campo etiqueta="Persona de contacto"><input value={nProv.contacto} onChange={(e) => setNProv({ ...nProv, contacto: e.target.value })} autoComplete="name" /></Campo>
          <Campo etiqueta="Teléfono"><input type="tel" value={nProv.telefono} onChange={(e) => setNProv({ ...nProv, telefono: e.target.value })} autoComplete="tel" /></Campo>
          <Campo etiqueta="Correo electrónico"><input type="email" value={nProv.correo} onChange={(e) => setNProv({ ...nProv, correo: e.target.value })} autoComplete="email" placeholder="contacto@proveedor.com" /></Campo>
        </div><div className="formulario-pie"><span className="texto-suave">Solo el nombre es obligatorio.</span><button type="submit" className="boton-primario">{ocupado ? 'Guardando…' : 'Agregar proveedor'}</button></div></fieldset>
      </Formulario>
      <ul className="lista-catalogo">{cat.proveedores.map((p) => <li key={p.id}><div><strong>{p.nombre}</strong>{p.identificacion ? <span>{p.identificacion}</span> : null}<span className={`estado-registro${p.activo ? '' : ' inactivo'}`}>{p.activo ? 'Activo' : 'Inactivo'}</span></div>{permisos.adminCatalogos ? <button type="button" disabled={ocupado} className="boton-silencioso" onClick={() => void ejecutar(() => supabase.from('proveedores').update({ activo: !p.activo }).eq('id', p.id).eq('version', p.version).select('id'), p.activo ? 'Proveedor desactivado.' : 'Proveedor reactivado.')}>{p.activo ? 'Desactivar' : 'Reactivar'}</button> : null}</li>)}</ul>
    </section>
  </div>;
}
