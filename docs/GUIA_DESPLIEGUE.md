# Guía de despliegue — Compras Semanales Presh Tech

Para Windows, sin conocimientos de programación y sin instalar programas.
Tiempo estimado: 60–90 minutos la primera vez. Hazla en orden; cada paso dice
**dónde entrar, qué pulsar, qué debes ver y cómo reconocer un error**.

> **Dos clases de valores — no los confundas:**
> - **PÚBLICOS** (van en `public/config.js`, viajan al navegador, no pasa nada por verlos):
>   la *URL del proyecto* de Supabase, la clave *anon/publishable* y la *Site Key* de Turnstile.
> - **SECRETOS** (solo se pegan en paneles del servidor, JAMÁS en archivos del proyecto,
>   capturas o chats): la clave *service_role / secret key* de Supabase y la *Secret Key*
>   de Turnstile. Esta guía te dice exactamente el único lugar donde va cada una.

Yo (Claude) puedo acompañarte en vivo: si abres estas páginas en el navegador integrado
de la app de Claude, puedo ir pegando el SQL y revisando los resultados contigo. Tú harás
siempre los pasos de cuentas, contraseñas y secretos.

---

## Parte A · Crear las tres cuentas gratuitas (si no existen)

**A1. Cuenta de Supabase** (base de datos y usuarios)
1. Entra a `https://supabase.com` y pulsa **Start your project** / **Sign up**.
2. Regístrate con un correo corporativo controlado por la empresa (recomendado:
   un buzón del área de sistemas, no personal). También puedes usar "Continue with GitHub"
   después del paso A3 si prefieres una sola cuenta.
3. Confirma el correo si te lo pide. **No pide tarjeta.**
   - ✅ Debes ver el panel con el botón **New project**.
   - ❌ Si pide organización: crea una con el nombre `Presh Tech` (plan Free).

**A2. Cuenta de Cloudflare** (página web y anti-robots)
1. Entra a `https://dash.cloudflare.com/sign-up`.
2. Email y contraseña; confirma el correo. **No pide tarjeta.**
   - ✅ Debes ver el panel de Cloudflare (puede ofrecerte agregar un dominio: **omítelo**,
     no lo necesitamos).

**A3. Cuenta de GitHub** (repositorio privado del código)
1. Entra a `https://github.com/signup`.
2. Email corporativo, contraseña, nombre de usuario (p. ej. `presh-tech-si`).
   - ✅ Debes poder entrar a `https://github.com` con tu usuario.

> Las tres cuentas deben quedar **bajo control de la empresa** (correo corporativo y
> contraseñas guardadas según la política interna). Anota qué correo usaste para cada una.
> El responsable de recuperación designado es el analista de SI (David Nuncira).

---

## Parte B · Crear el proyecto de Supabase y cargar la base de datos

**B1. Crear el proyecto**
1. En `https://supabase.com/dashboard` pulsa **New project**.
2. Llena: *Name* = `compras-semanales`, *Database Password* = genera una larga con el botón
   y **guárdala en el gestor de contraseñas de la empresa** (es la contraseña técnica de la
   base; no se usa a diario pero sirve para respaldos), *Region* = la más cercana
   (p. ej. *South America (São Paulo)*), plan **Free**.
3. Pulsa **Create new project** y espera 1–2 minutos a que diga que está listo.
   - ✅ Verás el tablero del proyecto.

**B2. Copiar los dos valores PÚBLICOS**
1. Menú izquierdo → ⚙️ **Project Settings** → **Data API**: copia **Project URL**
   (algo como `https://abcdefgh.supabase.co`) a un bloc de notas.
2. En **Project Settings** → **API Keys**: copia la clave **anon public** (o "publishable").
   - ⚠️ En esa misma pantalla verás la **service_role / secret key**: **NO la copies ahora,
     no la pegues en ningún archivo.** Solo se usa dentro de Supabase (la función del paso B6
     la recibe sola) y, si algún día haces respaldo de archivos, en tu propio PC.

