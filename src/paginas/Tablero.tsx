import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabase.ts';
import { useSesion } from '../contexto/Sesion.tsx';
import { useActualizacionPeriodica } from '../datos.ts';
import { Cargando } from '../componentes/UI.tsx';

interface Resumen {
  pendientes: number; por_aprobar: number; atrasados: number;
  por_llegar: number; en_almacen: number; entregados: number;
  novedades_abiertas: number;
}

export function Tablero() {
  const { perfil, tiene } = useSesion();
  const [r, setR] = useState<Resumen | null>(null);
  const [hora, setHora] = useState<string>('');

  useActualizacionPeriodica(async () => {
    const { data, error } = await supabase.rpc('fn_resumen_tablero');
    if (!error && data) {
      setR(data as Resumen);
      setHora(new Date().toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' }));
    }
  }, 60000, []);

  return (
    <div className="contenido">
      <h1>Hola, {perfil?.nombre}</h1>
      <p className="texto-suave">
        Resumen sobre todo lo que tu cuenta puede ver{hora ? ` · actualizado ${hora}` : ''}.
      </p>
      {!r ? <Cargando /> : (
        <div className="tablero">
          <div className="ficha"><b>{r.pendientes}</b> pendientes de gestión</div>
          <div className="ficha"><b>{r.por_aprobar}</b> por aprobar</div>
          <div className="ficha"><b>{r.atrasados}</b> atrasados</div>
          <div className="ficha"><b>{r.por_llegar}</b> por llegar</div>
          <div className="ficha"><b>{r.en_almacen}</b> con saldo en almacén</div>
          <div className="ficha"><b>{r.entregados}</b> con entregas</div>
          <div className="ficha"><b>{r.novedades_abiertas}</b> novedades abiertas</div>
        </div>
      )}
      <div className="tarjeta">
        <h2>Accesos rápidos</h2>
        <div className="acciones-fila">
          {tiene('solicitante') ? <Link to="/mis-solicitudes">Mis solicitudes</Link> : null}
          {(tiene('compras') || tiene('administrador')) ? <Link to="/gestion">Gestión de compras</Link> : null}
          {tiene('aprobador') ? <Link to="/aprobaciones">Aprobaciones</Link> : null}
          {(tiene('almacen') || tiene('compras') || tiene('administrador')) ? <Link to="/almacen">Almacén</Link> : null}
          {(tiene('compras') || tiene('administrador')) ? <Link to="/reportes">Reportes</Link> : null}
          {tiene('administrador') ? <Link to="/admin">Administración</Link> : null}
        </div>
      </div>
    </div>
  );
}
