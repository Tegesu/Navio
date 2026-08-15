-- ============================================================
-- Navio — Migración v3: Roles dentro de cada empresa
-- ============================================================
-- Corre esto DESPUÉS de supabase_migration_v2_multitenant.sql.
-- Es seguro de correr una sola vez (y de volver a correr).
--
-- Qué hace:
--   1. Le agrega a "profiles" un rol POR EMPRESA: "admin" o
--      "member". Esto es distinto de "isSuperAdmin" (que es un
--      super-administrador de TODA la plataforma Navío) — un
--      "companyRole" = 'admin' solo manda dentro de su propia
--      empresa (ej. puede editar/eliminar las unidades de SU
--      flota, pero no ve ni toca nada de otra empresa).
--   2. Cuando se aprueba una empresa nueva, quien la solicitó
--      queda automáticamente como admin de esa empresa.
--   3. Divide la política de "vehicles" (antes un solo permiso
--      compartido para todo) en 4: cualquier miembro de la
--      empresa puede ver y agregar unidades, pero solo un admin
--      de esa empresa puede editarlas o eliminarlas.
--   4. Blinda "companyRole" con el mismo trigger que ya protegía
--      "companyId"/"isSuperAdmin" — nadie se puede auto-ascender
--      a admin desde el cliente.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Columna de rol por empresa
-- ------------------------------------------------------------
alter table public.profiles
  add column if not exists "companyRole" text not null default 'member';

alter table public.profiles
  drop constraint if exists profiles_companyrole_check;
alter table public.profiles
  add constraint profiles_companyrole_check check ("companyRole" in ('admin', 'member'));

-- ------------------------------------------------------------
-- 2. Función auxiliar: ¿el usuario actual es admin de su empresa
--    (o super-admin de la plataforma, que manda sobre todas)?
-- ------------------------------------------------------------
create or replace function public.is_company_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select "isSuperAdmin" or "companyRole" = 'admin' from public.profiles where id = auth.uid()),
    false
  );
$$;

-- ------------------------------------------------------------
-- 3. Blindaje: companyRole se protege igual que companyId /
--    isSuperAdmin — solo cambia vía flujo de confianza (o si
--    quien edita ya es super-admin de la plataforma).
-- ------------------------------------------------------------
create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('navio.trusted_write', true) = 'on' then
    return new;
  end if;
  if not public.is_super_admin() then
    new."companyId" := old."companyId";
    new."isSuperAdmin" := old."isSuperAdmin";
    new."companyRole" := old."companyRole";
  end if;
  return new;
end;
$$;

-- ------------------------------------------------------------
-- 4. Quien solicita y le aprueban una empresa nueva, queda como
--    admin de esa empresa (antes solo se le asignaba companyId).
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
    update public.profiles set "companyId" = target_company_id, "companyRole" = 'admin' where id = requester;
  end if;

  return new_code;
end;
$$;

grant execute on function public.approve_company(bigint) to authenticated;

-- Empresas que ya estaban aprobadas antes de esta migración: su
-- fundador queda como admin retroactivamente. Va en una transacción
-- con la bandera de confianza porque, corriendo desde el SQL Editor,
-- no hay un auth.uid() de por medio y el trigger de blindaje de
-- arriba clamparía "companyRole" de vuelta si no se lo indicamos.
begin;
  select set_config('navio.trusted_write', 'on', true);
  update public.profiles p
  set "companyRole" = 'admin'
  from public.companies c
  where c."requestedBy" = p.id and c.status = 'approved' and p."companyId" = c.id;
commit;

-- ------------------------------------------------------------
-- 5. vehicles: separa el permiso único en 4 — ver/agregar sigue
--    abierto a cualquier miembro de la empresa; editar/eliminar
--    ahora requiere ser admin de esa empresa.
-- ------------------------------------------------------------
drop policy if exists "vehicles_company_isolated" on public.vehicles;

drop policy if exists "vehicles_select" on public.vehicles;
create policy "vehicles_select" on public.vehicles
  for select to authenticated
  using ("companyId" = public.current_company_id());

drop policy if exists "vehicles_insert" on public.vehicles;
create policy "vehicles_insert" on public.vehicles
  for insert to authenticated
  with check ("companyId" = public.current_company_id());

drop policy if exists "vehicles_update" on public.vehicles;
create policy "vehicles_update" on public.vehicles
  for update to authenticated
  using ("companyId" = public.current_company_id() and public.is_company_admin())
  with check ("companyId" = public.current_company_id() and public.is_company_admin());

drop policy if exists "vehicles_delete" on public.vehicles;
create policy "vehicles_delete" on public.vehicles
  for delete to authenticated
  using ("companyId" = public.current_company_id() and public.is_company_admin());

-- ============================================================
-- Listo. Verifica en Table Editor:
--   - "profiles" tiene la columna "companyRole" ('admin' o
--     'member'). El fundador de cada empresa aprobada quedó en
--     'admin'.
--   - En la app, solo un usuario con "companyRole" = 'admin' (o
--     "isSuperAdmin" = true) ve los botones de editar/eliminar
--     unidad en Gestión de Flota.
-- ============================================================
