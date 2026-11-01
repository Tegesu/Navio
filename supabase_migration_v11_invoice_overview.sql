-- ============================================================
-- Navio — Migración v11: Resumen de Facturas y Gastos
-- ============================================================
-- Corre esto DESPUÉS de supabase_migration_v10_misc_expenses.sql
-- y ANTES de publicar la versión nueva de la app o del bot.
-- Es seguro de correr una sola vez (y de volver a correr).
--
-- Qué hace:
--   1. A las tres tablas de Facturas y Gastos (fuel_records,
--      travel_expenses, misc_expenses) les agrega:
--        - "expenseType": el Concepto (viáticos, hotel, alimentos,
--          transporte, gasolina, casetas, consumibles, ...).
--        - project / "workOrder": Proyecto y Orden de trabajo.
--        - "createdBy" / "uploadedByName": quién subió la factura.
--        - approved / "approvedBy" / "approvedByName" / "approvedAt":
--          aprobación de la factura por un administrador.
--   2. Crea "work_orders": guarda datos propios de cada orden
--      (por ahora su fecha límite). Se llena sola al guardar una
--      factura con orden de trabajo — no hay que crearlas antes.
--   3. Crea "concept_deadlines": plazo en días, por concepto, para
--      tener una factura completa y verificada (alerta de
--      "próximas a expirar").
--   4. Crea "user_reminders": recordatorios personales del tablero.
--   5. Blinda la aprobación: solo un admin de la empresa puede
--      aprobar (mismo patrón que "companyRole").
-- ============================================================

-- ------------------------------------------------------------
-- 1. Columnas nuevas en las tres tablas de facturas
-- ------------------------------------------------------------
alter table public.fuel_records
  add column if not exists "expenseType" text,
  add column if not exists project text,
  add column if not exists "workOrder" text,
  add column if not exists "createdBy" uuid default auth.uid() references auth.users (id) on delete set null,
  add column if not exists "uploadedByName" text,
  add column if not exists approved boolean not null default false,
  add column if not exists "approvedBy" uuid references auth.users (id) on delete set null,
  add column if not exists "approvedByName" text,
  add column if not exists "approvedAt" timestamptz;

alter table public.travel_expenses
  add column if not exists "expenseType" text,
  add column if not exists project text,
  add column if not exists "workOrder" text,
  add column if not exists "createdBy" uuid default auth.uid() references auth.users (id) on delete set null,
  add column if not exists "uploadedByName" text,
  add column if not exists approved boolean not null default false,
  add column if not exists "approvedBy" uuid references auth.users (id) on delete set null,
  add column if not exists "approvedByName" text,
  add column if not exists "approvedAt" timestamptz;

alter table public.misc_expenses
  add column if not exists "expenseType" text,
  add column if not exists project text,
  add column if not exists "workOrder" text,
  add column if not exists "createdBy" uuid default auth.uid() references auth.users (id) on delete set null,
  add column if not exists "uploadedByName" text,
  add column if not exists approved boolean not null default false,
  add column if not exists "approvedBy" uuid references auth.users (id) on delete set null,
  add column if not exists "approvedByName" text,
  add column if not exists "approvedAt" timestamptz;

-- ------------------------------------------------------------
-- 2. Blindaje de la aprobación: solo admins de la empresa
--    (o super-admin) pueden aprobar. Si alguien más intenta
--    cambiarlo, el valor anterior se conserva.
-- ------------------------------------------------------------
create or replace function public.protect_invoice_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_company_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.approved := false;
    new."approvedBy" := null;
    new."approvedByName" := null;
    new."approvedAt" := null;
  else
    new.approved := old.approved;
    new."approvedBy" := old."approvedBy";
    new."approvedByName" := old."approvedByName";
    new."approvedAt" := old."approvedAt";
  end if;
  return new;
end;
$$;

drop trigger if exists protect_invoice_approval on public.fuel_records;
create trigger protect_invoice_approval
  before insert or update on public.fuel_records
  for each row execute function public.protect_invoice_approval();

drop trigger if exists protect_invoice_approval on public.travel_expenses;
create trigger protect_invoice_approval
  before insert or update on public.travel_expenses
  for each row execute function public.protect_invoice_approval();

drop trigger if exists protect_invoice_approval on public.misc_expenses;
create trigger protect_invoice_approval
  before insert or update on public.misc_expenses
  for each row execute function public.protect_invoice_approval();

-- ------------------------------------------------------------
-- 3. work_orders — datos propios de cada orden de trabajo
-- ------------------------------------------------------------
create table if not exists public.work_orders (
  id bigint generated always as identity primary key,
  "companyId" bigint not null references public.companies (id),
  project text not null default '',
  code text not null,
  "dueDate" date,
  "createdBy" uuid default auth.uid() references auth.users (id) on delete set null,
  "createdAt" timestamptz not null default now(),
  unique ("companyId", project, code)
);

alter table public.work_orders enable row level security;

drop policy if exists "work_orders_all_own_company" on public.work_orders;
create policy "work_orders_all_own_company" on public.work_orders
  for all to authenticated
  using ("companyId" = public.current_company_id())
  with check ("companyId" = public.current_company_id());

-- ------------------------------------------------------------
-- 4. concept_deadlines — plazo (en días) por concepto
--    Todos en la empresa lo leen; solo un admin lo modifica.
-- ------------------------------------------------------------
create table if not exists public.concept_deadlines (
  "companyId" bigint not null references public.companies (id),
  "expenseType" text not null,
  days integer not null check (days >= 0 and days <= 365),
  primary key ("companyId", "expenseType")
);

alter table public.concept_deadlines enable row level security;

drop policy if exists "concept_deadlines_select_own_company" on public.concept_deadlines;
create policy "concept_deadlines_select_own_company" on public.concept_deadlines
  for select to authenticated
  using ("companyId" = public.current_company_id());

drop policy if exists "concept_deadlines_write_admin" on public.concept_deadlines;
create policy "concept_deadlines_write_admin" on public.concept_deadlines
  for all to authenticated
  using ("companyId" = public.current_company_id() and public.is_company_admin())
  with check ("companyId" = public.current_company_id() and public.is_company_admin());

-- ------------------------------------------------------------
-- 5. user_reminders — recordatorios personales del tablero
-- ------------------------------------------------------------
create table if not exists public.user_reminders (
  id bigint generated always as identity primary key,
  "userId" uuid not null default auth.uid() references auth.users (id) on delete cascade,
  text text not null,
  done boolean not null default false,
  "createdAt" timestamptz not null default now()
);

alter table public.user_reminders enable row level security;

drop policy if exists "user_reminders_own" on public.user_reminders;
create policy "user_reminders_own" on public.user_reminders
  for all to authenticated
  using ("userId" = auth.uid())
  with check ("userId" = auth.uid());

-- ============================================================
-- Listo. Verifica en Table Editor que existan "work_orders",
-- "concept_deadlines" y "user_reminders", y que las tablas
-- fuel_records / travel_expenses / misc_expenses tengan las
-- columnas nuevas ("expenseType", project, "workOrder", ...).
-- ============================================================
