# Actualización de Compras Semanales · 3 de noviembre de 2026

## Resultado preparado

Frontend corporativo con navegación adaptable, validación junto al campo y notificaciones abajo a la izquierda; cotizaciones con vista previa de imágenes/PDF antes y después de cargar; compra directa COP hasta500000 inclusive; gerencia automática si supera500000; jefe de área antes de Compras, conservando el calendario V2.

Organigrama:27 personas del PDF y las correcciones de David. Correos esperados primer_nombre.primer_apellido@presh-tech.com, como indicó David. Vinculación solo con cuentas activas existentes; cargos y jefes configurables. El catálogo no crea ni activa personas.

## Orden para publicar

1. Aplicar en el proyecto `jvnbirxpotnxosxzgarq` las migraciones0017 a0020, junto al respaldo privado de funciones/tablas antes del cambio. Las pruebas PostgreSQL integradas ya pasaron.
2. Aplicar `fn_sincronizar_organigrama()` con el administrador para relacionar las cuentas activas.
3. Desplegar la función `despachar-correos` y configurar Microsoft365 con TI. Ver `ORGANIGRAMA_Y_AVISOS.md` y `supabase/bootstrap/97_programar_correos.sql`. No habilitar correo hasta comprobar credenciales y remitente.
4. Publicar esta rama en `main` para que Cloudflare actualice el mismo sitio.
5. Verificar acceso, bandejas y adjuntos en la URL de producción. No comprar ni aprobar solicitudes reales para probar.

## Verificación real

- TypeScript sin errores; Vite compila158 módulos.
-55 pruebas de lógica/worker/calendario pasan;1 prueba omitida por faltar CSV histórico.
-19 casos PostgreSQL PGlite pasan (base completa, permisos, umbral, importes, jefe, suplente y sincronización).
- Pruebas de navegador de cotización/adjuntos: ver informe de salida de esta sesión.
- Configuración pública de producción y Sesion.tsx conservadas respecto a main2650944.

## Estado externo

Cloudflare sirve correctamente la versión2650944 del26 de octubre. Esta actualización todavía NO está publicada. La integración de Supabase pidió confirmar DDL y las dos solicitudes vencieron sin ejecutar. No se aplicaron migraciones ni se publicará el frontend que las requiere antes de confirmarlas.

Actualmente existen6 cuentas activas. Yeffer y cinco de los seis jefes aún no tienen cuenta activa registrada; Sindi sí. No se inventó un reemplazo de gerencia. El correo de negocio está deshabilitado, Vault no tiene secretos y no hay programador cron instalado. Requiere autorización/configuración del buzón remitente Microsoft365; conocer los destinatarios no sustituye ese permiso.
