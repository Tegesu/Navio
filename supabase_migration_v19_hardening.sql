-- ============================================================
-- NAVIO — Migración v19: refuerzo de seguridad
-- ============================================================
-- Qué hace:
--   1. Sin sesión no se puede leer, escribir ni ejecutar nada en la base
--      (la llave pública queda inútil para quien no inició sesión).
--   2. Campos que la app no debe poder cambiar quedan bloqueados (autor,
--      origen, empresa, fechas de creación, distancia de un viaje…). Las
--      rutas y posiciones de las unidades solo se escriben por el servidor.
--   3. Límites de tamaño y de rango en los datos que se guardan.
--   4. Límite de envíos por persona (mensajes, tareas, registros, archivos,
--      alertas…) y por teléfono de rastreo; el bot también lo usa.
--   5. Archivos: solo en la carpeta de la empresa, con nombre generado por
--      Navio y extensión PDF/JPG/PNG/WEBP.
--   6. La comunidad solo la ven personas de una empresa activa.
--
-- Cómo aplicarla: pega TODO este archivo en Supabase → SQL Editor → Run.
-- Se puede correr más de una vez. Después: redesplegar las funciones
-- "telegram-webhook" y "gps-ingest", y publicar la página.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Límite de envíos
-- ------------------------------------------------------------
create table if not exists public.rate_limits (
  bucket text not null,
  subject text not null,
  "windowStart" timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, subject, "windowStart")
);
alter table public.rate_limits enable row level security;
-- Sin políticas: solo la usan las funciones de abajo.
revoke all on public.rate_limits from anon, authenticated;

-- Cuenta un intento en una ventana fija; si se pasa del máximo, detiene la
-- operación con el mensaje indicado (y el intento no se cuenta).
create or replace function public.hit_rate_limit(limit_bucket text, limit_subject text, max_hits integer, per_window interval, message text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  seconds double precision := extract(epoch from per_window);
  window_start timestamptz := to_timestamp(floor(extract(epoch from now()) / seconds) * seconds);
  current_hits integer;
begin
  insert into public.rate_limits as r (bucket, subject, "windowStart", hits)
  values (limit_bucket, limit_subject, window_start, 1)
  on conflict (bucket, subject, "windowStart") do update set hits = r.hits + 1
  returning r.hits into current_hits;
  if current_hits > max_hits then
    raise exception '%', message using errcode = 'P0429';
  end if;
  -- Limpieza de ventanas viejas, de vez en cuando.
  if random() < 0.01 then
    delete from public.rate_limits where "windowStart" < now() - interval '2 days';
  end if;
end;
$$;
revoke all on function public.hit_rate_limit(text, text, integer, interval, text) from public, anon, authenticated;
grant execute on function public.hit_rate_limit(text, text, integer, interval, text) to service_role;

-- Disparador genérico: limita cuántas filas crea cada persona.
-- Argumentos: bucket, máximo, ventana, mensaje.
create or replace function public.limit_inserts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new; -- bot, servidor o SQL Editor
  end if;
  perform public.hit_rate_limit(tg_argv[0], auth.uid()::text, tg_argv[1]::integer, tg_argv[2]::interval, tg_argv[3]);
  return new;
end;
$$;

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('chat_messages', 'chat', 30, '1 minute', 'Estás enviando mensajes muy seguido. Espera un momento.'),
      ('tasks', 'tasks', 60, '1 hour', 'Llegaste al límite de tareas nuevas por hora. Intenta más tarde.'),
      ('community_posts', 'community', 10, '1 day', 'Llegaste al límite de publicaciones por día.'),
      ('community_votes', 'votes', 120, '1 hour', 'Demasiados votos seguidos. Intenta más tarde.'),
      ('privacy_requests', 'privacy', 5, '1 day', 'Llegaste al límite de solicitudes por día. Si es urgente, escríbenos.'),
      ('incidents', 'incidents', 60, '1 hour', 'Llegaste al límite de incidencias por hora. Intenta más tarde.'),
      ('trips', 'trips', 120, '1 hour', 'Llegaste al límite de traslados nuevos por hora. Intenta más tarde.'),
      ('warranties', 'warranties', 100, '1 hour', 'Llegaste al límite de garantías nuevas por hora. Intenta más tarde.'),
      ('user_reminders', 'reminders', 120, '1 hour', 'Demasiados recordatorios seguidos. Intenta más tarde.'),
      ('fuel_records', 'records', 300, '1 hour', 'Llegaste al límite de registros por hora. Intenta más tarde.'),
      ('travel_expenses', 'records', 300, '1 hour', 'Llegaste al límite de registros por hora. Intenta más tarde.'),
      ('misc_expenses', 'records', 300, '1 hour', 'Llegaste al límite de registros por hora. Intenta más tarde.'),
      ('maintenance_records', 'records', 300, '1 hour', 'Llegaste al límite de registros por hora. Intenta más tarde.'),
      ('compliance_records', 'records', 300, '1 hour', 'Llegaste al límite de registros por hora. Intenta más tarde.'),
      ('companies', 'company_request', 3, '1 day', 'Llegaste al límite de solicitudes de empresa por día.')
    ) as v(tbl, bucket, max_hits, per_window, message)
  loop
    execute format('drop trigger if exists limit_inserts_trigger on public.%I', r.tbl);
    execute format(
      'create trigger limit_inserts_trigger before insert on public.%I for each row execute function public.limit_inserts(%L, %L, %L, %L)',
      r.tbl, r.bucket, r.max_hits, r.per_window, r.message
    );
  end loop;
