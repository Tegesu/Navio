-- ============================================================
-- NAVIO — Migración v30: tipos de archivo de las tareas
-- ============================================================
-- Qué hace: en las tareas solo se aceptan los formatos de oficina de
-- siempre: PDF, Word, Excel, CSV, PowerPoint, texto, imágenes JPG/PNG y XML
-- (facturas CFDI). Videos, audios, comprimidos y otros formatos ya no.
--
-- Cómo aplicarla: pega TODO este archivo en Supabase → SQL Editor → Run.
-- Va DESPUÉS de la v29. Se puede correr más de una vez.
-- ============================================================

create or replace function public.task_file_ok(object_name text, target_task bigint)
returns boolean
language sql
immutable
as $$
  select object_name ~ ('^[0-9]+/' || target_task::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|doc|docx|xls|xlsx|csv|ppt|pptx|txt|jpg|png|xml)$');
$$;
revoke all on function public.task_file_ok(text, bigint) from public, anon;
grant execute on function public.task_file_ok(text, bigint) to authenticated;

update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'image/jpeg', 'image/png', 'application/xml', 'text/xml'
]
where id = 'tasks';

-- ============================================================
-- Listo.
-- ============================================================
