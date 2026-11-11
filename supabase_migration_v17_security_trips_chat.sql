-- ============================================================
-- Navio — Migración v17: Seguridad, viajes, mensajes, tareas,
--                        garantías y avisos legales
-- ============================================================
-- Corre esto DESPUÉS de supabase_migration_v16_concept_params_projects.sql.
-- Es seguro de correr una sola vez (y de volver a correr).
--
-- DESPUÉS de correrla hay que volver a desplegar el bot de Telegram
-- (pegar supabase/functions/telegram-webhook/index.ts y Deploy): el
-- código para vincular un chat ahora vive en otra tabla.
--
-- Qué hace:
--   A. SEGURIDAD (cierra las brechas encontradas en la auditoría)
--      1. Una empresa suspendida o rechazada pierde el acceso a sus datos.
--      2. Unirse con código de invitación ya no conserva el rol anterior
--         (un administrador de otra empresa entraba como administrador),
--         tiene límite de intentos y exige no pertenecer ya a una empresa.
--      3. Los códigos de invitación y del bot salen de "companies" a una
--         tabla que solo ven los administradores. Se pueden regenerar.
--      4. Nadie puede fijar a mano el chat del bot de su empresa (se
--         podía apuntar al chat de otra empresa y tumbarle el bot).
--      5. Comunidad: cada quien edita solo sus publicaciones; el estado
--         y los votos ya no se pueden alterar desde la pantalla.
--      6. Borrar traslados, incidencias, servicios, trámites, rutas y
--         archivos queda reservado a los administradores. Los documentos
--         de las facturas ya no se pueden borrar desde la app.
--      7. Quién subió una factura lo decide la sesión, no la pantalla.
--      8. Bitácora de actividad ("audit_log") para administradores.
--   B. VIAJES Y MAPA EN VIVO
--      Traslados ligados a su unidad, a quien los maneja y a su recorrido
--      real. El recorrido se guarda por lotes en una sola llamada, con la
--      distancia calculada por la base de datos.
--   C. MENSAJES, ALERTAS Y TAREAS entre personas de la misma empresa.
--   D. GARANTÍAS con vigencia, kilometraje y documento.
--   E. LEGAL: registro de aceptación de términos y aviso de privacidad,
--      y solicitudes de derechos ARCO.
-- ============================================================


-- ============================================================
-- A. SEGURIDAD
-- ============================================================

-- ------------------------------------------------------------
-- A1. Solo las empresas aprobadas dan acceso a sus datos
-- ------------------------------------------------------------
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
  where p.id = auth.uid() and c.status = 'approved';
$$;

create or replace function public.is_company_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select p."isSuperAdmin" or (p."companyRole" = 'admin' and public.current_company_id() is not null)
     from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

-- Códigos difíciles de adivinar (12 caracteres al azar).
create or replace function public.new_secret_code()
returns text
language sql
volatile
set search_path = public
as $$
  select upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
$$;
revoke all on function public.new_secret_code() from public, anon, authenticated;

-- ------------------------------------------------------------
-- A2. Bitácora de actividad (la leen los administradores)
-- ------------------------------------------------------------
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  "companyId" bigint references public.companies (id),
  "actorId" uuid,
  "actorName" text,
  action text not null,
  entity text not null,
  "entityId" text,
  summary text,
  details jsonb,
  "createdAt" timestamptz not null default now()
);
create index if not exists audit_log_company_idx on public.audit_log ("companyId", "createdAt" desc);

alter table public.audit_log enable row level security;

-- Solo lectura: sin políticas de escritura, nadie la altera desde la app.
drop policy if exists "audit_log_select_admin" on public.audit_log;
create policy "audit_log_select_admin" on public.audit_log
  for select to authenticated
  using (public.is_super_admin() or ("companyId" = public.current_company_id() and public.is_company_admin()));

create or replace function public.write_audit(
  target_company bigint, audit_action text, audit_entity text, audit_entity_id text, audit_summary text, audit_details jsonb default null
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.audit_log ("companyId", "actorId", "actorName", action, entity, "entityId", summary, details)
  values (
    target_company, auth.uid(),
    coalesce((select "fullName" from public.profiles where id = auth.uid()), 'Sistema'),
    audit_action, audit_entity, audit_entity_id, audit_summary, audit_details
  );
$$;
revoke all on function public.write_audit(bigint, text, text, text, text, jsonb) from public, anon, authenticated;

-- Registra altas, cambios y bajas de las tablas que la usan como trigger.
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  row_data jsonb;
  changed text[];
  quiet text[] := array['kmActual', 'healthScore', 'gps', 'appCapture', 'updatedAt'];
begin
  if tg_op = 'DELETE' then
    row_data := to_jsonb(old);
  else
    row_data := to_jsonb(new);
  end if;
  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key) into changed
    from jsonb_each(to_jsonb(new)) n
    join jsonb_each(to_jsonb(old)) o on o.key = n.key
    where n.value is distinct from o.value;
    -- Cambios automáticos (kilometraje, posición) no llenan la bitácora.
    if changed is null or changed <@ quiet then
      return null;
    end if;
  end if;
  perform public.write_audit(
    (row_data ->> 'companyId')::bigint,
    lower(tg_op), tg_table_name, row_data ->> 'id',
    coalesce(row_data ->> 'unit', row_data ->> 'item', row_data ->> 'title', row_data ->> 'concept', row_data ->> 'name', ''),
    case
      when tg_op = 'UPDATE' then jsonb_build_object('campos', to_jsonb(changed))
      when tg_op = 'DELETE' then row_data - array['history', 'documentHistory', 'cfdi']
      else null
    end
  );
  return null;
end;
$$;

-- ------------------------------------------------------------
-- A3. Códigos de invitación y del bot: solo para administradores
-- ------------------------------------------------------------
create table if not exists public.company_secrets (
  "companyId" bigint primary key references public.companies (id) on delete cascade,
  "inviteCode" text unique,
  "botLinkCode" text unique,
  "updatedAt" timestamptz not null default now()
);

alter table public.company_secrets enable row level security;

drop policy if exists "company_secrets_select_admin" on public.company_secrets;
create policy "company_secrets_select_admin" on public.company_secrets
  for select to authenticated
  using (public.is_super_admin() or ("companyId" = public.current_company_id() and public.is_company_admin()));

-- Pasa los códigos actuales a la tabla nueva y los quita de "companies",
-- donde cualquier persona de la empresa podía leerlos.
insert into public.company_secrets ("companyId", "inviteCode", "botLinkCode")
select id, "inviteCode", "botLinkCode" from public.companies
where "inviteCode" is not null or "botLinkCode" is not null
on conflict ("companyId") do nothing;

-- Empresas aprobadas que por lo que sea no tenían códigos.
insert into public.company_secrets ("companyId", "inviteCode", "botLinkCode")
select id, public.new_secret_code(), public.new_secret_code() from public.companies
where status = 'approved'
on conflict ("companyId") do nothing;

update public.company_secrets set "inviteCode" = public.new_secret_code() where "inviteCode" is null;
update public.company_secrets set "botLinkCode" = public.new_secret_code() where "botLinkCode" is null;

alter table public.companies disable trigger user;
update public.companies set "inviteCode" = null, "botLinkCode" = null
where "inviteCode" is not null or "botLinkCode" is not null;
alter table public.companies enable trigger user;

-- Datos de la empresa que su administrador puede completar.
alter table public.companies
  add column if not exists "legalName" text,
  add column if not exists rfc text,
  add column if not exists address text,
  add column if not exists settings jsonb not null default '{}'::jsonb;