end;
$$;

-- Alertas: se cuentan al registrarlas en la bitácora (una por envío).
drop trigger if exists limit_alerts_trigger on public.audit_log;
create trigger limit_alerts_trigger
  before insert on public.audit_log
  for each row when (new.action = 'alert')
  execute function public.limit_inserts('alerts', '30', '1 hour', 'Llegaste al límite de alertas por hora. Intenta más tarde.');

-- Vincular el teléfono de rastreo y regenerar códigos. (Volver a vincular
-- también pasa por "insert": se cuenta una vez por intento.)
drop trigger if exists limit_tracker_pairing on public.tracker_devices;
create trigger limit_tracker_pairing
  before insert on public.tracker_devices
  for each row execute function public.limit_inserts('tracker_pair', '10', '1 hour', 'Demasiados intentos de vinculación. Intenta en una hora.');

drop trigger if exists limit_code_rotation on public.company_secrets;
create trigger limit_code_rotation
  before update on public.company_secrets
  for each row execute function public.limit_inserts('codes', '20', '1 hour', 'Demasiados cambios de código. Intenta en una hora.');

-- App de rastreo: cada envío actualiza "lastSeenAt" de su teléfono. Como
-- mucho 1200 envíos cada 10 minutos (2 por segundo); si se pasa, el envío
-- falla y la app lo reintenta después, sin perder la ubicación.
create or replace function public.limit_tracker_ingest()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.hit_rate_limit('tracker_ingest', new.id::text, 1200, interval '10 minutes', 'Demasiados envíos del teléfono de rastreo.');
  return new;
end;
$$;

drop trigger if exists limit_tracker_ingest_trigger on public.tracker_devices;
create trigger limit_tracker_ingest_trigger
  before update of "lastSeenAt" on public.tracker_devices
  for each row execute function public.limit_tracker_ingest();

-- ------------------------------------------------------------
-- 2. Campos que la app no puede cambiar
-- ------------------------------------------------------------
-- Solo frena a la app (rol "authenticated"). Las funciones del servidor
-- (que corren como dueño de la base), el bot y el SQL Editor pasan.
-- Argumentos: los nombres de las columnas que se conservan.
create or replace function public.lock_columns()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  kept jsonb;
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  select jsonb_object_agg(col, to_jsonb(old) -> col) into kept
  from unnest(tg_argv) as col
  where to_jsonb(old) ? col;
  if kept is not null then
    new := jsonb_populate_record(new, kept);
  end if;
  return new;
end;
$$;

-- Al crear desde la app se sellan los campos indicados en los argumentos:
--   createdBy → quien tiene la sesión
--   origin    → "manual" (solo el bot registra con origen "telegram"; en
--               los registros, "origin" es la fuente, no un lugar)
--   createdAt → ahora
create or replace function public.stamp_client_insert()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  stamped jsonb := '{}'::jsonb;
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if 'createdBy' = any (tg_argv) then
    stamped := stamped || jsonb_build_object('createdBy', auth.uid());
  end if;
  if 'origin' = any (tg_argv) then
    stamped := stamped || jsonb_build_object('origin', 'manual');
  end if;
  if 'createdAt' = any (tg_argv) then
    stamped := stamped || jsonb_build_object('createdAt', now());
  end if;
  new := jsonb_populate_record(new, stamped);
  return new;
end;
$$;

do $$
declare
  r record;
