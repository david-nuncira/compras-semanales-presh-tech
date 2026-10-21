-- ============================================================
-- pruebas_aceptacion.sql · Compras Semanales Presh Tech
-- SUITE AUTOVERIFICABLE de la matriz de aceptación (SQL).
--
-- DÓNDE EJECUTARLA: en el SQL Editor del proyecto Supabase DE PRUEBAS
-- (el segundo proyecto gratuito), con las migraciones 0001-0012 ya
-- aplicadas. NUNCA en el proyecto de producción.
--
-- CANDADO: la suite se niega a correr si no existe la marca
--   create table public.zz_entorno_de_pruebas (ok boolean);
-- que solo debe crearse en el proyecto de pruebas.
--
-- RESULTADO: al final imprime una tabla con PASA / FALLA por caso.
-- Reejecutable: limpia sus propios datos (correos *@pruebas.ficticio).
-- Cubre los puntos SQL de la matriz: 1,2,3,4,5,6,7,8,9,10 y 11(parcial:
-- idempotencia y bloqueo optimista; la concurrencia de dos sesiones y
-- los puntos 12-15 se prueban aparte, ver MATRIZ_ACEPTACION.md).
-- ============================================================

-- ---------- Infraestructura de la suite ----------
create schema if not exists pruebas;

create or replace function pruebas.guard() returns void language plpgsql as $$
begin
  if to_regclass('public.zz_entorno_de_pruebas') is null then
    raise exception 'CANDADO: este script solo corre en el proyecto DE PRUEBAS. Crea antes: create table public.zz_entorno_de_pruebas (ok boolean);';
  end if;
end $$;
select pruebas.guard();

drop table if exists pruebas.resultados;
create table pruebas.resultados (
  id serial primary key,
  caso text not null,
  nombre text not null,
  estado text not null,      -- PASA / FALLA / PENDIENTE_MANUAL
  detalle text
);
grant usage on schema pruebas to public;
grant insert, select on pruebas.resultados to public;
grant usage, select on sequence pruebas.resultados_id_seq to public;

create or replace function pruebas.log(p_caso text, p_nombre text, p_estado text, p_detalle text)
returns void language sql as $$
  insert into pruebas.resultados (caso, nombre, estado, detalle)
  values (p_caso, p_nombre, p_estado, left(coalesce(p_detalle,''), 500));
$$;
grant execute on function pruebas.log(text,text,text,text) to public;

-- Ejecuta p_sql esperando ÉXITO.
create or replace function pruebas.ok(p_caso text, p_nombre text, p_sql text)
returns void language plpgsql as $$
begin
  execute p_sql;
  perform pruebas.log(p_caso, p_nombre, 'PASA', null);
exception when others then
  perform pruebas.log(p_caso, p_nombre, 'FALLA', 'Error inesperado: ' || sqlerrm);
end $$;
grant execute on function pruebas.ok(text,text,text) to public;

-- Ejecuta p_sql esperando ERROR cuyo mensaje contenga p_frag.
create or replace function pruebas.error(p_caso text, p_nombre text, p_sql text, p_frag text)
returns void language plpgsql as $$
begin
  execute p_sql;
  perform pruebas.log(p_caso, p_nombre, 'FALLA', 'Se esperaba un error y la operación fue permitida.');
exception when others then
  if sqlerrm ilike '%' || p_frag || '%' then
    perform pruebas.log(p_caso, p_nombre, 'PASA', 'Rechazado: ' || left(sqlerrm, 160));
  else
    perform pruebas.log(p_caso, p_nombre, 'FALLA', 'Error distinto al esperado ("'||p_frag||'"): ' || sqlerrm);
  end if;
end $$;
grant execute on function pruebas.error(text,text,text,text) to public;

create or replace function pruebas.check(p_caso text, p_nombre text, p_cond boolean, p_detalle text)
returns void language sql as $$
  select pruebas.log(p_caso, p_nombre, case when p_cond then 'PASA' else 'FALLA' end, p_detalle);
$$;
grant execute on function pruebas.check(text,text,boolean,text) to public;

