import { Formulario } from '../componentes/UI.tsx';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase, limpiarError } from '../supabase.ts';
import { useSesion } from '../contexto/Sesion.tsx';
import { usePermisos } from '../permisos.ts';
import { useCatalogos, useActualizacionPeriodica, centrosDelArea } from '../datos.ts';
import type { VSolicitud, Etapa } from '../tipos.ts';
import { ETIQUETA_ESTADO_SOLICITUD, ETIQUETA_ETAPA } from '../tipos.ts';
import { Campo, MensajeError, Cargando, Modal, Paginador, InsigniaSolicitud } from '../componentes/UI.tsx';
import { CalendarioSemanas } from '../componentes/CalendarioSemanas.tsx';
import { etiquetaSemana, lunesProximaSemana, fmtFecha } from '../util/fechas.ts';
import { generarCSV, descargarCSV } from '../util/csv.ts';
import { centroInicial } from '../util/validaciones.ts';

const POR_PAGINA = 20;

type Bandeja = 'todas' | 'borradores' | 'devueltas' | 'aprobacion' | 'compras' | 'finalizadas';
const FILTRO_BANDEJA: Record<Bandeja, string[] | null> = {
  todas: null,
  borradores: ['borrador'],
  devueltas: ['en_correccion'],
  aprobacion: ['pendiente_aprobacion', 'programada'],
  compras: ['recibida_compras', 'enviada'],
  finalizadas: ['rechazada', 'cancelada']
};

function resumenEtapas(r: Record<string, number> | null): string {
  if (!r) return '—';
  return Object.entries(r).map(([k, v]) => `${v} ${ETIQUETA_ETAPA[k as Etapa] ?? k}`).join(' · ');
}

