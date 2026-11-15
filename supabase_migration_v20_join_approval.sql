-- ============================================================
-- NAVIO — Migración v20: aprobación de personas nuevas
-- ============================================================
-- Qué hace:
--   1. Escribir el código de invitación ya NO da acceso a la empresa: crea
--      una solicitud que un administrador aprueba o rechaza en
--      Configuración → Equipo. Los administradores reciben una notificación
--      y la persona ve "en espera" hasta que la aprueben.
--   2. El código de invitación vence. Al regenerarlo se elige cuánto dura
--      (1 a 30 días; 7 por omisión). Los códigos actuales vencen en 7 días
--      a partir de que se corra esta migración.
--   3. Fotos de las unidades: solo se aceptan fotos nuevas guardadas en la
--      carpeta de la propia empresa (no direcciones de internet). Las fotos
--      que ya existen no se tocan.
--
-- Cómo aplicarla: pega TODO este archivo en Supabase → SQL Editor → Run.
-- Se puede correr más de una vez. Después, publicar la página.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Vencimiento del código de invitación
-- ------------------------------------------------------------
-- Las filas que ya existen reciben "dentro de 7 días" al crear la columna.
alter table public.company_secrets
  add column if not exists "inviteExpiresAt" timestamptz default (now() + interval '7 days');

-- ------------------------------------------------------------
-- 2. Solicitudes para unirse a una empresa
-- ------------------------------------------------------------
create table if not exists public.join_requests (
  id bigint generated always as identity primary key,
  "companyId" bigint not null references public.companies (id) on delete cascade,
  "userId" uuid not null references auth.users (id) on delete cascade,
  "fullName" text,
  email text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  "createdAt" timestamptz not null default now(),
  "decidedAt" timestamptz,
  "decidedBy" uuid
);
-- Una sola solicitud pendiente por persona.
create unique index if not exists join_requests_one_pending on public.join_requests ("userId") where status = 'pending';
create index if not exists join_requests_company_idx on public.join_requests ("companyId", status, "createdAt");

alter table public.join_requests enable row level security;
-- Sin políticas a propósito: solo se usa a través de las funciones de abajo.
revoke all on public.join_requests from anon, authenticated;

-- Escribir el código ahora crea (o conserva) la solicitud. Devuelve el id de
-- la empresa, o NULL si el código no existe o ya venció.
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

  -- Ya la había pedido: no se duplica ni se vuelve a avisar.
  if exists (select 1 from public.join_requests where "userId" = me and status = 'pending' and "companyId" = target_company_id) then
    return target_company_id;
  end if;

  perform public.hit_rate_limit('join_request', me::text, 5, interval '1 day',
    'Llegaste al límite de solicitudes por día. Vuelve a intentarlo mañana.');

  -- Una solicitud pendiente a otra empresa se reemplaza por esta.
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

-- La última solicitud de quien pregunta (para la pantalla de espera).
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
  where r."userId" = auth.uid() and r.status <> 'cancelled'
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
  where "userId" = auth.uid() and status = 'pending';
$$;
revoke all on function public.cancel_join_request() from public, anon;
grant execute on function public.cancel_join_request() to authenticated;

