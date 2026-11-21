-- ============================================================
-- NAVIO — Migración v31: "está escribiendo" en los chats
-- ============================================================
-- Qué hace: permite el aviso en vivo de "Fulano está escribiendo…" dentro de
-- una conversación. El aviso viaja por un canal privado de Supabase Realtime
-- llamado "typing:<número del chat>" y no se guarda en ninguna tabla.
--
-- Quién lo puede ver: solo quien puede leer ese chat (los participantes, o
-- toda la empresa en el chat General), con la verificación en dos pasos
-- cumplida. Nadie de fuera ni de otra empresa puede escuchar ni mandar avisos.
--
-- Cómo aplicarla: pega TODO este archivo en Supabase → SQL Editor → Run.
-- Va DESPUÉS de la v30. Se puede correr más de una vez.
-- Sin esta migración, Navio funciona igual, solo que no se ve el aviso.
-- ============================================================

-- Verdadero si el canal es "typing:<chat>" y quien pregunta puede leer ese chat.
create or replace function public.can_use_typing_topic(topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if topic is null or topic !~ '^typing:[0-9]{1,15}$' then
    return false;
  end if;
  return coalesce(public.can_access_channel(substring(topic from 8)::bigint), false);
end;
$$;
revoke all on function public.can_use_typing_topic(text) from public, anon;
grant execute on function public.can_use_typing_topic(text) to authenticated;

-- Escuchar los avisos del chat.
drop policy if exists navio_typing_listen on realtime.messages;
create policy navio_typing_listen
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and public.can_use_typing_topic((select realtime.topic()))
);

-- Mandar el aviso de que uno está escribiendo.
drop policy if exists navio_typing_send on realtime.messages;
create policy navio_typing_send
on realtime.messages
for insert
to authenticated
with check (
  realtime.messages.extension = 'broadcast'
  and public.can_use_typing_topic((select realtime.topic()))
);

-- ============================================================
-- Listo.
-- ============================================================
