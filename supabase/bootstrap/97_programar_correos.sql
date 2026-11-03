-- Ejecutar SOLO después de desplegar despachar-correos y guardar los secretos en Vault.
-- No pegar valores secretos en este archivo. Nombres requeridos:
-- compras_supabase_url = URL HTTPS del proyecto Supabase
-- compras_graph_cron_secret = mismo CRON_SECRET guardado en Edge Functions Secrets
-- Requiere extensiones pg_cron y pg_net habilitadas. No modifica el calendario de compras.
do $$
begin
 if not exists(select 1 from pg_extension where extname='pg_cron')
 or not exists(select 1 from pg_extension where extname='pg_net') then
  raise exception 'Habilita pg_cron y pg_net antes de programar el correo.';
 end if;
 if not exists(select 1 from vault.decrypted_secrets where name='compras_supabase_url'
  and decrypted_secret ~ '^https://[a-z0-9]+\.supabase\.co$') then
  raise exception 'Falta la URL válida del proyecto en Vault: compras_supabase_url.';
 end if;
 if not exists(select 1 from vault.decrypted_secrets where name='compras_graph_cron_secret'
  and char_length(decrypted_secret)>=32) then
  raise exception 'Falta el secreto de invocación de al menos32 caracteres en Vault.';
 end if;
end $$;
-- Nombre estable: cron.schedule actualiza el trabajo existente de este propietario.
select cron.schedule('compras-despachar-correos','* * * * *',$cron$
 select net.http_post(
  url:=(select decrypted_secret from vault.decrypted_secrets where name='compras_supabase_url' limit 1)||'/functions/v1/despachar-correos',
  headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Secret',
   (select decrypted_secret from vault.decrypted_secrets where name='compras_graph_cron_secret' limit 1)),
  body:='{}'::jsonb,timeout_milliseconds:=140000
 );
$cron$);
-- Revisión sin mostrar secretos:
select jobid,jobname,schedule,active from cron.job where jobname='compras-despachar-correos';
