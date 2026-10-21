# Respaldo y restauración (plan gratuito, herramientas gratuitas)

> El plan Free de Supabase **no incluye copias automáticas** (verificado en la
> documentación oficial el 21/10/2026). Mientras el piloto esté vivo, el respaldo es una
> rutina nuestra. Una exportación CSV desde la aplicación **no** es un respaldo técnico
> restaurable, y un volcado de base de datos **sin los archivos adjuntos** tampoco es un
> respaldo completo: aquí se cubren ambos.

## Qué SÍ queda respaldado con esta guía

| Pieza | Cómo | Dónde queda |
|---|---|---|
| Esquema + datos (tablas, funciones, políticas de `public` y `app`) | `pg_dump` | `respaldos\AAAA-MM-DD\base_datos.dump` |
| Archivos adjuntos del bucket privado | `docs/scripts/respaldo.ps1` (modo descarga) | `respaldos\AAAA-MM-DD\storage\…` |
| Usuarios de autenticación (UUID + correo, para recrearlos) | consulta SQL → CSV | `respaldos\AAAA-MM-DD\usuarios_auth.csv` |
| Código de la aplicación | repositorio privado de GitHub | GitHub |

## Qué NO se respalda (y cómo se repone)

- **Contraseñas**: los hashes no se exportan en este procedimiento. Tras una restauración,
  cada usuario recupera acceso con un **enlace supervisado** del administrador (1 minuto
  por persona). Esto es deliberado: más seguro y suficiente para el piloto.
- **Configuración del panel** (ajustes de Auth, secreto del CAPTCHA, secreto `APP_URL` de
  la función): se reconfigura a mano con la `GUIA_DESPLIEGUE.md` (partes B4–B6 y C). Son
  5 minutos; esta guía es su copia escrita.
- **La auditoría es parte del dump** (tabla `public.auditoria`) — sí queda incluida.

## Preparación (una sola vez, ~10 minutos)

