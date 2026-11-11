// Guía paso a paso para todos los usuarios: el camino de un pedido y qué hace cada rol.
import { Link } from 'react-router-dom';
import { usePermisos } from '../permisos.ts';
import { FLUJO_GENERAL, GUIAS, type GuiaRol } from '../util/guias.ts';
import { InsigniaSolicitud, Icono } from '../componentes/UI.tsx';
import type { EstadoSolicitud } from '../tipos.ts';

const ESTADOS: Array<{ estado: EstadoSolicitud; cerrada?: boolean; texto: string }> = [
  { estado: 'borrador', texto: 'Aún lo estás armando. Nadie más lo ve.' },
  { estado: 'pendiente_aprobacion', texto: 'Tu jefe lo está revisando.' },
  { estado: 'en_correccion', texto: 'Te lo devolvieron: lee el motivo, corrígelo y reenvíalo.' },
  { estado: 'programada', texto: 'Aprobado. Espera la fecha en que Compras lo recibe.' },
  { estado: 'recibida_compras', texto: 'Compras ya lo tiene y trabaja en cotizar y comprar.' },
  { estado: 'recibida_compras', cerrada: true, texto: 'Todo se entregó y los artículos se cerraron. El pedido terminó.' },
  { estado: 'rechazada', texto: 'No continúa. Revisa el motivo en el detalle.' },
  { estado: 'cancelada', texto: 'Se canceló y no continúa.' }
];

export function Ayuda() {
  const p = usePermisos();
  const tiene: Record<GuiaRol['clave'], boolean> = {
    solicitante: p.solicitante, jefe: p.jefe, compras: p.gestor, aprobador: p.aprobadorCotizacion,
    almacen: p.almacen, admin: p.adminUsuarios || p.adminCatalogos || p.adminGeneral
  };
  const mias = GUIAS.filter((g) => tiene[g.clave]);
  const otras = GUIAS.filter((g) => !tiene[g.clave]);
  const Rol = ({ g, abierta }: { g: GuiaRol; abierta: boolean }) => (
    <details className="tarjeta guia-rol" open={abierta}>
      <summary><h3>{g.titulo}</h3><span className="texto-suave">{g.para}</span></summary>
      <ol className="guia-pasos">
        {g.pasos.map((x) => (
          <li key={x.titulo}>
            <b>{x.titulo}</b>
            <p>{x.texto}</p>
            {x.enlace ? <Link className="boton-secundario enlace-boton" to={x.enlace.a}>{x.enlace.texto} <Icono nombre="flecha" /></Link> : null}
          </li>
        ))}
      </ol>
    </details>
  );

  return (
    <div className="contenido">
      <span className="sobre-titulo">AYUDA</span>
      <h1>Guía paso a paso</h1>
      <p className="texto-suave">Aquí encuentras cómo se usa el aplicativo, según lo que haces. Cada pantalla principal también tiene un recuadro «qué hacer aquí».</p>

      <section className="tarjeta" aria-labelledby="flujo">
        <h2 id="flujo">El camino de un pedido</h2>
        <p>Todo pedido recorre estas etapas. En la pantalla del pedido, la «línea de tiempo» te dice en cuál va.</p>
        <ol className="guia-flujo">
          {FLUJO_GENERAL.map((e, i) => (
            <li key={e.titulo}><span className="paso-numero">{i + 1}</span>
              <div><b>{e.titulo}</b> <span className="insignia-suave">{e.quien}</span><p>{e.texto}</p></div></li>
          ))}
        </ol>
      </section>

      <section className="tarjeta" aria-labelledby="tipos">
        <h2 id="tipos">Dos tipos de pedido</h2>
        <ul>
          <li><b>Compras semanales:</b> el flujo normal. Cada artículo se cotiza y compra desde la ficha del artículo.</li>
          <li><b>Mantenimiento:</b> se elige «mantenimiento» como centro de costo. Cada artículo lleva su centro de costo destino y se trabaja en la
            <b> hoja de mantenimiento</b>: Compras captura los precios de cada proveedor, se elige y aprueba, y con lo aprobado (en verde) se genera la orden de compra.</li>
        </ul>
      </section>

      <h2>Qué hago yo</h2>
      {mias.length === 0 ? <p className="texto-suave">Tu cuenta aún no tiene un rol asignado. Pide a administración que te lo asigne.</p> : mias.map((g) => <Rol key={g.clave} g={g} abierta />)}
      {otras.length > 0 ? (
        <>
          <h2>Otros roles (para saber con quién hablas)</h2>
          {otras.map((g) => <Rol key={g.clave} g={g} abierta={false} />)}
        </>
      ) : null}

      <section className="tarjeta" aria-labelledby="estados">
        <h2 id="estados">Qué significa cada estado</h2>
        <ul className="guia-estados">
          {ESTADOS.map((e) => (
            <li key={e.texto}><InsigniaSolicitud estado={e.estado} cerrada={e.cerrada} /> <span>{e.texto}</span></li>
          ))}
        </ul>
      </section>

      <section className="tarjeta" aria-labelledby="faq">
        <h2 id="faq">Preguntas frecuentes</h2>
        <dl className="guia-faq">
          <dt>No puedo editar mi pedido.</dt>
          <dd>Solo se editan los borradores y los pedidos devueltos. Si ya se envió, abre el pedido y pide la devolución con un motivo.</dd>
          <dt>¿Dónde veo cómo va mi pedido?</dt>
          <dd>En «Mis solicitudes» abre el pedido: la línea de tiempo muestra cada etapa, quién la hizo y cuándo.</dd>
          <dt>Me equivoqué de centro de costo.</dt>
          <dd>Si aún es borrador, elimínalo desde «Mis solicitudes» y crea otro con el centro correcto.</dd>
          <dt>El proveedor que necesito no aparece.</dt>
          <dd>Al cotizar pulsa «Agregar proveedor nuevo», o usa el botón «Proveedores» en Gestión de compras.</dd>
          <dt>¿Por qué mi compra pide aprobación de gerencia?</dt>
          <dd>Porque el artículo supera el límite de compra sin gerencia. Se envía sola al elegir el proveedor.</dd>
        </dl>
      </section>
    </div>
  );
}
