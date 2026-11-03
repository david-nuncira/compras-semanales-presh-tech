import test from 'node:test';
import assert from 'node:assert/strict';
// Todo ficticio: Deno.env y fetch se sustituyen antes de importar el worker.
let handler:(req:Request)=>Promise<Response>;
const entorno:Record<string,string>={CRON_SECRET:'fixture-secret-'.repeat(4),SUPABASE_URL:'https://fixture.supabase.test',
 SUPABASE_SERVICE_ROLE_KEY:'fixture-service',GRAPH_TENANT_ID:'11111111-1111-4111-8111-111111111111',
 GRAPH_CLIENT_ID:'22222222-2222-4222-8222-222222222222',GRAPH_CLIENT_SECRET:'fixture-credential',CORREO_REMITENTE:'compras@example.test'};
Object.assign(globalThis,{Deno:{serve(fn:typeof handler){handler=fn;},env:{get(key:string){return entorno[key];}}}});
await import('../supabase/functions/despachar-correos/index.ts');
const solicitud=()=>new Request('https://edge.example.test/despachar-correos',{method:'POST',headers:{'X-Cron-Secret':entorno.CRON_SECRET}});
const originalFetch=globalThis.fetch;
test('worker Graph: autentica, confirma e impide reintentar envíos ambiguos',async(t)=>{
 type Llamada={url:string;opciones:RequestInit};let llamadas:Llamada[]=[];
 const item={id:71,reclamo_id:'33333333-3333-4333-8333-333333333333',request_id:'44444444-4444-4444-8444-444444444444',
 correo:'receiver@example.test',asunto:'Solicitud <script>x</script>',cuerpo_texto:'Texto <b>plano</b> de prueba'};
 globalThis.fetch=async(url,opciones)=>{llamadas.push({url:String(url),opciones:opciones??{}});throw new Error('Conexión imprevista bloqueada');};
 try {
 await t.test('sin secreto no reclama ni envía correos',async()=>{
  assert.equal((await handler(new Request('https://edge.example.test',{method:'POST'}))).status,401);assert.equal(llamadas.length,0);
 });
 await t.test('solo admite POST',async()=>{assert.equal((await handler(new Request('https://edge.example.test'))).status,405);});
 await t.test('sin proveedor configurado conserva cola sin reclamar',async()=>{
  const credential=entorno.GRAPH_CLIENT_SECRET;delete entorno.GRAPH_CLIENT_SECRET;
  try{assert.equal((await handler(solicitud())).status,503);assert.equal(llamadas.length,0);}finally{entorno.GRAPH_CLIENT_SECRET=credential;}
 });
 const simular=(graph:number|'timeout'=202,autorizar=true)=>{llamadas=[];globalThis.fetch=async(url,opciones)=>{
  llamadas.push({url:String(url),opciones:opciones??{}});
  if(String(url).startsWith('https://login.microsoftonline.com/'))return Response.json({access_token:'fixture-access'});
  if(String(url).endsWith('/srv_correo_reclamar'))return Response.json([item]);
  if(String(url).endsWith('/srv_correo_autorizar_envio'))return Response.json(autorizar);
  if(String(url).startsWith('https://graph.microsoft.com/')){if(graph==='timeout')throw new Error('timeout');return new Response(graph===202?null:'contenido privado secreto',{status:graph});}
  if(String(url).endsWith('/srv_correo_confirmar'))return new Response('null');
  throw new Error('Conexión imprevista bloqueada');
 };};
 await t.test('202 se registra como aceptación, sin interpretar HTML',async()=>{
  simular();const r=await(await handler(solicitud())).json();assert.equal(r.aceptados,1);assert.equal(llamadas.length,5);
  const mail=JSON.parse(String(llamadas[3].opciones.body));assert.equal(mail.message.body.contentType,'Text');assert.equal(mail.message.body.content,item.cuerpo_texto);
  assert.equal((llamadas[3].opciones.headers as Record<string,string>)['client-request-id'],item.request_id);
  assert.equal(JSON.parse(String(llamadas[4].opciones.body)).p_resultado,'aceptado');
 });
 await t.test('un reclamo consumido no vuelve a enviar',async()=>{
  simular(202,false);const r=await(await handler(solicitud())).json();assert.equal(r.sin_confirmar,1);
  assert.equal(llamadas.length,3);assert.ok(!llamadas.some(x=>x.url.startsWith('https://graph.microsoft.com/')));
 });
 await t.test('429 puede reintentarse y no filtra respuestas privadas',async()=>{
  simular(429);const r=await(await handler(solicitud())).json();assert.equal(r.errores,1);
  const final=JSON.parse(String(llamadas[4].opciones.body));assert.equal(final.p_resultado,'error');assert.ok(final.p_error.includes('429'));assert.ok(!final.p_error.includes('secreto'));
 });
 await t.test('timeout después de comenzar no se marca para reenvío',async()=>{
  simular('timeout');const r=await(await handler(solicitud())).json();assert.equal(r.inciertos,1);
  assert.equal(JSON.parse(String(llamadas[4].opciones.body)).p_resultado,'incierto');
 });
 await t.test('5xx también exige conciliación para evitar duplicados',async()=>{
  simular(503);const r=await(await handler(solicitud())).json();assert.equal(r.inciertos,1);
  assert.equal(JSON.parse(String(llamadas[4].opciones.body)).p_resultado,'incierto');
 });
 }finally{globalThis.fetch=originalFetch;delete(globalThis as Record<string,unknown>).Deno;}
});
