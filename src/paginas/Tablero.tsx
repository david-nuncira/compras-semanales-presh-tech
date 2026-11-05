import { useMemo, useState } from 'react';
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
interface Accion { icono: string; titulo: string; detalle: string; enlace: string; etiqueta: string; cantidad?: number; }

function Ficha({ n, texto, enlace }: { n: number | undefined; texto: string; enlace?: string }) {
  const contenido = <><b>{n ?? 0}</b><span>{texto}</span></>;
  return <div className="ficha">{enlace ? <Link to={enlace}>{contenido}</Link> : contenido}</div>;
}

function AccionRapida({ accion }: { accion: Accion }) {
  return <Link className="accion-rapida" to={accion.enlace}>
    <span className="accion-icono" aria-hidden="true">{accion.icono}</span>
    <span className="accion-contenido"><strong>{accion.titulo}{accion.cantidad !== undefined ? <em>{accion.cantidad}</em> : null}</strong><span>{accion.detalle}</span><small>{accion.etiqueta} →</small></span>
  </Link>;
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

  const acciones = useMemo<Accion[]>(() => {
    if (!r) return [];
    const lista: Accion[] = [];
    if (p.solicitante) lista.push({ icono: '+', titulo: 'Crear o revisar una solicitud', detalle: r.mis_devueltas ? `${r.mis_devueltas} devuelta(s) necesita(n) corrección.` : 'Empieza con un borrador. Nada se envía hasta que tú lo confirmes.', enlace: '/mis-solicitudes', etiqueta: 'Mis solicitudes', cantidad: r.mis_devueltas || undefined });
    if (p.jefe) lista.push({ icono: '✓', titulo: 'Aprobar solicitudes del equipo', detalle: r.aprobaciones_jefe_mias ? 'Revisa la necesidad antes de que llegue a Compras.' : 'No tienes solicitudes esperando ahora.', enlace: '/aprobacion-solicitudes', etiqueta: 'Ver aprobaciones', cantidad: r.aprobaciones_jefe_mias || undefined });
    if (p.gestor) lista.push({ icono: '◌', titulo: 'Gestionar compras', detalle: r.pendientes ? 'Cotiza, compara y da seguimiento a las solicitudes ya aprobadas.' : 'No hay artículos pendientes de gestión.', enlace: '/gestion', etiqueta: 'Abrir gestión', cantidad: r.pendientes || undefined });
    if (p.aprobadorCotizacion) lista.push({ icono: '$', titulo: 'Decidir cotizaciones', detalle: r.por_aprobar ? 'Hay decisiones de cotización o gasto esperando tu revisión.' : 'No hay cotizaciones pendientes.', enlace: '/aprobaciones', etiqueta: 'Ver cotizaciones', cantidad: r.por_aprobar || undefined });
    if (p.almacen) lista.push({ icono: '□', titulo: 'Registrar entradas y entregas', detalle: r.pendientes_entrega ? 'Hay entregas por confirmar.' : 'Consulta lo que está por llegar o disponible.', enlace: '/almacen', etiqueta: 'Abrir almacén', cantidad: r.pendientes_entrega || undefined });
    if (p.adminUsuarios || p.adminCatalogos) lista.push({ icono: '⌁', titulo: 'Administrar personas y estructura', detalle: 'Activa cuentas, revisa jefaturas y mantiene los catálogos al día.', enlace: p.adminGeneral ? '/admin/organigrama' : '/admin', etiqueta: 'Ir a administración' });
    return lista;
  }, [r, p]);

  const prioridad = useMemo<Accion | null>(() => {
    if (!r) return null;
    if (p.solicitante && (r.mis_devueltas ?? 0) > 0) return { icono: '↩', titulo: 'Tienes una solicitud devuelta para corregir', detalle: 'Ábrela, revisa el comentario y envíala otra vez cuando esté lista.', enlace: '/mis-solicitudes', etiqueta: 'Corregir ahora', cantidad: r.mis_devueltas };
    if (p.jefe && (r.aprobaciones_jefe_mias ?? 0) > 0) return { icono: '✓', titulo: 'Tienes solicitudes esperando tu aprobación', detalle: 'Tu decisión permite que Compras continúe con el proceso.', enlace: '/aprobacion-solicitudes', etiqueta: 'Revisar ahora', cantidad: r.aprobaciones_jefe_mias };
    if (p.gestor && r.pendientes > 0) return { icono: '◌', titulo: 'Hay artículos listos para gestión de Compras', detalle: 'Puedes cotizar o registrar una compra directa cuando aplique.', enlace: '/gestion', etiqueta: 'Ir a gestión', cantidad: r.pendientes };
    if (p.aprobadorCotizacion && r.por_aprobar > 0) return { icono: '$', titulo: 'Hay cotizaciones esperando decisión', detalle: 'Revisa el valor y los documentos adjuntos antes de aprobar o rechazar.', enlace: '/aprobaciones', etiqueta: 'Revisar cotizaciones', cantidad: r.por_aprobar };
    if (p.solicitante) return { icono: '+', titulo: '¿Necesitas algo para tu área?', detalle: 'Crea un borrador, agrega los artículos y envíalo cuando esté completo.', enlace: '/mis-solicitudes', etiqueta: 'Crear solicitud' };
    return null;
  }, [r, p]);

  return <div className="contenido">
    <section className="bienvenida">
      <div><span className="sobre-titulo">TU ESPACIO DE TRABAJO</span><h1>Hola, {perfil?.nombre?.split(' ')[0] ?? 'bienvenido'}</h1><p>Elige una tarea y el sistema te mostrará solo lo que necesitas hacer.</p></div>
      <span className="bienvenida-actualizacion">{hora ? `Actualizado ${hora}` : 'Preparando tu resumen…'}</span>
    </section>

    {!r ? <Cargando texto="Preparando tus tareas pendientes…" /> : <>
      {prioridad ? <section className="accion-destacada" aria-label="Tarea principal">
        <span className="accion-destacada-icono" aria-hidden="true">{prioridad.icono}</span>
        <div><span className="sobre-titulo">LO MÁS IMPORTANTE AHORA</span><h2>{prioridad.titulo}</h2><p>{prioridad.detalle}</p></div>
        <Link className="boton-primario enlace-boton" to={prioridad.enlace}>{prioridad.etiqueta}{prioridad.cantidad ? ` (${prioridad.cantidad})` : ''}</Link>
      </section> : null}

      {acciones.length > 0 ? <section aria-labelledby="acciones-titulo"><div className="seccion-cabecera"><div><span className="sobre-titulo">ACCESOS RÁPIDOS</span><h2 id="acciones-titulo">¿Qué quieres hacer?</h2></div></div><div className="acciones-rapidas">{acciones.map((accion) => <AccionRapida key={accion.titulo} accion={accion} />)}</div></section> : null}

      {p.solicitante ? <section className="tarjeta guia-solicitud"><div className="seccion-cabecera"><div><span className="sobre-titulo">GUÍA RÁPIDA</span><h2>Así avanza una compra</h2></div><Link to="/mis-solicitudes">Ver mis solicitudes →</Link></div>
        <ol className="pasos-solicitud"><li><span>1</span><div><b>Armas el borrador</b><p>Indicas el centro de costo y agregas los artículos. Aún no llega a nadie.</p></div></li><li><span>2</span><div><b>Tu jefe revisa</b><p>Cuando la envías, primero la recibe el jefe de tu área.</p></div></li><li><span>3</span><div><b>Compras continúa</b><p>Tras la aprobación, Compras cotiza o realiza la compra y te mantiene informado.</p></div></li></ol>
      </section> : null}

      {p.solicitante ? <section className="tarjeta resumen-simple"><div className="seccion-cabecera"><div><span className="sobre-titulo">SEGUIMIENTO</span><h2>Mis solicitudes</h2></div><Link to="/mis-solicitudes">Ver todas →</Link></div><div className="tablero"><Ficha n={r.mis_devueltas} texto="devueltas para corregir" enlace="/mis-solicitudes" /></div></section> : null}
      {p.jefe ? <section className="tarjeta resumen-simple"><div className="seccion-cabecera"><div><span className="sobre-titulo">APROBACIONES</span><h2>Solicitudes del equipo</h2></div><Link to="/aprobacion-solicitudes">Ver pendientes →</Link></div><div className="tablero"><Ficha n={r.aprobaciones_jefe_mias} texto="pendientes de mi aprobación" enlace="/aprobacion-solicitudes" /></div></section> : null}
      {(p.consultaGlobal || p.gestor) ? <section className="tarjeta resumen-simple"><div className="seccion-cabecera"><div><span className="sobre-titulo">OPERACIÓN</span><h2>Resumen de Compras</h2></div>{p.gestor ? <Link to="/gestion">Abrir gestión →</Link> : null}</div><div className="tablero">
        {p.consultaGlobal ? <Ficha n={r.pendientes_aprobacion} texto="aún esperando aprobación" enlace="/consulta" /> : null}
        {p.consultaGlobal ? <Ficha n={r.programadas} texto="programadas para próximos ciclos" enlace="/consulta" /> : null}
        <Ficha n={r.pendientes} texto="artículos pendientes de gestión" enlace={p.gestor ? '/gestion' : undefined} />
        <Ficha n={r.por_aprobar} texto="cotizaciones por decidir" enlace={p.aprobadorCotizacion ? '/aprobaciones' : undefined} />
        <Ficha n={r.atrasados} texto="compras atrasadas" />
        <Ficha n={r.novedades_abiertas} texto="novedades abiertas" />
      </div></section> : null}
      {(p.almacen || p.gestor || p.consultaGlobal) ? <section className="tarjeta resumen-simple"><div className="seccion-cabecera"><div><span className="sobre-titulo">ALMACÉN</span><h2>Entradas y entregas</h2></div><Link to="/almacen">Abrir almacén →</Link></div><div className="tablero"><Ficha n={r.por_llegar} texto="compras por llegar" enlace="/almacen" /><Ficha n={r.en_almacen} texto="con saldo disponible" enlace="/almacen" /><Ficha n={r.pendientes_entrega} texto="pendientes de entrega" enlace="/almacen" /><Ficha n={r.entregados} texto="con entregas registradas" /></div></section> : null}
    </>}

    {veIndicadores ? <section className="tarjeta indicadores"><div className="seccion-cabecera"><div><span className="sobre-titulo">INDICADORES</span><h2>Vista de operación</h2><p className="texto-suave">Usa estas cifras para revisar el proceso, no para realizar acciones urgentes.</p></div></div>
      <div className="filtros"><Campo etiqueta="Desde"><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></Campo><Campo etiqueta="Hasta"><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></Campo></div>
      {!ind ? <Cargando /> : <><div className="tablero"><Ficha n={ind.solicitudes_enviadas} texto="solicitudes enviadas" /><div className="ficha"><b>{ind.anticipacion_promedio_dias ?? '—'}</b><span>días de anticipación promedio</span><small className="texto-suave">{ind.anticipacion_con_dato} con fecha requerida</small></div><div className="ficha"><b>{horasATexto(ind.horas_envio_aprobacion)}</b><span>envío → aprobación</span></div><div className="ficha"><b>{horasATexto(ind.horas_aprobacion_recepcion)}</b><span>aprobación → Compras</span></div><div className="ficha"><b>{horasATexto(ind.horas_recepcion_compra)}</b><span>Compras → compra</span></div><div className="ficha"><b>{ind.extraordinarias}</b><span>extraordinarias · {fmtMoneda(ind.extraordinarias_total_cop, 'COP')}</span></div></div>
        {ind.extraordinarias_por_area.length > 0 ? <><h3>Extraordinarias por área</h3><div className="tabla-envoltura"><table className="tabla"><thead><tr><th>Área</th><th className="numero">Cantidad</th><th className="numero">Gasto COP</th></tr></thead><tbody>{ind.extraordinarias_por_area.map((x) => <tr key={x.area}><td>{x.area}</td><td className="numero">{x.n}</td><td className="numero">{fmtMoneda(x.total_cop, 'COP')}</td></tr>)}</tbody></table></div></> : null}
        <h3>Gasto comprado por área y centro de costo</h3>{ind.gasto_por_area_cc.length === 0 ? <p className="texto-suave">Sin compras en el período.</p> : <div className="tabla-envoltura"><table className="tabla"><thead><tr><th>Área</th><th>Centro de costo</th><th>Moneda</th><th className="numero">Total</th></tr></thead><tbody>{ind.gasto_por_area_cc.map((g, i) => <tr key={i}><td>{g.area ?? 'Sin área'}</td><td>{g.cc ?? '—'}</td><td>{g.moneda}</td><td className="numero">{fmtMoneda(g.total, g.moneda)}</td></tr>)}</tbody></table></div>}
        <p><Link to="/reportes">Ver el detalle en Reportes →</Link></p>
      </>}
    </section> : null}
  </div>;
}
