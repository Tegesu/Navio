-- ============================================================
-- NAVIO — Migración v24: Mantenimiento por servicio, campañas,
--                         tipo de incidencia y conversación de tareas
-- ============================================================
-- Qué hace:
--   1. SERVICIOS. Cada servicio de mantenimiento guarda además: proyecto,
--      número de orden, número de reclamo, técnico, número de motor,
--      número de componente, fecha de inicio y de término, si fue por
--      garantía o por campaña (y cuál), kilometraje y estado
--      (programado, en proceso, terminado). Con eso funciona el buscador
--      de Mantenimiento. Los servicios que ya existen quedan "terminados"
--      y "sin cobertura".
--   2. INCIDENCIAS. Cada incidencia es "accidente" o "falla". Las que ya
--      existen quedan como "falla".
--   3. CAMPAÑAS. Tabla nueva para las campañas de servicio del fabricante.
--      Cualquiera de la empresa las ve y las registra; las edita quien las
--      creó o un administrador; solo un administrador las elimina.
--   4. CONVERSACIÓN DE TAREAS. Cada tarea tiene su propio chat entre quien
--      la asignó y quien la tiene. Los cambios de estado quedan escritos
--      en el mismo historial. Al terminar la tarea, el historial se
--      conserva y ya no recibe mensajes (si se reabre, sí).
--
-- Cómo aplicarla: pega TODO este archivo en Supabase → SQL Editor → Run.
-- Va DESPUÉS de la v23. Se puede correr más de una vez.
-- Después: publicar la página.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Servicios de mantenimiento
-- ------------------------------------------------------------
alter table public.maintenance_records
  add column if not exists project text,
  add column if not exists "workOrder" text,
  add column if not exists "claimNumber" text,
  add column if not exists technician text,
  add column if not exists "engineNumber" text,
  add column if not exists "componentNumber" text,
  add column if not exists "serviceStart" date,
  add column if not exists "serviceEnd" date,
  add column if not exists coverage text not null default 'none',
  add column if not exists "campaignCode" text,
  add column if not exists "odometerKm" integer,
  add column if not exists "serviceStatus" text not null default 'done';

-- 2. Incidencias: accidente o falla.
alter table public.incidents add column if not exists kind text not null default 'failure';

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('maintenance_records', 'maintenance_coverage_known', 'coverage in (''none'', ''warranty'', ''campaign'')'),
      ('maintenance_records', 'maintenance_service_status_known', '"serviceStatus" in (''scheduled'', ''in_progress'', ''done'')'),
      ('maintenance_records', 'maintenance_project_len', 'char_length(project) <= 200'),
      ('maintenance_records', 'maintenance_work_order_len', 'char_length("workOrder") <= 100'),
      ('maintenance_records', 'maintenance_claim_len', 'char_length("claimNumber") <= 100'),
      ('maintenance_records', 'maintenance_technician_len', 'char_length(technician) <= 200'),
      ('maintenance_records', 'maintenance_engine_len', 'char_length("engineNumber") <= 100'),
      ('maintenance_records', 'maintenance_component_len', 'char_length("componentNumber") <= 100'),
      ('maintenance_records', 'maintenance_campaign_len', 'char_length("campaignCode") <= 100'),
      ('maintenance_records', 'maintenance_odometer_range', '"odometerKm" is null or "odometerKm" between 0 and 100000000'),
      ('maintenance_records', 'maintenance_service_dates', '"serviceEnd" is null or "serviceStart" is null or "serviceEnd" >= "serviceStart"'),
      ('incidents', 'incidents_kind_known', 'kind in (''accident'', ''failure'')')
    ) as v(tbl, name, expr)
  loop
    if not exists (select 1 from pg_constraint where conname = r.name) then
      execute format('alter table public.%I add constraint %I check (%s)', r.tbl, r.name, r.expr);
    end if;
  end loop;
end;
$$;

create index if not exists maintenance_records_claim_idx on public.maintenance_records ("companyId", "claimNumber");
create index if not exists maintenance_records_service_start_idx on public.maintenance_records ("companyId", "serviceStart");