1. **Herramienta gratuita `pg_dump` para Windows**: descarga el instalador de PostgreSQL
   para Windows desde `https://www.postgresql.org/download/windows/` (enlace "Download the
   installer", gratuito). En el instalador **desmarca todo excepto “Command Line Tools”**
   (no necesitas el servidor). Siguiente-siguiente-finalizar.
   - Quedará, por ejemplo, en `C:\Program Files\PostgreSQL\17\bin\pg_dump.exe`.
2. **Cadena de conexión**: en Supabase → botón **Connect** (arriba) → pestaña con
   **Session pooler** → copia la cadena `postgresql://postgres.xxxx:[YOUR-PASSWORD]@aws-…-pooler.supabase.com:5432/postgres`
   y sustituye `[YOUR-PASSWORD]` por la contraseña de base de datos que guardaste al crear
   el proyecto (B1 de la guía). *Usa el “Session pooler” (funciona desde redes IPv4 normales).* 
3. Crea la carpeta `C:\RespaldosCompras`.

## Rutina diaria del piloto (5 minutos, al cierre de la jornada)

1. **Base de datos** — abre PowerShell y ejecuta (una línea; comillas incluidas):
   ```powershell
   & "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe" --dbname="PEGA_AQUI_LA_CADENA_SESSION_POOLER" --schema=public --schema=app --format=custom --no-owner --file="C:\RespaldosCompras\$(Get-Date -Format yyyy-MM-dd)_base_datos.dump"
   ```
   - ✅ Termina sin mensajes de error y aparece el archivo `.dump` del día.
   - ❌ `password authentication failed`: la contraseña de la cadena no es la de la base
     (resetéala en Supabase → Project Settings → Database si se perdió).
2. **Archivos adjuntos** — en PowerShell:
   ```powershell
   powershell -ExecutionPolicy Bypass -File "docs\scripts\respaldo.ps1" -Modo descarga -Url "https://TU-PROYECTO.supabase.co" -Carpeta "C:\RespaldosCompras\$(Get-Date -Format yyyy-MM-dd)_storage"
   ```
   Te pedirá la **clave secreta (service_role)**: cópiala de Supabase → Project Settings →
   API Keys solo en ese momento; el script **no la guarda** en ningún archivo.
3. **Usuarios de Auth** — en Supabase → SQL Editor ejecuta:
   ```sql
   select id, email, created_at from auth.users order by created_at;
   ```
   y usa el botón de **descargar CSV** del resultado; guárdalo como
   `C:\RespaldosCompras\AAAA-MM-DD_usuarios_auth.csv`.
4. Copia la carpeta del día al almacenamiento corporativo habitual (unidad de red o la
   carpeta corporativa sincronizada que ya usen). Conserva al menos los últimos 7 días y
   uno semanal del mes.

## Prueba de restauración (en un entorno separado y seguro — NUNCA sobre producción)

El plan gratuito permite **2 proyectos activos** (verificado): el segundo es nuestro
laboratorio de restauración y de pruebas. Antes de la validación gerencial debe hacerse
**una vez completa**:

1. **Crear el proyecto de pruebas**: Supabase → New project → nombre
   `compras-restauracion` (Free). Copia su cadena *Session pooler* (con SU contraseña).
2. **Restaurar la base** (PowerShell; `pg_restore` se instaló junto a `pg_dump`):
   ```powershell
   & "C:\Program Files\PostgreSQL\17\bin\pg_restore.exe" --dbname="CADENA_DEL_PROYECTO_DE_PRUEBAS" --no-owner --no-privileges --clean --if-exists "C:\RespaldosCompras\AAAA-MM-DD_base_datos.dump"
   ```
   - ✅ Pueden salir avisos (warnings); errores graves en rojo me los copias.
   - Después ejecuta en su SQL Editor el archivo `supabase/migrations/0007_adjuntos_storage.sql`
     (recrea el bucket y sus políticas de Storage: son idempotentes) y
     `supabase/migrations/0012_endurecimiento.sql` (permisos de API).
3. **Recrear los usuarios con sus MISMOS identificadores** (para que perfiles, solicitudes
   y auditoría les sigan perteneciendo). En el SQL Editor del proyecto de pruebas, por cada
   fila del CSV de usuarios (o pídeme que te genere el bloque completo desde tu CSV):
   ```sql
   insert into auth.users (id, email, raw_user_meta_data)
   values ('UUID-DEL-CSV', 'correo@presh-tech.com', '{}')
   on conflict (id) do nothing;
   ```
   Las contraseñas no viajan: cada usuario entraría con un enlace supervisado nuevo.
4. **Restaurar los archivos** al bucket del proyecto de pruebas:
   ```powershell
   powershell -ExecutionPolicy Bypass -File "docs\scripts\respaldo.ps1" -Modo subida -Url "https://PROYECTO-DE-PRUEBAS.supabase.co" -Carpeta "C:\RespaldosCompras\AAAA-MM-DD_storage"
   ```
   (pide la service key DEL PROYECTO DE PRUEBAS).
5. **Verificar**: en Table Editor del proyecto de pruebas revisa que `solicitudes`,
   `articulos`, `movimientos` y `auditoria` tienen los datos; en Storage, que los archivos
   están. Con eso la restauración queda **demostrada sin tocar producción**.
6. Deja ese segundo proyecto como entorno de pruebas permanente (ahí corre también
   `supabase/pruebas/pruebas_aceptacion.sql`). Si no lo usas, se pausará solo: no estorba.

## Pausas del plan gratuito y reanudación

- Un proyecto Free **se pausa tras ~1 semana sin actividad**; los datos no se pierden y se
  reanuda desde el panel (**Resume project**, 1–2 minutos). Existe una ventana documentada
  de hasta 1 año para reanudar un proyecto pausado: no dejes pasar meses sin entrar.
- El uso diario normal de Compras evita la pausa. **Prohibido** generar tráfico artificial
  para "mantenerlo despierto": si el proyecto se pausara un lunes, se reanuda a mano y listo.
- Tras una reanudación: entra a la app, inicia sesión y abre una solicitud (verificación de
  1 minuto). Si algo falla, restaura la rutina de respaldo del día anterior en el proyecto
  de pruebas y avísame.

## Reglas de oro

- La clave **service_role** solo se teclea en el momento del respaldo y jamás se guarda en
  archivos, scripts, chats ni capturas. El script la pide cada vez por eso mismo.
- Los respaldos contienen datos empresariales: trátalos como información interna
  (carpeta corporativa con acceso restringido). La carpeta `respaldos/` está excluida del
  repositorio por `.gitignore`.
- Antes de cualquier migración o cambio grande: respaldo manual extra.
