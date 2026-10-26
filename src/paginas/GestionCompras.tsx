import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, limpiarError } from '../supabase.ts';
import { useCatalogos, useActualizacionPeriodica, listarPerfiles } from '../datos.ts';
import type { PerfilBreve } from '../datos.ts';
import type { VArticulo, Etapa } from '../tipos.ts';
import { ETIQUETA_ETAPA, ETIQUETA_APROBACION, ETIQUETA_ESTADO_SOLICITUD } from '../tipos.ts';
import { Campo, MensajeError, Cargando, Paginador, InsigniaEtapa, InsigniaAprobacion } from '../componentes/UI.tsx';
import { etiquetaSemana, fmtFecha, lunesDeSemana } from '../util/fechas.ts';
import { fmtCantidad, fmtMoneda } from '../util/moneda.ts';
import { generarCSV, descargarCSV, type ColumnaCSV } from '../util/csv.ts';

const POR_PAGINA = 25;
const ETAPAS: Etapa[] = ['solicitado', 'en_cotizacion', 'cotizado', 'comprado', 'en_transito', 'recibido_parcial', 'recibido_total', 'cerrado', 'cancelado'];

interface Filtros {
  buscar: string; numero: string; etapa: string; aprob: string; area: string; cc: string;
  proveedor: string; solicitante: string; semana: string; desde: string; hasta: string;
  atrasados: boolean; novedades: boolean; extra: boolean; incluirCorreccion: boolean;
}
const VACIO: Filtros = {
  buscar: '', numero: '', etapa: '', aprob: '', area: '', cc: '', proveedor: '', solicitante: '',
  semana: '', desde: '', hasta: '', atrasados: false, novedades: false, extra: false, incluirCorreccion: false
};

/**
 * Bandeja OPERATIVA de Compras: solo solicitudes aprobadas y liberadas
 * (recibidas por Compras). Lo pendiente de aprobación o programado NO
 * aparece aquí (y el servidor tampoco se lo entrega a Compras).
 */
