-- ============================================================
-- Navio — Migración v4: base para el bot de WhatsApp/Telegram
-- ============================================================
-- Esto NO conecta ningún bot todavía — solo deja lista la parte
-- de base de datos para cuando se construya esa integración:
-- un lugar donde guardar a qué empresa pertenece cada chat, para
-- que los documentos que lleguen por WhatsApp/Telegram se
-- registren en la empresa correcta y nunca se mezclen entre sí.
--
-- También agrega "currency" a cada empresa (por defecto MXN),
-- para poder mostrar montos en la moneda que cada cliente use.
-- ============================================================

alter table public.companies add column if not exists "botChannel" text; -- null | 'whatsapp' | 'telegram'
alter table public.companies add column if not exists "botChatId" text;  -- id del chat/número ya vinculado a esta empresa
alter table public.companies add column if not exists "botLinkCode" text unique; -- código que la empresa ingresará en el bot para vincularse

alter table public.companies add column if not exists "currency" text not null default 'MXN';

-- ------------------------------------------------------------
-- Antes de esta migración no existía NINGUNA política de UPDATE
-- sobre "companies" — ni siquiera un admin de empresa podía
-- editar el nombre o la moneda de su propia empresa. Al agregar
-- una, hay que blindar los campos sensibles (status, inviteCode,
-- approvedBy/At, requestedBy) para que un admin de empresa no
-- pueda auto-aprobarse o robarse el código de invitación editando
-- su propia fila — el mismo patrón que ya protege "profiles".
-- ------------------------------------------------------------
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
  if not public.is_super_admin() then
    new.status := old.status;
    new."inviteCode" := old."inviteCode";
    new."approvedBy" := old."approvedBy";
    new."approvedAt" := old."approvedAt";
    new."requestedBy" := old."requestedBy";
  end if;
  return new;
end;
$$;

drop trigger if exists protect_company_privileges_trigger on public.companies;
create trigger protect_company_privileges_trigger
  before update on public.companies
  for each row execute function public.protect_company_privileges();

drop policy if exists "companies_update" on public.companies;
create policy "companies_update" on public.companies
  for update to authenticated
  using (id = public.current_company_id() and public.is_company_admin())
  with check (id = public.current_company_id() and public.is_company_admin());

-- ============================================================
-- Listo. Un admin de empresa ya puede editar moneda/nombre/datos
-- de contacto de SU empresa (y más adelante, sus datos de bot),
-- pero no puede tocar status/inviteCode/aprobación — eso sigue
-- controlado únicamente por approve_company()/reject_company().
-- El panel del sidebar ya muestra un estado "sin conectar"
-- honesto en vez de datos de ejemplo.
-- ============================================================
