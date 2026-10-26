# ESTADO DEL PROYECTO — Compras Semanales Presh Tech

> Bitácora persistente. Última actualización: 2026-10-26 (mejora v2).

## Contexto

- La aplicación **está publicada por David** en Cloudflare Pages + Supabase.
- El 26-oct David compartió el ZIP de su repositorio. Solo difería de la línea base en 3
  archivos: `Sesion.tsx` (evita el bloqueo de Supabase Auth), `App.tsx`
  (`RedirigirRecuperacion`) y `config.js` (valores públicos).
- Repositorio local con git:
  - `main` = línea base del 21-oct.
  - `produccion` = estado real de GitHub (26-oct).
  - `mejora/aprobacion-jefe-calendario` = desarrollo v2.
  - **`mejora/v2-integrada` = v2 fusionada sobre producción.** Esta es la que se entrega; el
    único conflicto fue `App.tsx`, resuelto a mano.
- Fuente de requisitos: transcripción “Feedback App” (reunión con Compras) + instrucción
  prioritaria de aprobación del jefe.

## v2 · IMPLEMENTADO (en la rama)

**Base de datos (aditiva, conserva datos):**

| Archivo | Contenido |
|---|---|
| `0013_valores_nuevos.sql` | Valores de enum; se ejecuta solo |
| `0014` | Jerarquía (jefe y ruta superior por área), área ↔ centro de costo, unidades, categorías y ventanas, calendario y festivos, columnas de fechas y flujo, versiones, aprobaciones del jefe, devoluciones, notificaciones, cola de correos, permisos granulares, RLS nueva (Compras solo ve lo liberado; borradores solo su autor), disparadores de reglas |
| `0015` | Calendario (`calcular_ciclo`), envío a aprobación, decisión del jefe, liberación programada + avisos agrupados, devoluciones, cancelación y reprogramación, administración de estructura y permisos, historial, indicadores, vistas, servicio de correo, barreras operativas |
| `0016` | Privilegios mínimos |
| Otros | `setup_mejora_v2.sql` (0014-0016); `bootstrap/96_programar_tareas.sql` (pg_cron); `diagnostico/00_diagnostico_previo.sql` + generador (huellas MD5 de 15 funciones reemplazadas + 4 sensibles al inicio de sesión) |
| Función `despachar-correos` | Microsoft Graph, cola idempotente, reintentos |

**Frontend:**
- Páginas nuevas: aprobación del jefe, consulta global, notificaciones, estructura y calendario.
- Páginas renovadas: Mis solicitudes, detalle, Gestión de compras, almacén, tablero, usuarios, catálogos.
- Componentes: adjuntos (arrastrar y soltar, progreso, vista previa), calendario de semanas,
  historial, avisos flotantes, campos con obligatorio/opcional y error junto al campo.
- Guarda de vista previa: las ramas usan `config.pruebas.js`, nunca producción.
- **Archivos de acceso sin cambios.**

**Documentación (`docs/v2`):** guía para aplicar, guía de configuración, correos con Graph, diagnóstico y decisiones, resultados de pruebas; MANUAL_ROLES y README actualizados.

## v2 · PROBADO DE VERDAD (26-oct)

- Node: **35/35 PASA**.
- TypeScript real sobre el frontend: **0 errores** (1 corregido), también sobre la versión integrada.
- Integración con producción: `Sesion.tsx` y `config.js` idénticos a GitHub; `RedirigirRecuperacion` idéntica.
- Importaciones: 0 rotas.
- Archivos de acceso: diff vacío.
- Revisión independiente del SQL: 13 hallazgos, **todos corregidos** (2 graves de lógica, 1 de permisos).

## v2 · NO PROBADO AÚN

- Las migraciones 0013-0016 y la suite `pruebas_aprobacion_v2.sql` no se han ejecutado en un
  PostgreSQL vivo: este entorno no lo permite. Se ejecutan en el proyecto de PRUEBAS (guía, Parte 1).
- Compilación con Vite y vista previa en Cloudflare.
- Inicio de sesión y recuperación con las correcciones reales de David (vista previa, Parte 3).
- Correos reales: requieren que TI configure Microsoft Graph.

## v2 · DESPLEGADO

- **Nada.** No se tocó producción ni la base productiva. Se requiere autorización explícita de David.

## PENDIENTE DE DEFINICIÓN DEL NEGOCIO

12 preguntas en `docs/v2/DIAGNOSTICO_Y_DECISIONES.md`, entre ellas:
- Ruta superior de los jefes.
- Jefes por área.
- Cuentas con permiso de emergencia.
- Permisos de las responsables de Compras.
- Calendario y política después del corte.
- Centros de costo de Producción y Mantenimiento.
- Si el centro de costo va por solicitud o por artículo.
- Visibilidad del líder de área.
- Ventanas de papelería.
- Correo.
- Si un cambio material de Compras requiere reaprobación.

## Un solo proyecto de Supabase (decisión de David, 26-oct)

No hay proyecto de pruebas. Ruta: `docs/v2/GUIA_MISMO_PROYECTO.md`.
- A: diagnóstico.
- B: respaldo interno (`01_respaldo_interno.sql`).
- C: 0013.
- D: ensayo general revertido (`02_ensayo_sin_cambios.sql`, generado = setup v2 + suite + reversión intencional).
- E: aplicación todo o nada (`03_aplicar_definitivo.sql`).
- `04_limpieza…` solo si el ensayo se guardara por error.
- La vista previa usa la base real solo por declaración explícita en `config.pruebas.js` (banda roja).

## Avance en la base real (26-oct)

- A (diagnóstico): LISTO PARA MIGRAR, 15/15 iguales.
- C (0013): aplicado.
- D (ensayo revertido sobre los datos reales): **PASA=62 · FALLA=0 · MANUAL=1**.
- Pendiente de confirmar: B (respaldo) y diagnóstico después del ensayo.

## Punto de continuación

1. ✓ Integración sobre el repositorio real (26-oct).
2. David ejecuta A–D de `GUIA_MISMO_PROYECTO.md` y comparte la captura del ensayo (PASA/FALLA);
   se corrige lo que falle.
3. Vista previa de la rama con `config.pruebas.js`; verificación manual (Parte 3).
4. Respuestas a las decisiones pendientes y configuración real.
5. Autorización explícita → producción (Parte 4).
