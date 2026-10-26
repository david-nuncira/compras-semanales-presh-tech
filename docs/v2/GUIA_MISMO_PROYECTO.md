# Aplicar la mejora v2 en el MISMO proyecto de Supabase (sin proyecto de pruebas)

Este es el camino para Presh Tech: un solo proyecto. Sin proyecto de pruebas, la seguridad
viene de tres protecciones:

1. **Respaldo interno**: copia de todos los datos dentro del mismo proyecto, antes de cambiar nada.
2. **Ensayo general que se revierte solo**: ejecuta la mejora y todas las pruebas sobre tu base
   real dentro de una transacción y al final la deshace a propósito. Ves el resultado y no queda nada guardado.
3. **Aplicación "todo o nada"**: si cualquier paso falla, no queda nada a medias.

Todos los archivos están en `supabase/mismo_proyecto/` (y el diagnóstico en
`supabase/diagnostico/`). Para cada script:

1. Ábrelo con el Bloc de notas.
2. Ctrl+A y Ctrl+C.
3. En Supabase → **SQL Editor → New query**, pega con Ctrl+V.
4. Pulsa **Run**.

Si Supabase pregunta por una "operación potencialmente destructiva", confirma: los scripts
contienen `drop view` y `drop policy` porque recrean vistas y políticas, no borran datos.

**Cuándo:** en un momento de poco uso (por ejemplo, al final de la tarde). Los pasos A–D no
afectan a nadie. El paso E abre una **ventana de unos 30–45 minutos**: hasta que configures
jefes y centros de costo, nadie puede enviar solicitudes nuevas. Avisa antes a las áreas.

---

## A · Diagnóstico (solo lectura) — hoy mismo

`supabase/diagnostico/00_diagnostico_previo.sql` → Run.

- ✅ El veredicto debe decir **LISTO PARA MIGRAR**.
- ❌ Si dice **DETENERSE**, no sigas: envíame la captura.

## B · Respaldo interno

`supabase/mismo_proyecto/01_respaldo_interno.sql` → Run.

- ✅ Verás una tabla con las tablas copiadas y sus filas. Revisa que `solicitudes`, `articulos`,
  `perfiles` y `compras` tengan cantidades lógicas. El respaldo queda en un esquema
  `respaldo_v1_FECHA` que la aplicación no ve.
- Opcional (recomendado): **Table Editor** → abre `solicitudes`, `articulos`, `compras`,
  `movimientos` y `perfiles` → botón **Export → CSV**. Guarda los archivos en la carpeta
  corporativa. Es una copia fuera de Supabase.

## C · Valores nuevos (inofensivo para la versión actual)

`supabase/migrations/0013_valores_nuevos.sql`, **sola, en su propia consulta** → Run.

- ✅ "Success". Solo agrega opciones a dos listas internas; la aplicación actual no las usa ni
  cambia en nada.

## D · Ensayo general (no guarda nada)

1. `supabase/mismo_proyecto/02_ensayo_sin_cambios.sql` → Run.
   - Es largo, unos segundos.
   - ✅ **Resultado esperado: un mensaje en ROJO** que empieza con
     `ENSAYO TERMINADO Y REVERTIDO (no se guardó nada). PASA=… · FALLA=0 · MANUAL=1`.
     El rojo es intencional: así se deshace todo.
   - 📸 Toma captura del mensaje y envíamela.
   - ❌ Si dice `FALLA=` mayor que 0, o aparece **otro** error, igual no se guardó nada: envíame
     la captura y lo corrijo antes de seguir.
2. Nueva consulta: `rollback;` → Run. Si dice "no hay transacción en curso", está bien.
3. Vuelve a ejecutar el **diagnóstico (A)**: debe seguir diciendo **LISTO PARA MIGRAR**. Esa es
   la prueba de que el ensayo no dejó nada.
   - Si dijera **YA APLICADA**, el ensayo se guardó en lugar de revertirse. Ejecuta
     `04_limpieza_si_el_ensayo_quedo_guardado.sql` y avísame; la mejora quedaría aplicada,
     igual que en el paso E.

> Nota: el ensayo puede "gastar" algunos números consecutivos de solicitud (por ejemplo,
> pasar de SOL-2026-00012 a SOL-2026-00015). Es normal y no afecta los datos.

## E · Aplicar de verdad (con mi visto bueno sobre la captura del paso D)

1. `supabase/mismo_proyecto/03_aplicar_definitivo.sql` → Run.
   - ✅ Tabla que dice **MEJORA V2 APLICADA**, con el número de solicitudes históricas y cuántas
     áreas faltan por configurar.
   - El script verifica solo que hiciste C y B. Si falla, **no queda nada aplicado**: ejecuta
     `rollback;` y envíame el error.
2. **Subir la nueva versión de la página** a una rama: `docs/v2/GUIA_APLICAR_MEJORA_V2.md`, Parte 2.
   - Para acortar la ventana puedes subir la rama ANTES del paso E1. La vista previa mostrará errores hasta que apliques la mejora; producción no se ve afectada.
   - `config.pruebas.js` ya viene preparado para usar tu base real. La vista previa muestra una
     **banda roja**: lo que hagas allí es real.
3. **Configura desde la vista previa** (`docs/v2/GUIA_CONFIGURACION.md`), en este orden:
   - Estructura → jefe de cada área.
   - Personas de cada área.
   - Centros de costo autorizados.
   - Mientras tanto, la página actual sigue funcionando para consultar y para Compras. Lo que
     no se puede es crear o enviar solicitudes en áreas aún sin configurar; la app lo indica con un mensaje.
4. Verifica en la vista previa:
   - Iniciar sesión.
   - Crear un borrador, enviarlo, aprobarlo con la cuenta del jefe y verlo en Gestión de compras.
5. **Publicar:** GitHub → Pull request de la rama a `main` → Merge. Cloudflare actualiza producción en 1–3 minutos.
6. **Reloj programado:**
   - Supabase → Integrations → **Cron** → activar.
   - Luego `supabase/bootstrap/96_programar_tareas.sql` → Run.
7. **Recuperación de contraseña:** prueba una en producción (enlace supervisado → definir clave).

## Si algo sale mal

- **Página web:** Cloudflare → Deployments → despliegue anterior → **Rollback**. Es inmediato.
  La base v2 sigue funcionando con la página anterior en lo básico (consultar, gestionar), pero
  el envío de solicitudes ya pasa por el jefe.
- **Datos:** están en el esquema `respaldo_v1_FECHA` (y en tus CSV). La restauración la hacemos
  juntos con un script específico según lo que haya pasado. No borres el esquema de respaldo
  hasta que la v2 lleve al menos dos semanas estable.
- **El paso E nunca deja nada a medias:** o se aplica completo o no se aplica.