-- ------------------------------------------------------------
-- 3. Campañas de servicio
-- ------------------------------------------------------------
create table if not exists public.service_campaigns (
  id bigint generated always as identity primary key,
  "companyId" bigint not null references public.companies (id) on delete cascade,
  code text not null check (char_length(code) between 1 and 100),
  title text not null check (char_length(title) between 1 and 200),
  manufacturer text check (char_length(manufacturer) <= 150),
  "affectedUnits" text check (char_length("affectedUnits") <= 500),
  description text check (char_length(description) <= 4000),
  "startDate" date,
  "endDate" date,
  status text not null default 'active' check (status in ('active', 'closed')),
  "documentUrl" text check (char_length("documentUrl") <= 500),
  "createdBy" uuid default auth.uid() references auth.users (id) on delete set null,
  "createdAt" timestamptz not null default now(),
  constraint service_campaigns_dates check ("endDate" is null or "startDate" is null or "endDate" >= "startDate")
);
create unique index if not exists service_campaigns_code_idx on public.service_campaigns ("companyId", upper(code));

alter table public.service_campaigns enable row level security;

drop policy if exists "service_campaigns_select" on public.service_campaigns;
create policy "service_campaigns_select" on public.service_campaigns
  for select to authenticated using ("companyId" = public.current_company_id());

drop policy if exists "service_campaigns_insert" on public.service_campaigns;
create policy "service_campaigns_insert" on public.service_campaigns
  for insert to authenticated with check ("companyId" = public.current_company_id());

drop policy if exists "service_campaigns_update" on public.service_campaigns;
create policy "service_campaigns_update" on public.service_campaigns
  for update to authenticated
  using ("companyId" = public.current_company_id() and (public.is_company_admin() or "createdBy" = auth.uid()))
  with check ("companyId" = public.current_company_id());

drop policy if exists "service_campaigns_delete" on public.service_campaigns;
create policy "service_campaigns_delete" on public.service_campaigns
  for delete to authenticated using ("companyId" = public.current_company_id() and public.is_company_admin());

-- Igual que en las demás tablas: lo que la app no puede tocar, el sello al
-- crear, el límite por hora y la bitácora.
drop trigger if exists a_lock_columns on public.service_campaigns;
create trigger a_lock_columns before update on public.service_campaigns
  for each row execute function public.lock_columns('id', 'companyId', 'createdAt', 'createdBy');
drop trigger if exists a_stamp_client_insert on public.service_campaigns;
create trigger a_stamp_client_insert before insert on public.service_campaigns
  for each row execute function public.stamp_client_insert('createdBy', 'createdAt');
drop trigger if exists limit_inserts_trigger on public.service_campaigns;
create trigger limit_inserts_trigger before insert on public.service_campaigns
  for each row execute function public.limit_inserts('campaigns', '100', '1 hour', 'Llegaste al límite de campañas nuevas por hora. Intenta más tarde.');
drop trigger if exists audit_service_campaigns on public.service_campaigns;
create trigger audit_service_campaigns after insert or update or delete on public.service_campaigns
  for each row execute function public.audit_row_change();

-- Los boletines de campaña se suben a su propia carpeta.
drop policy if exists "documents_insert_own_company" on storage.objects;
create policy "documents_insert_own_company" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_company_id()::text
    and name ~ '^[0-9]+/(fuel|travel|misc|maintenance|compliance|vehicles|warranties|campaigns)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png|webp)$'
    and public.allow_upload()
  );

-- ------------------------------------------------------------
-- 4. Conversación de cada tarea
-- ------------------------------------------------------------
create table if not exists public.task_comments (
  id bigint generated always as identity primary key,
  "taskId" bigint not null references public.tasks (id) on delete cascade,
  "companyId" bigint not null references public.companies (id) on delete cascade,
  "authorId" uuid references auth.users (id) on delete set null,
  "authorName" text,
  kind text not null default 'comment' check (kind in ('comment', 'event')),
  body text not null check (char_length(body) between 1 and 2000),
  "createdAt" timestamptz not null default now()
);
create index if not exists task_comments_task_idx on public.task_comments ("taskId", id);

-- ¿Quien pregunta puede ver esta tarea? Lo mismo que en "tasks": quien la
-- tiene, quien la asignó o un administrador de la empresa.
create or replace function public.can_access_task(target_task bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = target_task
      and t."companyId" = public.current_company_id()
      and (public.is_company_admin() or t."assignedTo" = auth.uid() or t."createdBy" = auth.uid())
  );
$$;
revoke all on function public.can_access_task(bigint) from public, anon;
grant execute on function public.can_access_task(bigint) to authenticated;

alter table public.task_comments enable row level security;

drop policy if exists "task_comments_select" on public.task_comments;
create policy "task_comments_select" on public.task_comments
  for select to authenticated using (public.can_access_task("taskId"));

-- Desde la app solo se agregan mensajes; el historial no se edita ni se borra.
drop policy if exists "task_comments_insert" on public.task_comments;
create policy "task_comments_insert" on public.task_comments
  for insert to authenticated
  with check (public.can_access_task("taskId") and "authorId" = auth.uid() and kind = 'comment');

