"""Genera los scripts del 'mismo proyecto' a partir de setup_mejora_v2.sql y
de la suite pruebas_aprobacion_v2.sql (así nunca se desincronizan).
Uso, desde la raíz del repositorio:  python3 supabase/mismo_proyecto/generar.py
"""
setup = open("supabase/setup_mejora_v2.sql").read()
suite = open("supabase/pruebas/pruebas_aprobacion_v2.sql").read()
corte = suite.rindex("select caso, nombre, estado, detalle from pruebas.resultados_v2")
suite_sin_final = suite[:corte]

ensayo = f"""-- ============================================================
-- 02_ensayo_sin_cambios.sql · ENSAYO GENERAL EN LA BASE REAL
-- GENERADO por supabase/mismo_proyecto/generar.py — no editar a mano.
--
-- Ejecuta la mejora v2 COMPLETA (0014–0016) y la suite de pruebas
-- (usuarios y datos ficticios) dentro de UNA transacción y al final la
-- REVIERTE a propósito: no se guarda nada.
--
-- Requisito: haber ejecutado antes 0013_valores_nuevos.sql (solo agrega
-- valores de lista; es inofensivo para la versión actual).
--
-- RESULTADO ESPERADO: un mensaje en ROJO que empieza por
--   "ENSAYO TERMINADO Y REVERTIDO (no se guardó nada)"
-- con el conteo PASA / FALLA. Ese "error" es intencional.
-- Si aparece CUALQUIER otro error, también se revierte todo: compártelo.
-- Después ejecuta:  rollback;   y el diagnóstico (debe seguir diciendo
-- LISTO PARA MIGRAR, prueba de que nada quedó guardado).
-- ============================================================
begin;

create table if not exists public.zz_entorno_de_pruebas (ok boolean);

{setup}

-- ===================== SUITE DE PRUEBAS v2 =====================
{suite_sin_final}

-- ===================== RESULTADO Y REVERSIÓN =====================
do $fin$
declare
  v_pasa integer; v_falla integer; v_manual integer; v_det text;
begin
  select count(*) filter (where estado = 'PASA'),
         count(*) filter (where estado = 'FALLA'),
         count(*) filter (where estado = 'PENDIENTE_MANUAL')
    into v_pasa, v_falla, v_manual
  from pruebas.resultados_v2;
  select string_agg(caso || ' · ' || nombre || coalesce(' → ' || nullif(detalle, ''), ''), ' | ' order by id)
    into v_det
  from pruebas.resultados_v2 where estado = 'FALLA';
  raise exception '%', left(format(
    'ENSAYO TERMINADO Y REVERTIDO (no se guardó nada). PASA=%s · FALLA=%s · MANUAL=%s. %s',
    v_pasa, v_falla, v_manual,
    case when v_falla = 0 then 'Sin fallas: se puede aplicar la versión definitiva.'
         else 'FALLAS: ' || v_det end), 3000);
end $fin$;

commit;
"""
open("supabase/mismo_proyecto/02_ensayo_sin_cambios.sql", "w").write(ensayo)

aplicar = f"""-- ============================================================
-- 03_aplicar_definitivo.sql · APLICA la mejora v2 en la base real
-- GENERADO por supabase/mismo_proyecto/generar.py — no editar a mano.
--
-- TODO O NADA: va dentro de una transacción. Si cualquier paso falla, no
-- queda nada a medias (ejecuta luego  rollback;  y comparte el error).
-- Requisitos que el propio script verifica:
--   · 0013_valores_nuevos.sql ya ejecutado
--   · existe un respaldo interno (01_respaldo_interno.sql)
--   · la mejora no está aplicada todavía
-- RESULTADO ESPERADO: una tabla que dice "MEJORA V2 APLICADA".
-- ============================================================
begin;

do $previo$
begin
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                 where t.typname = 'estado_solicitud' and e.enumlabel = 'pendiente_aprobacion') then
    raise exception 'Falta ejecutar primero 0013_valores_nuevos.sql (en una consulta propia).';
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'solicitudes' and column_name = 'flujo') then
    raise exception 'La mejora v2 YA está aplicada en esta base. No se repite.';
  end if;
  if not exists (select 1 from pg_namespace where nspname like 'respaldo\\_v1\\_%' escape '\\') then
    raise exception 'Primero ejecuta 01_respaldo_interno.sql (respaldo de los datos).';
  end if;
  if to_regclass('public.zz_entorno_de_pruebas') is not null then
    raise exception 'Existe la tabla zz_entorno_de_pruebas: un ensayo quedó guardado por error. Ejecuta 04_limpieza_si_el_ensayo_quedo_guardado.sql y avísame.';
  end if;
end $previo$;

{setup}

do $verificar$
declare v_n integer;
begin
  select count(*) into v_n from public.solicitudes s
   where s.flujo = 'anterior'
     and exists (select 1 from public.solicitud_aprobaciones x where x.solicitud_id = s.id);
  if v_n > 0 then
    raise exception 'Verificación fallida: % solicitud(es) históricas con aprobaciones. Se revierte todo.', v_n;
  end if;
end $verificar$;

commit;

select 'MEJORA V2 APLICADA' as resultado,
       (select count(*) from public.solicitudes where flujo = 'anterior') as solicitudes_historicas_flujo_anterior,
       (select count(*) from public.solicitudes where flujo = 'aprobacion_previa') as borradores_que_usaran_el_flujo_nuevo,
       (select count(*) from public.areas where activo and jefe_id is null) as areas_sin_jefe_por_configurar,
       (select count(*) from public.areas a where a.activo and not exists
          (select 1 from public.area_centros_costo x where x.area_id = a.id and x.activo)) as areas_sin_centro_de_costo_por_configurar;
"""
open("supabase/mismo_proyecto/03_aplicar_definitivo.sql", "w").write(aplicar)
print("Generados: 02_ensayo_sin_cambios.sql (%d líneas), 03_aplicar_definitivo.sql (%d líneas)" % (ensayo.count("\n"), aplicar.count("\n")))
