import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, limpiarError } from '../supabase.ts';
import { useActualizacionPeriodica } from '../datos.ts';
import type { VArticulo } from '../tipos.ts';
import {
  Boton, Campo, EstadoVacio, Icono, InsigniaEtapa, MensajeError, PanelLateral, Pestanas, TablaDatos,
  type ColumnaDatos
} from '../componentes/UI.tsx';
import { ArticuloGestion } from './ArticuloGestion.tsx';
import { fmtCantidad } from '../util/moneda.ts';
import { fmtFecha } from '../util/fechas.ts';
import { useEstadoURL } from '../util/estadoUrl.ts';

type Vista = 'por_llegar' | 'disponibles' | 'pendientes_entrega' | 'entregados';
const VISTAS: Array<{ id: Vista; titulo: string }> = [
  { id: 'por_llegar', titulo: 'Por llegar' },
  { id: 'disponibles', titulo: 'Disponibles en almacén' },
  { id: 'pendientes_entrega', titulo: 'Pendientes de entrega' },
  { id: 'entregados', titulo: 'Con entregas' }
];
const VACIO_URL: { vista: string; q: string; articulo: string } = { vista: 'por_llegar', q: '', articulo: '' };

/**
 * Vista de Almacén: artículos con unidades por recibir, disponibles o entregadas.
 * Muestra «recibido X de Y». Los movimientos se registran en la ficha del artículo,
 * que se abre en un panel lateral; allí no se puede entregar más de lo disponible
 * (el servidor también lo valida). Tras registrar, solo se actualiza esa fila.
 */
export function Almacen() {
  const { estado: url, cambiar } = useEstadoURL(VACIO_URL);
  const vista: Vista = VISTAS.some((v) => v.id === url.vista) ? (url.vista as Vista) : 'por_llegar';
  const texto = url.q;
  const [filas, setFilas] = useState<VArticulo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    let q = supabase.from('v_articulos').select('*')
      .in('etapa', ['comprado', 'en_transito', 'recibido_parcial', 'recibido_total', 'cerrado']);
    if (vista === 'por_llegar') q = q.gt('pendiente_llegada', 0).neq('etapa', 'cerrado');
    if (vista === 'disponibles') q = q.gt('disponible_almacen', 0);
    if (vista === 'pendientes_entrega') q = q.gt('disponible_almacen', 0).neq('etapa', 'cerrado');
    if (vista === 'entregados') q = q.gt('entregado_neto', 0);
    if (texto.trim()) q = q.ilike('nombre', `%${texto.trim()}%`);
    const { data, error: e } = await q.order('actualizado_en', { ascending: false }).limit(500);
    if (e) { setError(limpiarError(e.message)); return; }
    let lista = (data ?? []) as VArticulo[];
    // Pendiente de entrega: hay saldo en almacén y aún no se entregó lo comprado.
    if (vista === 'pendientes_entrega') {
      lista = lista.filter((x) => (x.entregado_neto ?? 0) < (x.cantidad_comprada ?? x.cantidad));
    }
    setFilas(lista);
  }, [vista, texto]);

  useActualizacionPeriodica(cargar, 60000, [cargar]);

  /** Tras un movimiento en la ficha: se reemplaza solo la fila afectada. */
  const refrescarFila = useCallback((a: VArticulo) => {
    setFilas((prev) => (prev ? prev.map((x) => (x.id === a.id ? a : x)) : prev));
  }, []);

  const abierto = filas?.find((x) => x.id === url.articulo) ?? null;
  const abrirFicha = (id: string) => cambiar({ articulo: id }, { conservarPagina: true });

  const columnas: ColumnaDatos<VArticulo>[] = [
    { clave: 'articulo', titulo: 'Artículo', render: (f) => (
      <button type="button" className="enlace" onClick={() => abrirFicha(f.id)} aria-label={`Abrir la ficha de ${f.nombre}`}>{f.nombre}</button>
    ) },
    { clave: 'solicitud', titulo: 'Solicitud', render: (f) => <Link to={`/solicitudes/${f.solicitud_id}`}>{f.solicitud_numero}</Link> },
    { clave: 'etapa', titulo: 'Etapa', render: (f) => <InsigniaEtapa etapa={f.etapa} /> },
    { clave: 'recibido', titulo: 'Recibido', render: (f) => {
      const y = f.cantidad_comprada ?? 0;
      const x = f.recibido_neto ?? 0;
      return (
        <div className="recibido">
          <span><b>{fmtCantidad(x)}</b> de {fmtCantidad(y)}</span>
          {y > 0 ? <progress max={y} value={Math.min(x, y)} aria-label={`Recibido ${fmtCantidad(x)} de ${fmtCantidad(y)}`} /> : null}
        </div>
      );
    } },
    { clave: 'disponible', titulo: 'Disponible', numerico: true, render: (f) => (
      (f.disponible_almacen ?? 0) > 0
        ? <b>{fmtCantidad(f.disponible_almacen)}</b>
        : <span className="texto-suave" title="No hay saldo para entregar">0</span>
    ) },
    { clave: 'entregado', titulo: 'Entregado', numerico: true, render: (f) => fmtCantidad(f.entregado_neto) },
    { clave: 'por_llegar', titulo: 'Por llegar', numerico: true, render: (f) => fmtCantidad(f.pendiente_llegada) },
    { clave: 'llegada', titulo: 'Llegada estimada', ocultoMovil: true, render: (f) => (f.fecha_estimada_llegada ? fmtFecha(f.fecha_estimada_llegada) : 'sin información') },
    { clave: 'atraso', titulo: 'Atraso', render: (f) => (
      f.dias_atraso === null ? <span className="texto-suave">sin info.</span>
        : f.dias_atraso > 0 ? <span className="atraso"><Icono nombre="alerta" tam={14} /> {f.dias_atraso} d</span> : '0'
    ) }
  ];

  return (
    <div className="contenido">
      <h1>Almacén</h1>
      <p className="texto-suave">Un saldo en almacén es una cantidad disponible, no una obligación de cerrar la solicitud allí.</p>
      <Pestanas etiqueta="Vistas de almacén" pestanas={VISTAS} activa={vista} alCambiar={(id) => cambiar({ vista: id })} />
      <div className="filtros">
        <Campo etiqueta="Buscar artículo">
          <input value={texto} onChange={(e) => cambiar({ q: e.target.value })} />
        </Campo>
        <Boton onClick={() => void cargar()}>Actualizar</Boton>
      </div>
      <MensajeError texto={filas ? error : null} flotante />
      <TablaDatos titulo={`Almacén: ${VISTAS.find((v) => v.id === vista)?.titulo ?? ''}`} columnas={columnas} filas={filas} clave={(f) => f.id}
        error={filas ? null : error} alReintentar={() => void cargar()}
        vacio={<EstadoVacio titulo="No hay artículos en esta vista" texto="Prueba otra vista o cambia el texto de búsqueda."
          accion={texto ? <Boton onClick={() => cambiar({ q: '' })}>Quitar la búsqueda</Boton> : undefined} />} />

      <PanelLateral titulo={abierto?.nombre ?? 'Ficha del artículo'} abierto={!!url.articulo} alCerrar={() => cambiar({ articulo: '' }, { conservarPagina: true })}>
        {url.articulo ? <ArticuloGestion idArticulo={url.articulo} enPanel alCambiar={refrescarFila} /> : null}
      </PanelLateral>
    </div>
  );
}
