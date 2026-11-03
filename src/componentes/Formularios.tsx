import { Children, cloneElement, createContext, isValidElement, useContext, useEffect, useId, useRef, useState } from 'react';
import type { FormHTMLAttributes, ReactElement, ReactNode, SyntheticEvent } from 'react';
import { useNotificaciones } from './Notificaciones.tsx';
import { validarValor } from '../util/validacion.ts';

const Validacion = createContext<Record<string, string>>({});
type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
function esControl(el: EventTarget | null): el is Control {
  return el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement;
}
function errorControl(el: Control): string | null {
  if (el.disabled || ['hidden', 'submit', 'button', 'file'].includes(el.type)) return null;
  if (el instanceof HTMLInputElement && ['checkbox', 'radio'].includes(el.type))
    return el.required && !el.checked ? 'Marca esta opción para continuar.' : null;
  const texto = validarValor(el.value, {
    requerido: el.required,
    minimo: 'minLength' in el && el.minLength > 0 ? el.minLength : undefined,
    maximo: 'maxLength' in el && el.maxLength > 0 ? el.maxLength : undefined,
    tipo: el.dataset.numero === 'true' ? 'number' : el.type,
    positivo: el.dataset.positivo === 'true',
    min: el instanceof HTMLInputElement && el.min ? Number(el.min) : undefined,
    max: el instanceof HTMLInputElement && el.max ? Number(el.max) : undefined
  });
  if (texto) return texto;
  if (el.dataset.igualA && el.value !== (document.getElementById(el.dataset.igualA) as HTMLInputElement | null)?.value) return 'Las contraseñas no coinciden. Revisa ambos campos.';
  if (!el.validity.valid) return 'Revisa el formato o el valor de este campo.';
  return null;
}

/** Valida todos los campos antes del envío y conserva el formulario ante un fallo. */
export function Formulario({ children, onSubmit, onChangeCapture, onBlurCapture, onClickCapture, ...props }: FormHTMLAttributes<HTMLFormElement>) {
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const [demorado, setDemorado] = useState(false);
  const enviado = useRef(false);
  const tocados = useRef(new Set<string>());
  const ocupado = useRef(false);
  const id = useId();
  const clave = `formulario-${id}`;
  const { notificar, cerrarClave } = useNotificaciones();
  useEffect(() => { if (Object.keys(errores).length === 0) cerrarClave(clave); }, [errores, clave, cerrarClave]);
  useEffect(() => () => cerrarClave(clave), [clave, cerrarClave]);
  useEffect(() => {
    setDemorado(false);
    if (!enviando) return;
    const timer = window.setTimeout(() => setDemorado(true), 12000);
    return () => window.clearTimeout(timer);
  }, [enviando]);
  function actualizar(el: Control) {
    if (!el.id) return;
    const mensaje = errorControl(el);
    setErrores((xs) => {
      const siguiente = { ...xs };
      if (mensaje) siguiente[el.id] = mensaje; else delete siguiente[el.id];
      return siguiente;
    });
  }
  function cambio(e: SyntheticEvent<HTMLFormElement>) {
    if (enviado.current) {
      const form = e.currentTarget;
      queueMicrotask(() => {
        const siguientes: Record<string, string> = {};
        for (const control of form.querySelectorAll<Control>('[data-campo-control]')) {
          const mensaje = errorControl(control); if (mensaje) siguientes[control.id] = mensaje;
        }
        setErrores(siguientes);
      });
    } else if (esControl(e.target) && tocados.current.has(e.target.id)) actualizar(e.target);
  }
  return <Validacion.Provider value={errores}>
    <form {...props} noValidate aria-busy={enviando || undefined}
      onClickCapture={(e) => {
        const boton = (e.target as HTMLElement).closest('button');
        if (e.detail > 1 && boton?.type === 'submit') e.preventDefault();
        onClickCapture?.(e);
      }}
      onChangeCapture={(e) => { cambio(e); onChangeCapture?.(e); }}
      onBlurCapture={(e) => { if (esControl(e.target)) { tocados.current.add(e.target.id); if (!(e.relatedTarget instanceof HTMLButtonElement && e.relatedTarget.type === 'submit')) actualizar(e.target); } onBlurCapture?.(e); }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (ocupado.current) return;
        enviado.current = true;
        const controles = Array.from(e.currentTarget.querySelectorAll<Control>('[data-campo-control]'));
        const nuevos: Record<string, string> = {};
        for (const control of controles) {
          const error = errorControl(control);
          if (error && control.id) nuevos[control.id] = error;
        }
        setErrores(nuevos);
        const cantidad = Object.keys(nuevos).length;
        if (cantidad) {
          notificar(`Revisa ${cantidad === 1 ? 'el campo señalado' : `los ${cantidad} campos señalados`} para continuar. Tus datos siguen en el formulario.`, 'error', clave);
          const primero = controles.find((el) => nuevos[el.id]);
          primero?.focus({ preventScroll: true });
          primero?.scrollIntoView({ block: 'center', behavior: 'auto' });
          return;
        }
        cerrarClave(clave);
        ocupado.current = true;
        setEnviando(true);
        try { await onSubmit?.(e); }
        catch (error) { notificar(error instanceof Error ? error.message : 'No pudimos confirmar el resultado. Revisa tus registros antes de repetir la operación.', 'error', clave); }
        finally { ocupado.current = false; setEnviando(false); }
      }}>
      <fieldset className="formulario-contenido" disabled={enviando}>{children}</fieldset>
      {enviando ? <p className="formulario-progreso" role="status">{demorado ? 'La respuesta está tardando más de lo habitual. La operación sigue en curso; no vuelvas a enviarla. Comprueba tu conexión.' : 'Enviando la información. Espera la confirmación antes de continuar…'}</p> : null}
    </form>
  </Validacion.Provider>;
}

export function Campo({ etiqueta, requerido, opcional, error, ayuda, children }: {
  etiqueta: string; requerido?: boolean; opcional?: boolean; error?: string | null; ayuda?: string; children: ReactNode;
}) {
  const generado = useId();
  const errores = useContext(Validacion);
  const lista = Children.toArray(children);
  const control = lista.find((child) => isValidElement(child) && typeof child.type === 'string' && ['input', 'select', 'textarea'].includes(child.type)) as ReactElement<Record<string, unknown>> | undefined;
  const id = String(control?.props.id ?? `campo-${generado}`);
  const mensaje = error || errores[id];
  const descripcion = [control?.props['aria-describedby'], ayuda ? `${id}-ayuda` : '', mensaje ? `${id}-error` : ''].filter(Boolean).join(' ');
  return <div className={`campo${mensaje ? ' campo-invalido' : ''}`}>
    <label className="campo-etiqueta" htmlFor={id}>{etiqueta}{opcional ? ' (opcional)' : ''}{requerido ? <span className="campo-requerido" aria-label="obligatorio"> *</span> : null}</label>
    {lista.map((child) => child === control ? cloneElement(control, {
      id, required: requerido || control.props.required || undefined,
      'data-campo-control': true, 'aria-invalid': mensaje ? true : undefined,
      'aria-describedby': descripcion || undefined
    }) : child)}
    {ayuda ? <span className="campo-ayuda" id={`${id}-ayuda`}>{ayuda}</span> : null}
    {mensaje ? <span className="campo-error" id={`${id}-error`}><span aria-hidden="true">! </span>{mensaje}</span> : null}
  </div>;
}
