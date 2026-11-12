-- ============================================================
-- NAVIO — Migración v18: rastreo en segundo plano
-- ============================================================
-- Un navegador deja de leer el GPS cuando la pantalla se apaga o se abre otra
-- app. Para que el viaje siga registrándose hay dos caminos, y esta migración
-- prepara la base para los dos:
--
--   1. La app Navio para Android: usa las mismas funciones de siempre
--      (start_route / track_route_points / finish_route).
--   2. Una app de rastreo aparte (Traccar Client, Android y iPhone): manda la
--      ubicación a la función "gps-ingest", que la guarda con
--      ingest_tracker_points(). Cada persona vincula su teléfono con una
--      clave que solo se muestra una vez.
--
-- Privacidad: lo que mande la app de rastreo SOLO se guarda mientras la
-- persona tiene un viaje iniciado en Navio con esa opción. Fuera de un viaje
-- se descarta; ni siquiera queda la última ubicación.
--
-- Cómo aplicarla:
--   1. Pega TODO este archivo en Supabase → SQL Editor → Run.
--   2. Crea la función "gps-ingest" en Edge Functions con el archivo
--      supabase/functions/gps-ingest/index.ts (verificación de JWT apagada).
--   3. Publica la versión nueva de la página.
-- Se puede correr más de una vez sin problema.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Con qué se registra cada ruta
-- ------------------------------------------------------------
alter table public.routes
  add column if not exists source text not null default 'phone';

alter table public.routes drop constraint if exists routes_source_check;
alter table public.routes add constraint routes_source_check check (source in ('phone', 'tracker'));

