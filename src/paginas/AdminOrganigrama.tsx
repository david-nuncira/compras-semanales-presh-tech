import { useCallback, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { rpc, supabase, limpiarError } from '../supabase.ts';
import { useActualizacionPeriodica } from '../datos.ts';
import { AdminNav } from '../componentes/AdminNav.tsx';
import { Campo, Formulario, MensajeError, Cargando, EstadoError } from '../componentes/UI.tsx';
import { useNotificaciones } from '../componentes/Notificaciones.tsx';
import type { Area, VUsuarioAdmin } from '../tipos.ts';
import '../organizacion.css';

interface Persona {
  id: string;
  nombre: string;
  cargo: string;
  area_nombre: string;
  jefe_nombre: string | null;
  verificacion: string;
  correo_esperado?: string;
  area_sistema?: string;
}
interface Config { gerente_id: string | null; suplente_id: string | null; umbral_cop: number; }
interface Correos { habilitado: boolean; estados: Record<string, number>; }
type FiltroVinculo = 'todas' | 'vinculadas' | 'pendientes';

const JEFATURAS = new Set([
  'elvis-luque', 'sindi-sanchez', 'javier-diaz', 'nicolas-diaz', 'andrea-leon', 'ivonne-suta'
]);

function correoNormalizado(correo: string | null | undefined): string {
  return (correo ?? '').trim().toLocaleLowerCase('es-CO');
}

function etiquetaEstadoCuenta(cuenta: VUsuarioAdmin | undefined): string {
  if (!cuenta) return 'Pendiente de registro';
  if (cuenta.estado === 'activo') return 'Vinculada y activa';
  if (cuenta.estado === 'pendiente') return 'Pendiente de activación';
  if (cuenta.estado === 'desactivado') return 'Cuenta desactivada';
  return 'Cuenta rechazada';
}

/** Un catálogo claro: datos de referencia y cuentas reales nunca se confunden. */
export function AdminOrganigrama() {
  const { notificar } = useNotificaciones();
  const [personas, setPersonas] = useState<Persona[] | null>(null);
  const [usuarios, setUsuarios] = useState<VUsuarioAdmin[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [config, setConfig] = useState<Config>({ gerente_id: null, suplente_id: null, umbral_cop: 500000 });
  const [correos, setCorreos] = useState<Correos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtroArea, setFiltroArea] = useState('');
  const [filtroTexto, setFiltroTexto] = useState('');
  const [filtroVinculo, setFiltroVinculo] = useState<FiltroVinculo>('todas');
  const [personaId, setPersonaId] = useState('');
  const [usuarioId, setUsuarioId] = useState('');
  const [areaId, setAreaId] = useState('');
  const [jefeId, setJefeId] = useState('');
  const [avanzadoAbierto, setAvanzadoAbierto] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const bloqueo = useRef(false);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const [p, u, a, c, m] = await Promise.all([
        supabase.from('organigrama_personas').select('*').eq('activo', true).order('nombre'),
        supabase.from('v_usuarios_admin').select('*').order('nombre'),
        supabase.from('areas').select('*').eq('activo', true).order('nombre'),
        rpc<Config>('fn_configuracion_aprobaciones', {}),
        rpc<Correos>('srv_correo_estado', {})
      ]);
      if (p.error || u.error || a.error) throw new Error(p.error?.message ?? u.error?.message ?? a.error?.message);
      setPersonas((p.data ?? []) as Persona[]);
      setUsuarios((u.data ?? []) as VUsuarioAdmin[]);
      setAreas((a.data ?? []) as Area[]);
      setConfig(c);
      setCorreos(m);
    } catch (e) {
      setError(limpiarError(e instanceof Error ? e.message : String(e)));
    }
  }, []);

  useActualizacionPeriodica(cargar, 60000, [cargar]);

  const cuentaPorCorreo = useMemo(() => new Map(usuarios.map((u) => [correoNormalizado(u.correo), u])), [usuarios]);
  const activas = usuarios.filter((u) => u.estado === 'activo');
  const aprobadores = activas.filter((u) => u.roles.includes('aprobador'));
  const persona = personas?.find((p) => p.id === personaId);

  const resumen = useMemo(() => {
    const todas = personas ?? [];
    const vinculadas = todas.filter((p) => cuentaPorCorreo.get(correoNormalizado(p.correo_esperado))?.estado === 'activo');
    const jefesListos = todas.filter((p) => JEFATURAS.has(p.id) && cuentaPorCorreo.get(correoNormalizado(p.correo_esperado))?.estado === 'activo');
    return { total: todas.length, vinculadas: vinculadas.length, pendientes: todas.length - vinculadas.length, jefesListos: jefesListos.length };
  }, [personas, cuentaPorCorreo]);

  const personasFiltradas = useMemo(() => {
    const texto = filtroTexto.trim().toLocaleLowerCase('es-CO');
    return (personas ?? []).filter((p) => {
      const cuenta = cuentaPorCorreo.get(correoNormalizado(p.correo_esperado));
      const coincideArea = !filtroArea || p.area_nombre === filtroArea;
      const coincideTexto = !texto || [p.nombre, p.cargo, p.correo_esperado, p.jefe_nombre].some((valor) => valor?.toLocaleLowerCase('es-CO').includes(texto));
      const coincideVinculo = filtroVinculo === 'todas'
        || (filtroVinculo === 'vinculadas' && cuenta?.estado === 'activo')
        || (filtroVinculo === 'pendientes' && cuenta?.estado !== 'activo');
      return coincideArea && coincideTexto && coincideVinculo;
    });
  }, [personas, cuentaPorCorreo, filtroArea, filtroTexto, filtroVinculo]);

  const areasCatalogo = useMemo(() => [...new Set((personas ?? []).map((p) => p.area_nombre))].sort((a, b) => a.localeCompare(b, 'es-CO')), [personas]);

  async function guardar(fn: () => Promise<unknown>, mensaje: string) {
    if (bloqueo.current) return;
    bloqueo.current = true;
    setOcupado(true);
    try {
      await fn();
      notificar(mensaje, 'exito');
      await cargar();
    } catch (e) {
      notificar(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      bloqueo.current = false;
      setOcupado(false);
    }
  }

  function seleccionarPersona(id: string) {
    const seleccion = personas?.find((p) => p.id === id);
    const cuenta = cuentaPorCorreo.get(correoNormalizado(seleccion?.correo_esperado));
    const area = areas.find((a) => a.nombre.toLocaleUpperCase('es-CO') === seleccion?.area_sistema?.toLocaleUpperCase('es-CO'));
    const jefe = personas?.find((p) => p.nombre === seleccion?.jefe_nombre);
    const cuentaJefe = cuentaPorCorreo.get(correoNormalizado(jefe?.correo_esperado));
    setPersonaId(id);
    setUsuarioId(cuenta?.id ?? '');
    setAreaId(area?.id ?? cuenta?.area_id ?? '');
    setJefeId(cuentaJefe?.estado === 'activo' ? cuentaJefe.id : '');
  }

  if (!personas) {
    return <div className="contenido"><span className="sobre-titulo">ADMINISTRACIÓN</span><h1>Personas y aprobaciones</h1><AdminNav /><MensajeError texto={error} />{error ? <EstadoError alReintentar={() => void cargar()} /> : <Cargando texto="Cargando el catálogo de personas…" />}</div>;
  }

  const siguienteTitulo = resumen.pendientes > 0
    ? `Hay ${resumen.pendientes} persona${resumen.pendientes === 1 ? '' : 's'} por registrar o activar`
    : !config.gerente_id ? 'Falta definir la aprobación de gerencia'
      : 'El catálogo y las reglas principales están listos';
  const siguienteDescripcion = resumen.pendientes > 0
    ? 'Activa primero la cuenta corporativa de la persona. Después usa “Aplicar relaciones” y el sistema asignará cargo, área y jefe sin volver a escribirlos.'
    : !config.gerente_id ? 'Cuando Yeffer o su reemplazo tengan una cuenta activa con permiso de aprobador, selecciónalos en la configuración avanzada.'
      : 'Las nuevas solicitudes irán al jefe de área y las cotizaciones superiores a $500.000 COP pasarán a gerencia.';

  return <div className="contenido">
    <span className="sobre-titulo">ADMINISTRACIÓN · PASO A PASO</span>
    <h1>Personas, responsables y reglas</h1>
    <p className="texto-suave">Aquí administras la estructura de la empresa. Primero se registra una cuenta; luego el sistema le asigna automáticamente su área y jefe.</p>
    <AdminNav />
    <MensajeError texto={error} />

    <section className="panel-prioridad" aria-label="Siguiente paso recomendado">
      <div><span className="sobre-titulo">SIGUIENTE PASO RECOMENDADO</span><h2>{siguienteTitulo}</h2><p>{siguienteDescripcion}</p></div>
      <div className="panel-prioridad-accion">
        {resumen.pendientes > 0 ? <Link className="boton-primario enlace-boton" to="/admin">Ver cuentas por activar</Link> : null}
        {resumen.pendientes === 0 && !config.gerente_id ? <a className="boton-primario enlace-boton" href="#configuracion-avanzada" onClick={() => setAvanzadoAbierto(true)}>Configurar gerencia</a> : null}
        {resumen.pendientes === 0 && config.gerente_id ? <span className="insignia-suave">✓ Reglas listas</span> : null}
      </div>
    </section>

    <section className="resumen-organizacion" aria-label="Resumen del catálogo">
      <article><b>{resumen.total}</b><span>personas en el catálogo</span></article>
      <article><b>{resumen.vinculadas}</b><span>cuentas activas vinculadas</span></article>
      <article><b>{resumen.pendientes}</b><span>pendientes de registrar</span></article>
      <article><b>{resumen.jefesListos} / {JEFATURAS.size}</b><span>jefaturas con cuenta activa</span></article>
    </section>

    <section className="tarjeta flujo-admin">
      <div className="seccion-cabecera"><div><span className="sobre-titulo">ORDEN SENCILLO</span><h2>Así se deja lista una persona</h2></div><span className="insignia-suave">Sin crear usuarios automáticamente</span></div>
      <ol className="pasos-admin">
        <li><span className="paso-numero">1</span><div><b>Verifica y activa la cuenta</b><p>Confirma su identidad por un canal corporativo y actívala con el permiso correspondiente.</p><Link to="/admin">Ir a Usuarios y permisos →</Link></div></li>
        <li><span className="paso-numero">2</span><div><b>Aplica el organigrama</b><p>El sistema busca el correo corporativo esperado y asigna el cargo, área y jefe que ya están cargados.</p><button type="button" className="boton-primario" disabled={ocupado} onClick={() => void guardar(async () => {
          const r = await rpc<{ vinculadas: number; faltantes: Array<{ nombre: string }> }>('fn_sincronizar_organigrama', {});
          notificar(`${r.vinculadas} cuentas quedaron relacionadas. ${r.faltantes.length} aún necesitan una cuenta activa.`, 'info');
        }, 'Relaciones del organigrama actualizadas.')}>{ocupado ? 'Aplicando…' : 'Aplicar relaciones ahora'}</button></div></li>
        <li><span className="paso-numero">3</span><div><b>Confirma la gerencia</b><p>Las compras con cotización superior a $500.000 COP pasan a Yeffer o a su reemplazo.</p><a href="#configuracion-avanzada" onClick={() => setAvanzadoAbierto(true)}>Ir a la configuración →</a></div></li>
      </ol>
    </section>

    <section className="tarjeta catalogo-personas" aria-labelledby="catalogo-personas-titulo">
      <div className="seccion-cabecera"><div><span className="sobre-titulo">CATÁLOGO CORPORATIVO</span><h2 id="catalogo-personas-titulo">Personas y jefes ya definidos</h2><p className="texto-suave">El catálogo no crea accesos. Te permite saber qué relación se aplicará cuando cada persona se registre.</p></div><span className="insignia-suave">{personasFiltradas.length} visibles</span></div>
      <div className="filtros filtros-catalogo">
        <Campo etiqueta="Buscar persona, cargo o correo"><input value={filtroTexto} onChange={(e) => setFiltroTexto(e.target.value)} placeholder="Ej. Diana, logística…" /></Campo>
        <Campo etiqueta="Área"><select value={filtroArea} onChange={(e) => setFiltroArea(e.target.value)}><option value="">Todas las áreas</option>{areasCatalogo.map((area) => <option key={area} value={area}>{area}</option>)}</select></Campo>
        <div className="campo"><span className="campo-etiqueta">Estado de la cuenta</span><div className="acciones-fila" role="group" aria-label="Filtrar por estado de cuenta">
          {([['todas', 'Todas'], ['vinculadas', 'Vinculadas'], ['pendientes', 'Pendientes']] as Array<[FiltroVinculo, string]>).map(([clave, etiqueta]) => <button key={clave} type="button" className={filtroVinculo === clave ? 'boton-primario' : 'boton-secundario'} onClick={() => setFiltroVinculo(clave)}>{etiqueta}</button>)}
        </div></div>
      </div>
      {personasFiltradas.length === 0 ? <div className="estado-vacio"><span className="estado-icono" aria-hidden="true">⌕</span><h3>No encontramos personas con ese filtro</h3><p>Prueba con otro nombre, área o estado de cuenta.</p></div> : <div className="lista-personas">
        {personasFiltradas.map((p) => {
          const cuenta = cuentaPorCorreo.get(correoNormalizado(p.correo_esperado));
          const listaJefe = JEFATURAS.has(p.id);
          return <article className={`persona-catalogo${cuenta?.estado === 'activo' ? ' vinculada' : ''}`} key={p.id}>
            <div className="persona-iniciales" aria-hidden="true">{p.nombre.split(' ').map((x) => x[0]).slice(0, 2).join('')}</div>
            <div className="persona-contenido"><div className="persona-titulo"><div><h3>{p.nombre}</h3><p>{p.cargo}</p></div><span className={cuenta?.estado === 'activo' ? 'insignia estado-vinculada' : 'insignia estado-pendiente'}>{etiquetaEstadoCuenta(cuenta)}</span></div>
              <dl className="persona-datos"><div><dt>Área</dt><dd>{p.area_nombre}</dd></div><div><dt>Jefe directo</dt><dd>{p.jefe_nombre ?? 'Gerencia general'}</dd></div><div><dt>Correo corporativo</dt><dd>{p.correo_esperado ?? 'Por definir'}</dd></div></dl>
              {listaJefe ? <span className="etiqueta-jefatura">Jefatura de área · aprueba primero las solicitudes de su equipo</span> : null}
              {cuenta?.estado !== 'activo' ? <p className="persona-ayuda">Cuando esta persona tenga una cuenta activa, usa “Aplicar relaciones” para completar su vínculo.</p> : null}
            </div>
          </article>;
        })}
      </div>}
    </section>

    <details className="configuracion-avanzada" id="configuracion-avanzada" open={avanzadoAbierto} onToggle={(e) => setAvanzadoAbierto(e.currentTarget.open)}>
      <summary><span>Configuración avanzada</span><small>Solo si necesitas corregir una relación o definir gerencia</small></summary>
      <div className="configuracion-avanzada-contenido">
        <section className="tarjeta"><h2>Gerencia para cotizaciones</h2><p>Más de $500.000 COP requiere aprobación de gerencia. Hasta ese valor inclusive, cotizar es opcional y no hay aprobación adicional.</p>
          <Formulario className="formulario" onSubmit={async () => guardar(() => rpc('fn_admin_configurar_gerencia', { p_gerente: config.gerente_id || null, p_suplente: config.suplente_id || null }), 'Responsables de gerencia guardados.')}>
            <div className="fila-campos"><Campo etiqueta="Gerente titular" requerido ayuda="Debe ser una cuenta activa con permiso de aprobador."><select value={config.gerente_id ?? ''} onChange={(e) => setConfig({ ...config, gerente_id: e.target.value })}><option value="">Selecciona una cuenta activa</option>{aprobadores.map((u) => <option key={u.id} value={u.id}>{u.nombre} · {u.correo}</option>)}</select></Campo>
              <Campo etiqueta="Reemplazo de gerencia" opcional ayuda="Se usa si el titular está inactivo o es quien solicita."><select value={config.suplente_id ?? ''} onChange={(e) => setConfig({ ...config, suplente_id: e.target.value })}><option value="">Sin reemplazo configurado</option>{aprobadores.filter((u) => u.id !== config.gerente_id).map((u) => <option key={u.id} value={u.id}>{u.nombre} · {u.correo}</option>)}</select></Campo></div>
            <button className="boton-primario" type="submit" disabled={ocupado}>Guardar responsables de gerencia</button>
          </Formulario>
        </section>
        <section className="tarjeta"><h2>Corregir una relación de manera manual</h2><p className="texto-suave">Primero intenta “Aplicar relaciones”. Usa esta opción solo si existe una excepción real en el organigrama.</p>
          <Formulario className="formulario" onSubmit={async () => {
            const cuenta = usuarios.find((u) => u.id === usuarioId);
            if (!persona || !cuenta) throw new Error('Selecciona la persona y su cuenta corporativa verificada.');
            await guardar(() => rpc('fn_admin_configurar_persona', { p_usuario: cuenta.id, p_cargo: persona.cargo, p_area: areaId, p_jefe: jefeId || null, p_version: cuenta.version }), 'Cargo, área y jefe actualizados.');
          }}>
            <Campo etiqueta="Persona del catálogo" requerido><select value={personaId} onChange={(e) => seleccionarPersona(e.target.value)}><option value="">Selecciona una persona</option>{personas.map((p) => <option key={p.id} value={p.id}>{p.nombre} · {p.cargo}</option>)}</select></Campo>
            {persona ? <p className="aviso-contexto"><span aria-hidden="true">i</span> Se sugirieron los datos del catálogo: {persona.area_nombre} · jefe {persona.jefe_nombre ?? 'Gerencia'}.</p> : null}
            <div className="fila-campos"><Campo etiqueta="Cuenta corporativa verificada" requerido><select value={usuarioId} onChange={(e) => { const cuenta = usuarios.find((u) => u.id === e.target.value); setUsuarioId(e.target.value); setAreaId(cuenta?.area_id ?? areaId); setJefeId(cuenta?.jefe_id ?? jefeId); }}><option value="">Selecciona una cuenta</option>{activas.map((u) => <option key={u.id} value={u.id}>{u.nombre} · {u.correo}</option>)}</select></Campo>
              <Campo etiqueta="Área" requerido><select value={areaId} onChange={(e) => setAreaId(e.target.value)}><option value="">Selecciona el área</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}</select></Campo>
              <Campo etiqueta="Jefe individual" opcional ayuda="Vacío = jefe configurado para el área."><select value={jefeId} onChange={(e) => setJefeId(e.target.value)}><option value="">Usar jefe del área</option>{activas.filter((u) => u.id !== usuarioId).map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}</select></Campo></div>
            <button type="submit" className="boton-secundario" disabled={ocupado}>Guardar corrección manual</button>
          </Formulario>
        </section>
      </div>
    </details>

    <section className="tarjeta correo-organizacion"><h2>Notificaciones por correo</h2>{correos ? <><p>{correos.habilitado ? 'El envío por correo está habilitado.' : 'Por ahora los avisos se ven dentro de la aplicación. El correo se habilitará cuando Microsoft 365 autorice el remitente corporativo.'}</p><div className="acciones-fila">{Object.entries(correos.estados ?? {}).map(([estado, cantidad]) => <span className="insignia-suave" key={estado}>{estado}: {cantidad}</span>)}</div></> : <p>Estado del correo no disponible.</p>}</section>
  </div>;
}
