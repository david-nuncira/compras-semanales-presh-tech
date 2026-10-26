import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, limpiarError } from '../supabase.ts';
import { useCatalogos, useActualizacionPeriodica } from '../datos.ts';
import type { VSolicitud } from '../tipos.ts';
import { ETIQUETA_ESTADO_SOLICITUD } from '../tipos.ts';
import { Campo, MensajeError, Cargando, Paginador, InsigniaSolicitud } from '../componentes/UI.tsx';
import { etiquetaSemana, fmtFecha, fmtFechaHora } from '../util/fechas.ts';
import { generarCSV, descargarCSV } from '../util/csv.ts';

const POR_PAGINA = 25;
type Grupo = 'todas' | 'aprobacion' | 'programadas' | 'compras' | 'devueltas' | 'finalizadas';
const ESTADOS: Record<Grupo, string[] | null> = {
  todas: null,
  aprobacion: ['pendiente_aprobacion'],
  programadas: ['programada'],
  compras: ['recibida_compras', 'enviada'],
  devueltas: ['en_correccion'],
  finalizadas: ['rechazada', 'cancelada']
};

/**
 * Consulta global de solo lectura. Distingue claramente lo que AÚN NO es de
 * Compras (pendiente de aprobación o programado) de lo que ya está en su
 * bandeja. El servidor solo entrega solicitudes ENVIADAS (nunca borradores).
 */
