import { useCallback, useEffect, useState } from 'react';
import { supabase, rpc, limpiarError } from '../supabase.ts';
import { useCatalogos } from '../datos.ts';
import type { VentanaRecepcion } from '../tipos.ts';
import { Campo, MensajeError, MensajeExito, Cargando } from '../componentes/UI.tsx';
import { AdminNav } from '../componentes/AdminNav.tsx';
import { CalendarioSemanas } from '../componentes/CalendarioSemanas.tsx';
import { fmtFecha, fmtFechaHora, lunesProximaSemana } from '../util/fechas.ts';

interface Config {
  activo: boolean; dias_recepcion: number[]; dias_no_laborables: number[]; mover_si_no_habil: boolean;
  hora_liberacion: string | null; corte_dias_antes: number; hora_corte: string | null;
  politica_post_corte: 'siguiente_ciclo' | 'mismo_ciclo'; politica_validada: boolean;
  actualizado_en: string;
}
interface NoHabil { fecha: string; descripcion: string; }
interface Ejecucion { id: number; ejecutado_en: string; origen: string; liberadas: number; avisos: number; }

const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

export function AdminCalendario() {
  const { cat, recargar } = useCatalogos(true);
  const [c, setC] = useState<Config | null>(null);
  const [festivos, setFestivos] = useState<NoHabil[]>([]);
  const [ventanas, setVentanas] = useState<VentanaRecepcion[]>([]);
  const [ejecuciones, setEjecuciones] = useState<Ejecucion[]>([]);
  const [resultado, setResultado] = useState<Record<string, { ok: boolean; texto: string }>>({});
  const [nuevoFestivo, setNuevoFestivo] = useState({ fecha: '', descripcion: '' });
  const [nuevaVentana, setNuevaVentana] = useState({ categoria_id: '', nombre: '', abre_en: '', cierra_en: '', fecha_recepcion: '' });
  const [nuevaCategoria, setNuevaCategoria] = useState('');
  const [vista, setVista] = useState(0);

  const cargar = useCallback(async () => {
    const [rc, rf, rv, rl] = await Promise.all([
      supabase.from('calendario_config').select('*').maybeSingle(),
      supabase.from('calendario_no_habiles').select('*').order('fecha'),
      supabase.from('ventanas_recepcion').select('*').order('fecha_recepcion'),
      supabase.from('liberaciones_log').select('*').order('ejecutado_en', { ascending: false }).limit(10)
    ]);
    if (rc.data) {
      const d = rc.data as Config;
      setC({ ...d, hora_liberacion: d.hora_liberacion?.slice(0, 5) ?? null, hora_corte: d.hora_corte?.slice(0, 5) ?? null });
    }
    setFestivos((rf.data ?? []) as NoHabil[]);
    setVentanas((rv.data ?? []) as VentanaRecepcion[]);
    setEjecuciones((rl.data ?? []) as Ejecucion[]);
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  function avisar(clave: string, ok: boolean, texto: string) { setResultado((r) => ({ ...r, [clave]: { ok, texto } })); }
  function Resultado({ clave }: { clave: string }) {
    const r = resultado[clave];
    return r ? (r.ok ? <MensajeExito texto={r.texto} /> : <MensajeError texto={r.texto} />) : null;
  }

  async function guardar() {
    if (!c) return;
    const { error } = await supabase.from('calendario_config').update({
      activo: c.activo, dias_recepcion: c.dias_recepcion, dias_no_laborables: c.dias_no_laborables,
      mover_si_no_habil: c.mover_si_no_habil, hora_liberacion: c.hora_liberacion || null,
      corte_dias_antes: c.corte_dias_antes, hora_corte: c.hora_corte || null,
      politica_post_corte: c.politica_post_corte, politica_validada: c.politica_validada
    }).eq('id', true);
    if (error) { avisar('config', false, limpiarError(error.message)); return; }
    avisar('config', true, c.activo ? 'Calendario guardado y ACTIVO: las solicitudes aprobadas esperarán su fecha de recepción.' : 'Calendario guardado (inactivo: lo aprobado pasa a Compras de inmediato).');
    setVista((v) => v + 1);
    await cargar();
  }

  if (!c) return <div className="contenido"><AdminNav /><Cargando /></div>;
  const alternar = (lista: number[], d: number) => (lista.includes(d) ? lista.filter((x) => x !== d) : [...lista, d].sort());

  return (
    <div className="contenido">
      <h1>Calendario de recepción de Compras</h1>
      <AdminNav />
      <p className="texto-suave">
        Las personas pueden crear y enviar solicitudes a aprobación cualquier día. Compras solo las recibe
        cuando (1) están aprobadas por el jefe y (2) llega su fecha de recepción. Estos valores los define
        el área: no hay horarios preconfigurados.
      </p>

      <div className="tarjeta">
        <h2>Ciclo semanal</h2>
        <label className="campo"><span className="campo-etiqueta">
          <input type="checkbox" checked={c.activo} onChange={(e) => setC({ ...c, activo: e.target.checked })} /> Calendario activo
        </span>
          <span className="campo-ayuda">Inactivo: lo aprobado pasa de inmediato a Compras (como hoy, pero con aprobación del jefe).</span></label>
        <div className="campo">
          <span className="campo-etiqueta">Días de recepción de Compras<span className="marca-obligatorio"> * obligatorio para activar</span></span>
          <div className="acciones-fila">
            {DIAS.map((n, i) => (
              <label key={n}><input type="checkbox" checked={c.dias_recepcion.includes(i + 1)}
                onChange={() => setC({ ...c, dias_recepcion: alternar(c.dias_recepcion, i + 1) })} /> {n}</label>
            ))}
          </div>
        </div>
        <div className="campo">
          <span className="campo-etiqueta">Días no laborables de la semana</span>
          <div className="acciones-fila">
            {DIAS.map((n, i) => (
              <label key={n}><input type="checkbox" checked={c.dias_no_laborables.includes(i + 1)}
                onChange={() => setC({ ...c, dias_no_laborables: alternar(c.dias_no_laborables, i + 1) })} /> {n}</label>
            ))}
          </div>
        </div>
        <label className="campo"><span className="campo-etiqueta">
          <input type="checkbox" checked={c.mover_si_no_habil} onChange={(e) => setC({ ...c, mover_si_no_habil: e.target.checked })} /> Si el día de recepción es festivo o no laborable, usar el siguiente día hábil (primer día hábil de gestión)
        </span></label>
        <div className="fila-campos">
          <Campo etiqueta="Hora de liberación a Compras" requerido ayuda="Hora (Bogotá) en que el lote del día aparece en la bandeja de Compras.">
            <input type="time" value={c.hora_liberacion ?? ''} onChange={(e) => setC({ ...c, hora_liberacion: e.target.value })} />
          </Campo>
          <Campo etiqueta="Hora de corte" requerido ayuda="Lo aprobado antes de este momento entra al ciclo.">
            <input type="time" value={c.hora_corte ?? ''} onChange={(e) => setC({ ...c, hora_corte: e.target.value })} />
          </Campo>
          <Campo etiqueta="Días antes de la recepción para el corte" ayuda="0 = el mismo día de recepción; 1 = el día anterior, etc.">
            <input type="number" min={0} max={14} value={c.corte_dias_antes} onChange={(e) => setC({ ...c, corte_dias_antes: Math.max(0, Math.min(14, Number(e.target.value) || 0)) })} />
          </Campo>
        </div>
        <Campo etiqueta="Si el jefe aprueba DESPUÉS del corte" requerido>
          <select value={c.politica_post_corte} onChange={(e) => setC({ ...c, politica_post_corte: e.target.value as Config['politica_post_corte'] })}>
            <option value="siguiente_ciclo">Pasa al siguiente ciclo habilitado (propuesta)</option>
            <option value="mismo_ciclo">Se respeta el ciclo previsto al enviar (se libera de inmediato si ya pasó)</option>
          </select>
        </Campo>
        <label className="campo"><span className="campo-etiqueta">
          <input type="checkbox" checked={c.politica_validada} onChange={(e) => setC({ ...c, politica_validada: e.target.checked })} /> Política validada formalmente por Compras/Logística
        </span><span className="campo-ayuda">Mientras no esté marcada, los mensajes indican que la política es una propuesta pendiente de validación.</span></label>
        <div className="acciones-fila">
          <button type="button" className="boton-primario" onClick={() => void guardar()}>Guardar calendario</button>
          <span className="texto-suave">Última modificación: {fmtFechaHora(c.actualizado_en)}</span>
        </div>
        <Resultado clave="config" />
      </div>

      <div className="tarjeta">
        <h2>Vista previa: próximas semanas</h2>
        <CalendarioSemanas key={vista} valor={lunesProximaSemana()} alCambiar={() => {}} categoria={null} extraordinaria={false} semanas={8} />
      </div>

      <div className="tarjeta">
        <h2>Festivos y días no hábiles</h2>
        <p className="texto-suave">Agrégalos según el calendario oficial; la aplicación no trae festivos precargados.</p>
        <div className="filtros">
          <Campo etiqueta="Fecha" requerido><input type="date" value={nuevoFestivo.fecha} onChange={(e) => setNuevoFestivo({ ...nuevoFestivo, fecha: e.target.value })} /></Campo>
          <Campo etiqueta="Descripción" requerido><input value={nuevoFestivo.descripcion} onChange={(e) => setNuevoFestivo({ ...nuevoFestivo, descripcion: e.target.value })} /></Campo>
          <button type="button" className="boton-primario" disabled={!nuevoFestivo.fecha || nuevoFestivo.descripcion.trim().length < 3} onClick={async () => {
            const { error } = await supabase.from('calendario_no_habiles').insert({ fecha: nuevoFestivo.fecha, descripcion: nuevoFestivo.descripcion.trim() });
            if (error) { avisar('festivo', false, limpiarError(error.message)); return; }
            avisar('festivo', true, `Día no hábil agregado: ${fmtFecha(nuevoFestivo.fecha)}.`);
            setNuevoFestivo({ fecha: '', descripcion: '' }); setVista((v) => v + 1); await cargar();
          }}>Agregar</button>
        </div>
        <Resultado clave="festivo" />
        <ul>
          {festivos.map((f) => (
            <li key={f.fecha}>{fmtFecha(f.fecha)} · {f.descripcion}{' '}
              <button type="button" className="boton-silencioso" onClick={async () => {
                const { error } = await supabase.from('calendario_no_habiles').delete().eq('fecha', f.fecha);
                if (error) avisar('festivo', false, limpiarError(error.message)); else { avisar('festivo', true, 'Eliminado.'); setVista((v) => v + 1); await cargar(); }
              }}>Quitar</button></li>
          ))}
        </ul>
      </div>

      <div className="tarjeta">
        <h2>Ventanas especiales por categoría</h2>
        <p className="texto-suave">Ej.: “Papelería de noviembre”: se solicita en la última semana de octubre y Compras la recibe en la fecha indicada. Las solicitudes de esa categoría se programan para la próxima ventana; si no hay ninguna vigente, usan el ciclo semanal.</p>
        <div className="filtros">
          <Campo etiqueta="Nueva categoría"><input value={nuevaCategoria} onChange={(e) => setNuevaCategoria(e.target.value)} /></Campo>
          <button type="button" className="boton-secundario" disabled={nuevaCategoria.trim().length < 3} onClick={async () => {
            const { error } = await supabase.from('categorias_solicitud').insert({ nombre: nuevaCategoria.trim() });
            if (error) { avisar('ventana', false, limpiarError(error.message)); return; }
            avisar('ventana', true, 'Categoría creada.'); setNuevaCategoria(''); await recargar();
          }}>Crear categoría</button>
        </div>
        <div className="filtros">
          <Campo etiqueta="Categoría" requerido>
            <select value={nuevaVentana.categoria_id} onChange={(e) => setNuevaVentana({ ...nuevaVentana, categoria_id: e.target.value })}>
              <option value="">— Selecciona —</option>
              {cat?.categorias.filter((k) => k.activo).map((k) => <option key={k.id} value={k.id}>{k.nombre}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Nombre de la ventana" requerido><input value={nuevaVentana.nombre} onChange={(e) => setNuevaVentana({ ...nuevaVentana, nombre: e.target.value })} /></Campo>
          <Campo etiqueta="Abre" requerido><input type="date" value={nuevaVentana.abre_en} onChange={(e) => setNuevaVentana({ ...nuevaVentana, abre_en: e.target.value })} /></Campo>
          <Campo etiqueta="Cierra" requerido><input type="date" value={nuevaVentana.cierra_en} onChange={(e) => setNuevaVentana({ ...nuevaVentana, cierra_en: e.target.value })} /></Campo>
          <Campo etiqueta="Recepción Compras" requerido><input type="date" value={nuevaVentana.fecha_recepcion} onChange={(e) => setNuevaVentana({ ...nuevaVentana, fecha_recepcion: e.target.value })} /></Campo>
          <button type="button" className="boton-primario"
            disabled={!nuevaVentana.categoria_id || !nuevaVentana.nombre.trim() || !nuevaVentana.abre_en || !nuevaVentana.cierra_en || !nuevaVentana.fecha_recepcion}
            onClick={async () => {
              const { error } = await supabase.from('ventanas_recepcion').insert({ ...nuevaVentana, nombre: nuevaVentana.nombre.trim() });
              if (error) { avisar('ventana', false, limpiarError(error.message).includes('ventana_fechas') ? 'Revisa las fechas: el cierre no puede ser antes de la apertura.' : limpiarError(error.message)); return; }
              avisar('ventana', true, 'Ventana creada.'); setNuevaVentana({ categoria_id: '', nombre: '', abre_en: '', cierra_en: '', fecha_recepcion: '' }); await cargar();
            }}>Agregar ventana</button>
        </div>
        <Resultado clave="ventana" />
        <table className="tabla"><thead><tr><th>Categoría</th><th>Ventana</th><th>Abre</th><th>Cierra</th><th>Recepción</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {ventanas.map((v) => (
              <tr key={v.id}>
                <td>{cat?.categorias.find((k) => k.id === v.categoria_id)?.nombre ?? '—'}</td>
                <td>{v.nombre}</td><td>{fmtFecha(v.abre_en)}</td><td>{fmtFecha(v.cierra_en)}</td><td>{fmtFecha(v.fecha_recepcion)}</td>
                <td>{v.activo ? 'Activa' : 'Inactiva'}</td>
                <td><button type="button" className="boton-silencioso" onClick={async () => {
                  const { error } = await supabase.from('ventanas_recepcion').update({ activo: !v.activo }).eq('id', v.id);
                  if (error) avisar('ventana', false, limpiarError(error.message)); else await cargar();
                }}>{v.activo ? 'Desactivar' : 'Activar'}</button></td>
              </tr>
            ))}
          </tbody></table>
      </div>

      <div className="tarjeta">
        <h2>Liberaciones a Compras</h2>
        <p className="texto-suave">El servidor revisa cada 15 minutos (aunque nadie tenga la app abierta) si hay solicitudes aprobadas cuya fecha llegó. También puedes ejecutarlo ahora.</p>
        <button type="button" className="boton-secundario" onClick={async () => {
          try {
            const r = await rpc<{ liberadas: number; avisos: number }>('fn_admin_ejecutar_liberacion', {});
            avisar('lib', true, `Liberadas ahora: ${r.liberadas}. Avisos a Compras: ${r.avisos}.`); await cargar();
          } catch (e) { avisar('lib', false, e instanceof Error ? e.message : String(e)); }
        }}>Ejecutar liberación ahora</button>
        <Resultado clave="lib" />
        {ejecuciones.length === 0 ? <p className="texto-suave">Sin ejecuciones registradas con movimiento.</p> : (
          <ul>{ejecuciones.map((e) => <li key={e.id}>{fmtFechaHora(e.ejecutado_en)} · {e.origen} · {e.liberadas} liberada(s) · {e.avisos} aviso(s)</li>)}</ul>
        )}
      </div>
    </div>
  );
}
