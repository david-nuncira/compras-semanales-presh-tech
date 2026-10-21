import { BrowserRouter, Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ProveedorSesion, useSesion } from './contexto/Sesion.tsx';
import type { Rol } from './tipos.ts';
import { Cargando } from './componentes/UI.tsx';

import { Acceso } from './paginas/Acceso.tsx';
import { Restablecer } from './paginas/Restablecer.tsx';
import { PendienteActivacion } from './paginas/PendienteActivacion.tsx';
import { Tablero } from './paginas/Tablero.tsx';
import { MisSolicitudes } from './paginas/MisSolicitudes.tsx';
import { SolicitudDetalle } from './paginas/SolicitudDetalle.tsx';
import { GestionCompras } from './paginas/GestionCompras.tsx';
import { ArticuloGestion } from './paginas/ArticuloGestion.tsx';
import { Aprobaciones } from './paginas/Aprobaciones.tsx';
import { Almacen } from './paginas/Almacen.tsx';
import { ComprasExternas } from './paginas/ComprasExternas.tsx';
import { Reportes } from './paginas/Reportes.tsx';
import { AdminUsuarios } from './paginas/AdminUsuarios.tsx';
import { AdminCatalogos } from './paginas/AdminCatalogos.tsx';
import { AdminAuditoria } from './paginas/AdminAuditoria.tsx';
import { AdminRecuperacion } from './paginas/AdminRecuperacion.tsx';
import { AdminImportacion } from './paginas/AdminImportacion.tsx';

function Protegida({ children, roles }: { children: ReactNode; roles?: Rol[] }) {
  const { sesion, perfil, cargando, esActivo, tiene } = useSesion();
  const ubicacion = useLocation();
  if (cargando) return <div className="contenido"><Cargando /></div>;
  if (!sesion) return <Navigate to="/acceso" state={{ desde: ubicacion.pathname }} replace />;
  if (!perfil || !esActivo) return <Navigate to="/pendiente" replace />;
  if (roles && !roles.some((r) => tiene(r))) {
    return (
      <div className="contenido">
        <div className="tarjeta">
          <h2>Sin permiso</h2>
          <p>Tu cuenta no tiene el permiso necesario para esta sección. Si crees que es un error, contacta al administrador.</p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

function Cabecera() {
  const { perfil, tiene, salir, sesion } = useSesion();
  if (!sesion || !perfil || perfil.estado !== 'activo') return null;
  const clase = ({ isActive }: { isActive: boolean }) => (isActive ? 'activo' : '');
  return (
    <header className="cabecera">
      <span className="marca">🛒 Compras Semanales</span>
      <nav aria-label="Secciones">
        <NavLink to="/" className={clase} end>Inicio</NavLink>
        {tiene('solicitante') ? <NavLink to="/mis-solicitudes" className={clase}>Mis solicitudes</NavLink> : null}
        {(tiene('compras') || tiene('administrador')) ? <NavLink to="/gestion" className={clase}>Gestión de compras</NavLink> : null}
        {tiene('aprobador') ? <NavLink to="/aprobaciones" className={clase}>Aprobaciones</NavLink> : null}
        {(tiene('almacen') || tiene('compras') || tiene('administrador')) ? <NavLink to="/almacen" className={clase}>Almacén</NavLink> : null}
        {(tiene('compras') || tiene('administrador')) ? <NavLink to="/compras-externas" className={clase}>Compras externas</NavLink> : null}
        {(tiene('compras') || tiene('administrador')) ? <NavLink to="/reportes" className={clase}>Reportes</NavLink> : null}
        {tiene('administrador') ? <NavLink to="/admin" className={clase}>Administración</NavLink> : null}
      </nav>
      <span className="usuario">{perfil.nombre}</span>
      <button type="button" className="boton-secundario" onClick={() => void salir()}>Salir</button>
    </header>
  );
}

export function App() {
  return (
    <ProveedorSesion>
      <BrowserRouter>
        <Cabecera />
        <Routes>
          <Route path="/acceso" element={<Acceso />} />
          <Route path="/restablecer" element={<Restablecer />} />
          <Route path="/pendiente" element={<PendienteActivacion />} />
          <Route path="/" element={<Protegida><Tablero /></Protegida>} />
          <Route path="/mis-solicitudes" element={<Protegida roles={['solicitante']}><MisSolicitudes /></Protegida>} />
          <Route path="/solicitudes/:id" element={<Protegida><SolicitudDetalle /></Protegida>} />
          <Route path="/gestion" element={<Protegida roles={['compras', 'administrador']}><GestionCompras /></Protegida>} />
          <Route path="/gestion/articulo/:id" element={<Protegida><ArticuloGestion /></Protegida>} />
          <Route path="/aprobaciones" element={<Protegida roles={['aprobador']}><Aprobaciones /></Protegida>} />
          <Route path="/almacen" element={<Protegida roles={['almacen', 'compras', 'administrador']}><Almacen /></Protegida>} />
          <Route path="/compras-externas" element={<Protegida roles={['compras', 'administrador']}><ComprasExternas /></Protegida>} />
          <Route path="/reportes" element={<Protegida roles={['compras', 'administrador']}><Reportes /></Protegida>} />
          <Route path="/admin" element={<Protegida roles={['administrador']}><AdminUsuarios /></Protegida>} />
          <Route path="/admin/catalogos" element={<Protegida roles={['administrador']}><AdminCatalogos /></Protegida>} />
          <Route path="/admin/auditoria" element={<Protegida roles={['administrador']}><AdminAuditoria /></Protegida>} />
          <Route path="/admin/recuperacion" element={<Protegida roles={['administrador']}><AdminRecuperacion /></Protegida>} />
          <Route path="/admin/importacion" element={<Protegida roles={['administrador']}><AdminImportacion /></Protegida>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ProveedorSesion>
  );
}