export function MisSolicitudes() {
  const { perfil } = useSesion();
  const permisos = usePermisos();
  const navegar = useNavigate();
  const { cat } = useCatalogos();
  const [filas, setFilas] = useState<VSolicitud[] | null>(null);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [bandeja, setBandeja] = useState<Bandeja>('todas');
  const [filtroTexto, setFiltroTexto] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [devueltas, setDevueltas] = useState(0);

  // Alta de solicitud
  const [abierto, setAbierto] = useState(false);
  const [ccId, setCcId] = useState('');
  const [categoria, setCategoria] = useState('');
  const [justificacion, setJustificacion] = useState('');
  const [semana, setSemana] = useState(lunesProximaSemana());
  const [extra, setExtra] = useState(false);
  const [motivoExtra, setMotivoExtra] = useState('');
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [errorAlta, setErrorAlta] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);

  const areaId = perfil?.area_id ?? null;
  const areaNombre = perfil?.area_nombre ?? cat?.areas.find((a) => a.id === areaId)?.nombre ?? null;
  const centros = useMemo(() => centrosDelArea(cat, areaId), [cat, areaId]);
  const inicialCC = centroInicial(centros.map((c) => c.id));

  useEffect(() => { if (abierto) setCcId(inicialCC.valor); }, [abierto, inicialCC.valor]);

  const cargar = useCallback(async () => {
    setError(null);
    let q = supabase.from('v_solicitudes')
      .select('*', { count: 'exact' })
      .eq('solicitante_id', perfil?.id ?? '')
      .order('creado_en', { ascending: false })
      .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1);
    const estados = FILTRO_BANDEJA[bandeja];
    if (estados) q = q.in('estado', estados);
    if (filtroTexto.trim()) q = q.ilike('numero', `%${filtroTexto.trim()}%`);
    const { data, error: e, count } = await q;
    if (e) { setError(limpiarError(e.message)); return; }
    setFilas((data ?? []) as VSolicitud[]);
    setTotal(count ?? 0);
    const { count: nDev } = await supabase.from('solicitudes').select('id', { count: 'exact', head: true })
      .eq('solicitante_id', perfil?.id ?? '').eq('estado', 'en_correccion');
    setDevueltas(nDev ?? 0);
  }, [perfil?.id, pagina, bandeja, filtroTexto]);

  useActualizacionPeriodica(cargar, 60000, [cargar]);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setErrorAlta(null);
    const errs: Record<string, string> = {};
    if (!areaId) errs.area = 'Tu usuario no tiene área asignada. Pide a administración que te vincule.';
    if (!ccId) errs.cc = centros.length === 0
      ? 'Tu área no tiene centros de costo autorizados. Avisa a administración.'
      : 'Elige el centro de costo.';
    if (extra && motivoExtra.trim().length < 10) errs.motivoExtra = 'Describe la emergencia (mínimo 10 caracteres).';
    setErrores(errs);
    if (Object.keys(errs).length > 0) return;
    setCreando(true);
    try {
      const { data, error: e1 } = await supabase.from('solicitudes').insert({
        area_id: areaId,
        centro_costo_id: ccId,
        categoria_id: categoria || null,
        justificacion: justificacion.trim() || null,
        semana_lunes: semana,
        es_extraordinaria: extra,
        motivo_extraordinaria: extra ? motivoExtra.trim() : null
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
    descargarCSV('mis_solicitudes.csv', generarCSV(filas, [
      { titulo: 'Número', valor: (f) => f.numero },
      { titulo: 'Estado', valor: (f) => ETIQUETA_ESTADO_SOLICITUD[f.estado] },
      { titulo: 'Extraordinaria', valor: (f) => (f.es_extraordinaria ? 'Sí' : 'No') },
      { titulo: 'Semana objetivo', valor: (f) => etiquetaSemana(f.semana_lunes) },
      { titulo: 'Recepción programada', valor: (f) => f.fecha_programada_recepcion ? fmtFecha(f.fecha_programada_recepcion) : 'sin información' },
      { titulo: 'Área', valor: (f) => f.area_nombre },
      { titulo: 'Centro de costo', valor: (f) => `${f.centro_costo_codigo ?? ''} ${f.centro_costo_nombre ?? ''}`.trim() },
      { titulo: 'Artículos', valor: (f) => f.total_articulos },
      { titulo: 'Avance', valor: (f) => resumenEtapas(f.resumen_etapas) },
      { titulo: 'Creada', valor: (f) => fmtFecha(f.creado_en) }
    ]));
  }

  return (
    <div className="contenido">
      <span className="sobre-titulo">COMPRAS · MI ÁREA</span>
      <h1>Solicitudes de mi área</h1>
      <p className="texto-suave">Crea un borrador, agrega los artículos y envíalo solo cuando esté completo. Primero lo revisa tu jefe y después llega a Compras.</p>
      <section className="inicio-solicitud">
        <div><span className="sobre-titulo">NUEVA NECESIDAD</span><h2>¿Qué necesitas comprar?</h2><p>Empieza con lo básico. Tus datos no se pierden y puedes continuar más tarde.</p>
          <ol className="mini-ruta" aria-label="Pasos para crear una solicitud"><li><span>1</span><div><b>Crea el borrador</b><small>Aún es privado.</small></div></li><li><span>2</span><div><b>Agrega los artículos</b><small>Con cantidades y detalles.</small></div></li><li><span>3</span><div><b>Envía a tu jefe</b><small>Compras continúa después.</small></div></li></ol>
        </div>
        <button type="button" className="boton-primario boton-inicio" onClick={() => { setErrores({}); setErrorAlta(null); setAbierto(true); }}><span aria-hidden="true">+</span> Empezar mi solicitud</button>
      </section>
      {devueltas > 0 ? (
        <section className="aviso-devolucion"><span aria-hidden="true">↩</span><div><b>Tienes {devueltas} solicitud(es) para corregir</b><p>Abre cada una, revisa el comentario del jefe y vuelve a enviarla cuando esté lista.</p></div><button type="button" className="boton-secundario" onClick={() => { setPagina(1); setBandeja('devueltas'); }}>Ver para corregir</button></section>
      ) : null}
      <div className="seccion-cabecera solicitudes-cabecera"><div><span className="sobre-titulo">SEGUIMIENTO</span><h2>Mis solicitudes</h2><p className="texto-suave">Elige una pestaña para encontrarla más rápido. Si una solicitud vuelve a ti, aparecerá en “Devueltas”.</p></div><span className="insignia-suave">{total} en esta vista</span></div>
      <div className="pestanas pestanas-solicitudes" role="tablist" aria-label="Estado de las solicitudes">
        {([['todas', 'Todas'], ['borradores', 'Borradores'], ['devueltas', `Devueltas${devueltas ? ` (${devueltas})` : ''}`],
           ['aprobacion', 'En aprobación / programadas'], ['compras', 'En Compras'], ['finalizadas', 'Rechazadas / canceladas']] as Array<[Bandeja, string]>)
          .map(([k, t]) => (
            <button key={k} type="button" role="tab" aria-selected={bandeja === k}
              className={bandeja === k ? 'boton-primario' : 'boton-secundario'}
              onClick={() => { setPagina(1); setBandeja(k); }}>{t}</button>
          ))}
      </div>
      <div className="filtros">
        <Campo etiqueta="Buscar por número">
          <input value={filtroTexto} onChange={(e) => { setPagina(1); setFiltroTexto(e.target.value); }} placeholder="SOL-2026-…" />
        </Campo>
        <button type="button" className="boton-secundario" onClick={() => void cargar()}>Actualizar</button>
        <button type="button" className="boton-secundario" onClick={exportar} disabled={!filas || filas.length === 0}>Exportar CSV</button>
      </div>
      <MensajeError texto={error} flotante />
      {!filas ? <Cargando /> : filas.length === 0 ? (
        <div className="estado-vacio"><span className="estado-icono" aria-hidden="true">+</span><h2>No hay solicitudes en esta vista</h2><p>Puedes crear una como borrador. Nadie la verá hasta que la envíes a aprobación.</p><button type="button" className="boton-primario" onClick={() => { setErrores({}); setErrorAlta(null); setAbierto(true); }}>Crear mi primera solicitud</button></div>
      ) : (
        <div className="tabla-envoltura">
          <table className="tabla">
            <thead>
              <tr>
                <th>Número</th><th>Estado</th><th>Semana objetivo</th><th>Recepción Compras</th>
                <th className="oculto-movil">Centro de costo</th>
                <th>Artículos</th><th className="oculto-movil">Creada</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id}>
                  <td><Link to={`/solicitudes/${f.id}`}>{f.numero}</Link>
                    {f.es_extraordinaria ? <> <span className="insignia insignia-extra">Extraordinaria</span></> : null}</td>
                  <td>
                    <InsigniaSolicitud estado={f.estado} />
                    {f.estado === 'en_correccion' && (f.ultimo_motivo_jefe || f.ultimo_motivo_devolucion)
                      ? <div className="texto-suave">Motivo: {f.ultimo_motivo_devolucion ?? f.ultimo_motivo_jefe}</div> : null}
                    {f.estado === 'rechazada' && f.ultimo_motivo_jefe ? <div className="texto-suave">Motivo: {f.ultimo_motivo_jefe}</div> : null}
                  </td>
                  <td>{etiquetaSemana(f.semana_lunes)}</td>
                  <td>{f.recibida_compras_en ? `Recibida ${fmtFecha(f.recibida_compras_en)}`
                       : f.fecha_programada_recepcion ? `Prevista ${fmtFecha(f.fecha_programada_recepcion)}` : '—'}</td>
                  <td className="oculto-movil">{f.centro_costo_codigo} · {f.centro_costo_nombre}</td>
                  <td className="numero">{f.total_articulos}</td>
                  <td className="oculto-movil">{fmtFecha(f.creado_en)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Paginador pagina={pagina} porPagina={POR_PAGINA} total={total} alCambiar={setPagina} />

      <Modal titulo="Nueva solicitud" abierto={abierto} alCerrar={() => setAbierto(false)}>
        <Formulario className="formulario" onSubmit={crear} noValidate>
          <div className="pasos-formulario" aria-label="Pasos para crear una solicitud"><span className="actual">1. Datos básicos</span><span>2. Fecha de compra</span><span>3. Agregar artículos</span></div>
          <p className="leyenda-campos">En este paso solo crearás un borrador. Los campos con <span className="marca-obligatorio">* obligatorio</span> son necesarios y no se enviará nada todavía.</p>
          <div className="fila-campos">
            <Campo etiqueta="Área" requerido error={errores.area} ayuda="Es el área a la que estás vinculado; la aprueba su jefe.">
              <input value={areaNombre ?? 'Sin área asignada'} readOnly />
            </Campo>
            <Campo etiqueta="Centro de costo" requerido error={errores.cc}
              ayuda={inicialCC.bloqueado ? 'Tu área tiene un único centro de costo autorizado.' : 'Solo aparecen los autorizados para tu área.'}>
              <select value={ccId} onChange={(e) => setCcId(e.target.value)} disabled={inicialCC.bloqueado}>
                <option value="">— Selecciona —</option>
                {centros.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
              </select>
            </Campo>
          </div>
          {cat && cat.categorias.length > 0 ? (
            <Campo etiqueta="Categoría" opcional ayuda="Algunas categorías (p. ej. papelería) tienen fechas especiales de recepción.">
              <select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                <option value="">— Ninguna —</option>
                {cat.categorias.map((k) => <option key={k.id} value={k.id}>{k.nombre}</option>)}
              </select>
            </Campo>
          ) : null}
          {permisos.emergencias ? (
            <div className="tarjeta" style={{ marginBottom: 0 }}>
              <label className="campo">
                <span className="campo-etiqueta">
                  <input type="checkbox" checked={extra} onChange={(e) => setExtra(e.target.checked)} /> Solicitud extraordinaria (emergencia)
                </span>
                <span className="campo-ayuda">No espera el calendario de Compras, pero SÍ requiere la aprobación de tu jefe. Úsala solo para emergencias reales (la prioridad “Alta” no es una emergencia).</span>
              </label>
              {extra ? (
                <Campo etiqueta="Motivo de la emergencia" requerido error={errores.motivoExtra}>
                  <textarea rows={2} value={motivoExtra} onChange={(e) => setMotivoExtra(e.target.value)} />
                </Campo>
              ) : null}
            </div>
          ) : null}
          <div className="campo">
            <span className="campo-etiqueta">Semana objetivo de compra<span className="marca-obligatorio"> * obligatorio</span></span>
            <span className="campo-ayuda">Cada tarjeta indica cuándo la recibiría Compras si tu jefe la aprueba antes del cierre.</span>
          </div>
          <CalendarioSemanas valor={semana} alCambiar={setSemana} categoria={categoria || null} extraordinaria={extra} />
          <Campo etiqueta="Justificación general" opcional>
            <textarea rows={2} value={justificacion} onChange={(e) => setJustificacion(e.target.value)} />
          </Campo>
          <MensajeError texto={errorAlta} />
          <div className="modal-acciones">
            <button type="button" className="boton-secundario" onClick={() => setAbierto(false)}>Cancelar</button>
            <button type="submit" className="boton-primario" disabled={creando}>
              {creando ? 'Creando borrador…' : 'Continuar para agregar artículos'}
            </button>
          </div>
        </Formulario>
      </Modal>
    </div>
  );
}
