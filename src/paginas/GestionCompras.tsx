import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, limpiarError } from '../supabase.ts';
import { useCatalogos, useActualizacionPeriodica, listarPerfiles } from '../datos.ts';
import type { PerfilBreve } from '../datos.ts';
import type { VArticulo, Etapa } from '../tipos.ts';
import { ETIQUETA_ETAPA, ETIQUETA_APROBACION } from '../tipos.ts';
import { Campo, MensajeError, Cargando, Paginador, InsigniaEtapa, InsigniaAprobacion } from '../componentes/UI.tsx';
import { etiquetaSemana, fmtFecha, lunesDeSemana } from '../util/fechas.ts';
import { fmtCantidad, fmtMoneda } from '../util/moneda.ts';
import { generarCSV, descargarCSV, type ColumnaCSV } from '../util/csv.ts';

const POR_PAGINA = 25;
const ETAPAS: Etapa[] = ['solicitado', 'en_cotizacion', 'cotizado', 'comprado', 'en_transito', 'recibido_parcial', 'recibido_total', 'cerrado', 'cancelado'];

export function GestionCompras() {
  const { cat } = useCatalogos();
  const [personas, setPersonas] = useState<PerfilBreve[]>([]);
  const [filas, setFilas] = useState<VArticulo[] | null>(null);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const [fEtapa, setFEtapa] = useState('');
  const [fTexto, setFTexto] = useState('');
  const [fNumero, setFNumero] = useState('');
  const [fArea, setFArea] = useState('');
  const [fCC, setFCC] = useState('');
  const [fProveedor, setFProveedor] = useState('');
  const [fSolicitante, setFSolicitante] = useState('');
  const [fSemana, setFSemana] = useState('');
  const [fDesde, setFDesde] = useState('');
  const [fHasta, setFHasta] = useState('');
  const [fSoloAtrasados, setFSoloAtrasados] = useState(false);
  const [fSoloNovedades, setFSoloNovedades] = useState(false);

  useEffect(() => { listarPerfiles().then(setPersonas).catch(() => {}); }, []);

  const cargar = useCallback(async () => {
    setError(null);
    let q = supabase.from('v_articulos').select('*', { count: 'exact' });
    if (fEtapa) q = q.eq('etapa', fEtapa);
    else q = q.neq('etapa', 'borrador'); // los borradores aún no entran a gestión
    if (fTexto.trim()) q = q.ilike('nombre', `%${fTexto.trim()}%`);
    if (fNumero.trim()) q = q.ilike('solicitud_numero', `%${fNumero.trim()}%`);
    if (fArea) q = q.eq('area_id', fArea);
    if (fCC) q = q.eq('centro_costo_id', fCC);
    if (fProveedor) q = q.eq('proveedor_id', fProveedor);
    if (fSolicitante) q = q.eq('solicitante_id', fSolicitante);
    if (fSemana) q = q.eq('semana_lunes', lunesDeSemana(fSemana));
    if (fDesde) q = q.gte('creado_en', fDesde);
    if (fHasta) q = q.lte('creado_en', fHasta + 'T23:59:59');
    if (fSoloAtrasados) q = q.gt('dias_atraso', 0);
    if (fSoloNovedades) q = q.gt('novedades_abiertas', 0);
    q = q.order('creado_en', { ascending: false }).range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1);
    const { data, error: e, count } = await q;
    if (e) { setError(limpiarError(e.message)); return; }
    setFilas((data ?? []) as VArticulo[]);
    setTotal(count ?? 0);
  }, [fEtapa, fTexto, fNumero, fArea, fCC, fProveedor, fSolicitante, fSemana, fDesde, fHasta, fSoloAtrasados, fSoloNovedades, pagina]);

  useActualizacionPeriodica(cargar, 60000, [cargar]);

  async function exportar() {
    // Exporta el conjunto COMPLETO autorizado con los filtros aplicados (hasta 5000 filas).
    setError(null);
    let q = supabase.from('v_articulos').select('*');
    if (fEtapa) q = q.eq('etapa', fEtapa); else q = q.neq('etapa', 'borrador');
    if (fTexto.trim()) q = q.ilike('nombre', `%${fTexto.trim()}%`);
    if (fNumero.trim()) q = q.ilike('solicitud_numero', `%${fNumero.trim()}%`);
    if (fArea) q = q.eq('area_id', fArea);
    if (fCC) q = q.eq('centro_costo_id', fCC);
    if (fProveedor) q = q.eq('proveedor_id', fProveedor);
    if (fSolicitante) q = q.eq('solicitante_id', fSolicitante);
    if (fSemana) q = q.eq('semana_lunes', lunesDeSemana(fSemana));
    if (fDesde) q = q.gte('creado_en', fDesde);
    if (fHasta) q = q.lte('creado_en', fHasta + 'T23:59:59');
    if (fSoloAtrasados) q = q.gt('dias_atraso', 0);
    if (fSoloNovedades) q = q.gt('novedades_abiertas', 0);
    const { data, error: e } = await q.order('creado_en', { ascending: false }).limit(5000);
    if (e) { setError(limpiarError(e.message)); return; }
    const columnas: ColumnaCSV<VArticulo>[] = [
      { titulo: 'Solicitud', valor: (f) => f.solicitud_numero },
      { titulo: 'Artículo', valor: (f) => f.nombre },
      { titulo: 'Etapa', valor: (f) => ETIQUETA_ETAPA[f.etapa] },
      { titulo: 'Aprobación', valor: (f) => ETIQUETA_APROBACION[f.estado_aprobacion] },
      { titulo: 'Solicitante', valor: (f) => f.solicitante_nombre },
      { titulo: 'Área', valor: (f) => f.area_nombre },
      { titulo: 'Centro de costo', valor: (f) => f.centro_costo_codigo },
      { titulo: 'Semana objetivo', valor: (f) => etiquetaSemana(f.semana_lunes) },
      { titulo: 'Cantidad solicitada', valor: (f) => f.cantidad },
      { titulo: 'Unidad', valor: (f) => f.unidad },
      { titulo: 'Proveedor', valor: (f) => f.proveedor_nombre },
      { titulo: 'Moneda', valor: (f) => f.moneda },
      { titulo: 'Precio unitario', valor: (f) => f.precio_unitario },
      { titulo: 'Cantidad comprada', valor: (f) => f.cantidad_comprada },
      { titulo: 'Total', valor: (f) => f.total },
      { titulo: 'Fecha compra', valor: (f) => f.fecha_compra ? fmtFecha(f.fecha_compra) : 'sin información' },
      { titulo: 'Llegada estimada', valor: (f) => f.fecha_estimada_llegada ? fmtFecha(f.fecha_estimada_llegada) : 'sin información' },
      { titulo: 'Días de atraso', valor: (f) => f.dias_atraso === null ? 'sin información' : f.dias_atraso },
      { titulo: 'Recibido neto', valor: (f) => f.recibido_neto },
      { titulo: 'En almacén', valor: (f) => f.disponible_almacen },
      { titulo: 'Entregado', valor: (f) => f.entregado_neto },
      { titulo: 'Pendiente por llegar', valor: (f) => f.pendiente_llegada },
      { titulo: 'Novedades abiertas', valor: (f) => f.novedades_abiertas },
      { titulo: 'Creado', valor: (f) => fmtFecha(f.creado_en) }
    ];
    descargarCSV('gestion_compras.csv', generarCSV((data ?? []) as VArticulo[], columnas));
  }

  return (
    <div className="contenido">
      <h1>Gestión de compras</h1>
      <div className="filtros">
        <Campo etiqueta="Etapa">
          <select value={fEtapa} onChange={(e) => { setPagina(1); setFEtapa(e.target.value); }}>
            <option value="">Todas (sin borradores)</option>
            {ETAPAS.map((x) => <option key={x} value={x}>{ETIQUETA_ETAPA[x]}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Artículo contiene">
          <input value={fTexto} onChange={(e) => { setPagina(1); setFTexto(e.target.value); }} />
        </Campo>
        <Campo etiqueta="N° solicitud">
          <input value={fNumero} onChange={(e) => { setPagina(1); setFNumero(e.target.value); }} placeholder="SOL-…" />
        </Campo>
        <Campo etiqueta="Área">
          <select value={fArea} onChange={(e) => { setPagina(1); setFArea(e.target.value); }}>
            <option value="">Todas</option>
            {cat?.areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Centro de costo">
          <select value={fCC} onChange={(e) => { setPagina(1); setFCC(e.target.value); }}>
            <option value="">Todos</option>
            {cat?.centros.map((c) => <option key={c.id} value={c.id}>{c.codigo}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Proveedor">
          <select value={fProveedor} onChange={(e) => { setPagina(1); setFProveedor(e.target.value); }}>
            <option value="">Todos</option>
            {cat?.proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Solicitante">
          <select value={fSolicitante} onChange={(e) => { setPagina(1); setFSolicitante(e.target.value); }}>
            <option value="">Todos</option>
            {personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Semana (cualquier día)">
          <input type="date" value={fSemana} onChange={(e) => { setPagina(1); setFSemana(e.target.value); }} />
        </Campo>
        <Campo etiqueta="Creado desde">
          <input type="date" value={fDesde} onChange={(e) => { setPagina(1); setFDesde(e.target.value); }} />
        </Campo>
        <Campo etiqueta="Creado hasta">
          <input type="date" value={fHasta} onChange={(e) => { setPagina(1); setFHasta(e.target.value); }} />
        </Campo>
        <label className="campo"><span className="campo-etiqueta">Solo atrasados</span>
          <input type="checkbox" checked={fSoloAtrasados} onChange={(e) => { setPagina(1); setFSoloAtrasados(e.target.checked); }} />
        </label>
        <label className="campo"><span className="campo-etiqueta">Con novedades</span>
          <input type="checkbox" checked={fSoloNovedades} onChange={(e) => { setPagina(1); setFSoloNovedades(e.target.checked); }} />
        </label>
        <button type="button" className="boton-secundario" onClick={() => void cargar()}>Actualizar</button>
        <button type="button" className="boton-secundario" onClick={() => void exportar()}>Exportar CSV</button>
      </div>
      <MensajeError texto={error} />
      {!filas ? <Cargando /> : (
        <div className="tabla-envoltura">
          <table className="tabla">
            <thead>
              <tr>
                <th>Solicitud</th><th>Artículo</th><th>Etapa</th><th>Aprobación</th>
                <th className="oculto-movil">Solicitante</th>
                <th className="oculto-movil">Área</th>
                <th>Semana</th>
                <th className="numero">Cant.</th>
                <th className="oculto-movil">Proveedor</th>
                <th className="numero oculto-movil">Total</th>
                <th>Atraso</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id}>
                  <td>{f.solicitud_numero}</td>
                  <td><Link to={`/gestion/articulo/${f.id}`}>{f.nombre}</Link>
                    {f.novedades_abiertas > 0 ? <span title="novedades abiertas"> ⚠</span> : null}</td>
                  <td><InsigniaEtapa etapa={f.etapa} /></td>
                  <td><InsigniaAprobacion estado={f.estado_aprobacion} /></td>
                  <td className="oculto-movil">{f.solicitante_nombre}</td>
                  <td className="oculto-movil">{f.area_nombre}</td>
                  <td>{etiquetaSemana(f.semana_lunes).replace('Semana del ', '')}</td>
                  <td className="numero">{fmtCantidad(f.cantidad)}</td>
                  <td className="oculto-movil">{f.proveedor_nombre ?? '—'}</td>
                  <td className="numero oculto-movil">{f.total !== null ? fmtMoneda(f.total, f.moneda ?? 'COP') : '—'}</td>
                  <td>{f.dias_atraso === null ? <span className="texto-suave">sin info.</span>
                       : f.dias_atraso > 0 ? <span className="atraso">{f.dias_atraso} d</span> : '0'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Paginador pagina={pagina} porPagina={POR_PAGINA} total={total} alCambiar={setPagina} />
      <p className="texto-suave">Los totales y filtros se calculan sobre todo el conjunto autorizado, no solo esta página.</p>
    </div>
  );
}
