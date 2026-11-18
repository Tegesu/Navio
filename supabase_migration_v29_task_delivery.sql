-- ============================================================
-- NAVIO — Migración v29: tareas con entrega, avance y archivos
-- ============================================================
-- Qué hace:
--   1. Un paso nuevo en las tareas: "Entregada" (quien la tiene la entrega
--      y quien la asignó la revisa: la aprueba o pide cambios).
--   2. Archivos en la conversación de la tarea (para entregar la actividad
--      o demostrar que se hizo). Se guardan en un almacén privado "tasks".
--   3. Quienes están en el chat de donde salió una tarea también ven su
--      conversación (como ya veían la tarea, desde la v28).
--
-- Cómo aplicarla: pega TODO este archivo en Supabase → SQL Editor → Run.
-- Va DESPUÉS de la v28. Se puede correr más de una vez.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Paso "Entregada" (review)
-- ------------------------------------------------------------
alter table public.tasks drop constraint if exists tasks_status_check;
alter table public.tasks add constraint tasks_status_check check (status in ('open', 'in_progress', 'review', 'done', 'cancelled'));

-- El historial dice quién entregó, aprobó o pidió cambios.
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
    what := case
      when new.status = 'open' then 'reabrió la tarea.'
      when new.status = 'in_progress' and old.status = 'review' then 'pidió cambios en la entrega.'
      when new.status = 'in_progress' then 'marcó la tarea como en proceso.'
      when new.status = 'review' then 'entregó la tarea para revisión.'
      when new.status = 'done' and old.status = 'review' then 'aprobó la entrega y resolvió la tarea.'
      when new.status = 'done' then 'marcó la tarea como terminada.'
      when new.status = 'cancelled' then 'canceló la tarea.'
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

-- Avisos: asignada, entregada (a quien la asignó), cambios pedidos y terminada.
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
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'review' and new."createdBy" is not null and new."createdBy" is distinct from auth.uid() then
      perform public.notify_user(new."createdBy", new."companyId", 'task', 'Entregaron una tarea para revisar',
        new.title || ' — ' || coalesce(new."assignedToName", 'sin asignar'), link);
    elsif new.status = 'in_progress' and old.status = 'review' and new."assignedTo" is not null and new."assignedTo" is distinct from auth.uid() then
      perform public.notify_user(new."assignedTo", new."companyId", 'task', 'Te pidieron cambios en una tarea', new.title, link);
    elsif new.status = 'done' and new."createdBy" is not null and new."createdBy" is distinct from auth.uid() then
      perform public.notify_user(new."createdBy", new."companyId", 'task', 'Tarea terminada',
        new.title || ' — ' || coalesce(new."assignedToName", 'sin asignar'), link);
    elsif new.status = 'done' and old.status = 'review' and new."assignedTo" is not null and new."assignedTo" is distinct from auth.uid() then
      perform public.notify_user(new."assignedTo", new."companyId", 'task', 'Aprobaron tu entrega', new.title, link);
    end if;
  end if;
  return null;
end;
$$;

-- ------------------------------------------------------------
-- 2. Quién ve la conversación de una tarea
-- ------------------------------------------------------------
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
      and (
        public.is_company_admin() or t."assignedTo" = auth.uid() or t."createdBy" = auth.uid()
        or (t."channelId" is not null and public.can_access_channel(t."channelId"))
      )
  );
$$;

-- ------------------------------------------------------------
-- 3. Archivos en la conversación de la tarea
-- ------------------------------------------------------------
alter table public.task_comments add column if not exists attachment jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'task_comments_attachment_size') then
    alter table public.task_comments add constraint task_comments_attachment_size check (attachment is null or octet_length(attachment::text) <= 2000);
  end if;
end $$;

-- Nombre de un archivo de tarea: empresa/tarea/uuid.extensión.
create or replace function public.task_file_ok(object_name text, target_task bigint)
returns boolean
language sql
immutable
as $$
  select object_name ~ ('^[0-9]+/' || target_task::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|gif|heic|mp4|webm|mov|m4a|mp3|ogg|aac|wav|pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|zip|xml)$');
$$;
revoke all on function public.task_file_ok(text, bigint) from public, anon;
grant execute on function public.task_file_ok(text, bigint) to authenticated;

-- Igual que en la v24, más el archivo (con nombre válido y de su tarea).
create or replace function public.prepare_task_comment()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  task_status text;
  task_company bigint;
  path text := new.attachment ->> 'path';
begin
  new.body := trim(coalesce(new.body, ''));
  select status, "companyId" into task_status, task_company from public.tasks where id = new."taskId";
  new."companyId" := task_company;
  if new.attachment is not null then
    if path is null or not public.task_file_ok(path, new."taskId") or split_part(path, '/', 1) <> task_company::text then
      raise exception 'El archivo no es válido para esta tarea.';
    end if;
    new.attachment := jsonb_strip_nulls(jsonb_build_object(
      'path', path,
      'name', left(new.attachment ->> 'name', 200),
      'mime', left(new.attachment ->> 'mime', 100),
      'size', case when (new.attachment ->> 'size') ~ '^[0-9]{1,10}$' then (new.attachment ->> 'size')::bigint end
    ));
    if new.body = '' then
      new.body := coalesce(new.attachment ->> 'name', 'Archivo');
    end if;
  end if;
  if new.body = '' then
    raise exception 'El mensaje está vacío.';
  end if;
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

-- Almacén privado de los archivos de tareas.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tasks', 'tasks', false, 26214400,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic',
    'video/mp4', 'video/webm', 'video/quicktime',
    'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/wav', 'audio/x-m4a',
    'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain', 'text/csv', 'application/zip', 'application/xml', 'text/xml'
  ]
)
on conflict (id) do update
set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- ¿Puede quien pregunta usar este archivo? Quien ve la tarea; para subir,
-- además la tarea debe seguir abierta.
create or replace function public.can_use_task_file(object_name text, for_write boolean)
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
  if my_company is null or parts[1] is distinct from my_company::text or coalesce(parts[2], '') !~ '^[0-9]{1,18}$' then
    return false;
  end if;
  if not public.can_access_task(parts[2]::bigint) then
    return false;
  end if;
  if for_write then
    return public.task_file_ok(object_name, parts[2]::bigint)
       and exists (select 1 from public.tasks where id = parts[2]::bigint and status not in ('done', 'cancelled'));
  end if;
  return true;
end;
$$;
revoke all on function public.can_use_task_file(text, boolean) from public, anon;
grant execute on function public.can_use_task_file(text, boolean) to authenticated;

drop policy if exists "task_files_select" on storage.objects;
create policy "task_files_select" on storage.objects
  for select to authenticated using (bucket_id = 'tasks' and public.can_use_task_file(name, false));

drop policy if exists "task_files_insert" on storage.objects;
create policy "task_files_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'tasks' and public.can_use_task_file(name, true) and public.allow_upload());

drop policy if exists "task_files_delete" on storage.objects;
create policy "task_files_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'tasks'
    and (storage.foldername(name))[1] = public.current_company_id()::text
    and (owner_id = auth.uid()::text or public.is_company_admin())
  );

-- ============================================================
-- Listo. Verifica en Storage que exista el almacén "tasks".
-- ============================================================