-- Autor, empresa y hora los pone la base. Una tarea terminada o cancelada
-- ya no recibe mensajes de la app.
create or replace function public.prepare_task_comment()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  task_status text;
begin
  new.body := trim(new.body);
  if new.body = '' then
    raise exception 'El mensaje está vacío.';
  end if;
  select status, "companyId" into task_status, new."companyId" from public.tasks where id = new."taskId";
  if current_user = 'authenticated' then
    new.kind := 'comment';
    new."authorId" := auth.uid();
    new."authorName" := (select "fullName" from public.profiles where id = auth.uid());
    new."createdAt" := now();
    if task_status in ('done', 'cancelled') then
      raise exception 'La tarea ya está cerrada. Reábrela para escribir de nuevo.';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.prepare_task_comment() from public, anon, authenticated;

drop trigger if exists a_prepare_task_comment on public.task_comments;
create trigger a_prepare_task_comment
  before insert on public.task_comments
  for each row execute function public.prepare_task_comment();

drop trigger if exists limit_inserts_trigger on public.task_comments;
create trigger limit_inserts_trigger before insert on public.task_comments
  for each row when (new.kind = 'comment') execute function public.limit_inserts('task_chat', '30', '1 minute', 'Estás enviando mensajes muy seguido. Espera un momento.');

-- Avisa a la otra persona de la tarea que hay un mensaje nuevo.
create or replace function public.notify_task_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  target uuid;
begin
  if new.kind <> 'comment' then
    return null;
  end if;
  select id, title, "assignedTo", "createdBy" into t from public.tasks where id = new."taskId";
  for target in
    select distinct u from unnest(array[t."assignedTo", t."createdBy"]) as u
    where u is not null and u is distinct from new."authorId"
  loop
    perform public.notify_user(
      target, new."companyId", 'task', 'Mensaje nuevo en una tarea',
      t.title || ': ' || left(new.body, 140),
      jsonb_build_object('tab', 'tasks', 'id', t.id)
    );
  end loop;
  return null;
end;
$$;
revoke all on function public.notify_task_comment() from public, anon, authenticated;

drop trigger if exists notify_task_comment on public.task_comments;
create trigger notify_task_comment
  after insert on public.task_comments
  for each row execute function public.notify_task_comment();

-- Los cambios de estado de la tarea quedan escritos en su historial.
create or replace function public.log_task_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  who text := coalesce((select "fullName" from public.profiles where id = auth.uid()), 'Navio');
  what text;
begin
  if tg_op = 'INSERT' then
    what := 'creó la tarea' || case when new."assignedToName" is not null then ' y se la asignó a ' || new."assignedToName" else '' end || '.';
  elsif new.status is distinct from old.status then
    what := case new.status
      when 'open' then 'reabrió la tarea.'
      when 'in_progress' then 'marcó la tarea como en proceso.'
      when 'done' then 'marcó la tarea como terminada.'
      when 'cancelled' then 'canceló la tarea.'
      else 'cambió el estado de la tarea.'
    end;
  elsif new."assignedTo" is distinct from old."assignedTo" then
    what := 'reasignó la tarea a ' || coalesce(new."assignedToName", 'nadie') || '.';
  else
    return null;
  end if;
  insert into public.task_comments ("taskId", "companyId", "authorId", "authorName", kind, body)
  values (new.id, new."companyId", auth.uid(), who, 'event', left(who || ' ' || what, 2000));
  return null;
end;
$$;
revoke all on function public.log_task_status() from public, anon, authenticated;

drop trigger if exists log_task_status on public.tasks;
create trigger log_task_status
  after insert or update of status, "assignedTo" on public.tasks
  for each row execute function public.log_task_status();

-- ------------------------------------------------------------
-- Verificación en dos pasos (v21) y tiempo real
-- ------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['service_campaigns', 'task_comments'] loop
    execute format('drop policy if exists mfa_required on public.%I', t);
    execute format(
      'create policy mfa_required on public.%I as restrictive for all to authenticated using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()))',
      t
    );
  end loop;
end;
$$;

revoke all on public.service_campaigns, public.task_comments from anon;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'task_comments'
     ) then
    alter publication supabase_realtime add table public.task_comments;
  end if;
end;
$$;

-- ============================================================
-- Listo. Verifica en Table Editor que existan "service_campaigns" y
-- "task_comments", y que "maintenance_records" tenga "claimNumber".
-- ============================================================
