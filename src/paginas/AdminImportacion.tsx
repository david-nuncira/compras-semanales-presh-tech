import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, rpc, limpiarError, nuevoOp } from '../supabase.ts';
import { useCatalogos } from '../datos.ts';
import { Campo, MensajeError, MensajeExito, Cargando, Modal } from '../componentes/UI.tsx';
import { analizarCSVHistorico, type ResultadoAnalisis, type FilaHistorico } from '../util/csvHistorico.ts';
import { generarCSV, descargarCSV } from '../util/csv.ts';
import { lunesProximaSemana, lunesDeSemana, fmtFechaHora } from '../util/fechas.ts';

interface Lote {
  id: string; nombre_archivo: string; total_filas: number;
  estado: 'en_revision' | 'procesado'; creado_en: string;
}
interface FilaBD {
  id: string; lote_id: string; numero_fila: number;
  fecha_texto: string | null; fecha_interpretada: string | null; fecha_confiable: boolean;
  nombre_articulo: string | null; cantidad_texto: string | null; cantidad: number | null;
  descripcion: string | null; justificacion: string | null; observacion_compras: string | null;
  imagen_texto: string | null; estatus_original: string | null; extra_notas: string | null;
  problemas: string[]; estado_fila: 'pendiente' | 'aprobada' | 'rechazada' | 'importada';
  area_id: string | null; centro_costo_id: string | null;
  solicitud_id: string | null; articulo_id: string | null; version: number;
}
interface Mapeo { texto_original: string; etiqueta_normalizada: string; confirmado: boolean; }

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function AdminImportacion() {
  const { cat } = useCatalogos();
  const [analisis, setAnalisis] = useState<ResultadoAnalisis | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [nombreArchivo, setNombreArchivo] = useState('');
  const [soloProblemas, setSoloProblemas] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const [lotes, setLotes] = useState<Lote[] | null>(null);
  const [loteAbierto, setLoteAbierto] = useState<Lote | null>(null);
  const [filasBD, setFilasBD] = useState<FilaBD[]>([]);
  const [filtroEstado, setFiltroEstado] = useState<'pendiente' | 'aprobada' | 'rechazada' | 'importada' | 'todas'>('pendiente');
  const [areaLote, setAreaLote] = useState('');
  const [ccLote, setCcLote] = useState('');
  const [mapeos, setMapeos] = useState<Mapeo[]>([]);
  const [convertir, setConvertir] = useState<FilaBD | null>(null);
  const [semanaConv, setSemanaConv] = useState(lunesProximaSemana());
  const [mError, setMError] = useState<string | null>(null);

  const cargarLotes = useCallback(async () => {
    const [rl, rm] = await Promise.all([
      supabase.from('importacion_lotes').select('*').order('creado_en', { ascending: false }),
      supabase.from('importacion_mapeo_estados').select('*').order('texto_original')
    ]);
    if (rl.error) { setError(limpiarError(rl.error.message)); return; }
    setLotes((rl.data ?? []) as Lote[]);
    setMapeos((rm.data ?? []) as Mapeo[]);
  }, []);

  useEffect(() => { void cargarLotes(); }, [cargarLotes]);

  async function cargarFilas(lote: Lote) {
    setLoteAbierto(lote);
    const { data, error: e } = await supabase.from('importacion_filas')
      .select('*').eq('lote_id', lote.id).order('numero_fila');
    if (e) { setError(limpiarError(e.message)); return; }
    setFilasBD((data ?? []) as FilaBD[]);
  }

  function alElegirArchivo(f: File) {
    setError(null); setExito(null); setAnalisis(null); setBytes(null);
    setNombreArchivo(f.name);
    const lector = new FileReader();
    lector.onload = () => {
      try {
        const b = new Uint8Array(lector.result as ArrayBuffer);
        setBytes(b);
        setAnalisis(analizarCSVHistorico(b));
      } catch (err) {
        setError('No fue posible analizar el archivo: ' + (err instanceof Error ? err.message : String(err)));
      }
    };
    lector.onerror = () => setError('No fue posible leer el archivo.');
    lector.readAsArrayBuffer(f);
  }

  function descargarInforme() {
    if (!analisis) return;
    const filas = analisis.filas;
    descargarCSV('informe_revision_csv.csv', generarCSV(filas, [
      { titulo: 'Fila', valor: (f) => f.numeroFila },
      { titulo: 'Fecha (texto original)', valor: (f) => f.fechaTexto },
      { titulo: 'Artículo', valor: (f) => f.nombre },
      { titulo: 'Cantidad (texto original)', valor: (f) => f.cantidadTexto },
      { titulo: 'Columna Imagen (texto, no archivo)', valor: (f) => f.imagenTexto },
      { titulo: 'Descripción', valor: (f) => f.descripcion },
      { titulo: 'Justificación', valor: (f) => f.justificacion },
      { titulo: 'Observación Compras', valor: (f) => f.observacionCompras },
      { titulo: 'Estatus original', valor: (f) => f.estatusOriginal },
      { titulo: 'Notas fuera de formato', valor: (f) => f.extraNotas },
      { titulo: 'Problemas detectados', valor: (f) => f.problemas.join(' | ') }
    ]));
  }

  async function cargarAZonaRevision() {
    if (!analisis || !bytes) return;
    setError(null); setExito(null); setCargando(true);
    try {
      const hash = await sha256Hex(bytes);
      const r = await rpc<{ lote_id: string }>('fn_importacion_crear_lote', {
        p_nombre: nombreArchivo, p_hash: hash,
        p_total: analisis.filas.length, p_op: nuevoOp()
      });
      const porLotes: FilaHistorico[][] = [];
      for (let i = 0; i < analisis.filas.length; i += 50) porLotes.push(analisis.filas.slice(i, i + 50));
      for (const grupo of porLotes) {
        await rpc('fn_importacion_insertar_filas', {
          p_lote: r.lote_id,
          p_filas: grupo.map((f) => ({
            numero_fila: f.numeroFila,
            datos_originales: f.datosOriginales,
            fecha_texto: f.fechaTexto,
            nombre: f.nombre,
            cantidad_texto: f.cantidadTexto,
            descripcion: f.descripcion,
            justificacion: f.justificacion,
            observacion_compras: f.observacionCompras,
            imagen_texto: f.imagenTexto,
            estatus_original: f.estatusOriginal,
            extra_notas: f.extraNotas
          }))
        });
      }
      setExito(`Archivo cargado a la zona de revisión (${analisis.filas.length} filas). El servidor revalida fechas y cantidades por su cuenta. Nada entra al histórico oficial hasta que apruebes filas y confirmes.`);
      await cargarLotes();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCargando(false);
    }
  }

  async function revisarFila(f: FilaBD, accion: 'aprobar' | 'rechazar' | 'pendiente') {
    setError(null);
    try {
      await rpc('fn_importacion_revisar_fila', {
        p_fila: f.id, p_accion: accion,
        p_area: areaLote || null, p_centro_costo: ccLote || null,
        p_version: f.version
      });
      if (loteAbierto) await cargarFilas(loteAbierto);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }

  async function confirmarLote() {
    if (!loteAbierto) return;
    setError(null); setExito(null);
    try {
      const r = await rpc<{ importadas_ahora: number; total_importadas: number; rechazadas: number; pendientes: number; total_lote: number }>(
        'fn_importacion_confirmar', { p_lote: loteAbierto.id, p_op: nuevoOp() });
      setExito(`Conciliación del lote: leídas ${r.total_lote} · importadas ahora ${r.importadas_ahora} · importadas en total ${r.total_importadas} · rechazadas ${r.rechazadas} · pendientes ${r.pendientes}. Repetir la confirmación no duplica.`);
      await cargarLotes();
      await cargarFilas(loteAbierto);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }

  const filasVisibles = filasBD.filter((f) => filtroEstado === 'todas' || f.estado_fila === filtroEstado);

  return (
    <div className="contenido">
      <h1>Administración · Importación del CSV histórico</h1>
      <div className="acciones-fila">
        <Link to="/admin">Usuarios</Link> · <Link to="/admin/catalogos">Catálogos</Link> ·
        {' '}<Link to="/admin/auditoria">Auditoría</Link> · <Link to="/admin/recuperacion">Recuperación</Link> ·
        {' '}<Link to="/admin/importacion">Importación CSV</Link>
      </div>
      <p className="texto-suave">
        Flujo: analizar el archivo → cargar a la zona de revisión → aprobar filas válidas
        (asignando área y centro de costo) → confirmar. Las filas importadas quedan como
        <b> histórico consultable</b>: no fabrican movimientos, aprobaciones ni costos
        (sus importes son “sin información”). Un renglón aún vigente puede convertirse en
        una <b>solicitud nueva</b> explícitamente. No se inventan fechas, años ni imágenes.
      </p>
      <MensajeError texto={error} />
      <MensajeExito texto={exito} />

      <div className="tarjeta">
        <h2>1 · Analizar archivo (no guarda nada todavía)</h2>
        <p>
          <input type="file" accept=".csv,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) alElegirArchivo(f); }} />
        </p>
        {analisis ? (
          <>
            <p>
              <b>{nombreArchivo}</b>: {analisis.totalRegistrosLogicos} registros lógicos · encabezado en la fila {analisis.indiceEncabezado + 1} ·
              {' '}{analisis.filas.length} filas de datos · {analisis.filasConNombre} con nombre de artículo ·
              {' '}{analisis.filas.filter((f) => f.problemas.length > 0).length} con problemas marcados.
            </p>
            <p className="texto-suave">
              Estados encontrados (tal cual): {Object.entries(analisis.estatusDistintos).map(([k, v]) => `${k}: ${v}`).join(' · ')}
            </p>
            {analisis.advertenciasGlobales.map((a, i) => <p key={i} className="mensaje mensaje-error">{a}</p>)}
            <div className="acciones-fila">
              <button type="button" className="boton-secundario" onClick={descargarInforme}>Descargar informe de revisión (CSV)</button>
              <button type="button" className="boton-primario" onClick={() => void cargarAZonaRevision()} disabled={cargando}>
                {cargando ? 'Cargando…' : '2 · Cargar a la zona de revisión'}
              </button>
              <label><input type="checkbox" checked={soloProblemas} onChange={(e) => setSoloProblemas(e.target.checked)} /> ver solo filas con problemas</label>
            </div>
            <div className="tabla-envoltura">
              <table className="tabla">
                <thead><tr><th>Fila</th><th>Fecha</th><th>Artículo</th><th>Cant.</th><th>Estatus</th><th>Columna Imagen</th><th>Problemas</th></tr></thead>
                <tbody>
                  {analisis.filas.filter((f) => !soloProblemas || f.problemas.length > 0).slice(0, 200).map((f) => (
                    <tr key={f.numeroFila}>
                      <td>{f.numeroFila}</td>
                      <td>{f.fechaTexto || <span className="texto-suave">vacía</span>}</td>
                      <td>{f.nombre || <span className="texto-suave">sin nombre</span>}</td>
                      <td>{f.cantidadTexto || <span className="texto-suave">vacía</span>}</td>
                      <td>{f.estatusOriginal || <span className="texto-suave">vacío</span>}</td>
                      <td className="texto-suave">{f.imagenTexto}</td>
                      <td className="texto-suave">{f.problemas.join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : <p className="texto-suave">El analizador entiende Windows-1252, separador “;”, comillas y texto multilínea.</p>}
      </div>

      <div className="tarjeta">
        <h2>3 · Zona de revisión (lotes cargados)</h2>
        {!lotes ? <Cargando /> : lotes.length === 0 ? <p className="texto-suave">Sin lotes. Repetir el mismo archivo no crea lotes duplicados (se detecta por huella SHA-256).</p> : (
          <ul>
            {lotes.map((l) => (
              <li key={l.id}>
                <button type="button" className="enlace" onClick={() => void cargarFilas(l)}>{l.nombre_archivo}</button>
                {' '}· {l.total_filas} filas · {l.estado === 'en_revision' ? 'en revisión' : 'procesado'} · {fmtFechaHora(l.creado_en)}
              </li>
            ))}
          </ul>
        )}
        {loteAbierto ? (
          <>
            <hr className="separador" />
            <h3>Lote: {loteAbierto.nombre_archivo}</h3>
            <div className="filtros">
              <Campo etiqueta="Ver filas">
                <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value as typeof filtroEstado)}>
                  <option value="pendiente">Pendientes</option>
                  <option value="aprobada">Aprobadas</option>
                  <option value="rechazada">Rechazadas</option>
                  <option value="importada">Importadas</option>
                  <option value="todas">Todas</option>
                </select>
              </Campo>
              <Campo etiqueta="Área a asignar al aprobar">
                <select value={areaLote} onChange={(e) => setAreaLote(e.target.value)}>
                  <option value="">—</option>
                  {cat?.areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                </select>
              </Campo>
              <Campo etiqueta="Centro de costo a asignar">
                <select value={ccLote} onChange={(e) => setCcLote(e.target.value)}>
                  <option value="">—</option>
                  {cat?.centros.map((c) => <option key={c.id} value={c.id}>{c.codigo}</option>)}
                </select>
              </Campo>
              <button type="button" className="boton-primario" onClick={() => void confirmarLote()}>4 · Confirmar lote (importa solo las aprobadas)</button>
            </div>
            <div className="tabla-envoltura">
              <table className="tabla">
                <thead><tr><th>Fila</th><th>Fecha</th><th>Artículo</th><th>Cant.</th><th>Estatus original</th><th>Problemas</th><th>Estado</th><th>Acciones</th></tr></thead>
                <tbody>
                  {filasVisibles.slice(0, 300).map((f) => (
                    <tr key={f.id}>
                      <td>{f.numero_fila}</td>
                      <td>{f.fecha_confiable ? f.fecha_interpretada : <span className="texto-suave">{f.fecha_texto ?? 'vacía'} (dudosa)</span>}</td>
                      <td>{f.nombre_articulo ?? <span className="texto-suave">sin nombre</span>}</td>
                      <td>{f.cantidad ?? <span className="texto-suave">{f.cantidad_texto ?? '—'}</span>}</td>
                      <td>{f.estatus_original ?? ''}</td>
                      <td className="texto-suave">{f.problemas.join(' · ')}</td>
                      <td>{f.estado_fila}</td>
                      <td>
                        <div className="acciones-fila">
                          {f.estado_fila !== 'importada' ? (
                            <>
                              <button type="button" className="boton-silencioso" onClick={() => void revisarFila(f, 'aprobar')}>Aprobar</button>
                              <button type="button" className="boton-silencioso" onClick={() => void revisarFila(f, 'rechazar')}>Rechazar</button>
                            </>
                          ) : null}
                          {f.estado_fila === 'importada' && !f.articulo_id && f.cantidad && f.nombre_articulo ? (
                            <button type="button" className="boton-silencioso" onClick={() => { setMError(null); setConvertir(f); }}>Convertir en solicitud…</button>
                          ) : null}
                          {f.solicitud_id ? <span className="texto-suave">→ convertida</span> : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="texto-suave">
              El estado histórico se conserva como fue declarado; la normalización de abajo es
              solo una etiqueta de presentación y requiere confirmación explícita.
            </p>
          </>
        ) : null}
      </div>

      <div className="tarjeta">
        <h2>Mapeo de estados históricos (explícito y revisable)</h2>
        {mapeos.length === 0 ? <p className="texto-suave">Sin mapeos.</p> : (
          <table className="tabla">
            <thead><tr><th>Texto original</th><th>Etiqueta normalizada</th><th>Confirmado</th><th></th></tr></thead>
            <tbody>
              {mapeos.map((m) => (
                <tr key={m.texto_original}>
                  <td>{m.texto_original}</td>
                  <td>{m.etiqueta_normalizada}</td>
                  <td>{m.confirmado ? 'Sí' : 'No (propuesta)'}</td>
                  <td>
                    {!m.confirmado ? (
                      <button type="button" className="boton-silencioso" onClick={async () => {
                        try {
                          await rpc('fn_importacion_mapear_estado', { p_texto: m.texto_original, p_etiqueta: m.etiqueta_normalizada, p_confirmado: true });
                          await cargarLotes();
                        } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
                      }}>Confirmar</button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal titulo={`Convertir fila ${convertir?.numero_fila ?? ''} en solicitud nueva`} abierto={!!convertir} alCerrar={() => setConvertir(null)}>
        {convertir ? (
          <form className="formulario" onSubmit={async (e) => {
            e.preventDefault(); setMError(null);
            try {
              const r = await rpc<{ numero: string }>('fn_importacion_convertir_en_solicitud', {
                p_fila: convertir.id, p_semana: lunesDeSemana(semanaConv), p_op: nuevoOp()
              });
              setConvertir(null);
              setExito(`Se creó la solicitud ${r.numero} en borrador (origen: histórico). Revisa sus datos y envíala desde "Mis solicitudes".`);
              if (loteAbierto) await cargarFilas(loteAbierto);
            } catch (err) { setMError(err instanceof Error ? err.message : String(err)); }
          }}>
            <p><b>{convertir.nombre_articulo}</b> · cantidad {convertir.cantidad} · estatus declarado “{convertir.estatus_original}”.</p>
            <p className="texto-suave">Se crea una solicitud EN BORRADOR a tu nombre con área/centro asignados en la revisión. No se fabrican movimientos ni aprobaciones históricas.</p>
            <Campo etiqueta="Semana objetivo (cualquier día de esa semana)" requerido>
              <input type="date" value={semanaConv} onChange={(e) => setSemanaConv(e.target.value)} />
            </Campo>
            <MensajeError texto={mError} />
            <div className="modal-acciones">
              <button type="button" className="boton-secundario" onClick={() => setConvertir(null)}>Cancelar</button>
              <button type="submit" className="boton-primario">Crear solicitud en borrador</button>
            </div>
          </form>
        ) : null}
      </Modal>
    </div>
  );
}
