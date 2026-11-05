import { Formulario } from '../componentes/UI.tsx';
import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePermisos } from '../permisos.ts';
import { AdminNav } from '../componentes/AdminNav.tsx';
import { supabase, rpc, limpiarError } from '../supabase.ts';
import { useSesion } from '../contexto/Sesion.tsx';
import { useCatalogos, useActualizacionPeriodica } from '../datos.ts';
import type { VUsuarioAdmin, Rol } from '../tipos.ts';
import { ETIQUETA_ROL, DESCRIPCION_ROL, ROLES_PRIVILEGIADOS } from '../tipos.ts';
import { Campo, MensajeError, MensajeExito, Cargando, Modal, BotonConMotivo } from '../componentes/UI.tsx';
import { fmtFechaHora } from '../util/fechas.ts';

const ROLES: Rol[] = ['solicitante', 'compras', 'aprobador', 'almacen', 'consulta_global', 'emergencias', 'admin_usuarios', 'admin_catalogos', 'administrador'];

export function AdminUsuarios() {
  const { perfil } = useSesion();
  const permisos = usePermisos();
  const esPrivilegiado = (u: VUsuarioAdmin) => u.roles.some((r) => ROLES_PRIVILEGIADOS.includes(r));
  const puedeGestionar = (u: VUsuarioAdmin) => permisos.adminGeneral || !esPrivilegiado(u);
  const { cat } = useCatalogos();
  const [usuarios, setUsuarios] = useState<VUsuarioAdmin[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<'pendiente' | 'activo' | 'todos'>('pendiente');

  const [m, setM] = useState<null | { u: VUsuarioAdmin; roles: Rol[]; area: string; modo: 'activar' | 'roles' }>(null);
  const [mError, setMError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    let q = supabase.from('v_usuarios_admin').select('*').order('creado_en', { ascending: false });
    if (filtro !== 'todos') q = q.eq('estado', filtro);
    const { data, error: e } = await q;
    if (e) { setError(limpiarError(e.message)); return; }
    setUsuarios((data ?? []) as VUsuarioAdmin[]);
  }, [filtro]);

  useActualizacionPeriodica(cargar, 60000, [cargar]);

  async function guardarModal(e: React.FormEvent) {
    e.preventDefault();
    if (!m) return;
    setMError(null);
    if (m.roles.length === 0) { setMError('Asigna al menos un permiso (normalmente "solicitante").'); return; }
    setOcupado(true);
    try {
      if (m.modo === 'activar') {
        await rpc('fn_admin_activar_usuario', {
          p_usuario: m.u.id, p_roles: m.roles, p_area: m.area || null, p_version: m.u.version
        });
        setExito(`Cuenta de ${m.u.nombre} activada. Recuerda que la verificación de identidad por canal corporativo es un paso tuyo, previo a esta activación.`);
      } else {
        await rpc('fn_admin_establecer_roles', { p_usuario: m.u.id, p_roles: m.roles, p_motivo: 'Ajuste de permisos desde Administración' });
        if (m.area !== (m.u.area_id ?? '')) {
          await rpc('fn_admin_cambiar_area_usuario', { p_usuario: m.u.id, p_area: m.area || null, p_motivo: 'Ajuste de área desde Administración', p_version: m.u.version });
        }
        setExito(`Permisos de ${m.u.nombre} actualizados.`);
      }
      setM(null);
      await cargar();
    } catch (err) { setMError(err instanceof Error ? err.message : String(err)); }
    finally { setOcupado(false); }
  }

  return (
    <div className="contenido">
      <h1>Administración</h1>
      <AdminNav />
      <h2>Usuarios</h2>
      <p className="texto-suave">
        Nadie elige su propio privilegio: tú verificas la identidad por un canal corporativo
        existente (llamada, chat interno) y luego activas. Escribir un correo @presh-tech.com
        no demuestra pertenencia aunque el proveedor lo marque como confirmado.
      </p>
      <div className="filtros">
        <div className="acciones-fila" role="tablist">
          <button type="button" className={filtro === 'pendiente' ? 'boton-primario' : 'boton-secundario'} onClick={() => setFiltro('pendiente')}>Pendientes</button>
          <button type="button" className={filtro === 'activo' ? 'boton-primario' : 'boton-secundario'} onClick={() => setFiltro('activo')}>Activos</button>
          <button type="button" className={filtro === 'todos' ? 'boton-primario' : 'boton-secundario'} onClick={() => setFiltro('todos')}>Todos</button>
        </div>
        <button type="button" className="boton-secundario" onClick={() => void cargar()}>Actualizar</button>
      </div>
      {!permisos.adminGeneral ? (
        <p className="mensaje mensaje-exito">Tienes permiso para administrar usuarios con permisos básicos. Las cuentas y los permisos de administración, consulta global y emergencias solo los gestiona el administrador general.</p>
      ) : null}
      <p className="texto-suave">Después de activar una cuenta, el administrador general puede aplicarle automáticamente su cargo, área y jefe desde <Link to="/admin/organigrama">Personas y aprobaciones</Link>.</p>
      <MensajeError texto={error} flotante alCerrar={() => setError(null)} />
      <MensajeExito texto={exito} flotante alCerrar={() => setExito(null)} />
      {!usuarios ? <Cargando /> : usuarios.length === 0 ? (
        <div className="tarjeta"><p>No hay usuarios en este filtro.</p></div>
      ) : (
        <div className="tabla-envoltura">
          <table className="tabla">
            <thead><tr>
              <th>Nombre</th><th>Correo</th><th>Estado</th><th>Permisos</th>
              <th className="oculto-movil">Área</th><th className="oculto-movil">Registrado</th><th>Acciones</th>
            </tr></thead>
            <tbody>
              {usuarios.map((u) => (
                <tr key={u.id}>
                  <td>{u.nombre}{u.id === perfil?.id ? ' (tú)' : ''}</td>
                  <td>{u.correo}</td>
                  <td>{u.estado === 'pendiente' ? 'Pendiente' : u.estado === 'activo' ? 'Activo' : u.estado === 'desactivado' ? 'Desactivado' : 'Rechazado'}</td>
                  <td>{u.roles.length === 0 ? '—' : u.roles.map((r) => ETIQUETA_ROL[r]).join(', ')}</td>
                  <td className="oculto-movil">{u.area_nombre ?? '—'}</td>
                  <td className="oculto-movil">{fmtFechaHora(u.creado_en)}</td>
                  <td>
                    <div className="acciones-fila">
                      {!puedeGestionar(u) ? <span className="texto-suave">Solo el administrador general</span> : null}
                      {puedeGestionar(u) && u.estado === 'pendiente' ? (
                        <button type="button" className="boton-primario"
                          onClick={() => { setMError(null); setM({ u, roles: ['solicitante'], area: u.area_id ?? '', modo: 'activar' }); }}>
                          Activar…
                        </button>
                      ) : null}
                      {puedeGestionar(u) && u.estado === 'pendiente' ? (
                        <BotonConMotivo etiqueta="Rechazar" clase="boton-peligro" titulo={`Rechazar a ${u.nombre}`}
                          onConfirmar={async (mo) => {
                            await rpc('fn_admin_cambiar_estado_usuario', { p_usuario: u.id, p_estado: 'rechazado', p_motivo: mo, p_version: u.version });
                            await cargar();
                          }} />
                      ) : null}
                      {puedeGestionar(u) && u.estado === 'activo' ? (
                        <>
                          <button type="button" className="boton-secundario"
                            onClick={() => { setMError(null); setM({ u, roles: [...u.roles], area: u.area_id ?? '', modo: 'roles' }); }}>
                            Permisos…
                          </button>
                          <BotonConMotivo etiqueta="Desactivar" clase="boton-peligro" titulo={`Desactivar a ${u.nombre}`}
                            descripcion="El bloqueo es inmediato aunque tenga una sesión abierta."
                            onConfirmar={async (mo) => {
                              await rpc('fn_admin_cambiar_estado_usuario', { p_usuario: u.id, p_estado: 'desactivado', p_motivo: mo, p_version: u.version });
                              await cargar();
                            }} />
                        </>
                      ) : null}
                      {puedeGestionar(u) && (u.estado === 'desactivado' || u.estado === 'rechazado') ? (
                        <BotonConMotivo etiqueta="Reactivar" titulo={`Reactivar a ${u.nombre}`}
                          onConfirmar={async (mo) => {
                            await rpc('fn_admin_cambiar_estado_usuario', { p_usuario: u.id, p_estado: 'activo', p_motivo: mo, p_version: u.version });
                            await cargar();
                          }} />
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="texto-suave">
        No es posible desactivar al último administrador activo ni quitarse a sí mismo el rol
        de administrador (protecciones del servidor). La recuperación del administrador, si
        algún día no queda ninguno, la hace el responsable técnico con el script del SQL Editor
        (ver docs/PRIMER_ADMINISTRADOR.md).
      </p>

      <Modal titulo={m?.modo === 'activar' ? `Activar a ${m?.u.nombre}` : `Permisos de ${m?.u.nombre}`} abierto={!!m} alCerrar={() => setM(null)}>
        {m ? (
          <Formulario className="formulario" onSubmit={guardarModal}>
            {m.modo === 'activar' ? (
              <p>¿Verificaste la identidad de <b>{m.u.nombre}</b> ({m.u.correo}) por un canal corporativo?</p>
            ) : null}
            <fieldset className="campo">
              <legend className="campo-etiqueta">Permisos (pueden coexistir)</legend>
              {ROLES.filter((r) => permisos.adminGeneral || !ROLES_PRIVILEGIADOS.includes(r)).map((r) => (
                <label key={r} style={{ display: 'block', marginBottom: '0.35rem' }}>
                  <input type="checkbox" checked={m.roles.includes(r)}
                    onChange={(e) => setM({ ...m, roles: e.target.checked ? [...m.roles, r] : m.roles.filter((x) => x !== r) })} />
                  {' '}<b>{ETIQUETA_ROL[r]}</b>{ROLES_PRIVILEGIADOS.includes(r) ? ' · solo administrador general' : ''}
                  <span className="campo-ayuda" style={{ display: 'block', marginLeft: '1.4rem' }}>{DESCRIPCION_ROL[r]}</span>
                </label>
              ))}
              <span className="campo-ayuda">Ser jefe de área no es un permiso: se asigna en Estructura. Consultar toda la operación no da permiso para cambiar roles.</span>
            </fieldset>
            <Campo etiqueta="Área del usuario">
              <select value={m.area} onChange={(e) => setM({ ...m, area: e.target.value })}>
                <option value="">— Sin área —</option>
                {cat?.areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
              </select>
            </Campo>
            <MensajeError texto={mError} />
            <div className="modal-acciones">
              <button type="button" className="boton-secundario" onClick={() => setM(null)}>Cancelar</button>
              <button type="submit" className="boton-primario" disabled={ocupado}>
                {ocupado ? 'Guardando…' : m.modo === 'activar' ? 'Activar cuenta' : 'Guardar permisos'}
              </button>
            </div>
          </Formulario>
        ) : null}
      </Modal>
    </div>
  );
}
