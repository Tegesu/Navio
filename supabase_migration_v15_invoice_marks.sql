-- ============================================================
-- Navio — Migración v15: Marcas sobre el documento de una factura
-- ============================================================
-- Corre esto DESPUÉS de supabase_migration_v14_document_limits.sql.
-- Es seguro de correr una sola vez (y de volver a correr).
--
-- Qué hace:
--   Guarda los resaltados y subrayados de quien revisa una factura en
--   una tabla aparte. El archivo nunca se toca: no se crean copias y al
--   descargar sale el original, sin marcas.
--
-- Quién puede marcar:
--   Administrador: facturas pendientes, verificadas y aprobadas.
--   Usuario: solo facturas pendientes, que son las que puede verificar.
--   Rechazada o anulada: nadie. Sus marcas quedan como evidencia.
--   Borrar: un administrador, o quien la hizo, con las mismas reglas.
--   Todos en la empresa las ven.
--
-- Cada marca pertenece a un archivo: si se reemplaza el documento de la
-- factura, las marcas del anterior ya no se muestran.
-- ============================================================

create table if not exists public.invoice_marks (
  id bigint generated always as identity primary key,
  "companyId" bigint not null references public.companies (id),
  "invoiceTable" text not null check ("invoiceTable" in ('fuel_records', 'travel_expenses', 'misc_expenses')),
  "invoiceId" bigint not null,
  "documentUrl" text not null,
  page integer not null check (page >= 1),
  kind text not null check (kind in ('highlight', 'underline')),
  x double precision not null check (x between 0 and 1),
  y double precision not null check (y between 0 and 1),
  w double precision not null check (w between 0 and 1),
  h double precision not null check (h between 0 and 1),
  "createdBy" uuid,
  "createdByName" text,
  "createdAt" timestamptz not null default now()
);

create index if not exists invoice_marks_invoice_idx on public.invoice_marks ("invoiceTable", "invoiceId");

create or replace function public.can_mark_invoice(target_table text, target_id bigint)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  invoice_company bigint;
  invoice_status text;
begin
  if target_table not in ('fuel_records', 'travel_expenses', 'misc_expenses') then
    return false;
  end if;
  execute format('select "companyId", coalesce(status, ''pending'') from public.%I where id = $1', target_table)
    into invoice_company, invoice_status
    using target_id;
  if invoice_company is null or invoice_company is distinct from public.current_company_id() then
    return false;
  end if;
  if invoice_status in ('rejected', 'voided') then
    return false;
  end if;
  return public.is_company_admin() or invoice_status = 'pending';
end;
$$;

-- Empresa y autor los decide la base de datos, no lo que mande la pantalla.
create or replace function public.prepare_invoice_mark()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  invoice_company bigint;
  invoice_document text;
begin
  if not public.can_mark_invoice(new."invoiceTable", new."invoiceId") then
    raise exception 'No puedes marcar el documento de esta factura.';
  end if;
  execute format('select "companyId", "documentUrl" from public.%I where id = $1', new."invoiceTable")
    into invoice_company, invoice_document
    using new."invoiceId";
  if invoice_document is distinct from new."documentUrl" then
    raise exception 'El documento de esta factura cambió: vuelve a abrirla.';
  end if;
  new."companyId" := invoice_company;
  new."createdBy" := auth.uid();
  new."createdByName" := (select "fullName" from public.profiles where id = auth.uid());
  new."createdAt" := now();
  return new;
end;
$$;

drop trigger if exists prepare_invoice_mark on public.invoice_marks;
create trigger prepare_invoice_mark
  before insert on public.invoice_marks
  for each row execute function public.prepare_invoice_mark();

alter table public.invoice_marks enable row level security;

drop policy if exists "invoice_marks_select_own_company" on public.invoice_marks;
create policy "invoice_marks_select_own_company" on public.invoice_marks
  for select to authenticated
  using ("companyId" = public.current_company_id());

drop policy if exists "invoice_marks_insert_own_company" on public.invoice_marks;
create policy "invoice_marks_insert_own_company" on public.invoice_marks
  for insert to authenticated
  with check ("companyId" = public.current_company_id());

drop policy if exists "invoice_marks_delete_allowed" on public.invoice_marks;
create policy "invoice_marks_delete_allowed" on public.invoice_marks
  for delete to authenticated
  using (
    "companyId" = public.current_company_id()
    and public.can_mark_invoice("invoiceTable", "invoiceId")
    and (public.is_company_admin() or "createdBy" = auth.uid())
  );

-- Sin política de update: una marca no se edita, se borra y se hace otra.

-- ============================================================
-- Listo. Verifica en Table Editor que exista "invoice_marks".
-- ============================================================