**B3. Cargar el esquema completo (las 12 migraciones)**
1. Menú izquierdo → **SQL Editor** → **New query**.
2. Abre en tu PC el archivo `supabase/setup_completo.sql` con el Bloc de notas
   (clic derecho → Abrir con → Bloc de notas), selecciona todo (Ctrl+A), copia (Ctrl+C)
   y pégalo en el editor SQL (Ctrl+V).
3. Pulsa **Run** (o Ctrl+Enter). Tarda unos segundos.
   - ✅ Resultado esperado: "Success. No rows returned".
   - ❌ Si sale un error en rojo: copia el texto COMPLETO del error y pásamelo; también
     puedes cargar los archivos `supabase/migrations/0001…0012` uno por uno en orden
     (cada uno en una consulta nueva) para ubicar en cuál ocurre.
4. Verificación rápida: menú **Table Editor** → debes ver tablas como `perfiles`,
   `solicitudes`, `articulos`, `compras`, `movimientos`, `auditoria`.
5. Verificación del bucket: menú **Storage** → debe existir el bucket **adjuntos**
   (privado). ❌ Si no aparece, dímelo (lo crea la migración 0007).

**B4. Configurar la autenticación (sin correos)**
1. Menú **Authentication** → **Sign In / Providers** (o "Providers") → **Email**.
2. Desactiva **Confirm email** (el registro NO enviará correos; la activación es manual
   del administrador). Guarda (**Save**).
3. En la misma sección busca **Minimum password length** y ponla en **10**. Guarda.
   - ✅ Debe quedar: Email habilitado, Confirm email apagado, mínimo 10.
   - ℹ️ Por qué: el SMTP incluido de Supabase solo envía 2 correos/hora y únicamente a
     miembros del equipo técnico; no sirve para los empleados. Nuestra seguridad no depende
     del correo: depende de tu verificación de identidad + activación manual.

**B5. URLs permitidas** (se completa cuando exista la URL de la Parte D; vuelve aquí)
1. **Authentication** → **URL Configuration**.
2. *Site URL*: `https://TU-SITIO.pages.dev` (la dirección que te dará Cloudflare en D4).
3. *Redirect URLs* → **Add URL**: `https://TU-SITIO.pages.dev/restablecer`.
   - ℹ️ Esto valida la redirección de los enlaces de recuperación (un solo uso). Su
     caducidad se controla en **Providers → Email → Email OTP expiration** (1 hora por defecto; déjalo así).

**B6. Crear la función de recuperación supervisada (sin instalar nada)**
1. Menú **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Nombre: `recuperacion-supervisada` (exacto, con guion).
3. Borra el contenido de ejemplo y pega TODO el archivo
   `supabase/functions/recuperacion-supervisada/index.ts`. Pulsa **Deploy**.
   - ✅ La función aparece en la lista con estado activo.
4. Secretos de la función: en **Edge Functions** → **Secrets** (o "Manage secrets")
   → **Add new secret**: *Key* = `APP_URL`, *Value* = `https://TU-SITIO.pages.dev`
   (vuelve a este paso al terminar D4 si aún no tienes la dirección). Guarda.
   - ℹ️ `SUPABASE_URL` y la clave privilegiada las inyecta Supabase automáticamente a la
     función: tú nunca las manipulas.

---

## Parte C · Anti-robots (Turnstile) — recomendado antes de abrir a toda la empresa

1. En el panel de Cloudflare, menú izquierdo → **Turnstile** → **Add widget**.
2. *Widget name*: `compras-semanales`. *Hostnames* → **Add**: escribe tu futuro dominio
   `TU-SITIO.pages.dev` (puedes volver a este paso tras D4). *Widget Mode*: **Managed**. Crea.
3. Copia la **Site Key** (pública) al bloc de notas. Copia la **Secret Key** SOLO para el
   paso siguiente.
4. En Supabase: ⚙️ **Project Settings** → **Authentication** (sección *Bot and Abuse
   Protection*) → **Enable CAPTCHA protection** → proveedor **Turnstile** → pega la
   **Secret Key** → **Save**. (La validación la hace el propio servidor de Auth, no la página.)
   - ⚠️ Si activas el CAPTCHA en Supabase pero dejas `TURNSTILE_SITE_KEY` vacío en
     `config.js` (Parte D), el registro fallará con "captcha verification failed":
     los dos pasos van juntos.

