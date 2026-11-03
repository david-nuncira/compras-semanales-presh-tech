// Microsoft Graph sobre HTTPS. Solo scheduler: X-Cron-Secret con CRON_SECRET.
// verify_jwt=false: la autenticación de servicio se realiza aquí, nunca por clave pública.
// No recibe destinatarios ni textos del cliente. No registra secretos o contenidos privados.
interface Correo {id:number;reclamo_id:string;request_id:string;correo:string;asunto:string;cuerpo_texto:string;}
function json(data:Record<string,unknown>,status=200):Response {
 return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
}
async function mismoSecreto(a:string,b:string):Promise<boolean> {
 const e=new TextEncoder(),aa=new Uint8Array(await crypto.subtle.digest('SHA-256',e.encode(a))),bb=new Uint8Array(await crypto.subtle.digest('SHA-256',e.encode(b)));
 let diff=0;for(let i=0;i<aa.length;i++)diff|=aa[i]^bb[i];return diff===0;
}
Deno.serve(async(req:Request)=>{
 if(req.method!=='POST')return json({error:'Método no permitido.'},405);
 const secret=Deno.env.get('CRON_SECRET')??'',recibido=req.headers.get('X-Cron-Secret')??'';
 if(secret.length<32||recibido.length>256||!await mismoSecreto(recibido,secret))return json({error:'No autorizado.'},401);
 const base=Deno.env.get('SUPABASE_URL')??'',service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
 const tenant=Deno.env.get('GRAPH_TENANT_ID')??'',client=Deno.env.get('GRAPH_CLIENT_ID')??'',credential=Deno.env.get('GRAPH_CLIENT_SECRET')??'',from=Deno.env.get('CORREO_REMITENTE')??'';
 if(!base||!service||!tenant||!client||!credential||!from)return json({error:'El correo corporativo no está configurado. Los avisos siguen disponibles en la aplicación.'},503);
 if(!/^[0-9a-f-]{36}$/i.test(tenant)||!/^[0-9a-f-]{36}$/i.test(client)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from))return json({error:'La configuración del correo no es válida.'},503);
 const rpc=async(name:string,args:Record<string,unknown>):Promise<unknown>=>{
  const r=await fetch(`${base.replace(/\/$/,'')}/rest/v1/rpc/${name}`,{method:'POST',headers:{'Content-Type':'application/json',apikey:service,Authorization:`Bearer ${service}`},body:JSON.stringify(args),signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw new Error('La operación de cola no fue confirmada.');return r.status===204?null:r.json();
 };
 try {
  // Pedir token ANTES de reclamar evita bloquear una cola cuando Entra está mal configurado.
  const tr=await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:client,client_secret:credential,grant_type:'client_credentials',scope:'https://graph.microsoft.com/.default'}),signal:AbortSignal.timeout(10000)});
  if(!tr.ok)return json({error:'Microsoft 365 no autorizó al servicio. Revisa el permiso y el buzón remitente.'},503);
  const token=await tr.json() as {access_token?:unknown};if(typeof token.access_token!=='string'||!token.access_token)return json({error:'Microsoft 365 no confirmó la autorización del servicio.'},503);
  const items=await rpc('srv_correo_reclamar',{p_limite:3}) as Correo[];
  if(!Array.isArray(items))throw new Error('Cola inválida.');
  let aceptados=0,errores=0,inciertos=0,sinConfirmar=0;
  for(const item of items) {
   let resultado:'aceptado'|'error'|'incierto'='error',error:string|null=null;
   try {
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.correo)){error='Dirección de destino inválida.';}
    else {
     // Reclamo consumible una sola vez: no reintentar sendMail tras timeout/caída.
     const autorizado=await rpc('srv_correo_autorizar_envio',{p_id:item.id,p_reclamo_id:item.reclamo_id});
     if(autorizado!==true){sinConfirmar++;continue;}
     resultado='incierto';
     const gr=await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`,{
      method:'POST',headers:{Authorization:`Bearer ${token.access_token}`,'Content-Type':'application/json','client-request-id':item.request_id,'return-client-request-id':'true'},
      body:JSON.stringify({message:{subject:item.asunto,body:{contentType:'Text',content:item.cuerpo_texto},toRecipients:[{emailAddress:{address:item.correo}}],internetMessageHeaders:[{name:'X-Compras-Evento',value:String(item.id)}]},saveToSentItems:true}),signal:AbortSignal.timeout(10000)
     });
     if(gr.status===202){resultado='aceptado';}
     else if([400,401,403,404,413,422,429].includes(gr.status)){resultado='error';error=`Microsoft Graph rechazó el envío (HTTP ${gr.status}).`;}
     else {error=`Microsoft Graph no confirmó el envío (HTTP ${gr.status}). Revisar el buzón antes de reintentar.`;}
    }
   }catch{error=resultado==='incierto'?'Envío sin confirmar. Verificar Elementos enviados antes de reintentar.':'No se pudo autorizar el lote. Se reintentará si el envío no comenzó.';}
   try {
    await rpc('srv_correo_confirmar',{p_id:item.id,p_reclamo_id:item.reclamo_id,p_resultado:resultado,p_error:error});
    if(resultado==='aceptado')aceptados++;else if(resultado==='incierto')inciertos++;else errores++;
   }catch{sinConfirmar++;}
  }
  return json({procesados:items.length,aceptados,errores,inciertos,sin_confirmar:sinConfirmar});
 }catch{return json({error:'No se pudo confirmar el procesamiento. La cola conserva los avisos; los envíos inciertos requieren revisión.'},502);}
});
