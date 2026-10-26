// ============================================================
// Configuración de las VISTAS PREVIAS de rama (y del equipo local).
// Producción usa config.js; este archivo NO afecta producción.
//
// Presh Tech tiene UN solo proyecto de Supabase: la vista previa de la
// rama se conecta a la base REAL. Por eso está activado a propósito:
//   USAR_CONFIGURACION_DE_PRODUCCION: true
// → usa la misma URL y clave pública de config.js (no hay que copiarlas)
//   y la aplicación muestra una banda ROJA: lo que hagas allí es real.
//
// Si algún día existe un proyecto de PRUEBAS, pon false y escribe abajo
// su URL y su clave pública (anon). Nunca la clave service_role.
// ============================================================
window.__APP_CONFIG_PRUEBAS__ = {
  USAR_CONFIGURACION_DE_PRODUCCION: true,
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
  TURNSTILE_SITE_KEY: ""
};
