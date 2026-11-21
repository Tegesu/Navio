-- ============================================================
-- NAVIO — Migración v32: agenda, notas de voz y registro de llamadas
-- ============================================================
-- Qué hace:
--   1. Notas de voz: se guarda la forma del audio para dibujarla en el chat.
--   2. Llamadas: el registro dice quiénes entraron, para que cada quien vea
--      si la contestó, la perdió o la rechazó.
--   3. Lista de chats: quién mandó el último mensaje y, si fue una llamada,
--      cómo terminó (saliente, entrante o perdida).
--   4. Agenda: reuniones, revisiones de procesos, tareas, recordatorios y
--      visitas, con participantes, repetición y avisos antes de cada una.
--      Los avisos llegan como notificación (también al teléfono).
--
-- Cómo aplicarla: pega TODO este archivo en Supabase → SQL Editor → Run.
-- Va DESPUÉS de la v31. Se puede correr más de una vez.
--
-- Los avisos de la agenda usan pg_cron (revisa cada minuto). Esta migración
-- intenta activarlo sola. Si al final ves el aviso "pg_cron no está
-- disponible", actívalo en Supabase → Integrations → Cron (o Database →
-- Extensions → pg_cron) y vuelve a correr este archivo.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Notas de voz con su forma
-- ------------------------------------------------------------
create or replace function public.prepare_chat_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  channel_company bigint := (select "companyId" from public.chat_channels where id = new."channelId");
  path text := new.attachment ->> 'path';
  sender uuid := coalesce(auth.uid(), nullif(current_setting('navio.device_sender', true), '')::uuid);
begin
  new.body := trim(coalesce(new.body, ''));
  new.kind := coalesce(new.kind, 'text');
  if new.kind = 'call' then
    -- Solo desde las funciones de llamadas: nadie puede inventar una llamada.
    if coalesce(current_setting('navio.call_message', true), '') <> 'on' then
      raise exception 'Mensaje no válido.';
    end if;
    new."senderName" := (select "fullName" from public.profiles where id = new."senderId");
    new."replyToId" := null;
    new.forwarded := false;
    new."companyId" := channel_company;
    new."createdAt" := now();
    new."deletedAt" := null;
    new."editedAt" := null;
    new."pinnedAt" := null;
    new."pinnedBy" := null;
    return new;
  end if;
  if new.kind = 'text' then
    new.attachment := null;
    if new.body = '' then
      raise exception 'El mensaje está vacío.';
    end if;
  else
    if path is null or not public.chat_file_ok(path, new."channelId") or split_part(path, '/', 1) <> channel_company::text then
      raise exception 'El archivo no es válido para esta conversación.';
    end if;
    new.attachment := jsonb_strip_nulls(jsonb_build_object(
      'path', path,
      'name', left(new.attachment ->> 'name', 200),
      'mime', left(new.attachment ->> 'mime', 100),
      'size', case when (new.attachment ->> 'size') ~ '^[0-9]{1,10}$' then (new.attachment ->> 'size')::bigint end,
      'duration', case when (new.attachment ->> 'duration') ~ '^[0-9]{1,5}(\.[0-9]+)?$' then round((new.attachment ->> 'duration')::numeric, 1) end,
      'width', case when (new.attachment ->> 'width') ~ '^[0-9]{1,5}$' then (new.attachment ->> 'width')::int end,
      'height', case when (new.attachment ->> 'height') ~ '^[0-9]{1,5}$' then (new.attachment ->> 'height')::int end,
      -- v32: forma de la nota de voz (un carácter por barra, de "0" a "v").
      'wave', case when new.kind = 'voice' and (new.attachment ->> 'wave') ~ '^[0-9a-v]{8,64}$' then new.attachment ->> 'wave' end
    ));
  end if;
  if new."replyToId" is not null and not exists (
    select 1 from public.chat_messages where id = new."replyToId" and "channelId" = new."channelId"
  ) then
    new."replyToId" := null;
  end if;
  new.forwarded := coalesce(new.forwarded, false);
  new."senderId" := sender;
  new."senderName" := (select "fullName" from public.profiles where id = sender);
  new."companyId" := channel_company;
  new."createdAt" := now();
  new."deletedAt" := null;
  new."editedAt" := null;
  new."pinnedAt" := null;
  new."pinnedBy" := null;
  return new;
end;
$$;

