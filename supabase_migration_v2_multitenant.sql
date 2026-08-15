-- ============================================================
-- Navio — Migración v2: Multiempresa (multi-tenant)
-- ============================================================
-- Corre esto DESPUÉS de supabase_migration.sql — no lo reemplaza,
-- lo complementa. Es seguro de correr una sola vez.
--
-- Qué hace:
--   1. Crea la tabla "companies" (empresas/clientes de Navío).
--   2. Le agrega a "profiles" a qué empresa pertenece cada usuario
--      y si es super-administrador de la plataforma.
--   3. Le agrega "companyId" a cada tabla operativa (vehicles,
--      maintenance_records, compliance_records, fuel_records,
--      trips, incidents) y cambia sus políticas de "compartido
--      entre todos" a "aislado por empresa" — este es el cambio
--      de seguridad que evita que la información de una empresa
--      se mezcle con la de otra.
--   4. "community_posts"/"community_votes" se quedan SIN
--      companyId a propósito: es el canal de feedback hacia el
--      equipo de Navío, no información operativa de una empresa,
--      así que tiene sentido que sea compartido entre todos los
--      clientes de la plataforma.
--   5. Blinda el cambio de empresa/super-admin de un perfil detrás
--      de dos funciones controladas (join_company_with_code,
--      approve_company) en vez de dejar que cualquiera actualice
--      su propio "companyId" directamente — si no hicieras esto,
--      cualquier usuario autenticado podría asignarse a sí mismo
--      a la empresa que quisiera con una sola llamada a la API.
--   6. Cierra una fuga de privacidad de la v1: antes CUALQUIER
--      usuario autenticado podía leer la tabla "profiles" completa
--      (nombres y empresa de TODOS los usuarios de TODAS las
--      empresas). Ahora solo ves tu propio perfil, los de tu misma
--      empresa, o todos si eres super-admin.
--   7. Crea una empresa "Flotilla Demo" y le asigna todos los
--      datos de ejemplo que ya existían, para no perder nada.
--   8. Te vuelve super-administrador de la plataforma (ajusta el
--      correo abajo si es necesario antes de correr el script).
-- ============================================================

-- ------------------------------------------------------------
-- 1. companies
-- ------------------------------------------------------------
create table if not exists public.companies (
  id bigint generated always as identity primary key,
  name text not null,
  industry text,
  "fleetSize" text,
  "contactName" text,
  "contactEmail" text,
  "contactPhone" text,
  needs text,
  status text not null default 'pending', -- pending | approved | rejected | suspended
  "inviteCode" text unique,
  "requestedBy" uuid references auth.users (id),
  "approvedBy" uuid references auth.users (id),
  "approvedAt" timestamptz,
  "createdAt" timestamptz not null default now()
);

alter table public.companies enable row level security;

-- ------------------------------------------------------------
-- 2. profiles: a qué empresa pertenece cada usuario + super-admin
-- ------------------------------------------------------------
alter table public.profiles add column if not exists "companyId" bigint references public.companies (id);
alter table public.profiles add column if not exists "isSuperAdmin" boolean not null default false;

-- ------------------------------------------------------------
-- 3. Funciones auxiliares para las políticas de seguridad
-- ------------------------------------------------------------
create or replace function public.current_company_id()
returns bigint
language sql
security definer
stable
set search_path = public
as $$
  select "companyId" from public.profiles where id = auth.uid();
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((select "isSuperAdmin" from public.profiles where id = auth.uid()), false);
$$;

-- ------------------------------------------------------------
-- 4. Blindaje de "profiles": nadie puede escalar su propio
--    companyId / isSuperAdmin con un UPDATE directo desde el
--    cliente. Solo las funciones de abajo (que validan todo
--    antes de tocar la fila) pueden cambiarlos.
-- ------------------------------------------------------------
create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('navio.trusted_write', true) = 'on' then
    return new; -- lo autorizó join_company_with_code() o approve_company()
  end if;
  if not public.is_super_admin() then
    new."companyId" := old."companyId";
    new."isSuperAdmin" := old."isSuperAdmin";
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_privileges_trigger on public.profiles;
create trigger protect_profile_privileges_trigger
  before update on public.profiles
  for each row execute function public.protect_profile_privileges();

drop policy if exists "profiles_select_authenticated" on public.profiles;
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select to authenticated
  using (auth.uid() = id or public.is_super_admin() or "companyId" = public.current_company_id());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ------------------------------------------------------------
