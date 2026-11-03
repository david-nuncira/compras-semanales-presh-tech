# Mejora del frontend y mensajes de interacción

Implementada el 27 de octubre de 2026 en `codex/frontend-intuitivo`.
Base local: `3dc766d`, desde la rama local `mejora-v2`, sin cambios locales pendientes al iniciar.

## Componentes compartidos

- `ProveedorNotificaciones` envuelve la aplicación: máximo tres avisos visibles, anclados abajo a la izquierda. Éxitos: seis segundos; información y advertencias: nueve; errores: cierre explícito. Los temporizadores se pausan con el cursor o el foco.
- `useNotificaciones()` permite emitir avisos desde el resultado de una acción. `MensajeError` y `MensajeExito` conectan los estados existentes con este servicio mediante un efecto con clave estable, sin efectos durante el render.
- `Formulario` reúne la validación antes del envío, identifica todos los campos inválidos, enfoca el primero, evita el segundo envío de un doble clic y bloquea los controles durante la operación. Si la respuesta tarda, mantiene un mensaje explicativo sin afirmar que falló ni invitar a duplicar la solicitud.
- `Campo` asocia etiqueta, ayuda y error mediante identificadores, `aria-invalid` y `aria-describedby`.
- `Modal` gestiona foco inicial, recorrido con Tab, restauración del foco, Escape, bloqueo durante el envío y confirmación para descartar cambios sin guardar. Las notificaciones se alojan dentro del diálogo activo y reservan espacio para no taparlo.
- `EstadoError` ofrece un reintento en cargas fallidas. `EstadoVacio` orienta cuando no hay registros.

Para nuevos formularios, utiliza `Formulario` y `Campo`; conserva los atributos `required`, `minLength`, `type`, `pattern`, etc. Los importes pueden usar `data-numero="true"`; las cantidades estrictamente positivas, `data-positivo="true"`. Una confirmación de contraseña puede indicar `data-igual-a` con el identificador del campo original.

## Cambios funcionales de la interfaz

Catálogos conserva los valores si el servidor rechaza el guardado. Solo limpia tras confirmar la escritura. Las actualizaciones comprueban filas devueltas para no anunciar éxito cuando el registro cambió.

Nueva solicitud y artículos tienen validación por campo, estados de envío y protección ante doble envío. Adjuntos mantiene descargas autenticadas, añade vista previa de imágenes y confirmación visual de eliminación. El tablero tiene acceso rápido por rol y un estado de error recuperable. La navegación y el estilo se adaptan a móvil.

No hay cambios de esquema, migraciones, roles, políticas RLS ni funciones de negocio en PostgreSQL. La lógica existente del proveedor de sesión y la configuración pública se conservan.

## Verificación

Con Node 24 se ejecutaron:

```text
npm run typecheck
npm run build
npm run test:logica
```

La tarea `test:logica` ahora enumera los archivos de prueba, porque el argumento de directorio anterior no funcionaba en el runtime de verificación.

Resultado: 22 pruebas de lógica aprobadas y una omitida por faltar el CSV histórico real en este entorno. Se añadieron ocho pruebas sobre validación y mensajes seguros.

Además, 17 comprobaciones automatizadas de navegador cubrieron formularios vacíos, varios errores, foco, corrección, fallo del servidor con datos conservados, éxito confirmado, doble clic, avisos al final de páginas largas, pausa al pasar el cursor, modales, descarte de cambios, reintento de carga, acceso y tamaño móvil de 390 px. Se utilizaron la compilación real y respuestas de API simuladas; las demás conexiones se bloquearon. No se crearon registros ni cuentas reales.

## Revisión local

Los entregables del chat incluyen capturas antes/después, reporte de resultados y una vista previa HTML autónoma con datos ficticios. La vista previa simula guardados en memoria y permite provocar errores: no se conecta a Supabase real. Utiliza navegación en memoria únicamente para poder abrir el archivo HTML directamente; el proyecto conserva BrowserRouter.

Para desarrollar normalmente en la carpeta del proyecto:

```text
npm install
npm run dev
```

La aplicación normal utiliza su configuración de Supabase; no debe confundirse con la demostración autónoma.

## Límites pendientes

- No se verificaron autenticación real, permisos de la base productiva ni almacenamiento privado contra Supabase real.
- La consulta remota de GitHub no pudo autenticarse en este entorno. Los cambios se basan en la copia local indicada; hay que comprobar posibles avances remotos de Claude antes de integrar/publicar.
- No se ejecutaron migraciones, no se hizo push y no se publicó en Cloudflare.
- La navegación por teclado y las asociaciones accesibles se comprobaron en navegador; no se realizó una auditoría manual con lector de pantalla.
