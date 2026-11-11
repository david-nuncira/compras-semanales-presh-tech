import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, limpiarError } from '../supabase.ts';
import { useCatalogos, useActualizacionPeriodica, listarPerfiles } from '../datos.ts';
import type { PerfilBreve } from '../datos.ts';
import type { VArticulo, Etapa } from '../tipos.ts';
import { ETIQUETA_ETAPA, ETIQUETA_APROBACION, ETIQUETA_ESTADO_SOLICITUD } from '../tipos.ts';
import {
  Boton, Campo, EstadoVacio, Icono, InsigniaEtapa, InsigniaAprobacion, MensajeError, Paginador, PanelLateral,
  TablaDatos, type ColumnaDatos
} from '../componentes/UI.tsx';
import { MiniaturaArticulo, useAdjuntosArticulos } from '../componentes/Miniatura.tsx';
import { ArticuloGestion } from './ArticuloGestion.tsx';
import { etiquetaSemana, fmtFecha, lunesDeSemana } from '../util/fechas.ts';
import { fmtCantidad, fmtMoneda } from '../util/moneda.ts';
import { generarCSV, descargarCSV, type ColumnaCSV } from '../util/csv.ts';
import { useEstadoURL } from '../util/estadoUrl.ts';

const POR_PAGINA = 25;
const ETAPAS: Etapa[] = ['solicitado', 'en_cotizacion', 'cotizado', 'comprado', 'en_transito', 'recibido_parcial', 'recibido_total', 'cerrado', 'cancelado'];

interface Filtros {
  buscar: string; numero: string; etapa: string; aprob: string; area: string; cc: string;
  proveedor: string; solicitante: string; semana: string; desde: string; hasta: string;
  atrasados: boolean; novedades: boolean; extra: boolean; incluirCorreccion: boolean;
  orden: string; dir: string; articulo: string;
}
const VACIO: Filtros = {
  buscar: '', numero: '', etapa: '', aprob: '', area: '', cc: '', proveedor: '', solicitante: '',
  semana: '', desde: '', hasta: '', atrasados: false, novedades: false, extra: false, incluirCorreccion: false,
  orden: '', dir: 'desc', articulo: ''
};

/** Columna de la vista → columna real. Sin orden elegido: extraordinarias primero y lo más reciente. */
const COLUMNA_ORDEN: Record<string, string> = {
  solicitud: 'solicitud_numero', articulo: 'nombre', etapa: 'etapa', recibida: 'recibida_compras_en',
  cantidad: 'cantidad', total: 'total', atraso: 'dias_atraso'
};

/**
 * Bandeja OPERATIVA de Compras: solo solicitudes aprobadas y liberadas
 * (recibidas por Compras). Lo pendiente de aprobación o programado NO
 * aparece aquí (y el servidor tampoco se lo entrega a Compras).
 * La ficha del artículo se edita en un panel lateral para no perder la
 * posición en la lista; tras cada acción solo se actualiza esa fila.
 */
