-- ============================================================
-- NAVIO — Migración v21: verificación en dos pasos en la base y
--                         vinculación segura del bot
-- ============================================================
-- Qué hace:
--   1. Quien tiene un autenticador activado (verificación en dos pasos)
--      solo puede ver o cambiar datos con una sesión que ya pasó el código
--      ("aal2"). Antes esto lo exigía solo la página: con la contraseña
--      robada se podía entrar directo a la base sin el código.
--      Quien no tiene autenticador sigue igual.
--   2. El código para vincular el bot de Telegram sirve UNA sola vez: al
--      usarse se genera otro. Cada vinculación queda en la bitácora y les
--      llega un aviso a los administradores (sobre todo si reemplazó al
--      chat anterior). Máximo 10 intentos por hora desde un mismo chat.
--
-- Cómo aplicarla: pega TODO este archivo en Supabase → SQL Editor → Run.
-- Se puede correr más de una vez. Después: redesplegar "telegram-webhook"
-- y publicar la página. No hace falta que nadie vuelva a iniciar sesión:
-- quien ya pasó su código tiene una sesión "aal2".
-- Si alguna vez vuelves a correr la v20, corre después esta v21 otra vez
-- (la v20 reemplaza cuatro funciones que aquí piden el código).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Verificación en dos pasos exigida por la base
-- ------------------------------------------------------------
-- Verdadero si la sesión ya pasó el código o si la persona no tiene
-- ningún autenticador verificado.
create or replace function public.mfa_satisfied()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not exists (
        select 1 from auth.mfa_factors f
        where f.user_id = auth.uid() and f.status = 'verified'
      );
$$;
revoke all on function public.mfa_satisfied() from public, anon;
grant execute on function public.mfa_satisfied() to authenticated, service_role;

-- Comprobación: la función puede leer los autenticadores. Si no pudiera,
-- todo Navio dejaría de responder; aquí la migración se detiene con un
-- error y no cambia nada (todo el archivo se aplica junto o nada).
do $$
begin
  perform public.mfa_satisfied();
end;
$$;

