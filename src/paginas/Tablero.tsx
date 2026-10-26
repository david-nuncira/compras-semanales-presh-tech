import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabase.ts';
import { useSesion } from '../contexto/Sesion.tsx';
import { usePermisos } from '../permisos.ts';
import { useActualizacionPeriodica } from '../datos.ts';
import { Cargando, Campo } from '../componentes/UI.tsx';
import { fmtMoneda } from '../util/moneda.ts';
import { hoyBogotaISO, sumarDias } from '../util/fechas.ts';

interface Resumen {
  pendientes: number; por_aprobar: number; atrasados: number; por_llegar: number;
  en_almacen: number; entregados: number; novedades_abiertas: number;
  aprobaciones_jefe_mias?: number; pendientes_aprobacion?: number; programadas?: number;
  pendientes_entrega?: number; mis_devueltas?: number;
}
interface Indicadores {
  solicitudes_enviadas: number; anticipacion_promedio_dias: number | null; anticipacion_con_dato: number;
  horas_envio_aprobacion: number | null; horas_aprobacion_recepcion: number | null; horas_recepcion_compra: number | null;
  extraordinarias: number; extraordinarias_total_cop: number;
  extraordinarias_por_area: Array<{ area: string; n: number; total_cop: number }>;
  gasto_por_area_cc: Array<{ area: string | null; cc: string | null; moneda: string; total: number }>;
}

function Ficha({ n, texto, enlace }: { n: number | undefined; texto: string; enlace?: string }) {
  const contenido = <><b>{n ?? 0}</b> {texto}</>;
  return <div className="ficha">{enlace ? <Link to={enlace}>{contenido}</Link> : contenido}</div>;
}

function horasATexto(h: number | null): string {
  if (h === null || h === undefined) return 'sin información';
  return h >= 48 ? `${(h / 24).toFixed(1)} días` : `${h.toFixed(1)} h`;
}

