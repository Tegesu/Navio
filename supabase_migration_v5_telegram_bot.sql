-- ============================================================
-- Navio — Migración v5: Bot de Telegram (ingesta de facturas)
-- ============================================================
-- Corre esto DESPUÉS de supabase_migration_v4_bot_link_prep.sql.
-- Es seguro de correr una sola vez (y de volver a correr).
--
-- Qué hace:
--   1. Genera un "botLinkCode" para las empresas ya aprobadas que
--      todavía no tuvieran uno (lo dejamos preparado en v4, esto
--      lo rellena). Además, de aquí en adelante, cada vez que se
--      apruebe una empresa nueva, se le genera su código junto
--      con el de invitación.
--   2. Crea "bot_ingestions": un registro corto de los últimos
--      documentos que el bot recibió por empresa (para el panel
--      "Bot de Ingesta" del sidebar) — la Edge Function del bot
--      escribe aquí con la llave de servicio (no pasa por RLS de
--      usuario), y cada empresa solo puede LEER sus propias filas.
-- ============================================================

-- ------------------------------------------------------------
-- 1. botLinkCode para empresas ya aprobadas
-- ------------------------------------------------------------
update public.companies
set "botLinkCode" = upper(substr(md5(random()::text || clock_timestamp()::text || id::text), 1, 8))
where status = 'approved' and "botLinkCode" is null;

create or replace function public.approve_company(target_company_id bigint)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  new_code text;
  new_bot_code text;
  requester uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Solo un super-administrador puede aprobar empresas.';
  end if;

  new_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
  new_bot_code := upper(substr(md5(random()::text || clock_timestamp()::text || 'bot'), 1, 8));

  update public.companies
  set status = 'approved',
      "inviteCode" = new_code,
      "botLinkCode" = coalesce("botLinkCode", new_bot_code),
      "approvedBy" = auth.uid(),
      "approvedAt" = now()
  where id = target_company_id
  returning "requestedBy" into requester;

  if requester is not null then
    perform set_config('navio.trusted_write', 'on', true);
    update public.profiles set "companyId" = target_company_id, "companyRole" = 'admin' where id = requester;
  end if;

  return new_code;
end;
$$;

grant execute on function public.approve_company(bigint) to authenticated;

-- ------------------------------------------------------------
-- 2. bot_ingestions: bitácora corta por empresa
-- ------------------------------------------------------------
create table if not exists public.bot_ingestions (
  id bigint generated always as identity primary key,
  "companyId" bigint not null references public.companies (id),
  channel text not null,
  summary text not null,
  module text,
  status text not null default 'success',
  "recordId" bigint,
  "createdAt" timestamptz not null default now()
);

alter table public.bot_ingestions enable row level security;

drop policy if exists "bot_ingestions_select" on public.bot_ingestions;
create policy "bot_ingestions_select" on public.bot_ingestions
  for select to authenticated
  using ("companyId" = public.current_company_id());

-- Sin políticas de insert/update/delete para "authenticated" a propósito:
-- solo la Edge Function (con la llave de servicio, que ignora RLS) escribe aquí.

-- ============================================================
-- Listo. Verifica en Table Editor:
--   - "companies" tiene "botLinkCode" lleno para las empresas
--     aprobadas.
--   - Existe la tabla "bot_ingestions".
-- ============================================================