-- ------------------------------------------------------------
-- 2. Guardar puntos: la lógica común, sin revisar quién llama
-- ------------------------------------------------------------
-- Uso interno. La llaman track_route_points() (la app, que ya revisó permisos)
-- e ingest_tracker_points() (la app de rastreo, que ya revisó la clave).
create or replace function public.append_route_points(
  target_route bigint, points jsonb, sent_at timestamptz default null, point_source text default 'phone'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.routes;
  p jsonb;
  p_lat double precision;
  p_lng double precision;
  p_speed numeric;
  p_heading numeric;
  p_accuracy numeric;
  p_raw timestamptz;
  p_at timestamptz;
  clock_offset interval := coalesce(now() - sent_at, interval '0');
  last_lat double precision;
  last_lng double precision;
  last_at timestamptz;
  total numeric;
  top_speed numeric;
  added integer := 0;
  segment double precision;
  hours double precision;
begin
  select * into r from public.routes where id = target_route for update;
  if not found then
    raise exception 'Esa ruta no existe.';
  end if;
  if r.status <> 'active' then
    raise exception 'Esa ruta ya terminó.';
  end if;
  if points is null or jsonb_typeof(points) <> 'array' then
    raise exception 'Formato de puntos no válido.';
  end if;
  if jsonb_array_length(points) > 500 then
    raise exception 'Demasiados puntos en un solo envío.';
  end if;

  last_lat := r."lastLat";
  last_lng := r."lastLng";
  last_at := r."lastPointAt";
  total := coalesce(r."distanceKm", 0);
  top_speed := coalesce(r."maxSpeed", 0);

  for p in select value from jsonb_array_elements(points) order by value ->> 't' loop
    p_lat := (p ->> 'lat')::double precision;
    p_lng := (p ->> 'lng')::double precision;
    continue when p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180;
    p_speed := nullif(p ->> 'speed', '')::numeric;
    p_heading := nullif(p ->> 'heading', '')::numeric;
    p_accuracy := nullif(p ->> 'accuracy', '')::numeric;
    -- La hora la pone el teléfono. Para guardarla se corrige con su reloj y
    -- se acota al viaje; la distancia usa la diferencia entre puntos, que no
    -- depende de que el reloj esté bien puesto.
    p_raw := coalesce((p ->> 't')::timestamptz, now() - clock_offset);
    p_at := least(greatest(p_raw + clock_offset, r."startedAt" - interval '5 minutes'), now() + interval '1 minute');

    insert into public.route_points ("routeId", "companyId", lat, lng, speed, heading, accuracy, source, "recordedAt")
    values (r.id, r."companyId", p_lat, p_lng, p_speed, p_heading, p_accuracy, point_source, p_at);
    added := added + 1;

    if p_speed is not null and p_speed between 0 and 250 then
      top_speed := greatest(top_speed, p_speed);
    end if;

    -- Puntos imprecisos se guardan, pero no cuentan para la distancia.
    continue when coalesce(p_accuracy, 0) > 150;
    if last_lat is null then
      last_lat := p_lat;
      last_lng := p_lng;
      last_at := p_raw;
    else
      segment := public.haversine_km(last_lat, last_lng, p_lat, p_lng);
      hours := extract(epoch from (p_raw - last_at)) / 3600.0;
      -- Menos de 10 m es ruido del GPS con la unidad detenida; más de
      -- 200 km/h entre dos puntos es un salto falso de la señal.
      if segment >= 0.01 and hours > 0 and segment / hours <= 200 then
        total := total + segment;
        last_lat := p_lat;
        last_lng := p_lng;
        last_at := p_raw;
      end if;
    end if;
  end loop;

  if added > 0 then
    update public.routes
    set "distanceKm" = round(total, 3), "pointCount" = coalesce("pointCount", 0) + added, "maxSpeed" = top_speed,
        "lastLat" = last_lat, "lastLng" = last_lng, "lastPointAt" = last_at
    where id = r.id;

    insert into public.vehicle_positions ("vehicleId", "companyId", "routeId", lat, lng, speed, heading, accuracy, source, "recordedAt")
    select r."vehicleId", r."companyId", r.id, rp.lat, rp.lng, rp.speed, rp.heading, rp.accuracy, point_source, rp."recordedAt"
    from public.route_points rp
    where rp."routeId" = r.id
    order by rp."recordedAt" desc, rp.id desc
    limit 1
    on conflict ("vehicleId") do update
    set "companyId" = excluded."companyId", "routeId" = excluded."routeId", lat = excluded.lat, lng = excluded.lng,
        speed = excluded.speed, heading = excluded.heading, accuracy = excluded.accuracy, source = excluded.source,
        "recordedAt" = excluded."recordedAt"
    where public.vehicle_positions."recordedAt" <= excluded."recordedAt";
  end if;

  return jsonb_build_object(
    'distanceKm', round(total, 3),
    'pointCount', coalesce(r."pointCount", 0) + added,
    'maxSpeed', top_speed
  );
end;
$$;
revoke all on function public.append_route_points(bigint, jsonb, timestamptz, text) from public, anon, authenticated;

-- La app: revisa que la ruta sea de quien llama y guarda.
create or replace function public.track_route_points(target_route bigint, points jsonb, sent_at timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  my_company bigint := public.current_company_id();
  r public.routes;
begin
  if me is null or my_company is null then
    raise exception 'Tu sesión no pertenece a una empresa activa.';
  end if;
  select * into r from public.routes where id = target_route and "companyId" = my_company;
  if not found then
    raise exception 'Esa ruta no pertenece a tu empresa.';
  end if;
  if r.status <> 'active' then
    raise exception 'Esa ruta ya terminó.';
  end if;
  if r."createdBy" is distinct from me and not public.is_company_admin() then
    raise exception 'Solo quien inició la ruta puede registrar su recorrido.';
  end if;
  return public.append_route_points(target_route, points, sent_at, 'phone');
end;
$$;
revoke all on function public.track_route_points(bigint, jsonb, timestamptz) from public, anon;
grant execute on function public.track_route_points(bigint, jsonb, timestamptz) to authenticated;

-- ------------------------------------------------------------
-- 3. Iniciar un viaje indicando con qué se registra
-- ------------------------------------------------------------
-- 'phone'   → este teléfono (la app Navio o la página abierta).
-- 'tracker' → la app de rastreo vinculada, en segundo plano.
drop function if exists public.start_route(bigint, bigint);
create or replace function public.start_route(target_vehicle bigint, target_trip bigint default null, route_source text default 'phone')
returns public.routes
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  my_company bigint := public.current_company_id();
  trip public.trips;
  stale bigint;
  created public.routes;
begin
  if me is null or my_company is null then
    raise exception 'Tu sesión no pertenece a una empresa activa.';
  end if;
  if route_source not in ('phone', 'tracker') then
    raise exception 'Forma de registro no válida.';
  end if;
  if route_source = 'tracker' and not exists (select 1 from public.tracker_devices where "userId" = me and "companyId" = my_company) then
    raise exception 'Primero vincula tu app de rastreo en Cuenta → Rastreo.';
  end if;
  if not exists (select 1 from public.vehicles where id = target_vehicle and "companyId" = my_company) then
    raise exception 'Esa unidad no pertenece a tu empresa.';
  end if;
  if target_trip is not null then
    select * into trip from public.trips where id = target_trip and "companyId" = my_company;
    if not found then
      raise exception 'Ese traslado no pertenece a tu empresa.';
    end if;
    if trip.status in ('completed', 'cancelled') then
      raise exception 'Ese traslado ya está cerrado.';
    end if;
  end if;

  -- Cada quien lleva una sola ruta a la vez: las que dejó abiertas se cierran
  -- sin dar por terminado su traslado.
  for stale in select id from public.routes where "createdBy" = me and status = 'active' loop
    perform public.close_route(stale, false);
  end loop;

  insert into public.routes ("companyId", "vehicleId", "driverName", status, "createdBy", "tripId", source)
  values (my_company, target_vehicle, (select "fullName" from public.profiles where id = me), 'active', me, target_trip, route_source)
  returning * into created;

  if target_trip is not null then
    update public.trips
    set status = 'ongoing', "startedAt" = coalesce("startedAt", now()), "routeId" = created.id, "vehicleId" = target_vehicle
    where id = target_trip;
  end if;
  return created;
end;
$$;

-- ------------------------------------------------------------
-- 4. Teléfonos vinculados con la app de rastreo
-- ------------------------------------------------------------
-- Uno por persona. De la clave solo se guarda su huella: si alguien leyera
-- esta tabla, no podría hacerse pasar por el teléfono.
create table if not exists public.tracker_devices (
  id bigint generated always as identity primary key,
  "companyId" bigint not null references public.companies (id) on delete cascade,
  "userId" uuid not null unique references auth.users (id) on delete cascade,
  "tokenHash" text not null unique,
  "createdAt" timestamptz not null default now(),
  "lastSeenAt" timestamptz
);

alter table public.tracker_devices enable row level security;

-- Cada quien ve solo el suyo. Sin políticas de escritura: se maneja con las
-- funciones de abajo.
drop policy if exists "tracker_devices_select_own" on public.tracker_devices;
create policy "tracker_devices_select_own" on public.tracker_devices
  for select to authenticated using ("userId" = auth.uid());

revoke all on public.tracker_devices from anon;
revoke insert, update, delete on public.tracker_devices from authenticated;

-- start_route ya puede consultar la tabla: se le dan sus permisos ahora.
revoke all on function public.start_route(bigint, bigint, text) from public, anon;
grant execute on function public.start_route(bigint, bigint, text) to authenticated;

-- Vincula (o vuelve a vincular) el teléfono de quien llama. Devuelve la clave
-- una sola vez; la anterior deja de servir.
create or replace function public.pair_tracker_device()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  my_company bigint := public.current_company_id();
  token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  hash text := encode(sha256(convert_to(token, 'UTF8')), 'hex');
begin
  if me is null or my_company is null then
    raise exception 'Tu sesión no pertenece a una empresa activa.';
  end if;
  insert into public.tracker_devices ("companyId", "userId", "tokenHash")
  values (my_company, me, hash)
  on conflict ("userId") do update
  set "companyId" = excluded."companyId", "tokenHash" = excluded."tokenHash", "createdAt" = now(), "lastSeenAt" = null;
  return token;
end;
$$;
revoke all on function public.pair_tracker_device() from public, anon;
grant execute on function public.pair_tracker_device() to authenticated;

create or replace function public.unpair_tracker_device()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.tracker_devices where "userId" = auth.uid();
$$;
revoke all on function public.unpair_tracker_device() from public, anon;
grant execute on function public.unpair_tracker_device() to authenticated;

-- Quien sale de una empresa (o cambia a otra) pierde el vínculo.
create or replace function public.drop_tracker_on_company_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new."companyId" is distinct from old."companyId" then
    delete from public.tracker_devices where "userId" = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists drop_tracker_on_company_change_trigger on public.profiles;
create trigger drop_tracker_on_company_change_trigger
  after update of "companyId" on public.profiles
  for each row execute function public.drop_tracker_on_company_change();

-- ------------------------------------------------------------
-- 5. Recibir lo que manda la app de rastreo
-- ------------------------------------------------------------
-- Solo la llama la función "gps-ingest" con la llave de servicio. Devuelve:
--   unknown  → la clave no existe (teléfono mal configurado o desvinculado)
--   inactive → la persona ya no está en una empresa activa
--   idle     → no tiene un viaje en curso con la app de rastreo: se descarta
--   tracking → se guardó en su viaje
create or replace function public.ingest_tracker_points(device_token text, points jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  device public.tracker_devices;
  target public.routes;
  kept jsonb;
  result jsonb;
begin
  if device_token is null or char_length(device_token) < 32 then
    return jsonb_build_object('status', 'unknown');
  end if;
  update public.tracker_devices set "lastSeenAt" = now()
  where "tokenHash" = encode(sha256(convert_to(device_token, 'UTF8')), 'hex')
  returning * into device;
  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;

  if not exists (
    select 1 from public.profiles p
    join public.companies c on c.id = p."companyId"
    where p.id = device."userId" and p."companyId" = device."companyId" and c.status = 'approved'
  ) then
    return jsonb_build_object('status', 'inactive');
  end if;

  select * into target from public.routes
  where "createdBy" = device."userId" and "companyId" = device."companyId" and status = 'active' and source = 'tracker'
  order by "startedAt" desc
  limit 1;
  if not found then
    return jsonb_build_object('status', 'idle');
  end if;

  -- Lo que el teléfono tenía guardado de antes del viaje no entra.
  select coalesce(jsonb_agg(value), '[]'::jsonb) into kept
  from jsonb_array_elements(case when jsonb_typeof(points) = 'array' then points else '[]'::jsonb end)
  where (value ->> 't') is null or (value ->> 't')::timestamptz >= target."startedAt" - interval '1 minute';
  if jsonb_array_length(kept) = 0 then
    return jsonb_build_object('status', 'tracking', 'routeId', target.id, 'pointCount', coalesce(target."pointCount", 0));
  end if;

  result := public.append_route_points(target.id, kept, null, 'tracker');
  return result || jsonb_build_object('status', 'tracking', 'routeId', target.id);
end;
$$;
revoke all on function public.ingest_tracker_points(text, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_tracker_points(text, jsonb) to service_role;

-- Bitácora: vincular o desvincular un teléfono queda registrado (sin la clave).
create or replace function public.audit_tracker_device()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.write_audit(old."companyId", 'delete', 'tracker_devices', old.id::text, 'Teléfono de rastreo desvinculado');
  else
    perform public.write_audit(new."companyId", lower(tg_op), 'tracker_devices', new.id::text, 'Teléfono de rastreo vinculado');
  end if;
  return null;
end;
$$;

drop trigger if exists audit_tracker_devices on public.tracker_devices;
create trigger audit_tracker_devices
  after insert or delete or update of "tokenHash" on public.tracker_devices
  for each row execute function public.audit_tracker_device();

-- ============================================================
-- Listo. Falta crear la función "gps-ingest" en Edge Functions.
-- ============================================================
