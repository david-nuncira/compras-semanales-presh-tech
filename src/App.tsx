import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ProveedorSesion, useSesion } from './contexto/Sesion.tsx';
import { supabase } from './supabase.ts';
import { usePermisos, type Permisos } from './permisos.ts';
import { Cargando, Esqueleto, SinPermiso } from './componentes/UI.tsx';
import { Marco } from './componentes/Navegacion.tsx';

import { Acceso } from './paginas/Acceso.tsx';
import { Restablecer } from './paginas/Restablecer.tsx';
import { PendienteActivacion } from './paginas/PendienteActivacion.tsx';
// Carga diferida por ruta: cada pantalla se descarga solo cuando se abre.
const Tablero = lazy(() => import('./paginas/Tablero.tsx').then((m) => ({ default: m.Tablero })));
const MisSolicitudes = lazy(() => import('./paginas/MisSolicitudes.tsx').then((m) => ({ default: m.MisSolicitudes })));
const AsistenteSolicitud = lazy(() => import('./paginas/AsistenteSolicitud.tsx').then((m) => ({ default: m.AsistenteSolicitud })));
const Ayuda = lazy(() => import('./paginas/Ayuda.tsx').then((m) => ({ default: m.Ayuda })));
const PedidoMantenimiento = lazy(() => import('./paginas/PedidoMantenimiento.tsx').then((m) => ({ default: m.PedidoMantenimiento })));
const MatrizCotizaciones = lazy(() => import('./paginas/MatrizCotizaciones.tsx').then((m) => ({ default: m.MatrizCotizaciones })));
const SolicitudDetalle = lazy(() => import('./paginas/SolicitudDetalle.tsx').then((m) => ({ default: m.SolicitudDetalle })));
const AprobacionSolicitudes = lazy(() => import('./paginas/AprobacionSolicitudes.tsx').then((m) => ({ default: m.AprobacionSolicitudes })));
const GestionCompras = lazy(() => import('./paginas/GestionCompras.tsx').then((m) => ({ default: m.GestionCompras })));
const ArticuloGestion = lazy(() => import('./paginas/ArticuloGestion.tsx').then((m) => ({ default: m.ArticuloGestion })));
const Aprobaciones = lazy(() => import('./paginas/Aprobaciones.tsx').then((m) => ({ default: m.Aprobaciones })));
const Almacen = lazy(() => import('./paginas/Almacen.tsx').then((m) => ({ default: m.Almacen })));
const ComprasExternas = lazy(() => import('./paginas/ComprasExternas.tsx').then((m) => ({ default: m.ComprasExternas })));
const Reportes = lazy(() => import('./paginas/Reportes.tsx').then((m) => ({ default: m.Reportes })));
const ConsultaGlobal = lazy(() => import('./paginas/ConsultaGlobal.tsx').then((m) => ({ default: m.ConsultaGlobal })));
const Notificaciones = lazy(() => import('./paginas/Notificaciones.tsx').then((m) => ({ default: m.Notificaciones })));
const AdminUsuarios = lazy(() => import('./paginas/AdminUsuarios.tsx').then((m) => ({ default: m.AdminUsuarios })));
const AdminEstructura = lazy(() => import('./paginas/AdminEstructura.tsx').then((m) => ({ default: m.AdminEstructura })));
const AdminOrganigrama = lazy(() => import('./paginas/AdminOrganigrama.tsx').then((m) => ({ default: m.AdminOrganigrama })));
const AdminCalendario = lazy(() => import('./paginas/AdminCalendario.tsx').then((m) => ({ default: m.AdminCalendario })));
const AdminCatalogos = lazy(() => import('./paginas/AdminCatalogos.tsx').then((m) => ({ default: m.AdminCatalogos })));
const AdminAuditoria = lazy(() => import('./paginas/AdminAuditoria.tsx').then((m) => ({ default: m.AdminAuditoria })));
const AdminRecuperacion = lazy(() => import('./paginas/AdminRecuperacion.tsx').then((m) => ({ default: m.AdminRecuperacion })));
const AdminImportacion = lazy(() => import('./paginas/AdminImportacion.tsx').then((m) => ({ default: m.AdminImportacion })));

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
        <SinPermiso />
      </div>
    );
  }
  return <>{children}</>;
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
        <Marco>
        <Suspense fallback={<div className="contenido"><Esqueleto lineas={4} /></div>}>
        <Routes>
          {/* Acceso y recuperación: sin cambios en esta versión. */}
          <Route path="/acceso" element={<Acceso />} />
          <Route path="/restablecer" element={<Restablecer />} />
          <Route path="/pendiente" element={<PendienteActivacion />} />

          <Route path="/" element={<Protegida><Tablero /></Protegida>} />
          <Route path="/notificaciones" element={<Protegida><Notificaciones /></Protegida>} />
          <Route path="/mis-solicitudes" element={<Protegida permite={(p) => p.solicitante}><MisSolicitudes /></Protegida>} />
          <Route path="/nueva-solicitud" element={<Protegida permite={(p) => p.solicitante}><AsistenteSolicitud /></Protegida>} />
          <Route path="/nueva-solicitud/:id" element={<Protegida permite={(p) => p.solicitante}><AsistenteSolicitud /></Protegida>} />
          <Route path="/solicitudes/:id" element={<Protegida><SolicitudDetalle /></Protegida>} />
          <Route path="/aprobacion-solicitudes" element={<Protegida permite={(p) => p.jefe}><AprobacionSolicitudes /></Protegida>} />
          <Route path="/ayuda" element={<Protegida><Ayuda /></Protegida>} />
          <Route path="/solicitudes/:id/mantenimiento" element={<Protegida><PedidoMantenimiento /></Protegida>} />
          <Route path="/solicitudes/:id/cotizaciones" element={<Protegida permite={(p) => p.gestor || p.consultaGlobal || p.aprobadorCotizacion}><MatrizCotizaciones /></Protegida>} />
          <Route path="/gestion" element={<Protegida permite={(p) => p.gestor}><GestionCompras /></Protegida>} />
          <Route path="/gestion/articulo/:id" element={<Protegida><ArticuloGestion /></Protegida>} />
          <Route path="/aprobaciones" element={<Protegida permite={(p) => p.aprobadorCotizacion}><Aprobaciones /></Protegida>} />
          <Route path="/almacen" element={<Protegida permite={(p) => p.almacen || p.gestor}><Almacen /></Protegida>} />
          <Route path="/consulta" element={<Protegida permite={(p) => p.consultaGlobal}><ConsultaGlobal /></Protegida>} />
          <Route path="/compras-externas" element={<Protegida permite={(p) => p.gestor}><ComprasExternas /></Protegida>} />
          <Route path="/reportes" element={<Protegida permite={(p) => p.gestor || p.consultaGlobal}><Reportes /></Protegida>} />
          <Route path="/admin" element={<Protegida permite={(p) => p.adminUsuarios}><AdminUsuarios /></Protegida>} />
          <Route path="/admin/estructura" element={<Protegida permite={(p) => p.adminCatalogos}><AdminEstructura /></Protegida>} />
          <Route path="/admin/organigrama" element={<Protegida permite={(p) => p.adminGeneral}><AdminOrganigrama /></Protegida>} />
          <Route path="/admin/calendario" element={<Protegida permite={(p) => p.adminCatalogos}><AdminCalendario /></Protegida>} />
          <Route path="/admin/catalogos" element={<Protegida permite={(p) => p.adminCatalogos}><AdminCatalogos /></Protegida>} />
          <Route path="/admin/auditoria" element={<Protegida permite={(p) => p.adminGeneral}><AdminAuditoria /></Protegida>} />
          <Route path="/admin/recuperacion" element={<Protegida permite={(p) => p.adminGeneral}><AdminRecuperacion /></Protegida>} />
          <Route path="/admin/importacion" element={<Protegida permite={(p) => p.adminGeneral}><AdminImportacion /></Protegida>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
        </Marco>
      </BrowserRouter>
    </ProveedorSesion>
  );
}