-- Solicitudes pendientes de mi empresa (solo administradores).
create or replace function public.list_join_requests()
returns table (id bigint, "userId" uuid, "fullName" text, email text, "createdAt" timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.current_company_id() is null or not public.is_company_admin() then
    raise exception 'Solo un administrador de la empresa puede ver las solicitudes.';
  end if;
  return query
    select r.id, r."userId", coalesce(nullif(p."fullName", ''), r."fullName"), coalesce(u.email::text, r.email), r."createdAt"
    from public.join_requests r
    left join public.profiles p on p.id = r."userId"
    left join auth.users u on u.id = r."userId"
    where r."companyId" = public.current_company_id() and r.status = 'pending'
    order by r."createdAt";
end;
$$;
revoke all on function public.list_join_requests() from public, anon;
grant execute on function public.list_join_requests() to authenticated;

-- Aprobar o rechazar una solicitud (solo administradores de esa empresa).
create or replace function public.decide_join_request(request_id bigint, approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  my_company bigint := public.current_company_id();
  req public.join_requests;
  who text;
begin
  if my_company is null or not public.is_company_admin() then
    raise exception 'Solo un administrador de la empresa puede atender solicitudes.';
  end if;

  select * into req from public.join_requests where id = request_id for update;
  if req.id is null or req."companyId" <> my_company then
    raise exception 'Esa solicitud no existe.';
  end if;
  if req.status <> 'pending' then
    raise exception 'Esa solicitud ya fue atendida.';
  end if;
  who := coalesce(nullif(trim((select "fullName" from public.profiles where id = req."userId")), ''), req.email, 'La persona');

  if approve then
    if exists (
      select 1 from public.profiles p join public.companies c on c.id = p."companyId"
      where p.id = req."userId" and c.status = 'approved' and p."companyId" <> my_company
    ) then
      raise exception 'Esa persona ya pertenece a otra empresa. Rechaza la solicitud.';
    end if;

    -- Siempre entra como usuario: el rol que tuviera en otra empresa no viaja.
    perform set_config('navio.trusted_write', 'on', true);
    update public.profiles set "companyId" = my_company, "companyRole" = 'member' where id = req."userId";
    if not found then
      raise exception 'No se encontró la cuenta de esa persona.';
    end if;
    perform set_config('navio.trusted_write', 'off', true);

    update public.join_requests set status = 'approved', "decidedAt" = now(), "decidedBy" = auth.uid() where id = req.id;
    perform public.write_audit(my_company, 'join', 'profiles', req."userId"::text, who || ' entró a la empresa (solicitud aprobada)');
    perform public.notify_user(req."userId", my_company, 'team', 'Ya tienes acceso',
      'Un administrador aprobó tu solicitud. ¡Bienvenido a la empresa!', null);
  else
    update public.join_requests set status = 'rejected', "decidedAt" = now(), "decidedBy" = auth.uid() where id = req.id;
    perform public.write_audit(my_company, 'join_reject', 'join_requests', req."userId"::text, 'Solicitud de ' || who || ' rechazada');
  end if;
end;
$$;
revoke all on function public.decide_join_request(bigint, boolean) from public, anon;
grant execute on function public.decide_join_request(bigint, boolean) to authenticated;

-- ------------------------------------------------------------
-- 3. Ver y regenerar códigos (ahora con su vencimiento)
-- ------------------------------------------------------------
drop function if exists public.get_company_codes();
create function public.get_company_codes()
returns table ("inviteCode" text, "botLinkCode" text, "inviteExpiresAt" timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_company_admin() or public.current_company_id() is null then
    raise exception 'Solo un administrador de la empresa puede ver los códigos.';
  end if;
  return query
    select s."inviteCode", s."botLinkCode", s."inviteExpiresAt"
    from public.company_secrets s where s."companyId" = public.current_company_id();
end;
$$;
revoke all on function public.get_company_codes() from public, anon;
grant execute on function public.get_company_codes() to authenticated;

-- La versión de un solo argumento se reemplaza: con dos, la de antes haría
-- ambigua cada llamada.
drop function if exists public.rotate_company_code(text);
create or replace function public.rotate_company_code(which text, valid_days integer default 7)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  my_company bigint := public.current_company_id();
  new_code text := public.new_secret_code();
begin
  if my_company is null or not public.is_company_admin() then
    raise exception 'Solo un administrador de la empresa puede regenerar los códigos.';
  end if;
  if which = 'invite' then
    if valid_days is null or valid_days < 1 or valid_days > 30 then
      raise exception 'El código de invitación puede durar de 1 a 30 días.';
    end if;
    update public.company_secrets
    set "inviteCode" = new_code, "inviteExpiresAt" = now() + make_interval(days => valid_days), "updatedAt" = now()
    where "companyId" = my_company;
  elsif which = 'bot' then
    update public.company_secrets set "botLinkCode" = new_code, "updatedAt" = now() where "companyId" = my_company;
  else
    raise exception 'Código no reconocido.';
  end if;
  perform public.write_audit(my_company, 'rotate_code', 'companies', my_company::text,
    case when which = 'invite' then 'Código de invitación regenerado (vence en ' || valid_days || ' días)' else 'Código del bot regenerado' end);
  return new_code;
end;
$$;
revoke all on function public.rotate_company_code(text, integer) from public, anon;
grant execute on function public.rotate_company_code(text, integer) to authenticated;

-- ------------------------------------------------------------
-- 4. Fotos de las unidades: solo archivos de la propia empresa
-- ------------------------------------------------------------
-- Se revisa solo cuando la foto cambia, así una unidad con una foto antigua
-- se puede seguir editando.
create or replace function public.check_vehicle_photos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed text := '^' || new."companyId"::text || '/vehicles/[A-Za-z0-9._-]+$';
  capture text := new."appCapture"->>'photoUrl';
  photo_changed boolean := true;
  capture_changed boolean := true;
begin
  if auth.uid() is null then
    return new; -- servidor o SQL Editor
  end if;
  if tg_op = 'UPDATE' then
    photo_changed := new.photo is distinct from old.photo;
    capture_changed := capture is distinct from (old."appCapture"->>'photoUrl');
  end if;
  if photo_changed and coalesce(new.photo, '') <> '' and new.photo !~ allowed then
    raise exception 'La foto de la unidad debe subirse desde Navio.' using errcode = '22023';
  end if;
  if capture_changed and coalesce(capture, '') <> '' and capture !~ allowed then
    raise exception 'La foto de la captura debe subirse desde Navio.' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists check_vehicle_photos on public.vehicles;
create trigger check_vehicle_photos
  before insert or update on public.vehicles
  for each row execute function public.check_vehicle_photos();
