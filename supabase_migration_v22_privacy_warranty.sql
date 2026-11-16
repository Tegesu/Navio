-- ============================================================
-- NAVIO — Migración v22: dos ajustes de la segunda revisión de seguridad
-- ============================================================
-- Qué hace:
--   1. Solicitudes de privacidad (ARCO): la empresa y la persona las pone la
--      base. Antes se podía mandar una solicitud "a nombre" de otra empresa
--      (solo la veía el super-administrador, pero con la empresa equivocada).
--   2. Garantías: la unidad tiene que ser de la misma empresa, igual que en
--      los traslados. Antes una garantía podía apuntar a una unidad ajena.
--   3. Limpieza: el trigger de fotos de la v20 no necesita permiso de
--      ejecución para nadie (un trigger no se puede llamar directo).
--
-- Cómo aplicarla: pega TODO este archivo en Supabase → SQL Editor → Run.
-- Se puede correr más de una vez. No cambia datos que ya existen.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Solicitudes de privacidad
-- ------------------------------------------------------------
create or replace function public.stamp_privacy_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new; -- servidor o SQL Editor
  end if;
  new."userId" := auth.uid();
  new."companyId" := public.current_company_id();
  return new;
end;
$$;
revoke all on function public.stamp_privacy_request() from public, anon, authenticated;

drop trigger if exists stamp_privacy_request on public.privacy_requests;
create trigger stamp_privacy_request
  before insert on public.privacy_requests
  for each row execute function public.stamp_privacy_request();

-- ------------------------------------------------------------
-- 2. Garantías: unidad de la misma empresa
-- ------------------------------------------------------------
create or replace function public.check_warranty_vehicle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new."vehicleId" is not null and not exists (
    select 1 from public.vehicles where id = new."vehicleId" and "companyId" = new."companyId"
  ) then
    raise exception 'Esa unidad no pertenece a tu empresa.';
  end if;
  return new;
end;
$$;
revoke all on function public.check_warranty_vehicle() from public, anon, authenticated;

drop trigger if exists check_warranty_vehicle on public.warranties;
create trigger check_warranty_vehicle
  before insert or update of "vehicleId", "companyId" on public.warranties
  for each row execute function public.check_warranty_vehicle();

-- ------------------------------------------------------------
-- 3. Limpieza de permisos
-- ------------------------------------------------------------
revoke all on function public.check_vehicle_photos() from public, anon, authenticated;
