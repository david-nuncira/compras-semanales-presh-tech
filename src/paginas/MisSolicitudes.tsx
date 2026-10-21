import { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase, limpiarError } from '../supabase.ts';
import { useSesion } from '../contexto/Sesion.tsx';
import { useCatalogos, useActualizacionPeriodica } from '../datos.ts';
import type { VSolicitud } from '../tipos.ts';
import { ETIQUETA_ESTADO_SOLICITUD, ETIQUETA_ETAPA } from '../tipos.ts';
import type { Etapa } from '../tipos.ts';
import { Campo, MensajeError, Cargando, Modal, Paginador } from '../componentes/UI.tsx';
import { etiquetaSemana, lunesProximaSemana, lunesDeSemana, fmtFecha } from '../util/fechas.ts';
import { generarCSV, descargarCSV } from '../util/csv.ts';

const POR_PAGINA = 20;

function resumenEtapas(r: Record<string, number> | null): string {
  if (!r) return '—';
  return Object.entries(r)
    .map(([k, v]) => `${v} ${ETIQUETA_ETAPA[k as Etapa] ?? k}`)
    .join(' · ');
}

export function MisSolicitudes() {
  const { perfil } = useSesion();
  const navegar = useNavigate();
  const { cat } = useCatalogos();
  const [filas, setFilas] = useState<VSolicitud[] | null>(null);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [filtroEstado, setFiltroEstado] = useState('');
  const [filtroTexto, setFiltroTexto] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Alta de solicitud
  const [abierto, setAbierto] = useState(false);
  const [areaId, setAreaId] = useState('');
  const [ccId, setCcId] = useState('');
  const [justificacion, setJustificacion] = useState('');
  const [semana, setSemana] = useState(lunesProximaSemana());
  const [fechaDeclarada, setFechaDeclarada] = useState('');
  const [errorAlta, setErrorAlta] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);

  const cargar = useCallback(async () => {
    setError(null);
    let q = supabase.from('v_solicitudes')
      .select('*', { count: 'exact' })
      .eq('solicitante_id', perfil?.id ?? '')
      .order('creado_en', { ascending: false })
      .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1);
    if (filtroEstado) q = q.eq('estado', filtroEstado);
    if (filtroTexto.trim()) q = q.ilike('numero', `%${filtroTexto.trim()}%`);
    const { data, error: e, count } = await q;
    if (e) { setError(limpiarError(e.message)); return; }
    setFilas((data ?? []) as VSolicitud[]);
    setTotal(count ?? 0);
  }, [perfil?.id, pagina, filtroEstado, filtroTexto]);

  useActualizacionPeriodica(cargar, 60000, [cargar]);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setErrorAlta(null);
    if (!areaId || !ccId) { setErrorAlta('Selecciona área y centro de costo.'); return; }
    setCreando(true);
    try {
      const { data, error: e1 } = await supabase.from('solicitudes').insert({
        area_id: areaId,
        centro_costo_id: ccId,
        justificacion: justificacion.trim() || null,
        semana_lunes: lunesDeSemana(semana),
        fecha_declarada: fechaDeclarada || null
      }).select('id').single();
      if (e1) throw new Error(limpiarError(e1.message));
      navegar(`/solicitudes/${(data as { id: string }).id}`);
    } catch (err) {
      setErrorAlta(err instanceof Error ? err.message : String(err));
    } finally {
      setCreando(false);
    }
  }

  function exportar() {
    if (!filas) return;
    const csv = generarCSV(filas, [
      { titulo: 'Número', valor: (f) => f.numero },
      { titulo: 'Estado', valor: (f) => ETIQUETA_ESTADO_SOLICITUD[f.estado] },
      { titulo: 'Semana objetivo', valor: (f) => etiquetaSemana(f.semana_lunes) },
      { titulo: 'Área', valor: (f) => f.area_nombre },
      { titulo: 'Centro de costo', valor: (f) => f.centro_costo_codigo },
      { titulo: 'Artículos', valor: (f) => f.total_articulos },
      { titulo: 'Avance', valor: (f) => resumenEtapas(f.resumen_etapas) },
      { titulo: 'Creada', valor: (f) => fmtFecha(f.creado_en) }
    ]);
    descargarCSV('mis_solicitudes.csv', csv);
  }

  return (
    <div className="contenido">
      <h1>Mis solicitudes</h1>
      <div className="filtros">
        <Campo etiqueta="Estado">
          <select value={filtroEstado} onChange={(e) => { setPagina(1); setFiltroEstado(e.target.value); }}>
            <option value="">Todos</option>
            <option value="borrador">Borrador</option>
            <option value="enviada">Enviada</option>
            <option value="en_correccion">En corrección</option>
            <option value="cancelada">Cancelada</option>
          </select>
        </Campo>
        <Campo etiqueta="Buscar por número">
          <input value={filtroTexto} onChange={(e) => { setPagina(1); setFiltroTexto(e.target.value); }} placeholder="SOL-2026-…" />
        </Campo>
        <button type="button" className="boton-secundario" onClick={() => void cargar()}>Actualizar</button>
        <button type="button" className="boton-secundario" onClick={exportar} disabled={!filas || filas.length === 0}>Exportar CSV</button>
        <button type="button" className="boton-primario" onClick={() => setAbierto(true)}>+ Nueva solicitud</button>
      </div>
      <MensajeError texto={error} />
      {!filas ? <Cargando /> : filas.length === 0 ? (
        <div className="tarjeta"><p>No tienes solicitudes todavía. Crea la primera con “+ Nueva solicitud”.</p></div>
      ) : (
        <div className="tabla-envoltura">
          <table className="tabla">
            <thead>
              <tr>
                <th>Número</th><th>Estado</th><th>Semana objetivo</th>
                <th className="oculto-movil">Área / CC</th>
                <th>Artículos</th><th>Avance</th><th className="oculto-movil">Creada</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id}>
                  <td><Link to={`/solicitudes/${f.id}`}>{f.numero}</Link></td>
                  <td>{ETIQUETA_ESTADO_SOLICITUD[f.estado]}</td>
                  <td>{etiquetaSemana(f.semana_lunes)}</td>
                  <td className="oculto-movil">{f.area_nombre} / {f.centro_costo_codigo}</td>
                  <td className="numero">{f.total_articulos}</td>
                  <td>{resumenEtapas(f.resumen_etapas)}</td>
                  <td className="oculto-movil">{fmtFecha(f.creado_en)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Paginador pagina={pagina} porPagina={POR_PAGINA} total={total} alCambiar={setPagina} />

      <Modal titulo="Nueva solicitud" abierto={abierto} alCerrar={() => setAbierto(false)}>
        <form className="formulario" onSubmit={crear}>
          <div className="fila-campos">
            <Campo etiqueta="Área" requerido>
              <select value={areaId} onChange={(e) => setAreaId(e.target.value)}>
                <option value="">— Selecciona —</option>
                {cat?.areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
              </select>
            </Campo>
            <Campo etiqueta="Centro de costo" requerido>
              <select value={ccId} onChange={(e) => setCcId(e.target.value)}>
                <option value="">— Selecciona —</option>
                {cat?.centros.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
              </select>
            </Campo>
          </div>
          <Campo etiqueta="Semana objetivo de compra (se guarda el lunes de esa semana)" requerido>
            <input type="date" value={semana} onChange={(e) => setSemana(e.target.value)} />
          </Campo>
          <p className="texto-suave">{etiquetaSemana(lunesDeSemana(semana || lunesProximaSemana()))}</p>
          <Campo etiqueta="Justificación general">
            <textarea rows={2} value={justificacion} onChange={(e) => setJustificacion(e.target.value)} />
          </Campo>
          <Campo etiqueta="Fecha declarada (opcional, si el papel/Excel tenía otra fecha)">
            <input type="date" value={fechaDeclarada} onChange={(e) => setFechaDeclarada(e.target.value)} />
          </Campo>
          <MensajeError texto={errorAlta} />
          <div className="modal-acciones">
            <button type="button" className="boton-secundario" onClick={() => setAbierto(false)}>Cancelar</button>
            <button type="submit" className="boton-primario" disabled={creando}>
              {creando ? 'Creando…' : 'Crear borrador'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
