// Marco de la aplicación: barra lateral en escritorio y menú compacto en móvil.
// Solo MUESTRA los módulos que permite permisos.ts; el servidor decide qué se puede hacer.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useSesion } from '../contexto/Sesion.tsx';
import { ProveedorResumen, useResumen } from '../contexto/Resumen.tsx';
import { usePermisos } from '../permisos.ts';
import { ENTORNO } from '../config.ts';
import { Icono, useDialogoAccesible } from './UI.tsx';
import type { NombreIcono } from './UI.tsx';

interface ItemNav { a: string; texto: string; icono: NombreIcono; visible: boolean; n?: number; fin?: boolean }
interface GrupoNav { titulo: string; items: ItemNav[] }

const CONSULTA_MOVIL = '(max-width: 1023px)';

function useEsMovil(): boolean {
  const [movil, setMovil] = useState(() => window.matchMedia(CONSULTA_MOVIL).matches);
  useEffect(() => {
    const m = window.matchMedia(CONSULTA_MOVIL);
    const alCambiar = () => setMovil(m.matches);
    m.addEventListener('change', alCambiar);
    return () => m.removeEventListener('change', alCambiar);
  }, []);
  return movil;
}

function Contador({ n }: { n: number | undefined }) {
  if (!n || n <= 0) return null;
  return (
    <>
      <span className="contador-nav" aria-hidden="true">{n > 99 ? '99+' : n}</span>
      <span className="solo-lectores"> ({n} pendiente{n === 1 ? '' : 's'})</span>
    </>
  );
}

