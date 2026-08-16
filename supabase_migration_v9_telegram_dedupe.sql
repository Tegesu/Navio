-- ============================================================
-- Navio — Migración v9: deduplicación de updates de Telegram
-- ============================================================
-- Corre esto DESPUÉS de supabase_migration_v8_travel_expenses.sql.
-- Es seguro de correr una sola vez (y de volver a correr).
--
-- Por qué existe:
--   Cuando el webhook tarda mucho en responder (Gemini reintentando
--   varias veces ante un 503), Telegram interpreta que no hubo
--   respuesta a tiempo y reenvía el MISMO mensaje. El webhook lo
--   procesaba de nuevo desde cero: doble registro en la base de
--   datos y doble llamada a Gemini en paralelo para el mismo
--   documento (lo cual además hacía más probable el 503, porque
--   duplicaba la carga justo cuando el modelo ya estaba saturado).
--
--   Esta tabla guarda el "update_id" que manda Telegram en cada
--   mensaje. El webhook intenta insertarlo ANTES de hacer cualquier
--   trabajo real; si ya existe (porque es un reenvío del mismo
--   update), corta la ejecución de inmediato sin volver a llamar a
--   Gemini ni a guardar nada.
-- ============================================================

create table if not exists public.telegram_processed_updates (
  "updateId" bigint primary key,
  "processedAt" timestamptz not null default now()
);

alter table public.telegram_processed_updates enable row level security;
-- Sin políticas a propósito: solo el edge function (llave de servicio,
-- que ignora RLS) necesita tocar esta tabla. Nadie más debería leerla
-- ni escribirla.

-- ============================================================
-- Listo. Verifica en Table Editor que exista
-- "telegram_processed_updates".
-- ============================================================