begin
  -- "a_" adelante: corren antes que los demás disparadores de la tabla.
  -- tbl, columnas que no cambian al editar, columnas que se sellan al crear
  for r in
    select * from (values
      ('fuel_records', array['id', 'companyId', 'createdAt', 'createdBy', 'origin', 'uploadedByName'], array['createdBy', 'origin', 'createdAt']),
      ('travel_expenses', array['id', 'companyId', 'createdAt', 'createdBy', 'origin', 'uploadedByName'], array['createdBy', 'origin', 'createdAt']),
      ('misc_expenses', array['id', 'companyId', 'createdAt', 'createdBy', 'origin', 'uploadedByName'], array['createdBy', 'origin', 'createdAt']),
      ('maintenance_records', array['id', 'companyId', 'createdAt', 'origin'], array['origin', 'createdAt']),
      ('compliance_records', array['id', 'companyId', 'createdAt', 'origin'], array['origin', 'createdAt']),
      ('incidents', array['id', 'companyId', 'createdAt', 'reportedBy'], array['createdAt']),
      -- En traslados, "origin" es el lugar de salida: se puede editar.
      ('trips', array['id', 'companyId', 'createdAt', 'routeId', 'distanceKm'], array['createdAt']),
      ('vehicles', array['id', 'companyId', 'createdAt'], array[]::text[]),
      ('warranties', array['id', 'companyId', 'createdAt', 'createdBy'], array['createdBy', 'createdAt']),
      ('work_orders', array['id', 'companyId', 'createdAt', 'createdBy'], array['createdBy', 'createdAt']),
      ('user_reminders', array['id', 'userId', 'createdAt'], array['createdAt']),
      ('profiles', array['id', 'role', 'createdAt'], array[]::text[]),
      ('companies', array['id', 'createdAt'], array[]::text[])
    ) as v(tbl, locked, stamped)
  loop
    execute format('drop trigger if exists a_lock_columns on public.%I', r.tbl);
    execute format(
      'create trigger a_lock_columns before update on public.%I for each row execute function public.lock_columns(%s)',
      r.tbl, (select string_agg(quote_literal(c), ', ') from unnest(r.locked) c)
    );
    execute format('drop trigger if exists a_stamp_client_insert on public.%I', r.tbl);
    if cardinality(r.stamped) > 0 then
      execute format(
        'create trigger a_stamp_client_insert before insert on public.%I for each row execute function public.stamp_client_insert(%s)',
        r.tbl, (select string_agg(quote_literal(c), ', ') from unnest(r.stamped) c)
      );
    end if;
  end loop;
end;
$$;

-- Rutas, puntos del recorrido y última posición: solo los escriben las
-- funciones del servidor (iniciar, registrar y terminar un viaje). Así nadie
-- puede inventar dónde estuvo una unidad.
do $$
declare
  p record;
begin
  for p in
    select tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in ('routes', 'route_points', 'vehicle_positions') and cmd <> 'SELECT'
  loop
    execute format('drop policy if exists %I on public.%I', p.policyname, p.tablename);
  end loop;
end;
$$;
revoke insert, update, delete on public.routes, public.route_points, public.vehicle_positions from authenticated;

-- ------------------------------------------------------------
-- 3. Tamaños y rangos válidos
-- ------------------------------------------------------------
-- "not valid": aplica a lo que se cree o modifique desde ahora, sin revisar
-- (ni bloquear) los datos que ya existen.
do $$
declare
  r record;
  text_limits constant jsonb := '{
    "unit": 100, "plate": 30, "vendor": 300, "station": 300, "invoiceFolio": 100, "concept": 500, "notes": 4000,
    "documentUrl": 500, "project": 200, "workOrder": 100, "expenseType": 60, "origin": 30, "status": 30,
    "statusReason": 1000, "uploadedByName": 200, "approvedByName": 200, "driverName": 200, "docType": 100,
    "paymentStatus": 60, "category": 60
  }';
  record_tables constant text[] := array['fuel_records', 'travel_expenses', 'misc_expenses', 'maintenance_records', 'compliance_records'];
  t text;
  col text;
