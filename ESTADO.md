# ESTADO DEL PROYECTO — Compras Semanales Presh Tech

> Bitácora persistente. Si la conversación se corta, continuar desde "Punto de continuación".
> Última actualización: 2026-10-21 (turno 2, cierre). Entrega gerencial: viernes 23/10/2026.

## IMPLEMENTADO (código completo, sin pseudocódigo ni funciones vacías)

**Base de datos (supabase/)**: migraciones 0001–0012 (≈3.840 líneas) = esquema relacional
(perfiles+roles acumulables, áreas, centros de costo, proveedores, solicitudes+artículos
con consecutivo de servidor y semana lunes-domingo, cotizaciones con selección inequívoca,
aprobaciones versionadas con snapshot, compras con importes calculados/validados en servidor,
historial de fechas estimadas, movimientos físicos con saldos bajo FOR UPDATE e idempotencia
por op_id, novedades, adjuntos + bucket privado con límites en Storage y RLS por ruta,
compras externas con referencia única, auditoría por disparadores no editable, tabla
explícita de transiciones, staging de importación CSV con mapeo de estados, endurecimiento
de GRANTs) + `setup_completo.sql` (pegar 1 vez) + bootstrap (90 admin por UUID, 95 demo
ficticia) + Edge Function `recuperacion-supervisada` (enlace un solo uso, auditado sin token,
límite 10/hora) + suite `pruebas/pruebas_aceptacion.sql` (casos 1–11, candado anti-producción,
salida PASA/FALLA, reejecutable).

**Frontend (src/)**: 33 archivos TS/TSX. Acceso con registro pendiente + Turnstile opcional,
Restablecer, Pendiente, Tablero con resumen del conjunto autorizado, Mis solicitudes
(borradores, artículos, adjuntos con compresión, enviar/corregir/reenviar/cancelar/reprogramar,
confirmación de entregas, novedades), Gestión de compras (filtros+export sobre todo el
conjunto, ficha completa del artículo: cotizaciones, aprobación, compra, fecha estimada con
historial, movimientos y saldos, anulación, cierre/reapertura, novedades, adjuntos, historial
de cambios), Aprobaciones, Almacén, Compras externas (tipo+registro corporativo+vínculo),
Reportes de costos (por área/CC/mes/proveedor, monedas separadas, sin doble conteo, export
seguro), Administración (usuarios, catálogos, auditoría, recuperación, importación CSV con
informe y zona de revisión). Bloqueo optimista por versión en todo. Mensajes en español.

**Documentación (docs/ + README + ESTADO)**: GUIA_DESPLIEGUE (desde cero, clic a clic, ruta A
GitHub+nube de Cloudflare sin instalar nada; ruta B local), PRIMER_ADMINISTRADOR,
RESPALDO_Y_RESTAURACION + scripts/respaldo.ps1 (descarga/subida de Storage), MANUAL_ROLES,
MATRIZ_ACEPTACION (15 casos con método de demostración), GUION_DEMO (10 min + limitaciones +
pendientes del negocio), CONSUMO_Y_LIMITES, .env.example sin secretos, .gitignore.

## PROBADO DE VERDAD (ejecutado en este entorno, 21/10)

- `pruebas-logica/` con Node 22: **15/15 PASA** — semanas ISO (incl. 2026-S53), atrasos
  null≠0, parseNumero es-CO, export CSV con BOM/comillas/decimal coma y neutralización de
  fórmulas (= + - @ TAB), Windows-1252 (Ñ/“”/€), parser CSV con comillas y multilínea, y el
  **CSV real del área**: 198 registros, encabezado fila 4, 183 con nombre, 8 variantes de
  estado {123/14/12/5/4/13/3/9}, 12 sin fecha, 7 fechas rotas, leyenda final completa.
- Verificador estático propio: 132 importaciones relativas y 286 nombres importados → 0 rotos;
  hooks siempre importados; llaves/paréntesis balanceados (1 falso positivo por comentario).
- Revisión manual del SQL con 3 defectos corregidos (DELETE trigger con NEW, resumen del
  tablero que evadía RLS por SECURITY DEFINER→invoker, orden de bloqueo en selección de
  cotización) + endurecimiento de EXECUTE en esquema app.

## NO PROBADO AÚN (pendiente de ejecución real — honesto)

- Migraciones SQL nunca ejecutadas contra un PostgreSQL vivo (sandbox sin red de paquetes).
  Se ejecutan el VIERNES: `setup_completo.sql` + suite en el proyecto Supabase de PRUEBAS.
- `vite build`/`tsc` nunca corridos (misma restricción): compila la nube de Cloudflare
  (ruta A). Riesgo asumido: erratas de tipos; mitigación: build sin bloqueo por tipos,
  revisión estática hecha, y corrijo en vivo leyendo el log de compilación.
- Edge Function no desplegada; Turnstile no configurado; pruebas 12–15 pendientes de URL real.

## DESPLEGADO

- **Nada.** Sin cuentas (confirmado por David), sin proyecto Supabase, sin URL. Cero datos reales.

## PENDIENTE DE VALIDACIÓN DEL NEGOCIO (propuestas configurables, no aprobadas)

Responsables de aprobación/almacén · visibilidad por área · catálogos oficiales ·
definición de "compra fuera del sistema" · reglas de cierre · umbrales de aprobación ·
semana lun-dom · límites de adjuntos (5 MB×3) · prioridades.

## Punto de continuación

→ **Siguiente acción de David**: crear las 3 cuentas gratuitas (Parte A de
docs/GUIA_DESPLIEGUE.md: Supabase, Cloudflare, GitHub con correo corporativo).
→ **Siguiente acción mía (jueves/viernes, con David presente)**: acompañar B→F de la guía
(puedo ejecutar SQL y revisar logs por el navegador integrado), correr la suite de
aceptación en el proyecto de pruebas, llenar el "Registro de ejecución" de la matriz,
compilar en Cloudflare y cerrar la verificación 14–15 + respaldo/restauración demostrados.
