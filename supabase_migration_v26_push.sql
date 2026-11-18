-- ============================================================
-- NAVIO — Migración v26: notificaciones con Navio cerrado
-- ============================================================
-- Qué hace:
--   1. Guarda, por persona, los navegadores y los teléfonos con la app de
--      Android donde activó las notificaciones (cada quien ve y borra solo
--      los suyos).
--   2. Cuando llega un mensaje nuevo o un aviso (tarea asignada, alerta,
--      orden de trabajo…), la base le pide a la función "push" que avise a
--      quien corresponde. La función revisa por su cuenta el mensaje o el
--      aviso y lo manda una sola vez.
--
-- Cómo aplicarla: pega TODO este archivo en Supabase → SQL Editor → Run.
-- Va DESPUÉS de la v25. Se puede correr más de una vez.
-- Antes de publicar: desplegar la función "push" (con "Verify JWT"
-- apagado) y guardar en sus secretos VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY y
-- FIREBASE_SERVICE_ACCOUNT (este último, para la app de Android).
-- ============================================================

-- Para que la base pueda llamar a la función "push" (viene con Supabase).
create extension if not exists pg_net;

-- ------------------------------------------------------------
-- 1. Dónde avisar a cada persona
-- ------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id bigint generated always as identity primary key,
  "userId" uuid not null references auth.users (id) on delete cascade,
  "companyId" bigint references public.companies (id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) <= 1000 and endpoint ~ '^https://'),
  p256dh text not null check (char_length(p256dh) between 20 and 200),
  auth text not null check (char_length(auth) between 8 and 100),
  "userAgent" text check (char_length("userAgent") <= 300),
  "createdAt" timestamptz not null default now(),
  "lastUsedAt" timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions ("userId");

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subscriptions_own" on public.push_subscriptions;
create policy "push_subscriptions_own" on public.push_subscriptions
  for select to authenticated using ("userId" = auth.uid());

drop policy if exists mfa_required on public.push_subscriptions;
create policy mfa_required on public.push_subscriptions as restrictive for all to authenticated
  using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));

revoke all on public.push_subscriptions from anon;
revoke insert, update, delete on public.push_subscriptions from authenticated;

-- Activar en este navegador. Si el navegador ya estaba registrado a nombre de
-- otra persona (cambió la sesión en el mismo equipo), pasa a quien lo activa.
create or replace function public.save_push_subscription(sub_endpoint text, sub_p256dh text, sub_auth text, sub_agent text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  my_company bigint := public.current_company_id();
begin
  if me is null or my_company is null then
    raise exception 'Tu sesión no pertenece a una empresa activa.';
  end if;
  perform public.hit_rate_limit('push_subscribe', me::text, 30, interval '1 hour', 'Demasiados intentos. Intenta más tarde.');
  delete from public.push_subscriptions where endpoint = sub_endpoint;
  insert into public.push_subscriptions ("userId", "companyId", endpoint, p256dh, auth, "userAgent")
  values (me, my_company, sub_endpoint, sub_p256dh, sub_auth, left(sub_agent, 300));
  -- Hasta 10 lugares por persona: se quitan los más viejos.
  delete from public.push_subscriptions
  where id in (
    select id from public.push_subscriptions where "userId" = me order by "lastUsedAt" desc offset 10
  );
end;
$$;
revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

create or replace function public.remove_push_subscription(sub_endpoint text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.push_subscriptions where endpoint = sub_endpoint and "userId" = auth.uid();
$$;
revoke all on function public.remove_push_subscription(text) from public, anon;
grant execute on function public.remove_push_subscription(text) to authenticated;

-- ------------------------------------------------------------
-- 2. Avisar al llegar un mensaje o un aviso
-- ------------------------------------------------------------
alter table public.chat_messages add column if not exists "pushedAt" timestamptz;
alter table public.notifications add column if not exists "pushedAt" timestamptz;

-- La base solo dice "hay algo nuevo en tal tabla con tal número"; la función
-- lo lee por su cuenta. Si algo falla aquí, el mensaje se guarda igual.
create or replace function public.request_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform net.http_post(
      url := 'https://bwvetvomcfmolhfrrlcx.supabase.co/functions/v1/push',
      body := jsonb_build_object('table', tg_table_name, 'id', new.id),
      headers := '{"Content-Type": "application/json"}'::jsonb,
      timeout_milliseconds := 5000
    );
  exception when others then
    null;
  end;
  return null;
end;
$$;
revoke all on function public.request_push() from public, anon, authenticated;

drop trigger if exists request_push on public.chat_messages;
create trigger request_push
  after insert on public.chat_messages
  for each row when (new."senderId" is not null)
  execute function public.request_push();

drop trigger if exists request_push on public.notifications;
create trigger request_push
  after insert on public.notifications
  for each row execute function public.request_push();

-- ------------------------------------------------------------
-- 3. Teléfonos con la app de Android (Firebase)
-- ------------------------------------------------------------
create table if not exists public.push_devices (
  id bigint generated always as identity primary key,
  "userId" uuid not null references auth.users (id) on delete cascade,
  "companyId" bigint references public.companies (id) on delete cascade,
  token text not null unique check (char_length(token) between 20 and 4096),
  platform text not null default 'android' check (platform in ('android', 'ios')),
  "createdAt" timestamptz not null default now(),
  "lastUsedAt" timestamptz not null default now()
);
create index if not exists push_devices_user_idx on public.push_devices ("userId");

alter table public.push_devices enable row level security;

drop policy if exists "push_devices_own" on public.push_devices;
create policy "push_devices_own" on public.push_devices
  for select to authenticated using ("userId" = auth.uid());

drop policy if exists mfa_required on public.push_devices;
create policy mfa_required on public.push_devices as restrictive for all to authenticated
  using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));

revoke all on public.push_devices from anon;
revoke insert, update, delete on public.push_devices from authenticated;

create or replace function public.save_push_device(device_token text, device_platform text default 'android')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  my_company bigint := public.current_company_id();
begin
  if me is null or my_company is null then
    raise exception 'Tu sesión no pertenece a una empresa activa.';
  end if;
  perform public.hit_rate_limit('push_subscribe', me::text, 30, interval '1 hour', 'Demasiados intentos. Intenta más tarde.');
  delete from public.push_devices where token = device_token;
  insert into public.push_devices ("userId", "companyId", token, platform)
  values (me, my_company, device_token, case when device_platform = 'ios' then 'ios' else 'android' end);
  delete from public.push_devices
  where id in (select id from public.push_devices where "userId" = me order by "lastUsedAt" desc offset 10);
end;
$$;
revoke all on function public.save_push_device(text, text) from public, anon;
grant execute on function public.save_push_device(text, text) to authenticated;

create or replace function public.remove_push_device(device_token text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.push_devices where token = device_token and "userId" = auth.uid();
$$;
revoke all on function public.remove_push_device(text) from public, anon;
grant execute on function public.remove_push_device(text) to authenticated;

-- ============================================================
-- Listo. Verifica en Table Editor que existan "push_subscriptions" y
-- "push_devices".
-- ============================================================
