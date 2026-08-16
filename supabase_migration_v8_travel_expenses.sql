-- ============================================================
-- Navio — Migración v8: Viáticos / gastos generales de viaje
-- ============================================================
-- Corre esto DESPUÉS de supabase_migration_v7_live_gps.sql.
-- Es seguro de correr una sola vez (y de volver a correr).
--
-- Qué hace:
--   Crea "travel_expenses" para gastos que no son de la unidad en
--   sí (combustible/mantenimiento/trámites) sino del viaje del
--   conductor: hospedaje, alimentos, casetas sueltas, etc. A
--   diferencia de las otras tres tablas, "unit" aquí es opcional —
--   una factura de hotel no siempre está ligada a una unidad
--   específica. Mismo aislamiento por empresa y mismo soporte de
--   documento adjunto (Storage) que las demás.
-- ============================================================

create table if not exists public.travel_expenses (
  id bigint generated always as identity primary key,
  "companyId" bigint not null references public.companies (id),
  unit text,
  plate text,
  "driverName" text,
  concept text not null,
  amount numeric default 0,
  date date not null,
  vendor text,
  "invoiceFolio" text,
  "documentUrl" text,
  origin text default 'manual',
  status text default 'pending',
  notes text,
  "createdAt" timestamptz not null default now()
);

alter table public.travel_expenses enable row level security;

drop policy if exists "travel_expenses_all_own_company" on public.travel_expenses;
create policy "travel_expenses_all_own_company" on public.travel_expenses
  for all to authenticated
  using ("companyId" = public.current_company_id())
  with check ("companyId" = public.current_company_id());

-- ============================================================
-- Listo. Verifica en Table Editor que exista "travel_expenses".
-- ============================================================
