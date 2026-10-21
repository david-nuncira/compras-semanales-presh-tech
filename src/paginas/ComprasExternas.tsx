import { useCallback, useState } from 'react';
import { supabase, rpc, limpiarError, nuevoOp } from '../supabase.ts';
import { useCatalogos, useActualizacionPeriodica } from '../datos.ts';
import type { CompraExterna } from '../tipos.ts';
import { Campo, MensajeError, MensajeExito, Cargando, Modal, BotonConMotivo } from '../componentes/UI.tsx';
import { Adjuntos } from '../componentes/Adjuntos.tsx';
import { fmtFecha, hoyBogotaISO } from '../util/fechas.ts';
import { fmtMoneda, fmtCantidad, parseNumero } from '../util/moneda.ts';

const ETIQUETA_TIPO: Record<CompraExterna['tipo'], string> = {
  externa: 'Compra externa (hecha por fuera de esta aplicación)',
  regularizacion: 'Regularización (se registra aquí a posteriori)'
};
const ETIQUETA_CORP: Record<CompraExterna['registrada_corporativo'], string> = {
  si: 'Sí', no: 'No', por_confirmar: 'Por confirmar'
};

export function ComprasExternas() {
  const { cat } = useCatalogos();
  const [filas, setFilas] = useState<CompraExterna[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<CompraExterna | null>(null);

  const [m, setM] = useState<null | {
    tipo: CompraExterna['tipo']; registrada: CompraExterna['registrada_corporativo'];
    area: string; cc: string; proveedor: string; proveedorTexto: string;
    articulo: string; cantidad: string; unidad: string; moneda: string;
    importe: string; fecha: string; observacion: string;
  }>(null);
  const [mError, setMError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    const { data, error: e } = await supabase.from('compras_externas')
      .select('*').order('fecha_compra', { ascending: false }).limit(500);
    if (e) { setError(limpiarError(e.message)); return; }
    setFilas((data ?? []) as CompraExterna[]);
  }, []);

  useActualizacionPeriodica(cargar, 60000, [cargar]);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    if (!m) return;
    setMError(null);
    const cantidad = parseNumero(m.cantidad);
    const importe = m.importe.trim() === '' ? null : parseNumero(m.importe);
    if (!m.area || !m.cc) { setMError('Selecciona área y centro de costo.'); return; }
    if (!m.proveedor && m.proveedorTexto.trim() === '') { setMError('Indica el proveedor (del catálogo o en texto).'); return; }
    if (m.articulo.trim().length < 3) { setMError('Describe el artículo.'); return; }
    if (cantidad === null || cantidad <= 0) { setMError('Cantidad inválida.'); return; }
    if (m.importe.trim() !== '' && (importe === null || importe < 0)) { setMError('Importe inválido (déjalo vacío si no se conoce: quedará "sin información", no cero).'); return; }
    setOcupado(true);
    try {
      const r = await rpc<{ referencia: string }>('fn_registrar_compra_externa', {
        p_tipo: m.tipo, p_registrada: m.registrada, p_area: m.area, p_centro_costo: m.cc,
        p_proveedor: m.proveedor || null, p_proveedor_texto: m.proveedorTexto.trim() || null,
        p_articulo: m.articulo.trim(), p_cantidad: cantidad, p_unidad: m.unidad.trim() || 'unidad',
        p_moneda: m.moneda.trim().toUpperCase(), p_importe: importe, p_fecha: m.fecha,
        p_observacion: m.observacion.trim() || null, p_op: nuevoOp()
      });
      setM(null);
      setExito(`Compra externa registrada con referencia única ${r.referencia}.`);
      await cargar();
    } catch (err) { setMError(err instanceof Error ? err.message : String(err)); }
    finally { setOcupado(false); }
  }

  return (
    <div className="contenido">
      <h1>Compras externas</h1>
      <p className="texto-suave">
        “Fuera del sistema” tiene dos lecturas y aquí se distinguen: el <b>tipo</b> (externa o
        regularización) y si está <b>registrada en el sistema corporativo</b> (sí/no/por confirmar).
        La definición operativa está pendiente de validación por Compras. Cada registro tiene una
        referencia única para que nunca se cuente dos veces, aunque se vincule a una solicitud o
        tenga varios soportes.
      </p>
      <div className="acciones-fila">
        <button type="button" className="boton-primario" onClick={() => {
          setMError(null);
          setM({ tipo: 'externa', registrada: 'por_confirmar', area: '', cc: '', proveedor: '', proveedorTexto: '', articulo: '', cantidad: '1', unidad: 'unidad', moneda: 'COP', importe: '', fecha: hoyBogotaISO(), observacion: '' });
        }}>+ Registrar compra externa</button>
        <button type="button" className="boton-secundario" onClick={() => void cargar()}>Actualizar</button>
      </div>
      <MensajeError texto={error} />
      <MensajeExito texto={exito} />
      {!filas ? <Cargando /> : filas.length === 0 ? (
        <div className="tarjeta"><p>No hay compras externas registradas.</p></div>
      ) : (
        <div className="tabla-envoltura">
          <table className="tabla">
            <thead><tr>
              <th>Referencia</th><th>Tipo</th><th>Artículo</th><th className="oculto-movil">Área / CC</th>
              <th>Proveedor</th><th className="numero">Cantidad</th><th className="numero">Importe</th>
              <th>Fecha</th><th>En corporativo</th><th>Vínculo</th><th></th>
            </tr></thead>
            <tbody>
              {filas.map((f) => {
                const area = cat?.areas.find((x) => x.id === f.area_id);
                const cc = cat?.centros.find((x) => x.id === f.centro_costo_id);
                const prov = cat?.proveedores.find((x) => x.id === f.proveedor_id);
                return (
                  <tr key={f.id}>
                    <td>{f.referencia}</td>
                    <td>{f.tipo === 'externa' ? 'Externa' : 'Regularización'}</td>
                    <td>{f.articulo_texto}</td>
                    <td className="oculto-movil">{area?.nombre ?? '—'} / {cc?.codigo ?? '—'}</td>
                    <td>{prov?.nombre ?? f.proveedor_texto ?? '—'}</td>
                    <td className="numero">{fmtCantidad(f.cantidad)} {f.unidad}</td>
                    <td className="numero">{f.importe_total === null ? <span className="texto-suave">sin información</span> : fmtMoneda(f.importe_total, f.moneda)}</td>
                    <td>{fmtFecha(f.fecha_compra)}</td>
                    <td>{ETIQUETA_CORP[f.registrada_corporativo]}</td>
                    <td>{f.solicitud_id ? 'Vinculada' : '—'}</td>
                    <td><button type="button" className="boton-silencioso" onClick={() => setDetalle(f)}>Abrir</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal titulo="Registrar compra externa" abierto={!!m} alCerrar={() => setM(null)}>
        {m ? (
          <form className="formulario" onSubmit={crear}>
            <div className="fila-campos">
              <Campo etiqueta="Tipo" requerido>
                <select value={m.tipo} onChange={(e) => setM({ ...m, tipo: e.target.value as CompraExterna['tipo'] })}>
                  <option value="externa">Externa</option>
                  <option value="regularizacion">Regularización</option>
                </select>
              </Campo>
              <Campo etiqueta="¿Registrada en el sistema corporativo?" requerido>
                <select value={m.registrada} onChange={(e) => setM({ ...m, registrada: e.target.value as CompraExterna['registrada_corporativo'] })}>
                  <option value="por_confirmar">Por confirmar</option>
                  <option value="si">Sí</option>
                  <option value="no">No</option>
                </select>
              </Campo>
            </div>
            <p className="texto-suave">{ETIQUETA_TIPO[m.tipo]}</p>
            <div className="fila-campos">
              <Campo etiqueta="Área" requerido>
                <select value={m.area} onChange={(e) => setM({ ...m, area: e.target.value })}>
                  <option value="">— Selecciona —</option>
                  {cat?.areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                </select>
              </Campo>
              <Campo etiqueta="Centro de costo" requerido>
                <select value={m.cc} onChange={(e) => setM({ ...m, cc: e.target.value })}>
                  <option value="">— Selecciona —</option>
                  {cat?.centros.map((c) => <option key={c.id} value={c.id}>{c.codigo}</option>)}
                </select>
              </Campo>
            </div>
            <div className="fila-campos">
              <Campo etiqueta="Proveedor (catálogo)">
                <select value={m.proveedor} onChange={(e) => setM({ ...m, proveedor: e.target.value })}>
                  <option value="">— No está en el catálogo —</option>
                  {cat?.proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </Campo>
              <Campo etiqueta="Proveedor (texto, si no está en catálogo)">
                <input value={m.proveedorTexto} onChange={(e) => setM({ ...m, proveedorTexto: e.target.value })} />
              </Campo>
            </div>
            <Campo etiqueta="Artículo" requerido>
              <input value={m.articulo} onChange={(e) => setM({ ...m, articulo: e.target.value })} />
            </Campo>
            <div className="fila-campos">
              <Campo etiqueta="Cantidad" requerido><input inputMode="decimal" value={m.cantidad} onChange={(e) => setM({ ...m, cantidad: e.target.value })} /></Campo>
              <Campo etiqueta="Unidad"><input value={m.unidad} onChange={(e) => setM({ ...m, unidad: e.target.value })} /></Campo>
              <Campo etiqueta="Moneda" requerido><input value={m.moneda} maxLength={3} onChange={(e) => setM({ ...m, moneda: e.target.value.toUpperCase() })} /></Campo>
            </div>
            <div className="fila-campos">
              <Campo etiqueta="Importe total (vacío = sin información)">
                <input inputMode="decimal" value={m.importe} onChange={(e) => setM({ ...m, importe: e.target.value })} />
              </Campo>
              <Campo etiqueta="Fecha de compra" requerido>
                <input type="date" value={m.fecha} onChange={(e) => setM({ ...m, fecha: e.target.value })} />
              </Campo>
            </div>
            <Campo etiqueta="Observación"><textarea rows={2} value={m.observacion} onChange={(e) => setM({ ...m, observacion: e.target.value })} /></Campo>
            <MensajeError texto={mError} />
            <div className="modal-acciones">
              <button type="button" className="boton-secundario" onClick={() => setM(null)}>Cancelar</button>
              <button type="submit" className="boton-primario" disabled={ocupado}>{ocupado ? 'Guardando…' : 'Registrar'}</button>
            </div>
          </form>
        ) : null}
      </Modal>

      <Modal titulo={detalle ? `Compra externa ${detalle.referencia}` : ''} abierto={!!detalle} alCerrar={() => setDetalle(null)}>
        {detalle ? (
          <div>
            <p><b>{detalle.articulo_texto}</b> · {fmtCantidad(detalle.cantidad)} {detalle.unidad} ·
              {' '}{detalle.importe_total === null ? 'importe sin información' : fmtMoneda(detalle.importe_total, detalle.moneda)} · {fmtFecha(detalle.fecha_compra)}</p>
            {detalle.observacion ? <p className="texto-suave">{detalle.observacion}</p> : null}
            <div className="acciones-fila">
              <BotonConMotivo etiqueta={detalle.solicitud_id ? 'Cambiar vínculo a solicitud' : 'Vincular a una solicitud'} titulo="Vincular a solicitud"
                descripcion="Pega el ID interno de la solicitud (ábrela y copia el identificador de la dirección web) dentro del motivo, junto con la razón. La compra externa seguirá contándose UNA sola vez."
                onConfirmar={async (motivo) => {
                  const idSol = motivo.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
                  if (!idSol) throw new Error('Incluye el ID de la solicitud en el texto.');
                  await rpc('fn_vincular_compra_externa', { p_id: detalle.id, p_solicitud: idSol, p_motivo: motivo, p_version: detalle.version });
                  setDetalle(null); await cargar();
                }} />
              <BotonConMotivo etiqueta="Actualizar estado corporativo / importe" titulo="Actualizar compra externa"
                descripcion='Escribe en el motivo: "corporativo: si|no|por_confirmar" y opcionalmente "importe: 123456", más la razón.'
                onConfirmar={async (motivo) => {
                  const corp = motivo.match(/corporativo:\s*(si|no|por_confirmar)/i)?.[1]?.toLowerCase() ?? null;
                  const impTexto = motivo.match(/importe:\s*([\d.,]+)/i)?.[1] ?? null;
                  const imp = impTexto ? parseNumero(impTexto) : detalle.importe_total;
                  await rpc('fn_actualizar_compra_externa', {
                    p_id: detalle.id, p_registrada: corp, p_importe: imp,
                    p_observacion: detalle.observacion, p_motivo: motivo, p_version: detalle.version
                  });
                  setDetalle(null); await cargar();
                }} />
            </div>
            <Adjuntos entidad="compra_externa" entidadId={detalle.id} puedeSubir={true} maxArchivos={3} />
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
