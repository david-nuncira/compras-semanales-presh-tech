# Cómo aplicar la mejora v2 sin afectar producción

> **Presh Tech tiene un solo proyecto de Supabase:** sigue `GUIA_MISMO_PROYECTO.md` (respaldo
> interno, ensayo que se revierte solo y aplicación todo o nada). De esta guía usa solo la
> **Parte 2** (subir la rama a GitHub) y la **Parte 3** (verificación en la vista previa).

**Regla de oro:** primero en el proyecto de PRUEBAS y en una RAMA. Nada se toca en
producción hasta que hayas visto los resultados y des tu autorización por escrito.

La mejora está **integrada sobre tu repositorio real** (ZIP de GitHub del 26-oct-2026), así que
conserva tus correcciones de producción:

- `src/contexto/Sesion.tsx` (evita el bloqueo de Supabase Auth al iniciar sesión): **sin cambios**.
- `public/config.js` (tus valores públicos de producción): **sin cambios**; no viene en el paquete.
- `src/App.tsx`: se conserva tu `RedirigirRecuperacion` **idéntica**, ahora junto a la
  navegación de la v2. Además, mientras el perfil carga se muestra "Cargando" en lugar de
  redirigir a "Cuenta pendiente". Así, recargar una página interna ya no lleva al Inicio.
- El resto de archivos de acceso (`Acceso.tsx`, `Restablecer.tsx`, `PendienteActivacion.tsx`,
  `supabase.ts`, `AdminRecuperacion.tsx`, función `recuperacion-supervisada`) no cambia.

Antes de migrar, un **diagnóstico de solo lectura** compara la base de datos real con la línea
base y se detiene si encuentra funciones modificadas directamente en el SQL Editor.

---

## Parte 1 · Proyecto de PRUEBAS (Supabase)

Si ya tienes el segundo proyecto gratuito (el de restauración), úsalo. Si no, créalo:
Supabase → **New project** → `compras-pruebas` → plan Free.

1. **SQL Editor → New query:** pega y ejecuta `supabase/setup_completo.sql` (la línea base).
   ✅ "Success". Si el proyecto ya tenía la línea base, sáltate este paso.
2. **Nueva consulta:** `create table if not exists public.zz_entorno_de_pruebas (ok boolean);`
   Esta tabla marca el proyecto como de pruebas; sin ella, las suites de prueba se niegan a correr.
3. **Nueva consulta:** pega `supabase/diagnostico/00_diagnostico_previo.sql` → Run.
   ✅ El veredicto debe decir **LISTO PARA MIGRAR**.
4. **Nueva consulta, SOLA:** `supabase/migrations/0013_valores_nuevos.sql` → Run. ✅ "Success".
5. **Nueva consulta:** `supabase/setup_mejora_v2.sql` (0014 + 0015 + 0016) → Run. ✅ "Success".
   ❌ Si dice *unsafe use of new enum value*, el paso 4 no se ejecutó en una consulta aparte:
   repite el paso 4 solo y luego este.
6. **Nueva consulta:** `supabase/pruebas/pruebas_aprobacion_v2.sql` → Run.
   ✅ Al final verás la tabla de resultados. Copia la captura y compártemela: todos deben
   decir **PASA**, salvo el de inicio de sesión, que dice **PENDIENTE_MANUAL** porque se
   prueba en la vista previa.
   > La suite antigua `pruebas_aceptacion.sql` corresponde al flujo anterior (enviar = llegar
   > a Compras). Con la v2 algunos de sus casos fallarán por diseño; la reemplaza `pruebas_aprobacion_v2.sql`.
7. **Reloj programado (para probar la liberación sin la app abierta):**
   - Supabase → **Integrations → Cron** → activar.
   - Después, SQL Editor → `supabase/bootstrap/96_programar_tareas.sql` → Run.
   - ✅ Lista el trabajo `compras-liberar-programadas` activo.

## Parte 2 · Rama y vista previa (GitHub + Cloudflare)

**Protege primero las vistas previas.** En Cloudflare, cada rama se publica en una dirección
pública:

1. Cloudflare → Workers & Pages → tu proyecto → **Settings → Builds → Branch control**.
2. En **Preview branch**, elige **Custom branches** e incluye solo `mejora/*`.
3. Además, la aplicación de esta mejora **se niega a conectarse a producción** desde una vista
   previa: solo usa el archivo `config.pruebas.js`.

**Crear la rama y subir los archivos:**

1. GitHub → tu repositorio → selector de ramas (dice `main`) → escribe
   `mejora/aprobacion-jefe-calendario` → **Create branch**.
