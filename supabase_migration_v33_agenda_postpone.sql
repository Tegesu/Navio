-- ============================================================
-- NAVIO — Migración v33: posponer y cancelar eventos de la agenda
-- ============================================================
-- Qué hace:
--   - Quien organiza un evento, o un administrador de la empresa que lo
--     puede ver, lo puede posponer o cancelar. Se les avisa a quienes
--     participan (y a quien organiza, si lo hizo un administrador).
--   - En los eventos que se repiten se puede posponer o cancelar SOLO una
--     vez (las demás repeticiones siguen igual).
--
-- Cómo aplicarla: pega TODO este archivo en Supabase → SQL Editor → Run.
-- Va DESPUÉS de la v32. Se puede correr más de una vez.
-- ============================================================

-- Las veces de un evento que se repite que se cancelaron o se movieron.
alter table public.agenda_events add column if not exists skipped timestamptz[] not null default '{}';

-- Quién puede cambiar, posponer o cancelar un evento.
create or replace function public.can_manage_agenda_event(target_event bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.agenda_events e
    where e.id = target_event
      and e."companyId" = public.current_company_id()
      and (e."createdBy" = auth.uid() or (public.is_company_admin() and public.can_see_agenda_event(e.id)))
  );
$$;
revoke all on function public.can_manage_agenda_event(bigint) from public, anon;
grant execute on function public.can_manage_agenda_event(bigint) to authenticated;

create or replace function public.agenda_occurrences(e public.agenda_events, from_ts timestamptz, to_ts timestamptz)
returns setof timestamptz
language plpgsql
stable
set search_path = public
as $$
declare
  step interval;
  occ timestamptz;
  n integer;
  guard integer := 0;
begin
  if e.recurrence = 'none' then
    if e."startsAt" >= from_ts and e."startsAt" < to_ts then
      return next e."startsAt";
    end if;
    return;
  end if;
  step := case e.recurrence
    when 'daily' then interval '1 day'
    when 'weekdays' then interval '1 day'
    when 'weekly' then interval '7 days'
    when 'biweekly' then interval '14 days'
    when 'monthly' then interval '1 month'
    else interval '1 year'
  end;
  -- Se empieza cerca de "from_ts" (no desde la primera vez).
  if from_ts <= e."startsAt" then
    n := 0;
  elsif e.recurrence = 'monthly' then
    n := greatest(0, (extract(year from age(from_ts, e."startsAt")) * 12 + extract(month from age(from_ts, e."startsAt")))::integer - 1);
  elsif e.recurrence = 'yearly' then
    n := greatest(0, extract(year from age(from_ts, e."startsAt"))::integer - 1);
  else
    n := greatest(0, floor(extract(epoch from (from_ts - e."startsAt")) / extract(epoch from step))::integer - 1);
  end if;
  loop
    occ := e."startsAt" + step * n;
    exit when occ >= to_ts or (e."recurUntil" is not null and occ > e."recurUntil") or guard > 800;
    if occ >= from_ts and (e.recurrence <> 'weekdays' or extract(isodow from (occ at time zone e."timeZone")) < 6)
       and not (occ = any (coalesce(e.skipped, '{}'))) then
      return next occ;
    end if;
    n := n + 1;
    guard := guard + 1;
  end loop;
end;
$$;

