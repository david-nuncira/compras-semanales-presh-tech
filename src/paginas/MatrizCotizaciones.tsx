// Matriz de cotizaciones de una solicitud, al estilo de la hoja de Mantenimiento,
// construida SOBRE las cotizaciones que ya existen (tabla `cotizaciones`).
// Mínimo y total salen de src/util/matriz.ts. Verde = cotización SELECCIONADA.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { supabase, limpiarError } from '../supabase.ts';
import { useCatalogos } from '../datos.ts';
import { usePermisos } from '../permisos.ts';
import type { Cotizacion, VArticulo, VSolicitud } from '../tipos.ts';
import { Boton, EstadoError, EstadoVacio, Esqueleto, Icono, PanelLateral, SinPermiso } from '../componentes/UI.tsx';
import { MiniaturaArticulo, useAdjuntosArticulos } from '../componentes/Miniatura.tsx';
import { construirMatriz, type FilaMatriz } from '../util/matriz.ts';
import { fmtFecha } from '../util/fechas.ts';
import { esCentroMantenimiento } from '../util/mantenimiento.ts';
import { fmtCantidad, fmtMoneda, redondear2 } from '../util/moneda.ts';

const pesos = (n: number | null) => (n === null ? '—' : fmtMoneda(n, 'COP'));

/** Celda de un proveedor: precio + marca de «seleccionada» (ícono y texto) y de «mínimo». */
function CeldaPrecio({ celda }: { celda: FilaMatriz['celdas'][string] | undefined }) {
  if (!celda) return <span className="texto-suave">— <span className="solo-lectores">sin cotizar</span></span>;
  return (
    <span className="matriz-precio">
      <span className={celda.esMinimo ? 'matriz-minimo' : undefined}>{pesos(celda.precio)}</span>
      {celda.seleccionada ? <span className="matriz-marca matriz-marca-sel"><Icono nombre="check-circulo" tam={13} /> Seleccionada</span> : null}
      {celda.esMinimo ? <span className="matriz-marca matriz-marca-min">mínimo</span> : null}
    </span>
  );
}