create or replace function public.get_company_codes()
returns table ("inviteCode" text, "botLinkCode" text)
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
    select s."inviteCode", s."botLinkCode" from public.company_secrets s where s."companyId" = public.current_company_id();
end;
$$;
revoke all on function public.get_company_codes() from public, anon;
grant execute on function public.get_company_codes() to authenticated;

create or replace function public.rotate_company_code(which text)
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
    update public.company_secrets set "inviteCode" = new_code, "updatedAt" = now() where "companyId" = my_company;
  elsif which = 'bot' then
    update public.company_secrets set "botLinkCode" = new_code, "updatedAt" = now() where "companyId" = my_company;
  else
    raise exception 'Código no reconocido.';
  end if;
  perform public.write_audit(my_company, 'rotate_code', 'companies', my_company::text,
    case when which = 'invite' then 'Código de invitación regenerado' else 'Código del bot regenerado' end);
  return new_code;
end;
$$;
revoke all on function public.rotate_company_code(text) from public, anon;
grant execute on function public.rotate_company_code(text) to authenticated;

-- ------------------------------------------------------------
-- A4. Unirse a una empresa con código
-- ------------------------------------------------------------
create table if not exists public.join_attempts (
  id bigint generated always as identity primary key,
  "userId" uuid not null,
  "createdAt" timestamptz not null default now()
);
create index if not exists join_attempts_user_idx on public.join_attempts ("userId", "createdAt");
alter table public.join_attempts enable row level security;
-- Sin políticas a propósito: solo la función de abajo la usa.

-- Devuelve el id de la empresa, o NULL si el código no es válido. (No lanza
-- error en ese caso: un error desharía el registro del intento fallido.)
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
  where s."inviteCode" = upper(trim(invite_code)) and c.status = 'approved';

  if target_company_id is null then
    insert into public.join_attempts ("userId") values (me);
    return null;
  end if;

  -- Siempre entra como usuario: el rol que tuviera en otra empresa no viaja.
  perform set_config('navio.trusted_write', 'on', true);
  update public.profiles set "companyId" = target_company_id, "companyRole" = 'member' where id = me;
  perform set_config('navio.trusted_write', 'off', true);

  perform public.write_audit(target_company_id, 'join', 'profiles', me::text, 'Se unió con código de invitación');
  return target_company_id;
end;
$$;
revoke all on function public.join_company_with_code(text) from public, anon;
grant execute on function public.join_company_with_code(text) to authenticated;

-- ------------------------------------------------------------
-- A5. Aprobar, suspender y reactivar empresas (super-administrador)
-- ------------------------------------------------------------
create or replace function public.approve_company(target_company_id bigint)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  new_code text;
  requester uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Solo un super-administrador puede aprobar empresas.';
  end if;

  perform set_config('navio.trusted_write', 'on', true);
  update public.companies
  set status = 'approved', "approvedBy" = auth.uid(), "approvedAt" = now()
  where id = target_company_id
  returning "requestedBy" into requester;
  if not found then
    perform set_config('navio.trusted_write', 'off', true);
    raise exception 'Esa empresa no existe.';
  end if;

  insert into public.company_secrets ("companyId", "inviteCode", "botLinkCode")
  values (target_company_id, public.new_secret_code(), public.new_secret_code())
  on conflict ("companyId") do nothing;
  select "inviteCode" into new_code from public.company_secrets where "companyId" = target_company_id;

  -- Quien la solicitó queda como su administrador, salvo que ya esté en otra.
  if requester is not null then
    update public.profiles set "companyId" = target_company_id, "companyRole" = 'admin'
    where id = requester and ("companyId" is null or "companyId" = target_company_id);
  end if;
  perform set_config('navio.trusted_write', 'off', true);

  perform public.write_audit(target_company_id, 'approve', 'companies', target_company_id::text, 'Empresa aprobada');
  return new_code;
end;
$$;
revoke all on function public.approve_company(bigint) from public, anon;
grant execute on function public.approve_company(bigint) to authenticated;

