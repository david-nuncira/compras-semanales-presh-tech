// Lectura y validación de la configuración pública (public/config.js).

export interface ConfigApp {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  TURNSTILE_SITE_KEY: string;
}

declare global {
  interface Window { __APP_CONFIG__?: Partial<ConfigApp>; }
}

const cruda: Partial<ConfigApp> = (typeof window !== 'undefined' && window.__APP_CONFIG__) || {};

export const CONFIG: ConfigApp = {
  SUPABASE_URL: (cruda.SUPABASE_URL ?? '').trim(),
  SUPABASE_ANON_KEY: (cruda.SUPABASE_ANON_KEY ?? '').trim(),
  TURNSTILE_SITE_KEY: (cruda.TURNSTILE_SITE_KEY ?? '').trim()
};

export function configValida(): boolean {
  return /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(CONFIG.SUPABASE_URL)
    && CONFIG.SUPABASE_ANON_KEY.length > 20
    && !CONFIG.SUPABASE_ANON_KEY.includes('PEGA_AQUI');
}