-- ------------------------------------------------------------
-- 2. Registro de llamadas con quiénes entraron
-- ------------------------------------------------------------
create or replace function public.finish_call_if_done(target_call bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.calls;
  joined integer;
  ringing integer;
  final text;
  seconds integer;
  label text;
  people integer;
begin
  select * into c from public.calls where id = target_call for update;
  if not found or c.status not in ('ringing', 'accepted') then
    return;
  end if;
  select count(*) filter (where status = 'joined'),
         count(*) filter (where status = 'ringing' and "invitedAt" > now() - interval '60 seconds')
  into joined, ringing
  from public.call_participants where "callId" = target_call;
  if joined >= 2 or (joined = 1 and ringing > 0) then
    return;
  end if;
  final := case
    when c."answeredAt" is not null then 'ended'
    when exists (select 1 from public.call_participants where "callId" = target_call and status = 'declined') then 'declined'
    when exists (select 1 from public.call_participants where "callId" = target_call and status = 'busy') then 'busy'
    else 'missed'
  end;
  update public.calls set status = final, "endedAt" = now(), "endedBy" = coalesce(auth.uid(), c."callerId") where id = target_call;
  update public.call_participants set status = 'left', "leftAt" = now() where "callId" = target_call and status = 'joined';
  update public.call_participants set status = 'missed' where "callId" = target_call and status = 'ringing';

  seconds := case when c."answeredAt" is not null then greatest(0, extract(epoch from now() - c."answeredAt")::integer) end;
  select count(*) into people from public.call_participants where "callId" = target_call and "joinedAt" is not null;
  label := case when c.kind = 'video' then 'Videollamada' else 'Llamada de voz' end;
  perform set_config('navio.call_message', 'on', true);
  insert into public.chat_messages ("channelId", kind, body, attachment, "senderId")
  values (
    c."channelId", 'call',
    case when seconds is not null then label || ' · ' || (seconds / 60)::text || ':' || lpad((seconds % 60)::text, 2, '0') else label || ' perdida' end,
    jsonb_strip_nulls(jsonb_build_object('call', c.kind, 'status', final, 'duration', seconds, 'callId', c.id, 'people', case when people > 2 then people end,
      -- v32: quiénes entraron, para que cada quien vea si la contestó o la perdió.
      'joined', (select jsonb_agg("userId") from public.call_participants where "callId" = target_call and "joinedAt" is not null))),
    c."callerId"
  );
  perform set_config('navio.call_message', 'off', true);
end;
$$;
revoke all on function public.finish_call_if_done(bigint) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 3. Lista de chats: último remitente y cómo terminó la llamada
-- ------------------------------------------------------------
drop function if exists public.chat_overview();
create function public.chat_overview()
returns table (
  id bigint, kind text, name text, "createdBy" uuid, "otherUserId" uuid, "otherUserName" text,
  "lastMessageAt" timestamptz, "lastMessage" text, "lastSender" text, unread integer, members integer, "lastKind" text,
  "pinnedAt" timestamptz, muted boolean, "postingMode" text, "canPost" boolean, "isChannelAdmin" boolean,
  "lastSenderId" uuid, "lastAttachment" jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id, c.kind, c.name, c."createdBy", other.id, other."fullName",
    c."lastMessageAt", lm.body, lm."senderName",
    (
      select count(*)::int from public.chat_messages m
      where m."channelId" = c.id
        and m."deletedAt" is null
        and m."senderId" is distinct from auth.uid()
        and m."createdAt" > coalesce(me."lastReadAt", now() - interval '3 days')
    ),
    case when c.kind = 'general'
      then (select count(*)::int from public.profiles p where p."companyId" = c."companyId")
      else (select count(*)::int from public.chat_members cm where cm."channelId" = c.id)
    end,
    lm.kind,
    me."pinnedAt",
    me."mutedAt" is not null,
    c."postingMode",
    public.can_post_channel_for(c.id, auth.uid()),
    public.is_channel_admin_for(c.id, auth.uid()),
    lm."senderId",
    case when lm.kind = 'call' then lm.attachment end
  from public.chat_channels c
  left join public.chat_members me on me."channelId" = c.id and me."userId" = auth.uid()
  left join lateral (
    select m.body, m."senderName", m.kind, m."senderId", m.attachment from public.chat_messages m
    where m."channelId" = c.id and m."deletedAt" is null
    order by m.id desc limit 1
  ) lm on true
  left join lateral (
    select p.id, p."fullName" from public.chat_members om
    join public.profiles p on p.id = om."userId"
    where om."channelId" = c.id and om."userId" <> auth.uid()
    limit 1
  ) other on c.kind = 'direct'
  where c."companyId" = public.current_company_id()
    and (c.kind = 'general' or (me."userId" is not null and me."userId" = auth.uid()))
  order by me."pinnedAt" desc nulls last, coalesce(c."lastMessageAt", c."createdAt") desc;
$$;
revoke all on function public.chat_overview() from public, anon;
grant execute on function public.chat_overview() to authenticated;

-- ------------------------------------------------------------
-- 4. Agenda
-- ------------------------------------------------------------
-- kind: meeting (reunión), review (revisar un proceso), task (tarea),
-- reminder (recordatorio), visit (visita), call (llamada), other.
-- reminders: minutos antes de cada vez (0 = a la hora), hasta 6.
-- visibility: participants (quien la crea y sus participantes) o company.
create table if not exists public.agenda_events (
  id bigint generated always as identity primary key,
  "companyId" bigint not null references public.companies (id) on delete cascade,
  "createdBy" uuid not null references auth.users (id) on delete cascade,
  "createdByName" text,
  title text not null check (char_length(title) between 1 and 200),
  kind text not null default 'meeting' check (kind in ('meeting', 'review', 'task', 'reminder', 'visit', 'call', 'other')),
  description text check (description is null or char_length(description) <= 4000),
  "startsAt" timestamptz not null,
  "endsAt" timestamptz,
  "allDay" boolean not null default false,
  "timeZone" text not null default 'America/Mexico_City',
  location text check (location is null or char_length(location) <= 300),
  "channelId" bigint references public.chat_channels (id) on delete set null,
  "taskId" bigint references public.tasks (id) on delete set null,
  color text not null default 'blue' check (color in ('blue', 'violet', 'emerald', 'amber', 'rose', 'sky', 'slate')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  recurrence text not null default 'none' check (recurrence in ('none', 'daily', 'weekdays', 'weekly', 'biweekly', 'monthly', 'yearly')),
  "recurUntil" timestamptz,
  reminders integer[] not null default '{10}',
  visibility text not null default 'participants' check (visibility in ('participants', 'company')),
  status text not null default 'scheduled' check (status in ('scheduled', 'done', 'cancelled')),
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint agenda_events_end_ok check ("endsAt" is null or ("endsAt" >= "startsAt" and "endsAt" <= "startsAt" + interval '31 days')),
  constraint agenda_events_until_ok check ("recurUntil" is null or "recurUntil" >= "startsAt")
);
create index if not exists agenda_events_company_idx on public.agenda_events ("companyId", "startsAt");

create table if not exists public.agenda_attendees (
  "eventId" bigint not null references public.agenda_events (id) on delete cascade,
  "userId" uuid not null references auth.users (id) on delete cascade,
  "companyId" bigint not null references public.companies (id) on delete cascade,
  response text not null default 'pending' check (response in ('pending', 'accepted', 'declined', 'tentative')),
  "respondedAt" timestamptz,
  primary key ("eventId", "userId")
);
create index if not exists agenda_attendees_user_idx on public.agenda_attendees ("userId");

-- Avisos ya mandados (para no repetirlos).
create table if not exists public.agenda_reminder_log (
  "eventId" bigint not null references public.agenda_events (id) on delete cascade,
  occurrence timestamptz not null,
  minutes integer not null,
  "sentAt" timestamptz not null default now(),
  primary key ("eventId", occurrence, minutes)
);

alter table public.agenda_events enable row level security;
alter table public.agenda_attendees enable row level security;
alter table public.agenda_reminder_log enable row level security;

-- Quién ve un evento: quien lo creó, sus participantes y, si es "de toda la
-- empresa", todos en la empresa. (Función aparte para no dar vueltas entre
-- las reglas de las dos tablas.)
create or replace function public.can_see_agenda_event(target_event bigint)
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
      and (
        e.visibility = 'company'
        or e."createdBy" = auth.uid()
        or exists (select 1 from public.agenda_attendees a where a."eventId" = e.id and a."userId" = auth.uid())
      )
  );
$$;
revoke all on function public.can_see_agenda_event(bigint) from public, anon;
grant execute on function public.can_see_agenda_event(bigint) to authenticated;

drop policy if exists agenda_events_select on public.agenda_events;
create policy agenda_events_select on public.agenda_events
  for select to authenticated
  using (public.can_see_agenda_event(id));

drop policy if exists agenda_attendees_select on public.agenda_attendees;
create policy agenda_attendees_select on public.agenda_attendees
  for select to authenticated
  using (public.can_see_agenda_event("eventId"));

-- Como en las demás tablas: sin el código de dos pasos, nada.
do $$
declare
  t text;
begin
  foreach t in array array['agenda_events', 'agenda_attendees', 'agenda_reminder_log'] loop
    execute format('drop policy if exists mfa_required on public.%I', t);
    execute format(
      'create policy mfa_required on public.%I as restrictive for all to authenticated using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()))',
      t
    );
  end loop;
end $$;
-- Los cambios solo pasan por las funciones de abajo (que revisan todo).
revoke insert, update, delete on public.agenda_events, public.agenda_attendees, public.agenda_reminder_log from anon, authenticated;

-- Fecha legible para los avisos: "21/11/2026 10:30" (en la zona del evento).
create or replace function public.agenda_when(at_ts timestamptz, all_day boolean, tz text)
returns text
language plpgsql
stable
set search_path = public
as $$
begin
  if all_day then
    return to_char(at_ts at time zone tz, 'DD/MM/YYYY') || ' (todo el día)';
  end if;
  return to_char(at_ts at time zone tz, 'DD/MM/YYYY HH24:MI');
exception when others then
  return to_char(at_ts, 'DD/MM/YYYY HH24:MI');
end;
$$;
revoke all on function public.agenda_when(timestamptz, boolean, text) from public, anon;

-- Las veces que ocurre un evento entre dos momentos (con su repetición).
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
    if occ >= from_ts and (e.recurrence <> 'weekdays' or extract(isodow from (occ at time zone e."timeZone")) < 6) then
      return next occ;
    end if;
    n := n + 1;
    guard := guard + 1;
  end loop;
end;
$$;
revoke all on function public.agenda_occurrences(public.agenda_events, timestamptz, timestamptz) from public, anon;
grant execute on function public.agenda_occurrences(public.agenda_events, timestamptz, timestamptz) to authenticated;

-- Lo que hay en la agenda entre dos fechas (cada repetición, por separado).
drop function if exists public.agenda_list(timestamptz, timestamptz);
create function public.agenda_list(from_ts timestamptz, to_ts timestamptz)
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
    e."createdBy" = auth.uid() or (e.visibility = 'company' and public.is_company_admin())
  from public.agenda_events e
  cross join lateral public.agenda_occurrences(e, from_ts - coalesce(e."endsAt" - e."startsAt", interval '0'), to_ts) as o(at)
  where e."companyId" = public.current_company_id()
    and public.can_see_agenda_event(e.id)
    and to_ts > from_ts
    and to_ts - from_ts <= interval '400 days'
  order by o.at
  limit 1500;
$$;
revoke all on function public.agenda_list(timestamptz, timestamptz) from public, anon;
grant execute on function public.agenda_list(timestamptz, timestamptz) to authenticated;

-- Crear o cambiar un evento (con sus participantes). Devuelve su número.
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
    where p.id <> me;
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
    if not found or not (existing."createdBy" = me or (existing.visibility = 'company' and public.is_company_admin())) then
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
  end if;
  return event_id;
end;
$$;
revoke all on function public.agenda_save(jsonb) from public, anon;
grant execute on function public.agenda_save(jsonb) to authenticated;

-- Marcar como hecho, cancelar o volver a programar.
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
  if not found or not (e."createdBy" = me or (e.visibility = 'company' and public.is_company_admin())) then
    raise exception 'Solo quien creó el evento lo puede cambiar.';
  end if;
  perform public.hit_rate_limit('agenda_save', me::text, 200, interval '1 hour', 'Demasiados cambios en la agenda. Espera un momento.');
  update public.agenda_events set status = new_status, "updatedAt" = now() where id = target_event;
  if new_status = 'cancelled' and e.status <> 'cancelled' then
    insert into public.notifications ("companyId", "userId", kind, title, body, link, "createdBy", "createdByName")
    select e."companyId", a."userId", 'agenda', left('Se canceló: ' || e.title, 200), public.agenda_when(e."startsAt", e."allDay", e."timeZone"),
           jsonb_build_object('tab', 'tasks', 'sub', 'agenda'), me, (select "fullName" from public.profiles where id = me)
    from public.agenda_attendees a where a."eventId" = target_event and a."userId" <> me;
  end if;
end;
$$;
revoke all on function public.agenda_set_status(bigint, text) from public, anon;
grant execute on function public.agenda_set_status(bigint, text) to authenticated;

-- Borrar un evento (se avisa a sus participantes).
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
  if not found or not (e."createdBy" = me or (e.visibility = 'company' and public.is_company_admin())) then
    raise exception 'Solo quien creó el evento lo puede borrar.';
  end if;
  if e.status = 'scheduled' and (e.recurrence <> 'none' or e."startsAt" > now()) then
    insert into public.notifications ("companyId", "userId", kind, title, body, link, "createdBy", "createdByName")
    select e."companyId", a."userId", 'agenda', left('Se canceló: ' || e.title, 200), public.agenda_when(e."startsAt", e."allDay", e."timeZone"),
           jsonb_build_object('tab', 'tasks', 'sub', 'agenda'), me, (select "fullName" from public.profiles where id = me)
    from public.agenda_attendees a where a."eventId" = target_event and a."userId" <> me;
  end if;
  delete from public.agenda_events where id = target_event;
end;
$$;
revoke all on function public.agenda_delete(bigint) from public, anon;
grant execute on function public.agenda_delete(bigint) to authenticated;

-- Responder a una invitación: asistiré, tal vez o no asistiré.
create or replace function public.agenda_respond(target_event bigint, answer text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  e public.agenda_events;
  my_name text := (select "fullName" from public.profiles where id = auth.uid());
begin
  if answer not in ('accepted', 'declined', 'tentative') then
    raise exception 'Respuesta no válida.';
  end if;
  select * into e from public.agenda_events where id = target_event and "companyId" = public.current_company_id();
  if not found or not exists (select 1 from public.agenda_attendees where "eventId" = target_event and "userId" = me) then
    raise exception 'No estás invitado a este evento.';
  end if;
  perform public.hit_rate_limit('agenda_respond', me::text, 120, interval '1 hour', 'Demasiadas respuestas seguidas. Espera un momento.');
  update public.agenda_attendees set response = answer, "respondedAt" = now() where "eventId" = target_event and "userId" = me;
  if answer in ('accepted', 'declined') and e."createdBy" <> me then
    insert into public.notifications ("companyId", "userId", kind, title, body, link, "createdBy", "createdByName")
    values (e."companyId", e."createdBy", 'agenda',
            left(coalesce(my_name, 'Alguien') || case when answer = 'accepted' then ' asistirá: ' else ' no asistirá: ' end || e.title, 200),
            public.agenda_when(e."startsAt", e."allDay", e."timeZone"), jsonb_build_object('tab', 'tasks', 'sub', 'agenda'), me, my_name);
  end if;
end;
$$;
revoke all on function public.agenda_respond(bigint, text) from public, anon;
grant execute on function public.agenda_respond(bigint, text) to authenticated;

-- Manda los avisos que tocan ahora (la corre pg_cron cada minuto).
create or replace function public.send_agenda_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  sent integer := 0;
  label text;
begin
  for r in
    select e.id, e."companyId", e.title, e."allDay", e."timeZone", e.location, e."createdBy", m.minutes, o.at
    from public.agenda_events e
    cross join lateral unnest(e.reminders) as m(minutes)
    cross join lateral public.agenda_occurrences(
      e,
      now() + make_interval(mins => m.minutes) - interval '15 minutes',
      now() + make_interval(mins => m.minutes) + interval '30 seconds'
    ) as o(at)
    where e.status = 'scheduled'
      and (e.recurrence <> 'none' or e."startsAt" >= now() - interval '1 day')
  loop
    insert into public.agenda_reminder_log ("eventId", occurrence, minutes) values (r.id, r.at, r.minutes)
    on conflict do nothing;
    if not found then
      continue;
    end if;
    label := case
      when r.minutes = 0 then 'Ahora: '
      when r.minutes < 60 then 'En ' || r.minutes || ' min: '
      when r.minutes < 1440 then 'En ' || (r.minutes / 60) || ' h: '
      when r.minutes < 2880 then 'Mañana: '
      else 'En ' || (r.minutes / 1440) || ' días: '
    end;
    insert into public.notifications ("companyId", "userId", kind, title, body, link)
    select r."companyId", people.u, 'agenda', left(label || r.title, 200),
           public.agenda_when(r.at, r."allDay", r."timeZone") || coalesce(' · ' || r.location, ''),
           jsonb_build_object('tab', 'tasks', 'sub', 'agenda')
    from (
      select r."createdBy" as u
      union
      select a."userId" from public.agenda_attendees a where a."eventId" = r.id and a.response <> 'declined'
    ) people
    join public.profiles p on p.id = people.u and p."companyId" = r."companyId";
    sent := sent + 1;
  end loop;
  delete from public.agenda_reminder_log where "sentAt" < now() - interval '60 days';
  return sent;
end;
$$;
revoke all on function public.send_agenda_reminders() from public, anon, authenticated;

-- Revisar los avisos cada minuto con pg_cron.
do $$
begin
  begin
    create extension if not exists pg_cron with schema pg_catalog;
  exception when others then
    raise notice 'pg_cron no está disponible (%): actívalo en Supabase → Integrations → Cron y vuelve a correr este archivo.', sqlerrm;
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('navio-agenda-reminders', '* * * * *', 'select public.send_agenda_reminders()');
  end if;
end $$;

-- ============================================================
-- Listo.
-- ============================================================
