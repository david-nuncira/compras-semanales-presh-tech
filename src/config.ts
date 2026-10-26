// Lectura y validación de la configuración pública.
//
// GUARDA DE ENTORNO (v2): Cloudflare Pages publica cada rama como vista
// previa en <rama>.<proyecto>.pages.dev o <hash>.<proyecto>.pages.dev.
// Por defecto, esas vistas previas (y el equipo local) NO usan la
// configuración de producción (public/config.js): usan public/config.pruebas.js.
//
// Si solo existe UN proyecto de Supabase (caso de Presh Tech), la vista
// previa puede conectarse a la base real ÚNICAMENTE si config.pruebas.js lo
// declara a propósito con USAR_CONFIGURACION_DE_PRODUCCION: true. En ese
// caso la aplicación muestra una banda roja: los cambios son reales.

export interface ConfigApp {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  TURNSTILE_SITE_KEY: string;
}

export interface ConfigPruebas extends Partial<ConfigApp> {
  USAR_CONFIGURACION_DE_PRODUCCION?: boolean;
}

declare global {
  interface Window {
    __APP_CONFIG__?: Partial<ConfigApp>;
    __APP_CONFIG_PRUEBAS__?: ConfigPruebas;
  }
}

/** true en vistas previas de rama (4+ etiquetas en *.pages.dev) y en el equipo local. */
export function esEntornoDePruebas(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]') return true;
  if (h.endsWith('.pages.dev')) return h.split('.').length >= 4;
  return false;
}

export type Entorno = 'produccion' | 'pruebas' | 'vista_previa_real';

export interface ConfigResuelta {
  entorno: Entorno;
  config: ConfigApp;
  /** La vista previa apunta a producción sin haberlo declarado a propósito. */
  bloqueada: boolean;
}

/** Decide qué configuración usar (función pura, probada en pruebas-logica/v2.test.ts). */
export function resolverConfig(hostname: string, prod?: Partial<ConfigApp>, pruebas?: ConfigPruebas): ConfigResuelta {
  const limpiar = (c?: Partial<ConfigApp>): ConfigApp => ({
    SUPABASE_URL: (c?.SUPABASE_URL ?? '').trim(),
    SUPABASE_ANON_KEY: (c?.SUPABASE_ANON_KEY ?? '').trim(),
    TURNSTILE_SITE_KEY: (c?.TURNSTILE_SITE_KEY ?? '').trim()
  });
  const cProd = limpiar(prod);
  if (!esEntornoDePruebas(hostname)) return { entorno: 'produccion', config: cProd, bloqueada: false };
  if (pruebas?.USAR_CONFIGURACION_DE_PRODUCCION === true) {
    return { entorno: 'vista_previa_real', config: cProd, bloqueada: false };
  }
  const cPru = limpiar(pruebas);
  const bloqueada = cProd.SUPABASE_URL !== '' && cPru.SUPABASE_URL === cProd.SUPABASE_URL;
  return { entorno: 'pruebas', config: cPru, bloqueada };
}

const resuelta = resolverConfig(
  typeof window !== 'undefined' ? window.location.hostname : '',
  typeof window !== 'undefined' ? window.__APP_CONFIG__ : undefined,
  typeof window !== 'undefined' ? window.__APP_CONFIG_PRUEBAS__ : undefined
);

export const ENTORNO: Entorno = resuelta.entorno;
const BLOQUEADA = resuelta.bloqueada;

// El cliente de Supabase se crea al cargar la página; si la URL está
// bloqueada o vacía, recibe un marcador inofensivo (no realiza peticiones
// porque la aplicación no se monta).
export const CONFIG: ConfigApp = {
  SUPABASE_URL: BLOQUEADA || resuelta.config.SUPABASE_URL === '' ? 'https://sin-configurar.invalid' : resuelta.config.SUPABASE_URL,
  SUPABASE_ANON_KEY: BLOQUEADA ? 'bloqueada' : (resuelta.config.SUPABASE_ANON_KEY || 'sin-configurar'),
  TURNSTILE_SITE_KEY: resuelta.config.TURNSTILE_SITE_KEY
};

export function configValida(): boolean {
  return !BLOQUEADA
    && /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(CONFIG.SUPABASE_URL)
    && CONFIG.SUPABASE_ANON_KEY.length > 20
    && !CONFIG.SUPABASE_ANON_KEY.includes('PEGA_AQUI');
}

export function motivoConfigInvalida(): string {
  if (BLOQUEADA) {
    return 'Esta vista previa tiene en config.pruebas.js la misma URL que producción. Si de verdad quieres usar la base real (un solo proyecto), deja la URL vacía y pon USAR_CONFIGURACION_DE_PRODUCCION: true.';
  }
  if (ENTORNO === 'pruebas') {
    return 'Esta es una vista previa de una rama (o el equipo local). Completa public/config.pruebas.js: o la URL y clave de un proyecto de PRUEBAS, o USAR_CONFIGURACION_DE_PRODUCCION: true si solo tienes el proyecto real.';
  }
  return 'El archivo config.js aún tiene los valores de ejemplo. Escribe la URL del proyecto de Supabase y la clave pública (anon), siguiendo docs/GUIA_DESPLIEGUE.md.';
}