export function MatrizCotizaciones() {
  const { id } = useParams<{ id: string }>();
  const permisos = usePermisos();
  const { cat } = useCatalogos(true);
  const [sol, setSol] = useState<VSolicitud | null>(null);
  const [articulos, setArticulos] = useState<VArticulo[] | null>(null);
  const [cotizaciones, setCotizaciones] = useState<Cotizacion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [noEncontrada, setNoEncontrada] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!id) return;
    setError(null);
    const [rs, ra] = await Promise.all([
      supabase.from('v_solicitudes').select('*').eq('id', id).maybeSingle(),
      supabase.from('v_articulos').select('*').eq('solicitud_id', id).neq('etapa', 'cancelado').order('creado_en')
    ]);
    if (rs.error || ra.error) { setError(limpiarError((rs.error ?? ra.error)!.message)); return; }
    if (!rs.data) { setNoEncontrada(true); return; }
    const arts = (ra.data ?? []) as VArticulo[];
    setSol(rs.data as VSolicitud);
    setArticulos(arts);
    const cots: Cotizacion[] = [];
    for (let i = 0; i < arts.length; i += 80) {
      const { data, error: e } = await supabase.from('cotizaciones').select('*')
        .in('articulo_id', arts.slice(i, i + 80).map((a) => a.id)).order('creado_en');
      if (e) { setError(limpiarError(e.message)); return; }
      cots.push(...((data ?? []) as Cotizacion[]));
    }
    setCotizaciones(cots);
  }, [id]);

  useEffect(() => { void cargar(); }, [cargar]);

  const nombreProveedor = useMemo(() => new Map((cat?.proveedores ?? []).map((p) => [p.id, p.nombre])), [cat]);
  const matriz = useMemo(() => construirMatriz(
    (articulos ?? []).map((a) => ({ id: a.id, cantidad: a.cantidad })),
    cotizaciones.map((c) => ({
      articulo_id: c.articulo_id, proveedor_id: c.proveedor_id, moneda: c.moneda, precio_unitario: Number(c.precio_unitario),
      es_seleccionada: c.es_seleccionada, creado_en: c.creado_en
    })),
    (cat?.proveedores ?? []).map((p) => p.id)
  ), [articulos, cotizaciones, cat]);
  const filaDe = useMemo(() => new Map(matriz.filas.map((f) => [f.articuloId, f])), [matriz]);
  const { porArticulo } = useAdjuntosArticulos((articulos ?? []).map((a) => a.id));

  if (!permisos.gestor && !permisos.consultaGlobal && !permisos.aprobadorCotizacion) {
    return <div className="contenido"><SinPermiso /></div>;
  }
  if (error && !sol) return <div className="contenido"><EstadoError mensaje={error} alReintentar={() => void cargar()} /></div>;
  if (noEncontrada) return <div className="contenido"><EstadoVacio titulo="Solicitud no encontrada" texto="No existe o tu cuenta no tiene permiso para verla."
    accion={<Link className="boton-secundario enlace-boton" to="/gestion">Ir a Gestión de compras</Link>} /></div>;
  if (!sol || !articulos) return <div className="contenido"><Esqueleto lineas={8} etiqueta="Cargando la matriz de cotizaciones…" /></div>;

  // Los pedidos de mantenimiento se trabajan en su hoja (cotizar, elegir, aprobar y orden de compra).
  if (esCentroMantenimiento({ codigo: sol.centro_costo_codigo, nombre: sol.centro_costo_nombre })) return <Navigate to={`/solicitudes/${sol.id}/mantenimiento`} replace />;
  const nombreDe = (p: string) => nombreProveedor.get(p) ?? 'Proveedor';
  const provs = matriz.proveedoresIds;
  const art = articulos.find((a) => a.id === abierto) ?? null;
  const cotsAbierto = cotizaciones.filter((c) => c.articulo_id === abierto);
  const totalCot = (c: Cotizacion) => redondear2(c.precio_unitario * c.cantidad) + c.impuestos + c.otros_cargos - c.descuentos;
  const fueraMoneda = matriz.filas.reduce((s, f) => s + f.fueraDeMoneda, 0);
  const columnasAntes = 6; // Cant., Artículo, CC destino, Imagen, Justificación, Descripción

  return (
    <div className="contenido contenido-ancho">
      <p><Link to="/gestion">← Gestión de compras</Link> · <Link to={`/solicitudes/${sol.id}`}>{sol.numero}</Link></p>
      <h1>Matriz de cotizaciones · {sol.numero}</h1>

      <dl className="matriz-cabecera">
        <div><dt>Fecha</dt><dd>{fmtFecha(sol.recibida_compras_en ?? sol.creado_en)}</dd></div>
        <div><dt>Centro de costo general</dt><dd>{sol.centro_costo_codigo} {sol.centro_costo_nombre}</dd></div>
        <div><dt>Elaborado por</dt><dd>{sol.solicitante_nombre ?? '—'}</dd></div>
        <div><dt>Aprobado por</dt><dd>{sol.aprobador_jefe_nombre ?? '—'}{sol.aprobado_en ? ` · ${fmtFecha(sol.aprobado_en)}` : ''}</dd></div>
        <div><dt>Versión</dt><dd>{sol.version_contenido}</dd></div>
      </dl>

      {articulos.length === 0 ? (
        <EstadoVacio titulo="Esta solicitud no tiene artículos" texto="No hay nada que comparar todavía." />
      ) : (
        <>
          {cotizaciones.length === 0 ? (
            <div className="estimacion"><Icono nombre="info" /> Aún no hay cotizaciones. Se registran desde la ficha de cada artículo, en Gestión de compras.</div>
          ) : null}
          {fueraMoneda > 0 ? (
            <div className="estimacion"><Icono nombre="info" /> {fueraMoneda} cotización(es) están en otra moneda y no se comparan con COP; se ven en el detalle de cada artículo.</div>
          ) : null}
          <p className="texto-suave leyenda-matriz">
            <b>Mínimo</b>: el menor precio cotizado (las celdas vacías no cuentan como cero). <b>Total</b> = mínimo × cantidad, en pesos enteros.
            El verde con la marca «Seleccionada» es la cotización que eligió Compras, no necesariamente la más barata.
          </p>

          {/* ---------- Escritorio y tablet: tabla con encabezados y primeras columnas fijos ---------- */}
          <div className="matriz-envoltura" tabIndex={0} role="region" aria-label="Matriz de cotizaciones; se desplaza dentro de este recuadro">
            <table className="tabla matriz">
              <caption className="solo-lectores">Cotizaciones por artículo y proveedor, con el mínimo y el total de cada fila</caption>
              <thead>
                <tr>
                  <th scope="col" className="matriz-fija matriz-c1">Cant.</th>
                  <th scope="col" className="matriz-fija matriz-c2">Artículo</th>
                  <th scope="col">Centro de costo destino</th>
                  <th scope="col">Imagen</th>
                  <th scope="col">Justificación</th>
                  <th scope="col">Descripción / referencia</th>
                  {provs.map((p) => <th scope="col" key={p} className="numero">{nombreDe(p)}</th>)}
                  <th scope="col" className="numero">Mínimo</th>
                  <th scope="col" className="numero">Total</th>
                </tr>
              </thead>
              <tbody>
                {articulos.map((a) => {
                  const f = filaDe.get(a.id)!;
                  return (
                    <tr key={a.id}>
                      <td className="matriz-fija matriz-c1 numero">{fmtCantidad(a.cantidad)} <span className="texto-suave">{a.unidad}</span></td>
                      <td className="matriz-fija matriz-c2">
                        <button type="button" className="enlace" onClick={() => setAbierto(a.id)} aria-label={`Ver el detalle de ${a.nombre}`}>{a.nombre}</button>
                      </td>
                      <td>{a.centro_costo_codigo ?? '—'}</td>
                      <td><MiniaturaArticulo nombre={a.nombre} adjuntos={porArticulo[a.id]} /></td>
                      <td className="celda-recortada">{a.justificacion ?? '—'}</td>
                      <td className="celda-recortada">{a.descripcion}{a.referencia ? <span className="texto-suave"> · ref. {a.referencia}</span> : null}</td>
                      {provs.map((p) => <td key={p} className={`numero${f.celdas[p]?.seleccionada ? ' matriz-sel' : ''}`}><CeldaPrecio celda={f.celdas[p]} /></td>)}
                      <td className="numero">{pesos(f.minimo)}</td>
                      <td className="numero"><b>{pesos(f.total)}</b></td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={columnasAntes + provs.length + 1} className="numero">Total (suma de los totales)</th>
                  <td className="numero"><b>{pesos(matriz.totalGeneral)}</b></td>
                </tr>
                {matriz.articulosSeleccionados > 0 ? (
                  <tr>
                    <th scope="row" colSpan={columnasAntes + provs.length + 1} className="numero">
                      Total de lo seleccionado ({matriz.articulosSeleccionados} de {articulos.length} artículos)
                    </th>
                    <td className="numero"><b>{pesos(matriz.totalSeleccionado)}</b></td>
                  </tr>
                ) : null}
              </tfoot>
            </table>
          </div>

          {/* ---------- Móvil: una tarjeta por artículo con la comparación de proveedores ---------- */}
          <ul className="matriz-tarjetas" aria-label="Artículos con la comparación de proveedores">
            {articulos.map((a) => {
              const f = filaDe.get(a.id)!;
              const conPrecio = provs.filter((p) => f.celdas[p]);
              return (
                <li key={a.id} className="tarjeta">
                  <div className="articulo-fila" style={{ border: 'none', padding: 0 }}>
                    <MiniaturaArticulo nombre={a.nombre} adjuntos={porArticulo[a.id]} />
                    <div className="articulo-datos">
                      <button type="button" className="enlace" onClick={() => setAbierto(a.id)}><b>{a.nombre}</b></button>
                      <div className="texto-suave">{fmtCantidad(a.cantidad)} {a.unidad} · {a.centro_costo_codigo ?? '—'}</div>
                    </div>
                  </div>
                  {conPrecio.length === 0 ? <p className="texto-suave">Sin cotizaciones.</p> : (
                    <ul className="matriz-proveedores">
                      {conPrecio.map((p) => (
                        <li key={p} className={f.celdas[p].seleccionada ? 'matriz-sel' : undefined}>
                          <span>{nombreDe(p)}</span><CeldaPrecio celda={f.celdas[p]} />
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="matriz-resumen"><span>Mínimo: <b>{pesos(f.minimo)}</b></span><span>Total: <b>{pesos(f.total)}</b></span></p>
                </li>
              );
            })}
            <li className="tarjeta"><b>Total (suma de los totales): {pesos(matriz.totalGeneral)}</b>
              {matriz.articulosSeleccionados > 0 ? <div>Total de lo seleccionado: <b>{pesos(matriz.totalSeleccionado)}</b></div> : null}</li>
          </ul>
          {matriz.articulosSinCotizacion > 0 ? (
            <p className="texto-suave">{matriz.articulosSinCotizacion} artículo(s) sin cotizar: no suman al total (no se cuentan como cero).</p>
          ) : null}
        </>
      )}

      <PanelLateral titulo={art?.nombre ?? 'Detalle del artículo'} abierto={!!art} alCerrar={() => setAbierto(null)}>
        {art ? (
          <div className="revision">
            <p>{fmtCantidad(art.cantidad)} {art.unidad} · {art.centro_costo_codigo} {art.centro_costo_nombre}</p>
            <p>{art.descripcion}</p>
            {art.justificacion ? <p className="texto-suave">Justificación: {art.justificacion}</p> : null}
            {art.referencia ? <p className="texto-suave">Referencia: {art.referencia}</p> : null}
            {art.enlace_referencia ? <p><a href={art.enlace_referencia} target="_blank" rel="noopener noreferrer">Enlace de referencia</a></p> : null}
            <h3>Cotizaciones ({cotsAbierto.length})</h3>
            {cotsAbierto.length === 0 ? <p className="texto-suave">Sin cotizaciones.</p> : (
              <ul className="lista-revision">
                {cotsAbierto.map((c) => (
                  <li key={c.id} style={{ gridTemplateColumns: '1fr' }}>
                    <div>
                      <b>{nombreDe(c.proveedor_id)}</b>{' '}
                      {c.es_seleccionada ? <span className="insignia insignia-exito"><Icono nombre="check-circulo" tam={14} />Seleccionada</span> : null}
                      <div>{fmtMoneda(c.precio_unitario, c.moneda)} c/u × {fmtCantidad(c.cantidad)} · total {fmtMoneda(totalCot(c), c.moneda)}</div>
                      <div className="texto-suave">
                        Impuestos {fmtMoneda(c.impuestos, c.moneda)} · descuentos {fmtMoneda(c.descuentos, c.moneda)} · otros {fmtMoneda(c.otros_cargos, c.moneda)} · {fmtFecha(c.creado_en)}
                        {c.notas ? ` · ${c.notas}` : ''}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {permisos.gestor ? <p><Link className="boton-secundario enlace-boton" to={`/gestion/articulo/${art.id}`}>Cotizar o seleccionar en la ficha</Link></p> : null}
            <Boton onClick={() => setAbierto(null)}>Cerrar</Boton>
          </div>
        ) : null}
      </PanelLateral>
    </div>
  );
}
