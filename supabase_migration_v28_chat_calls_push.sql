-- ============================================================
-- NAVIO — Migración v28: chats con permisos, llamadas en grupo y avisos
-- completos
-- ============================================================
-- Qué hace:
--   1. Chats: fijar y silenciar conversaciones (cada quien las suyas), y
--      quién puede escribir en el chat general y en los grupos (todos,
--      solo administradores o personas elegidas).
--   2. Tareas desde el chat: una tarea puede nacer de un mensaje; quienes
--      están en esa conversación la ven en su barra de "Tareas pendientes".
--      En una conversación directa o de grupo se le puede asignar a
--      cualquiera de sus participantes.
--   3. Búsqueda rápida de palabras en los mensajes.
--   4. Avisos: responder y marcar como leído desde la notificación del
--      teléfono, y aviso cuando alguien reacciona a tu mensaje.
--   5. Llamadas en grupo: agregar personas a una llamada y unirse con el
--      enlace que se comparte.
--
-- Cómo aplicarla: pega TODO este archivo en Supabase → SQL Editor → Run.
-- Va DESPUÉS de la v27. Se puede correr más de una vez.
-- Después: volver a desplegar la función "push" (con "Verify JWT" apagado).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Chats: fijados, silenciados y quién puede escribir
-- ------------------------------------------------------------
alter table public.chat_members
  add column if not exists "pinnedAt" timestamptz,
  add column if not exists "mutedAt" timestamptz,
  add column if not exists "isAdmin" boolean not null default false,
  add column if not exists "canPost" boolean not null default false;

alter table public.chat_channels add column if not exists "postingMode" text not null default 'all';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chat_channels_posting_mode') then
    alter table public.chat_channels add constraint chat_channels_posting_mode check ("postingMode" in ('all', 'admins', 'selected'));
  end if;
end $$;

-- Las mismas reglas de siempre, pero para una persona dada (las usan las
-- respuestas desde la notificación, donde no hay sesión).
create or replace function public.can_access_channel_for(target_channel bigint, who uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.chat_channels c
    join public.profiles p on p.id = who and p."companyId" = c."companyId"
    where c.id = target_channel
      and (c.kind = 'general' or exists (select 1 from public.chat_members m where m."channelId" = c.id and m."userId" = who))
  );
$$;
revoke all on function public.can_access_channel_for(bigint, uuid) from public, anon, authenticated;

-- Administra el chat: administrador de la empresa, quien creó el grupo o
-- alguien a quien se nombró administrador del chat.
create or replace function public.is_channel_admin_for(target_channel bigint, who uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.chat_channels c
    join public.profiles p on p.id = who and p."companyId" = c."companyId"
    where c.id = target_channel
      and c.kind <> 'direct'
      and (
        p."companyRole" = 'admin'
        or (c.kind = 'group' and c."createdBy" = who)
        or exists (select 1 from public.chat_members m where m."channelId" = c.id and m."userId" = who and m."isAdmin")
      )
  );
$$;
revoke all on function public.is_channel_admin_for(bigint, uuid) from public, anon, authenticated;

