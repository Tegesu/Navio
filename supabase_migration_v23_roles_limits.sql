-- ============================================================
-- NAVIO — Migración v23: permisos por persona, nombres únicos, límite de
--                         unidades y códigos de invitación de un solo uso
-- ============================================================
-- Qué hace:
--   1. PERMISOS. Además de "Administrador" y "Usuario", el administrador
--      puede darle a cada persona:
--        - "supervisor": inicia, modifica y termina traslados asignados a
--          otras personas.
--        - "invoices" (revisa facturas): corrige y verifica facturas.
--      Un administrador tiene ambos.
--   2. TRASLADOS. Un traslado asignado a otra persona solo lo inician o
--      modifican esa persona, un supervisor o un administrador.
--   3. FACTURAS (Combustible, Viáticos, Gastos varios, Servicios y Trámites).
--      Cualquiera puede registrarlas (quedan "pendientes"); solo quien
--      revisa facturas o un administrador puede corregirlas o verificarlas.
--      Aprobar sigue siendo del administrador.
--   4. NOMBRES. No puede haber dos personas con el mismo nombre en una
--      empresa (sin distinguir mayúsculas, acentos ni espacios dobles).
--   5. UNIDADES. Máximo 10 por empresa. Solo el super-administrador de
--      Navio puede subir ese límite.
--   6. CÓDIGO DE INVITACIÓN. Se genera con el botón "Código de invitación",
--      vence 24 horas después y sirve para UNA persona. Los códigos que ya
--      existen vencen a más tardar 24 horas después de correr esta
--      migración.
--
-- Cómo aplicarla: pega TODO este archivo en Supabase → SQL Editor → Run.
-- Se puede correr más de una vez. Después: publicar la página.
-- No cambia datos que ya existen (unidades o nombres repetidos que ya
-- estén se quedan; las reglas aplican a lo nuevo).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Permisos por persona
-- ------------------------------------------------------------
alter table public.profiles add column if not exists permissions text[] not null default '{}';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_permissions_known') then
    alter table public.profiles add constraint profiles_permissions_known
      check (permissions <@ array['invoices', 'supervisor']::text[]);
  end if;
end;
$$;

-- ¿Quien pregunta tiene ese permiso? Los administradores tienen todos.
create or replace function public.has_permission(permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_company_admin() or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and public.current_company_id() is not null and permission = any (p.permissions)
  );
$$;
revoke all on function public.has_permission(text) from public, anon;
grant execute on function public.has_permission(text) to authenticated;

-- Nadie se da permisos a sí mismo: rol, empresa y permisos los cambian
-- solo las funciones de confianza (o un super-administrador).
create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('navio.trusted_write', true) = 'on' then
    return new;
  end if;
  if not public.is_super_admin() then
    new."companyId" := old."companyId";
    new."isSuperAdmin" := old."isSuperAdmin";
    new."companyRole" := old."companyRole";
    new.permissions := old.permissions;
  end if;
  return new;
end;
$$;

