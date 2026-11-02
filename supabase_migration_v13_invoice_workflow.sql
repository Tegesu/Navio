-- ============================================================
-- Navio — Migración v13: Control de facturas y roles del equipo
-- ============================================================
-- Corre esto DESPUÉS de supabase_migration_v12_cfdi.sql.
-- Es seguro de correr una sola vez (y de volver a correr).
--
-- ANTES de correrla: borra las facturas de prueba que no quieras
-- conservar. A partir de aquí las facturas ya no se eliminan.
--
-- Qué hace:
--   1. Flujo de una factura, aplicado por la base de datos aunque dos
--      personas la tengan abierta a la vez:
--        Pendiente → Verificada → Aprobada
--      Un administrador puede rechazar o anular (con motivo) y revertir
--      una aprobación (con motivo). Rechazada y anulada son finales.
--   2. Las facturas ya no se eliminan: se anulan, y siguen en el
--      historial sin contar en los totales.
--   3. Bitácora "invoice_events": quién hizo qué, cuándo y por qué. La
--      escribe la base de datos y nadie la modifica desde la app.
--   4. Una misma factura (folio fiscal / UUID) no se registra dos veces,
--      salvo que la anterior esté rechazada o anulada.
--   5. Equipo: un administrador ve a su empresa y asigna roles.
--        Administrador: sube, aprueba, rechaza, anula y gestiona.
--        Usuario: sube y verifica, pero no aprueba.
--
-- Si de verdad hiciera falta borrar una factura (por ejemplo, datos
-- sensibles subidos por error), un dueño del proyecto puede hacerlo desde
-- el SQL Editor desactivando antes el trigger block_invoice_delete.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Motivo del último rechazo, anulación o reversión
-- ------------------------------------------------------------
alter table public.fuel_records add column if not exists "statusReason" text;
alter table public.travel_expenses add column if not exists "statusReason" text;
alter table public.misc_expenses add column if not exists "statusReason" text;

-- ------------------------------------------------------------
-- 2. Flujo de la factura
-- ------------------------------------------------------------
drop trigger if exists enforce_invoice_workflow on public.fuel_records;
drop trigger if exists enforce_invoice_workflow on public.travel_expenses;
drop trigger if exists enforce_invoice_workflow on public.misc_expenses;

-- Facturas aprobadas cuando aún se podía aprobar sin verificar:
-- aprobarlas ya implicaba verificarlas.
update public.fuel_records set status = 'verified' where approved and status = 'pending';
update public.travel_expenses set status = 'verified' where approved and status = 'pending';
update public.misc_expenses set status = 'verified' where approved and status = 'pending';

create or replace function public.enforce_invoice_workflow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_admin boolean := public.is_company_admin();
  workflow_columns text[] := array['status', 'statusReason', 'approved', 'approvedBy', 'approvedByName', 'approvedAt'];
  data_changed boolean := (to_jsonb(new) - workflow_columns) is distinct from (to_jsonb(old) - workflow_columns);
  reason text := nullif(trim(coalesce(new."statusReason", '')), '');
