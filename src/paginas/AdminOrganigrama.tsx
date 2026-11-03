import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { rpc, supabase, limpiarError } from '../supabase.ts';
import { useActualizacionPeriodica } from '../datos.ts';
import { AdminNav } from '../componentes/AdminNav.tsx';
import { Campo, Formulario, MensajeError, Cargando, EstadoError } from '../componentes/UI.tsx';
import { useNotificaciones } from '../componentes/Notificaciones.tsx';
import type { Area, VUsuarioAdmin } from '../tipos.ts';
import '../organizacion.css';

interface Persona { id: string; nombre: string; cargo: string; area_nombre: string; jefe_nombre: string | null; verificacion: string; correo_esperado?: string; area_sistema?: string; }
interface Config { gerente_id: string | null; suplente_id: string | null; umbral_cop: number; }
interface Correos { habilitado: boolean; estados: Record<string, number>; }
export function AdminOrganigrama() {
  const { notificar } = useNotificaciones();
  const [personas, setPersonas] = useState<Persona[] | null>(null);
  const [usuarios, setUsuarios] = useState<VUsuarioAdmin[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [config, setConfig] = useState<Config>({ gerente_id: null, suplente_id: null, umbral_cop: 500000 });
  const [correos, setCorreos] = useState<Correos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [personaId, setPersonaId] = useState(''), [usuarioId, setUsuarioId] = useState('');
  const [areaId, setAreaId] = useState(''), [jefeId, setJefeId] = useState('');
  const [ocupado, setOcupado] = useState(false); const bloqueo = useRef(false);
  const cargar = useCallback(async () => {
    setError(null);
    try {
      const [p, u, a, c, m] = await Promise.all([
        supabase.from('organigrama_personas').select('*').eq('activo', true).order('nombre'),
        supabase.from('v_usuarios_admin').select('*').order('nombre'),
        supabase.from('areas').select('*').eq('activo', true).order('nombre'),
        rpc<Config>('fn_configuracion_aprobaciones', {}), rpc<Correos>('srv_correo_estado', {})
      ]);
      if (p.error || u.error || a.error) throw new Error(p.error?.message ?? u.error?.message ?? a.error?.message);
      setPersonas((p.data ?? []) as Persona[]); setUsuarios((u.data ?? []) as VUsuarioAdmin[]); setAreas((a.data ?? []) as Area[]); setConfig(c); setCorreos(m);
    } catch (e) { setError(limpiarError(e instanceof Error ? e.message : String(e))); }
  }, []);
  useActualizacionPeriodica(cargar, 60000, [cargar]);
  const activas = usuarios.filter(u => u.estado === 'activo');
  const aprobadores = activas.filter(u => u.roles.includes('aprobador'));
  const persona = personas?.find(p => p.id === personaId);
  async function guardar(fn: () => Promise<unknown>, mensaje: string) {
    if (bloqueo.current) return; bloqueo.current = true; setOcupado(true);
    try { await fn(); notificar(mensaje, 'exito'); await cargar(); }
    catch (e) { notificar(e instanceof Error ? e.message : String(e), 'error'); }
    finally { bloqueo.current = false; setOcupado(false); }
  }
  if (!personas) return <div className="contenido"><h1>Organigrama y aprobaciones</h1><AdminNav /><MensajeError texto={error} />{error ? <EstadoError alReintentar={() => void cargar()} /> : <Cargando />}</div>;
  return <div className="contenido"><span className="sobre-titulo">ORGANIZACIÓN Y RESPONSABILIDADES</span><h1>Organigrama y aprobaciones</h1><AdminNav /><MensajeError texto={error} />
    <div className="aviso-contexto"><p>El jefe de área revisa la solicitud antes de Compras. Una cotización de más de $500.000 COP pasa automáticamente a gerencia. Hasta $500.000 COP inclusive, cotizar es opcional.</p></div>
    <section className="tarjeta"><h2>1. Aprobación de gerencia</h2><p>Vincula la cuenta verificada de Yeffer y la de quien lo reemplaza. Deben estar activas y tener el permiso Aprobador en <Link to="/admin">Usuarios y permisos</Link>. El reemplazo se usa si el titular está inactivo o es quien solicita; para una ausencia temporal, configura al reemplazo como titular.</p>
      <Formulario className="formulario" onSubmit={async () => guardar(() => rpc('fn_admin_configurar_gerencia', { p_gerente: config.gerente_id || null, p_suplente: config.suplente_id || null }), 'Responsables de gerencia guardados.')}>
        <Campo etiqueta="Gerente titular" requerido><select value={config.gerente_id ?? ''} onChange={e => setConfig({ ...config, gerente_id: e.target.value })}><option value="">Selecciona una cuenta activa</option>{aprobadores.map(u => <option key={u.id} value={u.id}>{u.nombre} · {u.correo}</option>)}</select></Campo>
        <Campo etiqueta="Reemplazo de gerencia" ayuda="Debe ser una persona diferente al titular."><select value={config.suplente_id ?? ''} onChange={e => setConfig({ ...config, suplente_id: e.target.value })}><option value="">Sin reemplazo configurado</option>{aprobadores.filter(u => u.id !== config.gerente_id).map(u => <option key={u.id} value={u.id}>{u.nombre} · {u.correo}</option>)}</select></Campo>
        <button className="boton-primario" type="submit" disabled={ocupado}>Guardar gerencia</button>
      </Formulario>
    </section>
    <section className="tarjeta"><h2>2. Vincular una persona con su cuenta</h2><p>Comprueba el nombre y el correo corporativo antes de guardar. Esta acción asigna cargo, área y jefe; los permisos de acceso se gestionan en Usuarios. Los jefes y centros de costo de cada área se configuran en <Link to="/admin/estructura">Estructura</Link>.</p>
      <Formulario className="formulario" onSubmit={async () => {
        const u = usuarios.find(u => u.id === usuarioId); if (!persona || !u) throw new Error('Selecciona la persona y su cuenta.');
        await guardar(() => rpc('fn_admin_configurar_persona', { p_usuario: u.id, p_cargo: persona.cargo, p_area: areaId, p_jefe: jefeId || null, p_version: u.version }), 'Cargo, área y jefe guardados para la cuenta verificada.');
      }}>
        <Campo etiqueta="Persona del organigrama" requerido><select value={personaId} onChange={e => {setPersonaId(e.target.value);setUsuarioId('');setAreaId('');setJefeId('');}}><option value="">Selecciona la persona</option>{personas.map(p => <option key={p.id} value={p.id}>{p.nombre} · {p.cargo}</option>)}</select></Campo>
        {persona ? <p className="aviso-contexto">Área de referencia: {persona.area_nombre} · Jefe: {persona.jefe_nombre ?? 'Gerencia'}. {persona.verificacion}</p> : null}
        <Campo etiqueta="Cuenta corporativa verificada" requerido><select value={usuarioId} onChange={e => { const u=usuarios.find(u => u.id===e.target.value); setUsuarioId(e.target.value);setAreaId(u?.area_id ?? '');setJefeId(u?.jefe_id ?? '');}}><option value="">Selecciona la cuenta</option>{activas.map(u => <option key={u.id} value={u.id}>{u.nombre} · {u.correo}</option>)}</select></Campo>
        <Campo etiqueta="Área de la cuenta" requerido><select value={areaId} onChange={e => setAreaId(e.target.value)}><option value="">Selecciona el área</option>{areas.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}</select></Campo>
        <Campo etiqueta="Jefe individual" ayuda="Si se deja vacío, se usa el jefe configurado para el área."><select value={jefeId} onChange={e => setJefeId(e.target.value)}><option value="">Usar jefe del área</option>{activas.filter(u => u.id !== usuarioId).map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}</select></Campo>
        <button type="submit" className="boton-primario" disabled={ocupado}>Guardar relación verificada</button>
      </Formulario>
    </section>
    <section className="tarjeta"><h2>3. Notificaciones por correo</h2>{correos ? <><p>{correos.habilitado ? 'El envío por correo está habilitado.' : 'El correo aún no está habilitado. Los avisos dentro de la aplicación se conservan.'}</p><p className="texto-suave">El estado “enviado” confirma que Microsoft aceptó el correo; revisa el buzón para comprobar su llegada. Los resultados inciertos requieren revisión antes de reenviar.</p><div className="acciones-fila">{Object.entries(correos.estados ?? {}).map(([estado, cantidad]) => <span className="insignia-suave" key={estado}>{estado}: {cantidad}</span>)}</div></> : <p>Estado del correo no disponible.</p>}</section>
    <section className="tarjeta"><h2>Aplicar el organigrama a las cuentas activas</h2><p>Relaciona por correo corporativo el cargo, área y jefe. No crea cuentas ni activa personas. Si un jefe aún no se ha registrado, se mostrará como pendiente de vincular.</p><button type="button" className="boton-primario" disabled={ocupado} onClick={() => void guardar(async () => { const r=await rpc<{vinculadas:number;faltantes:Array<{nombre:string}>}>('fn_sincronizar_organigrama',{}); notificar(`${r.vinculadas} cuentas vinculadas. ${r.faltantes.length} personas todavía no tienen cuenta activa.`,'info'); }, 'Organigrama aplicado a las cuentas activas.')}>Aplicar relaciones del organigrama</button></section><h2>Equipo por área</h2><p className="texto-suave">Referencia del organigrama de mayo de 2026 con tus correcciones. Los cargos marcados para confirmar requieren validación de Gestión Humana.</p><div className="organigrama-grupo">{[...new Set(personas.map(p => p.area_nombre))].map(area => <section className="tarjeta" key={area}><h3>{area}</h3><ul>{personas.filter(p => p.area_nombre===area).map(p => <li key={p.id}><strong>{p.nombre}</strong><br />{p.cargo}<br /><small>{p.correo_esperado}</small><br /><small className="texto-suave">Jefe: {p.jefe_nombre ?? '—'} · {p.verificacion}</small></li>)}</ul></section>)}</div>
  </div>;
}