create or replace function public.set_member_permissions(target_user uuid, new_permissions text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_company bigint;
  target_name text;
  clean text[];
  labels text;
begin
  if not public.is_company_admin() then
    raise exception 'Solo un administrador de la empresa puede asignar permisos.';
  end if;
  select "companyId", "fullName" into target_company, target_name from public.profiles where id = target_user;
  if target_company is null or target_company is distinct from public.current_company_id() then
    raise exception 'Esa persona no pertenece a tu empresa.';
  end if;
  clean := array(select distinct p from unnest(coalesce(new_permissions, '{}')) p where p is not null order by p);
  if not clean <@ array['invoices', 'supervisor']::text[] then
    raise exception 'Permiso no reconocido.';
  end if;

  perform set_config('navio.trusted_write', 'on', true);
  update public.profiles set permissions = clean where id = target_user;
  perform set_config('navio.trusted_write', 'off', true);

  select string_agg(case x when 'supervisor' then 'supervisor de traslados' else 'revisa facturas' end, ' y ')
  into labels from unnest(clean) x;
  perform public.write_audit(target_company, 'permissions', 'profiles', target_user::text,
    coalesce(target_name, 'Usuario') || ': ' || coalesce(labels, 'sin permisos adicionales'));
end;
$$;
revoke all on function public.set_member_permissions(uuid, text[]) from public, anon;
grant execute on function public.set_member_permissions(uuid, text[]) to authenticated;

-- El equipo, ahora con sus permisos.
drop function if exists public.list_company_members();
create function public.list_company_members()
returns table (id uuid, "fullName" text, email text, "companyRole" text, phone text, "jobTitle" text, permissions text[])
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_company_admin() then
    raise exception 'Solo un administrador de la empresa puede ver al equipo.';
  end if;
  return query
    select p.id, p."fullName", u.email::text, p."companyRole", p.phone, p."jobTitle", p.permissions
    from public.profiles p
    join auth.users u on u.id = p.id
    where p."companyId" = public.current_company_id()
    order by p."companyRole", p."fullName";
end;
$$;
revoke all on function public.list_company_members() from public, anon;
grant execute on function public.list_company_members() to authenticated;

-- ------------------------------------------------------------
-- 4. Nombres únicos en cada empresa (y permisos que no viajan)
-- ------------------------------------------------------------
create or replace function public.normalize_person_name(name text)
returns text
language sql
immutable
set search_path = public
as $$
  select lower(regexp_replace(trim(translate(coalesce(name, ''),
    'ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑáàäâéèëêíìïîóòöôúùüûñ',
    'AAAAEEEEIIIIOOOOUUUUNaaaaeeeeiiiioooouuuun')), '\s+', ' ', 'g'));
$$;
-- Solo la usan las reglas de la base; nadie la llama desde fuera.
revoke all on function public.normalize_person_name(text) from public, anon, authenticated;

create or replace function public.profile_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  name_changed boolean;
  company_changed boolean;
begin
  company_changed := tg_op = 'INSERT' or new."companyId" is distinct from old."companyId";
  name_changed := tg_op = 'INSERT' or public.normalize_person_name(new."fullName") is distinct from public.normalize_person_name(old."fullName");

  -- Al cambiar de empresa (entrar o salir) se pierden los permisos.
  if tg_op = 'UPDATE' and company_changed then
    new.permissions := '{}';
  end if;

  if new."companyId" is not null and (company_changed or name_changed)
     and public.normalize_person_name(new."fullName") <> ''
     and exists (
       select 1 from public.profiles p
       where p."companyId" = new."companyId" and p.id <> new.id
         and public.normalize_person_name(p."fullName") = public.normalize_person_name(new."fullName")
     ) then
    raise exception 'Ya hay otra persona llamada "%" en la empresa. Para distinguirlas, el nombre debe llevar el segundo apellido o una inicial.', trim(new."fullName");
  end if;
  return new;
end;
$$;
revoke all on function public.profile_rules() from public, anon, authenticated;

-- "zz_": corre después de protect_profile_privileges, con la empresa final.
drop trigger if exists zz_profile_rules on public.profiles;
create trigger zz_profile_rules
  before insert or update on public.profiles
  for each row execute function public.profile_rules();

-- ------------------------------------------------------------
-- 2. Traslados asignados
-- ------------------------------------------------------------
create or replace function public.protect_assigned_trip()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or current_setting('navio.trusted_write', true) = 'on' then
    return new;
  end if;
  if public.has_permission('supervisor') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new."assignedTo" is not null and new."assignedTo" <> auth.uid() then
      raise exception 'Solo un supervisor o un administrador puede asignar un traslado a otra persona.';
    end if;
    return new;
  end if;
  if old."assignedTo" is not null and old."assignedTo" <> auth.uid() then
    raise exception 'Ese traslado está asignado a otra persona: solo ella, un supervisor o un administrador pueden iniciarlo o modificarlo.';
  end if;
  if new."assignedTo" is distinct from old."assignedTo" and new."assignedTo" is not null and new."assignedTo" <> auth.uid() then
    raise exception 'Solo un supervisor o un administrador puede asignar un traslado a otra persona.';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_assigned_trip() from public, anon, authenticated;

drop trigger if exists protect_assigned_trip on public.trips;
create trigger protect_assigned_trip
  before insert or update on public.trips
  for each row execute function public.protect_assigned_trip();

-- Terminar la ruta de otra persona: también un supervisor.
create or replace function public.finish_route(target_route bigint, complete_trip boolean default true)
returns public.routes
language plpgsql
security definer
set search_path = public
as $$
declare
  my_company bigint := public.current_company_id();
  r public.routes;
begin
  select * into r from public.routes where id = target_route and "companyId" = my_company;
  if my_company is null or not found then
    raise exception 'Esa ruta no pertenece a tu empresa.';
  end if;
  if r."createdBy" is distinct from auth.uid() and not public.has_permission('supervisor') then
    raise exception 'Solo quien inició la ruta, un supervisor o un administrador puede terminarla.';
  end if;
  return public.close_route(target_route, complete_trip);
end;
$$;
revoke all on function public.finish_route(bigint, boolean) from public, anon;
grant execute on function public.finish_route(bigint, boolean) to authenticated;

-- ------------------------------------------------------------
-- 3. Facturas: registrar sí, corregir o verificar solo quien revisa
-- ------------------------------------------------------------
create or replace function public.restrict_invoice_edits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or current_setting('navio.trusted_write', true) = 'on' then
    return new; -- el bot o el servidor
  end if;
  if public.has_permission('invoices') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    -- Lo que registra un usuario espera a que lo revisen.
    new.status := 'pending';
    return new;
  end if;
  raise exception 'Solo la persona que revisa facturas o un administrador puede corregir o verificar facturas.';
end;
$$;
revoke all on function public.restrict_invoice_edits() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['fuel_records', 'travel_expenses', 'misc_expenses', 'maintenance_records', 'compliance_records'] loop
    execute format('drop trigger if exists restrict_invoice_edits on public.%I', t);
    execute format('create trigger restrict_invoice_edits before insert or update on public.%I for each row execute function public.restrict_invoice_edits()', t);
  end loop;
end;
$$;

-- Marcar el documento de una factura es parte de revisarla.
create or replace function public.can_mark_invoice(target_table text, target_id bigint)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  invoice_company bigint;
  invoice_status text;
begin
  if target_table not in ('fuel_records', 'travel_expenses', 'misc_expenses') then
    return false;
  end if;
  execute format('select "companyId", coalesce(status, ''pending'') from public.%I where id = $1', target_table)
    into invoice_company, invoice_status
    using target_id;
  if invoice_company is null or invoice_company is distinct from public.current_company_id() then
    return false;
  end if;
  if invoice_status in ('rejected', 'voided') then
    return false;
  end if;
  return public.has_permission('invoices');
end;
$$;
revoke all on function public.can_mark_invoice(text, bigint) from public, anon;
grant execute on function public.can_mark_invoice(text, bigint) to authenticated;

-- ------------------------------------------------------------
-- 5. Límite de unidades por empresa
-- ------------------------------------------------------------
alter table public.companies add column if not exists "vehicleLimit" integer not null default 10;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'companies_vehicle_limit_range') then
    alter table public.companies add constraint companies_vehicle_limit_range check ("vehicleLimit" between 1 and 100000);
  end if;
