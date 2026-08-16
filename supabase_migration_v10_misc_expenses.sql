-- ============================================================
-- Navio — Migración v10: Consumibles / Refrigerante / Refacciones / Casetas
-- ============================================================
-- Corre esto DESPUÉS de supabase_migration_v9_telegram_dedupe.sql.
-- Es seguro de correr una sola vez (y de volver a correr).
--
-- Qué hace:
--   Estas cuatro categorías de "Facturas y Gastos" eran solo una
--   pantalla decorativa sin datos reales. En vez de crear cuatro
--   tablas casi idénticas, se usa UNA sola tabla con una columna
--   "category" — el mismo patrón que ya usa "maintenance_records"
--   para distinguir motor/frenos/llantas/papeleo dentro de una
--   tabla. Por ahora estas categorías NO se registran por el bot
--   de Telegram (decisión explícita para no competir por la cuota
--   gratuita de Gemini, ya muy ajustada) — solo desde la web/app.
-- ============================================================

create table if not exists public.misc_expenses (
  id bigint generated always as identity primary key,
  "companyId" bigint not null references public.companies (id),
  category text not null check (category in ('consumables', 'coolant', 'parts', 'tolls')),
  unit text,
  plate text,
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

alter table public.misc_expenses enable row level security;

drop policy if exists "misc_expenses_all_own_company" on public.misc_expenses;
create policy "misc_expenses_all_own_company" on public.misc_expenses
  for all to authenticated
  using ("companyId" = public.current_company_id())
  with check ("companyId" = public.current_company_id());

-- ============================================================
-- Listo. Verifica en Table Editor que exista "misc_expenses".
-- ============================================================