---

## Parte D · Publicar la página (ruta A: GitHub + compilación en la nube; sin instalar nada)

**D1. Crear el repositorio privado**
1. En GitHub: botón **+** (arriba derecha) → **New repository**.
2. *Name* = `compras-semanales-presh-tech`, visibilidad **Private** → **Create repository**.

**D2. Subir el proyecto**
1. En la página del repositorio vacío, pulsa el enlace **uploading an existing file**.
2. Abre la carpeta del proyecto en el Explorador de Windows, selecciona TODO su contenido
   **excepto** las carpetas `node_modules` y `dist` si existieran (selecciona archivos y
   carpetas: `src`, `public`, `supabase`, `docs`, `index.html`, `package.json`, etc.)
   y arrástralo al recuadro del navegador. Espera a que cargue la lista completa.
3. Abajo, en *Commit changes*, escribe `Versión inicial del piloto` y pulsa **Commit changes**.
   - ✅ El repositorio muestra las carpetas `src`, `public`, `supabase`, `docs`…
   - ❌ Si el arrastre de carpetas no funciona en tu navegador, usa Edge o Chrome.

**D3. Escribir la configuración pública**
1. En GitHub, navega a `public/config.js` → icono de lápiz (**Edit this file**).
2. Reemplaza `PEGA_AQUI_LA_URL_DEL_PROYECTO` por tu **Project URL** (B2) y
   `PEGA_AQUI_LA_CLAVE_PUBLICA_ANON` por la clave **anon** (B2). Si hiciste la Parte C,
   pon la **Site Key** en `TURNSTILE_SITE_KEY` (si no, déjala `""` por ahora).
3. **Commit changes**. (Estos tres valores son públicos por diseño; la protección real
   son las políticas RLS del servidor.)

**D4. Conectar Cloudflare Pages**
1. Panel de Cloudflare → **Workers & Pages** → **Create application** → pestaña **Pages**
   → **Connect to Git** → autoriza GitHub y elige el repositorio.
2. *Project name*: `compras-presh` (será `compras-presh.pages.dev`; si está ocupado,
   prueba `compras-semanales-presh`; el nombre final lo verás en pantalla).
3. *Build settings*: Framework preset **Vite** (si no aparece: *Build command* =
   `npm run build`, *Build output directory* = `dist`).
4. **Environment variables** → **Add variable**: `NODE_VERSION` = `20`.
5. Pulsa **Save and Deploy** y espera 1–3 minutos mirando el registro de compilación.
   - ✅ Mensaje "Success" y tu dirección `https://XXXX.pages.dev` visible arriba.
   - ❌ Si la compilación falla: entra al registro (log), copia las últimas ~30 líneas y
     pásamelas; corrijo el archivo que falle y repites solo este paso (cada *commit*
     recompila automático).
6. Ahora que ya conoces la dirección real: completa **B5** (Site URL + Redirect) y, si
   aplica, **B6.4** (`APP_URL`) y **C2** (hostname del widget).

**D5. Primera entrada**
1. Abre `https://TU-SITIO.pages.dev` en el navegador.
   - ✅ Ves la pantalla verde "Compras Semanales Presh Tech" con *Iniciar sesión / Registrarme*.
   - ❌ "Falta la configuración": el paso D3 quedó con marcadores; edítalo de nuevo.
   - ❌ Página en blanco: avísame y revisamos juntos la consola del navegador (F12).

> **Ruta B (alternativa sin GitHub):** instala Node.js LTS de `https://nodejs.org`
> (botón verde, siguiente-siguiente), abre PowerShell en la carpeta del proyecto
> (Shift+clic derecho → "Abrir ventana de PowerShell aquí") y ejecuta `npm install` y
> `npm run build`. Edita `dist/config.js` con el Bloc de notas (igual que D3). Luego en
> Cloudflare: **Workers & Pages → Create application → Pages → Upload assets**, nombre del
> proyecto, y arrastra la **carpeta `dist`**. Para actualizar versiones repites compilación
> y **Create a new deployment**. La ruta A es la recomendada porque deja el repositorio
> privado como copia del código y actualizar es editar + commit.

