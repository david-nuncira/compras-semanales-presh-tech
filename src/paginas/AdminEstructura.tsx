import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, rpc, limpiarError } from '../supabase.ts';
import { useCatalogos, listarPerfiles, type PerfilBreve } from '../datos.ts';
import type { Area } from '../tipos.ts';
import { Campo, MensajeError, MensajeExito, Cargando } from '../componentes/UI.tsx';
import { AdminNav } from '../componentes/AdminNav.tsx';

/**
 * Estructura organizacional, configurada desde la app (nada en el código):
 *  Paso 1 · jefe del área y ruta superior (quién aprueba las solicitudes del jefe)
 *  Paso 2 · personas vinculadas al área (solicitantes)
 *  Paso 3 · centros de costo autorizados para el área
 */
export function AdminEstructura() {
  const { cat, error: errorCat, recargar } = useCatalogos(true);
  const [personas, setPersonas] = useState<PerfilBreve[]>([]);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Record<string, { ok: boolean; texto: string }>>({});
  const [error, setError] = useState<string | null>(null);

  const cargarPersonas = useCallback(async () => {
    try { setPersonas(await listarPerfiles()); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void cargarPersonas(); }, [cargarPersonas]);

  const activas = personas.filter((p) => p.estado === 'activo');
  const nombre = (id: string | null | undefined) => personas.find((p) => p.id === id)?.nombre ?? '—';

  const resumen = useMemo(() => {
    if (!cat) return null;
    const areasActivas = cat.areas.filter((a) => a.activo);
    return {
      sinJefe: areasActivas.filter((a) => !a.jefe_id),
      jefeInactivo: areasActivas.filter((a) => a.jefe_id && !activas.some((p) => p.id === a.jefe_id)),
      sinCentro: areasActivas.filter((a) => !cat.asociaciones.some((x) => x.area_id === a.id && x.activo)),
      sinArea: activas.filter((p) => !p.area_id)
    };
  }, [cat, activas]);

  function avisar(clave: string, ok: boolean, texto: string) {
    setResultado((r) => ({ ...r, [clave]: { ok, texto } }));
  }

  async function ejecutar(clave: string, fn: () => Promise<string>) {
    try { avisar(clave, true, await fn()); await recargar(); await cargarPersonas(); }
    catch (e) { avisar(clave, false, e instanceof Error ? e.message : String(e)); }
  }

  if (!cat || !resumen) return <div className="contenido"><AdminNav /><Cargando /></div>;

  return (
    <div className="contenido">
      <h1>Estructura: áreas, jefes y centros de costo</h1>
      <AdminNav />
      <MensajeError texto={errorCat ?? error} flotante />

      <div className="tarjeta">
        <h2>Pendientes de configuración</h2>
        <ul>
          <li>{resumen.sinJefe.length === 0 ? '✓ Todas las áreas activas tienen jefe.' : `⚠ Áreas sin jefe (sus solicitudes no se pueden enviar): ${resumen.sinJefe.map((a) => a.nombre).join(', ')}`}</li>
          {resumen.jefeInactivo.length > 0 ? <li>⚠ Áreas cuyo jefe no tiene cuenta activa: {resumen.jefeInactivo.map((a) => a.nombre).join(', ')}</li> : null}
          <li>{resumen.sinCentro.length === 0 ? '✓ Todas las áreas activas tienen centro de costo autorizado.' : `⚠ Áreas sin centro de costo autorizado (no pueden crear solicitudes): ${resumen.sinCentro.map((a) => a.nombre).join(', ')}`}</li>
          <li>{resumen.sinArea.length === 0 ? '✓ Todas las personas activas tienen área.' : `⚠ Personas activas sin área (no pueden solicitar): ${resumen.sinArea.map((p) => p.nombre).join(', ')}`}</li>
        </ul>
        {resumen.sinCentro.length > 0 ? (
          <AsociarEnBloque centros={cat.centros.filter((c) => c.activo)} areas={resumen.sinCentro}
            alTerminar={async (txt) => { avisar('bloque', true, txt); await recargar(); }}
            alFallar={(txt) => avisar('bloque', false, txt)} />
        ) : null}
        {resultado.bloque ? (resultado.bloque.ok ? <MensajeExito texto={resultado.bloque.texto} /> : <MensajeError texto={resultado.bloque.texto} />) : null}
        <p className="texto-suave">Para crear áreas o centros de costo nuevos usa <Link to="/admin/catalogos">Catálogos</Link>.</p>
      </div>

      {cat.areas.map((a) => (
        <TarjetaArea key={a.id} area={a} abierta={abierta === a.id} alAlternar={() => setAbierta(abierta === a.id ? null : a.id)}
          activas={activas} personas={personas} nombre={nombre}
          centros={cat.centros} asociadas={cat.asociaciones.filter((x) => x.area_id === a.id)}
          resultado={resultado[a.id]} ejecutar={(fn) => ejecutar(a.id, fn)} />
      ))}
    </div>
  );
}

function AsociarEnBloque({ centros, areas, alTerminar, alFallar }: {
  centros: Array<{ id: string; codigo: string; nombre: string }>; areas: Area[];
  alTerminar: (t: string) => Promise<void>; alFallar: (t: string) => void;
}) {
  const [cc, setCc] = useState('');
  return (
    <div className="filtros">
      <Campo etiqueta="Asociar un centro de costo a TODAS las áreas sin asociación" ayuda="Útil para la asignación inicial (p. ej. el centro que hoy usan como compra semanal). Revísalo con el área antes.">
        <select value={cc} onChange={(e) => setCc(e.target.value)}>
          <option value="">— Selecciona —</option>
          {centros.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
        </select>
      </Campo>
      <button type="button" className="boton-primario" disabled={!cc} onClick={async () => {
        try {
          const n = await rpc<number>('fn_admin_asociar_cc', { p_cc: cc, p_areas: areas.map((a) => a.id), p_activo: true });
          await alTerminar(`Centro de costo asociado a ${n} área(s).`);
        } catch (e) { alFallar(e instanceof Error ? e.message : String(e)); }
      }}>Asociar a {areas.length} área(s)</button>
    </div>
  );
}

function TarjetaArea({ area, abierta, alAlternar, activas, personas, nombre, centros, asociadas, resultado, ejecutar }: {
  area: Area; abierta: boolean; alAlternar: () => void;
  activas: PerfilBreve[]; personas: PerfilBreve[]; nombre: (id: string | null | undefined) => string;
  centros: Array<{ id: string; codigo: string; nombre: string; activo: boolean }>;
  asociadas: Array<{ centro_costo_id: string; activo: boolean }>;
  resultado?: { ok: boolean; texto: string };
  ejecutar: (fn: () => Promise<string>) => Promise<void>;
}) {
  const [jefe, setJefe] = useState(area.jefe_id ?? '');
  const [superior, setSuperior] = useState(area.aprobador_superior_id ?? '');
  const [motivo, setMotivo] = useState('');
  const [agregar, setAgregar] = useState<string[]>([]);
  useEffect(() => { setJefe(area.jefe_id ?? ''); setSuperior(area.aprobador_superior_id ?? ''); }, [area.jefe_id, area.aprobador_superior_id]);

  const miembros = personas.filter((p) => p.area_id === area.id);
  const candidatos = activas.filter((p) => p.area_id !== area.id);
  const ccActivos = asociadas.filter((x) => x.activo).map((x) => x.centro_costo_id);

  return (
    <div className="tarjeta">
      <div className="acciones-fila">
        <h2 style={{ margin: 0 }}>{area.nombre}</h2>
        {!area.activo ? <span className="insignia-suave">Inactiva</span> : null}
        <span className="texto-suave">Jefe: {area.jefe_id ? nombre(area.jefe_id) : '⚠ sin jefe'} · Ruta superior: {area.aprobador_superior_id ? nombre(area.aprobador_superior_id) : 'no configurada'} · {miembros.length} persona(s) · {ccActivos.length} centro(s) de costo</span>
        <button type="button" className="boton-secundario" onClick={alAlternar}>{abierta ? 'Cerrar' : 'Configurar'}</button>
      </div>
      {resultado ? (resultado.ok ? <MensajeExito texto={resultado.texto} /> : <MensajeError texto={resultado.texto} />) : null}
      {abierta ? (
        <>
          <h3>Paso 1 · Quién aprueba</h3>
          <div className="fila-campos">
            <Campo etiqueta="Jefe de área (aprueba las solicitudes del área)" requerido>
              <select value={jefe} onChange={(e) => setJefe(e.target.value)}>
                <option value="">— Sin jefe —</option>
                {activas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </Campo>
            <Campo etiqueta="Ruta superior (aprueba las solicitudes del propio jefe)" opcional
              ayuda="Si falta y el jefe solicita, su solicitud queda en borrador con el aviso. Nunca hay autoaprobación.">
              <select value={superior} onChange={(e) => setSuperior(e.target.value)}>
                <option value="">— No configurada —</option>
                {activas.filter((p) => p.id !== jefe).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </Campo>
          </div>
          <Campo etiqueta="Motivo del cambio" opcional>
            <input value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </Campo>
          <button type="button" className="boton-primario" onClick={() => void ejecutar(async () => {
            const r = await rpc<{ reasignadas: number; sin_aprobador: number }>('fn_admin_configurar_area', {
              p_area: area.id, p_jefe: jefe || null, p_superior: superior || null, p_motivo: motivo.trim() || 'Configuración de aprobadores'
            });
            return `Aprobadores guardados.${r.reasignadas ? ` ${r.reasignadas} solicitud(es) pendiente(s) reasignada(s) al nuevo aprobador.` : ''}${r.sin_aprobador ? ` ⚠ ${r.sin_aprobador} pendiente(s) quedaron sin aprobador válido.` : ''}`;
          })}>Guardar aprobadores</button>

          <h3>Paso 2 · Personas del área</h3>
          {!area.jefe_id ? <p className="mensaje mensaje-error">Primero configura el jefe del área (paso 1); sin jefe, las solicitudes del área no se pueden enviar.</p> : null}
          {miembros.length === 0 ? <p className="texto-suave">Nadie vinculado todavía.</p> : (
            <ul>
              {miembros.map((p) => (
                <li key={p.id}>
                  {p.nombre} {p.estado !== 'activo' ? `(${p.estado})` : ''}{p.id === area.jefe_id ? ' · jefe' : ''}
                  {' '}<button type="button" className="boton-silencioso" onClick={() => void ejecutar(async () => {
                    await rpc('fn_admin_vincular_area', { p_area: null, p_usuarios: [p.id], p_motivo: `Desvinculado de ${area.nombre}` });
                    return `${p.nombre} quedó sin área.`;
                  })}>Quitar del área</button>
                </li>
              ))}
            </ul>
          )}
          <Campo etiqueta="Vincular personas a esta área" opcional ayuda="Mantén Ctrl presionado para elegir varias. Si ya tenían otra área, se cambian a esta (queda auditado).">
            <select multiple size={Math.min(8, Math.max(3, candidatos.length))} value={agregar}
              onChange={(e) => setAgregar(Array.from(e.target.selectedOptions as HTMLCollectionOf<HTMLOptionElement>, (o) => o.value))}>
              {candidatos.map((p) => <option key={p.id} value={p.id}>{p.nombre}{p.area_id ? ' (tiene otra área)' : ''}</option>)}
            </select>
          </Campo>
          <button type="button" className="boton-primario" disabled={agregar.length === 0} onClick={() => void ejecutar(async () => {
            const n = await rpc<number>('fn_admin_vincular_area', { p_area: area.id, p_usuarios: agregar, p_motivo: `Vinculación a ${area.nombre}` });
            setAgregar([]);
            return `${n} persona(s) vinculada(s) a ${area.nombre}.`;
          })}>Vincular seleccionadas</button>

          <h3>Paso 3 · Centros de costo autorizados</h3>
          <p className="texto-suave">
            {ccActivos.length === 1 ? 'Tiene uno solo: se seleccionará automáticamente y el solicitante no podrá cambiarlo.'
              : ccActivos.length > 1 ? 'Tiene varios: el solicitante elige solo entre estos.' : '⚠ Sin centros autorizados: el área no puede crear solicitudes.'}
            {' '}Por ahora el centro de costo se asigna por solicitud (pendiente confirmar varias destinaciones por artículo).
          </p>
          <div className="fila-campos">
            {centros.map((c) => {
              const marcado = ccActivos.includes(c.id);
              return (
                <label key={c.id} className="campo" style={{ flexDirection: 'row', gap: '0.4rem', alignItems: 'center' }}>
                  <input type="checkbox" checked={marcado} disabled={!c.activo && !marcado} onChange={() => void ejecutar(async () => {
                    const { error } = await supabase.from('area_centros_costo').upsert(
                      { area_id: area.id, centro_costo_id: c.id, activo: !marcado }, { onConflict: 'area_id,centro_costo_id' });
                    if (error) throw new Error(limpiarError(error.message));
                    return `${c.codigo} ${!marcado ? 'autorizado para' : 'retirado de'} ${area.nombre}.`;
                  })} />
                  <span>{c.codigo} · {c.nombre}{!c.activo ? ' (inactivo)' : ''}</span>
                </label>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}
