# Compras Semanales Presh Tech

Aplicación web del piloto **REQ-SI-2026-05** (acta del 16/10/2026, Logística y Compras):
centraliza el ciclo **Solicitud → Cotización → Compra → Seguimiento → Llegada → Entrega → Almacén**,
con aprobaciones conservadas, novedades y devoluciones, adjuntos privados, históricos,
auditoría y costos por área (incluidas compras externas). Interfaz completa en español,
adaptable a computador y celular.

**Costo de operación: $0.** Supabase Free (base de datos PostgreSQL, usuarios y archivos)
y Cloudflare Pages Free (página web con HTTPS). Sin tarjeta de crédito y sin depender de
Claude u otra IA para funcionar.

> ⚠️ Estado honesto: este repositorio contiene el código completo y probado hasta donde el
> entorno de desarrollo lo permitió (ver `ESTADO.md`). **Nada está desplegado hasta seguir
> `docs/GUIA_DESPLIEGUE.md`**, y la matriz de aceptación se ejecuta de verdad en ese momento.

## Estructura

```
├── index.html, src/, public/        Aplicación web (React + TypeScript + Vite)
│   ├── public/config.js             ÚNICO archivo que se edita al desplegar (valores públicos)
│   └── src/paginas/                 Mis solicitudes, Gestión de compras, Aprobaciones,
│                                    Almacén, Compras externas, Reportes, Administración
├── supabase/
│   ├── migrations/0001…0012.sql     Esquema versionado: tablas, RLS, funciones, auditoría
│   ├── setup_completo.sql           Los 12 archivos concatenados para pegar UNA vez
│   ├── bootstrap/                   Primer administrador + datos demo ficticios
│   ├── functions/recuperacion-supervisada/   Única función de servidor (enlace de un solo uso)
│   └── pruebas/pruebas_aceptacion.sql        Suite autoverificable (solo proyecto de PRUEBAS)
├── pruebas-logica/                  Pruebas de lógica pura (Node 22, sin dependencias)
└── docs/                            Guías en español (despliegue, respaldo, manuales, demo)
```

## Requisitos (todos gratuitos)

Para **usar** la aplicación: un navegador moderno (Edge, Chrome, Firefox).

Para **desplegarla** (una sola vez, ~1 hora siguiendo la guía): cuentas gratuitas de
Supabase, Cloudflare y GitHub. **No hay que instalar ningún programa**: la ruta A de la
guía compila el proyecto en la nube de Cloudflare.

Para **desarrollar o compilar en un PC** (opcional, ruta B): Node.js LTS (gratis).

## Ejecución y compilación local (opcional — ruta B)

En Windows, con [Node.js LTS](https://nodejs.org) instalado, dentro de la carpeta del proyecto:

```powershell
npm install        # descarga dependencias y genera package-lock.json
npm run dev        # abre la app en modo desarrollo (http://localhost:5173)
npm run build      # genera la carpeta dist/ lista para publicar
npm run typecheck  # verificación de tipos TypeScript
npm run test:logica# pruebas de lógica pura (semanas, importes, CSV, sanitización)
```

> Nota de trazabilidad: las versiones de dependencias están **fijadas exactas** en
> `package.json`. El archivo de bloqueo `package-lock.json` se genera en la primera
> `npm install` (local o en la nube); si compilas localmente, consérvalo en el repositorio.

## Pruebas

- `npm run test:logica` — lógica pura, ejecutable sin internet (15 casos; incluye el
  análisis del CSV histórico real del área con sus 183 artículos y fechas rotas).
- `supabase/pruebas/pruebas_aceptacion.sql` — suite de la matriz de aceptación (casos 1–11).
  Se ejecuta en el **proyecto Supabase de PRUEBAS** (tiene candado anti-producción) y
  termina imprimiendo PASA/FALLA por caso. Ver `docs/MATRIZ_ACEPTACION.md`.
- Casos 12–15 (recuperación, exportación, publicación, respaldo): comprobación guiada
  sobre la URL real, descrita en la matriz.

## Documentación

| Documento | Contenido |
|---|---|
| `docs/GUIA_DESPLIEGUE.md` | Puesta en funcionamiento desde cero, clic a clic, en Windows |
| `docs/PRIMER_ADMINISTRADOR.md` | Primer admin por UUID, altas/bajas, permisos, recuperación |
| `docs/RESPALDO_Y_RESTAURACION.md` | Qué se respalda, herramientas gratuitas, restauración probada |
| `docs/MANUAL_ROLES.md` | Manual breve para Solicitantes, Compras, Aprobadores, Almacén y Admin |
| `docs/MATRIZ_ACEPTACION.md` | Requisito del acta → función → prueba → cómo se demuestra |
| `docs/GUION_DEMO.md` | Demostración gerencial de 10 minutos con datos ficticios |
| `docs/CONSUMO_Y_LIMITES.md` | Cuotas de los planes gratuitos y qué pasa al alcanzarlas |
| `ESTADO.md` | Bitácora persistente: qué está implementado, probado y pendiente |

## Seguridad (resumen)

Los permisos se aplican en PostgreSQL con RLS en **todas** las tablas y en Storage; ocultar
botones nunca es la autorización. Las cuentas nacen *pendientes* y las activa el
administrador tras verificar identidad por un canal corporativo; nadie elige su propio rol
y el navegador no es fuente de autorización. La desactivación corta el acceso de inmediato,
también a archivos (descarga autenticada por petición, sin enlaces firmados reutilizables).
La auditoría la escriben disparadores del servidor y ningún usuario funcional puede
modificarla. La clave privilegiada vive solo como secreto del servidor. Dinero y saldos se
calculan y validan en el servidor con bloqueos transaccionales e idempotencia de reintentos.