export function GestionCompras() {
  const { cat } = useCatalogos();
  const [personas, setPersonas] = useState<PerfilBreve[]>([]);
  const [filas, setFilas] = useState<VArticulo[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Filtros, orden, página y artículo abierto viven en la URL: «Atrás» conserva la posición.
  const { estado: fu, pagina, cambiar, irAPagina } = useEstadoURL<Filtros>(VACIO);
  // Los filtros de datos no incluyen el artículo abierto: abrir el panel no recarga la lista.
  const clave = JSON.stringify({ ...fu, articulo: '' });
  const f = useMemo(() => JSON.parse(clave) as Filtros, [clave]);
  const ordenActivo = COLUMNA_ORDEN[f.orden] ? f.orden : '';
  const dir: 'asc' | 'desc' = f.dir === 'asc' ? 'asc' : 'desc';

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
    let q = filtrar(supabase.from('v_articulos').select('*', { count: 'exact' }));
    q = ordenActivo
      ? q.order(COLUMNA_ORDEN[ordenActivo], { ascending: dir === 'asc', nullsFirst: false })
          .order('recibida_compras_en', { ascending: false })
      : q.order('es_extraordinaria', { ascending: false }).order('recibida_compras_en', { ascending: false });
    const { data, error: e, count } = await q.range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1);
    if (e) { setError(limpiarError(e.message)); return; }
    setFilas((data ?? []) as VArticulo[]);
    setTotal(count ?? 0);
  }, [filtrar, pagina, ordenActivo, dir]);

  useActualizacionPeriodica(cargar, 60000, [cargar]);

  const { porArticulo } = useAdjuntosArticulos((filas ?? []).map((x) => x.id));

  /** Tras una acción en la ficha: se reemplaza solo la fila afectada, sin recargar la lista. */
  const refrescarFila = useCallback((a: VArticulo) => {
    setFilas((prev) => (prev ? prev.map((x) => (x.id === a.id ? a : x)) : prev));
  }, []);

  const ordenarPor = (col: string) => {
    if (ordenActivo === col) cambiar({ dir: dir === 'asc' ? 'desc' : 'asc' });
    else cambiar({ orden: col, dir: col === 'solicitud' || col === 'articulo' || col === 'etapa' ? 'asc' : 'desc' });
  };
  const limpiarFiltros = () => cambiar({ ...VACIO, orden: f.orden, dir: f.dir, articulo: fu.articulo });
  const abrirFicha = (id: string) => cambiar({ articulo: id }, { conservarPagina: true });
  const cerrarFicha = () => cambiar({ articulo: '' }, { conservarPagina: true });
  const abierto = filas?.find((x) => x.id === fu.articulo) ?? null;

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

  const columnas: ColumnaDatos<VArticulo>[] = [
    { clave: 'foto', titulo: 'Foto', ancho: '4.5rem', render: (x) => <MiniaturaArticulo nombre={x.nombre} adjuntos={porArticulo[x.id]} /> },
    { clave: 'solicitud', titulo: 'Solicitud', ordenable: true, render: (x) => (
      <>
        <Link to={`/solicitudes/${x.solicitud_id}`}>{x.solicitud_numero}</Link>
        <div><Link to={`/solicitudes/${x.solicitud_id}/mantenimiento`} className="texto-suave">Hoja / matriz</Link></div>
        {x.es_extraordinaria ? <div><span className="insignia insignia-extra">Extraordinaria</span></div> : null}
        {x.flujo === 'anterior' ? <div className="texto-suave">flujo anterior</div> : null}
      </>
    ) },
    { clave: 'articulo', titulo: 'Artículo', ordenable: true, render: (x) => (
      <>
        <button type="button" className="enlace" onClick={() => abrirFicha(x.id)} aria-label={`Abrir la ficha de ${x.nombre}`}>{x.nombre}</button>
        {x.novedades_abiertas > 0 ? <span className="texto-aviso" title="novedades abiertas"> <Icono nombre="alerta" tam={14} />{x.novedades_abiertas}</span> : null}
      </>
    ) },
    { clave: 'etapa', titulo: 'Etapa', ordenable: true, render: (x) => (
      <div className="insignias-col"><InsigniaEtapa etapa={x.etapa} /><InsigniaAprobacion estado={x.estado_aprobacion} /></div>
    ) },
    { clave: 'solicitante', titulo: 'Solicitante', ocultoMovil: true, render: (x) => x.solicitante_nombre },
    { clave: 'area', titulo: 'Área · CC', ocultoMovil: true, render: (x) => `${x.area_nombre ?? ''} · ${x.centro_costo_codigo ?? ''}` },
    { clave: 'recibida', titulo: 'Recibida', ordenable: true, render: (x) => (x.recibida_compras_en ? fmtFecha(x.recibida_compras_en) : '—') },
    { clave: 'cantidad', titulo: 'Cant.', numerico: true, ordenable: true, render: (x) => `${fmtCantidad(x.cantidad)} ${x.unidad}` },
    { clave: 'proveedor', titulo: 'Proveedor', ocultoMovil: true, render: (x) => x.proveedor_nombre ?? '—' },
    { clave: 'total', titulo: 'Total', numerico: true, ordenable: true, ocultoMovil: true, render: (x) => (x.total !== null ? fmtMoneda(x.total, x.moneda ?? 'COP') : '—') },
    { clave: 'atraso', titulo: 'Atraso', ordenable: true, render: (x) => (
      x.dias_atraso === null ? <span className="texto-suave">sin info.</span>
        : x.dias_atraso > 0 ? <span className="atraso"><Icono nombre="alerta" tam={14} /> {x.dias_atraso} d</span> : '0'
    ) }
  ];

  return (
    <div className="contenido">
      <h1>Gestión de compras</h1>
      <p className="texto-suave">Solo aparecen solicitudes aprobadas por el jefe de área y liberadas según el calendario. Las extraordinarias van primero.</p>
      <div className="filtros">
        <Campo etiqueta="Buscar (artículo, especificación o número)">
          <input value={fu.buscar} onChange={(e) => cambiar({ buscar: e.target.value })} />
        </Campo>
        <Campo etiqueta="Etapa">
          <select value={fu.etapa} onChange={(e) => cambiar({ etapa: e.target.value })}>
            <option value="">Todas</option>
            {ETAPAS.map((x) => <option key={x} value={x}>{ETIQUETA_ETAPA[x]}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Área">
          <select value={fu.area} onChange={(e) => cambiar({ area: e.target.value })}>
            <option value="">Todas</option>
            {cat?.areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Centro de costo">
          <select value={fu.cc} onChange={(e) => cambiar({ cc: e.target.value })}>
            <option value="">Todos</option>
            {cat?.centros.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Semana objetivo (cualquier día)">
          <input type="date" value={fu.semana} onChange={(e) => cambiar({ semana: e.target.value })} />
        </Campo>
      </div>
      <details className="mas-opciones" style={{ marginBottom: 'var(--e3)' }}>
        <summary>Más filtros</summary>
        <div className="filtros" style={{ marginTop: 'var(--e3)' }}>
          <Campo etiqueta="Aprobación cotización/gasto">
            <select value={fu.aprob} onChange={(e) => cambiar({ aprob: e.target.value })}>
              <option value="">Todas</option>
              {(['no_requiere', 'sin_solicitar', 'pendiente', 'aprobada', 'rechazada'] as const).map((x) =>
                <option key={x} value={x}>{ETIQUETA_APROBACION[x]}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Proveedor">
            <select value={fu.proveedor} onChange={(e) => cambiar({ proveedor: e.target.value })}>
              <option value="">Todos</option>
              {cat?.proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Solicitante">
            <select value={fu.solicitante} onChange={(e) => cambiar({ solicitante: e.target.value })}>
              <option value="">Todos</option>
              {personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Recibida desde"><input type="date" value={fu.desde} onChange={(e) => cambiar({ desde: e.target.value })} /></Campo>
          <Campo etiqueta="Recibida hasta"><input type="date" value={fu.hasta} onChange={(e) => cambiar({ hasta: e.target.value })} /></Campo>
          <label className="campo-casilla"><input type="checkbox" checked={fu.atrasados} onChange={(e) => cambiar({ atrasados: e.target.checked })} /> Solo atrasados</label>
          <label className="campo-casilla"><input type="checkbox" checked={fu.novedades} onChange={(e) => cambiar({ novedades: e.target.checked })} /> Con novedades</label>
          <label className="campo-casilla"><input type="checkbox" checked={fu.extra} onChange={(e) => cambiar({ extra: e.target.checked })} /> Extraordinarias</label>
          <label className="campo-casilla"><input type="checkbox" checked={fu.incluirCorreccion} onChange={(e) => cambiar({ incluirCorreccion: e.target.checked })} /> Incluir devueltas</label>
        </div>
      </details>
      <div className="acciones-fila" style={{ marginBottom: 'var(--e3)' }}>
        <Boton onClick={limpiarFiltros}>Limpiar filtros</Boton>
        <Boton onClick={() => void cargar()}>Actualizar</Boton>
        <Boton onClick={() => void exportar()}>Exportar CSV</Boton>
      </div>
      <MensajeError texto={filas ? error : null} flotante />
      <TablaDatos titulo="Artículos en gestión de compras" columnas={columnas} filas={filas} clave={(x) => x.id}
        error={filas ? null : error} alReintentar={() => void cargar()}
        orden={ordenActivo ? { clave: ordenActivo, dir } : undefined} alOrdenar={ordenarPor}
        claseFila={(x) => ((x.dias_atraso ?? 0) > 0 ? 'fila-atraso' : undefined)}
        vacio={<EstadoVacio titulo="No hay artículos con estos filtros" texto="Prueba quitando algún filtro o buscando por otro texto."
          accion={<Boton onClick={limpiarFiltros}>Limpiar filtros</Boton>} />} />
      <Paginador pagina={pagina} porPagina={POR_PAGINA} total={total} alCambiar={irAPagina} />
      <p className="texto-suave">Totales y filtros se calculan sobre todo el conjunto autorizado, no solo esta página.</p>

      <PanelLateral titulo={abierto?.nombre ?? 'Ficha del artículo'} abierto={!!fu.articulo} alCerrar={cerrarFicha}>
        {fu.articulo ? <ArticuloGestion idArticulo={fu.articulo} enPanel alCambiar={refrescarFila} /> : null}
      </PanelLateral>
    </div>
  );
}
