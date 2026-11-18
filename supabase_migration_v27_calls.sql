-- ============================================================
-- NAVIO — Migración v27: llamadas y videollamadas
-- ============================================================
-- Qué hace:
--   1. Guarda cada llamada (de voz o con video) entre dos personas de una
--      conversación directa: quién llama, a quién, si contestó y cuánto
--      duró. Solo las dos personas de la llamada la pueden ver.
--   2. La llamada se arma con tres funciones (llamar, contestar, colgar);
--      nadie escribe directo en la tabla.
--   3. Al terminar, queda en la conversación un mensaje con la llamada
--      ("Llamada de voz · 2:31" o "Llamada de voz perdida").
--   4. Al llamar, la función "push" avisa a quien recibe la llamada aunque
--      tenga Navio cerrado (y avisa de las llamadas perdidas).
--
-- Cómo aplicarla: pega TODO este archivo en Supabase → SQL Editor → Run.
-- Va DESPUÉS de la v26. Se puede correr más de una vez.
-- Después: volver a desplegar la función "push" (con "Verify JWT" apagado).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Llamadas
-- ------------------------------------------------------------
create table if not exists public.calls (
  id bigint generated always as identity primary key,
  "companyId" bigint not null references public.companies (id) on delete cascade,
  "channelId" bigint not null references public.chat_channels (id) on delete cascade,
  "callerId" uuid not null references auth.users (id) on delete cascade,
  "callerName" text,
  "calleeId" uuid not null references auth.users (id) on delete cascade,
  "calleeName" text,
  kind text not null check (kind in ('audio', 'video')),
  status text not null default 'ringing' check (status in ('ringing', 'accepted', 'ended', 'missed', 'declined', 'cancelled', 'busy', 'failed')),
  -- Datos técnicos para conectar los dos teléfonos (WebRTC).
  offer jsonb check (offer is null or octet_length(offer::text) <= 40000),
  answer jsonb check (answer is null or octet_length(answer::text) <= 40000),
  "createdAt" timestamptz not null default now(),
  "answeredAt" timestamptz,
  "endedAt" timestamptz,
  "endedBy" uuid,
  "pushedAt" timestamptz
);
create index if not exists calls_callee_idx on public.calls ("calleeId", "createdAt" desc);
create index if not exists calls_caller_idx on public.calls ("callerId", "createdAt" desc);

alter table public.calls enable row level security;

drop policy if exists "calls_select" on public.calls;
create policy "calls_select" on public.calls
  for select to authenticated
  using (auth.uid() in ("callerId", "calleeId") and "companyId" = public.current_company_id());

drop policy if exists mfa_required on public.calls;
create policy mfa_required on public.calls as restrictive for all to authenticated
  using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));

revoke all on public.calls from anon;
revoke insert, update, delete on public.calls from authenticated;

-- ------------------------------------------------------------
-- 2. El mensaje de la llamada en la conversación
-- ------------------------------------------------------------
-- Un tipo de mensaje más: "call". Solo lo escribe la base al colgar.
alter table public.chat_messages drop constraint if exists chat_messages_kind_known;
alter table public.chat_messages add constraint chat_messages_kind_known
  check (kind in ('text', 'image', 'video', 'file', 'voice', 'sticker', 'call'));

-- Igual que en la v25, más el caso de las llamadas.
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
  if new.kind = 'call' then
    -- Solo desde end_call (más abajo): nadie puede inventar una llamada.
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

-- Los mensajes de llamada no se editan.
create or replace function public.edit_chat_message_guard()
returns trigger
language plpgsql
as $$
begin
  if old.kind = 'call' and new.body is distinct from old.body and new."deletedAt" is null then
    raise exception 'Este mensaje no se puede editar.';
  end if;
  return new;
end;
$$;
drop trigger if exists edit_chat_message_guard on public.chat_messages;
create trigger edit_chat_message_guard
  before update on public.chat_messages
  for each row execute function public.edit_chat_message_guard();

-- ------------------------------------------------------------
-- 3. Llamar, contestar y colgar
-- ------------------------------------------------------------
-- Llamar a la otra persona de una conversación directa. Devuelve la llamada.
create or replace function public.start_call(target_channel bigint, call_kind text, call_offer jsonb)
returns public.calls
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  my_company bigint := public.current_company_id();
  other uuid;
  result public.calls;