export function Tablero() {
  const { perfil } = useSesion();
  const p = usePermisos();
  const [r, setR] = useState<Resumen | null>(null);
  const [ind, setInd] = useState<Indicadores | null>(null);
  const [hora, setHora] = useState('');
  const [desde, setDesde] = useState(sumarDias(hoyBogotaISO(), -90));
  const [hasta, setHasta] = useState(hoyBogotaISO());
  const veIndicadores = p.consultaGlobal || p.gestor;

  useActualizacionPeriodica(async () => {
    const { data, error } = await supabase.rpc('fn_resumen_tablero');
    if (!error && data) {
      setR(data as Resumen);
      setHora(new Date().toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' }));
    }
    if (veIndicadores) {
      const { data: di } = await supabase.rpc('fn_indicadores', { p_desde: desde, p_hasta: hasta });
      if (di) setInd(di as Indicadores);
    }
  }, 60000, [desde, hasta, veIndicadores]);

  return (
    <div className="contenido">
      <h1>Hola, {perfil?.nombre}</h1>
      <p className="texto-suave">Indicadores sobre lo que tu cuenta puede ver{hora ? ` · actualizado ${hora}` : ''}.</p>
      {!r ? <Cargando /> : (
        <>
          {p.solicitante ? (
            <div className="tarjeta">
              <h2>Mis solicitudes</h2>
              <div className="tablero">
                <Ficha n={r.mis_devueltas} texto="devueltas para corregir" enlace="/mis-solicitudes" />
              </div>
              <p><Link to="/mis-solicitudes">Ir a Mis solicitudes →</Link></p>
            </div>
          ) : null}
          {p.jefe ? (
            <div className="tarjeta">
              <h2>Aprobación de jefe</h2>
              <div className="tablero">
                <Ficha n={r.aprobaciones_jefe_mias} texto="pendientes de mi aprobación" enlace="/aprobacion-solicitudes" />
              </div>
            </div>
          ) : null}
          {(p.consultaGlobal || p.gestor) ? (
            <div className="tarjeta">
              <h2>Operación de compras</h2>
              <div className="tablero">
                {p.consultaGlobal ? <Ficha n={r.pendientes_aprobacion} texto="pendientes de aprobación (aún no son de Compras)" enlace="/consulta" /> : null}
                {p.consultaGlobal ? <Ficha n={r.programadas} texto="programadas para próximos ciclos" enlace="/consulta" /> : null}
                <Ficha n={r.pendientes} texto="artículos pendientes de gestión" enlace={p.gestor ? '/gestion' : undefined} />
                <Ficha n={r.por_aprobar} texto="esperan aprobación de cotización/gasto" />
                <Ficha n={r.atrasados} texto="atrasados" />
                <Ficha n={r.por_llegar} texto="compras por llegar" />
                <Ficha n={r.novedades_abiertas} texto="novedades abiertas" />
              </div>
            </div>
          ) : null}
          {(p.almacen || p.gestor || p.consultaGlobal) ? (
            <div className="tarjeta">
              <h2>Almacén</h2>
              <div className="tablero">
                <Ficha n={r.por_llegar} texto="por llegar" enlace="/almacen" />
                <Ficha n={r.en_almacen} texto="con saldo disponible" enlace="/almacen" />
                <Ficha n={r.pendientes_entrega} texto="pendientes de entrega" enlace="/almacen" />
                <Ficha n={r.entregados} texto="con entregas" />
              </div>
            </div>
          ) : null}
        </>
      )}

      {veIndicadores ? (
        <div className="tarjeta">
          <h2>Indicadores del período</h2>
          <div className="filtros">
            <Campo etiqueta="Desde"><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></Campo>
            <Campo etiqueta="Hasta"><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></Campo>
          </div>
          {!ind ? <Cargando /> : (
            <>
              <div className="tablero">
                <div className="ficha"><b>{ind.solicitudes_enviadas}</b> solicitudes enviadas</div>
                <div className="ficha"><b>{ind.anticipacion_promedio_dias ?? '—'}</b> días de anticipación promedio
                  <div className="texto-suave">({ind.anticipacion_con_dato} con fecha requerida)</div></div>
                <div className="ficha"><b>{horasATexto(ind.horas_envio_aprobacion)}</b> envío → aprobación</div>
                <div className="ficha"><b>{horasATexto(ind.horas_aprobacion_recepcion)}</b> aprobación → recepción Compras</div>
                <div className="ficha"><b>{horasATexto(ind.horas_recepcion_compra)}</b> recepción Compras → compra</div>
                <div className="ficha"><b>{ind.extraordinarias}</b> extraordinarias · {fmtMoneda(ind.extraordinarias_total_cop, 'COP')}</div>
              </div>
              <p className="texto-suave">
                Anticipación = días entre la creación real de la solicitud y su fecha requerida. Los tiempos de
                Compras se miden desde la recepción efectiva, no desde la creación.
              </p>
              {ind.extraordinarias_por_area.length > 0 ? (
                <>
                  <h3>Extraordinarias por área</h3>
                  <table className="tabla"><thead><tr><th>Área</th><th className="numero">Cantidad</th><th className="numero">Gasto COP</th></tr></thead>
                    <tbody>{ind.extraordinarias_por_area.map((x) => (
                      <tr key={x.area}><td>{x.area}</td><td className="numero">{x.n}</td><td className="numero">{fmtMoneda(x.total_cop, 'COP')}</td></tr>
                    ))}</tbody></table>
                </>
              ) : null}
              <h3>Gasto comprado por área y centro de costo</h3>
              {ind.gasto_por_area_cc.length === 0 ? <p className="texto-suave">Sin compras en el período.</p> : (
                <div className="tabla-envoltura">
                  <table className="tabla"><thead><tr><th>Área</th><th>Centro de costo</th><th>Moneda</th><th className="numero">Total</th></tr></thead>
                    <tbody>{ind.gasto_por_area_cc.map((g, i) => (
                      <tr key={i}><td>{g.area ?? 'Sin área'}</td><td>{g.cc ?? '—'}</td><td>{g.moneda}</td><td className="numero">{fmtMoneda(g.total, g.moneda)}</td></tr>
                    ))}</tbody></table>
                </div>
              )}
              <p><Link to="/reportes">Más detalle en Reportes →</Link></p>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