begin
  create temporary table navio_checks (tbl text, name text, expr text) on commit drop;

  foreach t in array record_tables loop
    for col in select jsonb_object_keys(text_limits) loop
      insert into navio_checks values (t, t || '_' || lower(col) || '_len', format('char_length(%I) <= %s', col, text_limits ->> col));
    end loop;
    insert into navio_checks values
      (t, t || '_amount_range', 'amount is null or abs(amount) < 10000000000'),
      (t, t || '_cfdi_size', 'cfdi is null or octet_length(cfdi::text) <= 300000'),
      (t, t || '_details_size', 'details is null or octet_length(details::text) <= 50000');
  end loop;

  insert into navio_checks values
    ('fuel_records', 'fuel_records_liters_range', 'liters is null or (liters >= 0 and liters <= 1000000)'),
    ('fuel_records', 'fuel_records_odometer_range', 'odometer is null or (odometer >= 0 and odometer <= 100000000)'),
    ('fuel_records', 'fuel_records_efficiency_range', 'efficiency is null or (efficiency >= 0 and efficiency <= 10000)'),

    ('trips', 'trips_unit_len', 'char_length(unit) <= 100'),
    ('trips', 'trips_driver_len', 'char_length(driver) <= 200'),
    ('trips', 'trips_triptype_len', 'char_length("tripType") <= 60'),
    ('trips', 'trips_origin_len', 'char_length(origin) <= 300'),
    ('trips', 'trips_destination_len', 'char_length(destination) <= 300'),
    ('trips', 'trips_cargo_len', 'char_length(cargo) <= 500'),
    ('trips', 'trips_status_len', 'char_length(status) <= 30'),
    ('trips', 'trips_project_len', 'char_length(project) <= 200'),
    ('trips', 'trips_workorder_len', 'char_length("workOrder") <= 100'),
    ('trips', 'trips_notes_len', 'char_length(notes) <= 4000'),
    ('trips', 'trips_distance_range', '"distanceKm" is null or ("distanceKm" >= 0 and "distanceKm" <= 100000)'),

    ('incidents', 'incidents_unit_len', 'char_length(unit) <= 100'),
    ('incidents', 'incidents_severity_len', 'char_length(severity) <= 30'),
    ('incidents', 'incidents_status_len', 'char_length(status) <= 30'),
    ('incidents', 'incidents_description_len', 'char_length(description) <= 4000'),
    ('incidents', 'incidents_reportedby_len', 'char_length("reportedBy") <= 200'),

    ('vehicles', 'vehicles_unit_len', 'char_length(unit) <= 100'),
    ('vehicles', 'vehicles_plate_len', 'char_length(plate) <= 30'),
    ('vehicles', 'vehicles_brand_len', 'char_length(brand) <= 100'),
    ('vehicles', 'vehicles_model_len', 'char_length(model) <= 100'),
    ('vehicles', 'vehicles_color_len', 'char_length(color) <= 60'),
    ('vehicles', 'vehicles_photo_len', 'char_length(photo) <= 500'),
    ('vehicles', 'vehicles_oiltype_len', 'char_length("oilType") <= 100'),
    ('vehicles', 'vehicles_year_range', 'year is null or (year >= 1900 and year <= 2100)'),
    ('vehicles', 'vehicles_km_range', '"kmActual" is null or ("kmActual" >= 0 and "kmActual" <= 100000000)'),
    ('vehicles', 'vehicles_next_km_range', '"kmProximoServicio" is null or ("kmProximoServicio" >= 0 and "kmProximoServicio" <= 100000000)'),
    ('vehicles', 'vehicles_json_size', 'octet_length(coalesce(driver::text, '''') || coalesce(insurance::text, '''') || coalesce("circulationCard"::text, '''') || coalesce(verification::text, '''') || coalesce(warranty::text, '''') || coalesce("documentHistory"::text, '''') || coalesce("maintenancePanel"::text, '''') || coalesce(tires::text, '''') || coalesce(history::text, '''') || coalesce(gps::text, '''') || coalesce("appCapture"::text, '''')) <= 500000'),

    ('warranties', 'warranties_unit_len', 'char_length(unit) <= 100'),
    ('warranties', 'warranties_vendor_len', 'char_length(vendor) <= 300'),
    ('warranties', 'warranties_folio_len', 'char_length("invoiceFolio") <= 100'),
    ('warranties', 'warranties_document_len', 'char_length("documentUrl") <= 500'),
    ('warranties', 'warranties_notes_len', 'char_length(notes) <= 2000'),
    ('warranties', 'warranties_claim_len', 'char_length("claimNotes") <= 2000'),
    ('warranties', 'warranties_km_range', '("kmStart" is null or "kmStart" between 0 and 100000000) and ("kmLimit" is null or "kmLimit" between 0 and 100000000)'),

    ('tasks', 'tasks_description_len', 'char_length(description) <= 4000'),
    ('tasks', 'tasks_related_len', 'char_length("relatedType") <= 60 and char_length("relatedLabel") <= 300'),
    ('work_orders', 'work_orders_len', 'char_length(project) <= 200 and char_length(code) <= 100'),
    ('project_settings', 'project_settings_len', 'char_length(project) <= 200'),
    ('user_reminders', 'user_reminders_len', 'char_length(text) <= 1000'),
    ('community_posts', 'community_posts_len', 'char_length(title) <= 200 and char_length(description) <= 4000 and char_length(category) <= 60 and char_length(author) <= 200'),
    ('chat_channels', 'chat_channels_name_len', 'char_length(name) <= 100'),
    ('notifications', 'notifications_len', 'char_length(title) <= 500 and char_length(body) <= 5000 and (link is null or octet_length(link::text) <= 2000)'),
    ('legal_acceptances', 'legal_acceptances_len', 'char_length(version) <= 40 and char_length("userAgent") <= 1000'),
    ('privacy_requests', 'privacy_requests_response_len', 'char_length(response) <= 4000'),

    ('companies', 'companies_name_len', 'char_length(name) <= 200'),
    ('companies', 'companies_contact_len', 'char_length("contactName") <= 200 and char_length("contactEmail") <= 254 and char_length("contactPhone") <= 40'),
    ('companies', 'companies_details_len', 'char_length(industry) <= 100 and char_length("fleetSize") <= 60 and char_length(needs) <= 2000 and char_length("legalName") <= 300 and char_length(rfc) <= 20 and char_length(address) <= 500 and char_length(currency) <= 10'),
    ('companies', 'companies_settings_size', 'settings is null or octet_length(settings::text) <= 20000'),

    ('profiles', 'profiles_len', 'char_length("fullName") <= 200 and char_length(phone) <= 40 and char_length("jobTitle") <= 120'),
    ('profiles', 'profiles_preferences_size', 'preferences is null or octet_length(preferences::text) <= 10000');

  for r in select * from navio_checks loop
    begin
      if not exists (select 1 from pg_constraint where conname = r.name and conrelid = format('public.%I', r.tbl)::regclass) then
        execute format('alter table public.%I add constraint %I check (%s) not valid', r.tbl, r.name, r.expr);
      end if;
    exception when undefined_column or undefined_table or undefined_function then
      raise notice 'Se omite %: %', r.name, sqlerrm;
    end;
  end loop;
end;
$$;

-- ------------------------------------------------------------
-- 4. Archivos
-- ------------------------------------------------------------
-- Tipos y tamaño máximo del almacén (se repite por si alguien lo cambió).
update storage.buckets
set public = false,
    allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
    file_size_limit = 20971520
where id = 'documents';

-- Hasta 200 archivos por hora por persona. Se llama desde la regla de
-- subida: si se pasa, la regla no deja subir.
create or replace function public.allow_upload()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return false;
  end if;
  begin
    perform public.hit_rate_limit('uploads', auth.uid()::text, 200, interval '1 hour', 'Demasiados archivos.');
  exception when others then
    return false;
  end;
  return true;
end;
$$;
revoke all on function public.allow_upload() from public, anon;
grant execute on function public.allow_upload() to authenticated;

-- Solo en la carpeta de la empresa, en una de las carpetas de Navio, con el
-- nombre que genera la app (un identificador al azar) y extensión válida.
drop policy if exists "documents_insert_own_company" on storage.objects;
create policy "documents_insert_own_company" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_company_id()::text
    and name ~ '^[0-9]+/(fuel|travel|misc|maintenance|compliance|vehicles|warranties)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png|webp)$'
    and public.allow_upload()
  );

-- ------------------------------------------------------------
-- 5. Comunidad: solo personas de una empresa activa
-- ------------------------------------------------------------
drop policy if exists "community_posts_select" on public.community_posts;
create policy "community_posts_select" on public.community_posts
  for select to authenticated
  using (public.current_company_id() is not null or public.is_super_admin());

-- ------------------------------------------------------------
-- 6. Sin sesión, nada
-- ------------------------------------------------------------
-- La llave pública (anon) sigue sirviendo para iniciar sesión, pero sin
-- sesión ya no da acceso a ninguna tabla ni función. Las funciones que la
-- app usa con sesión conservan exactamente el permiso que tenían.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from public, anon;

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig,
           has_function_privilege('authenticated', p.oid, 'execute') as for_app,
           has_function_privilege('service_role', p.oid, 'execute') as for_server
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.proowner = (select oid from pg_roles where rolname = current_user)
      -- Las de extensiones (si alguna quedó en "public") no se tocan.
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    if f.for_app then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
    if f.for_server then
      execute format('grant execute on function %s to service_role', f.sig);
    end if;
  end loop;
end;
$$;

-- ============================================================
-- Listo. Falta redesplegar "telegram-webhook" y "gps-ingest".
-- ============================================================