export function GestionCompras() {
  const { cat } = useCatalogos();
  const [personas, setPersonas] = useState<PerfilBreve[]>([]);
  const [filas, setFilas] = useState<VArticulo[] | null>(null);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState<Filtros>(VACIO);
  const cambiar = (p: Partial<Filtros>) => { setPagina(1); setF((x) => ({ ...x, ...p })); };

  useEffect(() => { listarPerfiles().then(setPersonas).catch(() => {}); }, []);

  const filtrar = useCallback(<T,>(consulta: T): T => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = consulta as any;
    q = f.incluirCorreccion
      ? q.not('recibida_compras_en', 'is', null)
      : q.eq('en_bandeja_compras', true);
    if (f.etapa) q = q.eq('etapa', f.etapa); else q = q.neq('etapa', 'borrador');
    if (f.buscar.trim()) {
      const t = f.buscar.trim().replace(/[,()]/g, ' ');
      q = q.or(`nombre.ilike.%${t}%,descripcion.ilike.%${t}%,solicitud_numero.ilike.%${t}%`);
    }
    if (f.numero.trim()) q = q.ilike('solicitud_numero', `%${f.numero.trim()}%`);
    if (f.aprob) q = q.eq('estado_aprobacion', f.aprob);
    if (f.area) q = q.eq('area_id', f.area);
    if (f.cc) q = q.eq('centro_costo_id', f.cc);
    if (f.proveedor) q = q.eq('proveedor_id', f.proveedor);
    if (f.solicitante) q = q.eq('solicitante_id', f.solicitante);
    if (f.semana) q = q.eq('semana_lunes', lunesDeSemana(f.semana));
    if (f.desde) q = q.gte('recibida_compras_en', f.desde);
    if (f.hasta) q = q.lte('recibida_compras_en', f.hasta + 'T23:59:59');
    if (f.atrasados) q = q.gt('dias_atraso', 0);
    if (f.novedades) q = q.gt('novedades_abiertas', 0);
    if (f.extra) q = q.eq('es_extraordinaria', true);
    return q as T;
  }, [f]);

  const cargar = useCallback(async () => {
    setError(null);
    const q = filtrar(supabase.from('v_articulos').select('*', { count: 'exact' }))
      .order('es_extraordinaria', { ascending: false })
      .order('recibida_compras_en', { ascending: false })
      .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1);
    const { data, error: e, count } = await q;
    if (e) { setError(limpiarError(e.message)); return; }
    setFilas((data ?? []) as VArticulo[]);
    setTotal(count ?? 0);
  }, [filtrar, pagina]);

  useActualizacionPeriodica(cargar, 60000, [cargar]);

  async function exportar() {
    setError(null);
    const { data, error: e } = await filtrar(supabase.from('v_articulos').select('*'))
      .order('recibida_compras_en', { ascending: false }).limit(5000);
    if (e) { setError(limpiarError(e.message)); return; }
    const columnas: ColumnaCSV<VArticulo>[] = [
      { titulo: 'Solicitud', valor: (x) => x.solicitud_numero },
      { titulo: 'Estado solicitud', valor: (x) => ETIQUETA_ESTADO_SOLICITUD[x.solicitud_estado] },
      { titulo: 'Extraordinaria', valor: (x) => (x.es_extraordinaria ? 'Sí' : 'No') },
      { titulo: 'Artículo', valor: (x) => x.nombre },
      { titulo: 'Especificaciones', valor: (x) => x.descripcion },
      { titulo: 'Enlace', valor: (x) => x.enlace_referencia },
      { titulo: 'Etapa', valor: (x) => ETIQUETA_ETAPA[x.etapa] },
      { titulo: 'Aprobación cotización/gasto', valor: (x) => ETIQUETA_APROBACION[x.estado_aprobacion] },
      { titulo: 'Solicitante', valor: (x) => x.solicitante_nombre },
      { titulo: 'Área', valor: (x) => x.area_nombre },
      { titulo: 'Centro de costo', valor: (x) => `${x.centro_costo_codigo ?? ''} ${x.centro_costo_nombre ?? ''}`.trim() },
      { titulo: 'Semana objetivo', valor: (x) => etiquetaSemana(x.semana_lunes) },
      { titulo: 'Recibida por Compras', valor: (x) => x.recibida_compras_en ? fmtFecha(x.recibida_compras_en) : 'sin información' },
      { titulo: 'Cantidad solicitada', valor: (x) => x.cantidad },
      { titulo: 'Unidad', valor: (x) => x.unidad },
      { titulo: 'Proveedor', valor: (x) => x.proveedor_nombre },
      { titulo: 'Moneda', valor: (x) => x.moneda },
      { titulo: 'Precio unitario', valor: (x) => x.precio_unitario },
      { titulo: 'Cantidad comprada', valor: (x) => x.cantidad_comprada },
      { titulo: 'Total', valor: (x) => x.total },
      { titulo: 'Fecha compra', valor: (x) => x.fecha_compra ? fmtFecha(x.fecha_compra) : 'sin información' },
      { titulo: 'Llegada estimada', valor: (x) => x.fecha_estimada_llegada ? fmtFecha(x.fecha_estimada_llegada) : 'sin información' },
      { titulo: 'Días de atraso', valor: (x) => x.dias_atraso === null ? 'sin información' : x.dias_atraso },
      { titulo: 'Recibido neto', valor: (x) => x.recibido_neto },
      { titulo: 'En almacén', valor: (x) => x.disponible_almacen },
      { titulo: 'Entregado', valor: (x) => x.entregado_neto },
      { titulo: 'Pendiente por llegar', valor: (x) => x.pendiente_llegada },
      { titulo: 'Novedades abiertas', valor: (x) => x.novedades_abiertas }
    ];
    descargarCSV('gestion_compras.csv', generarCSV((data ?? []) as VArticulo[], columnas));
  }

  return (
    <div className="contenido">
      <h1>Gestión de compras</h1>
      <p className="texto-suave">Solo aparecen solicitudes aprobadas por el jefe de área y liberadas según el calendario. Las extraordinarias van primero.</p>
      <div className="filtros">
        <Campo etiqueta="Buscar (artículo, especificación o número)">
          <input value={f.buscar} onChange={(e) => cambiar({ buscar: e.target.value })} />
        </Campo>
        <Campo etiqueta="Etapa">
          <select value={f.etapa} onChange={(e) => cambiar({ etapa: e.target.value })}>
            <option value="">Todas</option>
            {ETAPAS.map((x) => <option key={x} value={x}>{ETIQUETA_ETAPA[x]}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Aprobación cotización/gasto">
          <select value={f.aprob} onChange={(e) => cambiar({ aprob: e.target.value })}>
            <option value="">Todas</option>
            {(['no_requiere', 'sin_solicitar', 'pendiente', 'aprobada', 'rechazada'] as const).map((x) =>
              <option key={x} value={x}>{ETIQUETA_APROBACION[x]}</option>)}
          </select>
        </Campo>
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
        <Campo etiqueta="Proveedor">
          <select value={f.proveedor} onChange={(e) => cambiar({ proveedor: e.target.value })}>
            <option value="">Todos</option>
            {cat?.proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Solicitante">
          <select value={f.solicitante} onChange={(e) => cambiar({ solicitante: e.target.value })}>
            <option value="">Todos</option>
            {personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Semana objetivo (cualquier día)">
          <input type="date" value={f.semana} onChange={(e) => cambiar({ semana: e.target.value })} />
        </Campo>
        <Campo etiqueta="Recibida desde"><input type="date" value={f.desde} onChange={(e) => cambiar({ desde: e.target.value })} /></Campo>
        <Campo etiqueta="Recibida hasta"><input type="date" value={f.hasta} onChange={(e) => cambiar({ hasta: e.target.value })} /></Campo>
        <label className="campo"><span className="campo-etiqueta">Solo atrasados</span>
          <input type="checkbox" checked={f.atrasados} onChange={(e) => cambiar({ atrasados: e.target.checked })} /></label>
        <label className="campo"><span className="campo-etiqueta">Con novedades</span>
          <input type="checkbox" checked={f.novedades} onChange={(e) => cambiar({ novedades: e.target.checked })} /></label>
        <label className="campo"><span className="campo-etiqueta">Extraordinarias</span>
          <input type="checkbox" checked={f.extra} onChange={(e) => cambiar({ extra: e.target.checked })} /></label>
        <label className="campo"><span className="campo-etiqueta">Incluir devueltas</span>
          <input type="checkbox" checked={f.incluirCorreccion} onChange={(e) => cambiar({ incluirCorreccion: e.target.checked })} /></label>
        <button type="button" className="boton-secundario" onClick={() => { setPagina(1); setF(VACIO); }}>Limpiar filtros</button>
        <button type="button" className="boton-secundario" onClick={() => void cargar()}>Actualizar</button>
        <button type="button" className="boton-secundario" onClick={() => void exportar()}>Exportar CSV</button>
      </div>
      <MensajeError texto={error} flotante />
      {!filas ? <Cargando /> : filas.length === 0 ? (
        <div className="tarjeta"><p>No hay artículos con estos filtros.</p></div>
      ) : (
        <div className="tabla-envoltura">
          <table className="tabla">
            <thead>
              <tr>
                <th>Solicitud</th><th>Artículo</th><th>Etapa</th><th>Aprobación</th>
                <th className="oculto-movil">Solicitante</th><th className="oculto-movil">Área · CC</th>
                <th>Recibida</th><th className="numero">Cant.</th>
                <th className="oculto-movil">Proveedor</th><th className="numero oculto-movil">Total</th><th>Atraso</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((x) => (
                <tr key={x.id}>
                  <td>{x.solicitud_numero}{x.es_extraordinaria ? <div><span className="insignia insignia-extra">Extraordinaria</span></div> : null}
                    {x.flujo === 'anterior' ? <div className="texto-suave">flujo anterior</div> : null}</td>
                  <td><Link to={`/gestion/articulo/${x.id}`}>{x.nombre}</Link>
                    {x.adjuntos > 0 ? <span title="adjuntos"> 📎{x.adjuntos}</span> : null}
                    {x.novedades_abiertas > 0 ? <span title="novedades abiertas"> ⚠</span> : null}</td>
                  <td><InsigniaEtapa etapa={x.etapa} /></td>
                  <td><InsigniaAprobacion estado={x.estado_aprobacion} /></td>
                  <td className="oculto-movil">{x.solicitante_nombre}</td>
                  <td className="oculto-movil">{x.area_nombre} · {x.centro_costo_codigo}</td>
                  <td>{x.recibida_compras_en ? fmtFecha(x.recibida_compras_en) : '—'}</td>
                  <td className="numero">{fmtCantidad(x.cantidad)} {x.unidad}</td>
                  <td className="oculto-movil">{x.proveedor_nombre ?? '—'}</td>
                  <td className="numero oculto-movil">{x.total !== null ? fmtMoneda(x.total, x.moneda ?? 'COP') : '—'}</td>
                  <td>{x.dias_atraso === null ? <span className="texto-suave">sin info.</span>
                       : x.dias_atraso > 0 ? <span className="atraso">{x.dias_atraso} d</span> : '0'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Paginador pagina={pagina} porPagina={POR_PAGINA} total={total} alCambiar={setPagina} />
      <p className="texto-suave">Totales y filtros se calculan sobre todo el conjunto autorizado, no solo esta página.</p>
    </div>
  );
}