-- La empresa de quien pregunta: casi todas las reglas y funciones pasan por
-- aquí, así que sin el código no hay empresa (ni datos).
create or replace function public.current_company_id()
returns bigint
language sql
security definer
stable
set search_path = public
as $$
  select p."companyId"
  from public.profiles p
  join public.companies c on c.id = p."companyId"
  where p.id = auth.uid() and c.status = 'approved' and public.mfa_satisfied();
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.mfa_satisfied()
     and coalesce((select "isSuperAdmin" from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.is_company_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.mfa_satisfied() and coalesce(
    (select p."isSuperAdmin" or (p."companyRole" = 'admin' and public.current_company_id() is not null)
     from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

-- Regla adicional en TODAS las tablas (y en los archivos): se suma a las
-- que ya existen, así que nada se abre; solo se cierra para las sesiones
-- que no pasaron el código. Cubre también lo que se lee "por ser mío"
-- (perfil, avisos, recordatorios), que no pasa por la empresa.
do $$
declare
  t record;
begin
  for t in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  loop
    execute format('drop policy if exists mfa_required on public.%I', t.relname);
    execute format(
      'create policy mfa_required on public.%I as restrictive for all to authenticated using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()))',
      t.relname
    );
  end loop;
end;
$$;

drop policy if exists mfa_required on storage.objects;
create policy mfa_required on storage.objects as restrictive for all to authenticated
  using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));

-- Funciones que actúan solo con la identidad de quien llama (no pasan por
-- la empresa): también piden el código.
create or replace function public.join_company_with_code(invite_code text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  target_company_id bigint;
  recent_failures int;
  my_name text;
  my_email text;
  who text;
  admin_id uuid;
begin
  if me is null then
    raise exception 'Inicia sesión para unirte a una empresa.';
  end if;
  if not public.mfa_satisfied() then
    raise exception 'Escribe primero el código de tu app de autenticación.';
  end if;
  if public.current_company_id() is not null then
    raise exception 'Ya perteneces a una empresa. Pide a su administrador que te dé de baja antes de unirte a otra.';
  end if;

  select count(*) into recent_failures
  from public.join_attempts
  where "userId" = me and "createdAt" > now() - interval '1 hour';
  if recent_failures >= 5 then
    raise exception 'Demasiados intentos fallidos. Vuelve a intentarlo en una hora.';
  end if;

  select s."companyId" into target_company_id
  from public.company_secrets s
  join public.companies c on c.id = s."companyId"
  where s."inviteCode" = upper(trim(invite_code))
    and c.status = 'approved'
    and (s."inviteExpiresAt" is null or s."inviteExpiresAt" > now());

  if target_company_id is null then
    insert into public.join_attempts ("userId") values (me);
    return null;
  end if;

  if exists (select 1 from public.join_requests where "userId" = me and status = 'pending' and "companyId" = target_company_id) then
    return target_company_id;
  end if;

  perform public.hit_rate_limit('join_request', me::text, 5, interval '1 day',
    'Llegaste al límite de solicitudes por día. Vuelve a intentarlo mañana.');

  update public.join_requests set status = 'cancelled', "decidedAt" = now()
  where "userId" = me and status = 'pending';

  select p."fullName", u.email::text into my_name, my_email
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = me;
  who := coalesce(nullif(trim(my_name), ''), my_email, 'Alguien');

  insert into public.join_requests ("companyId", "userId", "fullName", email)
  values (target_company_id, me, my_name, my_email);

  perform public.write_audit(target_company_id, 'join_request', 'join_requests', me::text,
    who || ' pidió unirse con el código de invitación');

  for admin_id in
    select id from public.profiles where "companyId" = target_company_id and "companyRole" = 'admin'
  loop
    perform public.notify_user(admin_id, target_company_id, 'team', 'Solicitud para unirse a la empresa',
      who || coalesce(' (' || my_email || ')', '') || ' pidió unirse con el código de invitación. Apruébala o recházala en Configuración → Equipo.',
      jsonb_build_object('tab', 'settings'));
  end loop;

  return target_company_id;
end;
$$;
revoke all on function public.join_company_with_code(text) from public, anon;
grant execute on function public.join_company_with_code(text) to authenticated;

create or replace function public.my_join_request()
returns table (id bigint, "companyName" text, status text, "createdAt" timestamptz, "decidedAt" timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, c.name, r.status, r."createdAt", r."decidedAt"
  from public.join_requests r
  join public.companies c on c.id = r."companyId"
  where r."userId" = auth.uid() and r.status <> 'cancelled' and public.mfa_satisfied()
  order by r."createdAt" desc
  limit 1;
$$;
revoke all on function public.my_join_request() from public, anon;
grant execute on function public.my_join_request() to authenticated;

create or replace function public.cancel_join_request()
returns void
language sql
security definer
set search_path = public
as $$
  update public.join_requests set status = 'cancelled', "decidedAt" = now()
  where "userId" = auth.uid() and status = 'pending' and public.mfa_satisfied();
$$;
revoke all on function public.cancel_join_request() from public, anon;
grant execute on function public.cancel_join_request() to authenticated;

create or replace function public.unpair_tracker_device()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.tracker_devices where "userId" = auth.uid() and public.mfa_satisfied();
$$;
revoke all on function public.unpair_tracker_device() from public, anon;
grant execute on function public.unpair_tracker_device() to authenticated;

-- ------------------------------------------------------------
-- 2. Vincular el bot: código de un solo uso, bitácora y aviso
-- ------------------------------------------------------------
-- La llama solo el bot (llave de servicio). Devuelve la empresa, o NULL si
-- el código no existe o ya se usó.
create or replace function public.bot_link_chat(link_code text, chat_id text, chat_title text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target bigint;
  target_name text;
  previous_chat text;
  label text := coalesce(nullif(left(trim(chat_title), 80), ''), 'un chat sin nombre');
  replaced boolean;
  admin_id uuid;
begin
  if coalesce(trim(chat_id), '') = '' then
    return null;
  end if;
  perform public.hit_rate_limit('bot_link', chat_id, 10, interval '1 hour',
    'Demasiados intentos de vinculación desde este chat. Intenta de nuevo en una hora.');

  select s."companyId", c.name, c."botChatId" into target, target_name, previous_chat
  from public.company_secrets s
  join public.companies c on c.id = s."companyId"
  where s."botLinkCode" = upper(trim(link_code)) and c.status = 'approved';
  if target is null then
    return null;
  end if;
  replaced := previous_chat is not null and previous_chat <> chat_id;

  -- El código se gasta: para volver a vincular hará falta el nuevo, que
  -- solo ven los administradores en Configuración → Bot.
  update public.company_secrets set "botLinkCode" = public.new_secret_code(), "updatedAt" = now()
  where "companyId" = target;

  perform set_config('navio.trusted_write', 'on', true);
  update public.companies set "botChannel" = null, "botChatId" = null where "botChatId" = chat_id and id <> target;
  update public.companies set "botChannel" = 'telegram', "botChatId" = chat_id where id = target;
  perform set_config('navio.trusted_write', 'off', true);

  perform public.write_audit(target, 'bot_link', 'companies', target::text,
    'Bot de Telegram vinculado a "' || label || '"' || case when replaced then ' (reemplazó al chat anterior)' else '' end,
    jsonb_build_object('chatId', chat_id, 'previousChatId', previous_chat));

  for admin_id in
    select id from public.profiles where "companyId" = target and "companyRole" = 'admin'
  loop
    perform public.notify_user(admin_id, target, 'team',
      case when replaced then 'El bot cambió de chat' else 'Bot vinculado' end,
      'El bot de Telegram quedó vinculado a "' || label || '"'
        || case when replaced then ' y ya no recibe documentos del chat anterior' else '' end
        || '. Si no fuiste tú ni alguien de tu equipo, ve a Configuración → Bot, genera un código nuevo y vuelve a vincular tu chat.',
      jsonb_build_object('tab', 'settings'));
  end loop;

  return jsonb_build_object('companyId', target, 'name', target_name, 'replaced', replaced);
end;
$$;
revoke all on function public.bot_link_chat(text, text, text) from public, anon, authenticated;
grant execute on function public.bot_link_chat(text, text, text) to service_role;