function Lateral({ abierto, alCerrar, esMovil }: { abierto: boolean; alCerrar: () => void; esMovil: boolean }) {
  const { perfil, salir } = useSesion();
  const p = usePermisos();
  const { resumen } = useResumen();
  const ref = useRef<HTMLElement>(null);
  useDialogoAccesible(abierto && esMovil, alCerrar, ref);

  const sinLeer = perfil?.notificaciones_sin_leer ?? 0;
  const grupos: GrupoNav[] = [
    { titulo: 'Mi trabajo', items: [
      { a: '/', texto: 'Inicio', icono: 'inicio', visible: true, fin: true },
      { a: '/mis-solicitudes', texto: 'Mis solicitudes', icono: 'documento', visible: p.solicitante, n: resumen?.mis_devueltas },
      { a: '/aprobacion-solicitudes', texto: 'Por aprobar', icono: 'aprobar', visible: p.jefe, n: resumen?.aprobaciones_jefe_mias },
      { a: '/notificaciones', texto: 'Notificaciones', icono: 'campana', visible: true, n: sinLeer }
    ] },
    { titulo: 'Compras y almacén', items: [
      { a: '/gestion', texto: 'Gestión de compras', icono: 'carrito', visible: p.gestor, n: resumen?.pendientes },
      { a: '/aprobaciones', texto: 'Aprobación de cotizaciones', icono: 'check-circulo', visible: p.aprobadorCotizacion, n: resumen?.por_aprobar },
      { a: '/almacen', texto: 'Almacén', icono: 'caja', visible: p.almacen || p.gestor, n: resumen?.pendientes_entrega },
      { a: '/compras-externas', texto: 'Compras externas', icono: 'camion', visible: p.gestor }
    ] },
    { titulo: 'Consulta', items: [
      { a: '/consulta', texto: 'Consulta global', icono: 'buscar', visible: p.consultaGlobal },
      { a: '/reportes', texto: 'Reportes', icono: 'grafico', visible: p.gestor || p.consultaGlobal }
    ] },
    { titulo: 'Sistema', items: [
      { a: p.adminUsuarios ? '/admin' : '/admin/estructura', texto: 'Administración', icono: 'engranaje',
        visible: p.adminUsuarios || p.adminCatalogos || p.adminGeneral }
    ] }
  ];

  return (
    <aside id="menu-principal" className={`lateral${abierto ? ' abierto' : ''}`} ref={ref} tabIndex={-1}
      role={abierto && esMovil ? 'dialog' : undefined} aria-modal={abierto && esMovil ? true : undefined}
      aria-label={abierto && esMovil ? 'Menú principal' : undefined}>
      <div className="lateral-marca">
        <Icono nombre="carrito" tam={20} /> <span>Compras Semanales</span>
        {esMovil ? <button type="button" className="boton-silencioso boton-icono" aria-label="Cerrar menú" onClick={alCerrar}><Icono nombre="x" /></button> : null}
      </div>
      <nav aria-label="Secciones">
        {grupos.map((g) => {
          const visibles = g.items.filter((i) => i.visible);
          if (visibles.length === 0) return null;
          return (
            <div key={g.titulo} className="nav-grupo">
              <p className="nav-titulo">{g.titulo}</p>
              <ul>
                {visibles.map((i) => (
                  <li key={i.a}>
                    <NavLink to={i.a} end={i.fin} className="nav-enlace">
                      <Icono nombre={i.icono} />
                      <span className="nav-texto">{i.texto}</span>
                      <Contador n={i.n} />
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>
      <div className="lateral-usuario">
        <p className="usuario-nombre">{perfil?.nombre}</p>
        {perfil?.area_nombre ? <p className="texto-suave">{perfil.area_nombre}</p> : null}
        <button type="button" className="boton-secundario" onClick={() => void salir()}><Icono nombre="salir" /> Salir</button>
      </div>
    </aside>
  );
}

/**
 * Estructura constante (para no reiniciar las páginas al cargar el perfil):
 * sin sesión activa solo se oculta el menú; el contenido se muestra igual.
 */
export function Marco({ children }: { children: ReactNode }) {
  const { perfil, sesion } = useSesion();
  const ubicacion = useLocation();
  const esMovil = useEsMovil();
  const [abierto, setAbierto] = useState(false);
  const activo = !!sesion && !!perfil && perfil.estado === 'activo';
  const sinLeer = perfil?.notificaciones_sin_leer ?? 0;

  useEffect(() => { setAbierto(false); }, [ubicacion.pathname]);
  useEffect(() => { if (!esMovil) setAbierto(false); }, [esMovil]);

  return (
    <ProveedorResumen>
      {activo ? <a className="saltar" href="#contenido-principal">Saltar al contenido</a> : null}
      {activo && ENTORNO === 'pruebas' ? <div className="banda-pruebas">ENTORNO DE PRUEBAS · datos ficticios · no es producción</div> : null}
      {activo && ENTORNO === 'vista_previa_real' ? <div className="banda-pruebas banda-real">VISTA PREVIA de la nueva versión conectada a la base REAL · lo que hagas aquí queda guardado</div> : null}
      <div className={`marco${activo ? '' : ' marco-sin-menu'}`}>
        {activo ? (
          <>
            <header className="barra-movil">
              <button type="button" className="boton-secundario boton-icono" aria-label="Abrir menú" aria-expanded={abierto}
                aria-controls="menu-principal" onClick={() => setAbierto(true)}><Icono nombre="menu" tam={20} /></button>
              <span className="barra-marca">Compras Semanales</span>
              <NavLink to="/notificaciones" className="campana" aria-label={`Notificaciones: ${sinLeer} sin leer`}>
                <Icono nombre="campana" tam={20} />
                {sinLeer > 0 ? <span className="contador-nav">{sinLeer > 99 ? '99+' : sinLeer}</span> : null}
              </NavLink>
            </header>
            {esMovil && abierto ? <div className="lateral-fondo" onClick={() => setAbierto(false)} aria-hidden="true" /> : null}
            <Lateral abierto={abierto} alCerrar={() => setAbierto(false)} esMovil={esMovil} />
          </>
        ) : null}
        <main id="contenido-principal" className="marco-principal" tabIndex={-1}>{children}</main>
      </div>
    </ProveedorResumen>
  );
}
