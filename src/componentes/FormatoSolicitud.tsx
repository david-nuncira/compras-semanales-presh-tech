// «Formato solicitud de compra» de mantenimiento, con la misma disposición de la hoja:
// encabezado (fecha, centro de costo, elaborado por, aprobado por, versión) y la tabla
// Cant. · Nombre artículo · Centro de costo · Imagen · Justificación · Descripción.
// Se ve en pantalla (no hay archivos ni Excel).
import type { Adjunto, VArticulo, VSolicitud } from '../tipos.ts';
import { MiniaturaArticulo } from './Miniatura.tsx';
import { fmtFecha } from '../util/fechas.ts';
import { fmtCantidad } from '../util/moneda.ts';

export function EncabezadoFormato({ sol, aprobadoPor }: { sol: Pick<VSolicitud, 'creado_en' | 'recibida_compras_en' | 'centro_costo_codigo' | 'centro_costo_nombre' | 'solicitante_nombre' | 'aprobador_jefe_nombre' | 'aprobado_en' | 'version_contenido'>; aprobadoPor?: string | null }) {
  return (
    <>
      <h2 className="formato-titulo">Formato solicitud de compra</h2>
      <dl className="matriz-cabecera">
        <div><dt>Fecha</dt><dd>{fmtFecha(sol.recibida_compras_en ?? sol.creado_en)}</dd></div>
        <div><dt>Centro de costo</dt><dd>{sol.centro_costo_nombre ?? sol.centro_costo_codigo ?? '—'}</dd></div>
        <div><dt>Elaborado</dt><dd>{sol.solicitante_nombre ?? '—'}</dd></div>
        <div><dt>Aprobado por</dt><dd>{aprobadoPor ?? sol.aprobador_jefe_nombre ?? '—'}{!aprobadoPor && sol.aprobado_en ? ` · ${fmtFecha(sol.aprobado_en)}` : ''}</dd></div>
        <div><dt>Versión</dt><dd>{String(sol.version_contenido ?? 1).padStart(3, '0')}</dd></div>
      </dl>
    </>
  );
}

/** La parte que llena quien solicita: columnas B a G de la hoja. */
export function TablaFormatoSolicitud({ sol, articulos, adjuntos, nombreCentro }: {
  sol: VSolicitud; articulos: VArticulo[]; adjuntos: Record<string, Adjunto[]>;
  /** Nombre del centro de costo destino de cada artículo (id → nombre). */
  nombreCentro: (id: string | null) => string;
}) {
  return (
    <div className="formato-hoja">
      <EncabezadoFormato sol={sol} />
      <div className="matriz-envoltura" tabIndex={0} role="region" aria-label="Formato de solicitud de compra">
        <table className="tabla matriz">
          <caption className="solo-lectores">Artículos pedidos con su centro de costo destino, imagen, justificación y descripción</caption>
          <thead>
            <tr>
              <th scope="col" className="matriz-fija matriz-c1">Cant.</th>
              <th scope="col" className="matriz-fija matriz-c2">Nombre artículo</th>
              <th scope="col">Centro de costo</th>
              <th scope="col">Imagen</th>
              <th scope="col">Justificación</th>
              <th scope="col">Descripción (medidas, color, material)</th>
            </tr>
          </thead>
          <tbody>
            {articulos.map((a) => (
              <tr key={a.id}>
                <td className="matriz-fija matriz-c1 numero">{fmtCantidad(a.cantidad)}</td>
                <td className="matriz-fija matriz-c2">{a.nombre}</td>
                <td>{nombreCentro(a.centro_costo_id)}</td>
                <td><MiniaturaArticulo nombre={a.nombre} adjuntos={adjuntos[a.id]} /></td>
                <td className="celda-recortada">{a.justificacion ?? '—'}</td>
                <td className="celda-recortada">{a.descripcion}{a.enlace_referencia ? <> · <a href={a.enlace_referencia} target="_blank" rel="noopener noreferrer">enlace</a></> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
