import { useCallback, useState } from 'react';
import { supabase, limpiarError } from '../supabase.ts';
import { useCatalogos } from '../datos.ts';
import { Campo, MensajeError, Cargando } from '../componentes/UI.tsx';
import { fmtMoneda } from '../util/moneda.ts';
import { fmtFecha } from '../util/fechas.ts';
import { generarCSV, descargarCSV } from '../util/csv.ts';

interface FilaCosto {
  fuente: string; mes: string; area_id: string | null; area_nombre: string | null;
  centro_costo_id: string | null; centro_costo_codigo: string | null;
  moneda: string; total: number | null; fecha_compra: string;
  articulo_nombre?: string; articulo_texto?: string; referencia?: string;
  proveedor_nombre: string | null; solicitud_numero?: string;
  registrada_corporativo?: string;
}

type Agrupacion = 'area' | 'centro_costo' | 'mes' | 'proveedor';

const ETIQUETA_FUENTE: Record<string, string> = {
  gestionada: 'Gestionada en la aplicación',
  externa: 'Compra externa',
  regularizacion: 'Regularización'
};

export function Reportes() {
  const { cat } = useCatalogos(true);
  const [gestionadas, setGestionadas] = useState<FilaCosto[]>([]);
  const [externas, setExternas] = useState<FilaCosto[]>([]);
  const [cargado, setCargado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [fArea, setFArea] = useState('');
  const [fCC, setFCC] = useState('');
  const [agrupar, setAgrupar] = useState<Agrupacion>('area');
  const [incluirExternas, setIncluirExternas] = useState(true);

  const cargar = useCallback(async () => {
    setError(null); setCargado(false);
    let q1 = supabase.from('v_costos_gestionados').select('*');
    let q2 = supabase.from('v_costos_externos').select('*');
    if (desde) { q1 = q1.gte('fecha_compra', desde); q2 = q2.gte('fecha_compra', desde); }
    if (hasta) { q1 = q1.lte('fecha_compra', hasta); q2 = q2.lte('fecha_compra', hasta); }
    if (fArea) { q1 = q1.eq('area_id', fArea); q2 = q2.eq('area_id', fArea); }
    if (fCC) { q1 = q1.eq('centro_costo_id', fCC); q2 = q2.eq('centro_costo_id', fCC); }
    const [r1, r2] = await Promise.all([q1.limit(5000), q2.limit(5000)]);
    const e = r1.error ?? r2.error;
    if (e) { setError(limpiarError(e.message)); return; }
    setGestionadas((r1.data ?? []) as FilaCosto[]);
    setExternas((r2.data ?? []) as FilaCosto[]);
    setCargado(true);
  }, [desde, hasta, fArea, fCC]);

  function claveDe(f: FilaCosto): string {
    switch (agrupar) {
      case 'area': return f.area_nombre ?? 'Sin área';
      case 'centro_costo': return f.centro_costo_codigo ?? 'Sin centro de costo';
      case 'mes': return f.mes?.slice(0, 7) ?? 'Sin mes';
      case 'proveedor': return f.proveedor_nombre ?? 'Sin proveedor';
    }
  }

  interface Grupo {
    clave: string; fuente: string; moneda: string;
    total: number; registros: number; sinInformacion: number;
  }

  function agrupa(filas: FilaCosto[]): Grupo[] {
    const mapa = new Map<string, Grupo>();
    for (const f of filas) {
      const fuente = ETIQUETA_FUENTE[f.fuente] ?? f.fuente;
      const k = `${claveDe(f)}|${fuente}|${f.moneda}`;
      const g = mapa.get(k) ?? { clave: claveDe(f), fuente, moneda: f.moneda, total: 0, registros: 0, sinInformacion: 0 };
      g.registros += 1;
      if (f.total === null || f.total === undefined) g.sinInformacion += 1;
      else g.total += Number(f.total);
      mapa.set(k, g);
    }
    return [...mapa.values()].sort((a, b) => a.clave.localeCompare(b.clave) || a.fuente.localeCompare(b.fuente) || a.moneda.localeCompare(b.moneda));
  }

  const todas = incluirExternas ? [...gestionadas, ...externas] : gestionadas;
  const grupos = agrupa(todas);

  function exportarResumen() {
    descargarCSV('costos_resumen.csv', generarCSV(grupos, [
      { titulo: agrupar === 'area' ? 'Área' : agrupar === 'centro_costo' ? 'Centro de costo' : agrupar === 'mes' ? 'Mes' : 'Proveedor', valor: (g) => g.clave },
      { titulo: 'Fuente', valor: (g) => g.fuente },
      { titulo: 'Moneda', valor: (g) => g.moneda },
      { titulo: 'Total comprado', valor: (g) => g.total },
      { titulo: 'Registros', valor: (g) => g.registros },
      { titulo: 'Registros sin información de importe', valor: (g) => g.sinInformacion }
    ]));
  }

  function exportarDetalle() {
    descargarCSV('costos_detalle.csv', generarCSV(todas, [
      { titulo: 'Fuente', valor: (f) => ETIQUETA_FUENTE[f.fuente] ?? f.fuente },
      { titulo: 'Fecha compra', valor: (f) => fmtFecha(f.fecha_compra) },
      { titulo: 'Área', valor: (f) => f.area_nombre },
      { titulo: 'Centro de costo', valor: (f) => f.centro_costo_codigo },
      { titulo: 'Artículo', valor: (f) => f.articulo_nombre ?? f.articulo_texto ?? '' },
      { titulo: 'Proveedor', valor: (f) => f.proveedor_nombre },
      { titulo: 'Solicitud / Referencia', valor: (f) => f.solicitud_numero ?? f.referencia ?? '' },
      { titulo: 'Moneda', valor: (f) => f.moneda },
      { titulo: 'Total', valor: (f) => f.total === null ? 'sin información' : f.total },
      { titulo: 'Registrada en corporativo', valor: (f) => f.registrada_corporativo ?? 'no aplica' }
    ]));
  }

  return (
    <div className="contenido">
      <h1>Reportes de costos</h1>
      <p className="texto-suave">
        Importes <b>comprados</b> (no implican pagos registrados). Cada moneda se totaliza por separado;
        nunca se suman monedas distintas. Los importes ausentes cuentan como “sin información”, no como cero.
        Las compras externas entran UNA vez por su referencia única. Definición de “compra externa” pendiente
        de validación por Compras (tipo + registro corporativo se muestran por separado).
      </p>
      <div className="filtros">
        <Campo etiqueta="Desde"><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></Campo>
        <Campo etiqueta="Hasta"><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></Campo>
        <Campo etiqueta="Área">
          <select value={fArea} onChange={(e) => setFArea(e.target.value)}>
            <option value="">Todas</option>
            {cat?.areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Centro de costo">
          <select value={fCC} onChange={(e) => setFCC(e.target.value)}>
            <option value="">Todos</option>
            {cat?.centros.map((c) => <option key={c.id} value={c.id}>{c.codigo}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Agrupar por">
          <select value={agrupar} onChange={(e) => setAgrupar(e.target.value as Agrupacion)}>
            <option value="area">Área</option>
            <option value="centro_costo">Centro de costo</option>
            <option value="mes">Mes</option>
            <option value="proveedor">Proveedor</option>
          </select>
        </Campo>
        <label className="campo"><span className="campo-etiqueta">Incluir externas</span>
          <input type="checkbox" checked={incluirExternas} onChange={(e) => setIncluirExternas(e.target.checked)} />
        </label>
        <button type="button" className="boton-primario" onClick={() => void cargar()}>Calcular</button>
        <button type="button" className="boton-secundario" onClick={exportarResumen} disabled={!cargado || grupos.length === 0}>Exportar resumen</button>
        <button type="button" className="boton-secundario" onClick={exportarDetalle} disabled={!cargado || todas.length === 0}>Exportar detalle</button>
      </div>
      <MensajeError texto={error} />
      {!cargado ? <p className="texto-suave">Elige los filtros y pulsa “Calcular”.</p> : grupos.length === 0 ? (
        <div className="tarjeta"><p>No hay compras en el rango seleccionado.</p></div>
      ) : (
        <div className="tabla-envoltura">
          <table className="tabla">
            <thead><tr>
              <th>{agrupar === 'area' ? 'Área' : agrupar === 'centro_costo' ? 'Centro de costo' : agrupar === 'mes' ? 'Mes' : 'Proveedor'}</th>
              <th>Fuente</th><th>Moneda</th>
              <th className="numero">Total comprado</th>
              <th className="numero">Registros</th>
              <th className="numero">Sin información</th>
            </tr></thead>
            <tbody>
              {grupos.map((g, i) => (
                <tr key={i}>
                  <td>{g.clave}</td>
                  <td>{g.fuente}</td>
                  <td>{g.moneda}</td>
                  <td className="numero"><b>{fmtMoneda(g.total, g.moneda)}</b></td>
                  <td className="numero">{g.registros}</td>
                  <td className="numero">{g.sinInformacion > 0 ? `${g.sinInformacion} registro(s)` : '0'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cargado ? (
        <p className="texto-suave">
          {gestionadas.length} compra(s) gestionada(s) y {externas.length} externa(s) en el rango.
          La exportación conserva acentos (UTF-8 con BOM) y neutraliza fórmulas.
        </p>
      ) : null}
    </div>
  );
}
