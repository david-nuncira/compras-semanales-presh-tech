import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, rpc, limpiarError } from '../supabase.ts';
import { useSesion } from '../contexto/Sesion.tsx';
import { useActualizacionPeriodica } from '../datos.ts';
import type { VSolicitud, Etapa } from '../tipos.ts';
import { ETIQUETA_ESTADO_SOLICITUD, ETIQUETA_ETAPA } from '../tipos.ts';
import { Campo, MensajeError, MensajeExito, Cargando, Paginador, InsigniaSolicitud, Icono, Pestanas, ModalConfirmar, BotonConMotivo } from '../componentes/UI.tsx';
import { etiquetaSemana, fmtFecha } from '../util/fechas.ts';
import { generarCSV, descargarCSV } from '../util/csv.ts';
import { useEstadoURL } from '../util/estadoUrl.ts';
import { pedidoCerrado } from '../util/cierre.ts';
import { PasoAPaso } from '../componentes/PasoAPaso.tsx';

const POR_PAGINA = 20;
const VACIO_URL: { bandeja: string; q: string } = { bandeja: 'todas', q: '' };

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
  const [filas, setFilas] = useState<VSolicitud[] | null>(null);
  const [total, setTotal] = useState(0);
  // Bandeja, búsqueda y página viven en la URL: «Atrás» conserva la posición.
  const { estado: filtrosUrl, pagina, cambiar, irAPagina } = useEstadoURL(VACIO_URL);
  const bandeja: Bandeja = filtrosUrl.bandeja in FILTRO_BANDEJA ? (filtrosUrl.bandeja as Bandeja) : 'todas';
  const filtroTexto = filtrosUrl.q;
  const [error, setError] = useState<string | null>(null);
  const [devueltas, setDevueltas] = useState(0);
  const [porEliminar, setPorEliminar] = useState<VSolicitud | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

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
      <PasoAPaso pantalla="mis-solicitudes" />
      <section className="inicio-solicitud">
        <div><span className="sobre-titulo">NUEVA NECESIDAD</span><h2>¿Qué necesitas comprar?</h2><p>Empieza con lo básico. Tus datos no se pierden y puedes continuar más tarde.</p>
          <ol className="mini-ruta" aria-label="Pasos para crear una solicitud"><li><span>1</span><div><b>Crea el borrador</b><small>Aún es privado.</small></div></li><li><span>2</span><div><b>Agrega los artículos</b><small>Con cantidades y detalles.</small></div></li><li><span>3</span><div><b>Envía a tu jefe</b><small>Compras continúa después.</small></div></li></ol>
        </div>
        <Link className="boton-primario boton-inicio enlace-boton" to="/nueva-solicitud"><span aria-hidden="true">+</span> Empezar mi solicitud</Link>
      </section>
      {devueltas > 0 ? (
        <section className="aviso-devolucion"><span aria-hidden="true">↩</span><div><b>Tienes {devueltas} solicitud(es) para corregir</b><p>Abre cada una, revisa el comentario del jefe y vuelve a enviarla cuando esté lista.</p></div><button type="button" className="boton-secundario" onClick={() => cambiar({ bandeja: 'devueltas' })}>Ver para corregir</button></section>
      ) : null}
      <div className="seccion-cabecera solicitudes-cabecera"><div><span className="sobre-titulo">SEGUIMIENTO</span><h2>Mis solicitudes</h2><p className="texto-suave">Elige una pestaña para encontrarla más rápido. Si una solicitud vuelve a ti, aparecerá en “Devueltas”.</p></div><span className="insignia-suave">{total} en esta vista</span></div>
      <Pestanas etiqueta="Bandejas de solicitudes" activa={bandeja} alCambiar={(k) => cambiar({ bandeja: k })}
        pestanas={[
          { id: 'todas', titulo: 'Todas' }, { id: 'borradores', titulo: 'Borradores' },
          { id: 'devueltas', titulo: 'Devueltas', contador: devueltas || undefined },
          { id: 'aprobacion', titulo: 'En aprobación / programadas' }, { id: 'compras', titulo: 'En Compras' },
          { id: 'finalizadas', titulo: 'Rechazadas / canceladas' }
        ]} />
      <div className="filtros">
        <Campo etiqueta="Buscar por número">
          <input value={filtroTexto} onChange={(e) => cambiar({ q: e.target.value })} placeholder="SOL-2026-…" />
        </Campo>
        <button type="button" className="boton-secundario" onClick={() => void cargar()}>Actualizar</button>
        <button type="button" className="boton-secundario" onClick={exportar} disabled={!filas || filas.length === 0}>Exportar CSV</button>
        <Link className="boton-primario enlace-boton" to="/nueva-solicitud"><Icono nombre="mas" /> Nueva solicitud</Link>
      </div>
      <MensajeError texto={error} flotante />
      {!filas ? <Cargando /> : filas.length === 0 ? (
        <div className="estado-vacio"><span className="estado-icono" aria-hidden="true">+</span><h2>No hay solicitudes en esta vista</h2><p>Puedes crear una como borrador. Nadie la verá hasta que la envíes a aprobación.</p><Link className="boton-primario enlace-boton" to="/nueva-solicitud">Crear mi primera solicitud</Link></div>
      ) : (
        <div className="tabla-envoltura">
          <table className="tabla">
            <thead>
              <tr>
                <th>Número</th><th>Estado</th><th>Semana objetivo</th><th>Recepción Compras</th>
                <th className="oculto-movil">Centro de costo</th>
                <th>Artículos</th><th className="oculto-movil">Creada</th><th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id}>
                  <td><Link to={`/solicitudes/${f.id}`}>{f.numero}</Link>
                    {f.estado === 'borrador' ? <div><Link to={`/nueva-solicitud/${f.id}?paso=2`}>Continuar</Link></div> : null}
                    {f.estado === 'en_correccion' ? <div><Link to={`/nueva-solicitud/${f.id}?paso=2`}>Corregir y reenviar</Link></div> : null}
                    {f.es_extraordinaria ? <> <span className="insignia insignia-extra">Extraordinaria</span></> : null}</td>
                  <td>
                    <InsigniaSolicitud estado={f.estado} cerrada={pedidoCerrado(f)} />
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
                  <td>
                    <div className="acciones-fila">
                      <Link to={`/solicitudes/${f.id}`}>Ver</Link>
                      {f.estado === 'borrador' || f.estado === 'en_correccion'
                        ? <Link to={`/nueva-solicitud/${f.id}?paso=2`}>Editar</Link> : null}
                      {f.estado === 'borrador'
                        ? <button type="button" className="boton-silencioso" onClick={() => setPorEliminar(f)}>Eliminar</button> : null}
                      {f.estado === 'en_correccion'
                        ? <BotonConMotivo etiqueta="Cancelar" clase="boton-silencioso" titulo={`Cancelar ${f.numero}`} descripcion="La solicitud se cancela y queda registrada con tu motivo. No se puede deshacer."
                            onConfirmar={async (motivo) => { await rpc('fn_cancelar_solicitud', { p_solicitud: f.id, p_motivo: motivo, p_version: f.version }); await cargar(); }} /> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Paginador pagina={pagina} porPagina={POR_PAGINA} total={total} alCambiar={irAPagina} />
      <MensajeExito texto={aviso} />
      <ModalConfirmar abierto={!!porEliminar} titulo="Eliminar borrador" peligro etiqueta="Eliminar"
        texto={`¿Eliminar el borrador ${porEliminar?.numero ?? ''} con sus artículos? Aún no se ha enviado a nadie. No se puede deshacer.`}
        alConfirmar={async () => {
          if (!porEliminar) return;
          const a = await supabase.from('articulos').delete().eq('solicitud_id', porEliminar.id);
          if (a.error) throw new Error(limpiarError(a.error.message));
          const s = await supabase.from('solicitudes').delete().eq('id', porEliminar.id).select('id');
          if (s.error) throw new Error(limpiarError(s.error.message));
          if (!s.data || s.data.length === 0) throw new Error('No se pudo eliminar: solo se eliminan borradores que aún no se enviaron.');
          setAviso(`Borrador ${porEliminar.numero} eliminado.`);
          await cargar();
        }} alCerrar={() => setPorEliminar(null)} />

    </div>
  );
}
