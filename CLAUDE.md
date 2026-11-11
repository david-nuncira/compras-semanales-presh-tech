# Compras Semanales — Presh Tech S.A.S. (REQ-SI-2026-05)

App interna de compras.
- Stack: React 18.3 + TypeScript 5.5 + Vite 5 + react-router-dom 6 + CSS propio. Backend en Supabase (Postgres, Auth, Storage, RPC). Publicada en Cloudflare Pages desde GitHub.
- Idioma de la interfaz, del código de dominio y de los commits: **español**.
- El usuario (David) no es programador y usa Windows. Explícale los pasos manuales en lenguaje simple.

## Tarea actual
Rediseño del FRONTEND en la rama `mejora/frontend-ux`. El plan y el avance están en `docs/frontend/PLAN.md`: léelo al empezar cada sesión y actualízalo al terminar cada fase.

## Reglas críticas
1. **Nunca hagas commit, push ni merge en `main`.** Todo lo que entra a `main` se publica solo en producción. Trabaja solo en `mejora/frontend-ux`. Al final se abre un pull request **sin fusionar**.
2. **No toques el backend.** Nada dentro de `supabase/`: migraciones, funciones ni SQL.
3. **Archivos protegidos** (correcciones de producción ya validadas):
   - `src/contexto/Sesion.tsx`
   - `src/supabase.ts`
   - `src/config.ts`
   - `public/config.js`
   - `public/config.pruebas.js`
   - En `src/App.tsx`: conserva **idénticos** `RedirigirRecuperacion` y `useEsperaPerfil`.
   - `src/paginas/Acceso.tsx`, `Restablecer.tsx`, `PendienteActivacion.tsx` y `AdminRecuperacion.tsx`: solo puede cambiar su aspecto, mediante CSS compartido; su lógica no se toca.
4. **Contrato de datos.** Solo se usan las funciones de `src/datos.ts` y los tipos de `src/tipos.ts`.
   - No inventes RPC, tablas ni columnas.
   - No simules datos: nada de cifras fijas ni datos de ejemplo, y no uses `localStorage` en lugar de la base.
   - Si algo falta en el backend, anótalo en `docs/frontend/REQUIERE_BACKEND.md` con tres datos: la pantalla, el dato que falta y por qué hace falta.
5. **Nombres de personas.** Nunca escribas nombres ni correos en el código. Las responsabilidades salen de roles y áreas configurados en la base.
6. **Permisos.** La seguridad real está en el servidor (RLS y funciones); ocultar botones es solo comodidad. No elimines validaciones ni mensajes de error del servidor.
7. **Dependencias.** No agregues dependencias nuevas sin una razón fuerte; explícala en el PR. Los gráficos se hacen con SVG o CSS.
8. **Base de datos real.** La vista previa de la rama usa la base real (se ve una banda roja). No crees datos de prueba sin cancelarlos después.

## Flujo de negocio
Borrador → Pendiente aprobación del jefe → (Devuelta ↺) → Aprobada/Programada → Recibida por Compras → Cotización → Compra → Seguimiento → Llegada → Entrega → Almacén → Cierre.

- Compras recibe las solicitudes por ciclos semanales configurables. **El servidor** calcula la fecha programada; la interfaz solo la muestra.
- Las solicitudes extraordinarias requieren un permiso especial y siguen pasando por el jefe.

## Estándares de interfaz
- **Sistema de diseño:** tokens CSS (color, espaciado de 4 px, radios, sombras, tipografía) y componentes reutilizables en `src/componentes/`. Amplía `UI.tsx`; no lo dupliques.
- **Estados de solicitud:** siempre color + ícono + texto. Una solicitud rechazada o cancelada nunca se muestra como éxito.
- **Accesibilidad (WCAG 2.1 AA):** labels, foco visible, teclado, `aria-live`, objetivos táctiles de 44 px y `prefers-reduced-motion`.
- **Responsive:** 360, 768, 1280 y 1920 px. La página no puede tener scroll horizontal; solo las tablas anchas se desplazan dentro de su contenedor.
- **Cada pantalla tiene cuatro estados:**
  - carga, con esqueleto;
  - vacío, con una acción sugerida;
  - error, con opción de reintentar;
  - sin permiso.
- **Formatos:**
  - Fechas: formato colombiano, zona `America/Bogota` (`util/fechas.ts`).
  - Dinero: COP entero, por ejemplo `$2.786.300` (`util/moneda.ts`).
- **Seguridad del navegador:** nada de `dangerouslySetInnerHTML`. Los enlaces externos llevan `rel="noopener noreferrer"`.

## Comandos
- `npm ci`
- `npm run typecheck`: debe dar 0 errores.
- `npm run test:logica`: pruebas Node en `pruebas-logica/`.
- `npm run build`

Antes de cada commit: typecheck + test:logica + build en verde.
Antes del PR: `git diff main --stat` para confirmar que no cambiaste ningún archivo protegido ni nada en `supabase/`.

## Forma de trabajo (ahorro de tokens)
- Lee solo los archivos que necesita la fase actual; no vuelvas a leer lo que ya está resumido en `PLAN.md`.
- Haz commits pequeños por fase, con mensajes descriptivos en español.
- Al cerrar una fase, actualiza `PLAN.md` con tres cosas: qué quedó hecho, qué se probó y qué queda pendiente.
- No afirmes que algo funciona si no lo ejecutaste.
