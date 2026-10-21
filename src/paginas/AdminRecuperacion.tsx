import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, limpiarError } from '../supabase.ts';
import { Campo, MensajeError, MensajeExito } from '../componentes/UI.tsx';

/**
 * Recuperación de acceso SUPERVISADA:
 * 1) El usuario te lo pide por un canal corporativo y verificas su identidad.
 * 2) Generas aquí un enlace de UN SOLO USO (lo crea el servidor con la API
 *    administrativa oficial; esta pantalla nunca ve contraseñas).
 * 3) Se lo entregas por el canal corporativo. El enlace caduca según la
 *    configuración de Auth (por defecto 1 hora) y deja de servir tras usarse.
 * El enlace NO se guarda: la auditoría registra solo quién lo gestionó,
 * para qué cuenta y cuándo.
 */
export function AdminRecuperacion() {
  const [correo, setCorreo] = useState('');
  const [enlace, setEnlace] = useState<string | null>(null);
  const [paraQuien, setParaQuien] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [copiado, setCopiado] = useState(false);

  async function generar(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setExito(null); setEnlace(null); setCopiado(false);
    const c = correo.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c)) { setError('Escribe un correo válido.'); return; }
    if (!window.confirm(`¿Verificaste la identidad de ${c} por un canal corporativo (llamada, chat interno)?`)) return;
    setOcupado(true);
    try {
      const { data, error: e1 } = await supabase.functions.invoke('recuperacion-supervisada', {
        body: { correo: c }
      });
      if (e1) {
        // El cuerpo de error de la función trae el mensaje en español.
        let msj = e1.message;
        try {
          const ctx = (e1 as { context?: Response }).context;
          if (ctx) { const j = await ctx.json(); if (j?.error) msj = j.error; }
        } catch { /* se usa el mensaje genérico */ }
        throw new Error(limpiarError(msj));
      }
      const d = data as { enlace?: string; error?: string };
      if (d?.error) throw new Error(d.error);
      if (!d?.enlace) throw new Error('El servidor no devolvió el enlace.');
      setEnlace(d.enlace);
      setParaQuien(c);
      setExito('Enlace generado. Se muestra UNA sola vez: cópialo y entrégalo por un canal corporativo.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="contenido">
      <h1>Administración · Recuperación de acceso</h1>
      <div className="acciones-fila">
        <Link to="/admin">Usuarios</Link> · <Link to="/admin/catalogos">Catálogos</Link> ·
        {' '}<Link to="/admin/auditoria">Auditoría</Link> · <Link to="/admin/recuperacion">Recuperación</Link> ·
        {' '}<Link to="/admin/importacion">Importación CSV</Link>
      </div>
      <div className="tarjeta">
        <h2>Generar enlace de recuperación (un solo uso)</h2>
        <ol>
          <li>Verifica la identidad de la persona por un canal corporativo existente.</li>
          <li>Genera el enlace y entrégaselo por ese mismo canal.</li>
          <li>La persona abre el enlace y define su nueva contraseña. Si caduca o ya se usó, genera otro.</li>
        </ol>
        <form className="formulario" onSubmit={generar}>
          <Campo etiqueta="Correo de la cuenta" requerido>
            <input type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} />
          </Campo>
          <MensajeError texto={error} />
          <MensajeExito texto={exito} />
          <div>
            <button type="submit" className="boton-primario" disabled={ocupado}>
              {ocupado ? 'Generando…' : 'Generar enlace de recuperación'}
            </button>
          </div>
        </form>
        {enlace ? (
          <div className="tarjeta" style={{ background: '#fdf3dd' }}>
            <p><b>Enlace para {paraQuien}</b> (visible solo ahora; no queda guardado en ninguna parte):</p>
            <p style={{ overflowWrap: 'anywhere' }}><code>{enlace}</code></p>
            <div className="acciones-fila">
              <button type="button" className="boton-primario" onClick={async () => {
                try { await navigator.clipboard.writeText(enlace); setCopiado(true); }
                catch { setError('No se pudo copiar automáticamente; selecciona el texto y cópialo manual.'); }
              }}>{copiado ? '✓ Copiado' : 'Copiar enlace'}</button>
              <button type="button" className="boton-secundario" onClick={() => { setEnlace(null); setCopiado(false); }}>
                Ocultar (ya lo entregué)
              </button>
            </div>
            <p className="texto-suave">Caduca según la configuración de Auth (1 hora por defecto) y deja de funcionar después del primer uso.</p>
          </div>
        ) : null}
        <p className="texto-suave">
          Esta pantalla nunca muestra ni cambia contraseñas. No existe envío de correos:
          no prometas “te llegará un correo”. Si no queda ningún administrador activo,
          la recuperación la hace el responsable técnico con el procedimiento del SQL
          Editor (docs/PRIMER_ADMINISTRADOR.md).
        </p>
      </div>
    </div>
  );
}