end;
$$;

-- El límite no lo puede cambiar el administrador de la empresa.
create or replace function public.protect_company_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('navio.trusted_write', true) = 'on' then
    return new;
  end if;
  if auth.uid() is null or public.is_super_admin() then
    return new; -- el bot (llave de servicio), el SQL Editor o un super-administrador
  end if;
  new.status := old.status;
  new."inviteCode" := old."inviteCode";
  new."botLinkCode" := old."botLinkCode";
  new."approvedBy" := old."approvedBy";
  new."approvedAt" := old."approvedAt";
  new."requestedBy" := old."requestedBy";
  new."vehicleLimit" := old."vehicleLimit";
  if new."botChatId" is not null and new."botChatId" is distinct from old."botChatId" then
    new."botChatId" := old."botChatId";
    new."botChannel" := old."botChannel";
  end if;
  if new."botChannel" is not null and new."botChannel" is distinct from old."botChannel" then
    new."botChannel" := old."botChannel";
  end if;
  return new;
end;
$$;

create or replace function public.enforce_vehicle_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  max_vehicles integer;
  current_count integer;
begin
  if auth.uid() is null then
    return new; -- SQL Editor o servidor
  end if;
  -- Bloquea la fila de la empresa: dos altas al mismo tiempo no se pasan.
  select "vehicleLimit" into max_vehicles from public.companies where id = new."companyId" for update;
  select count(*) into current_count from public.vehicles where "companyId" = new."companyId";
  if current_count >= coalesce(max_vehicles, 10) then
    raise exception 'Tu empresa llegó al límite de % unidades. Para agregar más, contacta a Navio.', coalesce(max_vehicles, 10);
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_vehicle_limit() from public, anon, authenticated;

drop trigger if exists enforce_vehicle_limit on public.vehicles;
create trigger enforce_vehicle_limit
  before insert on public.vehicles
  for each row execute function public.enforce_vehicle_limit();

