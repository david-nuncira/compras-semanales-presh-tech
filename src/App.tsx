import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate, useLocation, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ProveedorSesion, useSesion } from './contexto/Sesion.tsx';
import { supabase } from './supabase.ts';
import { usePermisos, type Permisos } from './permisos.ts';
import { ENTORNO } from './config.ts';
import { Cargando } from './componentes/UI.tsx';

import { Acceso } from './paginas/Acceso.tsx';
import { Restablecer } from './paginas/Restablecer.tsx';
import { PendienteActivacion } from './paginas/PendienteActivacion.tsx';
import { Tablero } from './paginas/Tablero.tsx';
import { MisSolicitudes } from './paginas/MisSolicitudes.tsx';
import { SolicitudDetalle } from './paginas/SolicitudDetalle.tsx';
import { AprobacionSolicitudes } from './paginas/AprobacionSolicitudes.tsx';
import { GestionCompras } from './paginas/GestionCompras.tsx';
import { ArticuloGestion } from './paginas/ArticuloGestion.tsx';
import { Aprobaciones } from './paginas/Aprobaciones.tsx';
import { Almacen } from './paginas/Almacen.tsx';
import { ComprasExternas } from './paginas/ComprasExternas.tsx';
import { Reportes } from './paginas/Reportes.tsx';
import { ConsultaGlobal } from './paginas/ConsultaGlobal.tsx';
import { Notificaciones } from './paginas/Notificaciones.tsx';
import { AdminUsuarios } from './paginas/AdminUsuarios.tsx';
import { AdminEstructura } from './paginas/AdminEstructura.tsx';
import { AdminCalendario } from './paginas/AdminCalendario.tsx';
import { AdminCatalogos } from './paginas/AdminCatalogos.tsx';
import { AdminAuditoria } from './paginas/AdminAuditoria.tsx';
import { AdminRecuperacion } from './paginas/AdminRecuperacion.tsx';
import { AdminImportacion } from './paginas/AdminImportacion.tsx';

/**
 * Con la corrección de producción en Sesion.tsx, el perfil se carga justo
 * DESPUÉS de la sesión (para evitar el bloqueo de Supabase Auth). Mientras
 * llega, se muestra "Cargando" en lugar de redirigir a "Cuenta pendiente";
 * así recargar una página interna no pierde la ruta. Si el perfil no llega
 * en 10 s, se continúa como antes.
 */
function useEsperaPerfil(haySesion: boolean, hayPerfil: boolean): boolean {
  const [vencido, setVencido] = useState(false);
  useEffect(() => {
    if (!haySesion || hayPerfil) { setVencido(false); return; }
    const t = window.setTimeout(() => setVencido(true), 10000);
    return () => window.clearTimeout(t);
  }, [haySesion, hayPerfil]);
  return haySesion && !hayPerfil && !vencido;
}

