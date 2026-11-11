// Panel analítico del Inicio (Compras y consulta global). Solo usa datos reales:
// v_articulos, cotizaciones seleccionadas y fn_indicadores. Los filtros de fecha,
// área y centro de costo se aplican a todo el panel, salvo a los tiempos del servidor
// (fn_indicadores solo recibe fechas), lo que se avisa en pantalla.
import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, limpiarError } from '../supabase.ts';
import { useCatalogos, useActualizacionPeriodica } from '../datos.ts';
import { ETIQUETA_ETAPA, type Etapa } from '../tipos.ts';
import { Boton, Campo, EstadoError, EstadoVacio, Esqueleto, Indicador, MensajeError } from './UI.tsx';
import { GraficoApilado, GraficoBarras, Leyenda } from './Graficos.tsx';
import { fmtMoneda, redondear2 } from '../util/moneda.ts';
import { hoyBogotaISO, sumarDias } from '../util/fechas.ts';
import { useEstadoURL } from '../util/estadoUrl.ts';
import { resumirTablero, type ArticuloTablero, type EstimadoArticulo } from '../util/tablero.ts';

const HOY = hoyBogotaISO();
const VACIO: { desde: string; hasta: string; area: string; cc: string; agrupar: string } = {
  desde: sumarDias(HOY, -90), hasta: HOY, area: '', cc: '', agrupar: 'area'
};
const LIMITE = 5000;
const ETAPAS_GRAFICO: Etapa[] = ['solicitado', 'en_cotizacion', 'cotizado', 'comprado', 'en_transito', 'recibido_parcial', 'recibido_total', 'cerrado'];
const COLUMNAS = 'id,etapa,total,moneda,cantidad_comprada,recibido_neto,dias_atraso,novedades_abiertas,es_extraordinaria,area_id,area_nombre,centro_costo_id,centro_costo_codigo';

interface Indicadores {
  solicitudes_enviadas: number; anticipacion_promedio_dias: number | null; anticipacion_con_dato: number;
  horas_envio_aprobacion: number | null; horas_aprobacion_recepcion: number | null; horas_recepcion_compra: number | null;
  extraordinarias: number; extraordinarias_total_cop: number;
  extraordinarias_por_area: Array<{ area: string; n: number; total_cop: number }>;
  gasto_por_area_cc: Array<{ area: string | null; cc: string | null; moneda: string; total: number }>;
}

function horasATexto(h: number | null): string {
  if (h === null || h === undefined) return 'sin información';
  return h >= 48 ? `${(h / 24).toFixed(1)} días` : `${h.toFixed(1)} h`;
}