begin
  if old.status = 'rejected' then
    raise exception 'Esta factura ya fue rechazada: para corregirla hay que cargarla de nuevo.';
  end if;
  if old.status = 'voided' then
    raise exception 'Esta factura ya fue anulada: para corregirla hay que cargarla de nuevo.';
  end if;

  -- Rechazar o anular
  if new.status in ('rejected', 'voided') then
    if not is_admin then
      raise exception 'Solo un administrador de la empresa puede rechazar o anular una factura.';
    end if;
    if old.approved and new.status = 'rejected' then
      raise exception 'Esta factura ya fue aprobada: revierte la aprobación o anúlala.';
    end if;
    if reason is null then
      raise exception 'Indica el motivo.';
    end if;
    if data_changed then
      raise exception 'Al rechazar o anular no se pueden cambiar los datos de la factura.';
    end if;
    new.approved := false;
    new."approvedBy" := null;
    new."approvedByName" := null;
    new."approvedAt" := null;
    return new;
  end if;

  -- Ya aprobada: lo único posible aquí es revertir la aprobación
  if old.approved then
    if new.approved then
      raise exception 'Esta factura ya fue aprobada y no se puede modificar.';
    end if;
    if not is_admin then
      raise exception 'Solo un administrador de la empresa puede revertir una aprobación.';
    end if;
    if reason is null then
      raise exception 'Indica el motivo.';
    end if;
    if data_changed then
      raise exception 'Al revertir la aprobación no se pueden cambiar los datos de la factura.';
    end if;
    new.status := 'verified';
    new."approvedBy" := null;
    new."approvedByName" := null;
    new."approvedAt" := null;
    return new;
  end if;

  -- Aprobar
  if new.approved then
    if not is_admin then
      raise exception 'Solo un administrador de la empresa puede aprobar una factura.';
    end if;
    if old.status <> 'verified' or new.status <> 'verified' then
      raise exception 'Solo se puede aprobar una factura ya verificada.';
    end if;
    if data_changed then
      raise exception 'Al aprobar no se pueden cambiar los datos de la factura.';
    end if;
    -- Quién aprueba lo decide la sesión, no lo que mande la pantalla.
    new."approvedBy" := auth.uid();
    new."approvedByName" := coalesce((select "fullName" from public.profiles where id = auth.uid()), new."approvedByName");
    new."approvedAt" := now();
    return new;
  end if;

  if old.status = 'verified' and new.status = 'pending' then
    raise exception 'Una factura verificada no puede volver a pendiente.';
  end if;
  return new;
end;
$$;

create trigger enforce_invoice_workflow
  before update on public.fuel_records
  for each row execute function public.enforce_invoice_workflow();
create trigger enforce_invoice_workflow
  before update on public.travel_expenses
  for each row execute function public.enforce_invoice_workflow();
create trigger enforce_invoice_workflow
  before update on public.misc_expenses
  for each row execute function public.enforce_invoice_workflow();

-- ------------------------------------------------------------
-- 3. Las facturas no se eliminan: se anulan
-- ------------------------------------------------------------
create or replace function public.block_invoice_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Las facturas no se eliminan: anúlala con un motivo para que quede en el historial.';
end;
$$;

drop trigger if exists block_invoice_delete on public.fuel_records;
create trigger block_invoice_delete
  before delete on public.fuel_records
  for each row execute function public.block_invoice_delete();
drop trigger if exists block_invoice_delete on public.travel_expenses;
create trigger block_invoice_delete
  before delete on public.travel_expenses
  for each row execute function public.block_invoice_delete();
drop trigger if exists block_invoice_delete on public.misc_expenses;
create trigger block_invoice_delete
  before delete on public.misc_expenses
  for each row execute function public.block_invoice_delete();

-- ------------------------------------------------------------
-- 4. Bitácora
-- ------------------------------------------------------------
create table if not exists public.invoice_events (
  id bigint generated always as identity primary key,
  "companyId" bigint not null references public.companies (id),
  "invoiceTable" text not null,
  "invoiceId" bigint not null,
  action text not null,
  "fromStatus" text,
  "toStatus" text,
  reason text,
  "actorId" uuid,
  "actorName" text,
  changes jsonb,
  "createdAt" timestamptz not null default now()
);

create index if not exists invoice_events_invoice_idx on public.invoice_events ("invoiceTable", "invoiceId");

alter table public.invoice_events enable row level security;

-- Solo lectura: sin políticas de escritura, nadie la altera desde la app.
drop policy if exists "invoice_events_select_own_company" on public.invoice_events;
create policy "invoice_events_select_own_company" on public.invoice_events
  for select to authenticated
  using ("companyId" = public.current_company_id());

