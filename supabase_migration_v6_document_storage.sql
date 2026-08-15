-- ============================================================
-- Navio — Migración v6: Almacenamiento real de documentos
-- ============================================================
-- Corre esto DESPUÉS de supabase_migration_v5_telegram_bot.sql.
-- Es seguro de correr una sola vez (y de volver a correr).
--
-- Qué hace:
--   1. Crea un bucket privado de Storage llamado "documents",
--      donde se guardan las fotos/PDFs de facturas — tanto las
--      que llegan por el bot de Telegram como las que se suban
--      manualmente desde la plataforma.
--   2. Le agrega "documentUrl" a fuel_records/maintenance_records/
--      compliance_records: la ruta dentro del bucket del archivo
--      asociado a ese registro (nula si no se adjuntó nada).
--   3. Aísla el bucket por empresa: cada archivo se guarda bajo
--      una ruta que empieza con el id de la empresa
--      (ej. "3/fuel/8f2c1a9e.pdf"), y las políticas de Storage
--      solo dejan ver/subir archivos cuyo primer segmento de ruta
--      coincida con tu propia empresa — el mismo patrón de
--      aislamiento que ya usan las demás tablas.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Bucket privado
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- ------------------------------------------------------------
-- 2. documentUrl en las tres tablas de registros
-- ------------------------------------------------------------
alter table public.fuel_records add column if not exists "documentUrl" text;
alter table public.maintenance_records add column if not exists "documentUrl" text;
alter table public.compliance_records add column if not exists "documentUrl" text;

-- ------------------------------------------------------------
-- 3. Políticas de Storage: aislamiento por empresa según el
--    primer segmento de la ruta del archivo.
-- ------------------------------------------------------------
drop policy if exists "documents_select_own_company" on storage.objects;
create policy "documents_select_own_company" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_company_id()::text
  );

drop policy if exists "documents_insert_own_company" on storage.objects;
create policy "documents_insert_own_company" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_company_id()::text
  );

drop policy if exists "documents_delete_own_company" on storage.objects;
create policy "documents_delete_own_company" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_company_id()::text
  );

-- No hace falta política para el bot: la Edge Function usa la
-- llave de servicio, que ignora RLS de Storage igual que en las
-- demás tablas.

-- ============================================================
-- Listo. Verifica en Storage que exista el bucket "documents"
-- (privado). Los registros nuevos que lleguen por el bot o se
-- suban manualmente ya deberían traer "documentUrl" lleno.
-- ============================================================
