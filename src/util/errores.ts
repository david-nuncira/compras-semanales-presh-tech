/** Mensajes de interfaz; conserva las reglas de negocio expresadas en español. */
export function mensajeUsuario(valor: unknown): string {
  const m = typeof valor === 'string' ? valor : valor instanceof Error ? valor.message : '';
  const limpio = m.replace(/^[A-Z0-9]{5}:\s*/, '').trim();
  if (!limpio) return 'No pudimos completar la operación. Intenta de nuevo o contacta al administrador.';
  if (/failed to fetch|networkerror|network request|fetch failed|timeout|timed out|aborterror/i.test(limpio))
    return 'No pudimos confirmar el resultado por un problema de conexión. Revisa si el cambio se guardó antes de repetirlo.';
  if (/row.level security|permission denied|not authorized|unauthorized|jwt expired|invalid jwt/i.test(limpio))
    return 'Tu cuenta no tiene permiso para esta operación o tu sesión venció. Comprueba tu acceso con el administrador.';
  if (/duplicate key|unique constraint|already exists/i.test(limpio))
    return 'Ya existe un registro con esos datos. Revisa el nombre o el código antes de guardar.';
  if (/foreign key|violates.*constraint|invalid input syntax|column .* does not exist|relation .* does not exist|PGRST|schema cache|syntax error|SQLSTATE|stack trace/i.test(limpio))
    return 'No pudimos guardar con los datos seleccionados. Actualiza los catálogos y revisa la información. Si continúa, contacta al administrador.';
  if (/internal server error|bad gateway|service unavailable|deadlock detected|could not serialize|infinite recursion|invalid api key|unexpected token|cannot read propert|TypeError|Error:|\.tsx?:\d/i.test(limpio))
    return 'La aplicación no pudo completar esta acción. Conserva tus datos e intenta nuevamente. Si continúa, contacta al administrador.';
  return limpio;
}
