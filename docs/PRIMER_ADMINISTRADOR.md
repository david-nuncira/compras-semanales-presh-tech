# Administración de cuentas y recuperación de acceso

## Principios (aplicados por el servidor, no por botones)

- Todo registro nuevo queda **pendiente de activación**: sin acceso a solicitudes,
  reportes ni archivos. Nadie elige su propio privilegio al registrarse, y un nombre,
  área o rol enviados por el navegador no conceden nada.
- Escribir un correo `@presh-tech.com` **no demuestra** que la cuenta pertenezca a esa
  persona (no hay correos de confirmación, y aunque los hubiera, un buzón no es una
  persona). La **verificación de identidad es un paso humano del administrador** por un
  canal corporativo ya existente: llamada, chat interno o en persona. Nunca actives
  automáticamente "porque el dominio es de la empresa".
- Los permisos (administrador, solicitante, compras, aprobador, almacén) **pueden
  coexistir** en una misma persona.
- Acceso a la aplicación ≠ acceso técnico: los empleados **no** son miembros del proyecto
  de Supabase ni del repositorio; esos accesos quedan solo en el área de sistemas.

## 1 · Primer administrador (procedimiento inicial controlado)

El primer administrador NO es "el primero que se registre": se promueve un **UUID
verificado** desde el SQL Editor de Supabase (entorno de confianza), ejecutado por el
responsable técnico del proyecto.

1. El administrador funcional (David Nuncira, `david.nuncira@presh-tech.com`) se registra
   en la aplicación y su cuenta queda pendiente.
2. El responsable técnico entra a Supabase → **Authentication → Users**, verifica que el
   registro corresponde a la persona correcta (correo + confirmación por canal corporativo)
   y copia su **UID**.
3. En **SQL Editor** ejecuta `supabase/bootstrap/90_promover_primer_admin.sql`
   reemplazando `PEGAR-UUID-AQUI` por ese UID.
4. Resultado: cuenta activa con permisos *administrador + solicitante*, y rastro en la
   auditoría (`BOOTSTRAP_ADMIN`).

## 2 · Alta de usuarios (día a día)

1. La persona se registra en la URL de la aplicación (queda pendiente).
2. Verificas su identidad por un canal corporativo.
3. **Administración → Usuarios → Pendientes → Activar…**: marcas sus permisos (lo normal
   es solo *Solicitante*) y su área. Desde ese momento entra.
4. ¿Rechazo? **Rechazar** con motivo (queda auditado).

## 3 · Cambios de permisos, área y desactivación

- **Permisos…**: ajusta los roles marcando casillas (quedan auditados con el valor
  anterior y el nuevo).
- **Desactivar** (con motivo): el bloqueo es **inmediato** aunque la persona tenga una
  sesión abierta — cada consulta revalida su estado en el servidor, incluidos los
  archivos. **Reactivar** la devuelve a activo.
- Protecciones del servidor: no puedes desactivarte a ti mismo, ni quitarte el rol de
  administrador, ni dejar la aplicación **sin ningún administrador activo**.

## 4 · Recuperación de contraseña supervisada (sin correos)

1. La persona te lo pide por un canal corporativo; verificas su identidad.
2. **Administración → Recuperación de acceso**: escribes su correo y generas el enlace.
   - Lo crea el servidor con la API administrativa oficial; es de **un solo uso** y
     **caduca** (1 hora por defecto, configurable en Auth → Email OTP expiration).
   - El enlace se muestra **una sola vez** y no queda guardado; la auditoría registra
     únicamente quién lo gestionó, para qué cuenta y cuándo.
3. Se lo entregas por el canal corporativo. La persona lo abre, define su nueva
   contraseña en la pantalla "Definir nueva contraseña" y queda dentro.
4. Si el enlace venció o ya se usó, la pantalla lo dice y generas otro.
   Límite anti-abuso: 10 enlaces por administrador por hora.

Nunca pidas ni recibas contraseñas de otra persona; el sistema jamás te las muestra.

## 5 · Recuperación del PROPIO administrador

- **Hay otro administrador activo:** él genera tu enlace con el procedimiento anterior.
- **No queda ningún administrador activo** (único caso excepcional): el responsable
  técnico repite el procedimiento del punto 1 (script `90_promover_primer_admin.sql` con
  el UUID verificado) desde el SQL Editor. Ningún usuario funcional puede ascenderse a sí
  mismo: esta vía exige acceso técnico al proyecto de Supabase, que está restringido al
  área de sistemas y protegido por la contraseña de esa cuenta (y su propio "Forgot
  password" de supabase.com, que sí usa el correo corporativo del área técnica).

## 6 · Antes de activar usuarios reales

Confirma con Logística y Compras (pendientes de validación del área):
responsables reales de aprobación y de almacén, alcance de visibilidad por rol,
catálogos oficiales (áreas, centros de costo, proveedores), definición operativa de
"compra fuera del sistema" y reglas de cierre. Hasta entonces, usa solo cuentas y datos
de demostración claramente ficticios (nunca habilites cuentas demo abiertas en producción:
desactívalas tras la demo).
