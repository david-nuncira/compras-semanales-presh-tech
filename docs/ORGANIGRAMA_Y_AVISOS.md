# Correos y organigrama de Compras Semanales

Se usa el organigrama de mayo de 2026 más las correcciones de David: Elvis Luque (Logística), Sindi Sánchez (Gestión Humana y Administración), Javier Díaz (Comercial), Nicolás Díaz (Fisicoquímico), Andrea León (Investigación) e Ivonne Suta (Ensamble y Manufactura). Yeffer Gaona es Gerencia. Diana Ramírez, Auxiliar SST, depende de Sindi. Los 27 registros y las equivalencias pendientes de GH están en `supabase/migrations/0019_organigrama.sql`.

El patrón corporativo indicado por David es primer nombre + punto + primer apellido, sin tildes, @presh-tech.com. El catálogo conserva el correo esperado y lo compara con cuentas ya activadas; nunca crea contraseñas ni activa personas por el nombre.

## Envío por correo

La función `despachar-correos` usa Microsoft Graph sobre HTTPS y la cola existente `correos_cola`. Necesita en Edge Function Secrets `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `CORREO_REMITENTE` y `CRON_SECRET` (mínimo 32 caracteres). Supabase inyecta sus credenciales internas. No se guarda ningún secreto en el repositorio ni en el navegador.

Un administrador de Microsoft 365 debe autorizar el buzón remitente. Las direcciones de los destinatarios no sustituyen esa autorización. Hasta completar la configuración, los avisos siguen disponibles dentro de la aplicación y el panel indica que el correo no está habilitado.

El programador llama por POST a `/functions/v1/despachar-correos` con `X-Cron-Secret`; guardar URL y secreto en Vault. La función autentica ese secreto antes de hacer cualquier operación. El frontend no puede reclamar colas ni enviar mensajes arbitrarios.

Graph202 significa aceptado por Microsoft, sin garantizar entrega. Si el envío comenzó y se perdió la respuesta, se marca `incierto` y no se reenvía automáticamente. Los rechazos claros usan reintento con espera creciente; los avisos vencidos a las48h o tras5 intentos se descartan del correo, conservando el aviso interno.

No se envían adjuntos privados por correo: se manda un enlace a la aplicación que exige sesión y permisos. El aprobador ve la cotización, los importes y sus archivos allí.

## Validación

Pruebas del worker con Graph simulado: autentica el programador, no reclama sin configuración, no revela claves, confirma202 y evita duplicados ante resultados inciertos. No se envían correos reales durante esas pruebas. El envío real necesita comprobar el buzón remitente y receptor después de configurar Microsoft365.
