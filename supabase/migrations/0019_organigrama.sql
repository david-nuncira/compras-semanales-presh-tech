-- Catálogo basado en organigrama PDF + correcciones expresas del usuario 2026-10-29.
-- No vincula Auth ni concede roles automáticamente.
begin;
create table if not exists public.organigrama_personas(
 id text primary key check(id ~ '^[a-z0-9-]+$'),
 nombre text not null check(char_length(nombre) between 1 and 160),
 cargo text not null check(char_length(cargo) between 1 and 160),
 area_nombre text not null check(char_length(area_nombre) between 1 and 160),
 jefe_nombre text,
 activo boolean not null default true,
 verificacion text not null,
 creado_en timestamptz not null default now()
);
alter table public.organigrama_personas enable row level security;
revoke all on public.organigrama_personas from public,anon,authenticated;
grant select on public.organigrama_personas to authenticated;
drop policy if exists organigrama_lectura on public.organigrama_personas;
create policy organigrama_lectura on public.organigrama_personas for select to authenticated
 using(app.es_activo() and (activo or app.es_admin()));
-- No INSERT/UPDATE/DELETE de navegador; catálogo de referencia con control de cambios.
insert into public.organigrama_personas(id,nombre,cargo,area_nombre,jefe_nombre,activo,verificacion) values
('yeffer-gaona','Yeffer Gaona','Gerente General','Gerencia General',null,true,'Organigrama PDF; pendiente vincular cuenta corporativa'),
('javier-diaz','Javier Díaz','Director Comercial','Comercial','Yeffer Gaona',true,'Organigrama PDF; pendiente vincular cuenta corporativa'),
('sara-millan','Sara Millán','Analista de Diseño','Comercial','Javier Díaz',true,'Organigrama PDF; pendiente vincular cuenta corporativa'),
('daniela-riano','Daniela Riaño','Key Account Manager','Comercial','Javier Díaz',true,'Corrección expresa de David Nuncira; antes Ejecutiva de Ventas'),
('diana-centeno','Diana Centeno','Ejecutiva de Ventas','Comercial','Javier Díaz',true,'Organigrama PDF; pendiente vincular cuenta corporativa'),
('laura-gutierrez','Laura Gutiérrez','Auxiliar de Ventas','Comercial','Javier Díaz',true,'Organigrama PDF; pendiente vincular cuenta corporativa'),
('elvis-luque','Elvis Luque','Jefe de Logística','Logística','Yeffer Gaona',true,'Corrección expresa de David Nuncira; sustituye la asignación antigua de Stella Pérez'),
('elizabeth-daza','Elizabeth Daza','Analista de Logística y Compras','Logística','Elvis Luque',true,'Organigrama PDF; pendiente vincular cuenta corporativa'),
('edwar-lobo','Edwar Lobo','Auxiliar de Almacén','Logística','Elvis Luque',true,'Organigrama PDF; pendiente vincular cuenta corporativa'),
('natalia-diaz','Natalia Díaz','Auxiliar de Compras','Logística','Elvis Luque',true,'Organigrama PDF; pendiente vincular cuenta corporativa'),
('jeimy-orjuela','Jeimy Orjuela','Auxiliar Logístico','Logística','Elvis Luque',true,'Organigrama PDF; pendiente vincular cuenta corporativa'),
('ivonne-suta','Ivonne Suta','Jefe de Ensamble y Manufactura','Ensamble y Manufactura','Yeffer Gaona',true,'Asignación expresa de David Nuncira; PDF sin confirmar'),
('edwin-baron','Edwin Barón','Analista de Procesos','Ensamble y Manufactura','Ivonne Suta',true,'Equivalencia parcial indicada en PDF; requiere validación de Gestión Humana'),
('jhon-garzon','Jhon Garzón','Auxiliar Técnico de Mantenimiento','Ensamble y Manufactura','Ivonne Suta',true,'Organigrama PDF; pendiente vincular cuenta corporativa'),
('andrea-penaloza','Andrea Peñaloza','Supervisora de Ensamble y Manufactura','Ensamble y Manufactura','Ivonne Suta',true,'Equivalencia parcial del cargo/subproceso indicada en PDF; requiere validación de Gestión Humana'),
('luisa-sanchez','Luisa Sánchez','Supervisora de Ensamble y Manufactura','Ensamble y Manufactura','Ivonne Suta',true,'Equivalencia parcial del cargo/subproceso indicada en PDF; requiere validación de Gestión Humana'),
('sindi-sanchez','Sindi Sánchez','Jefe Administrativa y de Gestión Humana','Administrativa y Gestión Humana','Yeffer Gaona',true,'Organigrama PDF; pendiente vincular cuenta corporativa'),
('oscar-zamora','Oscar Zamora','Analista SIG','Administrativa y Gestión Humana','Sindi Sánchez',true,'Organigrama PDF; pendiente vincular cuenta corporativa'),
('alvaro-bernal','Álvaro Bernal','Analista SST','Administrativa y Gestión Humana','Sindi Sánchez',true,'Asignación expresa de David Nuncira; PDF sin confirmar'),
('david-nuncira','David Nuncira','Analista de Sistemas de Información','Administrativa y Gestión Humana','Sindi Sánchez',true,'Asignación expresa de David Nuncira; PDF sin confirmar'),
('stella-perez','Stella Pérez','Auxiliar de Gestión Humana','Administrativa y Gestión Humana','Sindi Sánchez',true,'Corrección expresa de David Nuncira; deja Jefatura Logística'),
('diana-ramirez','Diana Ramírez','Auxiliar SST','Administrativa y Gestión Humana','Sindi Sánchez',true,'Adición expresa de David Nuncira; solicita aprobación a Sindi'),
('nicolas-diaz','Nicolás Díaz','Jefe de Proceso Fisicoquímico','Proceso Fisicoquímico','Yeffer Gaona',true,'Organigrama PDF; pendiente vincular cuenta corporativa'),
('juan-dacundo','Juan Dacundo','Analista de Proceso Fisicoquímico','Proceso Fisicoquímico','Nicolás Díaz',true,'Asignación expresa de David Nuncira; PDF sin confirmar'),
('luisa-gongora','Luisa Góngora','Auxiliar Técnica de Proceso Fisicoquímico','Proceso Fisicoquímico','Nicolás Díaz',true,'Equivalencia parcial indicada en PDF; requiere validación de Gestión Humana'),
('maykol-gomez','Maykol Gómez','Supervisor de Máquinas','Proceso Fisicoquímico','Nicolás Díaz',true,'Corrección expresa de David Nuncira; deja el cargo eliminado de Analista de Investigación'),
('andrea-leon','Andrea León','Jefe de Investigación','Investigación','Yeffer Gaona',true,'Organigrama PDF; pendiente vincular cuenta corporativa')
on conflict(id) do nothing;
commit;
