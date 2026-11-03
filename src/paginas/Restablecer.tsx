import { Formulario, Cargando } from '../componentes/UI.tsx';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, limpiarError } from '../supabase.ts';
import { Campo, MensajeError, MensajeExito } from '../componentes/UI.tsx';

/**
 * Página destino del enlace de recuperación supervisada.
 * El enlace es de un solo uso y caduca; si llega vencido, Auth lo rechaza.
 */
export function Restablecer() {
  const navegar = useNavigate();
  const [listo, setListo] = useState(false);
  const [clave, setClave] = useState('');
  const [clave2, setClave2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    // El SDK procesa el token del enlace (detectSessionInUrl). Si el enlace es
    // inválido o vencido, llega error en el fragmento de la URL.
    const frag = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const desc = frag.get('error_description');
    if (desc) {
      setError('El enlace no es válido o ya venció. Pide al administrador un enlace nuevo.');
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setListo(true);
      else setError('Este enlace ya fue usado o venció. Pide al administrador un enlace nuevo.');
    });
    const { data: sub } = supabase.auth.onAuthStateChange((evento) => {
      if (evento === 'PASSWORD_RECOVERY' || evento === 'SIGNED_IN') setListo(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (clave.length < 10) { setError('La contraseña debe tener al menos 10 caracteres.'); return; }
    if (clave !== clave2) { setError('Las contraseñas no coinciden.'); return; }
    setOcupado(true);
    try {
      const { error: e1 } = await supabase.auth.updateUser({ password: clave });
      if (e1) throw new Error(limpiarError(e1.message));
      setExito('Contraseña actualizada. Ya puedes usar la aplicación.');
      setTimeout(() => navegar('/', { replace: true }), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="acceso">
      <p className="marca-grande">🛒 Compras Semanales Presh Tech</p>
      <h2>Definir nueva contraseña</h2>
      {listo ? (
        <Formulario className="formulario" onSubmit={guardar}>
          <Campo etiqueta="Nueva contraseña (mínimo 10 caracteres)" requerido>
            <input id="clave-principal" type="password" minLength={10} value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="new-password" />
          </Campo>
          <Campo etiqueta="Repite la contraseña" requerido>
            <input type="password" data-igual-a="clave-principal" value={clave2} onChange={(e) => setClave2(e.target.value)} autoComplete="new-password" />
          </Campo>
          <MensajeError texto={error} />
          <MensajeExito texto={exito} />
          <button type="submit" className="boton-primario" disabled={ocupado}>
            {ocupado ? 'Guardando…' : 'Guardar contraseña'}
          </button>
        </Formulario>
      ) : (
        <><MensajeError texto={error} />{error ? <p className="texto-suave">No puedes cambiar la contraseña con este enlace. Pide al administrador uno nuevo por un canal corporativo.</p> : <Cargando texto="Validando el enlace…" />}</>
      )}
    </div>
  );
}
