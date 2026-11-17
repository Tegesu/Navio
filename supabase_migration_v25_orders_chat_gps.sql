-- ============================================================
-- NAVIO — Migración v25: órdenes de trabajo para garantías, mensajes
--                         completos y GPS fijos en las unidades
-- ============================================================
-- Qué hace:
--   1. ÓRDENES DE TRABAJO. Cada orden puede asignarse a quien analiza
--      garantías. Su proceso:
--        pendiente de carga → (quien carga avisa "ya cargué todas las
--        facturas") → pendiente de verificación → (todas verificadas) →
--        en análisis por garantías → (el analista la cierra) → cerrada.
--      Asigna un administrador o quien revisa facturas; avisar que ya están
--      todas las facturas lo hace cualquiera de la empresa; cerrar el
--      análisis, la persona asignada o un administrador.
--   2. MENSAJES:
--      - Enviado / recibido / visto (por persona, en "Información").
--      - Responder, reenviar, editar (15 minutos), reaccionar, fijar (hasta
--        3 por conversación), destacar, borrar para todos o solo para mí.
--      - Fotos, videos, documentos, notas de voz y stickers. Los archivos
--        viven en un almacén aparte ("chat"): solo los ven las personas de
--        esa conversación.
--   3. GPS FIJOS. Un administrador da de alta cada GPS por su número de
--      serie (IMEI) y lo liga a una unidad. Al encender la unidad empieza
--      su recorrido (y si tenía un traslado programado para hoy, pasa a
--      "en curso"); al apagarla, el recorrido se cierra. La señal llega por
--      el receptor (Traccar) a gps-ingest con una firma secreta; Navio
--      rechaza los GPS que no estén dados de alta.
--
-- Cómo aplicarla: pega TODO este archivo en Supabase → SQL Editor → Run.
-- Va DESPUÉS de la v24. Se puede correr más de una vez.
-- Después: volver a desplegar gps-ingest y publicar la página.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Órdenes de trabajo
-- ------------------------------------------------------------
alter table public.work_orders
  add column if not exists "assignedTo" uuid references auth.users (id) on delete set null,
  add column if not exists "assignedToName" text,
  add column if not exists "invoicesComplete" boolean not null default false,
  add column if not exists "invoicesCompleteAt" timestamptz,
  add column if not exists "invoicesCompleteByName" text,
  add column if not exists "analysisStatus" text not null default 'open',
  add column if not exists "analysisDoneAt" timestamptz,
  add column if not exists "analysisNotes" text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'work_orders_analysis_known') then
    alter table public.work_orders add constraint work_orders_analysis_known check ("analysisStatus" in ('open', 'done'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'work_orders_notes_len') then
    alter table public.work_orders add constraint work_orders_notes_len check (char_length("analysisNotes") <= 2000);
  end if;
end;
$$;

-- Quién puede mover cada parte del proceso. Lo que no le toca se conserva.
create or replace function public.work_order_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  reviewer boolean;
  my_name text;
begin
  if me is null or current_setting('navio.trusted_write', true) = 'on' then
    return new;
  end if;
  reviewer := public.has_permission('invoices');
  my_name := (select "fullName" from public.profiles where id = me);

  if tg_op = 'INSERT' then
    if new."assignedTo" is not null and not reviewer then
      new."assignedTo" := null;
    end if;
    if new."invoicesComplete" then
      new."invoicesCompleteAt" := now();
      new."invoicesCompleteByName" := my_name;
    end if;
    new."analysisStatus" := 'open';
    new."analysisDoneAt" := null;
  else
    -- Asignar: administrador o quien revisa facturas.
    if new."assignedTo" is distinct from old."assignedTo" and not reviewer then
      raise exception 'Solo un administrador o quien revisa facturas puede asignar la orden.';
    end if;
    -- Facturas completas: cualquiera la marca; desmarcarla, quien revisa o
    -- la persona asignada.
    if new."invoicesComplete" is distinct from old."invoicesComplete" then
      if not new."invoicesComplete" and not (reviewer or old."assignedTo" = me) then
        raise exception 'Solo quien revisa facturas o la persona asignada puede regresar la orden a carga.';
      end if;
      new."invoicesCompleteAt" := case when new."invoicesComplete" then now() end;
      new."invoicesCompleteByName" := case when new."invoicesComplete" then my_name end;
    else
      new."invoicesCompleteAt" := old."invoicesCompleteAt";
      new."invoicesCompleteByName" := old."invoicesCompleteByName";
    end if;
    -- Cerrar o reabrir el análisis: la persona asignada o un administrador.
    if new."analysisStatus" is distinct from old."analysisStatus" or new."analysisNotes" is distinct from old."analysisNotes" then
      if not (public.is_company_admin() or old."assignedTo" = me) then
        raise exception 'Solo la persona asignada o un administrador puede cambiar el análisis de la orden.';
      end if;
      if new."analysisStatus" = 'done' and not new."invoicesComplete" then
        raise exception 'Primero tienen que estar cargadas todas las facturas de la orden.';
      end if;
    end if;
    new."analysisDoneAt" := case when new."analysisStatus" = 'done' then coalesce(old."analysisDoneAt", now()) end;
  end if;

  if new."assignedTo" is not null and (tg_op = 'INSERT' or new."assignedTo" is distinct from old."assignedTo") then
    if not exists (select 1 from public.profiles where id = new."assignedTo" and "companyId" = new."companyId") then
      raise exception 'Esa persona no pertenece a tu empresa.';
    end if;
    new."assignedToName" := (select "fullName" from public.profiles where id = new."assignedTo");
  elsif new."assignedTo" is null then
    new."assignedToName" := null;
  end if;
  return new;
end;
$$;
revoke all on function public.work_order_rules() from public, anon, authenticated;

drop trigger if exists work_order_rules on public.work_orders;
create trigger work_order_rules
  before insert or update on public.work_orders
  for each row execute function public.work_order_rules();

-- Avisos: a quien le asignan una orden y cuando ya están todas sus facturas.
create or replace function public.notify_work_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  label text := 'Orden ' || new.code || case when coalesce(new.project, '') <> '' then ' · ' || new.project else '' end;
  link jsonb := jsonb_build_object('tab', 'warranties', 'sub', 'orders', 'id', new.id);
begin
  if new."assignedTo" is not null and new."assignedTo" is distinct from auth.uid()
     and (tg_op = 'INSERT' or new."assignedTo" is distinct from old."assignedTo") then
    perform public.notify_user(new."assignedTo", new."companyId", 'task', 'Te asignaron una orden para analizar', label, link);
  end if;
  if tg_op = 'UPDATE' and new."invoicesComplete" and not old."invoicesComplete"
     and new."assignedTo" is not null and new."assignedTo" is distinct from auth.uid() then
    perform public.notify_user(new."assignedTo", new."companyId", 'invoice', 'Ya están todas las facturas', label, link);
  end if;
  return null;
end;
$$;
revoke all on function public.notify_work_order() from public, anon, authenticated;

drop trigger if exists notify_work_order on public.work_orders;
create trigger notify_work_order
  after insert or update on public.work_orders
  for each row execute function public.notify_work_order();

-- ------------------------------------------------------------
-- 2. Mensajes
-- ------------------------------------------------------------
alter table public.chat_messages
  add column if not exists kind text not null default 'text',
  add column if not exists attachment jsonb,
  add column if not exists "replyToId" bigint references public.chat_messages (id) on delete set null,
  add column if not exists forwarded boolean not null default false,
  add column if not exists "editedAt" timestamptz,
  add column if not exists "pinnedAt" timestamptz,
  add column if not exists "pinnedBy" uuid;

alter table public.chat_members add column if not exists "lastDeliveredAt" timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chat_messages_kind_known') then
    alter table public.chat_messages add constraint chat_messages_kind_known check (kind in ('text', 'image', 'video', 'file', 'voice', 'sticker'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chat_messages_attachment_size') then
    alter table public.chat_messages add constraint chat_messages_attachment_size check (attachment is null or octet_length(attachment::text) <= 2000);
  end if;
end;
$$;

-- Nombre de un archivo del chat: empresa/conversación/uuid.extensión.
create or replace function public.chat_file_ok(object_name text, target_channel bigint)
returns boolean
language sql
immutable
as $$
  select object_name ~ ('^[0-9]+/' || target_channel::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|gif|mp4|webm|mov|m4a|mp3|ogg|oga|aac|wav|pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|zip)$');
$$;
revoke all on function public.chat_file_ok(text, bigint) from public, anon;
grant execute on function public.chat_file_ok(text, bigint) to authenticated;

-- Remitente, empresa y hora los pone la base. Un mensaje con archivo puede
-- ir sin texto; el archivo tiene que estar en la carpeta de su conversación.
create or replace function public.prepare_chat_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  channel_company bigint := (select "companyId" from public.chat_channels where id = new."channelId");
  path text := new.attachment ->> 'path';
begin
  new.body := trim(coalesce(new.body, ''));
  new.kind := coalesce(new.kind, 'text');
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
  new."senderId" := auth.uid();
  new."senderName" := (select "fullName" from public.profiles where id = auth.uid());
  new."companyId" := channel_company;
  new."createdAt" := now();
  new."deletedAt" := null;
  new."editedAt" := null;
  new."pinnedAt" := null;
  new."pinnedBy" := null;
  return new;
end;
$$;

-- Editar: solo quien lo escribió, hasta 15 minutos después.
create or replace function public.edit_chat_message(target_message bigint, new_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  message public.chat_messages;
  clean text := trim(coalesce(new_body, ''));
begin
  select * into message from public.chat_messages where id = target_message and "companyId" = public.current_company_id();
  if not found or not public.can_access_channel(message."channelId") then
    raise exception 'Ese mensaje no existe.';
  end if;
  if message."senderId" is distinct from auth.uid() then
    raise exception 'Solo quien escribió el mensaje puede editarlo.';
  end if;
  if message."deletedAt" is not null then
    raise exception 'Ese mensaje ya se borró.';
  end if;
  if message."createdAt" < now() - interval '15 minutes' then
    raise exception 'Un mensaje solo se puede editar en los primeros 15 minutos.';
  end if;
  if message.kind = 'sticker' or message.kind = 'voice' then
    raise exception 'Ese mensaje no se puede editar.';
  end if;
  if clean = '' and message.kind = 'text' then
    raise exception 'El mensaje está vacío.';
  end if;
  if char_length(clean) > 4000 then
    raise exception 'El mensaje es demasiado largo.';
  end if;
  update public.chat_messages set body = clean, "editedAt" = now() where id = target_message;
end;
$$;
revoke all on function public.edit_chat_message(bigint, text) from public, anon;
grant execute on function public.edit_chat_message(bigint, text) to authenticated;

-- Borrar para todos: quien lo escribió o un administrador. Devuelve el
-- archivo que hay que quitar del almacén.
create or replace function public.delete_chat_message(target_message bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  message public.chat_messages;
begin
  select * into message from public.chat_messages where id = target_message and "companyId" = public.current_company_id();
  if not found or not public.can_access_channel(message."channelId") then
    raise exception 'Ese mensaje no existe.';
  end if;
  if message."senderId" is distinct from auth.uid() and not public.is_company_admin() then
    raise exception 'Solo quien lo escribió o un administrador puede borrarlo para todos.';
  end if;
  update public.chat_messages
  set body = '', attachment = null, "deletedAt" = now(), "pinnedAt" = null, "pinnedBy" = null
  where id = target_message;
  delete from public.chat_reactions where "messageId" = target_message;
end;
$$;

-- Fijar (hasta 3 por conversación: al fijar un cuarto se suelta el más viejo).
create or replace function public.pin_chat_message(target_message bigint, pin boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  message public.chat_messages;
begin
  select * into message from public.chat_messages where id = target_message and "companyId" = public.current_company_id();
  if not found or not public.can_access_channel(message."channelId") or message."deletedAt" is not null then
    raise exception 'Ese mensaje no existe.';
  end if;
  if pin then
    update public.chat_messages set "pinnedAt" = now(), "pinnedBy" = auth.uid() where id = target_message;
    update public.chat_messages set "pinnedAt" = null, "pinnedBy" = null
    where id in (
      select id from public.chat_messages
      where "channelId" = message."channelId" and "pinnedAt" is not null
      order by "pinnedAt" desc
      offset 3
    );
  else
    update public.chat_messages set "pinnedAt" = null, "pinnedBy" = null where id = target_message;
  end if;
end;
$$;
revoke all on function public.pin_chat_message(bigint, boolean) from public, anon;
grant execute on function public.pin_chat_message(bigint, boolean) to authenticated;

-- Recibido: el teléfono o la computadora ya trajo los mensajes.
create or replace function public.mark_channels_delivered()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  my_company bigint := public.current_company_id();
  general_id bigint;
begin
  if auth.uid() is null or my_company is null then
    return;
  end if;
  select id into general_id from public.chat_channels where "companyId" = my_company and kind = 'general';
  if general_id is not null then
    insert into public.chat_members ("channelId", "userId", "lastReadAt", "lastDeliveredAt")
    values (general_id, auth.uid(), now() - interval '3 days', now())
    on conflict ("channelId", "userId") do nothing;
  end if;
  update public.chat_members m set "lastDeliveredAt" = now()
  from public.chat_channels c
  where m."userId" = auth.uid() and c.id = m."channelId" and c."companyId" = my_company;
end;
$$;
revoke all on function public.mark_channels_delivered() from public, anon;
grant execute on function public.mark_channels_delivered() to authenticated;

-- Leer también cuenta como recibido.
create or replace function public.mark_channel_read(target_channel bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_access_channel(target_channel) then
    return;
  end if;
  insert into public.chat_members ("channelId", "userId", "lastReadAt", "lastDeliveredAt")
  values (target_channel, auth.uid(), now(), now())
  on conflict ("channelId", "userId") do update set "lastReadAt" = now(), "lastDeliveredAt" = now();
end;
$$;

-- Hasta dónde recibieron y leyeron TODOS los demás de la conversación (para
-- las palomitas). En el canal general cuenta toda la empresa.
create or replace function public.channel_receipts(target_channel bigint)
returns table ("deliveredUntil" timestamptz, "readUntil" timestamptz, others integer)
language sql
stable
security definer
set search_path = public
as $$
  with channel as (
    select c.* from public.chat_channels c
    where c.id = target_channel and public.can_access_channel(c.id)
  ), people as (
    select p.id from public.profiles p, channel c
    where c.kind = 'general' and p."companyId" = c."companyId" and p.id <> auth.uid()
    union
    select m."userId" from public.chat_members m, channel c
    where c.kind <> 'general' and m."channelId" = c.id and m."userId" <> auth.uid()
  )
  select
    case when bool_and(m."lastDeliveredAt" is not null) then min(m."lastDeliveredAt") end,
    case when bool_and(m."lastReadAt" is not null) then min(m."lastReadAt") end,
    count(*)::int
  from people
  left join public.chat_members m on m."userId" = people.id and m."channelId" = target_channel;
$$;
revoke all on function public.channel_receipts(bigint) from public, anon;
grant execute on function public.channel_receipts(bigint) to authenticated;

-- "Información del mensaje": quién lo recibió y quién lo vio.
create or replace function public.message_receipts(target_message bigint)
returns table ("userId" uuid, name text, "deliveredAt" timestamptz, "readAt" timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with message as (
    select m.* from public.chat_messages m
    where m.id = target_message and m."companyId" = public.current_company_id() and public.can_access_channel(m."channelId")
  ), channel as (
    select c.* from public.chat_channels c join message on message."channelId" = c.id
  ), people as (
    select p.id from public.profiles p, channel c
    where c.kind = 'general' and p."companyId" = c."companyId"
    union
    select m."userId" from public.chat_members m, channel c
    where c.kind <> 'general' and m."channelId" = c.id
  )
  select p.id, p."fullName",
    case when cm."lastDeliveredAt" >= message."createdAt" then cm."lastDeliveredAt" end,
    case when cm."lastReadAt" >= message."createdAt" then cm."lastReadAt" end
  from people
  join public.profiles p on p.id = people.id
  cross join message
  left join public.chat_members cm on cm."userId" = p.id and cm."channelId" = message."channelId"
  where p.id is distinct from message."senderId"
  order by p."fullName";
$$;
revoke all on function public.message_receipts(bigint) from public, anon;
grant execute on function public.message_receipts(bigint) to authenticated;

-- Reacciones (una por persona y mensaje).
create table if not exists public.chat_reactions (
  "messageId" bigint not null references public.chat_messages (id) on delete cascade,
  "userId" uuid not null references auth.users (id) on delete cascade,
  "channelId" bigint not null references public.chat_channels (id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  "userName" text,
  "createdAt" timestamptz not null default now(),
  primary key ("messageId", "userId")
);
create index if not exists chat_reactions_channel_idx on public.chat_reactions ("channelId");

-- "Borrar para mí" y "Destacar": de cada persona.
create table if not exists public.chat_hidden (
  "messageId" bigint not null references public.chat_messages (id) on delete cascade,
  "userId" uuid not null default auth.uid() references auth.users (id) on delete cascade,
  "createdAt" timestamptz not null default now(),
  primary key ("messageId", "userId")
);
create table if not exists public.chat_stars (
  "messageId" bigint not null references public.chat_messages (id) on delete cascade,
  "userId" uuid not null default auth.uid() references auth.users (id) on delete cascade,
  "channelId" bigint references public.chat_channels (id) on delete cascade,
  "createdAt" timestamptz not null default now(),
  primary key ("messageId", "userId")
);

-- Stickers de cada persona (importados, por ejemplo, de WhatsApp).
create table if not exists public.chat_stickers (
  id bigint generated always as identity primary key,
  "userId" uuid not null default auth.uid() references auth.users (id) on delete cascade,
  "companyId" bigint not null references public.companies (id) on delete cascade,
  path text not null check (char_length(path) <= 300),
  pack text not null default 'Mis stickers' check (char_length(pack) between 1 and 60),
  "createdAt" timestamptz not null default now()
);
create index if not exists chat_stickers_user_idx on public.chat_stickers ("userId", pack);

-- Sellos y validaciones de las tablas de cada persona.
create or replace function public.prepare_chat_extra()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  message_channel bigint;
begin
  if tg_table_name = 'chat_stickers' then
    new."userId" := auth.uid();
    new."companyId" := public.current_company_id();
    if new.path !~ ('^' || new."companyId"::text || '/stickers/' || auth.uid()::text || '/[0-9a-f-]{36}\.(webp|png|gif)$') then
      raise exception 'El sticker no es válido.';
    end if;
    if (select count(*) from public.chat_stickers where "userId" = auth.uid()) >= 300 then
      raise exception 'Llegaste al máximo de 300 stickers.';
    end if;
    new.pack := left(trim(coalesce(new.pack, 'Mis stickers')), 60);
    return new;
  end if;
  select "channelId" into message_channel from public.chat_messages
  where id = new."messageId" and "deletedAt" is null;
  if message_channel is null or not public.can_access_channel(message_channel) then
    raise exception 'Ese mensaje no existe.';
  end if;
  new."userId" := auth.uid();
  if tg_table_name = 'chat_reactions' then
    new."channelId" := message_channel;
    new."userName" := (select "fullName" from public.profiles where id = auth.uid());
    new."createdAt" := now();
  elsif tg_table_name = 'chat_stars' then
    new."channelId" := message_channel;
  end if;
  return new;
end;
$$;
revoke all on function public.prepare_chat_extra() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['chat_reactions', 'chat_hidden', 'chat_stars', 'chat_stickers'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop trigger if exists a_prepare_chat_extra on public.%I', t);
    execute format('create trigger a_prepare_chat_extra before insert or update on public.%I for each row execute function public.prepare_chat_extra()', t);
  end loop;
end;
$$;

drop policy if exists "chat_reactions_select" on public.chat_reactions;
create policy "chat_reactions_select" on public.chat_reactions
  for select to authenticated using (public.can_access_channel("channelId"));
drop policy if exists "chat_reactions_write_own" on public.chat_reactions;
create policy "chat_reactions_write_own" on public.chat_reactions
  for all to authenticated using ("userId" = auth.uid()) with check ("userId" = auth.uid());

drop policy if exists "chat_hidden_own" on public.chat_hidden;
create policy "chat_hidden_own" on public.chat_hidden
  for all to authenticated using ("userId" = auth.uid()) with check ("userId" = auth.uid());

drop policy if exists "chat_stars_own" on public.chat_stars;
create policy "chat_stars_own" on public.chat_stars
  for all to authenticated using ("userId" = auth.uid()) with check ("userId" = auth.uid());

drop policy if exists "chat_stickers_own" on public.chat_stickers;
create policy "chat_stickers_own" on public.chat_stickers
  for all to authenticated using ("userId" = auth.uid()) with check ("userId" = auth.uid() and "companyId" = public.current_company_id());

drop trigger if exists limit_inserts_trigger on public.chat_reactions;
create trigger limit_inserts_trigger before insert on public.chat_reactions
  for each row execute function public.limit_inserts('reactions', '120', '10 minutes', 'Demasiadas reacciones seguidas. Espera un momento.');

-- La lista de conversaciones dice también de qué tipo es el último mensaje.
drop function if exists public.chat_overview();
create function public.chat_overview()
returns table (
  id bigint, kind text, name text, "createdBy" uuid, "otherUserId" uuid, "otherUserName" text,
  "lastMessageAt" timestamptz, "lastMessage" text, "lastSender" text, unread integer, members integer, "lastKind" text
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
    lm.kind
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
    and (c.kind = 'general' or me."userId" is not null)
  order by coalesce(c."lastMessageAt", c."createdAt") desc;
$$;
revoke all on function public.chat_overview() from public, anon;
grant execute on function public.chat_overview() to authenticated;

-- Almacén de archivos del chat (aparte del de facturas).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat', 'chat', false, 26214400,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'video/mp4', 'video/webm', 'video/quicktime',
    'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/wav', 'audio/x-m4a',
    'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain', 'text/csv', 'application/zip'
  ]
)
on conflict (id) do update
set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- ¿Puede quien pregunta usar este archivo del chat? Conversaciones: quien
-- participa en ella. Stickers: solo su dueño (para subir o borrar); para
-- verlos basta ser de la misma empresa.
create or replace function public.can_use_chat_file(object_name text, for_write boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  parts text[] := string_to_array(object_name, '/');
  my_company bigint := public.current_company_id();
begin
  if my_company is null or parts[1] is distinct from my_company::text then
    return false;
  end if;
  if parts[2] = 'stickers' then
    return object_name ~ '^[0-9]+/stickers/[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|png|gif)$'
       and (not for_write or parts[3] = auth.uid()::text);
  end if;
  if parts[2] !~ '^[0-9]{1,18}$' then
    return false;
  end if;
  return public.can_access_channel(parts[2]::bigint)
     and (not for_write or public.chat_file_ok(object_name, parts[2]::bigint));
end;
$$;
revoke all on function public.can_use_chat_file(text, boolean) from public, anon;
grant execute on function public.can_use_chat_file(text, boolean) to authenticated;

drop policy if exists "chat_files_select" on storage.objects;
create policy "chat_files_select" on storage.objects
  for select to authenticated using (bucket_id = 'chat' and public.can_use_chat_file(name, false));

drop policy if exists "chat_files_insert" on storage.objects;
create policy "chat_files_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'chat' and public.can_use_chat_file(name, true) and public.allow_upload());

drop policy if exists "chat_files_delete" on storage.objects;
create policy "chat_files_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'chat'
    and (storage.foldername(name))[1] = public.current_company_id()::text
    and (owner_id = auth.uid()::text or public.is_company_admin())
  );

-- ------------------------------------------------------------
-- 3. GPS fijos en las unidades
-- ------------------------------------------------------------
create table if not exists public.gps_devices (
  id bigint generated always as identity primary key,
  "companyId" bigint not null references public.companies (id) on delete cascade,
  "vehicleId" bigint references public.vehicles (id) on delete set null,
  imei text not null unique check (imei ~ '^[0-9]{10,20}$'),
  label text check (char_length(label) <= 100),
  active boolean not null default true,
  "lastSeenAt" timestamptz,
  "lastIgnition" boolean,
  "createdBy" uuid default auth.uid() references auth.users (id) on delete set null,
  "createdAt" timestamptz not null default now()
);
create index if not exists gps_devices_company_idx on public.gps_devices ("companyId");

alter table public.gps_devices enable row level security;

drop policy if exists "gps_devices_select" on public.gps_devices;
create policy "gps_devices_select" on public.gps_devices
  for select to authenticated using ("companyId" = public.current_company_id());

drop policy if exists "gps_devices_admin_write" on public.gps_devices;
create policy "gps_devices_admin_write" on public.gps_devices
  for all to authenticated
  using ("companyId" = public.current_company_id() and public.is_company_admin())
  with check ("companyId" = public.current_company_id() and public.is_company_admin());

-- La unidad tiene que ser de la misma empresa; la última señal la pone el servidor.
create or replace function public.check_gps_device()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new."vehicleId" is not null and not exists (
    select 1 from public.vehicles where id = new."vehicleId" and "companyId" = new."companyId"
  ) then
    raise exception 'Esa unidad no pertenece a tu empresa.';
  end if;
  new.imei := regexp_replace(coalesce(new.imei, ''), '\s', '', 'g');
  if current_user = 'authenticated' then
    if tg_op = 'UPDATE' then
      new."lastSeenAt" := old."lastSeenAt";
      new."lastIgnition" := old."lastIgnition";
    else
      new."lastSeenAt" := null;
      new."lastIgnition" := null;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.check_gps_device() from public, anon, authenticated;

drop trigger if exists check_gps_device on public.gps_devices;
create trigger check_gps_device
  before insert or update on public.gps_devices
  for each row execute function public.check_gps_device();

drop trigger if exists a_lock_columns on public.gps_devices;
create trigger a_lock_columns before update on public.gps_devices
  for each row execute function public.lock_columns('id', 'companyId', 'createdAt', 'createdBy');
drop trigger if exists a_stamp_client_insert on public.gps_devices;
create trigger a_stamp_client_insert before insert on public.gps_devices
  for each row execute function public.stamp_client_insert('createdBy', 'createdAt');
drop trigger if exists audit_gps_devices on public.gps_devices;
create trigger audit_gps_devices after insert or update or delete on public.gps_devices
  for each row execute function public.audit_row_change();

-- Los recorridos pueden venir de un GPS fijo.
alter table public.routes add column if not exists "gpsDeviceId" bigint references public.gps_devices (id) on delete set null;
alter table public.routes drop constraint if exists routes_source_check;
alter table public.routes add constraint routes_source_check check (source in ('phone', 'tracker', 'gps'));

-- Lo que manda el receptor por cada GPS. Solo la llama gps-ingest (llave de
-- servicio), después de comprobar la firma del receptor.
--   ignition: true (encendida), false (apagada) o null (el GPS no lo dice:
--   se toma como encendida si va a más de 5 km/h).
create or replace function public.gps_device_report(device_imei text, points jsonb, ignition boolean default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  device public.gps_devices;
  vehicle public.vehicles;
  active_route public.routes;
  trip public.trips;
  moving boolean;
  on_now boolean;
  today date := (now() at time zone 'America/Mexico_City')::date;
  result jsonb := '{}'::jsonb;
begin
  select * into device from public.gps_devices
  where imei = regexp_replace(coalesce(device_imei, ''), '\s', '', 'g') and active;
  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;
  perform public.hit_rate_limit('gps_device', device.id::text, 1200, interval '10 minutes', 'Demasiados envíos del GPS.');

  if not exists (select 1 from public.companies where id = device."companyId" and status = 'approved') then
    return jsonb_build_object('status', 'inactive');
  end if;

  select coalesce(bool_or(coalesce((value ->> 'speed')::numeric, 0) > 5), false) into moving
  from jsonb_array_elements(case when jsonb_typeof(points) = 'array' then points else '[]'::jsonb end);
  on_now := coalesce(ignition, moving);

  update public.gps_devices set "lastSeenAt" = now(), "lastIgnition" = coalesce(ignition, "lastIgnition") where id = device.id;

  if device."vehicleId" is null then
    return jsonb_build_object('status', 'unassigned');
  end if;
  select * into vehicle from public.vehicles where id = device."vehicleId";

  select * into active_route from public.routes
  where "vehicleId" = device."vehicleId" and status = 'active' and source = 'gps'
  order by "startedAt" desc limit 1;

  -- Un recorrido sin señal por más de 30 minutos se da por terminado.
  if active_route.id is not null and coalesce(active_route."lastPointAt", active_route."startedAt") < now() - interval '30 minutes' then
    perform public.close_route(active_route.id, true);
    active_route := null;
  end if;

  -- Encendió: empieza el recorrido (y el traslado programado de hoy, si hay).
  if active_route.id is null and on_now then
    insert into public.routes ("companyId", "vehicleId", "driverName", status, "createdBy", source, "gpsDeviceId")
    values (device."companyId", device."vehicleId", coalesce(vehicle.driver ->> 'name', vehicle.unit), 'active', null, 'gps', device.id)
    returning * into active_route;
    select * into trip from public.trips
    where "companyId" = device."companyId" and "vehicleId" = device."vehicleId" and status = 'scheduled' and date = today
    order by id limit 1;
    if found then
      update public.routes set "tripId" = trip.id where id = active_route.id;
      update public.trips set status = 'ongoing', "startedAt" = coalesce("startedAt", now()), "routeId" = active_route.id where id = trip.id;
      active_route."tripId" := trip.id;
    end if;
    result := result || jsonb_build_object('started', active_route.id);
  end if;

  if active_route.id is not null and jsonb_typeof(points) = 'array' and jsonb_array_length(points) > 0 then
    result := result || public.append_route_points(active_route.id, points, null, 'gps');
  end if;

  -- Apagó: se cierra el recorrido y su traslado.
  if active_route.id is not null and ignition is false then
    perform public.close_route(active_route.id, true);
    result := result || jsonb_build_object('closed', active_route.id);
  end if;

  return result || jsonb_build_object('status', case when active_route.id is null then 'idle' else 'tracking' end);
end;
$$;
revoke all on function public.gps_device_report(text, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.gps_device_report(text, jsonb, boolean) to service_role;

-- ------------------------------------------------------------
-- Verificación en dos pasos (v21), sin acceso anónimo y tiempo real
-- ------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['chat_reactions', 'chat_hidden', 'chat_stars', 'chat_stickers', 'gps_devices'] loop
    execute format('drop policy if exists mfa_required on public.%I', t);
    execute format(
      'create policy mfa_required on public.%I as restrictive for all to authenticated using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()))',
      t
    );
    execute format('revoke all on public.%I from anon', t);
  end loop;
end;
$$;

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['chat_reactions', 'chat_members', 'work_orders'] loop
      if not exists (
        select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;

-- ============================================================
-- Listo. Verifica en Table Editor que existan "chat_reactions",
-- "chat_stickers" y "gps_devices", y en Storage el almacén "chat".
-- ============================================================