2. Con esa rama seleccionada: **Add file → Upload files**. Descomprime el paquete
   `mejora_v2_archivos.zip` y arrastra su contenido: carpetas `src`, `supabase`, `docs`,
   `public` y `pruebas-logica`, más `index.html` y `README.md`.
   - El paquete no incluye ningún archivo de acceso.
   - Commit: `Mejora v2: aprobación del jefe y calendario`.
3. **Edita en la rama** `public/config.pruebas.js` con la URL y la clave **anon** del proyecto
   de PRUEBAS. Son valores públicos; nunca pongas la clave secreta.
4. **Revisa la comparación antes de seguir:** GitHub → **Compare** →
   `main...mejora/aprobacion-jefe-calendario`.
   - Comprueba que `src/contexto/Sesion.tsx` y `public/config.js` **no aparezcan** en la lista.
   - En `src/App.tsx` debe seguir estando `RedirigirRecuperacion`.
   - Si hiciste otro cambio en `main` después del 26-oct, compárteme el ZIP nuevo antes de seguir.
5. Cloudflare compila la rama sola. ✅ La vista previa queda en
   `https://mejora-aprobacion-jefe-calendario.<tu-proyecto>.pages.dev`, con una banda amarilla
   que dice "ENTORNO DE PRUEBAS".
6. En el proyecto de PRUEBAS → **Authentication → URL Configuration → Redirect URLs**,
   agrega `https://mejora-aprobacion-jefe-calendario.<tu-proyecto>.pages.dev/restablecer`.
   Así se puede probar la recuperación.

## Parte 3 · Verificación manual en la vista previa

Marca cada punto:
- [ ] **Inicio de sesión** funciona (tus correcciones siguen ahí: mayúsculas, números, carácter especial, Turnstile si aplica).
- [ ] **Recuperación de contraseña:** genera el enlace supervisado, úsalo y define la clave; el mismo enlace usado otra vez falla.
- [ ] Configuración mínima ficticia con `docs/v2/GUIA_CONFIGURACION.md`: un área, su jefe, un solicitante y un centro de costo.
- [ ] El solicitante crea un borrador; con la cuenta de Compras **no aparece**.
- [ ] "Enviar a aprobación" muestra el mensaje con la fecha prevista; el jefe la ve en "Por aprobar".
- [ ] El jefe devuelve con motivo; el solicitante ve el motivo, corrige y reenvía.
- [ ] El jefe aprueba; con el calendario activo queda "programada"; al llegar la hora aparece en "Gestión de compras", aunque nadie tenga la app abierta.
- [ ] Adjuntos: arrastrar una foto, ver la barra de progreso y la vista previa; Compras la abre desde la gestión.
- [ ] Recepción parcial y entrega; una entrega mayor que lo disponible se rechaza.

## Parte 4 · Producción (solo con tu autorización)

Se hace un día de poco uso, fuera del horario de Compras:

1. **Respaldo** completo de producción (`docs/RESPALDO_Y_RESTAURACION.md`), base y archivos.
2. **Diagnóstico** `00_diagnostico_previo.sql` en PRODUCCIÓN. Si no dice **LISTO PARA MIGRAR**,
   te detienes y me compartes el resultado.
3. `0013_valores_nuevos.sql`, en una consulta propia.
4. `setup_mejora_v2.sql`.
5. **Configuración mínima ANTES de anunciar** (`GUIA_CONFIGURACION.md`):
   - Jefe de cada área.
   - Personas vinculadas a su área.
   - Centros de costo autorizados por área.
   - Sin esto, nadie puede enviar: la app lo muestra como "Pendientes de configuración".
6. Cron: activar e inmediatamente ejecutar `96_programar_tareas.sql`.
7. Fusionar la rama: GitHub → **Pull request** de `mejora/aprobacion-jefe-calendario` a `main`
   → revisar → **Merge**. Cloudflare publica producción sola.
8. Verificación rápida en producción: inicio de sesión, recuperación y un recorrido corto con
   una solicitud real de prueba que luego cancelas.

## Cómo revertir

- **Página web:** Cloudflare → Deployments → despliegue anterior → **Rollback**. Es inmediato.
- **Base de datos:** las migraciones solo agregan; no borran columnas ni datos. Si hubiera que
  volver atrás, la vía segura es **restaurar el respaldo del paso 1** (probado en el proyecto
  de pruebas). No se eliminan tablas a mano.
- Las solicitudes creadas con la v2 conservan sus aprobaciones y versiones; el flujo anterior
  las vería como solicitudes con estados desconocidos. Por eso la reversión recomendada es el
  respaldo, no mezclar versiones.
