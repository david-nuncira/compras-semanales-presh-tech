import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useSesion } from '../contexto/Sesion.tsx';
import { usePermisos } from '../permisos.ts';
import { useResumen } from '../contexto/Resumen.tsx';
import { EstadoVacio, EstadoError, Esqueleto, Icono, Ayuda } from '../componentes/UI.tsx';
import { PanelAnalitico } from '../componentes/PanelAnalitico.tsx';

interface Accion { icono: string; titulo: string; detalle: string; enlace: string; etiqueta: string; cantidad?: number; }
interface Tarea { n: number | null | undefined; texto: string; enlace: string }
/** Ficha con su ícono «i»: explica qué cuenta (el número viene de fn_resumen_tablero). */
function Ficha({ n, texto, enlace, ayuda }: { n: number | undefined; texto: string; enlace?: string; ayuda: string }) {
  const contenido = <><b>{n ?? 0}</b> {texto}</>;
  return <div className="ficha">{enlace ? <Link to={enlace}>{contenido}</Link> : contenido}<Ayuda etiqueta={texto}>{ayuda}</Ayuda></div>;
}

export function Tablero() {
  const { perfil } = useSesion();
  const p = usePermisos();
  const { resumen: r, sinCotizar, paraRecoger, hora, error: errorResumen, recargar } = useResumen();
  const veIndicadores = p.consultaGlobal || p.gestor;

  // «Lo que tienes que hacer hoy», solo con datos que ya existen (fn_resumen_tablero y v_articulos).
  const tareas: Tarea[] = [];
  if (r) {
    if (p.solicitante) {
      tareas.push({ n: r.mis_devueltas, texto: 'solicitudes devueltas para corregir', enlace: '/mis-solicitudes?bandeja=devueltas' });
      tareas.push({ n: paraRecoger, texto: 'artículos con saldo en almacén para recoger', enlace: '/mis-solicitudes' });
    }
    if (p.jefe) tareas.push({ n: r.aprobaciones_jefe_mias, texto: 'solicitudes por aprobar', enlace: '/aprobacion-solicitudes' });
    if (p.gestor) {
      tareas.push({ n: sinCotizar, texto: 'artículos recibidos sin cotizar', enlace: '/gestion?etapa=solicitado' });
      tareas.push({ n: r.atrasados, texto: 'artículos atrasados', enlace: '/gestion?atrasados=1' });
      tareas.push({ n: r.por_llegar, texto: 'compras por llegar', enlace: '/almacen' });
    }
    if (p.aprobadorCotizacion) tareas.push({ n: r.por_aprobar, texto: 'cotizaciones o gastos por aprobar', enlace: '/aprobaciones' });
    if (p.almacen) tareas.push({ n: r.pendientes_entrega, texto: 'artículos pendientes de entrega', enlace: '/almacen' });
  }
  const pendientesHoy = tareas.filter((t) => (t.n ?? 0) > 0);

  // Tarea principal del momento (de la experiencia guiada).
  const prioridad = useMemo<Accion | null>(() => {
    if (!r) return null;
    if (p.solicitante && (r.mis_devueltas ?? 0) > 0) return { icono: '↩', titulo: 'Tienes una solicitud devuelta para corregir', detalle: 'Ábrela, revisa el comentario y envíala otra vez cuando esté lista.', enlace: '/mis-solicitudes', etiqueta: 'Corregir ahora', cantidad: r.mis_devueltas };
    if (p.jefe && (r.aprobaciones_jefe_mias ?? 0) > 0) return { icono: '✓', titulo: 'Tienes solicitudes esperando tu aprobación', detalle: 'Tu decisión permite que Compras continúe con el proceso.', enlace: '/aprobacion-solicitudes', etiqueta: 'Revisar ahora', cantidad: r.aprobaciones_jefe_mias };
    if (p.gestor && r.pendientes > 0) return { icono: '◌', titulo: 'Hay artículos listos para gestión de Compras', detalle: 'Puedes cotizar o registrar una compra directa cuando aplique.', enlace: '/gestion', etiqueta: 'Ir a gestión', cantidad: r.pendientes };
    if (p.aprobadorCotizacion && r.por_aprobar > 0) return { icono: '$', titulo: 'Hay cotizaciones esperando decisión', detalle: 'Revisa el valor y los documentos adjuntos antes de aprobar o rechazar.', enlace: '/aprobaciones', etiqueta: 'Revisar cotizaciones', cantidad: r.por_aprobar };
    if (p.solicitante) return { icono: '+', titulo: '¿Necesitas algo para tu área?', detalle: 'Crea un borrador, agrega los artículos y envíalo cuando esté completo.', enlace: '/mis-solicitudes', etiqueta: 'Crear solicitud' };
    return null;
  }, [r, p]);

  return (
    <div className="contenido">
      <section className="bienvenida">
        <div><span className="sobre-titulo">TU ESPACIO DE TRABAJO</span><h1>Hola, {perfil?.nombre?.split(' ')[0] ?? 'bienvenido'}</h1><p>Elige una tarea y el sistema te mostrará solo lo que necesitas hacer.</p></div>
        <span className="bienvenida-actualizacion">{hora ? `Actualizado ${hora}` : 'Preparando tu resumen…'}</span>
      </section>
      {prioridad ? (
        <section className="accion-destacada" aria-label="Tarea principal">
          <span className="accion-destacada-icono" aria-hidden="true">{prioridad.icono}</span>
          <div><span className="sobre-titulo">LO MÁS IMPORTANTE AHORA</span><h2>{prioridad.titulo}</h2><p>{prioridad.detalle}</p></div>
          <Link className="boton-primario enlace-boton" to={prioridad.enlace}>{prioridad.etiqueta}{prioridad.cantidad ? ` (${prioridad.cantidad})` : ''}</Link>
        </section>
      ) : null}
      <p className="texto-suave">Estas fichas muestran el estado actual de lo que tu cuenta puede ver y no dependen de los filtros del panel de compras.</p>
      <p className="guia-paso"><Icono nombre="info" /> <span><b>¿Primera vez o con dudas?</b> Mira la <Link to="/ayuda">guía paso a paso</Link>: explica qué hace cada persona y cómo avanza un pedido.</span></p>
      <section className="tarjeta" aria-labelledby="hoy-titulo">
        <h2 id="hoy-titulo">Lo que tienes que hacer hoy</h2>
        {errorResumen && !r ? <EstadoError mensaje={errorResumen} alReintentar={() => void recargar()} />
          : !r ? <Esqueleto lineas={3} />
          : pendientesHoy.length === 0 ? (
            <EstadoVacio titulo="Estás al día" texto="No tienes tareas pendientes en este momento."
              accion={p.solicitante ? <Link className="boton-primario enlace-boton" to="/mis-solicitudes">Ir a Mis solicitudes</Link> : undefined} />
          ) : (
            <ul className="lista-tareas">
              {pendientesHoy.map((t) => (
                <li key={t.enlace + t.texto}><Link to={t.enlace}><b>{t.n}</b> <span>{t.texto}</span> <Icono nombre="flecha" /></Link></li>
              ))}
            </ul>
          )}
      </section>
      {!r ? null : (
        <>
      {p.solicitante ? <section className="tarjeta guia-solicitud"><div className="seccion-cabecera"><div><span className="sobre-titulo">GUÍA RÁPIDA</span><h2>Así avanza una compra</h2></div><Link to="/mis-solicitudes">Ver mis solicitudes →</Link></div>
          <ol className="pasos-solicitud"><li><span>1</span><div><b>Armas el borrador</b><p>Indicas el centro de costo y agregas los artículos. Aún no llega a nadie.</p></div></li><li><span>2</span><div><b>Tu jefe revisa</b><p>Cuando la envías, primero la recibe el jefe de tu área.</p></div></li><li><span>3</span><div><b>Compras continúa</b><p>Tras la aprobación, Compras cotiza o realiza la compra y te mantiene informado.</p></div></li></ol>
        </section> : null}
            {p.solicitante ? (
            <div className="tarjeta">
              <h2>Mis solicitudes</h2>
              <div className="tablero">
                <Ficha n={r.mis_devueltas} texto="devueltas para corregir" enlace="/mis-solicitudes" ayuda="Tus solicitudes que el jefe o Compras devolvieron para que las corrijas y reenvíes." />
              </div>
              <p><Link to="/mis-solicitudes">Ir a Mis solicitudes →</Link></p>
            </div>
          ) : null}
          {p.jefe ? (
            <div className="tarjeta">
              <h2>Aprobación de jefe</h2>
              <div className="tablero">
                <Ficha n={r.aprobaciones_jefe_mias} texto="pendientes de mi aprobación" enlace="/aprobacion-solicitudes" ayuda="Solicitudes que esperan tu decisión como jefe de área (o ruta superior)." />
              </div>
            </div>
          ) : null}
          {(p.consultaGlobal || p.gestor) ? (
            <div className="tarjeta">
              <h2>Operación de compras</h2>
              <div className="tablero">
                {p.consultaGlobal ? <Ficha n={r.pendientes_aprobacion} texto="pendientes de aprobación (aún no son de Compras)" enlace="/consulta" ayuda="Solicitudes enviadas que aún esperan la decisión del jefe; todavía no llegan a Compras." /> : null}
                {p.consultaGlobal ? <Ficha n={r.programadas} texto="programadas para próximos ciclos" enlace="/consulta" ayuda="Solicitudes aprobadas que Compras recibirá en su próxima fecha de recepción." /> : null}
                <Ficha n={r.pendientes} texto="artículos pendientes de gestión" enlace={p.gestor ? '/gestion' : undefined} ayuda="Artículos en la bandeja de Compras que están sin cotizar, en cotización o cotizados." />
                <Ficha n={r.por_aprobar} texto="esperan aprobación de cotización/gasto" ayuda="Artículos cuya aprobación de cotización o gasto está pendiente." />
                <Ficha n={r.atrasados} texto="atrasados" ayuda="Artículos con días de atraso mayores que cero respecto de la llegada estimada." />
                <Ficha n={r.por_llegar} texto="compras por llegar" ayuda="Artículos comprados que están en tránsito o con recepción parcial." />
                <Ficha n={r.novedades_abiertas} texto="novedades abiertas" ayuda="Novedades reportadas sobre artículos que todavía no se resuelven." />
              </div>
            </div>
          ) : null}
          {(p.almacen || p.gestor || p.consultaGlobal) ? (
            <div className="tarjeta">
              <h2>Almacén</h2>
              <div className="tablero">
                <Ficha n={r.por_llegar} texto="por llegar" enlace="/almacen" ayuda="Artículos comprados que aún no han llegado completos al almacén." />
                <Ficha n={r.en_almacen} texto="con saldo disponible" enlace="/almacen" ayuda="Artículos con unidades disponibles en almacén (recibidas menos entregadas)." />
                <Ficha n={r.pendientes_entrega} texto="pendientes de entrega" enlace="/almacen" ayuda="Artículos con saldo en almacén que todavía no se entregan al solicitante." />
                <Ficha n={r.entregados} texto="con entregas" ayuda="Artículos que ya tienen al menos una entrega registrada." />
              </div>
            </div>
          ) : null}
        </>
      )}

      {veIndicadores ? <PanelAnalitico /> : null}
    </div>
  );
}
