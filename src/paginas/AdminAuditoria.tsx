import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, limpiarError } from '../supabase.ts';
import { useActualizacionPeriodica } from '../datos.ts';
import { Campo, MensajeError, Cargando, Paginador } from '../componentes/UI.tsx';
import { fmtFechaHora } from '../util/fechas.ts';

interface FilaAuditoria {
  id: number; tabla: string; registro_id: string; accion: string;
  actor: string | null; creado_en: string; motivo: string | null;
  anterior: Record<string, unknown> | null; nuevo: Record<string, unknown> | null;
}

const POR_PAGINA = 50;

export function AdminAuditoria() {
  const [filas, setFilas] = useState<FilaAuditoria[] | null>(null);
  const [nombres, setNombres] = useState<Record<string, string>>({});
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [fTabla, setFTabla] = useState('');
  const [fAccion, setFAccion] = useState('');
  const [fRegistro, setFRegistro] = useState('');
  const [fDesde, setFDesde] = useState('');
  const [fHasta, setFHasta] = useState('');

  const cargar = useCallback(async () => {
    setError(null);
    let q = supabase.from('auditoria').select('*', { count: 'exact' });
    if (fTabla) q = q.eq('tabla', fTabla);
    if (fAccion.trim()) q = q.ilike('accion', `%${fAccion.trim()}%`);
    if (fRegistro.trim()) q = q.eq('registro_id', fRegistro.trim());
    if (fDesde) q = q.gte('creado_en', fDesde);
    if (fHasta) q = q.lte('creado_en', fHasta + 'T23:59:59');
    const { data, error: e, count } = await q
      .order('id', { ascending: false })
      .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1);
    if (e) { setError(limpiarError(e.message)); return; }
    const fs = (data ?? []) as FilaAuditoria[];
    setFilas(fs);
    setTotal(count ?? 0);
    const actores = [...new Set(fs.map((f) => f.actor).filter((x): x is string => !!x))];
    if (actores.length > 0) {
      const { data: ps } = await supabase.from('perfiles').select('id, nombre').in('id', actores);
      const mapa: Record<string, string> = {};
      for (const p of (ps ?? []) as Array<{ id: string; nombre: string }>) mapa[p.id] = p.nombre;
      setNombres(mapa);
    }
  }, [fTabla, fAccion, fRegistro, fDesde, fHasta, pagina]);

  useActualizacionPeriodica(cargar, 120000, [cargar]);

  return (
    <div className="contenido">
      <h1>Administración · Auditoría</h1>
      <div className="acciones-fila">
        <Link to="/admin">Usuarios</Link> · <Link to="/admin/catalogos">Catálogos</Link> ·
        {' '}<Link to="/admin/auditoria">Auditoría</Link> · <Link to="/admin/recuperacion">Recuperación</Link> ·
        {' '}<Link to="/admin/importacion">Importación CSV</Link>
      </div>
      <p className="texto-suave">
        La auditoría la generan disparadores y funciones del servidor con el usuario autenticado
        y la hora del servidor. Ningún usuario funcional (incluido el administrador) puede
        editarla o borrarla desde la aplicación; no se promete inmutabilidad frente al
        propietario técnico de la base de datos. Nunca contiene contraseñas, tokens ni enlaces.
      </p>
      <div className="filtros">
        <Campo etiqueta="Tabla">
          <select value={fTabla} onChange={(e) => { setPagina(1); setFTabla(e.target.value); }}>
            <option value="">Todas</option>
            {['perfiles','perfil_roles','areas','centros_costo','proveedores','solicitudes','articulos','cotizaciones','aprobaciones','compras','movimientos','novedades','adjuntos','compras_externas','configuracion','importacion_lotes','importacion_filas','recuperacion_acceso'].map((t) =>
              <option key={t} value={t}>{t}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Acción contiene"><input value={fAccion} onChange={(e) => { setPagina(1); setFAccion(e.target.value); }} /></Campo>
        <Campo etiqueta="ID de registro"><input value={fRegistro} onChange={(e) => { setPagina(1); setFRegistro(e.target.value); }} /></Campo>
        <Campo etiqueta="Desde"><input type="date" value={fDesde} onChange={(e) => { setPagina(1); setFDesde(e.target.value); }} /></Campo>
        <Campo etiqueta="Hasta"><input type="date" value={fHasta} onChange={(e) => { setPagina(1); setFHasta(e.target.value); }} /></Campo>
        <button type="button" className="boton-secundario" onClick={() => void cargar()}>Actualizar</button>
      </div>
      <MensajeError texto={error} />
      {!filas ? <Cargando /> : (
        <div className="tabla-envoltura">
          <table className="tabla">
            <thead><tr>
              <th>#</th><th>Fecha (servidor)</th><th>Tabla</th><th>Registro</th>
              <th>Acción</th><th>Actor</th><th>Motivo</th><th>Anterior → Nuevo</th>
            </tr></thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id}>
                  <td>{f.id}</td>
                  <td>{fmtFechaHora(f.creado_en)}</td>
                  <td>{f.tabla}</td>
                  <td className="texto-suave" style={{ maxWidth: 120, overflowWrap: 'anywhere' }}>{f.registro_id}</td>
                  <td>{f.accion}</td>
                  <td>{f.actor ? (nombres[f.actor] ?? f.actor.slice(0, 8)) : 'Sistema'}</td>
                  <td>{f.motivo ?? ''}</td>
                  <td className="texto-suave" style={{ maxWidth: 420, overflowWrap: 'anywhere' }}>
                    {f.anterior ? JSON.stringify(f.anterior) : '—'} → {f.nuevo ? JSON.stringify(f.nuevo) : '—'}
                  </td>
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
