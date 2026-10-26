import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, limpiarError } from '../supabase.ts';
import { useActualizacionPeriodica } from '../datos.ts';
import type { VArticulo } from '../tipos.ts';
import { MensajeError, Cargando, InsigniaEtapa, Campo } from '../componentes/UI.tsx';
import { fmtCantidad } from '../util/moneda.ts';
import { fmtFecha } from '../util/fechas.ts';

/**
 * Vista de Almacén: artículos con unidades por recibir, disponibles o entregadas.
 * Los movimientos se registran desde la ficha del artículo.
 */
export function Almacen() {
  const [filas, setFilas] = useState<VArticulo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vista, setVista] = useState<'por_llegar' | 'disponibles' | 'pendientes_entrega' | 'entregados'>('por_llegar');
  const [texto, setTexto] = useState('');

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

  return (
    <div className="contenido">
      <h1>Almacén</h1>
      <p className="texto-suave">Un saldo en almacén es una cantidad disponible, no una obligación de cerrar la solicitud allí.</p>
      <div className="filtros">
        <div className="acciones-fila" role="tablist">
          <button type="button" className={vista === 'por_llegar' ? 'boton-primario' : 'boton-secundario'} onClick={() => setVista('por_llegar')}>Por llegar</button>
          <button type="button" className={vista === 'disponibles' ? 'boton-primario' : 'boton-secundario'} onClick={() => setVista('disponibles')}>Disponibles en almacén</button>
          <button type="button" className={vista === 'pendientes_entrega' ? 'boton-primario' : 'boton-secundario'} onClick={() => setVista('pendientes_entrega')}>Pendientes de entrega</button>
          <button type="button" className={vista === 'entregados' ? 'boton-primario' : 'boton-secundario'} onClick={() => setVista('entregados')}>Con entregas</button>
        </div>
        <Campo etiqueta="Buscar artículo">
          <input value={texto} onChange={(e) => setTexto(e.target.value)} />
        </Campo>
        <button type="button" className="boton-secundario" onClick={() => void cargar()}>Actualizar</button>
      </div>
      <MensajeError texto={error} />
      {!filas ? <Cargando /> : filas.length === 0 ? (
        <div className="tarjeta"><p>No hay artículos en esta vista.</p></div>
      ) : (
        <div className="tabla-envoltura">
          <table className="tabla">
            <thead><tr>
              <th>Artículo</th><th>Solicitud</th><th>Etapa</th>
              <th className="numero">Comprado</th><th className="numero">Recibido neto</th>
              <th className="numero">Disponible</th><th className="numero">Entregado</th>
              <th className="numero">Por llegar</th><th>Llegada estimada</th><th>Atraso</th>
            </tr></thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id}>
                  <td><Link to={`/gestion/articulo/${f.id}`}>{f.nombre}</Link></td>
                  <td>{f.solicitud_numero}</td>
                  <td><InsigniaEtapa etapa={f.etapa} /></td>
                  <td className="numero">{fmtCantidad(f.cantidad_comprada)}</td>
                  <td className="numero">{fmtCantidad(f.recibido_neto)}</td>
                  <td className="numero"><b>{fmtCantidad(f.disponible_almacen)}</b></td>
                  <td className="numero">{fmtCantidad(f.entregado_neto)}</td>
                  <td className="numero">{fmtCantidad(f.pendiente_llegada)}</td>
                  <td>{f.fecha_estimada_llegada ? fmtFecha(f.fecha_estimada_llegada) : 'sin información'}</td>
                  <td>{f.dias_atraso === null ? <span className="texto-suave">sin info.</span>
                      : f.dias_atraso > 0 ? <span className="atraso">{f.dias_atraso} d</span> : '0'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