create or replace function public.set_vehicle_limit(target_company_id bigint, new_limit integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Solo el super-administrador de Navio puede cambiar el límite de unidades.';
  end if;
  if new_limit is null or new_limit < 1 or new_limit > 100000 then
    raise exception 'El límite debe ser de 1 a 100,000 unidades.';
  end if;
  update public.companies set "vehicleLimit" = new_limit where id = target_company_id;
  if not found then
    raise exception 'Esa empresa no existe.';
  end if;
  perform public.write_audit(target_company_id, 'vehicle_limit', 'companies', target_company_id::text,
    'Límite de unidades: ' || new_limit);
end;
$$;
revoke all on function public.set_vehicle_limit(bigint, integer) from public, anon;
grant execute on function public.set_vehicle_limit(bigint, integer) to authenticated;

-- El super-administrador ve el límite y cuántas unidades tiene cada empresa.
drop function if exists public.admin_list_companies();
create function public.admin_list_companies()
returns table (
  id bigint, name text, industry text, "fleetSize" text, "contactName" text, "contactEmail" text, "contactPhone" text,
  needs text, status text, "createdAt" timestamptz, "approvedAt" timestamptz, "inviteCode" text, members bigint,
  "vehicleLimit" integer, vehicles bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Solo un super-administrador puede ver todas las empresas.';
  end if;
  return query
    select c.id, c.name, c.industry, c."fleetSize", c."contactName", c."contactEmail", c."contactPhone",
           c.needs, c.status, c."createdAt", c."approvedAt", s."inviteCode",
           (select count(*) from public.profiles p where p."companyId" = c.id),
           c."vehicleLimit",
           (select count(*) from public.vehicles v where v."companyId" = c.id)
    from public.companies c
    left join public.company_secrets s on s."companyId" = c.id
    order by c."createdAt" desc;
end;
$$;
revoke all on function public.admin_list_companies() from public, anon;
grant execute on function public.admin_list_companies() to authenticated;

-- ------------------------------------------------------------
-- 6. Código de invitación: botón, 24 horas, un solo uso
-- ------------------------------------------------------------
alter table public.company_secrets alter column "inviteExpiresAt" set default (now() + interval '24 hours');
update public.company_secrets
set "inviteExpiresAt" = least(coalesce("inviteExpiresAt", now() + interval '24 hours'), now() + interval '24 hours')
where "inviteCode" is not null;

create or replace function public.generate_invite_code()
returns table (code text, "expiresAt" timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  my_company bigint := public.current_company_id();
  new_code text := public.new_secret_code();
  expires timestamptz := now() + interval '24 hours';
begin
  if my_company is null or not public.is_company_admin() then
    raise exception 'Solo un administrador de la empresa puede generar códigos de invitación.';
  end if;
  update public.company_secrets set "inviteCode" = new_code, "inviteExpiresAt" = expires, "updatedAt" = now()
  where "companyId" = my_company;
  if not found then
    insert into public.company_secrets ("companyId", "inviteCode", "inviteExpiresAt", "botLinkCode")
    values (my_company, new_code, expires, public.new_secret_code());
  end if;
  perform public.write_audit(my_company, 'rotate_code', 'companies', my_company::text,
    'Código de invitación generado (24 horas, una sola persona)');
  return query select new_code, expires;
end;
$$;
revoke all on function public.generate_invite_code() from public, anon;
grant execute on function public.generate_invite_code() to authenticated;

-- La versión anterior (con días) sigue funcionando para la página vieja,
-- pero el código de invitación ahora siempre dura 24 horas.
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
    update public.company_secrets
    set "inviteCode" = new_code, "inviteExpiresAt" = now() + interval '24 hours', "updatedAt" = now()
    where "companyId" = my_company;
  elsif which = 'bot' then
    update public.company_secrets set "botLinkCode" = new_code, "updatedAt" = now() where "companyId" = my_company;
  else
    raise exception 'Código no reconocido.';
  end if;
  perform public.write_audit(my_company, 'rotate_code', 'companies', my_company::text,
    case when which = 'invite' then 'Código de invitación generado (24 horas, una sola persona)' else 'Código del bot regenerado' end);
  return new_code;
end;
$$;
revoke all on function public.rotate_company_code(text, integer) from public, anon;
grant execute on function public.rotate_company_code(text, integer) to authenticated;

-- Unirse: el código se gasta en cuanto alguien lo usa para pedir entrar.
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

  -- "for update": si dos personas usan el mismo código a la vez, solo una lo logra.
  select s."companyId" into target_company_id
  from public.company_secrets s
  join public.companies c on c.id = s."companyId"
  where s."inviteCode" = upper(trim(invite_code))
    and c.status = 'approved'
    and (s."inviteExpiresAt" is null or s."inviteExpiresAt" > now())
  for update of s;

  if target_company_id is null then
    insert into public.join_attempts ("userId") values (me);
    return null;
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

  -- Un solo uso: el administrador generará otro para la siguiente persona.
  update public.company_secrets set "inviteCode" = null, "inviteExpiresAt" = null, "updatedAt" = now()
  where "companyId" = target_company_id;

  perform public.write_audit(target_company_id, 'join_request', 'join_requests', me::text,
    who || ' pidió unirse con el código de invitación (el código ya no sirve)');

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
