// Permisos derivados para MOSTRAR u OCULTAR secciones.
// La autorización real siempre ocurre en el servidor (RLS y funciones).
import { useSesion } from './contexto/Sesion.tsx';

export interface Permisos {
  adminGeneral: boolean;
  adminUsuarios: boolean;
  adminCatalogos: boolean;
  consultaGlobal: boolean;
  compras: boolean;
  gestor: boolean;        // compras o administrador general (acciones operativas)
  almacen: boolean;
  aprobadorCotizacion: boolean;
  jefe: boolean;          // jefe de área, ruta superior o con aprobaciones asignadas
  solicitante: boolean;
  emergencias: boolean;
}

export function usePermisos(): Permisos {
  const { perfil, tiene } = useSesion();
  const admin = tiene('administrador');
  return {
    adminGeneral: admin,
    adminUsuarios: admin || tiene('admin_usuarios'),
    adminCatalogos: admin || tiene('admin_catalogos'),
    consultaGlobal: admin || tiene('consulta_global'),
    compras: tiene('compras'),
    gestor: admin || tiene('compras'),
    almacen: tiene('almacen'),
    aprobadorCotizacion: tiene('aprobador'),
    jefe: !!perfil && perfil.estado === 'activo' && !!perfil.es_jefe,
    solicitante: tiene('solicitante'),
    emergencias: tiene('emergencias')
  };
}