create or replace function public.set_company_status(target_company_id bigint, new_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Solo un super-administrador puede cambiar el estado de una empresa.';
  end if;
  if new_status not in ('approved', 'suspended', 'rejected') then
    raise exception 'Estado no válido.';
  end if;
  if new_status = 'approved' and not exists (select 1 from public.company_secrets where "companyId" = target_company_id) then
    raise exception 'Esa empresa nunca fue aprobada: usa "Aprobar".';
  end if;
  update public.companies set status = new_status where id = target_company_id;
  perform public.write_audit(target_company_id, 'status', 'companies', target_company_id::text, 'Estado de la empresa: ' || new_status);
end;
$$;
revoke all on function public.set_company_status(bigint, text) from public, anon;
grant execute on function public.set_company_status(bigint, text) to authenticated;

-- El super-administrador ve todas las empresas con su código de invitación.
create or replace function public.admin_list_companies()
returns table (
  id bigint, name text, industry text, "fleetSize" text, "contactName" text, "contactEmail" text, "contactPhone" text,
  needs text, status text, "createdAt" timestamptz, "approvedAt" timestamptz, "inviteCode" text, members bigint
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
           (select count(*) from public.profiles p where p."companyId" = c.id)
    from public.companies c
    left join public.company_secrets s on s."companyId" = c.id
    order by c."createdAt" desc;
end;
$$;
revoke all on function public.admin_list_companies() from public, anon;
grant execute on function public.admin_list_companies() to authenticated;

-- ------------------------------------------------------------
-- A6. Solicitudes de empresa y datos del bot
-- ------------------------------------------------------------
-- Una solicitud nueva siempre entra limpia: sin estado, códigos ni chat.
create or replace function public.sanitize_company_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_super_admin() then
    return new; -- el bot, el SQL Editor o un super-administrador
  end if;
  if exists (select 1 from public.companies where "requestedBy" = auth.uid() and status = 'pending') then
    raise exception 'Ya tienes una solicitud en revisión.';
  end if;
  new.status := 'pending';
  new."requestedBy" := auth.uid();
  new."inviteCode" := null;
  new."botLinkCode" := null;
  new."botChannel" := null;
  new."botChatId" := null;
  new."approvedBy" := null;
  new."approvedAt" := null;
  new.settings := '{}'::jsonb;
  return new;
end;
$$;

drop trigger if exists sanitize_company_request_trigger on public.companies;
create trigger sanitize_company_request_trigger
  before insert on public.companies
  for each row execute function public.sanitize_company_request();

-- Un administrador edita los datos de su empresa, pero no su estado ni sus
-- códigos. El chat del bot solo lo vincula el propio bot: desde la pantalla
-- únicamente se puede desvincular.
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

-- ------------------------------------------------------------
-- A7. Equipo: roles y bajas
-- ------------------------------------------------------------
alter table public.profiles
  add column if not exists phone text,
  add column if not exists "jobTitle" text,
  add column if not exists preferences jsonb not null default '{}'::jsonb;

create or replace function public.set_member_role(target_user uuid, new_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_company bigint;
  target_name text;
begin
  if new_role not in ('admin', 'member') then
    raise exception 'Rol no válido.';
  end if;
  if not public.is_company_admin() then
    raise exception 'Solo un administrador de la empresa puede cambiar roles.';
  end if;

  select "companyId", "fullName" into target_company, target_name from public.profiles where id = target_user;
  if target_company is null or target_company is distinct from public.current_company_id() then
    raise exception 'Esa persona no pertenece a tu empresa.';
  end if;

  if new_role = 'member' and not exists (
    select 1 from public.profiles
    where "companyId" = target_company and "companyRole" = 'admin' and id <> target_user
  ) then
    raise exception 'La empresa debe conservar al menos un administrador.';
  end if;

  perform set_config('navio.trusted_write', 'on', true);
  update public.profiles set "companyRole" = new_role where id = target_user;
  perform set_config('navio.trusted_write', 'off', true);

  perform public.write_audit(target_company, 'role', 'profiles', target_user::text,
    coalesce(target_name, 'Usuario') || ' ahora es ' || case when new_role = 'admin' then 'administrador' else 'usuario' end);
end;
$$;
revoke all on function public.set_member_role(uuid, text) from public, anon;
grant execute on function public.set_member_role(uuid, text) to authenticated;

-- Dar de baja a alguien de la empresa: pierde el acceso al instante. Sus
-- facturas, viajes y mensajes se conservan.
create or replace function public.remove_company_member(target_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  my_company bigint := public.current_company_id();
  target_company bigint;
  target_name text;
begin
  if my_company is null or not public.is_company_admin() then
    raise exception 'Solo un administrador de la empresa puede dar de baja a alguien.';
  end if;
  select "companyId", "fullName" into target_company, target_name from public.profiles where id = target_user;
  if target_company is distinct from my_company then
    raise exception 'Esa persona no pertenece a tu empresa.';
  end if;
  if not exists (
    select 1 from public.profiles where "companyId" = my_company and "companyRole" = 'admin' and id <> target_user
  ) then
    raise exception 'La empresa debe conservar al menos un administrador.';
  end if;

  perform set_config('navio.trusted_write', 'on', true);
  update public.profiles set "companyId" = null, "companyRole" = 'member' where id = target_user;
  perform set_config('navio.trusted_write', 'off', true);

  perform public.write_audit(my_company, 'remove_member', 'profiles', target_user::text,
    coalesce(target_name, 'Usuario') || ' fue dado de baja de la empresa');
end;
$$;
revoke all on function public.remove_company_member(uuid) from public, anon;
grant execute on function public.remove_company_member(uuid) to authenticated;

-- El equipo, con el puesto y teléfono que cada quien registró.
drop function if exists public.list_company_members();
create or replace function public.list_company_members()
returns table (id uuid, "fullName" text, email text, "companyRole" text, phone text, "jobTitle" text)
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
    select p.id, p."fullName", u.email::text, p."companyRole", p.phone, p."jobTitle"
    from public.profiles p
    join auth.users u on u.id = p.id
    where p."companyId" = public.current_company_id()
    order by p."companyRole", p."fullName";
end;
$$;
revoke all on function public.list_company_members() from public, anon;
grant execute on function public.list_company_members() to authenticated;

-- ------------------------------------------------------------
-- A8. Comunidad: cada quien edita lo suyo; estado y votos protegidos
-- ------------------------------------------------------------
create or replace function public.protect_community_post()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_super_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new."authorId" := auth.uid();
    new.author := coalesce((select "fullName" from public.profiles where id = auth.uid()), new.author);
    new.status := 'backlog';
    new.votes := 0;
    return new;
  end if;
  new."authorId" := old."authorId";
  new.author := old.author;
  new.status := old.status;
  -- Los votos solo cambian desde el trigger que cuenta "community_votes".
  if pg_trigger_depth() < 2 then
    new.votes := old.votes;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_community_post on public.community_posts;
create trigger protect_community_post
  before insert or update on public.community_posts
  for each row execute function public.protect_community_post();

drop policy if exists "community_posts_insert" on public.community_posts;
create policy "community_posts_insert" on public.community_posts
  for insert to authenticated
  with check ("authorId" = auth.uid());

drop policy if exists "community_posts_update" on public.community_posts;
create policy "community_posts_update" on public.community_posts
  for update to authenticated
  using ("authorId" = auth.uid() or public.is_super_admin())
  with check ("authorId" = auth.uid() or public.is_super_admin());

drop policy if exists "votes_select" on public.community_votes;
create policy "votes_select" on public.community_votes
  for select to authenticated
  using ("userId" = auth.uid());

-- ------------------------------------------------------------
-- A9. Borrar queda reservado a los administradores
-- ------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['trips', 'incidents', 'maintenance_records', 'compliance_records', 'work_orders'] loop
    execute format('drop policy if exists %I on public.%I', t || '_company_isolated', t);
    execute format('drop policy if exists %I on public.%I', replace(t, '_records', '') || '_company_isolated', t);
    execute format('drop policy if exists %I on public.%I', t || '_all_own_company', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using ("companyId" = public.current_company_id())', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ("companyId" = public.current_company_id())', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using ("companyId" = public.current_company_id()) with check ("companyId" = public.current_company_id())', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using ("companyId" = public.current_company_id() and public.is_company_admin())', t || '_delete', t);
  end loop;
end $$;

-- Rutas: cada quien cierra la suya; el recorrido guardado no se edita.
drop policy if exists "routes_all_own_company" on public.routes;
drop policy if exists "routes_select" on public.routes;
drop policy if exists "routes_insert" on public.routes;
drop policy if exists "routes_update" on public.routes;
drop policy if exists "routes_delete" on public.routes;
create policy "routes_select" on public.routes
  for select to authenticated using ("companyId" = public.current_company_id());
create policy "routes_insert" on public.routes
  for insert to authenticated with check ("companyId" = public.current_company_id() and "createdBy" = auth.uid());
create policy "routes_update" on public.routes
  for update to authenticated
  using ("companyId" = public.current_company_id() and ("createdBy" = auth.uid() or public.is_company_admin()))
  with check ("companyId" = public.current_company_id());
create policy "routes_delete" on public.routes
  for delete to authenticated using ("companyId" = public.current_company_id() and public.is_company_admin());

drop policy if exists "route_points_all_own_company" on public.route_points;
drop policy if exists "route_points_select" on public.route_points;
drop policy if exists "route_points_insert" on public.route_points;
drop policy if exists "route_points_delete" on public.route_points;
create policy "route_points_select" on public.route_points
  for select to authenticated using ("companyId" = public.current_company_id());
create policy "route_points_insert" on public.route_points
  for insert to authenticated
  with check (
    "companyId" = public.current_company_id()
    and exists (select 1 from public.routes r where r.id = "routeId" and r."companyId" = public.current_company_id() and r.status = 'active')
  );
create policy "route_points_delete" on public.route_points
  for delete to authenticated using ("companyId" = public.current_company_id() and public.is_company_admin());

drop policy if exists "vehicle_positions_all_own_company" on public.vehicle_positions;
drop policy if exists "vehicle_positions_select" on public.vehicle_positions;
drop policy if exists "vehicle_positions_insert" on public.vehicle_positions;
drop policy if exists "vehicle_positions_update" on public.vehicle_positions;
drop policy if exists "vehicle_positions_delete" on public.vehicle_positions;
create policy "vehicle_positions_select" on public.vehicle_positions
  for select to authenticated using ("companyId" = public.current_company_id());
create policy "vehicle_positions_insert" on public.vehicle_positions
  for insert to authenticated with check ("companyId" = public.current_company_id());
create policy "vehicle_positions_update" on public.vehicle_positions
  for update to authenticated
  using ("companyId" = public.current_company_id()) with check ("companyId" = public.current_company_id());
create policy "vehicle_positions_delete" on public.vehicle_positions
  for delete to authenticated using ("companyId" = public.current_company_id() and public.is_company_admin());

-- Archivos: los documentos de las facturas ya no se borran desde la app.
-- Un administrador solo puede borrar fotos y documentos de unidades y
-- garantías (por ejemplo, al reemplazarlos).
drop policy if exists "documents_delete_own_company" on storage.objects;
drop policy if exists "documents_delete_admin_fleet_files" on storage.objects;
create policy "documents_delete_admin_fleet_files" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_company_id()::text
    and (storage.foldername(name))[2] in ('vehicles', 'warranties')
    and public.is_company_admin()
  );

-- ------------------------------------------------------------
-- A10. Quién subió una factura lo decide la sesión
-- ------------------------------------------------------------
create or replace function public.stamp_invoice_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    new."createdBy" := auth.uid();
    new."uploadedByName" := coalesce((select "fullName" from public.profiles where id = auth.uid()), new."uploadedByName");
  end if;
  return new;
end;
$$;

drop trigger if exists stamp_invoice_author on public.fuel_records;
create trigger stamp_invoice_author before insert on public.fuel_records
  for each row execute function public.stamp_invoice_author();
drop trigger if exists stamp_invoice_author on public.travel_expenses;
create trigger stamp_invoice_author before insert on public.travel_expenses
  for each row execute function public.stamp_invoice_author();
drop trigger if exists stamp_invoice_author on public.misc_expenses;
create trigger stamp_invoice_author before insert on public.misc_expenses
  for each row execute function public.stamp_invoice_author();

-- Bitácora de la flota y de los registros que se pueden borrar.
drop trigger if exists audit_vehicles on public.vehicles;
create trigger audit_vehicles after insert or update or delete on public.vehicles
  for each row execute function public.audit_row_change();
drop trigger if exists audit_trips on public.trips;
create trigger audit_trips after delete on public.trips
  for each row execute function public.audit_row_change();
drop trigger if exists audit_incidents on public.incidents;
create trigger audit_incidents after delete on public.incidents
  for each row execute function public.audit_row_change();
drop trigger if exists audit_maintenance_records on public.maintenance_records;
create trigger audit_maintenance_records after delete on public.maintenance_records
  for each row execute function public.audit_row_change();
drop trigger if exists audit_compliance_records on public.compliance_records;
create trigger audit_compliance_records after delete on public.compliance_records
  for each row execute function public.audit_row_change();


-- ============================================================
-- C (parte 1). ALERTAS — se definen antes porque viajes y tareas las usan
-- ============================================================
create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  "companyId" bigint not null references public.companies (id),
  "userId" uuid not null references auth.users (id) on delete cascade,
  kind text not null default 'alert', -- alert | task | trip | invoice | team
  title text not null,
  body text,
  link jsonb,
  "createdBy" uuid,
  "createdByName" text,
  "readAt" timestamptz,
  "createdAt" timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications ("userId", "createdAt" desc);

alter table public.notifications enable row level security;

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own" on public.notifications
  for select to authenticated
  using ("userId" = auth.uid() and "companyId" = public.current_company_id());

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own" on public.notifications
  for update to authenticated
  using ("userId" = auth.uid()) with check ("userId" = auth.uid());

drop policy if exists "notifications_delete_own" on public.notifications;
create policy "notifications_delete_own" on public.notifications
  for delete to authenticated
  using ("userId" = auth.uid());

-- Lo único que cambia quien la recibe es marcarla como leída.
create or replace function public.protect_notification()
returns trigger
language plpgsql
as $$
begin
  new."companyId" := old."companyId";
  new."userId" := old."userId";
  new.kind := old.kind;
  new.title := old.title;
  new.body := old.body;
  new.link := old.link;
  new."createdBy" := old."createdBy";
  new."createdByName" := old."createdByName";
  new."createdAt" := old."createdAt";
  return new;
end;
$$;

drop trigger if exists protect_notification on public.notifications;
create trigger protect_notification
  before update on public.notifications
  for each row execute function public.protect_notification();

-- Uso interno (triggers y funciones de confianza). No se llama desde la app.
create or replace function public.notify_user(
  target_user uuid, target_company bigint, n_kind text, n_title text, n_body text default null, n_link jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_user is null or target_company is null then
    return;
  end if;
  if not exists (select 1 from public.profiles where id = target_user and "companyId" = target_company) then
    return;
  end if;
  insert into public.notifications ("companyId", "userId", kind, title, body, link, "createdBy", "createdByName")
  values (
    target_company, target_user, n_kind, left(n_title, 200), left(n_body, 2000), n_link, auth.uid(),
    coalesce((select "fullName" from public.profiles where id = auth.uid()), 'Navio')
  );
end;
$$;
revoke all on function public.notify_user(uuid, bigint, text, text, text, jsonb) from public, anon, authenticated;

-- Un administrador manda una alerta a quien elija (o a toda la empresa).
create or replace function public.send_alert(recipients uuid[], alert_title text, alert_body text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  my_company bigint := public.current_company_id();
  target uuid;
  sent integer := 0;
begin
  if my_company is null or not public.is_company_admin() then
    raise exception 'Solo un administrador de la empresa puede enviar alertas.';
  end if;
  if coalesce(trim(alert_title), '') = '' then
    raise exception 'Escribe el título de la alerta.';
  end if;
  for target in
    select p.id from public.profiles p
    where p."companyId" = my_company
      and p.id <> auth.uid()
      and (recipients is null or cardinality(recipients) = 0 or p.id = any (recipients))
  loop
    perform public.notify_user(target, my_company, 'alert', trim(alert_title), nullif(trim(coalesce(alert_body, '')), ''));
    sent := sent + 1;
  end loop;
  perform public.write_audit(my_company, 'alert', 'notifications', null, 'Alerta enviada: ' || left(trim(alert_title), 120),
    jsonb_build_object('destinatarios', sent));
  return sent;
end;
$$;
revoke all on function public.send_alert(uuid[], text, text) from public, anon;
grant execute on function public.send_alert(uuid[], text, text) to authenticated;


-- ============================================================
-- B. VIAJES Y MAPA EN VIVO
-- ============================================================
alter table public.trips
  add column if not exists "vehicleId" bigint references public.vehicles (id) on delete set null,
  add column if not exists "assignedTo" uuid references auth.users (id) on delete set null,
  add column if not exists "assignedToName" text,
  add column if not exists "routeId" bigint references public.routes (id) on delete set null,
  add column if not exists "startedAt" timestamptz,
  add column if not exists "endedAt" timestamptz,
  add column if not exists "distanceKm" numeric,
  add column if not exists project text,
  add column if not exists "workOrder" text,
  add column if not exists notes text,
  add column if not exists "createdBy" uuid references auth.users (id) on delete set null,
  add column if not exists "createdByName" text;

alter table public.routes
  add column if not exists "tripId" bigint references public.trips (id) on delete set null,
  add column if not exists "pointCount" integer not null default 0,
  add column if not exists "maxSpeed" numeric,
  add column if not exists "lastLat" double precision,
  add column if not exists "lastLng" double precision,
  add column if not exists "lastPointAt" timestamptz;

create index if not exists routes_company_status_idx on public.routes ("companyId", status, "startedAt" desc);
create index if not exists trips_company_date_idx on public.trips ("companyId", date desc);

create or replace function public.haversine_km(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision
language sql
immutable
as $$
  select 2 * 6371 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  )));
$$;

-- Quién creó el traslado y a quién se le asignó lo valida la base de datos.
create or replace function public.prepare_trip()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new."createdBy" := auth.uid();
    new."createdByName" := (select "fullName" from public.profiles where id = auth.uid());
  else
    new."createdBy" := old."createdBy";
    new."createdByName" := old."createdByName";
  end if;
  if new."assignedTo" is not null and (tg_op = 'INSERT' or new."assignedTo" is distinct from old."assignedTo") then
    if not exists (select 1 from public.profiles where id = new."assignedTo" and "companyId" = new."companyId") then
      raise exception 'Esa persona no pertenece a tu empresa.';
    end if;
    new."assignedToName" := (select "fullName" from public.profiles where id = new."assignedTo");
  end if;
  if new."vehicleId" is not null and not exists (
    select 1 from public.vehicles where id = new."vehicleId" and "companyId" = new."companyId"
  ) then
    raise exception 'Esa unidad no pertenece a tu empresa.';
  end if;
  return new;
end;
$$;

drop trigger if exists prepare_trip on public.trips;
create trigger prepare_trip
  before insert or update on public.trips
  for each row execute function public.prepare_trip();

create or replace function public.notify_trip_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new."assignedTo" is not null
     and new."assignedTo" is distinct from auth.uid()
     and (tg_op = 'INSERT' or new."assignedTo" is distinct from old."assignedTo") then
    perform public.notify_user(
      new."assignedTo", new."companyId", 'trip', 'Te asignaron un traslado',
      new.unit || ': ' || new.origin || ' → ' || new.destination || ' (' || to_char(new.date, 'DD/MM/YYYY') || ')',
      jsonb_build_object('tab', 'transfers', 'id', new.id)
    );
  end if;
  return null;
end;
$$;

drop trigger if exists notify_trip_assignment on public.trips;
create trigger notify_trip_assignment
  after insert or update on public.trips
  for each row execute function public.notify_trip_assignment();

-- Cierra una ruta: suma su distancia al traslado y al odómetro de la unidad.
-- Uso interno; la app llama a finish_route().
create or replace function public.close_route(target_route bigint, complete_trip boolean default true)
returns public.routes
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.routes;
begin
  update public.routes set status = 'completed', "endedAt" = now()
  where id = target_route and status = 'active'
  returning * into r;
  if not found then
    select * into r from public.routes where id = target_route;
    return r;
  end if;
  if r."tripId" is not null then
    update public.trips
    set "distanceKm" = coalesce("distanceKm", 0) + coalesce(r."distanceKm", 0),
        status = case when complete_trip and status <> 'cancelled' then 'completed' else status end,
        "endedAt" = case when complete_trip then now() else "endedAt" end
    where id = r."tripId";
  end if;
  if coalesce(r."distanceKm", 0) >= 1 then
    update public.vehicles set "kmActual" = coalesce("kmActual", 0) + round(r."distanceKm")::int where id = r."vehicleId";
  end if;
  return r;
end;
$$;
revoke all on function public.close_route(bigint, boolean) from public, anon, authenticated;

-- Inicia el recorrido de una unidad, ligado a un traslado si se indica.
create or replace function public.start_route(target_vehicle bigint, target_trip bigint default null)
returns public.routes
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  my_company bigint := public.current_company_id();
  trip public.trips;
  stale bigint;
  created public.routes;
begin
  if me is null or my_company is null then
    raise exception 'Tu sesión no pertenece a una empresa activa.';
  end if;
  if not exists (select 1 from public.vehicles where id = target_vehicle and "companyId" = my_company) then
    raise exception 'Esa unidad no pertenece a tu empresa.';
  end if;
  if target_trip is not null then
    select * into trip from public.trips where id = target_trip and "companyId" = my_company;
    if not found then
      raise exception 'Ese traslado no pertenece a tu empresa.';
    end if;
    if trip.status in ('completed', 'cancelled') then
      raise exception 'Ese traslado ya está cerrado.';
    end if;
  end if;

  -- Cada quien lleva una sola ruta a la vez: las que dejó abiertas se cierran
  -- sin dar por terminado su traslado.
  for stale in select id from public.routes where "createdBy" = me and status = 'active' loop
    perform public.close_route(stale, false);
  end loop;

  insert into public.routes ("companyId", "vehicleId", "driverName", status, "createdBy", "tripId")
  values (my_company, target_vehicle, (select "fullName" from public.profiles where id = me), 'active', me, target_trip)
  returning * into created;

  if target_trip is not null then
    update public.trips
    set status = 'ongoing', "startedAt" = coalesce("startedAt", now()), "routeId" = created.id, "vehicleId" = target_vehicle
    where id = target_trip;
  end if;
  return created;
end;
$$;
revoke all on function public.start_route(bigint, bigint) from public, anon;
grant execute on function public.start_route(bigint, bigint) to authenticated;

-- Guarda un lote de puntos del recorrido en una sola llamada: los puntos, la
-- última posición de la unidad y la distancia acumulada.
-- points: [{ "lat": 18.1, "lng": -94.4, "speed": 42, "heading": 90, "accuracy": 8, "t": "2026-11-11T18:00:00.000Z" }]
-- sent_at: la hora del teléfono al enviar. Con ella se corrige un reloj
-- adelantado o atrasado: lo que cuenta es hace cuánto se tomó cada punto.
drop function if exists public.track_route_points(bigint, jsonb);
create or replace function public.track_route_points(target_route bigint, points jsonb, sent_at timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  my_company bigint := public.current_company_id();
  r public.routes;
  p jsonb;
  p_lat double precision;
  p_lng double precision;
  p_speed numeric;
  p_heading numeric;
  p_accuracy numeric;
  p_raw timestamptz;
  p_at timestamptz;
  clock_offset interval := coalesce(now() - sent_at, interval '0');
  last_lat double precision;
  last_lng double precision;
  last_at timestamptz;
  total numeric;
  top_speed numeric;
  added integer := 0;
  segment double precision;
  hours double precision;
begin
  if me is null or my_company is null then
    raise exception 'Tu sesión no pertenece a una empresa activa.';
  end if;
  select * into r from public.routes where id = target_route and "companyId" = my_company for update;
  if not found then
    raise exception 'Esa ruta no pertenece a tu empresa.';
  end if;
  if r.status <> 'active' then
    raise exception 'Esa ruta ya terminó.';
  end if;
  if r."createdBy" is distinct from me and not public.is_company_admin() then
    raise exception 'Solo quien inició la ruta puede registrar su recorrido.';
  end if;
  if points is null or jsonb_typeof(points) <> 'array' then
    raise exception 'Formato de puntos no válido.';
  end if;
  if jsonb_array_length(points) > 500 then
    raise exception 'Demasiados puntos en un solo envío.';
  end if;

  last_lat := r."lastLat";
  last_lng := r."lastLng";
  last_at := r."lastPointAt";
  total := coalesce(r."distanceKm", 0);
  top_speed := coalesce(r."maxSpeed", 0);

  for p in select value from jsonb_array_elements(points) order by value ->> 't' loop
    p_lat := (p ->> 'lat')::double precision;
    p_lng := (p ->> 'lng')::double precision;
    continue when p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180;
    p_speed := nullif(p ->> 'speed', '')::numeric;
    p_heading := nullif(p ->> 'heading', '')::numeric;
    p_accuracy := nullif(p ->> 'accuracy', '')::numeric;
    -- La hora la pone el teléfono. Para guardarla se corrige con su reloj y
    -- se acota al viaje; la distancia usa la diferencia entre puntos, que no
    -- depende de que el reloj esté bien puesto.
    p_raw := coalesce((p ->> 't')::timestamptz, now() - clock_offset);
    p_at := least(greatest(p_raw + clock_offset, r."startedAt" - interval '5 minutes'), now() + interval '1 minute');

    insert into public.route_points ("routeId", "companyId", lat, lng, speed, heading, accuracy, source, "recordedAt")
    values (r.id, my_company, p_lat, p_lng, p_speed, p_heading, p_accuracy, 'phone', p_at);
    added := added + 1;

    if p_speed is not null and p_speed between 0 and 250 then
      top_speed := greatest(top_speed, p_speed);
    end if;

    -- Puntos imprecisos se guardan, pero no cuentan para la distancia.
    continue when coalesce(p_accuracy, 0) > 150;
    if last_lat is null then
      last_lat := p_lat;
      last_lng := p_lng;
      last_at := p_raw;
    else
      segment := public.haversine_km(last_lat, last_lng, p_lat, p_lng);
      hours := extract(epoch from (p_raw - last_at)) / 3600.0;
      -- Menos de 10 m es ruido del GPS con la unidad detenida; más de
      -- 200 km/h entre dos puntos es un salto falso de la señal.
      if segment >= 0.01 and hours > 0 and segment / hours <= 200 then
        total := total + segment;
        last_lat := p_lat;
        last_lng := p_lng;
        last_at := p_raw;
      end if;
    end if;
  end loop;

  if added > 0 then
    update public.routes
    set "distanceKm" = round(total, 3), "pointCount" = coalesce("pointCount", 0) + added, "maxSpeed" = top_speed,
        "lastLat" = last_lat, "lastLng" = last_lng, "lastPointAt" = last_at
    where id = r.id;

    insert into public.vehicle_positions ("vehicleId", "companyId", "routeId", lat, lng, speed, heading, accuracy, source, "recordedAt")
    select r."vehicleId", my_company, r.id, rp.lat, rp.lng, rp.speed, rp.heading, rp.accuracy, 'phone', rp."recordedAt"
    from public.route_points rp
    where rp."routeId" = r.id
    order by rp."recordedAt" desc, rp.id desc
    limit 1
    on conflict ("vehicleId") do update
    set "companyId" = excluded."companyId", "routeId" = excluded."routeId", lat = excluded.lat, lng = excluded.lng,
        speed = excluded.speed, heading = excluded.heading, accuracy = excluded.accuracy, source = excluded.source,
        "recordedAt" = excluded."recordedAt"
    where public.vehicle_positions."recordedAt" <= excluded."recordedAt";
  end if;

  return jsonb_build_object(
    'distanceKm', round(total, 3),
    'pointCount', coalesce(r."pointCount", 0) + added,
    'maxSpeed', top_speed
  );
end;
$$;
revoke all on function public.track_route_points(bigint, jsonb, timestamptz) from public, anon;
grant execute on function public.track_route_points(bigint, jsonb, timestamptz) to authenticated;

-- Termina una ruta: quien la inició o un administrador.
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
  if r."createdBy" is distinct from auth.uid() and not public.is_company_admin() then
    raise exception 'Solo quien inició la ruta o un administrador puede terminarla.';
  end if;
  return public.close_route(target_route, complete_trip);
end;
$$;
revoke all on function public.finish_route(bigint, boolean) from public, anon;
grant execute on function public.finish_route(bigint, boolean) to authenticated;


-- ============================================================
-- C (parte 2). MENSAJES Y TAREAS
-- ============================================================
create table if not exists public.chat_channels (
  id bigint generated always as identity primary key,
  "companyId" bigint not null references public.companies (id) on delete cascade,
  kind text not null check (kind in ('general', 'group', 'direct')),
  name text,
  "directKey" text unique,
  "createdBy" uuid,
  "createdAt" timestamptz not null default now(),
  "lastMessageAt" timestamptz
);
create unique index if not exists chat_channels_general_idx on public.chat_channels ("companyId") where kind = 'general';

create table if not exists public.chat_members (
  "channelId" bigint not null references public.chat_channels (id) on delete cascade,
  "userId" uuid not null references auth.users (id) on delete cascade,
  "lastReadAt" timestamptz not null default now(),
  primary key ("channelId", "userId")
);
create index if not exists chat_members_user_idx on public.chat_members ("userId");

create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  "channelId" bigint not null references public.chat_channels (id) on delete cascade,
  "companyId" bigint not null references public.companies (id) on delete cascade,
  "senderId" uuid,
  "senderName" text,
  body text not null check (char_length(body) <= 4000),
  "createdAt" timestamptz not null default now(),
  "deletedAt" timestamptz
);
create index if not exists chat_messages_channel_idx on public.chat_messages ("channelId", id desc);

-- ¿La persona puede ver este canal? El canal general es de toda la empresa;
-- los grupos y los mensajes directos, solo de sus participantes.
create or replace function public.can_access_channel(target_channel bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.chat_channels c
    where c.id = target_channel
      and c."companyId" = public.current_company_id()
      and (
        c.kind = 'general'
        or exists (select 1 from public.chat_members m where m."channelId" = c.id and m."userId" = auth.uid())
      )
  );
$$;

alter table public.chat_channels enable row level security;
alter table public.chat_members enable row level security;
alter table public.chat_messages enable row level security;

-- Los canales y sus participantes se administran con las funciones de abajo.
drop policy if exists "chat_channels_select" on public.chat_channels;
create policy "chat_channels_select" on public.chat_channels
  for select to authenticated using (public.can_access_channel(id));

drop policy if exists "chat_members_select" on public.chat_members;
create policy "chat_members_select" on public.chat_members
  for select to authenticated using (public.can_access_channel("channelId"));

drop policy if exists "chat_messages_select" on public.chat_messages;
create policy "chat_messages_select" on public.chat_messages
  for select to authenticated using (public.can_access_channel("channelId"));

drop policy if exists "chat_messages_insert" on public.chat_messages;
create policy "chat_messages_insert" on public.chat_messages
  for insert to authenticated with check (public.can_access_channel("channelId") and "senderId" = auth.uid());

-- Remitente, empresa y hora los pone la base de datos.
create or replace function public.prepare_chat_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.body := trim(new.body);
  if new.body = '' then
    raise exception 'El mensaje está vacío.';
  end if;
  new."senderId" := auth.uid();
  new."senderName" := (select "fullName" from public.profiles where id = auth.uid());
  new."companyId" := (select "companyId" from public.chat_channels where id = new."channelId");
  new."createdAt" := now();
  new."deletedAt" := null;
  return new;
end;
$$;

drop trigger if exists prepare_chat_message on public.chat_messages;
create trigger prepare_chat_message
  before insert on public.chat_messages
  for each row execute function public.prepare_chat_message();

create or replace function public.after_chat_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_channels set "lastMessageAt" = new."createdAt" where id = new."channelId";
  if new."senderId" is not null then
    insert into public.chat_members ("channelId", "userId", "lastReadAt")
    values (new."channelId", new."senderId", new."createdAt")
    on conflict ("channelId", "userId") do update set "lastReadAt" = excluded."lastReadAt";
  end if;
  return null;
end;
$$;

drop trigger if exists after_chat_message on public.chat_messages;
create trigger after_chat_message
  after insert on public.chat_messages
  for each row execute function public.after_chat_message();

create or replace function public.ensure_general_channel()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  my_company bigint := public.current_company_id();
  channel_id bigint;
begin
  if my_company is null then
    raise exception 'Tu sesión no pertenece a una empresa activa.';
  end if;
  select id into channel_id from public.chat_channels where "companyId" = my_company and kind = 'general';
  if channel_id is null then
    insert into public.chat_channels ("companyId", kind, name, "createdBy")
    values (my_company, 'general', 'General', auth.uid())
    on conflict do nothing;
    select id into channel_id from public.chat_channels where "companyId" = my_company and kind = 'general';
  end if;
  return channel_id;
end;
$$;
revoke all on function public.ensure_general_channel() from public, anon;
grant execute on function public.ensure_general_channel() to authenticated;

-- Abre (o crea) la conversación directa con otra persona de la empresa.
create or replace function public.open_direct_channel(other_user uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  my_company bigint := public.current_company_id();
  key text;
  channel_id bigint;
begin
  if me is null or my_company is null then
    raise exception 'Tu sesión no pertenece a una empresa activa.';
  end if;
  if other_user is null or other_user = me then
    raise exception 'Elige a otra persona.';
  end if;
  if not exists (select 1 from public.profiles where id = other_user and "companyId" = my_company) then
    raise exception 'Esa persona no pertenece a tu empresa.';
  end if;
  key := my_company::text || ':' || least(me::text, other_user::text) || ':' || greatest(me::text, other_user::text);
  select id into channel_id from public.chat_channels where "directKey" = key;
  if channel_id is null then
    insert into public.chat_channels ("companyId", kind, "directKey", "createdBy")
    values (my_company, 'direct', key, me)
    on conflict ("directKey") do nothing;
    select id into channel_id from public.chat_channels where "directKey" = key;
  end if;
  insert into public.chat_members ("channelId", "userId") values (channel_id, me), (channel_id, other_user)
  on conflict do nothing;
  return channel_id;
end;
$$;
revoke all on function public.open_direct_channel(uuid) from public, anon;
grant execute on function public.open_direct_channel(uuid) to authenticated;

-- Crea un grupo, o cambia el nombre y los participantes de uno existente
-- (quien lo creó o un administrador). Solo entra gente de la misma empresa.
create or replace function public.save_group_channel(target_channel bigint, channel_name text, member_ids uuid[])
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  my_company bigint := public.current_company_id();
  channel public.chat_channels;
  clean_name text := left(trim(coalesce(channel_name, '')), 60);
begin
  if me is null or my_company is null then
    raise exception 'Tu sesión no pertenece a una empresa activa.';
  end if;
  if clean_name = '' then
    raise exception 'Ponle un nombre al grupo.';
  end if;
  if target_channel is null then
    insert into public.chat_channels ("companyId", kind, name, "createdBy")
    values (my_company, 'group', clean_name, me)
    returning * into channel;
  else
    select * into channel from public.chat_channels where id = target_channel and "companyId" = my_company and kind = 'group';
    if not found then
      raise exception 'Ese grupo no existe.';
    end if;
    if channel."createdBy" is distinct from me and not public.is_company_admin() then
      raise exception 'Solo quien creó el grupo o un administrador puede cambiarlo.';
    end if;
    update public.chat_channels set name = clean_name where id = channel.id;
    delete from public.chat_members
    where "channelId" = channel.id
      and "userId" <> coalesce(channel."createdBy", me)
      and not ("userId" = any (coalesce(member_ids, array[]::uuid[])));
  end if;
  insert into public.chat_members ("channelId", "userId")
  select channel.id, p.id from public.profiles p
  where p."companyId" = my_company and (p.id = me or p.id = any (coalesce(member_ids, array[]::uuid[])))
  on conflict do nothing;
  return channel.id;
end;
$$;
revoke all on function public.save_group_channel(bigint, text, uuid[]) from public, anon;
grant execute on function public.save_group_channel(bigint, text, uuid[]) to authenticated;

create or replace function public.leave_channel(target_channel bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.chat_channels where id = target_channel and kind = 'group' and "companyId" = public.current_company_id()
  ) then
    raise exception 'Solo se puede salir de un grupo.';
  end if;
  delete from public.chat_members where "channelId" = target_channel and "userId" = auth.uid();
end;
$$;
revoke all on function public.leave_channel(bigint) from public, anon;
grant execute on function public.leave_channel(bigint) to authenticated;

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
  insert into public.chat_members ("channelId", "userId", "lastReadAt")
  values (target_channel, auth.uid(), now())
  on conflict ("channelId", "userId") do update set "lastReadAt" = now();
end;
$$;
revoke all on function public.mark_channel_read(bigint) from public, anon;
grant execute on function public.mark_channel_read(bigint) to authenticated;

-- Borra un mensaje: quien lo escribió o un administrador. Queda el hueco.
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
    raise exception 'Solo quien lo escribió o un administrador puede borrarlo.';
  end if;
  update public.chat_messages set body = '', "deletedAt" = now() where id = target_message;
end;
$$;
revoke all on function public.delete_chat_message(bigint) from public, anon;
grant execute on function public.delete_chat_message(bigint) to authenticated;

-- La lista de conversaciones con su último mensaje y lo que falta por leer,
-- en una sola consulta.
create or replace function public.chat_overview()
returns table (
  id bigint, kind text, name text, "createdBy" uuid, "otherUserId" uuid, "otherUserName" text,
  "lastMessageAt" timestamptz, "lastMessage" text, "lastSender" text, unread integer, members integer
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
    end
  from public.chat_channels c
  left join public.chat_members me on me."channelId" = c.id and me."userId" = auth.uid()
  left join lateral (
    select m.body, m."senderName" from public.chat_messages m
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

-- ------------------------------------------------------------
-- Tareas: lo que el administrador le asigna a cada persona
-- ------------------------------------------------------------
create table if not exists public.tasks (
  id bigint generated always as identity primary key,
  "companyId" bigint not null references public.companies (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  description text,
  "assignedTo" uuid references auth.users (id) on delete set null,
  "assignedToName" text,
  "createdBy" uuid references auth.users (id) on delete set null,
  "createdByName" text,
  "dueDate" date,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'done', 'cancelled')),
  "relatedType" text,
  "relatedLabel" text,
  "completedAt" timestamptz,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);
create index if not exists tasks_company_idx on public.tasks ("companyId", status, "dueDate");

alter table public.tasks enable row level security;

-- Cada quien ve lo que le asignaron o lo que creó; el administrador ve todo.
drop policy if exists "tasks_select" on public.tasks;
create policy "tasks_select" on public.tasks
  for select to authenticated
  using ("companyId" = public.current_company_id()
         and (public.is_company_admin() or "assignedTo" = auth.uid() or "createdBy" = auth.uid()));

drop policy if exists "tasks_insert" on public.tasks;
create policy "tasks_insert" on public.tasks
  for insert to authenticated
  with check ("companyId" = public.current_company_id());

drop policy if exists "tasks_update" on public.tasks;
create policy "tasks_update" on public.tasks
  for update to authenticated
  using ("companyId" = public.current_company_id()
         and (public.is_company_admin() or "assignedTo" = auth.uid() or "createdBy" = auth.uid()))
  with check ("companyId" = public.current_company_id());

drop policy if exists "tasks_delete" on public.tasks;
create policy "tasks_delete" on public.tasks
  for delete to authenticated
  using ("companyId" = public.current_company_id() and (public.is_company_admin() or "createdBy" = auth.uid()));

create or replace function public.prepare_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  is_admin boolean := public.is_company_admin();
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
    if new."assignedTo" <> me and not is_admin then
      raise exception 'Solo un administrador puede asignar tareas a otras personas.';
    end if;
  else
    new."companyId" := old."companyId";
    new."createdBy" := old."createdBy";
    new."createdByName" := old."createdByName";
    new."createdAt" := old."createdAt";
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
    if new."assignedTo" is distinct from old."assignedTo" and not is_admin and new."assignedTo" is distinct from me then
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

drop trigger if exists prepare_task on public.tasks;
create trigger prepare_task
  before insert or update on public.tasks
  for each row execute function public.prepare_task();

create or replace function public.notify_task_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  link jsonb := jsonb_build_object('tab', 'tasks', 'id', new.id);
begin
  if new."assignedTo" is not null
     and new."assignedTo" is distinct from auth.uid()
     and (tg_op = 'INSERT' or new."assignedTo" is distinct from old."assignedTo") then
    perform public.notify_user(new."assignedTo", new."companyId", 'task', 'Te asignaron una tarea', new.title, link);
  end if;
  if tg_op = 'UPDATE' and new.status = 'done' and old.status <> 'done'
     and new."createdBy" is not null and new."createdBy" is distinct from auth.uid() then
    perform public.notify_user(new."createdBy", new."companyId", 'task', 'Tarea terminada',
      new.title || ' — ' || coalesce(new."assignedToName", 'sin asignar'), link);
  end if;
  return null;
end;
$$;

drop trigger if exists notify_task_change on public.tasks;
create trigger notify_task_change
  after insert or update on public.tasks
  for each row execute function public.notify_task_change();

-- Avisa a quien subió una factura cuando la aprueban o la rechazan.
create or replace function public.notify_invoice_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  label text := coalesce(nullif(new.vendor, ''), 'Factura') || ' por $' || trim(to_char(coalesce(new.amount, 0), 'FM999G999G990D00'));
begin
  if new."createdBy" is null or new."createdBy" is not distinct from auth.uid() then
    return null;
  end if;
  if new.status = 'rejected' and old.status is distinct from 'rejected' then
    perform public.notify_user(new."createdBy", new."companyId", 'invoice', 'Rechazaron una factura que subiste',
      label || coalesce('. Motivo: ' || nullif(new."statusReason", ''), ''), jsonb_build_object('tab', 'fuel'));
  elsif new.approved and not old.approved then
    perform public.notify_user(new."createdBy", new."companyId", 'invoice', 'Aprobaron una factura que subiste',
      label, jsonb_build_object('tab', 'fuel'));
  end if;
  return null;
end;
$$;

drop trigger if exists notify_invoice_decision on public.fuel_records;
create trigger notify_invoice_decision after update on public.fuel_records
  for each row execute function public.notify_invoice_decision();
drop trigger if exists notify_invoice_decision on public.travel_expenses;
create trigger notify_invoice_decision after update on public.travel_expenses
  for each row execute function public.notify_invoice_decision();
drop trigger if exists notify_invoice_decision on public.misc_expenses;
create trigger notify_invoice_decision after update on public.misc_expenses
  for each row execute function public.notify_invoice_decision();


-- ============================================================
-- D. GARANTÍAS
-- ============================================================
create table if not exists public.warranties (
  id bigint generated always as identity primary key,
  "companyId" bigint not null references public.companies (id) on delete cascade,
  "vehicleId" bigint references public.vehicles (id) on delete cascade,
  unit text,
  item text not null check (char_length(item) between 1 and 200),
  kind text not null default 'part' check (kind in ('vehicle', 'part', 'service', 'tire', 'battery', 'other')),
  vendor text,
  "invoiceFolio" text,
  "startDate" date not null,
  "endDate" date,
  "kmStart" integer,
  "kmLimit" integer,
  "documentUrl" text,
  notes text,
  status text not null default 'active' check (status in ('active', 'claimed', 'void')),
  "claimNotes" text,
  "createdBy" uuid default auth.uid() references auth.users (id) on delete set null,
  "createdAt" timestamptz not null default now()
);
create index if not exists warranties_company_idx on public.warranties ("companyId", "endDate");

alter table public.warranties enable row level security;

drop policy if exists "warranties_select" on public.warranties;
create policy "warranties_select" on public.warranties
  for select to authenticated using ("companyId" = public.current_company_id());

drop policy if exists "warranties_insert" on public.warranties;
create policy "warranties_insert" on public.warranties
  for insert to authenticated with check ("companyId" = public.current_company_id());

drop policy if exists "warranties_update" on public.warranties;
create policy "warranties_update" on public.warranties
  for update to authenticated
  using ("companyId" = public.current_company_id() and (public.is_company_admin() or "createdBy" = auth.uid()))
  with check ("companyId" = public.current_company_id());

drop policy if exists "warranties_delete" on public.warranties;
create policy "warranties_delete" on public.warranties
  for delete to authenticated using ("companyId" = public.current_company_id() and public.is_company_admin());

drop trigger if exists audit_warranties on public.warranties;
create trigger audit_warranties after insert or update or delete on public.warranties
  for each row execute function public.audit_row_change();


-- ============================================================
-- E. LEGAL
-- ============================================================
-- Qué versión de los términos y del aviso de privacidad aceptó cada persona.
create table if not exists public.legal_acceptances (
  id bigint generated always as identity primary key,
  "userId" uuid not null default auth.uid() references auth.users (id) on delete cascade,
  document text not null check (document in ('terms', 'privacy')),
  version text not null,
  "acceptedAt" timestamptz not null default now(),
  "userAgent" text,
  unique ("userId", document, version)
);

alter table public.legal_acceptances enable row level security;

drop policy if exists "legal_acceptances_select_own" on public.legal_acceptances;
create policy "legal_acceptances_select_own" on public.legal_acceptances
  for select to authenticated using ("userId" = auth.uid() or public.is_super_admin());

drop policy if exists "legal_acceptances_insert_own" on public.legal_acceptances;
create policy "legal_acceptances_insert_own" on public.legal_acceptances
  for insert to authenticated with check ("userId" = auth.uid());
-- Sin update ni delete: es evidencia.

create or replace function public.stamp_legal_acceptance()
returns trigger
language plpgsql
as $$
begin
  new."acceptedAt" := now();
  new."userAgent" := left(new."userAgent", 300);
  return new;
end;
$$;

drop trigger if exists stamp_legal_acceptance on public.legal_acceptances;
create trigger stamp_legal_acceptance
  before insert on public.legal_acceptances
  for each row execute function public.stamp_legal_acceptance();

-- Solicitudes de derechos ARCO (acceso, rectificación, cancelación,
-- oposición) y de revocación del consentimiento.
create table if not exists public.privacy_requests (
  id bigint generated always as identity primary key,
  "userId" uuid not null default auth.uid() references auth.users (id) on delete cascade,
  "companyId" bigint references public.companies (id) on delete set null,
  kind text not null check (kind in ('access', 'rectification', 'cancellation', 'opposition', 'revocation')),
  detail text not null check (char_length(detail) between 1 and 4000),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'rejected')),
  response text,
  "createdAt" timestamptz not null default now(),
  "resolvedAt" timestamptz
);

alter table public.privacy_requests enable row level security;

drop policy if exists "privacy_requests_select" on public.privacy_requests;
create policy "privacy_requests_select" on public.privacy_requests
  for select to authenticated using ("userId" = auth.uid() or public.is_super_admin());

drop policy if exists "privacy_requests_insert" on public.privacy_requests;
create policy "privacy_requests_insert" on public.privacy_requests
  for insert to authenticated
  with check ("userId" = auth.uid() and status = 'open' and response is null);

drop policy if exists "privacy_requests_update_admin" on public.privacy_requests;
create policy "privacy_requests_update_admin" on public.privacy_requests
  for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin());


-- ============================================================
-- Tiempo real: mensajes, alertas, tareas y viajes llegan sin recargar
-- ============================================================
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['chat_messages', 'notifications', 'tasks', 'trips', 'routes'] loop
      if not exists (
        select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ============================================================
-- Listo. Verifica en Table Editor que existan "company_secrets",
-- "audit_log", "notifications", "tasks", "chat_channels",
-- "chat_messages", "warranties" y "legal_acceptances".
-- Después, vuelve a desplegar el bot de Telegram.
-- ============================================================
