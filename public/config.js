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
  SUPABASE_URL: "https://jvnbirxpotnxosxzgarq.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp2bmJpcnhwb3RueG9zeHpnYXJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1ODgwNTQsImV4cCI6MjEwODE2NDA1NH0.NNDIW-SGxNJjxvqeWaGvM2vhcPP-HlCh0pb5cwb9bR0",
  TURNSTILE_SITE_KEY: "0x4AAAAAAFfJ98T7Fm8bdLg4"
};
