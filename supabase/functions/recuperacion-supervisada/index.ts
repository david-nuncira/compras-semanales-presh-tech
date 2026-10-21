// Edge Function: recuperacion-supervisada
// Única operación privilegiada del piloto. Genera un enlace de recuperación
// de UN SOLO USO con la API administrativa oficial (auth.admin.generateLink),
// exclusivamente para un ADMINISTRADOR ACTIVO de la aplicación.
//
// Seguridad:
//  - La clave privilegiada (service role / secret key) SOLO vive aquí como
//    variable de entorno del servidor; jamás en el navegador o el repositorio.
//  - Se verifica la identidad del llamador (JWT) y su rol/estado en la base
//    (información controlada en servidor, no metadatos del cliente).
//  - El enlace NO se registra; la auditoría guarda solo quién, para quién y cuándo.
//  - Límite de uso: máximo 10 enlaces por administrador por hora.
//
// Despliegue (sin instalar nada): Supabase Dashboard → Edge Functions →
// Deploy a new function → Via Editor → pegar este archivo (ver GUIA_DESPLIEGUE.md).
// Secreto adicional requerido: APP_URL = https://TU-SITIO.pages.dev

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function respuesta(cuerpo: Record<string, unknown>, estado: number): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { ...CORS, "Content-Type": "application/json" }
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }
  if (req.method !== "POST") {
    return respuesta({ error: "Método no permitido." }, 405);
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const APP_URL = (Deno.env.get("APP_URL") ?? "").replace(/\/+$/, "");
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return respuesta({ error: "La función no tiene configuradas sus variables de servidor." }, 500);
    }
    if (!APP_URL) {
      return respuesta({ error: "Falta el secreto APP_URL (la dirección pública de la aplicación)." }, 500);
    }

    // 1) Identidad del llamador a partir de su JWT (nunca de datos del cliente).
    const autorizacion = req.headers.get("Authorization") ?? "";
    const token = autorizacion.replace(/^Bearer\s+/i, "");
    if (!token) return respuesta({ error: "Sesión no válida." }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const { data: usuarioData, error: errUsuario } = await admin.auth.getUser(token);
    if (errUsuario || !usuarioData?.user) {
      return respuesta({ error: "Sesión no válida o vencida." }, 401);
    }
    const llamadorId = usuarioData.user.id;

    // 2) ¿Es un administrador ACTIVO según la base de datos?
    const { data: perfil } = await admin
      .from("perfiles").select("estado").eq("id", llamadorId).maybeSingle();
    const { data: rolAdmin } = await admin
      .from("perfil_roles").select("rol").eq("perfil_id", llamadorId).eq("rol", "administrador").maybeSingle();
    if (!perfil || perfil.estado !== "activo" || !rolAdmin) {
      return respuesta({ error: "Solo un administrador activo puede generar enlaces de recuperación." }, 403);
    }

    // 3) Límite de abuso: máximo 10 por hora por administrador.
    const haceUnaHora = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await admin
      .from("auditoria")
      .select("id", { count: "exact", head: true })
      .eq("tabla", "recuperacion_acceso")
      .eq("actor", llamadorId)
      .gte("creado_en", haceUnaHora);
    if ((count ?? 0) >= 10) {
      return respuesta({ error: "Límite alcanzado: máximo 10 enlaces por hora. Intenta más tarde." }, 429);
    }

    // 4) Cuenta objetivo.
    let correo = "";
    try {
      const cuerpo = await req.json();
      correo = String(cuerpo?.correo ?? "").trim().toLowerCase();
    } catch {
      return respuesta({ error: "Cuerpo de la petición inválido." }, 400);
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) {
      return respuesta({ error: "Correo inválido." }, 400);
    }

    const { data: objetivo } = await admin
      .from("perfiles").select("id, estado, nombre").eq("correo", correo).maybeSingle();
    if (!objetivo) {
      return respuesta({ error: "No existe una cuenta registrada con ese correo." }, 404);
    }
    if (objetivo.estado === "desactivado" || objetivo.estado === "rechazado") {
      return respuesta({ error: "La cuenta está bloqueada; reactívala antes de recuperar su acceso." }, 409);
    }

    // 5) Enlace oficial de recuperación (un solo uso; caduca según Auth).
    //    La redirección apunta a la pantalla de restablecimiento de la app
    //    y debe estar en la lista de Redirect URLs de Auth.
    const { data: enlaceData, error: errEnlace } = await admin.auth.admin.generateLink({
      type: "recovery",
      email: correo,
      options: { redirectTo: `${APP_URL}/restablecer` }
    });
    if (errEnlace || !enlaceData?.properties?.action_link) {
      return respuesta({ error: "No fue posible generar el enlace: " + (errEnlace?.message ?? "sin detalle") }, 500);
    }

    // 6) Auditoría SIN el enlace ni su token: quién, para qué cuenta y cuándo.
    await admin.from("auditoria").insert({
      tabla: "recuperacion_acceso",
      registro_id: objetivo.id,
      accion: "ENLACE_GENERADO",
      actor: llamadorId,
      motivo: null,
      anterior: null,
      nuevo: { cuenta: correo }
    });

    return respuesta({ enlace: enlaceData.properties.action_link }, 200);
  } catch (e) {
    const msj = e instanceof Error ? e.message : "Error interno.";
    // Sin datos empresariales en errores.
    return respuesta({ error: "Error del servidor: " + msj }, 500);
  }
});