create or replace function public.agenda_list(from_ts timestamptz, to_ts timestamptz)
returns table (
  id bigint, title text, kind text, description text,
  "startsAt" timestamptz, "endsAt" timestamptz, "seriesStartsAt" timestamptz, "seriesEndsAt" timestamptz,
  "allDay" boolean, "timeZone" text, location text, "channelId" bigint, "taskId" bigint,
  color text, priority text, recurrence text, "recurUntil" timestamptz, reminders integer[],
  visibility text, status text, "createdBy" uuid, "createdByName" text,
  "myResponse" text, attendees jsonb, "canEdit" boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.id, e.title, e.kind, e.description,
    o.at, o.at + (e."endsAt" - e."startsAt"), e."startsAt", e."endsAt",
    e."allDay", e."timeZone", e.location, e."channelId", e."taskId",
    e.color, e.priority, e.recurrence, e."recurUntil", e.reminders,
    e.visibility, e.status, e."createdBy", e."createdByName",
    (select a.response from public.agenda_attendees a where a."eventId" = e.id and a."userId" = auth.uid()),
    coalesce((
      select jsonb_agg(jsonb_build_object('userId', a."userId", 'name', p."fullName", 'response', a.response) order by p."fullName")
      from public.agenda_attendees a join public.profiles p on p.id = a."userId"
      where a."eventId" = e.id
    ), '[]'::jsonb),
    public.can_manage_agenda_event(e.id)
  from public.agenda_events e
  cross join lateral public.agenda_occurrences(e, from_ts - coalesce(e."endsAt" - e."startsAt", interval '0'), to_ts) as o(at)
  where e."companyId" = public.current_company_id()
    and public.can_see_agenda_event(e.id)
    and to_ts > from_ts
    and to_ts - from_ts <= interval '400 days'
  order by o.at
  limit 1500;
$$;

create or replace function public.agenda_save(payload jsonb)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  company bigint := public.current_company_id();
  my_name text := (select "fullName" from public.profiles where id = auth.uid());
  target bigint;
  existing public.agenda_events;
  v_title text := left(trim(coalesce(payload ->> 'title', '')), 200);
  v_kind text := coalesce(payload ->> 'kind', 'meeting');
  v_description text := nullif(left(trim(coalesce(payload ->> 'description', '')), 4000), '');
  v_location text := nullif(left(trim(coalesce(payload ->> 'location', '')), 300), '');
  v_starts timestamptz;
  v_ends timestamptz;
  v_until timestamptz;
  v_all_day boolean := coalesce((payload ->> 'allDay')::boolean, false);
  v_tz text := coalesce(nullif(payload ->> 'timeZone', ''), 'America/Mexico_City');
  v_channel bigint;
  v_task bigint;
  v_color text := coalesce(payload ->> 'color', 'blue');
  v_priority text := coalesce(payload ->> 'priority', 'normal');
  v_recurrence text := coalesce(payload ->> 'recurrence', 'none');
  v_visibility text := coalesce(payload ->> 'visibility', 'participants');
  rem integer[];
  people uuid[];
  new_people uuid[] := '{}';
  kept_people uuid[] := '{}';
  event_id bigint;
  changed_time boolean := false;
begin
  if me is null or company is null then
    raise exception 'Tu sesión no pertenece a una empresa activa.';
  end if;
  perform public.hit_rate_limit('agenda_save', me::text, 200, interval '1 hour', 'Demasiados cambios en la agenda. Espera un momento.');
  if v_title = '' then
    raise exception 'Escribe un título.';
  end if;
  if v_kind not in ('meeting', 'review', 'task', 'reminder', 'visit', 'call', 'other') then v_kind := 'other'; end if;
  if v_color not in ('blue', 'violet', 'emerald', 'amber', 'rose', 'sky', 'slate') then v_color := 'blue'; end if;
  if v_priority not in ('low', 'normal', 'high') then v_priority := 'normal'; end if;
  if v_recurrence not in ('none', 'daily', 'weekdays', 'weekly', 'biweekly', 'monthly', 'yearly') then v_recurrence := 'none'; end if;
  if v_visibility not in ('participants', 'company') then v_visibility := 'participants'; end if;
  begin
    target := nullif(payload ->> 'id', '')::bigint;
    v_starts := (payload ->> 'startsAt')::timestamptz;
    v_ends := nullif(payload ->> 'endsAt', '')::timestamptz;
    v_until := nullif(payload ->> 'recurUntil', '')::timestamptz;
    v_channel := nullif(payload ->> 'channelId', '')::bigint;
    v_task := nullif(payload ->> 'taskId', '')::bigint;
  exception when others then
    raise exception 'Revisa las fechas del evento.';
  end;
  if v_starts is null or v_starts < now() - interval '5 years' or v_starts > now() + interval '10 years' then
    raise exception 'Elige una fecha válida.';
  end if;
  if v_ends is not null and (v_ends < v_starts or v_ends > v_starts + interval '31 days') then
    raise exception 'La hora de fin debe ser después del inicio (y en menos de 31 días).';
  end if;
  if v_recurrence = 'none' then v_until := null; end if;
  if v_until is not null and v_until < v_starts then
    raise exception 'La repetición debe terminar después del primer día.';
  end if;
  begin
    perform now() at time zone v_tz;
  exception when others then
    v_tz := 'America/Mexico_City';
  end;
  -- Avisos: minutos antes (0 a 30 días), sin repetir, hasta 6.
  begin
    select coalesce(array_agg(x order by x), '{}') into rem
    from (select distinct value::integer as x from jsonb_array_elements_text(coalesce(payload -> 'reminders', '[]'::jsonb)) where value ~ '^[0-9]{1,6}$') s
    where x between 0 and 43200;
  exception when others then
    rem := '{}';
  end;
  rem := rem[1:6];
  -- Participantes: solo personas de la misma empresa (quien crea ya está).
  begin
    select coalesce(array_agg(distinct p.id), '{}') into people
    from jsonb_array_elements_text(coalesce(payload -> 'attendees', '[]'::jsonb)) j(v)
    join public.profiles p on p.id::text = j.v and p."companyId" = company
    where p.id <> coalesce((select ev."createdBy" from public.agenda_events ev where ev.id = target), me);
  exception when others then
    people := '{}';
  end;
  if coalesce(array_length(people, 1), 0) > 50 then
    raise exception 'Máximo 50 participantes por evento.';
  end if;
  if v_channel is not null and not public.can_access_channel(v_channel) then v_channel := null; end if;
  if v_task is not null and not public.can_access_task(v_task) then v_task := null; end if;

  if target is null then
    insert into public.agenda_events (
      "companyId", "createdBy", "createdByName", title, kind, description, "startsAt", "endsAt", "allDay", "timeZone",
      location, "channelId", "taskId", color, priority, recurrence, "recurUntil", reminders, visibility
    ) values (
      company, me, my_name, v_title, v_kind, v_description, v_starts, v_ends, v_all_day, v_tz,
      v_location, v_channel, v_task, v_color, v_priority, v_recurrence, v_until, rem, v_visibility
    ) returning id into event_id;
    new_people := people;
  else
    select * into existing from public.agenda_events where id = target and "companyId" = company for update;
    if not found or not public.can_manage_agenda_event(target) then
      raise exception 'Solo quien creó el evento lo puede cambiar.';
    end if;
    changed_time := existing."startsAt" is distinct from v_starts or existing."endsAt" is distinct from v_ends
      or existing.recurrence is distinct from v_recurrence or existing."allDay" is distinct from v_all_day;
    update public.agenda_events set
      title = v_title, kind = v_kind, description = v_description, "startsAt" = v_starts, "endsAt" = v_ends,
      "allDay" = v_all_day, "timeZone" = v_tz, location = v_location, "channelId" = v_channel, "taskId" = v_task,
      color = v_color, priority = v_priority, recurrence = v_recurrence, "recurUntil" = v_until, reminders = rem,
      visibility = v_visibility, "updatedAt" = now()
    where id = target;
    event_id := target;
    select coalesce(array_agg(x), '{}') into new_people from unnest(people) x
    where not exists (select 1 from public.agenda_attendees a where a."eventId" = target and a."userId" = x);
    select coalesce(array_agg(x), '{}') into kept_people from unnest(people) x
    where exists (select 1 from public.agenda_attendees a where a."eventId" = target and a."userId" = x);
    delete from public.agenda_attendees where "eventId" = target and not ("userId" = any (people));
    if changed_time then
      update public.agenda_attendees set response = 'pending', "respondedAt" = null where "eventId" = target;
    end if;
  end if;
  insert into public.agenda_attendees ("eventId", "userId", "companyId")
  select event_id, x, company from unnest(people) x
  on conflict do nothing;

  -- Avisos a los participantes.
  insert into public.notifications ("companyId", "userId", kind, title, body, link, "createdBy", "createdByName")
  select company, x, 'agenda', left('Te agendaron: ' || v_title, 200), public.agenda_when(v_starts, v_all_day, v_tz),
         jsonb_build_object('tab', 'tasks', 'sub', 'agenda'), me, my_name
  from unnest(new_people) x;
  if changed_time then
    insert into public.notifications ("companyId", "userId", kind, title, body, link, "createdBy", "createdByName")
    select company, x, 'agenda', left('Cambió la fecha: ' || v_title, 200), public.agenda_when(v_starts, v_all_day, v_tz),
           jsonb_build_object('tab', 'tasks', 'sub', 'agenda'), me, my_name
    from unnest(kept_people) x;
    if existing."createdBy" is not null and existing."createdBy" <> me then
      insert into public.notifications ("companyId", "userId", kind, title, body, link, "createdBy", "createdByName")
      values (company, existing."createdBy", 'agenda', left('Cambió la fecha: ' || v_title, 200), public.agenda_when(v_starts, v_all_day, v_tz),
              jsonb_build_object('tab', 'tasks', 'sub', 'agenda'), me, my_name);
    end if;
  end if;
  return event_id;
end;
$$;

create or replace function public.agenda_set_status(target_event bigint, new_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  e public.agenda_events;
begin
  if new_status not in ('scheduled', 'done', 'cancelled') then
    raise exception 'Estado no válido.';
  end if;
  select * into e from public.agenda_events where id = target_event and "companyId" = public.current_company_id() for update;
  if not found or not public.can_manage_agenda_event(target_event) then
    raise exception 'Solo quien creó el evento lo puede cambiar.';
  end if;
  perform public.hit_rate_limit('agenda_save', me::text, 200, interval '1 hour', 'Demasiados cambios en la agenda. Espera un momento.');
  update public.agenda_events set status = new_status, "updatedAt" = now() where id = target_event;
  if new_status = 'cancelled' and e.status <> 'cancelled' then
    insert into public.notifications ("companyId", "userId", kind, title, body, link, "createdBy", "createdByName")
    select e."companyId", a."userId", 'agenda', left('Se canceló: ' || e.title, 200), public.agenda_when(e."startsAt", e."allDay", e."timeZone"),
           jsonb_build_object('tab', 'tasks', 'sub', 'agenda'), me, (select "fullName" from public.profiles where id = me)
    from (
      select a."userId" from public.agenda_attendees a where a."eventId" = target_event and a.response <> 'declined'
      union
      select e."createdBy"
    ) a
    where a."userId" <> me;
  end if;
end;
$$;

create or replace function public.agenda_delete(target_event bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  e public.agenda_events;
begin
  select * into e from public.agenda_events where id = target_event and "companyId" = public.current_company_id() for update;
  if not found or not public.can_manage_agenda_event(target_event) then
    raise exception 'Solo quien creó el evento lo puede borrar.';
  end if;
  if e.status = 'scheduled' and (e.recurrence <> 'none' or e."startsAt" > now()) then
    insert into public.notifications ("companyId", "userId", kind, title, body, link, "createdBy", "createdByName")
    select e."companyId", a."userId", 'agenda', left('Se canceló: ' || e.title, 200), public.agenda_when(e."startsAt", e."allDay", e."timeZone"),
           jsonb_build_object('tab', 'tasks', 'sub', 'agenda'), me, (select "fullName" from public.profiles where id = me)
    from (
      select a."userId" from public.agenda_attendees a where a."eventId" = target_event and a.response <> 'declined'
      union
      select e."createdBy"
    ) a
    where a."userId" <> me;
  end if;
  delete from public.agenda_events where id = target_event;
end;
$$;

-- Posponer: a una nueva fecha y hora. En un evento que se repite, solo esa
-- vez (se crea un evento suelto con los mismos datos y participantes).
create or replace function public.agenda_postpone(target_event bigint, occurrence timestamptz, new_start timestamptz, new_end timestamptz default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  my_name text := (select "fullName" from public.profiles where id = auth.uid());
  e public.agenda_events;
  result bigint;
  label text;
begin
  select * into e from public.agenda_events where id = target_event and "companyId" = public.current_company_id() for update;
  if not found or not public.can_manage_agenda_event(target_event) then
    raise exception 'Solo quien organiza el evento (o un administrador) lo puede posponer.';
  end if;
  perform public.hit_rate_limit('agenda_save', me::text, 200, interval '1 hour', 'Demasiados cambios en la agenda. Espera un momento.');
  if e.status <> 'scheduled' then
    raise exception 'El evento ya no está programado.';
  end if;
  if new_start is null or new_start < now() - interval '1 day' or new_start > now() + interval '10 years' then
    raise exception 'Elige una fecha válida.';
  end if;
  if new_end is not null and (new_end < new_start or new_end > new_start + interval '31 days') then
    raise exception 'La hora de fin debe ser después del inicio (y en menos de 31 días).';
  end if;

  if e.recurrence = 'none' then
    update public.agenda_events set "startsAt" = new_start, "endsAt" = new_end, "updatedAt" = now() where id = target_event;
    update public.agenda_attendees set response = 'pending', "respondedAt" = null where "eventId" = target_event;
    result := target_event;
    label := 'Se pospuso: ';
  else
    if occurrence is null or not exists (
      select 1 from public.agenda_occurrences(e, occurrence, occurrence + interval '1 second') o
    ) then
      raise exception 'Esa fecha no es una de las repeticiones del evento.';
    end if;
    update public.agenda_events set skipped = array_append(skipped, occurrence), "updatedAt" = now() where id = target_event;
    insert into public.agenda_events (
      "companyId", "createdBy", "createdByName", title, kind, description, "startsAt", "endsAt", "allDay", "timeZone",
      location, "channelId", "taskId", color, priority, recurrence, "recurUntil", reminders, visibility
    ) values (
      e."companyId", e."createdBy", e."createdByName", e.title, e.kind, e.description, new_start, new_end, e."allDay", e."timeZone",
      e.location, e."channelId", e."taskId", e.color, e.priority, 'none', null, e.reminders, e.visibility
    ) returning id into result;
    insert into public.agenda_attendees ("eventId", "userId", "companyId")
    select result, a."userId", a."companyId" from public.agenda_attendees a where a."eventId" = target_event;
    label := 'Se pospuso (solo esta vez): ';
  end if;

  insert into public.notifications ("companyId", "userId", kind, title, body, link, "createdBy", "createdByName")
  select e."companyId", a."userId", 'agenda', left(label || e.title, 200), 'Nueva fecha: ' || public.agenda_when(new_start, e."allDay", e."timeZone"),
         jsonb_build_object('tab', 'tasks', 'sub', 'agenda'), me, my_name
  from (
    select a."userId" from public.agenda_attendees a where a."eventId" = result and a.response <> 'declined'
    union
    select e."createdBy"
  ) a
  where a."userId" <> me;
  return result;
end;
$$;
revoke all on function public.agenda_postpone(bigint, timestamptz, timestamptz, timestamptz) from public, anon;
grant execute on function public.agenda_postpone(bigint, timestamptz, timestamptz, timestamptz) to authenticated;

-- Cancelar solo una vez de un evento que se repite.
create or replace function public.agenda_skip(target_event bigint, occurrence timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  e public.agenda_events;
begin
  select * into e from public.agenda_events where id = target_event and "companyId" = public.current_company_id() for update;
  if not found or not public.can_manage_agenda_event(target_event) then
    raise exception 'Solo quien organiza el evento (o un administrador) lo puede cancelar.';
  end if;
  perform public.hit_rate_limit('agenda_save', me::text, 200, interval '1 hour', 'Demasiados cambios en la agenda. Espera un momento.');
  if e.recurrence = 'none' then
    raise exception 'Este evento no se repite: cancélalo completo.';
  end if;
  if occurrence is null or not exists (select 1 from public.agenda_occurrences(e, occurrence, occurrence + interval '1 second') o) then
    raise exception 'Esa fecha no es una de las repeticiones del evento.';
  end if;
  update public.agenda_events set skipped = array_append(skipped, occurrence), "updatedAt" = now() where id = target_event;
  insert into public.notifications ("companyId", "userId", kind, title, body, link, "createdBy", "createdByName")
  select e."companyId", a."userId", 'agenda', left('Se canceló (solo esta vez): ' || e.title, 200), public.agenda_when(occurrence, e."allDay", e."timeZone"),
         jsonb_build_object('tab', 'tasks', 'sub', 'agenda'), me, (select "fullName" from public.profiles where id = me)
  from (
    select a."userId" from public.agenda_attendees a where a."eventId" = target_event and a.response <> 'declined'
    union
    select e."createdBy"
  ) a
  where a."userId" <> me;
end;
$$;
revoke all on function public.agenda_skip(bigint, timestamptz) from public, anon;
grant execute on function public.agenda_skip(bigint, timestamptz) to authenticated;

-- ============================================================
-- Listo.
-- ============================================================
