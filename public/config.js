// ============================================================
// Configuración PÚBLICA de Compras Semanales Presh Tech.
// Estos tres valores NO son secretos: viajan al navegador de cada
// usuario y están protegidos por las políticas RLS del servidor.
// ⚠️ NUNCA pongas aquí la clave "service_role" / "secret key".
//
// Cómo llenarlo (guía de despliegue, paso a paso):
//  - SUPABASE_URL: Supabase → Project Settings → Data API → "Project URL".
//  - SUPABASE_ANON_KEY: Supabase → Project Settings → API Keys →
//    clave "anon public" (también llamada "publishable").
//  - TURNSTILE_SITE_KEY: Cloudflare → Turnstile → tu widget → "Site Key".
//    (Si aún no está configurado, déjalo en "" y el formulario funciona
//     sin el reto anti-robots; actívalo antes de abrir a toda la empresa.)
// ============================================================
window.__APP_CONFIG__ = {
  SUPABASE_URL: "PEGA_AQUI_LA_URL_DEL_PROYECTO",
  SUPABASE_ANON_KEY: "PEGA_AQUI_LA_CLAVE_PUBLICA_ANON",
  TURNSTILE_SITE_KEY: ""
};