/** Solo controla qué se MUESTRA; el servidor decide qué se puede hacer. */
function Protegida({ children, permite }: { children: ReactNode; permite?: (p: Permisos) => boolean }) {
  const { sesion, perfil, cargando, esActivo } = useSesion();
  const permisos = usePermisos();
  const ubicacion = useLocation();
  const esperandoPerfil = useEsperaPerfil(!!sesion, !!perfil);
  if (cargando || esperandoPerfil) return <div className="contenido"><Cargando /></div>;
  if (!sesion) return <Navigate to="/acceso" state={{ desde: ubicacion.pathname }} replace />;
  if (!perfil || !esActivo) return <Navigate to="/pendiente" replace />;
  if (permite && !permite(permisos)) {
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
  const { perfil, salir, sesion } = useSesion();
  const p = usePermisos();
  if (!sesion || !perfil || perfil.estado !== 'activo') return null;
  const clase = ({ isActive }: { isActive: boolean }) => (isActive ? 'activo' : '');
  const sinLeer = perfil.notificaciones_sin_leer ?? 0;
  return (
    <>
      {ENTORNO === 'pruebas' ? <div className="banda-pruebas">ENTORNO DE PRUEBAS · datos ficticios · no es producción</div> : null}
      {ENTORNO === 'vista_previa_real' ? <div className="banda-pruebas banda-real">VISTA PREVIA de la nueva versión conectada a la base REAL · lo que hagas aquí queda guardado</div> : null}
      <header className="cabecera">
        <span className="marca">🛒 Compras Semanales</span>
        <nav aria-label="Secciones">
          <NavLink to="/" className={clase} end>Inicio</NavLink>
          {p.solicitante ? <NavLink to="/mis-solicitudes" className={clase}>Mis solicitudes</NavLink> : null}
          {p.jefe ? <NavLink to="/aprobacion-solicitudes" className={clase}>Por aprobar (jefe)</NavLink> : null}
          {p.gestor ? <NavLink to="/gestion" className={clase}>Gestión de compras</NavLink> : null}
          {p.aprobadorCotizacion ? <NavLink to="/aprobaciones" className={clase}>Aprobación de cotizaciones</NavLink> : null}
          {(p.almacen || p.gestor) ? <NavLink to="/almacen" className={clase}>Almacén</NavLink> : null}
          {p.consultaGlobal ? <NavLink to="/consulta" className={clase}>Consulta global</NavLink> : null}
          {p.gestor ? <NavLink to="/compras-externas" className={clase}>Compras externas</NavLink> : null}
          {(p.gestor || p.consultaGlobal) ? <NavLink to="/reportes" className={clase}>Reportes</NavLink> : null}
          {(p.adminUsuarios || p.adminCatalogos || p.adminGeneral)
            ? <NavLink to={p.adminUsuarios ? '/admin' : '/admin/estructura'} className={clase}>Administración</NavLink> : null}
        </nav>
        <NavLink to="/notificaciones" className="campana" aria-label={`Notificaciones: ${sinLeer} sin leer`}>
          🔔{sinLeer > 0 ? <span className="contador">{sinLeer > 99 ? '99+' : sinLeer}</span> : null}
        </NavLink>
        <span className="usuario">{perfil.nombre}{perfil.area_nombre ? ` · ${perfil.area_nombre}` : ''}</span>
        <button type="button" className="boton-secundario" onClick={() => void salir()}>Salir</button>
      </header>
    </>
  );
}

/** Abre la pantalla de cambio de contraseña al volver desde un enlace Auth. */
// (Corrección de producción, conservada sin cambios.)
function RedirigirRecuperacion() {
  const navegar = useNavigate();

  useEffect(() => {
    const fragmento = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (fragmento.get('type') === 'recovery') {
      navegar('/restablecer', { replace: true });
    }

    const { data: sub } = supabase.auth.onAuthStateChange((evento) => {
      if (evento === 'PASSWORD_RECOVERY') {
        // Diferir la navegación fuera del bloqueo interno de Auth.
        window.setTimeout(() => navegar('/restablecer', { replace: true }), 0);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [navegar]);

  return null;
}

export function App() {
  return (
    <ProveedorSesion>
      <BrowserRouter>
        <RedirigirRecuperacion />
        <Cabecera />
        <Routes>
          {/* Acceso y recuperación: sin cambios en esta versión. */}
          <Route path="/acceso" element={<Acceso />} />
          <Route path="/restablecer" element={<Restablecer />} />
          <Route path="/pendiente" element={<PendienteActivacion />} />

          <Route path="/" element={<Protegida><Tablero /></Protegida>} />
          <Route path="/notificaciones" element={<Protegida><Notificaciones /></Protegida>} />
          <Route path="/mis-solicitudes" element={<Protegida permite={(p) => p.solicitante}><MisSolicitudes /></Protegida>} />
          <Route path="/solicitudes/:id" element={<Protegida><SolicitudDetalle /></Protegida>} />
          <Route path="/aprobacion-solicitudes" element={<Protegida permite={(p) => p.jefe}><AprobacionSolicitudes /></Protegida>} />
          <Route path="/gestion" element={<Protegida permite={(p) => p.gestor}><GestionCompras /></Protegida>} />
          <Route path="/gestion/articulo/:id" element={<Protegida><ArticuloGestion /></Protegida>} />
          <Route path="/aprobaciones" element={<Protegida permite={(p) => p.aprobadorCotizacion}><Aprobaciones /></Protegida>} />
          <Route path="/almacen" element={<Protegida permite={(p) => p.almacen || p.gestor}><Almacen /></Protegida>} />
          <Route path="/consulta" element={<Protegida permite={(p) => p.consultaGlobal}><ConsultaGlobal /></Protegida>} />
          <Route path="/compras-externas" element={<Protegida permite={(p) => p.gestor}><ComprasExternas /></Protegida>} />
          <Route path="/reportes" element={<Protegida permite={(p) => p.gestor || p.consultaGlobal}><Reportes /></Protegida>} />
          <Route path="/admin" element={<Protegida permite={(p) => p.adminUsuarios}><AdminUsuarios /></Protegida>} />
          <Route path="/admin/estructura" element={<Protegida permite={(p) => p.adminCatalogos}><AdminEstructura /></Protegida>} />
          <Route path="/admin/calendario" element={<Protegida permite={(p) => p.adminCatalogos}><AdminCalendario /></Protegida>} />
          <Route path="/admin/catalogos" element={<Protegida permite={(p) => p.adminCatalogos}><AdminCatalogos /></Protegida>} />
          <Route path="/admin/auditoria" element={<Protegida permite={(p) => p.adminGeneral}><AdminAuditoria /></Protegida>} />
          <Route path="/admin/recuperacion" element={<Protegida permite={(p) => p.adminGeneral}><AdminRecuperacion /></Protegida>} />
          <Route path="/admin/importacion" element={<Protegida permite={(p) => p.adminGeneral}><AdminImportacion /></Protegida>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ProveedorSesion>
  );
}