create or replace function public.log_invoice_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ignored text[] := array['id', 'companyId', 'createdAt', 'createdBy', 'status', 'statusReason', 'approved', 'approvedBy', 'approvedByName', 'approvedAt'];
  actor text := (select "fullName" from public.profiles where id = auth.uid());
  event_action text;
  field_changes jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.invoice_events ("companyId", "invoiceTable", "invoiceId", action, "toStatus", "actorId", "actorName")
    values (new."companyId", tg_table_name, new.id, 'created', new.status, auth.uid(), coalesce(actor, new."uploadedByName", 'Sistema'));
    return null;
  end if;

  select jsonb_object_agg(n.key, jsonb_build_object('de', o.value, 'a', n.value))
  into field_changes
  from jsonb_each(to_jsonb(new) - ignored) n
  left join jsonb_each(to_jsonb(old) - ignored) o on o.key = n.key
  where n.value is distinct from o.value;

  event_action := case
    when new.status = 'voided' then 'voided'
    when new.status = 'rejected' then 'rejected'
    when new.approved and not old.approved then 'approved'
    when old.approved and not new.approved then 'approval_reverted'
    when old.status = 'pending' and new.status = 'verified' then 'verified'
    when field_changes is not null then 'edited'
  end;
  if event_action is null then
    return null;
  end if;

  insert into public.invoice_events ("companyId", "invoiceTable", "invoiceId", action, "fromStatus", "toStatus", reason, "actorId", "actorName", changes)
  values (
    new."companyId", tg_table_name, new.id, event_action, old.status, new.status,
    case when event_action in ('voided', 'rejected', 'approval_reverted') then new."statusReason" end,
    auth.uid(), coalesce(actor, 'Sistema'), field_changes
  );
  return null;
end;
$$;

drop trigger if exists log_invoice_event on public.fuel_records;
create trigger log_invoice_event
  after insert or update on public.fuel_records
  for each row execute function public.log_invoice_event();
drop trigger if exists log_invoice_event on public.travel_expenses;
create trigger log_invoice_event
  after insert or update on public.travel_expenses
  for each row execute function public.log_invoice_event();
drop trigger if exists log_invoice_event on public.misc_expenses;
create trigger log_invoice_event
  after insert or update on public.misc_expenses
  for each row execute function public.log_invoice_event();

-- ------------------------------------------------------------
-- 5. Una factura no se registra dos veces (mismo folio fiscal)
-- ------------------------------------------------------------
create index if not exists fuel_records_cfdi_uuid_idx on public.fuel_records ("companyId", (upper(cfdi ->> 'uuid')));
create index if not exists travel_expenses_cfdi_uuid_idx on public.travel_expenses ("companyId", (upper(cfdi ->> 'uuid')));
create index if not exists misc_expenses_cfdi_uuid_idx on public.misc_expenses ("companyId", (upper(cfdi ->> 'uuid')));
create index if not exists maintenance_records_cfdi_uuid_idx on public.maintenance_records ("companyId", (upper(cfdi ->> 'uuid')));
create index if not exists compliance_records_cfdi_uuid_idx on public.compliance_records ("companyId", (upper(cfdi ->> 'uuid')));