-- 5. Unirse a una empresa con código de invitación
--    (el único camino permitido para fijar tu propio companyId)
-- ------------------------------------------------------------
create or replace function public.join_company_with_code(invite_code text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  target_company_id bigint;
begin
  select id into target_company_id
  from public.companies
  where "inviteCode" = invite_code and status = 'approved';

  if target_company_id is null then
    raise exception 'Código de invitación inválido o la empresa no está aprobada.';
  end if;

  perform set_config('navio.trusted_write', 'on', true);
  update public.profiles set "companyId" = target_company_id where id = auth.uid();

  return target_company_id;
end;
$$;

grant execute on function public.join_company_with_code(text) to authenticated;

-- ------------------------------------------------------------
-- 6. Aprobar / rechazar una empresa (solo super-admin)
-- ------------------------------------------------------------
create or replace function public.approve_company(target_company_id bigint)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  new_code text;
  requester uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Solo un super-administrador puede aprobar empresas.';
  end if;

  new_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  update public.companies
  set status = 'approved', "inviteCode" = new_code, "approvedBy" = auth.uid(), "approvedAt" = now()
  where id = target_company_id
  returning "requestedBy" into requester;

  if requester is not null then
    perform set_config('navio.trusted_write', 'on', true);
    update public.profiles set "companyId" = target_company_id where id = requester;
  end if;

  return new_code;
end;
$$;

grant execute on function public.approve_company(bigint) to authenticated;

create or replace function public.reject_company(target_company_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Solo un super-administrador puede rechazar empresas.';
  end if;
  update public.companies set status = 'rejected' where id = target_company_id;
end;
$$;

grant execute on function public.reject_company(bigint) to authenticated;

-- ------------------------------------------------------------
-- 7. Políticas de companies (lectura directa + solicitud propia;
--    aprobar/rechazar van por las funciones de arriba)
-- ------------------------------------------------------------
drop policy if exists "companies_select" on public.companies;
create policy "companies_select" on public.companies
  for select to authenticated
  using (public.is_super_admin() or id = public.current_company_id() or "requestedBy" = auth.uid());

drop policy if exists "companies_insert_request" on public.companies;
create policy "companies_insert_request" on public.companies
  for insert to authenticated
  with check ("requestedBy" = auth.uid() and status = 'pending');

-- ------------------------------------------------------------
-- 8. Empresa demo + backfill de los datos de ejemplo existentes
-- ------------------------------------------------------------
insert into public.companies (name, status, "inviteCode", "contactEmail", "approvedAt")
select 'Flotilla Demo', 'approved', 'DEMO-NAVIO', 'demo@navio.mx', now()
where not exists (select 1 from public.companies where name = 'Flotilla Demo');

do $$
declare
  demo_id bigint;
begin
  select id into demo_id from public.companies where name = 'Flotilla Demo';

  alter table public.vehicles add column if not exists "companyId" bigint references public.companies (id);
  update public.vehicles set "companyId" = demo_id where "companyId" is null;
  alter table public.vehicles alter column "companyId" set not null;

  alter table public.maintenance_records add column if not exists "companyId" bigint references public.companies (id);
  update public.maintenance_records set "companyId" = demo_id where "companyId" is null;
  alter table public.maintenance_records alter column "companyId" set not null;

  alter table public.compliance_records add column if not exists "companyId" bigint references public.companies (id);
  update public.compliance_records set "companyId" = demo_id where "companyId" is null;
  alter table public.compliance_records alter column "companyId" set not null;

  alter table public.fuel_records add column if not exists "companyId" bigint references public.companies (id);
  update public.fuel_records set "companyId" = demo_id where "companyId" is null;
  alter table public.fuel_records alter column "companyId" set not null;

  alter table public.trips add column if not exists "companyId" bigint references public.companies (id);
  update public.trips set "companyId" = demo_id where "companyId" is null;
  alter table public.trips alter column "companyId" set not null;

  alter table public.incidents add column if not exists "companyId" bigint references public.companies (id);
  update public.incidents set "companyId" = demo_id where "companyId" is null;
  alter table public.incidents alter column "companyId" set not null;

  -- Cualquier usuario que ya existiera antes de esta migración y no
  -- tenga empresa se queda en la demo, para no dejarlo huérfano.
  update public.profiles set "companyId" = demo_id where "companyId" is null;
end $$;

-- ------------------------------------------------------------
-- 9. Reemplaza las políticas "compartidas entre todos" por
--    políticas aisladas por empresa (el cambio de seguridad clave)
-- ------------------------------------------------------------
drop policy if exists "vehicles_shared_access" on public.vehicles;
create policy "vehicles_company_isolated" on public.vehicles
  for all to authenticated
  using ("companyId" = public.current_company_id())
  with check ("companyId" = public.current_company_id());

drop policy if exists "maintenance_shared_access" on public.maintenance_records;
create policy "maintenance_company_isolated" on public.maintenance_records
  for all to authenticated
  using ("companyId" = public.current_company_id())
  with check ("companyId" = public.current_company_id());

drop policy if exists "compliance_shared_access" on public.compliance_records;
create policy "compliance_company_isolated" on public.compliance_records
  for all to authenticated
  using ("companyId" = public.current_company_id())
  with check ("companyId" = public.current_company_id());

drop policy if exists "fuel_shared_access" on public.fuel_records;
create policy "fuel_company_isolated" on public.fuel_records
  for all to authenticated
  using ("companyId" = public.current_company_id())
  with check ("companyId" = public.current_company_id());

drop policy if exists "trips_shared_access" on public.trips;
create policy "trips_company_isolated" on public.trips
  for all to authenticated
  using ("companyId" = public.current_company_id())
  with check ("companyId" = public.current_company_id());

drop policy if exists "incidents_shared_access" on public.incidents;
create policy "incidents_company_isolated" on public.incidents
  for all to authenticated
  using ("companyId" = public.current_company_id())
  with check ("companyId" = public.current_company_id());

-- ------------------------------------------------------------
-- 10. Te vuelve super-administrador de la plataforma
--     (ajusta el correo si no es el correcto antes de correr)
-- ------------------------------------------------------------
update public.profiles p
set "isSuperAdmin" = true
from auth.users u
where p.id = u.id and u.email = 'jesusibrahimcontacto+navio@gmail.com';

-- ============================================================
-- Listo. Verifica en Table Editor:
--   - "companies" tiene 1 fila ("Flotilla Demo", approved).
--   - "profiles" tiene la columna "companyId" llena y tu usuario
--     con "isSuperAdmin" = true.
--   - "vehicles" (y las demás tablas operativas) tienen
--     "companyId" apuntando a "Flotilla Demo" en todas sus filas.
-- ============================================================