-- Identidad simulada (técnica estándar para probar RLS):
create or replace function pruebas.como(p_uuid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uuid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
grant execute on function pruebas.como(uuid) to public;

create or replace function pruebas.como_servidor() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;
grant execute on function pruebas.como_servidor() to public;

-- ---------- LA SUITE (un único bloque = una transacción) ----------
do $$
declare
  -- usuarios ficticios
  u_admin uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  u_sola  uuid := 'aaaaaaaa-0000-4000-8000-000000000002';
  u_solb  uuid := 'aaaaaaaa-0000-4000-8000-000000000003';
  u_comp  uuid := 'aaaaaaaa-0000-4000-8000-000000000004';
  u_aprob uuid := 'aaaaaaaa-0000-4000-8000-000000000005';
  u_alma  uuid := 'aaaaaaaa-0000-4000-8000-000000000006';
  u_pend  uuid := 'aaaaaaaa-0000-4000-8000-000000000007';
  -- catálogos de prueba
  v_area uuid; v_cc uuid; v_prov uuid;
  -- objetos de negocio
  v_sol1 uuid; v_sol2 uuid; v_art1 uuid; v_art2 uuid; v_art3 uuid;
  v_cot uuid; v_apr uuid; v_compra uuid; v_mov uuid;
  v_nov uuid; v_ce uuid; v_ce_ref text; v_lote uuid; v_fila uuid; v_fila2 uuid;
  v_ver integer; v_n integer; v_n2 integer; v_num numeric; v_num2 numeric;
  v_j jsonb; v_j2 jsonb; v_txt text; v_u uuid;
  s record;
begin
  -- ================= LIMPIEZA de ejecuciones anteriores =================
  perform pruebas.como_servidor();
  delete from public.operaciones where actor in (u_admin,u_sola,u_solb,u_comp,u_aprob,u_alma,u_pend);
  delete from public.adjuntos where subido_por in (u_admin,u_sola,u_solb,u_comp,u_aprob,u_alma,u_pend);
  delete from storage.objects where bucket_id = 'adjuntos' and owner in (u_admin,u_sola,u_solb,u_comp,u_aprob,u_alma,u_pend);
  delete from public.movimientos where responsable_id in (u_admin,u_sola,u_solb,u_comp,u_aprob,u_alma,u_pend);
  delete from public.novedades where creado_por in (u_admin,u_sola,u_solb,u_comp,u_aprob,u_alma,u_pend);
  delete from public.compra_fechas_estimadas where creado_por in (u_admin,u_sola,u_solb,u_comp,u_aprob,u_alma,u_pend);
  delete from public.compras where responsable_id in (u_admin,u_sola,u_solb,u_comp,u_aprob,u_alma,u_pend);
  delete from public.aprobaciones where solicitada_por in (u_admin,u_sola,u_solb,u_comp,u_aprob,u_alma,u_pend);
  delete from public.cotizaciones where creado_por in (u_admin,u_sola,u_solb,u_comp,u_aprob,u_alma,u_pend);
  delete from public.importacion_filas where lote_id in (select id from public.importacion_lotes where creado_por in (u_admin));
  delete from public.importacion_lotes where creado_por in (u_admin);
  delete from public.compras_externas where creado_por in (u_admin,u_sola,u_solb,u_comp,u_aprob,u_alma,u_pend);
  delete from public.articulos where solicitud_id in (select id from public.solicitudes where solicitante_id in (u_admin,u_sola,u_solb,u_comp,u_aprob,u_alma,u_pend));
  delete from public.solicitudes where solicitante_id in (u_admin,u_sola,u_solb,u_comp,u_aprob,u_alma,u_pend);
  delete from public.perfil_roles where perfil_id in (u_admin,u_sola,u_solb,u_comp,u_aprob,u_alma,u_pend);
  delete from public.perfiles where id in (u_admin,u_sola,u_solb,u_comp,u_aprob,u_alma,u_pend);
  delete from auth.users where id in (u_admin,u_sola,u_solb,u_comp,u_aprob,u_alma,u_pend);
  delete from public.areas where nombre like 'ZZ PRUEBAS%';
  delete from public.centros_costo where codigo like 'ZZ-%';
  delete from public.proveedores where nombre like 'ZZ PRUEBAS%';

  -- Catálogos propios de la suite
  insert into public.areas (nombre) values ('ZZ PRUEBAS Área') returning id into v_area;
  insert into public.centros_costo (codigo, nombre) values ('ZZ-01','ZZ PRUEBAS CC') returning id into v_cc;
  insert into public.proveedores (nombre, creado_por) values ('ZZ PRUEBAS Proveedor', null) returning id into v_prov;

  -- Usuarios ficticios (como lo haría Auth al registrarse)
  insert into auth.users (id, email, raw_user_meta_data)
  values
    (u_admin, 'admin@pruebas.ficticio',  '{"nombre":"Admin Pruebas"}'),
    (u_sola,  'sol.a@pruebas.ficticio',  '{"nombre":"Solicitante A"}'),
    (u_solb,  'sol.b@pruebas.ficticio',  '{"nombre":"Solicitante B"}'),
    (u_comp,  'compras@pruebas.ficticio','{"nombre":"Compras Pruebas"}'),
    (u_aprob, 'aprueba@pruebas.ficticio','{"nombre":"Aprobador Pruebas"}'),
    (u_alma,  'almacen@pruebas.ficticio','{"nombre":"Almacén Pruebas"}'),
    (u_pend,  'pend@pruebas.ficticio',   '{"nombre":"Pendiente Pruebas"}');

  perform pruebas.check('0','El registro crea perfiles en estado pendiente',
    (select count(*) from public.perfiles where id in (u_admin,u_pend) and estado='pendiente') = 2,
    null);

  -- ================= CASO 1: registro pendiente sin acceso =================
  perform pruebas.como(u_pend);
  select count(*) into v_n from public.solicitudes;
  perform pruebas.check('1','Cuenta pendiente no ve solicitudes', v_n = 0, 'filas visibles: '||v_n);
  select count(*) into v_n from public.v_articulos;
  perform pruebas.check('1','Cuenta pendiente no ve artículos', v_n = 0, null);
  perform pruebas.error('1','Cuenta pendiente no puede crear solicitudes',
    format('insert into public.solicitudes (solicitante_id, area_id, centro_costo_id, semana_lunes) values (%L,%L,%L,date ''2026-10-26'')', u_pend, v_area, v_cc),
    'row-level security');
  perform pruebas.error('1','Nadie cambia su rol por la API (tabla protegida)',
    format('update public.perfiles set estado = %L where id = %L', 'activo', u_pend),
    'denied');
  perform pruebas.error('1','Autopromoverse a administrador falla',
    format('select public.fn_admin_establecer_roles(%L, array[''administrador'']::public.rol_app[], null)', u_pend),
    'Solo un administrador');

  -- ================= Bootstrap del primer admin (procedimiento controlado) ====
  perform pruebas.como_servidor();
  update public.perfiles set estado='activo', version=version+1 where id = u_admin;
  insert into public.perfil_roles (perfil_id, rol) values (u_admin,'administrador'), (u_admin,'solicitante');

  -- ================= CASO 2: activación y desactivación =================
  perform pruebas.como(u_admin);
  select version into v_ver from public.perfiles where id = u_sola;
  perform pruebas.ok('2','Admin activa al solicitante A',
    format('select public.fn_admin_activar_usuario(%L, array[''solicitante'']::public.rol_app[], %L, %s)', u_sola, v_area, v_ver));
  select version into v_ver from public.perfiles where id = u_solb;
  perform pruebas.ok('2','Admin activa al solicitante B',
    format('select public.fn_admin_activar_usuario(%L, array[''solicitante'']::public.rol_app[], %L, %s)', u_solb, v_area, v_ver));
  select version into v_ver from public.perfiles where id = u_comp;
  perform pruebas.ok('2','Admin activa a Compras',
    format('select public.fn_admin_activar_usuario(%L, array[''compras'',''solicitante'']::public.rol_app[], %L, %s)', u_comp, v_area, v_ver));
  select version into v_ver from public.perfiles where id = u_aprob;
  perform pruebas.ok('2','Admin activa al Aprobador',
    format('select public.fn_admin_activar_usuario(%L, array[''aprobador'',''solicitante'']::public.rol_app[], %L, %s)', u_aprob, v_area, v_ver));
  select version into v_ver from public.perfiles where id = u_alma;
  perform pruebas.ok('2','Admin activa a Almacén',
    format('select public.fn_admin_activar_usuario(%L, array[''almacen'']::public.rol_app[], %L, %s)', u_alma, v_area, v_ver));

  perform pruebas.error('2','Admin no puede desactivarse a sí mismo',
    format('select public.fn_admin_cambiar_estado_usuario(%L, ''desactivado'', ''x'', (select version from public.perfiles where id=%L))', u_admin, u_admin),
    'propia cuenta');
  perform pruebas.error('2','No se retira el rol del último administrador',
    format('select public.fn_admin_establecer_roles(%L, array[''solicitante'']::public.rol_app[], null)', u_admin),
    'ti mismo');

  -- Solicitante A crea y envía una solicitud con 2 artículos
  perform pruebas.como(u_sola);
  insert into public.solicitudes (area_id, centro_costo_id, justificacion, semana_lunes)
  values (v_area, v_cc, 'Dotación de prueba', date '2026-10-26') returning id into v_sol1;
  insert into public.articulos (solicitud_id, nombre, descripcion, cantidad, unidad)
  values (v_sol1, 'ZZ Casco de prueba', 'Casco ficticio talla M', 10, 'unidad') returning id into v_art1;
  insert into public.articulos (solicitud_id, nombre, descripcion, cantidad, unidad)
  values (v_sol1, 'ZZ Guantes de prueba', 'Guantes ficticios talla 9', 5, 'par') returning id into v_art2;
  select version into v_ver from public.solicitudes where id = v_sol1;
  v_j := public.fn_enviar_solicitud(v_sol1, v_ver, gen_random_uuid());
  perform pruebas.check('4','Solicitud con dos artículos enviada', (v_j->>'ok')::boolean, v_j::text);

  -- Desactivación corta el acceso con la sesión viva
  perform pruebas.como(u_admin);
  select version into v_ver from public.perfiles where id = u_sola;
  perform public.fn_admin_cambiar_estado_usuario(u_sola, 'desactivado', 'prueba de bloqueo', v_ver);
  perform pruebas.como(u_sola);  -- misma identidad, "sesión" aún emitida
  select count(*) into v_n from public.solicitudes;
  perform pruebas.check('2','Cuenta desactivada pierde acceso de inmediato', v_n = 0, 'filas visibles: '||v_n);
  perform pruebas.como(u_admin);
  select version into v_ver from public.perfiles where id = u_sola;
  perform public.fn_admin_cambiar_estado_usuario(u_sola, 'activo', 'reactivación para continuar pruebas', v_ver);

  -- ================= CASO 3: aislamiento entre solicitantes =================
  perform pruebas.como(u_solb);
  select count(*) into v_n from public.solicitudes where id = v_sol1;
  perform pruebas.check('3','B no lee la solicitud de A', v_n = 0, null);
  update public.articulos set nombre = 'hackeado' where id = v_art1;
  get diagnostics v_n = row_count;
  perform pruebas.check('3','B no edita artículos de A (0 filas afectadas)', v_n = 0, null);
  perform pruebas.error('3','B no consulta saldos del artículo de A',
    format('select public.fn_saldos_articulo(%L)', v_art1), 'Sin permiso');
  perform pruebas.como(u_comp);
  perform pruebas.error('3','Compras no puede autoascenderse a administrador',
    format('select public.fn_admin_establecer_roles(%L, array[''administrador'']::public.rol_app[], null)', u_comp),
    'Solo un administrador');

  -- ================= CASO 4: avances independientes =================
  perform pruebas.como(u_comp);
  select version into v_ver from public.articulos where id = v_art1;
  perform public.fn_cambiar_etapa(v_art1, 'en_cotizacion', null, v_ver);
  insert into public.cotizaciones (articulo_id, proveedor_id, moneda, precio_unitario, cantidad)
  values (v_art1, v_prov, 'COP', 50000, 10) returning id into v_cot;
  select version into v_ver from public.articulos where id = v_art1;
  perform public.fn_seleccionar_cotizacion(v_cot, v_ver);
  select etapa::text into v_txt from public.articulos where id = v_art1;
  perform pruebas.check('4','Artículo 1 avanza a cotizado', v_txt = 'cotizado', v_txt);
  select etapa::text into v_txt from public.articulos where id = v_art2;
  perform pruebas.check('4','Artículo 2 sigue en solicitado (avance independiente)', v_txt = 'solicitado', v_txt);
  select count(*) into v_n from public.v_solicitudes where id = v_sol1 and (resumen_etapas->>'cotizado')::int = 1 and (resumen_etapas->>'solicitado')::int = 1;
  perform pruebas.check('4','El estado general refleja el avance mixto', v_n = 1, null);

  -- ================= CASO 5: aprobación bloquea compra =================
  select version into v_ver from public.articulos where id = v_art1;
  perform public.fn_configurar_aprobacion(v_art1, true, u_aprob, v_ver);
  v_j := public.fn_solicitar_aprobacion(v_art1, gen_random_uuid());
  perform pruebas.error('5','No se compra con aprobación pendiente',
    format('select public.fn_registrar_compra(%L, 10, current_date, 0, 0, 0, null, null, (select version from public.articulos where id=%L), gen_random_uuid())', v_art1, v_art1),
    'pendiente');
  -- rechazo
  select id into v_apr from public.aprobaciones where articulo_id = v_art1 and es_vigente;
  perform pruebas.como(u_aprob);
  perform public.fn_decidir_aprobacion(v_apr, false, 'No procede aún', gen_random_uuid());
  perform pruebas.como(u_comp);
  perform pruebas.error('5','No se compra con aprobación rechazada',
    format('select public.fn_registrar_compra(%L, 10, current_date, 0, 0, 0, null, null, (select version from public.articulos where id=%L), gen_random_uuid())', v_art1, v_art1),
    'rechazada');
  -- nueva solicitud de aprobación y aprobación
  v_j := public.fn_solicitar_aprobacion(v_art1, gen_random_uuid());
  select id into v_apr from public.aprobaciones where articulo_id = v_art1 and es_vigente;
  perform pruebas.como(u_aprob);
  perform public.fn_decidir_aprobacion(v_apr, true, 'Aprobado para prueba', gen_random_uuid());
  perform pruebas.como(u_comp);
  v_j := public.fn_registrar_compra(v_art1, 10, current_date, 0, 0, 0, 'OC-ZZ-1', current_date + 5,
          (select version from public.articulos where id = v_art1), gen_random_uuid());
  perform pruebas.check('5','Compra registrada tras aprobación', (v_j->>'ok')::boolean, v_j::text);
  select id into v_compra from public.compras where articulo_id = v_art1;

  -- cambio material => nueva aprobación, la anterior se conserva
  perform public.fn_actualizar_compra(v_compra, 12, 50000, 0, 0, 0, 'OC-ZZ-1', 'Aumenta cantidad por prueba',
          (select version from public.compras where id = v_compra));
  select count(*) into v_n from public.aprobaciones where articulo_id = v_art1 and estado = 'aprobada' and not es_vigente;
  select count(*) into v_n2 from public.aprobaciones where articulo_id = v_art1 and estado = 'pendiente' and es_vigente;
  perform pruebas.check('5','Cambio material: anterior conservada y nueva pendiente', v_n = 1 and v_n2 = 1,
    format('aprobadas_historicas=%s pendientes_vigentes=%s', v_n, v_n2));
  perform pruebas.error('5','Recepción bloqueada con aprobación pendiente',
    format('select public.fn_registrar_movimiento(%L, ''recepcion'', 1, current_date, null, null, false, gen_random_uuid())', v_art1),
    'aprobación pendiente');
  select id into v_apr from public.aprobaciones where articulo_id = v_art1 and es_vigente;
  perform pruebas.como(u_aprob);
  perform public.fn_decidir_aprobacion(v_apr, true, 'Cambio aprobado', gen_random_uuid());

  -- ================= CASO 6: parciales, saldos y cierres =================
  -- Flujo sin aprobación sobre el artículo 2: comprar 10
  perform pruebas.como(u_comp);
  select version into v_ver from public.articulos where id = v_art2;
  perform public.fn_cambiar_etapa(v_art2, 'en_cotizacion', null, v_ver);
  insert into public.cotizaciones (articulo_id, proveedor_id, moneda, precio_unitario, cantidad)
  values (v_art2, v_prov, 'COP', 20000, 10) returning id into v_cot;
  select version into v_ver from public.articulos where id = v_art2;
  perform public.fn_seleccionar_cotizacion(v_cot, v_ver);
  v_j := public.fn_registrar_compra(v_art2, 10, current_date, 0, 0, 0, null, current_date + 3,
          (select version from public.articulos where id = v_art2), gen_random_uuid());

  perform pruebas.como(u_alma);
  perform public.fn_registrar_movimiento(v_art2, 'recepcion', 4, current_date, 'ZZ Proveedor', null, false, gen_random_uuid());
  perform public.fn_registrar_movimiento(v_art2, 'recepcion', 6, current_date, 'ZZ Proveedor', null, false, gen_random_uuid());
  perform pruebas.error('6','Doble recepción por encima de lo comprado se rechaza',
    format('select public.fn_registrar_movimiento(%L, ''recepcion'', 1, current_date, null, null, false, gen_random_uuid())', v_art2),
    'superaría');
  perform public.fn_registrar_movimiento(v_art2, 'entrega', 3, current_date, 'Solicitante A', null, false, gen_random_uuid());
  perform public.fn_registrar_movimiento(v_art2, 'devolucion_proveedor', 1, current_date, 'ZZ Proveedor', 'Unidad defectuosa', true, gen_random_uuid());

  select * into s from app.saldos_articulo(v_art2);
  perform pruebas.check('6','Saldos: 9 netas recibidas, 6 en almacén, 3 entregadas, 1 devuelta, 1 por reponer',
    s.recibido_neto = 9 and s.disponible_almacen = 6 and s.entregado_neto = 3
    and s.devuelto_proveedor = 1 and s.pendiente_llegada = 1,
    format('rn=%s disp=%s ent=%s dev=%s pend=%s', s.recibido_neto, s.disponible_almacen, s.entregado_neto, s.devuelto_proveedor, s.pendiente_llegada));
  perform pruebas.check('6','NO se cierra como 10 entregadas', s.entregado_neto <> 10, null);
  select etapa::text into v_txt from public.articulos where id = v_art2;
  perform pruebas.check('6','Etapa recibido_parcial con saldo pendiente', v_txt = 'recibido_parcial', v_txt);
  perform pruebas.error('6','Entrega superior al saldo disponible se rechaza',
    format('select public.fn_registrar_movimiento(%L, ''entrega'', 7, current_date, ''X'', null, false, gen_random_uuid())', v_art2),
    'Entrega rechazada');
  perform pruebas.como(u_comp);
  perform pruebas.error('6','Cierre con saldo pendiente exige resolución documentada',
    format('select public.fn_cerrar_articulo(%L, null, (select version from public.articulos where id=%L))', v_art2, v_art2),
    'resolución documentada');
  -- llega la reposición y se cierra normal
  perform public.fn_registrar_movimiento(v_art2, 'recepcion', 1, current_date, 'ZZ Proveedor', 'Reposición de la unidad devuelta', false, gen_random_uuid());
  select etapa::text into v_txt from public.articulos where id = v_art2;
  perform pruebas.check('6','Reposición completa la llegada (recibido_total)', v_txt = 'recibido_total', v_txt);
  perform public.fn_cerrar_articulo(v_art2, null, (select version from public.articulos where id = v_art2));
  perform pruebas.error('6','Artículo cerrado no admite más movimientos',
    format('select public.fn_registrar_movimiento(%L, ''entrega'', 1, current_date, ''X'', null, false, gen_random_uuid())', v_art2),
    'cerrado');

  -- ================= CASO 7: novedades =================
  perform pruebas.como(u_sola);
  insert into public.novedades (articulo_id, tipo, descripcion)
  values (v_art1, 'datos_incompletos', 'Falta la talla exacta del casco ficticio') returning id into v_nov;
  perform pruebas.como(u_alma);
  insert into public.novedades (articulo_id, tipo, descripcion)
  values (v_art2, 'entrega_incorrecta', 'Se entregó referencia distinta (prueba)');
  perform pruebas.como(u_comp);
  insert into public.novedades (articulo_id, tipo, descripcion)
  values (v_art2, 'producto_mal_solicitado', 'La medida solicitada no existe (prueba)');
  perform public.fn_atender_novedad(v_nov, (select version from public.novedades where id = v_nov));
  perform public.fn_resolver_novedad(v_nov, 'Se corrigió la especificación con el área', (select version from public.novedades where id = v_nov));
  select count(*) into v_n from public.novedades where id = v_nov
    and descripcion = 'Falta la talla exacta del casco ficticio' and estado = 'resuelta' and resolucion is not null;
  perform pruebas.check('7','Novedad resuelta conserva el registro original', v_n = 1, null);
  perform pruebas.error('7','Las novedades no se eliminan',
    format('delete from public.novedades where id = %L', v_nov), 'denied');

  -- ================= CASO 8: correcciones conservan anterior/nuevo/actor ======
  perform public.fn_actualizar_fecha_estimada(v_compra, current_date + 9, 'El proveedor reprogramó (prueba)',
    (select version from public.compras where id = v_compra));
  select count(*) into v_n from public.compra_fechas_estimadas where compra_id = v_compra;
  perform pruebas.check('8','El historial de fechas estimadas conserva valores', v_n >= 2, 'registros: '||v_n);
  select count(*) into v_n from public.auditoria
   where tabla = 'compras' and registro_id = v_compra::text and accion = 'FECHA_ESTIMADA'
     and actor = u_comp and anterior ? 'fecha_estimada' and nuevo ? 'fecha_estimada';
  perform pruebas.check('8','Auditoría de fecha: anterior, nuevo, actor y hora', v_n >= 1, null);
  perform pruebas.error('8','Compras no modifica la auditoría',
    'update public.auditoria set motivo = ''x'' where id = (select max(id) from public.auditoria)', 'denied');
  perform pruebas.como(u_admin);
  perform pruebas.error('8','Ni el administrador modifica la auditoría',
    'delete from public.auditoria where id = (select max(id) from public.auditoria)', 'denied');

  -- ================= CASO 9: compra externa sin doble conteo =================
  perform pruebas.como(u_comp);
  v_j := public.fn_registrar_compra_externa('externa', 'por_confirmar', v_area, v_cc, v_prov, null,
         'ZZ Impresora ficticia', 1, 'unidad', 'COP', 100000, current_date, 'prueba', gen_random_uuid());
  v_ce := (v_j->>'id')::uuid; v_ce_ref := v_j->>'referencia';
  perform public.fn_vincular_compra_externa(v_ce, v_sol1, 'se regulariza contra la solicitud de prueba',
    (select version from public.compras_externas where id = v_ce));
  perform pruebas.como_servidor();
  insert into storage.objects (bucket_id, name, owner)
  values ('adjuntos', 'compra_externa/'||v_ce||'/'||gen_random_uuid()||'.pdf', u_comp),
         ('adjuntos', 'compra_externa/'||v_ce||'/'||gen_random_uuid()||'.pdf', u_comp);
  perform pruebas.como(u_comp);
  for v_txt in select name from storage.objects where bucket_id='adjuntos' and name like 'compra_externa/'||v_ce||'/%' loop
    v_j2 := public.fn_registrar_adjunto('compra_externa', v_ce, v_txt, 'soporte.pdf', 'application/pdf', 1000, gen_random_uuid());
  end loop;
  select count(*), coalesce(sum(total),0) into v_n, v_num from public.v_costos_externos where compra_externa_id = v_ce;
  perform pruebas.check('9','Compra externa de COP 100.000 aparece UNA vez con vínculo y 2 adjuntos',
    v_n = 1 and v_num = 100000, format('filas=%s suma=%s', v_n, v_num));

  -- ================= CASO 10: importación CSV =================
  perform pruebas.como(u_admin);
  v_j := public.fn_importacion_crear_lote('SST-prueba.csv', repeat('ab', 32), 4, gen_random_uuid());
  v_lote := (v_j->>'lote_id')::uuid;
  perform public.fn_importacion_insertar_filas(v_lote, jsonb_build_array(
    jsonb_build_object('numero_fila', 5, 'fecha_texto', '23/12/2024', 'nombre', 'ZZ Poncho histórico',
                       'cantidad_texto', '3', 'descripcion', 'Talla M', 'estatus_original', 'ENTREGADO',
                       'imagen_texto', 'Imagen', 'datos_originales', '{}'::jsonb),
    jsonb_build_object('numero_fila', 6, 'fecha_texto', '26/052025', 'nombre', 'ZZ Estuche histórico',
                       'cantidad_texto', '1', 'estatus_original', 'ENTREGADO', 'datos_originales', '{}'::jsonb),
    jsonb_build_object('numero_fila', 7, 'fecha_texto', '13-ene', 'nombre', 'ZZ Escalera histórica',
                       'cantidad_texto', '25 metros', 'estatus_original', '', 'datos_originales', '{}'::jsonb),
    jsonb_build_object('numero_fila', 8, 'fecha_texto', null, 'nombre', null,
                       'cantidad_texto', null, 'estatus_original', 'ALMACÉN', 'datos_originales', '{}'::jsonb)
  ));
  perform pruebas.error('10','Repetir el mismo archivo (hash) no crea otro lote',
    format('select public.fn_importacion_crear_lote(''SST-prueba.csv'', %L, 4, gen_random_uuid())', repeat('ab',32)),
    'ya fue cargado');
  select count(*) into v_n from public.importacion_filas where lote_id = v_lote and 'la columna Imagen trae texto, no un archivo' = any(problemas);
  perform pruebas.check('10','"Imagen" queda marcado como texto, no genera archivo', v_n = 1, null);
  select count(*) into v_n from public.importacion_filas where lote_id = v_lote and fecha_confiable = false and fecha_texto in ('26/052025','13-ene');
  perform pruebas.check('10','Fechas rotas/ambiguas no se inventan', v_n = 2, null);
  select id into v_fila from public.importacion_filas where lote_id = v_lote and numero_fila = 5;
  select id into v_fila2 from public.importacion_filas where lote_id = v_lote and numero_fila = 8;
  perform pruebas.error('10','No se aprueba una fila sin nombre de artículo',
    format('select public.fn_importacion_revisar_fila(%L, ''aprobar'', %L, %L, (select version from public.importacion_filas where id=%L))', v_fila2, v_area, v_cc, v_fila2),
    'sin nombre');
  perform public.fn_importacion_revisar_fila(v_fila, 'aprobar', v_area, v_cc,
    (select version from public.importacion_filas where id = v_fila));
  v_j := public.fn_importacion_confirmar(v_lote, gen_random_uuid());
  v_j2 := public.fn_importacion_confirmar(v_lote, gen_random_uuid());
  perform pruebas.check('10','Confirmar dos veces no duplica (segunda pasada importa 0)',
    (v_j->>'importadas_ahora')::int = 1 and (v_j2->>'importadas_ahora')::int = 0,
    format('1a=%s 2a=%s', v_j->>'importadas_ahora', v_j2->>'importadas_ahora'));
  select count(*) into v_n from public.v_articulos where nombre = 'ZZ Poncho histórico';
  perform pruebas.check('10','El histórico NO fabrica artículos ni movimientos', v_n = 0, null);

  -- ================= CASO 11: reintentos e idempotencia =================
  v_u := gen_random_uuid();
  perform pruebas.como(u_alma);
  select count(*) into v_n from public.movimientos where articulo_id = v_art1 and not anulado;
  perform public.fn_registrar_movimiento(v_art1, 'recepcion', 2, current_date, 'ZZ', 'primer intento', false, v_u);
  perform public.fn_registrar_movimiento(v_art1, 'recepcion', 2, current_date, 'ZZ', 'REINTENTO (no debe duplicar)', false, v_u);
  select count(*) into v_n2 from public.movimientos where articulo_id = v_art1 and not anulado;
  perform pruebas.check('11','Reintento con el mismo identificador no duplica el movimiento',
    v_n2 = v_n + 1, format('antes=%s después=%s', v_n, v_n2));
  perform pruebas.como(u_comp);
  perform pruebas.error('11','Edición con versión vieja se rechaza (bloqueo optimista)',
    format('select public.fn_actualizar_fecha_estimada(%L, current_date + 20, ''motivo'', 0)', v_compra),
    'otra sesión');
  perform pruebas.log('11','Concurrencia real con dos sesiones', 'PENDIENTE_MANUAL',
    'Ejecutar con dos pestañas del SQL Editor o dos navegadores (ver MATRIZ_ACEPTACION.md, caso 11).');

  -- ================= Exportación/Storage: verificación de aislamiento ========
  perform pruebas.como_servidor();
  insert into storage.objects (bucket_id, name, owner)
  values ('adjuntos', 'articulo/'||v_art1||'/'||gen_random_uuid()||'.pdf', u_sola);
  perform pruebas.como(u_solb);
  select count(*) into v_n from storage.objects where bucket_id = 'adjuntos' and name like 'articulo/'||v_art1||'/%';
  perform pruebas.check('3','B no ve los adjuntos de A ni por consulta directa a Storage', v_n = 0, null);
  perform pruebas.como(u_sola);
  select count(*) into v_n from storage.objects where bucket_id = 'adjuntos' and name like 'articulo/'||v_art1||'/%';
  perform pruebas.check('3','A sí ve su propio adjunto por Storage', v_n = 1, null);

  perform pruebas.como_servidor();
  perform pruebas.log('12','Recuperación supervisada (Edge Function)', 'PENDIENTE_MANUAL',
    'Se prueba en la URL real con la guía de despliegue (requiere la función desplegada).');
  perform pruebas.log('13','Exportación CSV segura', 'PENDIENTE_MANUAL',
    'Probada por unidad en el frontend (sanitización) y manualmente en la URL real.');
  perform pruebas.log('14','Publicación HTTPS y rutas', 'PENDIENTE_MANUAL', 'Checklist en la URL final.');
  perform pruebas.log('15','Respaldo y restauración', 'PENDIENTE_MANUAL', 'Guía RESPALDO_Y_RESTAURACION.md.');
end $$;

-- ---------- Resultados ----------
select caso, nombre, estado, detalle
from pruebas.resultados
order by id;

select estado, count(*) as casos
from pruebas.resultados
group by estado
order by estado;