create or replace function public.find_invoice_by_uuid(
  target_company bigint,
  target_uuid text,
  exclude_table text default null,
  exclude_id bigint default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(found)
  from (
    select 'fuel_records' as "table", id, status, amount, date, "createdAt" from public.fuel_records
      where "companyId" = target_company and upper(cfdi ->> 'uuid') = upper(target_uuid)
    union all
    select 'travel_expenses', id, status, amount, date, "createdAt" from public.travel_expenses
      where "companyId" = target_company and upper(cfdi ->> 'uuid') = upper(target_uuid)
    union all
    select 'misc_expenses', id, status, amount, date, "createdAt" from public.misc_expenses
      where "companyId" = target_company and upper(cfdi ->> 'uuid') = upper(target_uuid)
    union all
    select 'maintenance_records', id, status, amount, date, "createdAt" from public.maintenance_records
      where "companyId" = target_company and upper(cfdi ->> 'uuid') = upper(target_uuid)
    union all
    select 'compliance_records', id, status, amount, date, "createdAt" from public.compliance_records
      where "companyId" = target_company and upper(cfdi ->> 'uuid') = upper(target_uuid)
  ) found
  where coalesce(found.status, 'pending') not in ('rejected', 'voided')
    and (found."table", found.id) is distinct from (exclude_table, exclude_id)
  order by found."createdAt"
  limit 1;
$$;

-- Recibe el id de la empresa: solo el bot (llave de servicio) y los
-- triggers pueden usarla, para que nadie consulte facturas de otra empresa.
revoke all on function public.find_invoice_by_uuid(bigint, text, text, bigint) from public;
revoke all on function public.find_invoice_by_uuid(bigint, text, text, bigint) from anon, authenticated;
grant execute on function public.find_invoice_by_uuid(bigint, text, text, bigint) to service_role;

create or replace function public.block_duplicate_invoice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  invoice_uuid text := upper(nullif(trim(coalesce(new.cfdi ->> 'uuid', '')), ''));
begin
  if invoice_uuid is null or coalesce(new.status, 'pending') in ('rejected', 'voided') then
    return new;
  end if;
  -- Evita que dos envíos simultáneos de la misma factura pasen la revisión.
  perform pg_advisory_xact_lock(hashtext(new."companyId" || ':' || invoice_uuid));
  if public.find_invoice_by_uuid(new."companyId", invoice_uuid, tg_table_name, new.id) is not null then
    raise exception 'Esta factura ya está registrada (folio fiscal %). Si hay que cambiarla, anula la anterior y vuelve a cargarla.', invoice_uuid;
  end if;
  return new;
end;
$$;

drop trigger if exists block_duplicate_invoice on public.fuel_records;
create trigger block_duplicate_invoice
  before insert or update on public.fuel_records
  for each row execute function public.block_duplicate_invoice();
drop trigger if exists block_duplicate_invoice on public.travel_expenses;
create trigger block_duplicate_invoice
  before insert or update on public.travel_expenses
  for each row execute function public.block_duplicate_invoice();
drop trigger if exists block_duplicate_invoice on public.misc_expenses;
create trigger block_duplicate_invoice
  before insert or update on public.misc_expenses
  for each row execute function public.block_duplicate_invoice();
drop trigger if exists block_duplicate_invoice on public.maintenance_records;
create trigger block_duplicate_invoice
  before insert or update on public.maintenance_records
  for each row execute function public.block_duplicate_invoice();
drop trigger if exists block_duplicate_invoice on public.compliance_records;
create trigger block_duplicate_invoice
  before insert or update on public.compliance_records
  for each row execute function public.block_duplicate_invoice();

-- ------------------------------------------------------------
-- 6. Equipo: ver a la empresa y asignar roles
-- ------------------------------------------------------------
create or replace function public.list_company_members()
returns table (id uuid, "fullName" text, email text, "companyRole" text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_company_admin() then
    raise exception 'Solo un administrador de la empresa puede ver al equipo.';
  end if;
  return query
    select p.id, p."fullName", u.email::text, p."companyRole"
    from public.profiles p
    join auth.users u on u.id = p.id
    where p."companyId" = public.current_company_id()
    order by p."companyRole", p."fullName";
end;
$$;

grant execute on function public.list_company_members() to authenticated;

create or replace function public.set_member_role(target_user uuid, new_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_company bigint;
begin
  if new_role not in ('admin', 'member') then
    raise exception 'Rol no válido.';
  end if;
  if not public.is_company_admin() then
    raise exception 'Solo un administrador de la empresa puede cambiar roles.';
  end if;

  select "companyId" into target_company from public.profiles where id = target_user;
  if target_company is null or target_company is distinct from public.current_company_id() then
    raise exception 'Esa persona no pertenece a tu empresa.';
  end if;

  if new_role = 'member' and not exists (
    select 1 from public.profiles
    where "companyId" = target_company and "companyRole" = 'admin' and id <> target_user
  ) then
    raise exception 'La empresa debe conservar al menos un administrador.';
  end if;

  perform set_config('navio.trusted_write', 'on', true);
  update public.profiles set "companyRole" = new_role where id = target_user;
end;
$$;

grant execute on function public.set_member_role(uuid, text) to authenticated;

-- ============================================================
-- Listo. Verifica en Table Editor que exista "invoice_events", y en
-- Database → Triggers que aparezcan enforce_invoice_workflow,
-- block_invoice_delete, log_invoice_event y block_duplicate_invoice.
-- ============================================================
