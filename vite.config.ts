import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Configuración mínima: aplicación estática adaptable, sin SSR ni extras.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2020'
  }
});
