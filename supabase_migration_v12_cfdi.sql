-- ============================================================
-- Navio — Migración v12: Datos fiscales (CFDI) de las facturas
-- ============================================================
-- Corre esto DESPUÉS de supabase_migration_v11_invoice_overview.sql
-- y ANTES de publicar la versión nueva del bot.
-- Es seguro de correr una sola vez (y de volver a correr).
--
-- Qué hace:
--   Agrega la columna "cfdi" a las tablas donde el bot puede guardar
--   una factura. Ahí queda todo lo que Gemini lee del documento:
--   folio fiscal (UUID), emisor y receptor (RFC, régimen, uso de
--   CFDI), forma y método de pago, importes e impuestos, las partidas
--   de la factura y datos adicionales (huésped, estancia, etc.).
--
--   Es una sola columna JSON porque cada documento trae campos
--   distintos (un hotel no se parece a un ticket de gasolina). Monto,
--   fecha, proveedor y folio siguen en sus columnas de siempre.
-- ============================================================

alter table public.fuel_records add column if not exists cfdi jsonb;
alter table public.travel_expenses add column if not exists cfdi jsonb;
alter table public.misc_expenses add column if not exists cfdi jsonb;
alter table public.maintenance_records add column if not exists cfdi jsonb;
alter table public.compliance_records add column if not exists cfdi jsonb;

-- ============================================================
-- Listo. Verifica en Table Editor que esas cinco tablas tengan la
-- columna "cfdi".
-- ============================================================
