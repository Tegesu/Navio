-- ============================================================
-- Navio — Migración v16: Parámetros por concepto y proyectos cerrados
-- ============================================================
-- Corre esto DESPUÉS de supabase_migration_v15_invoice_marks.sql.
-- Es seguro de correr una sola vez (y de volver a correr).
--
-- Qué hace:
--   1. Agrega "details" a las tres tablas de facturas: los datos propios
--      de cada concepto (tipo de combustible, noches de hotel, número de
--      parte, caseta...). No toca las facturas que ya existen, y sigue
--      las mismas reglas: una factura aprobada o rechazada no se edita,
--      y cada cambio queda en el historial.
--   2. Crea "project_settings": qué proyectos están cerrados. Todo
--      proyecto está activo hasta que un administrador lo cierre. Cerrar
--      un proyecto solo lo saca de la vista "Activos"; sus facturas no
--      cambian y se puede reabrir.
--      Todos en la empresa lo leen; solo un administrador lo modifica.
-- ============================================================

alter table public.fuel_records add column if not exists details jsonb;
alter table public.travel_expenses add column if not exists details jsonb;
alter table public.misc_expenses add column if not exists details jsonb;

create table if not exists public.project_settings (
  "companyId" bigint not null references public.companies (id),
  project text not null,
  closed boolean not null default false,
  primary key ("companyId", project)
);

alter table public.project_settings enable row level security;

drop policy if exists "project_settings_select_own_company" on public.project_settings;
create policy "project_settings_select_own_company" on public.project_settings
  for select to authenticated
  using ("companyId" = public.current_company_id());

drop policy if exists "project_settings_write_admin" on public.project_settings;
create policy "project_settings_write_admin" on public.project_settings
  for all to authenticated
  using ("companyId" = public.current_company_id() and public.is_company_admin())
  with check ("companyId" = public.current_company_id() and public.is_company_admin());

-- ============================================================
-- Listo. Verifica en Table Editor que exista "project_settings" y que
-- fuel_records, travel_expenses y misc_expenses tengan la columna "details".
-- ============================================================