---

## Parte E · Primer administrador y arranque

**E1. Regístrate en la aplicación**
1. En `https://TU-SITIO.pages.dev` → **Registrarme**: nombre `David Nuncira`, correo
   `david.nuncira@presh-tech.com`, contraseña de 10+ caracteres.
   - ✅ Mensaje: "Registro recibido. Tu cuenta queda PENDIENTE…".

**E2. Promuévete con el procedimiento controlado (SQL Editor = entorno de confianza)**
1. Supabase → **Authentication** → **Users**: localiza tu correo y copia su **UID**
   (icono de copiar junto al identificador).
2. **SQL Editor** → New query → pega el contenido de
   `supabase/bootstrap/90_promover_primer_admin.sql`.
3. Reemplaza `PEGAR-UUID-AQUI` por el UID copiado (queda entre comillas) y **Run**.
   - ✅ Mensaje: `Administrador promovido: david.nuncira@presh-tech.com (…)`.
   - ❌ "Reemplaza PEGAR-UUID-AQUI…" o "No existe un usuario…": revisa el UID.
4. Vuelve a la aplicación y pulsa **Volver a comprobar** (o entra de nuevo): verás el
   menú completo con **Administración**.

**E3. Datos de demostración (opcional, recomendados para la demo)**
1. SQL Editor → pega y ejecuta `supabase/bootstrap/95_datos_demo_ficticios.sql`
   (áreas, centros de costo y proveedores CLARAMENTE ficticios; los oficiales los
   cargará el administrador en **Administración → Catálogos** cuando Compras los valide).

**E4. Alta del resto de usuarios del piloto**
- Cada persona se registra en la URL; tú verificas su identidad por un canal corporativo
  (llamada/chat interno) y la activas en **Administración → Usuarios** con sus permisos.
  Procedimientos detallados: `docs/PRIMER_ADMINISTRADOR.md`.

---

## Parte F · Verificación final en la URL real (caso 14 de la matriz)

Marca cada punto:
- [ ] `https://TU-SITIO.pages.dev` abre con candado (HTTPS válido).
- [ ] Navegar directo a `https://TU-SITIO.pages.dev/mis-solicitudes` y **recargar (F5)**
      funciona (no da 404).
- [ ] Registro → cuenta queda pendiente → activación → entrada normal.
- [ ] Crear una solicitud de prueba con un adjunto JPG; cerrarla sesión y abrirla desde
      otro navegador/celular: los datos persisten.
- [ ] Descargar el adjunto funciona con sesión y falla sin sesión (pega la URL del archivo
      en una ventana de incógnito: debe negarse).
- [ ] En el código publicado no hay secretos: en el navegador pulsa Ctrl+U sobre la página
      y verifica que solo aparecen la URL del proyecto y la clave pública.
- [ ] La suite `supabase/pruebas/pruebas_aceptacion.sql` se ejecutó **en el proyecto de
      PRUEBAS** (no en el real) con todos los casos en PASA (ver
      `docs/MATRIZ_ACEPTACION.md`, incluye cómo crear ese segundo proyecto gratuito).

## Actualizar o revertir una versión sin perder datos

- Los **datos** viven en Supabase; publicar la página no los toca jamás.
- **Actualizar (ruta A):** edita los archivos en GitHub (o sube los cambiados con
  *Add file → Upload files*) → cada commit publica solo la página nueva.
- **Revertir:** Cloudflare → Workers & Pages → tu proyecto → **Deployments** → en el
  despliegue anterior elige **Rollback to this deployment**. Instantáneo y sin tocar datos.
- **Cambios de base de datos** (futuras versiones): se aplican como NUEVOS archivos de
  migración en el SQL Editor; nunca borrando ni recreando tablas. Antes de cualquier
  migración futura: respaldo (`docs/RESPALDO_Y_RESTAURACION.md`).