export function PanelAnalitico() {
  const { cat } = useCatalogos(true);
  const { estado: f, cambiar, limpiar } = useEstadoURL(VACIO);
  const [articulos, setArticulos] = useState<ArticuloTablero[] | null>(null);
  const [estimados, setEstimados] = useState<EstimadoArticulo[]>([]);
  const [total, setTotal] = useState(0);
  const [ind, setInd] = useState<Indicadores | null>(null);
  const [error, setError] = useState<string | null>(null);
  const agrupar = f.agrupar === 'centro_costo' ? 'centro_costo' : 'area';
  const fechasValidas = !!f.desde && !!f.hasta && f.desde <= f.hasta;

  const cargar = useCallback(async () => {
    if (!fechasValidas) return;
    setError(null);
    let q = supabase.from('v_articulos').select(COLUMNAS, { count: 'exact' })
      .not('recibida_compras_en', 'is', null).neq('etapa', 'borrador')
      .gte('recibida_compras_en', `${f.desde}T00:00:00-05:00`).lte('recibida_compras_en', `${f.hasta}T23:59:59-05:00`);
    if (f.area) q = q.eq('area_id', f.area);
    if (f.cc) q = q.eq('centro_costo_id', f.cc);
    const [r, ri] = await Promise.all([q.limit(LIMITE), supabase.rpc('fn_indicadores', { p_desde: f.desde, p_hasta: f.hasta })]);
    if (r.error) { setError(limpiarError(r.error.message)); return; }
    const filas = (r.data ?? []) as unknown as ArticuloTablero[];
    setArticulos(filas);
    setTotal(r.count ?? filas.length);
    if (ri.data) setInd(ri.data as Indicadores);
    // Estimado: cotización seleccionada de los artículos que aún no se compran.
    const ids = filas.filter((a) => a.etapa === 'en_cotizacion' || a.etapa === 'cotizado').map((a) => a.id);
    const est: EstimadoArticulo[] = [];
    for (let i = 0; i < ids.length; i += 80) {
      const { data } = await supabase.from('cotizaciones')
        .select('articulo_id,moneda,precio_unitario,cantidad,impuestos,descuentos,otros_cargos')
        .eq('es_seleccionada', true).in('articulo_id', ids.slice(i, i + 80));
      for (const c of (data ?? []) as Array<{ articulo_id: string; moneda: string; precio_unitario: number; cantidad: number; impuestos: number; descuentos: number; otros_cargos: number }>) {
        est.push({ articuloId: c.articulo_id, moneda: c.moneda,
          total: redondear2(c.precio_unitario * c.cantidad) + c.impuestos + c.otros_cargos - c.descuentos });
      }
    }
    setEstimados(est);
  }, [f.desde, f.hasta, f.area, f.cc, fechasValidas]);

  useActualizacionPeriodica(cargar, 60000, [cargar]);

  const r = useMemo(() => (articulos ? resumirTablero(articulos, estimados, agrupar) : null), [articulos, estimados, agrupar]);
  const cop = r?.porMoneda['COP'] ?? { estimado: 0, comprometido: 0, ejecutado: 0 };
  const otras = r ? Object.entries(r.porMoneda).filter(([m]) => m !== 'COP') : [];
  const pesos = (n: number) => fmtMoneda(n, 'COP');

  return (
    <section className="tarjeta" aria-labelledby="panel-titulo">
      <h2 id="panel-titulo">Panel de compras</h2>
      <p className="texto-suave">
        Artículos recibidos por Compras entre las fechas elegidas. Los filtros se aplican a todo el panel; los tiempos del servidor
        (al final) solo consideran las fechas.
      </p>
      <div className="filtros" role="group" aria-label="Filtros del panel">
        <Campo etiqueta="Desde" error={f.desde && f.hasta && f.desde > f.hasta ? 'Debe ser anterior a «Hasta».' : undefined}>
          <input type="date" value={f.desde} onChange={(e) => cambiar({ desde: e.target.value })} />
        </Campo>
        <Campo etiqueta="Hasta"><input type="date" value={f.hasta} onChange={(e) => cambiar({ hasta: e.target.value })} /></Campo>
        <Campo etiqueta="Área">
          <select value={f.area} onChange={(e) => cambiar({ area: e.target.value })}>
            <option value="">Todas</option>
            {cat?.areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Centro de costo">
          <select value={f.cc} onChange={(e) => cambiar({ cc: e.target.value })}>
            <option value="">Todos</option>
            {cat?.centros.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Agrupar costos por">
          <select value={agrupar} onChange={(e) => cambiar({ agrupar: e.target.value })}>
            <option value="area">Área</option>
            <option value="centro_costo">Centro de costo</option>
          </select>
        </Campo>
        <Boton onClick={limpiar}>Limpiar filtros</Boton>
        <Boton onClick={() => void cargar()}>Actualizar</Boton>
      </div>
      <MensajeError texto={articulos ? error : null} />

      {error && !articulos ? <EstadoError mensaje={error} alReintentar={() => void cargar()} />
        : !r ? <Esqueleto lineas={6} etiqueta="Calculando el panel…" />
        : r.flujo.total === 0 ? (
          <EstadoVacio titulo="No hay artículos recibidos por Compras en este rango" texto="Amplía las fechas o quita algún filtro."
            accion={<Boton onClick={() => cambiar({ desde: sumarDias(HOY, -365), hasta: HOY, area: '', cc: '' })}>Ver el último año</Boton>} />
        ) : (
          <>
            {total > LIMITE ? <div className="mensaje mensaje-error">Hay {total} artículos; el panel calcula con los primeros {LIMITE}. Acota las fechas para ver todo.</div> : null}

            <h3>Dinero (COP)</h3>
            <div className="indicadores">
              <Indicador titulo="Estimado" valor={pesos(cop.estimado)}
                ayuda="Valor de la cotización seleccionada de los artículos que aún no se han comprado (en cotización o cotizados). Es una previsión, no un gasto."
                detalle={r.sinEstimado > 0 ? `${r.sinEstimado} artículo(s) sin cotización seleccionada no suman.` : undefined} />
              <Indicador titulo="Comprometido" valor={pesos(cop.comprometido)}
                ayuda="Valor ya comprado que todavía no se ha recibido (comprado, en tránsito o la parte pendiente de una recepción parcial). El dinero ya está comprometido con el proveedor."
                detalle={r.sinImporte > 0 ? `${r.sinImporte} compra(s) sin importe registrado no suman.` : undefined} />
              <Indicador titulo="Ejecutado" valor={pesos(cop.ejecutado)}
                ayuda="Valor comprado que ya se recibió, en proporción a lo recibido neto de cada compra. Es lo realmente ejecutado." />
            </div>
            <GraficoBarras titulo="Estimado, comprometido y ejecutado"
              descripcion={`Estimado ${pesos(cop.estimado)}, comprometido ${pesos(cop.comprometido)} y ejecutado ${pesos(cop.ejecutado)}, en pesos colombianos.`}
              datos={[
                { etiqueta: 'Estimado', valor: cop.estimado, trama: 'punteado', texto: pesos(cop.estimado) },
                { etiqueta: 'Comprometido', valor: cop.comprometido, trama: 'rayado', texto: pesos(cop.comprometido) },
                { etiqueta: 'Ejecutado', valor: cop.ejecutado, trama: 'solido', texto: pesos(cop.ejecutado) }
              ]}
              vacio={<p className="texto-suave">Aún no hay importes en COP para graficar.</p>} />
            <Leyenda items={[{ trama: 'punteado', texto: 'Estimado (punteado)' }, { trama: 'rayado', texto: 'Comprometido (rayado)' }, { trama: 'solido', texto: 'Ejecutado (sólido)' }]} />
            {otras.length > 0 ? (
              <p className="texto-suave">Además hay importes en otras monedas, que no se suman con COP: {otras.map(([m, v]) =>
                `${m}: comprometido ${fmtMoneda(v.comprometido, m)}, ejecutado ${fmtMoneda(v.ejecutado, m)}`).join(' · ')}. Detalle en <Link to="/reportes">Reportes</Link>.</p>
            ) : null}

            <h3>Costos por {agrupar === 'area' ? 'área' : 'centro de costo'} (COP)</h3>
            <GraficoApilado titulo={`Costos por ${agrupar === 'area' ? 'área' : 'centro de costo'}`}
              descripcion={r.grupos.slice(0, 8).map((g) => `${g.etiqueta}: ejecutado ${pesos(g.ejecutado)}, comprometido ${pesos(g.comprometido)}`).join('; ') + '.'}
              grupos={r.grupos.slice(0, 8).map((g) => ({ etiqueta: g.etiqueta, ejecutado: g.ejecutado, comprometido: g.comprometido,
                textoEjecutado: pesos(g.ejecutado), textoComprometido: pesos(g.comprometido) }))}
              vacio={<p className="texto-suave">Aún no hay compras en COP para agrupar.</p>} />
            <Leyenda items={[{ trama: 'solido', texto: 'Ejecutado (sólido)' }, { trama: 'rayado', texto: 'Comprometido (rayado)' }]} />
            <details>
              <summary>Ver los datos como tabla</summary>
              <div className="tabla-envoltura" tabIndex={0} role="region" aria-label="Costos por grupo">
                <table className="tabla">
                  <caption className="solo-lectores">Estimado, comprometido y ejecutado por {agrupar === 'area' ? 'área' : 'centro de costo'}</caption>
                  <thead><tr><th scope="col">{agrupar === 'area' ? 'Área' : 'Centro de costo'}</th><th scope="col" className="numero">Estimado</th><th scope="col" className="numero">Comprometido</th><th scope="col" className="numero">Ejecutado</th></tr></thead>
                  <tbody>
                    {r.grupos.map((g) => (
                      <tr key={g.clave}><td>{g.etiqueta}</td><td className="numero">{pesos(g.estimado)}</td><td className="numero">{pesos(g.comprometido)}</td><td className="numero">{pesos(g.ejecutado)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>

            <h3>Flujo de artículos</h3>
            <div className="indicadores">
              <Indicador titulo="Pendientes de gestión" valor={r.flujo.pendientes}
                ayuda="Artículos recibidos por Compras que están sin cotizar, en cotización o cotizados, es decir, que aún no se compran." />
              <Indicador titulo="Por llegar" valor={r.flujo.porLlegar}
                ayuda="Artículos ya comprados que no han llegado completos: comprados, en tránsito o con recepción parcial." />
              <Indicador titulo="Atrasados" valor={r.flujo.atrasados}
                ayuda="Artículos con días de atraso mayores que cero según la fecha de llegada estimada que calcula el servidor." />
              <Indicador titulo="Con novedades" valor={r.flujo.conNovedades}
                ayuda="Artículos con al menos una novedad abierta (entrega incorrecta, datos incompletos, etc.)." />
              <Indicador titulo="Extraordinarias" valor={r.flujo.extraordinarias}
                ayuda="Artículos de solicitudes extraordinarias (emergencias), que no esperan el calendario de Compras pero sí pasan por el jefe." />
              <Indicador titulo="Total de artículos" valor={r.flujo.total}
                ayuda="Artículos recibidos por Compras en el rango y con los filtros elegidos, sin contar borradores ni cancelados." />
            </div>
            <GraficoBarras titulo="Artículos por etapa"
              descripcion={ETAPAS_GRAFICO.map((e) => `${ETIQUETA_ETAPA[e]}: ${r.flujo.porEtapa[e] ?? 0}`).join('; ') + '.'}
              datos={ETAPAS_GRAFICO.map((e) => ({ etiqueta: ETIQUETA_ETAPA[e], valor: r.flujo.porEtapa[e] ?? 0, trama: 'solido' as const, texto: String(r.flujo.porEtapa[e] ?? 0) }))} />
          </>
        )}

      <h3>Tiempos y volumen del período</h3>
      {!ind ? <Esqueleto lineas={3} /> : (
        <>
          <div className="indicadores">
            <Indicador titulo="Solicitudes enviadas" valor={ind.solicitudes_enviadas}
              ayuda="Solicitudes creadas en las fechas elegidas que ya fueron enviadas a aprobación. Este dato lo calcula el servidor solo por fechas." />
            <Indicador titulo="Anticipación promedio" valor={ind.anticipacion_promedio_dias !== null ? `${ind.anticipacion_promedio_dias} días` : '—'}
              ayuda="Días promedio entre la creación real de la solicitud y su fecha requerida. Solo cuenta las que tienen fecha requerida."
              detalle={`${ind.anticipacion_con_dato} con fecha requerida`} />
            <Indicador titulo="Envío → aprobación" valor={horasATexto(ind.horas_envio_aprobacion)}
              ayuda="Tiempo promedio desde que el solicitante envía hasta que el jefe decide." />
            <Indicador titulo="Aprobación → recepción de Compras" valor={horasATexto(ind.horas_aprobacion_recepcion)}
              ayuda="Tiempo promedio desde la aprobación hasta que Compras recibe la solicitud (incluye la espera del ciclo programado)." />
            <Indicador titulo="Recepción de Compras → compra" valor={horasATexto(ind.horas_recepcion_compra)}
              ayuda="Tiempo promedio desde que Compras recibe hasta que se registra la compra. Se mide desde la recepción efectiva, no desde la creación." />
            <Indicador titulo="Extraordinarias (solicitudes)" valor={ind.extraordinarias}
              ayuda="Solicitudes extraordinarias del período y su gasto comprado en COP." detalle={fmtMoneda(ind.extraordinarias_total_cop, 'COP')} />
          </div>
          {ind.extraordinarias_por_area.length > 0 ? (
            <details>
              <summary>Extraordinarias por área</summary>
              <div className="tabla-envoltura" tabIndex={0} role="region" aria-label="Extraordinarias por área">
                <table className="tabla"><caption className="solo-lectores">Extraordinarias por área</caption>
                  <thead><tr><th scope="col">Área</th><th scope="col" className="numero">Cantidad</th><th scope="col" className="numero">Gasto COP</th></tr></thead>
                  <tbody>{ind.extraordinarias_por_area.map((x) => (
                    <tr key={x.area}><td>{x.area}</td><td className="numero">{x.n}</td><td className="numero">{fmtMoneda(x.total_cop, 'COP')}</td></tr>
                  ))}</tbody></table>
              </div>
            </details>
          ) : null}
          <p><Link to="/reportes">Más detalle de costos en Reportes →</Link></p>
        </>
      )}
    </section>
  );
}