create or replace function public.can_post_channel_for(target_channel bigint, who uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_access_channel_for(target_channel, who) and exists (
    select 1 from public.chat_channels c
    where c.id = target_channel
      and (
        c.kind = 'direct'
        or c."postingMode" = 'all'
        or public.is_channel_admin_for(c.id, who)
        or (c."postingMode" = 'selected' and exists (
          select 1 from public.chat_members m where m."channelId" = c.id and m."userId" = who and m."canPost"
        ))
      )
  );
$$;
revoke all on function public.can_post_channel_for(bigint, uuid) from public, anon, authenticated;

create or replace function public.can_post_channel(target_channel bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and public.can_post_channel_for(target_channel, auth.uid());
$$;
revoke all on function public.can_post_channel(bigint) from public, anon;
grant execute on function public.can_post_channel(bigint) to authenticated;

-- Escribir en un chat: además de verlo, hay que tener permiso de escribir.
drop policy if exists "chat_messages_insert" on public.chat_messages;
create policy "chat_messages_insert" on public.chat_messages
  for insert to authenticated with check (public.can_post_channel("channelId") and "senderId" = auth.uid());

-- Quién puede escribir. mode: all, admins o selected (poster_ids).
-- admin_ids: administradores del chat (además de los de la empresa).
create or replace function public.set_channel_posting(target_channel bigint, mode text, poster_ids uuid[] default '{}', admin_ids uuid[] default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  c public.chat_channels;
begin
  select * into c from public.chat_channels where id = target_channel and "companyId" = public.current_company_id();
  if not found or c.kind = 'direct' then
    raise exception 'Esta conversación no tiene permisos que cambiar.';
  end if;
  if not public.is_channel_admin_for(target_channel, me) then
    raise exception 'Solo quien administra el chat puede cambiar quién escribe.';
  end if;
  if mode is null or mode not in ('all', 'admins', 'selected') then
    raise exception 'Opción no válida.';
  end if;
  update public.chat_channels set "postingMode" = mode where id = target_channel;
  -- En el general, quien se elige pasa a tener su fila de participante.
  if c.kind = 'general' then
    insert into public.chat_members ("channelId", "userId")
    select target_channel, p.id from public.profiles p
    where p."companyId" = c."companyId" and (p.id = any (coalesce(poster_ids, '{}')) or p.id = any (coalesce(admin_ids, '{}')))
    on conflict do nothing;
  end if;
  update public.chat_members set "canPost" = ("userId" = any (coalesce(poster_ids, '{}')))
  where "channelId" = target_channel;
  if admin_ids is not null then
    update public.chat_members set "isAdmin" = ("userId" = any (admin_ids))
    where "channelId" = target_channel;
  end if;
end;
$$;
revoke all on function public.set_channel_posting(bigint, text, uuid[], uuid[]) from public, anon;
grant execute on function public.set_channel_posting(bigint, text, uuid[], uuid[]) to authenticated;

-- Fijar y silenciar (de cada persona).
create or replace function public.pin_channel(target_channel bigint, pin boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if not public.can_access_channel(target_channel) then
    raise exception 'No tienes acceso a esa conversación.';
  end if;
  if pin and (select count(*) from public.chat_members where "userId" = me and "pinnedAt" is not null and "channelId" <> target_channel) >= 5 then
    raise exception 'Puedes fijar hasta 5 conversaciones.';
  end if;
  insert into public.chat_members ("channelId", "userId", "pinnedAt")
  values (target_channel, me, case when pin then now() end)
  on conflict ("channelId", "userId") do update set "pinnedAt" = excluded."pinnedAt";
end;
$$;
revoke all on function public.pin_channel(bigint, boolean) from public, anon;
grant execute on function public.pin_channel(bigint, boolean) to authenticated;

create or replace function public.mute_channel(target_channel bigint, mute boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_access_channel(target_channel) then
    raise exception 'No tienes acceso a esa conversación.';
  end if;
  insert into public.chat_members ("channelId", "userId", "mutedAt")
  values (target_channel, auth.uid(), case when mute then now() end)
  on conflict ("channelId", "userId") do update set "mutedAt" = excluded."mutedAt";
end;
$$;
revoke all on function public.mute_channel(bigint, boolean) from public, anon;
grant execute on function public.mute_channel(bigint, boolean) to authenticated;

-- Participantes de un chat con sus permisos (para la ventana de permisos).
create or replace function public.channel_people(target_channel bigint)
returns table ("userId" uuid, "fullName" text, "isAdmin" boolean, "canPost" boolean, "companyAdmin" boolean)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p."fullName", coalesce(m."isAdmin", false) or (c.kind = 'group' and c."createdBy" = p.id), coalesce(m."canPost", false), p."companyRole" = 'admin'
  from public.chat_channels c
  join public.profiles p on p."companyId" = c."companyId"
  left join public.chat_members m on m."channelId" = c.id and m."userId" = p.id
  where c.id = target_channel
    and public.can_access_channel(target_channel)
    and (c.kind = 'general' or m."userId" is not null)
  order by p."fullName";
$$;
revoke all on function public.channel_people(bigint) from public, anon;
grant execute on function public.channel_people(bigint) to authenticated;

-- La lista de conversaciones, ahora con fijados, silenciados y permisos.
drop function if exists public.chat_overview();
create function public.chat_overview()
returns table (
  id bigint, kind text, name text, "createdBy" uuid, "otherUserId" uuid, "otherUserName" text,
  "lastMessageAt" timestamptz, "lastMessage" text, "lastSender" text, unread integer, members integer, "lastKind" text,
  "pinnedAt" timestamptz, muted boolean, "postingMode" text, "canPost" boolean, "isChannelAdmin" boolean
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
    public.is_channel_admin_for(c.id, auth.uid())
  from public.chat_channels c
  left join public.chat_members me on me."channelId" = c.id and me."userId" = auth.uid()
  left join lateral (
    select m.body, m."senderName", m.kind from public.chat_messages m
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

-- Búsqueda de palabras en los mensajes (índice para que sea rápida).
do $$
declare
  ext_schema text;
begin
  begin
    create extension if not exists pg_trgm with schema extensions;
  exception when others then
    null;
  end;
  select n.nspname into ext_schema from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if ext_schema is not null then
    execute format('create index if not exists chat_messages_body_trgm on public.chat_messages using gin (body %I.gin_trgm_ops)', ext_schema);
  end if;
exception when others then
  null; -- sin el índice la búsqueda funciona igual, solo más lenta
end $$;

-- ------------------------------------------------------------
-- 2. Tareas que nacen en un chat
-- ------------------------------------------------------------
alter table public.tasks
  add column if not exists "channelId" bigint references public.chat_channels (id) on delete set null,
  add column if not exists "messageId" bigint references public.chat_messages (id) on delete set null;
create index if not exists tasks_channel_idx on public.tasks ("channelId") where "channelId" is not null;

-- Las tareas de un chat las ven quienes están en él.
drop policy if exists "tasks_select" on public.tasks;
create policy "tasks_select" on public.tasks
  for select to authenticated
  using ("companyId" = public.current_company_id()
         and (public.is_company_admin() or "assignedTo" = auth.uid() or "createdBy" = auth.uid()
              or ("channelId" is not null and public.can_access_channel("channelId"))));

-- Igual que en la v17, más el chat: en una conversación directa o de grupo
-- se le puede asignar la tarea a cualquiera de sus participantes.
create or replace function public.prepare_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  is_admin boolean := public.is_company_admin();
  chat_ok boolean := false;
begin
  if me is null then
    return new; -- SQL Editor o llave de servicio
  end if;

  if tg_op = 'INSERT' then
    new."companyId" := public.current_company_id();
    new."createdBy" := me;
    new."createdByName" := (select "fullName" from public.profiles where id = me);
    new."createdAt" := now();
    new."assignedTo" := coalesce(new."assignedTo", me);
    if new."channelId" is not null then
      if not public.can_access_channel(new."channelId") then
        raise exception 'No tienes acceso a esa conversación.';
      end if;
      if new."messageId" is not null and not exists (
        select 1 from public.chat_messages where id = new."messageId" and "channelId" = new."channelId"
      ) then
        new."messageId" := null;
      end if;
    else
      new."messageId" := null;
    end if;
    chat_ok := new."channelId" is not null and exists (
      select 1 from public.chat_channels c
      join public.chat_members m on m."channelId" = c.id and m."userId" = new."assignedTo"
      where c.id = new."channelId" and c.kind in ('direct', 'group')
    );
    if new."assignedTo" <> me and not is_admin and not chat_ok then
      raise exception 'Solo un administrador puede asignar tareas a otras personas.';
    end if;
  else
    new."companyId" := old."companyId";
    new."createdBy" := old."createdBy";
    new."createdByName" := old."createdByName";
    new."createdAt" := old."createdAt";
    new."channelId" := old."channelId";
    new."messageId" := old."messageId";
    if not is_admin and old."createdBy" is distinct from me then
      -- A quien se la asignaron solo le toca avanzar su estado.
      new.title := old.title;
      new.description := old.description;
      new."assignedTo" := old."assignedTo";
      new."dueDate" := old."dueDate";
      new.priority := old.priority;
      new."relatedType" := old."relatedType";
      new."relatedLabel" := old."relatedLabel";
    end if;
    chat_ok := new."channelId" is not null and exists (
      select 1 from public.chat_channels c
      join public.chat_members m on m."channelId" = c.id and m."userId" = new."assignedTo"
      where c.id = new."channelId" and c.kind in ('direct', 'group')
    );
    if new."assignedTo" is distinct from old."assignedTo" and not is_admin and new."assignedTo" is distinct from me and not chat_ok then
      raise exception 'Solo un administrador puede asignar tareas a otras personas.';
    end if;
  end if;

  if new."assignedTo" is not null and (tg_op = 'INSERT' or new."assignedTo" is distinct from old."assignedTo") then
    if not exists (select 1 from public.profiles where id = new."assignedTo" and "companyId" = new."companyId") then
      raise exception 'Esa persona no pertenece a tu empresa.';
    end if;
    new."assignedToName" := (select "fullName" from public.profiles where id = new."assignedTo");
  end if;

  new."completedAt" := case
    when new.status = 'done' then coalesce(case when tg_op = 'UPDATE' then old."completedAt" end, now())
    else null
  end;
  new."updatedAt" := now();
  return new;
end;
$$;

-- ------------------------------------------------------------
-- 3. Responder y marcar como leído desde la notificación
-- ------------------------------------------------------------
-- Cada teléfono y navegador recibe una clave propia al activar los avisos.
-- Con ella (y sin sesión) solo puede responder o marcar como leído en las
-- conversaciones de su dueño.
alter table public.push_devices
  add column if not exists "secretHash" text,
  add column if not exists rich boolean not null default false;
alter table public.push_subscriptions add column if not exists "secretHash" text;

create or replace function public.new_push_secret()
returns text
language sql
volatile
as $$
  select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
$$;
revoke all on function public.new_push_secret() from public, anon, authenticated;

create or replace function public.push_secret_hash(secret text)
returns text
language sql
immutable
as $$
  select encode(sha256(convert_to(coalesce(secret, ''), 'UTF8')), 'hex');
$$;
revoke all on function public.push_secret_hash(text) from public, anon, authenticated;

-- Como save_push_device, pero devuelve la clave del teléfono. rich: la app
-- (1.0.7 o más nueva) arma sus propias notificaciones.
create or replace function public.save_push_device_v2(device_token text, device_platform text default 'android', device_rich boolean default false)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  secret text := public.new_push_secret();
begin
  perform public.save_push_device(device_token, device_platform);
  update public.push_devices set "secretHash" = public.push_secret_hash(secret), rich = coalesce(device_rich, false)
  where token = device_token and "userId" = auth.uid();
  return secret;
end;
$$;
revoke all on function public.save_push_device_v2(text, text, boolean) from public, anon;
grant execute on function public.save_push_device_v2(text, text, boolean) to authenticated;

create or replace function public.save_push_subscription_v2(sub_endpoint text, sub_p256dh text, sub_auth text, sub_agent text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  secret text := public.new_push_secret();
begin
  perform public.save_push_subscription(sub_endpoint, sub_p256dh, sub_auth, sub_agent);
  update public.push_subscriptions set "secretHash" = public.push_secret_hash(secret)
  where endpoint = sub_endpoint and "userId" = auth.uid();
  return secret;
end;
$$;
revoke all on function public.save_push_subscription_v2(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription_v2(text, text, text, text) to authenticated;

-- Mensajes: una respuesta desde la notificación va a nombre del dueño del
-- teléfono (lo pone push_action, más abajo). Todo lo demás, igual que la v27.
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
      'height', case when (new.attachment ->> 'height') ~ '^[0-9]{1,5}$' then (new.attachment ->> 'height')::int end
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

-- Desde la notificación (sin sesión): act = 'read' o 'reply'.
-- device_kind: 'android' (token de Firebase) o 'web' (dirección del navegador).
create or replace function public.push_action(device_kind text, device_ident text, device_secret text, target_channel bigint, act text, reply_body text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  who uuid;
  device_id bigint;
  clean text;
begin
  if device_kind = 'android' then
    select id, "userId" into device_id, who from public.push_devices
    where token = device_ident and "secretHash" is not null and "secretHash" = public.push_secret_hash(device_secret);
  elsif device_kind = 'web' then
    select id, "userId" into device_id, who from public.push_subscriptions
    where endpoint = device_ident and "secretHash" is not null and "secretHash" = public.push_secret_hash(device_secret);
  end if;
  if who is null then
    raise exception 'No autorizado.';
  end if;
  perform public.hit_rate_limit('push_action', device_kind || ':' || device_id::text, 60, interval '1 hour', 'Demasiadas respuestas seguidas. Abre Navio.');
  if not exists (
    select 1 from public.profiles p join public.companies c on c.id = p."companyId"
    where p.id = who and c.status = 'approved'
  ) or not public.can_access_channel_for(target_channel, who) then
    raise exception 'No tienes acceso a esa conversación.';
  end if;

  if act = 'reply' then
    clean := trim(coalesce(reply_body, ''));
    if clean = '' or char_length(clean) > 4000 then
      raise exception 'Escribe una respuesta.';
    end if;
    if not public.can_post_channel_for(target_channel, who) then
      raise exception 'En este chat solo escriben algunas personas.';
    end if;
    perform set_config('navio.device_sender', who::text, true);
    insert into public.chat_messages ("channelId", body, kind) values (target_channel, clean, 'text');
    perform set_config('navio.device_sender', '', true);
  elsif act <> 'read' then
    raise exception 'Acción no válida.';
  end if;

  insert into public.chat_members ("channelId", "userId", "lastReadAt", "lastDeliveredAt")
  values (target_channel, who, now(), now())
  on conflict ("channelId", "userId") do update set "lastReadAt" = now(), "lastDeliveredAt" = now();
  return 'ok';
end;
$$;
revoke all on function public.push_action(text, text, text, bigint, text, text) from public;
grant execute on function public.push_action(text, text, text, bigint, text, text) to anon, authenticated;

-- Aviso cuando alguien reacciona a tu mensaje.
alter table public.chat_reactions add column if not exists "pushedAt" timestamptz;

create or replace function public.request_push_reaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform net.http_post(
      url := 'https://bwvetvomcfmolhfrrlcx.supabase.co/functions/v1/push',
      body := jsonb_build_object('table', 'chat_reactions', 'messageId', new."messageId", 'userId', new."userId"),
      headers := '{"Content-Type": "application/json"}'::jsonb,
      timeout_milliseconds := 5000
    );
  exception when others then
    null;
  end;
  return null;
end;
$$;
revoke all on function public.request_push_reaction() from public, anon, authenticated;
drop trigger if exists request_push_reaction on public.chat_reactions;
create trigger request_push_reaction
  after insert on public.chat_reactions
  for each row execute function public.request_push_reaction();

-- ------------------------------------------------------------
-- 4. Llamadas en grupo
-- ------------------------------------------------------------
create table if not exists public.call_participants (
  id bigint generated always as identity primary key,
  "callId" bigint not null references public.calls (id) on delete cascade,
  "companyId" bigint not null references public.companies (id) on delete cascade,
  "userId" uuid not null references auth.users (id) on delete cascade,
  "userName" text,
  status text not null default 'ringing' check (status in ('ringing', 'joined', 'left', 'declined', 'missed', 'busy')),
  "invitedBy" uuid,
  "invitedByName" text,
  "invitedAt" timestamptz not null default now(),
  "joinedAt" timestamptz,
  "leftAt" timestamptz,
  "pushedAt" timestamptz,
  unique ("callId", "userId")
);
create index if not exists call_participants_user_idx on public.call_participants ("userId", "invitedAt" desc);

-- Los datos técnicos para conectar a cada par de personas.
create table if not exists public.call_signals (
  id bigint generated always as identity primary key,
  "callId" bigint not null references public.calls (id) on delete cascade,
  "fromUser" uuid not null,
  "toUser" uuid not null,
  kind text not null check (kind in ('offer', 'answer')),
  sdp text not null check (char_length(sdp) <= 40000),
  "createdAt" timestamptz not null default now()
);
create index if not exists call_signals_to_idx on public.call_signals ("toUser", id desc);

create or replace function public.in_call(target_call bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.call_participants where "callId" = target_call and "userId" = auth.uid());
$$;
revoke all on function public.in_call(bigint) from public, anon;
grant execute on function public.in_call(bigint) to authenticated;

alter table public.call_participants enable row level security;
alter table public.call_signals enable row level security;

drop policy if exists "calls_select" on public.calls;
create policy "calls_select" on public.calls
  for select to authenticated
  using ("companyId" = public.current_company_id() and (auth.uid() in ("callerId", "calleeId") or public.in_call(id)));

drop policy if exists "call_participants_select" on public.call_participants;
create policy "call_participants_select" on public.call_participants
  for select to authenticated
  using ("companyId" = public.current_company_id() and public.in_call("callId"));

drop policy if exists "call_signals_select" on public.call_signals;
create policy "call_signals_select" on public.call_signals
  for select to authenticated
  using (auth.uid() in ("toUser", "fromUser"));

drop policy if exists mfa_required on public.call_participants;
create policy mfa_required on public.call_participants as restrictive for all to authenticated
  using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));
drop policy if exists mfa_required on public.call_signals;
create policy mfa_required on public.call_signals as restrictive for all to authenticated
  using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));

revoke all on public.call_participants from anon;
revoke all on public.call_signals from anon;
revoke insert, update, delete on public.call_participants from authenticated;
revoke insert, update, delete on public.call_signals from authenticated;

-- Las llamadas nuevas avisan por participante (abajo): ya no por la tabla calls.
drop trigger if exists request_push on public.calls;

-- Termina la llamada si ya no queda con quién hablar y deja su mensaje en
-- la conversación (una sola vez).
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
    jsonb_strip_nulls(jsonb_build_object('call', c.kind, 'status', final, 'duration', seconds, 'callId', c.id, 'people', case when people > 2 then people end)),
    c."callerId"
  );
  perform set_config('navio.call_message', 'off', true);
end;
$$;
revoke all on function public.finish_call_if_done(bigint) from public, anon, authenticated;

-- Llamar desde una conversación directa o de grupo (hasta 8 personas).
create or replace function public.call_open(target_channel bigint, call_kind text)
returns public.calls
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  my_company bigint := public.current_company_id();
  my_name text := (select "fullName" from public.profiles where id = me);
  ch public.chat_channels;
  others uuid[];
  result public.calls;
  old_call bigint;
begin
  if me is null or my_company is null then
    raise exception 'Tu sesión no pertenece a una empresa activa.';
  end if;
  if call_kind is null or call_kind not in ('audio', 'video') then
    raise exception 'Tipo de llamada no válido.';
  end if;
  select * into ch from public.chat_channels where id = target_channel and "companyId" = my_company;
  if not found or ch.kind not in ('direct', 'group') or not public.can_access_channel(target_channel) then
    raise exception 'Solo se puede llamar desde una conversación directa o de grupo.';
  end if;
  select array_agg(m."userId") into others
  from public.chat_members m join public.profiles p on p.id = m."userId" and p."companyId" = my_company
  where m."channelId" = target_channel and m."userId" <> me;
  if coalesce(array_length(others, 1), 0) = 0 then
    raise exception 'No hay nadie más en esta conversación.';
  end if;
  if array_length(others, 1) > 7 then
    raise exception 'Las llamadas son de hasta 8 personas.';
  end if;
  perform public.hit_rate_limit('calls', me::text, 20, interval '10 minutes', 'Demasiadas llamadas seguidas. Espera un momento.');
  -- Si se quedó en otra llamada (se cerró Navio a medias), sale de ella.
  for old_call in select "callId" from public.call_participants where "userId" = me and status in ('joined', 'ringing') loop
    update public.call_participants set status = 'left', "leftAt" = now() where "callId" = old_call and "userId" = me;
    perform public.finish_call_if_done(old_call);
  end loop;
  insert into public.calls ("companyId", "channelId", "callerId", "callerName", "calleeId", "calleeName", kind, status)
  values (my_company, target_channel, me, my_name, others[1], (select "fullName" from public.profiles where id = others[1]), call_kind, 'ringing')
  returning * into result;
  insert into public.call_participants ("callId", "companyId", "userId", "userName", status, "invitedBy", "invitedByName", "joinedAt")
  values (result.id, my_company, me, my_name, 'joined', me, my_name, now());
  insert into public.call_participants ("callId", "companyId", "userId", "userName", status, "invitedBy", "invitedByName")
  select result.id, my_company, p.id, p."fullName", 'ringing', me, my_name from public.profiles p where p.id = any (others);
  return result;
end;
$$;
revoke all on function public.call_open(bigint, text) from public, anon;
grant execute on function public.call_open(bigint, text) to authenticated;

-- Agregar personas de la empresa a la llamada en curso.
create or replace function public.call_invite(target_call bigint, user_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  my_name text := (select "fullName" from public.profiles where id = me);
  c public.calls;
begin
  select * into c from public.calls where id = target_call and "companyId" = public.current_company_id();
  if not found or c.status not in ('ringing', 'accepted') then
    raise exception 'La llamada ya terminó.';
  end if;
  if not exists (select 1 from public.call_participants where "callId" = target_call and "userId" = me and status = 'joined') then
    raise exception 'Únete a la llamada para agregar a alguien.';
  end if;
  if (select count(*) from public.call_participants where "callId" = target_call and status in ('joined', 'ringing'))
     + coalesce(array_length(user_ids, 1), 0) > 8 then
    raise exception 'Las llamadas son de hasta 8 personas.';
  end if;
  perform public.hit_rate_limit('call_invite', me::text, 40, interval '10 minutes', 'Demasiadas invitaciones seguidas.');
  insert into public.call_participants ("callId", "companyId", "userId", "userName", status, "invitedBy", "invitedByName")
  select target_call, c."companyId", p.id, p."fullName", 'ringing', me, my_name
  from public.profiles p
  where p.id = any (coalesce(user_ids, '{}')) and p."companyId" = c."companyId" and p.id <> me
  on conflict ("callId", "userId") do update
    set status = 'ringing', "invitedBy" = excluded."invitedBy", "invitedByName" = excluded."invitedByName", "invitedAt" = now(), "pushedAt" = null, "leftAt" = null
    where public.call_participants.status <> 'joined';
end;
$$;
revoke all on function public.call_invite(bigint, uuid[]) from public, anon;
grant execute on function public.call_invite(bigint, uuid[]) to authenticated;

-- Unirse: quien fue invitado, o cualquiera de la empresa con el enlace.
create or replace function public.call_join(target_call bigint)
returns public.calls
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  c public.calls;
  old_call bigint;
begin
  select * into c from public.calls where id = target_call and "companyId" = public.current_company_id() for update;
  if not found or c.status not in ('ringing', 'accepted') then
    raise exception 'La llamada ya terminó.';
  end if;
  if (select count(*) from public.call_participants where "callId" = target_call and status = 'joined') >= 8
     and not exists (select 1 from public.call_participants where "callId" = target_call and "userId" = me and status = 'joined') then
    raise exception 'La llamada ya tiene 8 personas.';
  end if;
  for old_call in select "callId" from public.call_participants where "userId" = me and status = 'joined' and "callId" <> target_call loop
    update public.call_participants set status = 'left', "leftAt" = now() where "callId" = old_call and "userId" = me;
    perform public.finish_call_if_done(old_call);
  end loop;
  insert into public.call_participants ("callId", "companyId", "userId", "userName", status, "joinedAt", "invitedAt", "pushedAt")
  values (target_call, c."companyId", me, (select "fullName" from public.profiles where id = me), 'joined', now(), now(), now())
  on conflict ("callId", "userId") do update set status = 'joined', "joinedAt" = now(), "leftAt" = null;
  if c."answeredAt" is null and me <> c."callerId" then
    update public.calls set status = 'accepted', "answeredAt" = now() where id = target_call returning * into c;
  end if;
  return c;
end;
$$;
revoke all on function public.call_join(bigint) from public, anon;
grant execute on function public.call_join(bigint) to authenticated;

-- Salir, colgar o rechazar. reason: left, declined, missed o busy.
create or replace function public.call_leave(target_call bigint, reason text default 'left')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  current_status text;
begin
  select status into current_status from public.call_participants where "callId" = target_call and "userId" = me for update;
  if current_status is null then
    raise exception 'No estás en esa llamada.';
  end if;
  if current_status = 'joined' then
    update public.call_participants set status = 'left', "leftAt" = now() where "callId" = target_call and "userId" = me;
  elsif current_status = 'ringing' then
    update public.call_participants
    set status = case when reason in ('busy', 'missed') then reason else 'declined' end, "leftAt" = now()
    where "callId" = target_call and "userId" = me;
  end if;
  perform public.finish_call_if_done(target_call);
end;
$$;
revoke all on function public.call_leave(bigint, text) from public, anon;
grant execute on function public.call_leave(bigint, text) to authenticated;

-- Mandar los datos para conectar con una persona de la llamada.
create or replace function public.call_signal(target_call bigint, to_user uuid, signal_kind text, signal_sdp text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if signal_kind is null or signal_kind not in ('offer', 'answer') or signal_sdp is null or char_length(signal_sdp) > 40000 then
    raise exception 'Datos de conexión no válidos.';
  end if;
  if not exists (select 1 from public.call_participants where "callId" = target_call and "userId" = me and status = 'joined')
     or not exists (select 1 from public.call_participants where "callId" = target_call and "userId" = to_user and status = 'joined') then
    raise exception 'Esa persona no está en la llamada.';
  end if;
  perform public.hit_rate_limit('call_signal', me::text, 300, interval '10 minutes', 'Demasiados intentos de conexión.');
  insert into public.call_signals ("callId", "fromUser", "toUser", kind, sdp) values (target_call, me, to_user, signal_kind, signal_sdp);
  -- Solo hace falta lo reciente.
  delete from public.call_signals where "createdAt" < now() - interval '1 day';
end;
$$;
revoke all on function public.call_signal(bigint, uuid, text, text) from public, anon;
grant execute on function public.call_signal(bigint, uuid, text, text) to authenticated;

-- Para el enlace compartido: de qué es la llamada antes de unirse.
create or replace function public.call_preview(target_call bigint)
returns table (id bigint, kind text, status text, "callerName" text, "channelId" bigint, people integer)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.kind, c.status, c."callerName", c."channelId",
    (select count(*)::int from public.call_participants p where p."callId" = c.id and p.status = 'joined')
  from public.calls c
  where c.id = target_call and c."companyId" = public.current_company_id();
$$;
revoke all on function public.call_preview(bigint) from public, anon;
grant execute on function public.call_preview(bigint) to authenticated;

-- Aviso a quien invitan a una llamada.
create or replace function public.request_push_call()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'ringing' and new."pushedAt" is null then
    begin
      perform net.http_post(
        url := 'https://bwvetvomcfmolhfrrlcx.supabase.co/functions/v1/push',
        body := jsonb_build_object('table', 'call_participants', 'id', new.id),
        headers := '{"Content-Type": "application/json"}'::jsonb,
        timeout_milliseconds := 5000
      );
    exception when others then
      null;
    end;
  end if;
  return null;
end;
$$;
revoke all on function public.request_push_call() from public, anon, authenticated;
drop trigger if exists request_push_call on public.call_participants;
create trigger request_push_call
  after insert or update of status on public.call_participants
  for each row execute function public.request_push_call();

-- ------------------------------------------------------------
-- 5. Tiempo real
-- ------------------------------------------------------------
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['call_participants', 'call_signals'] loop
      if not exists (
        select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ============================================================
-- Listo. Verifica en Table Editor que existan "call_participants" y
-- "call_signals". Después vuelve a desplegar la función "push".
-- ============================================================
