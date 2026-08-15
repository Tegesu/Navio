-- ============================================================
-- Navio — Migración v7: GPS en vivo + historial de rutas
-- ============================================================
-- Corre esto DESPUÉS de supabase_migration_v6_document_storage.sql.
-- Es seguro de correr una sola vez (y de volver a correr).
--
-- Qué hace:
--   1. Crea "routes": una ruta/recorrido de una unidad, con inicio,
--      fin, distancia y estado (activa/completada).
--   2. Crea "route_points": el rastro de puntos GPS de esa ruta
--      (el "historial" que se guarda para verla después en el mapa).
--   3. Crea "vehicle_positions": la última posición conocida de
--      cada unidad — es lo que el Mapa en Vivo lee para dibujar los
--      marcadores en tiempo real (una fila por vehículo, se
--      actualiza/"upsert" en cada reporte de posición).
--   4. Todo queda aislado por empresa con el mismo patrón de RLS
--      que ya usan vehicles/trips/etc.
--   5. Diseño pensado para DOS fuentes de posición desde ya:
--      - "phone": el celular del conductor, vía Modo Conductor
--        (usa el navegador con tu sesión normal — las políticas de
--        abajo ya lo cubren).
--      - "hardware": trackers GPS físicos que se instalen más
--        adelante. La columna "source" ya distingue el origen, y
--        cuando se elija un proveedor, su integración (probablemente
--        una Edge Function con la llave de servicio, igual que el
--        bot de Telegram) escribirá en estas MISMAS tablas sin
--        necesitar cambios de esquema — por eso conviene correr
--        esta migración ya, aunque el hardware llegue después.
--   6. Activa Supabase Realtime en "vehicle_positions" para que el
--      mapa se actualice solo, sin recargar la página.
-- ============================================================

-- ------------------------------------------------------------
-- 1. routes
-- ------------------------------------------------------------
create table if not exists public.routes (
  id bigint generated always as identity primary key,
  "companyId" bigint not null references public.companies (id),
  "vehicleId" bigint not null references public.vehicles (id),
  "driverName" text,
  status text not null default 'active', -- active | completed
  "distanceKm" numeric,
  "startedAt" timestamptz not null default now(),
  "endedAt" timestamptz,
  "createdBy" uuid references auth.users (id)
);

alter table public.routes enable row level security;

drop policy if exists "routes_all_own_company" on public.routes;
create policy "routes_all_own_company" on public.routes
  for all to authenticated
  using ("companyId" = public.current_company_id())
  with check ("companyId" = public.current_company_id());

-- ------------------------------------------------------------
-- 2. route_points — el rastro de una ruta
-- ------------------------------------------------------------
create table if not exists public.route_points (
  id bigint generated always as identity primary key,
  "routeId" bigint not null references public.routes (id) on delete cascade,
  "companyId" bigint not null references public.companies (id),
  lat double precision not null,
  lng double precision not null,
  speed numeric,
  heading numeric,
  accuracy numeric,
  source text not null default 'phone', -- phone | hardware
  "recordedAt" timestamptz not null default now()
);

alter table public.route_points enable row level security;

drop policy if exists "route_points_all_own_company" on public.route_points;
create policy "route_points_all_own_company" on public.route_points
  for all to authenticated
  using ("companyId" = public.current_company_id())
  with check ("companyId" = public.current_company_id());

create index if not exists route_points_route_id_idx on public.route_points ("routeId", "recordedAt");

-- ------------------------------------------------------------
-- 3. vehicle_positions — última posición conocida por unidad
-- ------------------------------------------------------------
create table if not exists public.vehicle_positions (
  "vehicleId" bigint primary key references public.vehicles (id),
  "companyId" bigint not null references public.companies (id),
  "routeId" bigint references public.routes (id),
  lat double precision not null,
  lng double precision not null,
  speed numeric,
  heading numeric,
  accuracy numeric,
  source text not null default 'phone',
  "recordedAt" timestamptz not null default now()
);

alter table public.vehicle_positions enable row level security;

drop policy if exists "vehicle_positions_all_own_company" on public.vehicle_positions;
create policy "vehicle_positions_all_own_company" on public.vehicle_positions
  for all to authenticated
  using ("companyId" = public.current_company_id())
  with check ("companyId" = public.current_company_id());

-- ------------------------------------------------------------
-- 4. Tiempo real: que el Mapa en Vivo reciba los cambios sin
--    tener que recargar la página.
-- ------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'vehicle_positions'
  ) then
    alter publication supabase_realtime add table public.vehicle_positions;
  end if;
end $$;

-- ============================================================
-- Listo. Verifica en Table Editor que existan "routes",
-- "route_points" y "vehicle_positions". No hace falta llenarlas
-- a mano — Modo Conductor las alimenta en cuanto alguien inicie
-- una ruta desde su celular.
-- ============================================================
