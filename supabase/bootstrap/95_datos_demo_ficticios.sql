-- ============================================================
-- 95_datos_demo_ficticios.sql  (OPCIONAL, solo para la demostración)
-- Catálogos CLARAMENTE FICTICIOS para el piloto. Los catálogos oficiales
-- de Presh Tech los debe entregar y validar Compras; estos existen solo
-- para demostrar la aplicación sin inventar datos reales.
-- Se pueden desactivar luego desde Administración → Catálogos.
-- ============================================================

insert into public.areas (nombre) values
  ('ÁREA DEMO - Operaciones'),
  ('ÁREA DEMO - Seguridad y Salud en el Trabajo'),
  ('ÁREA DEMO - Administración'),
  ('ÁREA DEMO - Laboratorio')
on conflict (nombre) do nothing;

insert into public.centros_costo (codigo, nombre) values
  ('CC-DEMO-01', 'Centro de costo demo 01'),
  ('CC-DEMO-02', 'Centro de costo demo 02'),
  ('CC-DEMO-03', 'Centro de costo demo 03')
on conflict (codigo) do nothing;

insert into public.proveedores (nombre, identificacion, contacto, notas) values
  ('Proveedor Demo Uno S.A.S.', 'DEMO-900000001', 'Contacto ficticio 1', 'Proveedor ficticio para demostración'),
  ('Proveedor Demo Dos Ltda.', 'DEMO-900000002', 'Contacto ficticio 2', 'Proveedor ficticio para demostración'),
  ('Proveedor Demo Tres & Cía.', 'DEMO-900000003', 'Contacto ficticio 3', 'Proveedor ficticio para demostración')
on conflict (nombre) do nothing;