begin
  if me is null or my_company is null then
    raise exception 'Tu sesión no pertenece a una empresa activa.';
  end if;
  if call_kind is null or call_kind not in ('audio', 'video') then
    raise exception 'Tipo de llamada no válido.';
  end if;
  if call_offer is null or jsonb_typeof(call_offer) <> 'object' or call_offer ->> 'type' <> 'offer'
     or coalesce(call_offer ->> 'sdp', '') = '' or octet_length(call_offer::text) > 40000 then
    raise exception 'No se pudo preparar la llamada.';
  end if;
  if not exists (
    select 1 from public.chat_channels c
    join public.chat_members m on m."channelId" = c.id and m."userId" = me
    where c.id = target_channel and c."companyId" = my_company and c.kind = 'direct'
  ) then
    raise exception 'Solo se puede llamar desde una conversación directa.';
  end if;
  select m."userId" into other
  from public.chat_members m
  join public.profiles p on p.id = m."userId" and p."companyId" = my_company
  where m."channelId" = target_channel and m."userId" <> me
  limit 1;
  if other is null then
    raise exception 'Esa persona ya no está en tu empresa.';
  end if;
  perform public.hit_rate_limit('calls', me::text, 20, interval '10 minutes', 'Demasiadas llamadas seguidas. Espera un momento.');
  -- Si se quedó "llamando" otra llamada (se cerró Navio a medias), se cancela.
  update public.calls set status = 'cancelled', "endedAt" = now(), "endedBy" = me
  where "callerId" = me and status = 'ringing';
  insert into public.calls ("companyId", "channelId", "callerId", "callerName", "calleeId", "calleeName", kind, offer)
  values (
    my_company, target_channel, me, (select "fullName" from public.profiles where id = me),
    other, (select "fullName" from public.profiles where id = other),
    call_kind, jsonb_build_object('type', 'offer', 'sdp', call_offer ->> 'sdp')
  )
  returning * into result;
  return result;
end;
$$;
revoke all on function public.start_call(bigint, text, jsonb) from public, anon;
grant execute on function public.start_call(bigint, text, jsonb) to authenticated;

-- Contestar: solo quien recibe la llamada, mientras está sonando.
create or replace function public.answer_call(target_call bigint, call_answer jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  c public.calls;
begin
  select * into c from public.calls where id = target_call and "calleeId" = me for update;
  if not found then
    raise exception 'La llamada ya no existe.';
  end if;
  if c.status <> 'ringing' or c."createdAt" < now() - interval '90 seconds' then
    raise exception 'La llamada ya terminó.';
  end if;
  if call_answer is null or jsonb_typeof(call_answer) <> 'object' or call_answer ->> 'type' <> 'answer'
     or coalesce(call_answer ->> 'sdp', '') = '' or octet_length(call_answer::text) > 40000 then
    raise exception 'No se pudo contestar la llamada.';
  end if;
  update public.calls
  set status = 'accepted', answer = jsonb_build_object('type', 'answer', 'sdp', call_answer ->> 'sdp'), "answeredAt" = now()
  where id = target_call;
end;
$$;
revoke all on function public.answer_call(bigint, jsonb) from public, anon;
grant execute on function public.answer_call(bigint, jsonb) to authenticated;

-- Colgar (o rechazar, o "no contestó"). Cualquiera de las dos personas.
-- end_reason: ended, cancelled, declined, missed, busy o failed.
create or replace function public.end_call(target_call bigint, end_reason text default 'ended')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  c public.calls;
  final text;
  seconds integer;
  label text;
  text_body text;
begin
  select * into c from public.calls where id = target_call and me in ("callerId", "calleeId") for update;
  if not found then
    raise exception 'La llamada ya no existe.';
  end if;
  if c.status not in ('ringing', 'accepted') then
    return; -- ya había terminado
  end if;

  if c.status = 'ringing' then
    if me = c."callerId" then
      final := case when end_reason in ('missed', 'failed') then end_reason else 'cancelled' end;
    else
      final := case
        when end_reason in ('busy', 'failed') then end_reason
        when end_reason = 'missed' and c."createdAt" < now() - interval '40 seconds' then 'missed'
        else 'declined'
      end;
    end if;
  else
    final := case when end_reason = 'failed' then 'failed' else 'ended' end;
  end if;

  update public.calls set status = final, "endedAt" = now(), "endedBy" = me where id = target_call;

  -- El mensaje en la conversación (a nombre de quien llamó).
  seconds := case when c."answeredAt" is not null then greatest(0, extract(epoch from now() - c."answeredAt")::integer) end;
  label := case when c.kind = 'video' then 'Videollamada' else 'Llamada de voz' end;
  text_body := case
    when seconds is not null then label || ' · ' || (seconds / 60)::text || ':' || lpad((seconds % 60)::text, 2, '0')
    else label || ' perdida'
  end;
  perform set_config('navio.call_message', 'on', true);
  insert into public.chat_messages ("channelId", kind, body, attachment, "senderId")
  values (
    c."channelId", 'call', text_body,
    jsonb_strip_nulls(jsonb_build_object('call', c.kind, 'status', final, 'duration', seconds, 'callId', c.id)),
    c."callerId"
  );
  perform set_config('navio.call_message', 'off', true);
end;
$$;
revoke all on function public.end_call(bigint, text) from public, anon;
grant execute on function public.end_call(bigint, text) to authenticated;

-- ------------------------------------------------------------
-- 4. Avisar a quien recibe la llamada (función "push", de la v26)
-- ------------------------------------------------------------
drop trigger if exists request_push on public.calls;
create trigger request_push
  after insert on public.calls
  for each row execute function public.request_push();

-- ------------------------------------------------------------
-- 5. Tiempo real: la llamada suena y se contesta al momento
-- ------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'calls') then
    alter publication supabase_realtime add table public.calls;
  end if;
end $$;

-- ============================================================
-- Listo. Verifica en Table Editor que exista "calls". Después vuelve a
-- desplegar la función "push".
-- ============================================================
