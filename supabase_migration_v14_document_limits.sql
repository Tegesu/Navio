-- ============================================================
-- Navio — Migración v14: Límites del bucket de documentos
-- ============================================================
-- Corre esto DESPUÉS de supabase_migration_v13_invoice_workflow.sql.
-- Es seguro de correr una sola vez (y de volver a correr).
--
-- Qué hace:
--   El bucket "documents" aceptaba cualquier tipo de archivo y de
--   cualquier tamaño; el límite solo estaba en el formulario, que
--   alguien con sesión puede saltarse llamando directo a la API.
--   Ahora Storage solo acepta PDF, JPG, PNG y WEBP de hasta 20 MB.
--   Los archivos que ya estaban guardados no se tocan.
--
--   El bot no se ve afectado: Telegram no entrega archivos de más
--   de 20 MB y el bot solo los guarda como PDF, PNG o JPG.
-- ============================================================

update storage.buckets
set
  allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
  file_size_limit = 20971520
where id = 'documents';

-- ============================================================
-- Listo. Verifica con:
--   select allowed_mime_types, file_size_limit
--   from storage.buckets where id = 'documents';
-- ============================================================
