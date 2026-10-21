# Guion de demostración gerencial — 10 minutos

**Preparación previa (no cuenta en los 10 min):** aplicación desplegada; datos demo
ficticios cargados (`95_datos_demo_ficticios.sql`); cuatro cuentas FICTICIAS activadas con
roles: `demo.solicitante@…`, `demo.compras@…`, `demo.aprobador@…`, `demo.almacen@…`
(correos inventados del dominio que decidas usar en demo; se registran desde la app y tú
las activas). Dos navegadores abiertos (o uno normal + uno incógnito). Suite SQL ya
ejecutada en el proyecto de pruebas con su tabla PASA/FALLA a mano. **Al terminar la demo,
desactiva las cuentas demo** (no quedan cuentas abiertas en producción).

> Mensaje de apertura sugerido (30 s): «Esto reemplaza el Excel compartido. Cada cambio
> queda con autor, fecha y motivo; los estados no se pueden "maquillar"; los adjuntos son
> privados; y funciona con costo cero de plataforma. Es un piloto: las reglas de negocio
> marcadas como propuesta las valida Compras antes de abrirlo a toda la empresa.»

## Minuto a minuto

**0:00–1:30 · Solicitud (rol Solicitante, navegador A)**
Crear solicitud: área demo, centro demo, semana objetivo próxima (se ve "Semana del … (2026-S…)"),
2 artículos: «Casco demo» ×10 con foto adjunta, «Guantes demo» ×5. Enviar.
*Decir:* consecutivo del servidor (SOL-2026-…), borradores, adjuntos privados 5 MB×3.

**1:30–3:30 · Cotización y aprobación (rol Compras, navegador B)**
Gestión de compras → tomar «Casco demo» → registrar 2 cotizaciones (Proveedor Demo Uno
$50.000, Proveedor Demo Dos $48.000) → seleccionar una → configurar «requiere aprobación»
con el aprobador demo → solicitar aprobación → **intentar Registrar compra: el sistema lo
bloquea** (mostrar el mensaje).
*Decir:* el bloqueo es del servidor, no un botón escondido.

**3:30–4:30 · Decisión (rol Aprobador, navegador A)**
Aprobaciones → se ve EXACTAMENTE qué se aprueba (cantidad, proveedor, importe) → Aprobar.
*Decir:* decisión conservada con actor/fecha; un cambio material posterior exigiría nueva
aprobación y la anterior no se pierde (señalar historial).

**4:30–6:30 · Compra y almacén (Compras y Almacén)**
Registrar compra (10 unidades, fecha hoy, llegada estimada +5 días). Luego como Almacén:
recepción 4 → recepción 6 → entrega 3 (receptor: solicitante demo) → devolución 1 al
proveedor (defectuosa, con reposición). Mostrar el tablero de saldos: **9 netas recibidas,
6 en almacén, 3 entregadas, 1 por reponer** — y **intentar entregar 7: rechazado**.
*Decir:* parciales, sin sobreentregas ni dobles clics duplicados; "sin información" nunca
se convierte en cero.

**6:30–7:30 · Novedad y confirmación (Solicitante)**
El solicitante confirma la entrega recibida y reporta una novedad («entrega incorrecta»)
→ Compras la atiende y resuelve con evidencia. Mostrar el **Historial de cambios** del
artículo (quién, cuándo, antes → después).

**7:30–8:30 · Costos e histórico (Compras/Admin)**
Compras externas: registrar una por COP 100.000 → Reportes: aparece UNA vez, separada de
las gestionadas, por moneda; exportar CSV y abrirlo (acentos bien; la celda con `=` no
ejecuta). Administración → Importación CSV: cargar el archivo histórico real → mostrar el
informe (183 artículos, fechas rotas marcadas, "Imagen" como texto, leyenda detectada).
*Decir:* el histórico se revisa humano por humano; no inventamos fechas ni costos.

**8:30–9:30 · Seguridad en vivo (Admin)**
Administración → Usuarios: desactivar la cuenta demo solicitante → en su navegador,
refrescar: **pierde acceso al instante con la sesión abierta** (y sus descargas de
archivos también). Mostrar Auditoría (solo lectura) y la tabla **PASA/FALLA** de la suite
de aceptación ejecutada en el proyecto de pruebas.

**9:30–10:00 · Cierre**
«Cumple los tres criterios del acta: ciclo completo con fechas/proveedor/precio;
aprobaciones y novedades con registro conservado; consulta, trazabilidad y costos por
área incluyendo compras externas. Costo de plataforma: cero. Queda a decisión del área…»

## Limitaciones verificadas (decirlas sin que pregunten)

- Plan gratuito: 500 MB de base, 1 GB de adjuntos, pausa tras 1 semana sin uso
  (se reanuda en 2 minutos; el uso diario la evita). Sin copias automáticas: hay rutina
  diaria de respaldo documentada y restauración ya demostrada en un segundo proyecto.
- Sin correos automáticos: activación y recuperación son supervisadas por el
  administrador (decisión de diseño con presupuesto cero, no un olvido).
- La importación definitiva del histórico espera la validación de datos del área; hoy es
  zona de revisión + informe.
- Interfaz sobria a propósito (sin animaciones): prioridad fue seguridad + trazabilidad.

## Pendientes de decisión del negocio (para cerrar el piloto)

1. Responsables reales de aprobación y de almacén (¿quiénes tendrán cada permiso?).
2. Alcance de visibilidad (¿un líder de área ve las solicitudes de su área?). Hoy: cada
   solicitante ve solo lo suyo.
3. Catálogos oficiales de áreas, centros de costo y proveedores.
4. Definición operativa de «compra fuera del sistema» (tipo vs. registro corporativo) y
   qué reporte la usa.
5. Reglas de cierre (¿se permite cerrar con saldo en almacén?, ¿quién decide?). Hoy:
   cierre con pendientes exige resolución documentada.
6. Umbrales de aprobación (hoy es por artículo con aprobador designado, sin montos).
7. Segunda versión: correo corporativo (si existe SMTP), inicio de sesión corporativo,
   tableros avanzados, carga masiva definitiva del histórico.
