# Consumo estimado y límites de los planes gratuitos

Verificado en documentación oficial el 21/10/2026 (los límites pueden cambiar; antes de
ampliar el uso, reverificar en `supabase.com/pricing` y
`developers.cloudflare.com/pages/platform/limits/`).

## Cuotas vigentes

| Recurso | Límite Free | Estimación piloto (30 usuarios, ~200 solicitudes/año) | Margen |
|---|---|---|---|
| Base de datos Supabase | 500 MB | < 30 MB el primer año (texto + auditoría) | ~16× |
| Archivos (Storage) | 1 GB · máx. 50 MB/archivo (bucket limitado a 5 MB) | ~600 adjuntos×1,5 MB ≈ 0,9 GB/año…; con compresión ~0,4 GB | 2–4× |
| Usuarios activos/mes (Auth) | 50.000 | ~30 | enorme |
| Invocaciones Edge Functions | 500.000/mes | < 50/mes (solo recuperaciones) | enorme |
| Transferencia (egress) | 5 GB/mes | consultas livianas + descargas de adjuntos ≈ < 1 GB/mes | ≥5× |
| Proyectos activos Free | 2 | 1 producción + 1 pruebas/restauración | justo (es el diseño) |
| Cloudflare Pages | archivos estáticos sin límite de tráfico documentado; 500 compilaciones/mes | ~10 compilaciones/mes | enorme |
| Turnstile | 20 widgets, retos ilimitados | 1 widget | enorme |

## Qué pasa al acercarse o llegar a un límite

- **Base de datos llena (500 MB):** Supabase restringe el proyecto (deja de aceptar
  escrituras nuevas); **no borra datos**. Señal temprana: el panel muestra el uso en
  Project Settings → Usage. Acción: depurar adjuntos huérfanos, exportar/archivar lotes
  históricos antiguos, o evaluar plan de pago (decisión gerencial; nunca automática).
- **Storage lleno (1 GB):** las subidas nuevas fallan con mensaje claro en la app; lo
  existente sigue descargable. Acción: misma lógica (depurar/archivar/decidir).
- **Egress excedido:** navegación más lenta/limitada ese mes; se normaliza al siguiente.
- **Pausa por inactividad (~1 semana sin uso):** el proyecto se duerme; los datos quedan
  intactos y se reanuda desde el panel (Resume, 1–2 min). Reanudable por meses (ventana
  documentada de 1 año). El uso diario de Compras la evita de forma natural. **No se debe
  generar tráfico artificial para evitarla** (va contra las condiciones y no hace falta).
- **Compilaciones Pages agotadas (500/mes):** casi imposible en este uso; si pasara, la
  página publicada sigue funcionando; solo se pospone publicar cambios.

## Notas de condiciones

- Ninguno de los dos planes exige tarjeta de crédito ni activa cobros solos: para pagar
  habría que configurar facturación a propósito (no lo haremos en el piloto).
- Uso empresarial: ni Supabase Free ni Cloudflare Free documentan prohibición de uso
  comercial (tampoco un permiso expreso palabra por palabra). Riesgo anotado y aceptable
  para un piloto; si el proyecto se vuelve oficial, la decisión natural es el plan Pro de
  Supabase (respaldos automáticos incluidos), con aprobación gerencial.
- La aplicación no usa ninguna API de inteligencia artificial y no depende de suscripción
  alguna a Claude para funcionar.
