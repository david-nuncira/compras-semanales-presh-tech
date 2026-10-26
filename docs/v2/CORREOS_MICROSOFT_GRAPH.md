# Correos de notificación con Microsoft 365 (para TI)

**Por qué así:** Supabase no permite enviar por SMTP desde sus funciones; la documentación
oficial lo dice: *"Outgoing connections to ports 25 and 587 are not allowed"*. Microsoft Graph
`sendMail` usa HTTPS y está incluido en Microsoft 365, sin costo adicional (no aparece en la
lista de APIs con cobro por uso). Requiere que **un administrador del tenant** registre una
aplicación y dé su consentimiento.

Mientras esto no esté listo, las notificaciones siguen funcionando **dentro de la aplicación**.

## Lo que hace TI (una vez)

1. **Buzón remitente:** un buzón existente para notificaciones automáticas, por ejemplo uno
   compartido de Compras. Su dirección será `CORREO_REMITENTE`.
2. **Registro de la aplicación** en Microsoft Entra ID (App registrations → New registration):
   - Nombre: `Compras Semanales - notificaciones`.
   - Copiar **Application (client) ID** y **Directory (tenant) ID**.
   - En Certificates & secrets → **New client secret**, copiar el valor y anotar su vencimiento.
3. **Limitar a un solo buzón** (recomendado por Microsoft):
   - Usar **RBAC for Applications** en Exchange Online, con el rol "Application Mail.Send"
     acotado a un Management Scope que contenga solo el buzón remitente.
   - Importante: los permisos se suman. Si además se concede `Mail.Send` (Application) en Entra,
     el alcance deja de limitar. Use un mecanismo u otro, según la política de TI.
   - Los cambios tardan de 30 min a 2 h en aplicarse.
4. **Secretos en Supabase** (Edge Functions → Secrets), sin pegarlos en archivos ni chats:
   `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `CORREO_REMITENTE` y
   `CRON_SECRET`. Este último es un texto aleatorio largo, de 32 caracteres o más.

## Lo que hace el administrador de la app (con acompañamiento)

1. Supabase → Edge Functions → **Deploy a new function** → Via Editor →
   - Nombre `despachar-correos`.
   - Pegar el contenido de `supabase/functions/despachar-correos/index.ts`.
   - Desactivar "Enforce JWT verification", porque la protege la cabecera secreta.
   - Pulsar **Deploy**.
2. Database → Extensions → activar **pg_net**.
3. SQL Editor: crear los dos secretos de Vault descritos en `96_programar_tareas.sql` y quitar
   los guiones del bloque del trabajo `compras-despachar-correos`; luego ejecutar.
4. Activar el envío: SQL Editor →
   `update public.configuracion set valor = 'true' where clave = 'correo_habilitado';`
   y fijar la dirección de la app:
   `update public.configuracion set valor = '"https://TU-SITIO.pages.dev"' where clave = 'url_aplicacion';`

## Qué se envía y cómo se evita la saturación

- Correos individuales:
  - Al jefe, cuando le llega una solicitud.
  - Al solicitante, en aprobación, rechazo, devolución, recepción por Compras, compra, cambio de fecha estimada, llegada y entrega.
- A Compras: **un solo resumen por lote liberado** (por ciclo), no un correo por solicitud. Las
  extraordinarias se avisan al aprobarse.
- **Sin duplicados:** cada evento tiene una clave única en la cola.
- **Reintentos:** hasta 5, con espera creciente.
- **Descartes:** los correos con más de 48 h en cola no salen, para evitar avalanchas tardías;
  la notificación en la app se conserva.
- **Límite de Exchange Online:** 30 mensajes por minuto. La función envía como máximo 20 cada 5 minutos.
