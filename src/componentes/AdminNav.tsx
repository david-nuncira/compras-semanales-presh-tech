import { NavLink } from 'react-router-dom';
import { usePermisos } from '../permisos.ts';

/** Navegación de Administración: cada enlace aparece solo con su permiso. */
export function AdminNav() {
  const p = usePermisos();
  const clase = ({ isActive }: { isActive: boolean }) => (isActive ? 'boton-primario' : 'boton-secundario');
  return (
    <nav className="pestanas" aria-label="Administración">
      {p.adminUsuarios ? <NavLink to="/admin" end className={clase}>Usuarios y permisos</NavLink> : null}
      {p.adminCatalogos ? <NavLink to="/admin/estructura" className={clase}>Estructura: áreas, jefes y centros de costo</NavLink> : null}
      {p.adminCatalogos ? <NavLink to="/admin/calendario" className={clase}>Calendario de recepción</NavLink> : null}
      {p.adminCatalogos ? <NavLink to="/admin/catalogos" className={clase}>Catálogos</NavLink> : null}
      {p.adminGeneral ? <NavLink to="/admin/organigrama" className={clase}>Organigrama y gerencia</NavLink> : null}
      {p.adminGeneral ? <NavLink to="/admin/auditoria" className={clase}>Auditoría</NavLink> : null}
      {p.adminGeneral ? <NavLink to="/admin/recuperacion" className={clase}>Recuperación de acceso</NavLink> : null}
      {p.adminGeneral ? <NavLink to="/admin/importacion" className={clase}>Importación CSV</NavLink> : null}
    </nav>
  );
}
