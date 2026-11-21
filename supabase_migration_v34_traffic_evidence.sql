-- ============================================================
-- NAVIO — Migración v34: evidencia de atascos por tráfico
-- ============================================================
-- Qué hace:
--   1. Cada viaje guarda lo que se planeó al salir (minutos, km, llegada
--      estimada y destino), para compararlo con lo real.
--   2. Los "tramos lentos": cuando una unidad casi no avanza unos minutos,
--      Navio le pregunta a TomTom por el tráfico de ese mismo tramo en ese
--      momento (velocidad actual contra la normal, choques, cierres) y lo
--      guarda con el viaje. Lo escribe solo el servidor (la función tomtom):
--      nadie lo puede inventar ni cambiar desde el teléfono.
--
-- Cómo aplicarla: pega TODO este archivo en Supabase → SQL Editor → Run.
-- Va DESPUÉS de la v33. Se puede correr más de una vez. Después vuelve a
-- desplegar la función "tomtom".
-- ============================================================

-- 1. Lo planeado al salir.
alter table public.routes
  add column if not exists "plannedMinutes" integer,
  add column if not exists "plannedKm" numeric,
  add column if not exists "plannedArrival" timestamptz,
  add column if not exists "destinationLabel" text;

create or replace function public.set_route_plan(target_route bigint, planned_minutes integer, planned_km numeric, planned_arrival timestamptz, destination text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.routes
    where id = target_route and "createdBy" = auth.uid() and status = 'active' and "companyId" = public.current_company_id()
  ) then
    raise exception 'Ese viaje no es tuyo o ya terminó.';
  end if;
  update public.routes set
    "plannedMinutes" = case when planned_minutes between 0 and 10080 then planned_minutes end,
    "plannedKm" = case when planned_km between 0 and 10000 then round(planned_km, 1) end,
    "plannedArrival" = case when planned_arrival between now() - interval '1 day' and now() + interval '8 days' then planned_arrival end,
    "destinationLabel" = nullif(left(trim(coalesce(destination, '')), 200), '')
  where id = target_route;
end;
$$;
revoke all on function public.set_route_plan(bigint, integer, numeric, timestamptz, text) from public, anon;
grant execute on function public.set_route_plan(bigint, integer, numeric, timestamptz, text) to authenticated;

-- 2. Tramos lentos con el tráfico que reportó TomTom en ese momento.
-- verdict: traffic (TomTom confirmó tráfico, cierre o incidente), clear (la
-- calle estaba libre: la unidad se detuvo por otra cosa) o unknown (sin datos).
create table if not exists public.route_traffic_events (
  id bigint generated always as identity primary key,
  "companyId" bigint not null references public.companies (id) on delete cascade,
  "routeId" bigint not null references public.routes (id) on delete cascade,
  "startedAt" timestamptz not null,
  "checkedAt" timestamptz not null default now(),
  "endedAt" timestamptz,
  lat double precision not null,
  lng double precision not null,
  "roadName" text,
  "movedKm" numeric,
  "unitSpeedKmh" numeric,
  "currentSpeedKmh" numeric,
  "freeFlowSpeedKmh" numeric,
  confidence numeric,
  "roadClosure" boolean not null default false,
  incidents jsonb not null default '[]',
  verdict text not null default 'unknown' check (verdict in ('traffic', 'clear', 'unknown')),
  note text,
  "createdAt" timestamptz not null default now()
);
create index if not exists route_traffic_events_route_idx on public.route_traffic_events ("routeId", "startedAt");

alter table public.route_traffic_events enable row level security;
drop policy if exists route_traffic_events_select on public.route_traffic_events;
create policy route_traffic_events_select on public.route_traffic_events
  for select to authenticated
  using ("companyId" = public.current_company_id());
drop policy if exists mfa_required on public.route_traffic_events;
create policy mfa_required on public.route_traffic_events as restrictive for all to authenticated
  using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));
-- Solo el servidor escribe (con su llave de servicio).
revoke insert, update, delete on public.route_traffic_events from anon, authenticated;

-- ============================================================
-- Listo.
-- ============================================================