export function ConsultaGlobal() {
  const { cat } = useCatalogos(true);
  const [filas, setFilas] = useState<VSolicitud[] | null>(null);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [grupo, setGrupo] = useState<Grupo>('todas');
  const [area, setArea] = useState('');
  const [texto, setTexto] = useState('');
  const [soloExtra, setSoloExtra] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const consulta = useCallback((base: unknown) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (base as any).select('*', { count: 'exact' }).not('enviado_en', 'is', null);
    const est = ESTADOS[grupo];
    if (est) q = q.in('estado', est);
    if (area) q = q.eq('area_id', area);
    if (texto.trim()) q = q.ilike('numero', `%${texto.trim()}%`);
    if (soloExtra) q = q.eq('es_extraordinaria', true);
    return q;
  }, [grupo, area, texto, soloExtra]);

  const cargar = useCallback(async () => {
    setError(null);
    const { data, error: e, count } = await consulta(supabase.from('v_solicitudes'))
      .order('ultimo_envio_en', { ascending: false })
      .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1);
    if (e) { setError(limpiarError(e.message)); return; }
    setFilas((data ?? []) as VSolicitud[]);
    setTotal(count ?? 0);
  }, [consulta, pagina]);

  useActualizacionPeriodica(cargar, 60000, [cargar]);

  async function exportar() {
    const { data, error: e } = await consulta(supabase.from('v_solicitudes')).order('ultimo_envio_en', { ascending: false }).limit(5000);
    if (e) { setError(limpiarError(e.message)); return; }
    descargarCSV('consulta_solicitudes.csv', generarCSV((data ?? []) as VSolicitud[], [
      { titulo: 'Número', valor: (f) => f.numero },
      { titulo: 'Estado', valor: (f) => ETIQUETA_ESTADO_SOLICITUD[f.estado] },
      { titulo: 'En bandeja de Compras', valor: (f) => (f.en_bandeja_compras ? 'Sí' : 'No') },
      { titulo: 'Flujo', valor: (f) => (f.flujo === 'anterior' ? 'Anterior (sin aprobación previa)' : 'Con aprobación previa') },
      { titulo: 'Extraordinaria', valor: (f) => (f.es_extraordinaria ? 'Sí' : 'No') },
      { titulo: 'Solicitante', valor: (f) => f.solicitante_nombre },
      { titulo: 'Área', valor: (f) => f.area_nombre },
      { titulo: 'Centro de costo', valor: (f) => `${f.centro_costo_codigo ?? ''} ${f.centro_costo_nombre ?? ''}`.trim() },
      { titulo: 'Aprobador', valor: (f) => f.aprobador_jefe_nombre },
      { titulo: 'Creación real', valor: (f) => fmtFechaHora(f.creado_en) },
      { titulo: 'Envío a aprobación', valor: (f) => fmtFechaHora(f.ultimo_envio_en) },
      { titulo: 'Aprobación', valor: (f) => fmtFechaHora(f.aprobado_en) },
      { titulo: 'Semana objetivo', valor: (f) => etiquetaSemana(f.semana_lunes) },
      { titulo: 'Recepción programada', valor: (f) => fmtFecha(f.fecha_programada_recepcion) },
      { titulo: 'Recepción efectiva Compras', valor: (f) => fmtFechaHora(f.recibida_compras_en) },
      { titulo: 'Fecha requerida', valor: (f) => fmtFecha(f.fecha_requerida_min) },
      { titulo: 'Artículos', valor: (f) => f.total_articulos }
    ]));
  }

  return (
    <div className="contenido">
      <h1>Consulta global de solicitudes</h1>
      <p className="texto-suave">Solo lectura. Las solicitudes pendientes de aprobación o programadas <b>todavía no son de Compras</b> y así se indican.</p>
      <div className="pestanas" role="tablist">
        {([['todas', 'Todas'], ['aprobacion', 'Pendientes de aprobación'], ['programadas', 'Programadas'],
           ['compras', 'En Compras'], ['devueltas', 'Devueltas'], ['finalizadas', 'Rechazadas / canceladas']] as Array<[Grupo, string]>)
          .map(([k, t]) => (
            <button key={k} type="button" role="tab" aria-selected={grupo === k}
              className={grupo === k ? 'boton-primario' : 'boton-secundario'} onClick={() => { setPagina(1); setGrupo(k); }}>{t}</button>
          ))}
      </div>
      <div className="filtros">
        <Campo etiqueta="Número"><input value={texto} onChange={(e) => { setPagina(1); setTexto(e.target.value); }} /></Campo>
        <Campo etiqueta="Área">
          <select value={area} onChange={(e) => { setPagina(1); setArea(e.target.value); }}>
            <option value="">Todas</option>
            {cat?.areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
          </select>
        </Campo>
        <label className="campo"><span className="campo-etiqueta">Extraordinarias</span>
          <input type="checkbox" checked={soloExtra} onChange={(e) => { setPagina(1); setSoloExtra(e.target.checked); }} /></label>
        <button type="button" className="boton-secundario" onClick={() => void cargar()}>Actualizar</button>
        <button type="button" className="boton-secundario" onClick={() => void exportar()}>Exportar CSV</button>
      </div>
      <MensajeError texto={error} flotante />
      {!filas ? <Cargando /> : filas.length === 0 ? <div className="tarjeta"><p>Sin resultados.</p></div> : (
        <div className="tabla-envoltura">
          <table className="tabla">
            <thead><tr>
              <th>Número</th><th>Estado</th><th>¿De Compras?</th><th>Solicitante · área</th>
              <th>Aprobador</th><th>Enviada</th><th>Recepción</th><th className="numero">Art.</th>
            </tr></thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id}>
                  <td><Link to={`/solicitudes/${f.id}`}>{f.numero}</Link>
                    {f.es_extraordinaria ? <div><span className="insignia insignia-extra">Extraordinaria</span></div> : null}</td>
                  <td><InsigniaSolicitud estado={f.estado} /></td>
                  <td>{f.en_bandeja_compras ? 'Sí, en gestión' : <b>No, aún no</b>}</td>
                  <td>{f.solicitante_nombre} · {f.area_nombre}</td>
                  <td>{f.aprobador_jefe_nombre ?? (f.flujo === 'anterior' ? 'Flujo anterior' : '—')}</td>
                  <td>{fmtFechaHora(f.ultimo_envio_en)}</td>
                  <td>{f.recibida_compras_en ? `Recibida ${fmtFecha(f.recibida_compras_en)}` : f.fecha_programada_recepcion ? `Prevista ${fmtFecha(f.fecha_programada_recepcion)}` : '—'}</td>
                  <td className="numero">{f.total_articulos}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Paginador pagina={pagina} porPagina={POR_PAGINA} total={total} alCambiar={setPagina} />
    </div>
  );
}
