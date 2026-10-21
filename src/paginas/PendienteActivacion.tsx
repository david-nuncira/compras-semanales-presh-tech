import { Navigate } from 'react-router-dom';
import { useSesion } from '../contexto/Sesion.tsx';
import { Cargando } from '../componentes/UI.tsx';

export function PendienteActivacion() {
  const { sesion, perfil, cargando, esActivo, salir, recargarPerfil } = useSesion();
  if (cargando) return <div className="contenido"><Cargando /></div>;
  if (!sesion) return <Navigate to="/acceso" replace />;
  if (esActivo) return <Navigate to="/" replace />;

  const estado = perfil?.estado ?? 'pendiente';
  return (
    <div className="acceso">
      <p className="marca-grande">🛒 Compras Semanales Presh Tech</p>
      {estado === 'pendiente' ? (
        <>
          <h2>Cuenta pendiente de activación</h2>
          <p>
            Tu registro fue recibido. Un administrador debe <b>verificar tu identidad
            por un canal corporativo</b> (por ejemplo, llamada o chat interno) y
            activar tu cuenta con los permisos que te correspondan.
          </p>
          <p className="texto-suave">
            Mientras tanto no tienes acceso a solicitudes, reportes ni archivos.
            Esta pantalla se actualiza sola cuando te activen.
          </p>
        </>
      ) : (
        <>
          <h2>Cuenta {estado === 'desactivado' ? 'desactivada' : 'rechazada'}</h2>
          <p>El acceso a la aplicación está bloqueado. Si crees que es un error, contacta al administrador por un canal corporativo.</p>
        </>
      )}
      <div className="acciones-fila">
        <button type="button" className="boton-secundario" onClick={() => void recargarPerfil()}>Volver a comprobar</button>
        <button type="button" className="boton-secundario" onClick={() => void salir()}>Salir</button>
      </div>
    </div>
  );
}
