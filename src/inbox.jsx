import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  CheckCheck,
  CheckCircle2,
  ClipboardList,
  Lock,
  Megaphone,
  MessageSquare,
  Navigation,
  Plus,
  Receipt,
  Send,
  Trash2,
  User,
  Users,
  X,
} from "lucide-react";
import { supabase, useAuth, useToast, useDateFormat, formatDate, Modal, avatarUrl, timeAgoLabel, localISODate } from "./NavioDashboard.jsx";
import { usePeople, personName } from "./people.jsx";

/* ---------------------------------------------------------------------- */
/*  Bandeja: alertas, mensajes y tareas de la persona                     */
/* ---------------------------------------------------------------------- */

// Una sola suscripción en tiempo real alimenta la campana, los mensajes y las
// tareas. Lo que llega ya viene filtrado por la base de datos: cada quien
// recibe solo lo de su empresa y lo que le corresponde ver.
const InboxContext = createContext(null);

export function useInbox() {
  return useContext(InboxContext);
}

let inboxChannelSeq = 0;

export function InboxProvider({ children }) {
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const [notifications, setNotifications] = useState([]);
  const [channels, setChannels] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [available, setAvailable] = useState(true); // false si falta la migración v17
  const messageListeners = useRef(new Set());
  const overviewTimer = useRef(null);
  const userId = user?.id ?? null;
  const companyId = profile?.companyId ?? null;

  const loadNotifications = useCallback(async () => {
    const { data, error } = await supabase.from("notifications").select("*").order("createdAt", { ascending: false }).limit(60);
    if (error) setAvailable(false);
    else setNotifications(data ?? []);
  }, []);

  const loadChannels = useCallback(async () => {
    const { data, error } = await supabase.rpc("chat_overview");
    if (!error) setChannels(data ?? []);
  }, []);

  const loadTasks = useCallback(async () => {
    const { data, error } = await supabase.from("tasks").select("*").order("createdAt", { ascending: false }).limit(300);
    if (!error) setTasks(data ?? []);
  }, []);

  useEffect(() => {
    if (!userId || !companyId) return undefined;
    loadNotifications();
    loadTasks();
    supabase.rpc("ensure_general_channel").then(loadChannels);

    const refreshOverview = () => {
      window.clearTimeout(overviewTimer.current);
      overviewTimer.current = window.setTimeout(loadChannels, 400);
    };
    const channel = supabase
      .channel(`inbox-${++inboxChannelSeq}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, (payload) => {
        if (payload.new.userId !== userId) return;
        setNotifications((prev) => (prev.some((n) => n.id === payload.new.id) ? prev : [payload.new, ...prev]));
        showToast(`Nueva alerta: ${payload.new.title}`);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages" }, (payload) => {
        messageListeners.current.forEach((listener) => listener(payload));
        refreshOverview();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, loadTasks)
      .subscribe();
    return () => {
      window.clearTimeout(overviewTimer.current);
      supabase.removeChannel(channel);
    };
    // showToast cambia en cada render de la app; no debe reiniciar la suscripción.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, companyId, loadNotifications, loadChannels, loadTasks]);

  const markRead = useCallback(async (ids) => {
    const list = ids.filter(Boolean);
    if (list.length === 0) return;
    const readAt = new Date().toISOString();
    setNotifications((prev) => prev.map((n) => (list.includes(n.id) && !n.readAt ? { ...n, readAt } : n)));
    await supabase.from("notifications").update({ readAt }).in("id", list);
  }, []);

  const removeNotification = useCallback(async (id) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    await supabase.from("notifications").delete().eq("id", id);
  }, []);

  const subscribeMessages = useCallback((listener) => {
    messageListeners.current.add(listener);
    return () => messageListeners.current.delete(listener);
  }, []);

  const markChannelRead = useCallback(async (channelId) => {
    setChannels((prev) => prev.map((c) => (c.id === channelId ? { ...c, unread: 0 } : c)));
    await supabase.rpc("mark_channel_read", { target_channel: channelId });
  }, []);

  const value = useMemo(() => {
    const openTasks = tasks.filter((t) => t.assignedTo === userId && (t.status === "open" || t.status === "in_progress"));
    return {
      available,
      notifications,
      unreadNotifications: notifications.filter((n) => !n.readAt).length,
      markRead,
      removeNotification,
      channels,
      unreadMessages: channels.reduce((sum, c) => sum + (c.unread || 0), 0),
      reloadChannels: loadChannels,
      markChannelRead,
      subscribeMessages,
      tasks,
      myOpenTasks: openTasks.length,
      reloadTasks: loadTasks,
    };
  }, [available, notifications, channels, tasks, userId, markRead, removeNotification, loadChannels, markChannelRead, subscribeMessages, loadTasks]);

  return <InboxContext.Provider value={value}>{children}</InboxContext.Provider>;
}

function CountBadge({ count, className = "" }) {
  if (!count) return null;
  return (
    <span className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-none text-white ${className}`}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

// Contador junto a "Mensajes" y "Tareas" en el menú.
export function NavBadge({ id }) {
  const inbox = useInbox();
  const count = id === "messages" ? inbox?.unreadMessages : id === "tasks" ? inbox?.myOpenTasks : 0;
  return <CountBadge count={count} />;
}

/* ---------------------------------------------------------------------- */
/*  Alertas (campana)                                                     */
/* ---------------------------------------------------------------------- */

const NOTIFICATION_ICONS = { alert: Megaphone, task: ClipboardList, trip: Navigation, invoice: Receipt, team: Users };

export function BellButton({ onClick }) {
  const inbox = useInbox();
  const count = inbox?.unreadNotifications ?? 0;
  return (
    <button
      onClick={onClick}
      className="relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
      aria-label={count ? `Alertas: ${count} sin leer` : "Alertas"}
    >
      <Bell size={19} />
      <CountBadge count={count} className="absolute -right-0.5 -top-0.5 ring-2 ring-white" />
    </button>
  );
}

function SendAlertModal({ onClose }) {
  const { user } = useAuth();
  const { people } = usePeople();
  const { showToast } = useToast();
  const others = people.filter((p) => p.id !== user?.id);
  const [toAll, setToAll] = useState(true);
  const [selected, setSelected] = useState([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const inputClass = "w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-blue-400 focus:outline-none";
  const canSend = title.trim().length >= 3 && (toAll ? others.length > 0 : selected.length > 0) && !sending;

  async function handleSend(e) {
    e.preventDefault();
    setSending(true);
    setError("");
    const { data, error: rpcError } = await supabase.rpc("send_alert", { recipients: toAll ? null : selected, alert_title: title.trim(), alert_body: body.trim() || null });
    setSending(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    showToast(`Alerta enviada a ${data} persona${data === 1 ? "" : "s"}.`);
    onClose();
  }

  return (
    <Modal title="Enviar alerta" width="max-w-md" onClose={onClose}>
      <form onSubmit={handleSend} className="space-y-3">
        <div>
          <label className="mb-1 block text-[11px] font-semibold text-slate-500">Para</label>
          <div className="flex gap-1.5 rounded-xl bg-slate-100 p-1">
            {[
              [true, `Toda la empresa (${others.length})`],
              [false, "Personas que elija"],
            ].map(([all, label]) => (
              <button
                key={label}
                type="button"
                onClick={() => setToAll(all)}
                className={`flex-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition ${toAll === all ? "bg-white text-blue-700 shadow-sm" : "text-slate-500"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {!toAll && (
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-slate-100 p-2">
            {others.map((p) => (
              <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={selected.includes(p.id)}
                  onChange={() => setSelected((prev) => (prev.includes(p.id) ? prev.filter((id) => id !== p.id) : [...prev, p.id]))}
                  className="h-4 w-4 accent-blue-600"
                />
                {personName(p)}
              </label>
            ))}
            {others.length === 0 && <p className="py-2 text-center text-[11px] text-slate-400">Todavía no hay más personas en la empresa.</p>}
          </div>
        )}
        <div>
          <label className="mb-1 block text-[11px] font-semibold text-slate-500">Título</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Ej. Junta de seguridad el viernes" className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-semibold text-slate-500">Mensaje (opcional)</label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={2000} className={inputClass} />
        </div>
        {error && <p className="rounded-lg bg-rose-50 px-2.5 py-2 text-[11px] font-medium text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">
            Cancelar
          </button>
          <button type="submit" disabled={!canSend} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
            <Megaphone size={13} /> {sending ? "Enviando…" : "Enviar alerta"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// El contenido de la campana. onNavigate(tab) lleva a la sección de la alerta.
export function NotificationsPanel({ isAdmin, onNavigate, onClose }) {
  const inbox = useInbox();
  const [sending, setSending] = useState(false);
  const list = inbox?.notifications ?? [];
  const unread = list.filter((n) => !n.readAt).map((n) => n.id);

  function open(notification) {
    inbox.markRead([notification.id]);
    if (notification.link?.tab) {
      onNavigate(notification.link.tab);
      onClose();
    }
  }

  return (
    <>
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <p className="text-xs font-bold text-slate-700">Alertas</p>
        <div className="flex items-center gap-3 text-[11px] font-semibold text-blue-600">
          {unread.length > 0 && <button onClick={() => inbox.markRead(unread)}>Marcar todo como leído</button>}
          {isAdmin && (
            <button onClick={() => setSending(true)} className="flex items-center gap-1">
              <Megaphone size={12} /> Enviar alerta
            </button>
          )}
        </div>
      </div>
      <div className="max-h-[60vh] space-y-1 overflow-y-auto">
        {inbox && !inbox.available && <p className="px-2 py-4 text-center text-[11px] text-slate-400">Las alertas se activan al aplicar la actualización de la base de datos.</p>}
        {inbox?.available && list.length === 0 && <p className="px-2 py-6 text-center text-[11px] text-slate-400">Sin alertas por ahora.</p>}
        {list.map((n) => {
          const Icon = NOTIFICATION_ICONS[n.kind] ?? Bell;
          return (
            <div key={n.id} className={`group flex items-start gap-2 rounded-xl px-2 py-2 ${n.readAt ? "" : "bg-blue-50/70"}`}>
              <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${n.readAt ? "bg-slate-100 text-slate-400" : "bg-blue-100 text-blue-600"}`}>
                <Icon size={14} />
              </span>
              <button onClick={() => open(n)} className="min-w-0 flex-1 text-left">
                <p className={`break-words text-xs ${n.readAt ? "font-medium text-slate-600" : "font-bold text-slate-800"}`}>{n.title}</p>
                {n.body && <p className="break-words text-[11px] text-slate-500">{n.body}</p>}
                <p className="mt-0.5 text-[10px] text-slate-400">
                  {n.createdByName ? `${n.createdByName} · ` : ""}
                  {timeAgoLabel(n.createdAt)}
                </p>
              </button>
              <button
                onClick={() => inbox.removeNotification(n.id)}
                aria-label="Quitar alerta"
                className="shrink-0 rounded-md p-1 text-slate-300 opacity-0 hover:bg-slate-100 hover:text-rose-500 focus:opacity-100 group-hover:opacity-100"
              >
                <Trash2 size={12} />
              </button>
            </div>
          );
        })}
      </div>
      {sending && <SendAlertModal onClose={() => setSending(false)} />}
    </>
  );
}

/* ---------------------------------------------------------------------- */
/*  Mensajes                                                              */
/* ---------------------------------------------------------------------- */

const PAGE_SIZE = 50;
const channelTitle = (c) => (c.kind === "general" ? "General" : c.kind === "direct" ? c.otherUserName || "Conversación" : c.name || "Grupo");
const dayLabel = (iso) => {
  const day = localISODate(new Date(iso));
  const today = localISODate();
  const yesterday = localISODate(new Date(Date.now() - 86400000));
  return day === today ? "Hoy" : day === yesterday ? "Ayer" : new Date(iso).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
};
const hourLabel = (iso) => new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });

function ChannelAvatar({ channel, size = "h-9 w-9" }) {
  if (channel.kind === "direct") return <img src={avatarUrl(channelTitle(channel))} alt="" className={`${size} shrink-0 rounded-full`} />;
  const Icon = channel.kind === "general" ? MessageSquare : Users;
  return (
    <span className={`${size} flex shrink-0 items-center justify-center rounded-full ${channel.kind === "general" ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-600"}`}>
      <Icon size={15} />
    </span>
  );
}

function NewConversationModal({ group = null, initialMode = "direct", onOpen, onClose }) {
  const { user } = useAuth();
  const { people } = usePeople();
  const others = people.filter((p) => p.id !== user?.id);
  const [mode, setMode] = useState(group ? "group" : initialMode);
  const [name, setName] = useState(group?.name ?? "");
  const [members, setMembers] = useState(group?.memberIds ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(promise) {
    setBusy(true);
    setError("");
    const { data, error: rpcError } = await promise;
    setBusy(false);
    if (rpcError) setError(rpcError.message);
    else onOpen(data);
  }

  return (
    <Modal title={group ? "Editar grupo" : "Nueva conversación"} width="max-w-md" onClose={onClose}>
      {!group && (
        <div className="mb-3 flex gap-1.5 rounded-xl bg-slate-100 p-1">
          {[
            ["direct", "Con una persona"],
            ["group", "Grupo"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setMode(id)}
              className={`flex-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition ${mode === id ? "bg-white text-blue-700 shadow-sm" : "text-slate-500"}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {mode === "group" && (
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          placeholder="Nombre del grupo (ej. Taller)"
          className="mb-2 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-blue-400 focus:outline-none"
        />
      )}
      <div className="max-h-64 space-y-1 overflow-y-auto">
        {others.map((p) =>
          mode === "direct" ? (
            <button
              key={p.id}
              disabled={busy}
              onClick={() => run(supabase.rpc("open_direct_channel", { other_user: p.id }))}
              className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left hover:bg-slate-50 disabled:opacity-60"
            >
              <img src={avatarUrl(personName(p))} alt="" className="h-8 w-8 rounded-full" />
              <span className="min-w-0">
                <span className="block truncate text-xs font-semibold text-slate-700">{personName(p)}</span>
                <span className="block truncate text-[11px] text-slate-400">{p.jobTitle || (p.companyRole === "admin" ? "Administrador" : "Usuario")}</span>
              </span>
            </button>
          ) : (
            <label key={p.id} className="flex cursor-pointer items-center gap-2.5 rounded-xl px-2 py-2 hover:bg-slate-50">
              <input
                type="checkbox"
                checked={members.includes(p.id)}
                onChange={() => setMembers((prev) => (prev.includes(p.id) ? prev.filter((id) => id !== p.id) : [...prev, p.id]))}
                className="h-4 w-4 accent-blue-600"
              />
              <span className="truncate text-xs font-medium text-slate-700">{personName(p)}</span>
            </label>
          )
        )}
        {others.length === 0 && <p className="py-6 text-center text-xs text-slate-400">Todavía no hay más personas en tu empresa. Invítalas desde Configuración.</p>}
      </div>
      {error && <p className="mt-2 rounded-lg bg-rose-50 px-2.5 py-2 text-[11px] font-medium text-rose-700">{error}</p>}
      {mode === "group" && (
        <button
          disabled={busy || !name.trim() || members.length === 0}
          onClick={() => run(supabase.rpc("save_group_channel", { target_channel: group?.id ?? null, channel_name: name.trim(), member_ids: members }))}
          className="mt-3 w-full rounded-lg bg-blue-600 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? "Guardando…" : group ? "Guardar grupo" : "Crear grupo"}
        </button>
      )}
    </Modal>
  );
}

function Conversation({ channel, isAdmin, onBack, onChanged }) {
  const { user } = useAuth();
  const inbox = useInbox();
  const { showToast } = useToast();
  const [messages, setMessages] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState(null);
  const scrollRef = useRef(null);
  const stickRef = useRef(true);
  const channelId = channel.id;

  const load = useCallback(
    async (beforeId = null) => {
      let query = supabase.from("chat_messages").select("*").eq("channelId", channelId).order("id", { ascending: false }).limit(PAGE_SIZE);
      if (beforeId) query = query.lt("id", beforeId);
      const { data } = await query;
      const page = (data ?? []).slice().reverse();
      setHasMore(page.length === PAGE_SIZE);
      setMessages((prev) => (beforeId ? [...page, ...(prev ?? [])] : page));
    },
    [channelId]
  );

  useEffect(() => {
    setMessages(null);
    setDraft("");
    stickRef.current = true;
    load();
    inbox.markChannelRead(channelId);
    return inbox.subscribeMessages((payload) => {
      const row = payload.new;
      if (!row || row.channelId !== channelId) return;
      setMessages((prev) => {
        if (!prev) return prev;
        if (payload.eventType === "INSERT") return prev.some((m) => m.id === row.id) ? prev : [...prev, row];
        return prev.map((m) => (m.id === row.id ? row : m));
      });
      if (payload.eventType === "INSERT" && row.senderId !== user?.id) inbox.markChannelRead(channelId);
    });
    // "inbox" cambia con cada mensaje; solo interesa el canal abierto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, load]);

  // Se queda abajo al llegar mensajes, salvo que la persona esté leyendo arriba.
  useEffect(() => {
    const box = scrollRef.current;
    if (box && stickRef.current) box.scrollTop = box.scrollHeight;
  }, [messages]);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    stickRef.current = true;
    const { data, error } = await supabase.from("chat_messages").insert({ channelId, body }).select().single();
    setSending(false);
    if (error) {
      showToast(`No se pudo enviar: ${error.message}`);
      return;
    }
    setDraft("");
    setMessages((prev) => (prev && !prev.some((m) => m.id === data.id) ? [...prev, data] : prev));
    inbox.reloadChannels();
  }

  async function removeMessage(message) {
    const { error } = await supabase.rpc("delete_chat_message", { target_message: message.id });
    if (error) showToast(`No se pudo borrar: ${error.message}`);
    else setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, body: "", deletedAt: new Date().toISOString() } : m)));
  }

  async function leave() {
    const { error } = await supabase.rpc("leave_channel", { target_channel: channelId });
    if (error) showToast(error.message);
    else onChanged(null);
  }

  async function editGroup() {
    const { data } = await supabase.from("chat_members").select("userId").eq("channelId", channelId);
    setEditing({ id: channelId, name: channel.name, memberIds: (data ?? []).map((m) => m.userId).filter((id) => id !== user?.id) });
  }

  const canManage = channel.kind === "group" && (channel.createdBy === user?.id || isAdmin);
  let lastDay = null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2.5 border-b border-slate-100 px-3 py-2.5">
        <button onClick={onBack} aria-label="Volver a las conversaciones" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 lg:hidden">
          <ArrowLeft size={16} />
        </button>
        <ChannelAvatar channel={channel} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-slate-800">{channelTitle(channel)}</p>
          <p className="truncate text-[11px] text-slate-400">
            {channel.kind === "general" ? `Toda la empresa · ${channel.members} personas` : channel.kind === "group" ? `${channel.members} participantes` : "Conversación directa"}
          </p>
        </div>
        {canManage && (
          <button onClick={editGroup} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
            Participantes
          </button>
        )}
        {channel.kind === "group" && channel.createdBy !== user?.id && (
          <button onClick={leave} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-500 hover:bg-slate-50">
            Salir
          </button>
        )}
      </div>

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const box = e.currentTarget;
          stickRef.current = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
        }}
        className="min-h-0 flex-1 space-y-1 overflow-y-auto bg-slate-50/60 px-3 py-3"
      >
        {messages === null && <p className="py-8 text-center text-xs text-slate-400">Cargando mensajes…</p>}
        {hasMore && (
          <button
            onClick={() => {
              stickRef.current = false;
              load(messages[0].id);
            }}
            className="mx-auto block rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-blue-600 shadow-sm"
          >
            Cargar mensajes anteriores
          </button>
        )}
        {messages?.length === 0 && <p className="py-8 text-center text-xs text-slate-400">Todavía no hay mensajes. Escribe el primero.</p>}
        {messages?.map((m) => {
          const mine = m.senderId === user?.id;
          const day = dayLabel(m.createdAt);
          const showDay = day !== lastDay;
          lastDay = day;
          return (
            <div key={m.id}>
              {showDay && <p className="py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-400">{day}</p>}
              <div className={`group flex items-end gap-1.5 ${mine ? "justify-end" : "justify-start"}`}>
                {mine && !m.deletedAt && (
                  <button onClick={() => removeMessage(m)} aria-label="Borrar mensaje" className="rounded-md p-1 text-slate-300 opacity-0 hover:text-rose-500 focus:opacity-100 group-hover:opacity-100">
                    <Trash2 size={12} />
                  </button>
                )}
                <div className={`max-w-[78%] rounded-2xl px-3 py-1.5 ${mine ? "rounded-br-md bg-blue-600 text-white" : "rounded-bl-md bg-white text-slate-700 shadow-sm"}`}>
                  {!mine && channel.kind !== "direct" && <p className="text-[10px] font-bold text-blue-600">{m.senderName || "Alguien"}</p>}
                  {m.deletedAt ? (
                    <p className={`text-xs italic ${mine ? "text-blue-100" : "text-slate-400"}`}>Mensaje borrado</p>
                  ) : (
                    <p className="whitespace-pre-wrap break-words text-xs leading-relaxed">{m.body}</p>
                  )}
                  <p className={`mt-0.5 text-right text-[9px] ${mine ? "text-blue-100" : "text-slate-400"}`}>{hourLabel(m.createdAt)}</p>
                </div>
                {!mine && isAdmin && !m.deletedAt && (
                  <button onClick={() => removeMessage(m)} aria-label="Borrar mensaje" title="Borrar (administrador)" className="rounded-md p-1 text-slate-300 opacity-0 hover:text-rose-500 focus:opacity-100 group-hover:opacity-100">
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-end gap-2 border-t border-slate-100 p-2.5">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={1}
          maxLength={4000}
          placeholder="Escribe un mensaje…"
          aria-label="Mensaje"
          className="max-h-32 min-h-[38px] flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-blue-400 focus:outline-none"
        />
        <button onClick={send} disabled={!draft.trim() || sending} aria-label="Enviar" className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">
          <Send size={15} />
        </button>
      </div>
      {editing && (
        <NewConversationModal
          group={editing}
          onOpen={() => {
            setEditing(null);
            inbox.reloadChannels();
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

// Vistas de Mensajes: "all", "group" (chats grupales), "direct" (privados) o
// "channel:<id>" (un chat en particular).
const MESSAGE_VIEWS = {
  all: { title: "Mensajes", hint: "Conversaciones entre las personas de tu empresa. Nadie de fuera puede leerlas.", filter: () => true },
  group: { title: "Chats grupales", hint: "El chat general de la empresa y los grupos en los que participas.", filter: (c) => c.kind === "general" || c.kind === "group" },
  direct: { title: "Chats privados", hint: "Conversaciones uno a uno. Solo las ven las dos personas.", filter: (c) => c.kind === "direct" },
};

export function MessagesPage({ isAdmin, compact = false, view = "all", onOpenChannel }) {
  const inbox = useInbox();
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(false);
  const pinnedId = typeof view === "string" && view.startsWith("channel:") ? Number(view.slice(8)) : null;
  const viewKey = pinnedId ? "group" : MESSAGE_VIEWS[view] ? view : "all";
  const meta = MESSAGE_VIEWS[viewKey];
  const allChannels = inbox?.channels ?? [];
  const channels = allChannels.filter(meta.filter);
  const open = allChannels.find((c) => c.id === openId) ?? null;

  // Un chat elegido desde el menú se abre directo.
  useEffect(() => {
    if (pinnedId) setOpenId(pinnedId);
  }, [pinnedId]);

  // Al cambiar de vista, la conversación abierta debe ser de esa vista.
  useEffect(() => {
    if (!pinnedId && open && !meta.filter(open)) setOpenId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey]);

  // En pantalla ancha siempre hay una conversación abierta.
  useEffect(() => {
    if (!compact && openId === null && channels.length > 0 && window.innerWidth >= 1024) setOpenId(channels[0].id);
  }, [compact, openId, channels]);

  const choose = (channel) => {
    setOpenId(channel.id);
    onOpenChannel?.(channel);
  };

  async function handleOpened(channelId) {
    setCreating(false);
    await inbox.reloadChannels();
    setOpenId(channelId);
  }

  if (inbox && !inbox.available) {
    return <p className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-xs text-slate-400">Los mensajes se activan al aplicar la actualización de la base de datos.</p>;
  }

  return (
    <div className={compact ? "flex h-[calc(100vh-7.5rem)] flex-col" : "space-y-4"}>
      {!compact && (
        <div>
          <h1 className="text-xl font-bold text-slate-900">{meta.title}</h1>
          <p className="mt-1 text-sm text-slate-500">{meta.hint}</p>
        </div>
      )}
      <div className={`grid min-h-0 flex-1 overflow-hidden border-slate-200 bg-white lg:grid-cols-[300px_minmax(0,1fr)] ${compact ? "" : "h-[calc(100vh-14rem)] min-h-[420px] rounded-2xl border shadow-sm"}`}>
        <div className={`min-h-0 flex-col border-slate-100 lg:flex lg:border-r ${open ? "hidden" : "flex"}`}>
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2.5">
            <p className="text-xs font-bold text-slate-700">{viewKey === "all" ? "Conversaciones" : meta.title}</p>
            <button onClick={() => setCreating(true)} className="flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-700">
              <Plus size={12} /> Nueva
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1.5">
            {channels.map((c) => (
              <button
                key={c.id}
                onClick={() => choose(c)}
                className={`flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition ${openId === c.id ? "bg-blue-50" : "hover:bg-slate-50"}`}
              >
                <ChannelAvatar channel={c} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className={`truncate text-xs ${c.unread ? "font-bold text-slate-900" : "font-semibold text-slate-700"}`}>{channelTitle(c)}</span>
                    {c.lastMessageAt && <span className="shrink-0 text-[10px] text-slate-400">{timeAgoLabel(c.lastMessageAt).replace("hace ", "")}</span>}
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-[11px] text-slate-400">
                      {c.lastMessage ? `${c.kind !== "direct" && c.lastSender ? `${c.lastSender.split(" ")[0]}: ` : ""}${c.lastMessage}` : "Sin mensajes"}
                    </span>
                    <CountBadge count={c.unread} className="shrink-0" />
                  </span>
                </span>
              </button>
            ))}
            {channels.length === 0 && (
              <p className="py-8 text-center text-xs text-slate-400">
                {allChannels.length === 0 ? "Cargando conversaciones…" : viewKey === "direct" ? "Todavía no tienes chats privados. Presiona \"Nueva\"." : "Sin conversaciones en esta vista."}
              </p>
            )}
          </div>
        </div>
        <div className={`min-h-0 lg:block ${open ? "block" : "hidden"}`}>
          {open ? (
            <Conversation
              key={open.id}
              channel={open}
              isAdmin={isAdmin}
              onBack={() => setOpenId(null)}
              onChanged={(id) => {
                setOpenId(id);
                inbox.reloadChannels();
              }}
            />
          ) : (
            <div className="hidden h-full items-center justify-center text-xs text-slate-400 lg:flex">Elige una conversación.</div>
          )}
        </div>
      </div>
      {creating && <NewConversationModal initialMode={viewKey === "group" ? "group" : "direct"} onOpen={handleOpened} onClose={() => setCreating(false)} />}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Tareas                                                                */
/* ---------------------------------------------------------------------- */

const TASK_STATUS = {
  open: { label: "Por hacer", className: "bg-slate-100 text-slate-600" },
  in_progress: { label: "En proceso", className: "bg-blue-50 text-blue-700" },
  done: { label: "Terminada", className: "bg-emerald-50 text-emerald-700" },
  cancelled: { label: "Cancelada", className: "bg-rose-50 text-rose-600" },
};
const TASK_PRIORITY = { high: { label: "Alta", className: "text-rose-600" }, normal: { label: "Normal", className: "text-slate-400" }, low: { label: "Baja", className: "text-slate-400" } };

function TaskFormModal({ initial, isAdmin, onClose }) {
  const { user } = useAuth();
  const { people } = usePeople();
  const { showToast } = useToast();
  const inbox = useInbox();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [assignedTo, setAssignedTo] = useState(initial?.assignedTo ?? user?.id ?? "");
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? "");
  const [priority, setPriority] = useState(initial?.priority ?? "normal");
  const [relatedLabel, setRelatedLabel] = useState(initial?.relatedLabel ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inputClass = "w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-blue-400 focus:outline-none";
  const labelClass = "mb-1 block text-[11px] font-semibold text-slate-500";

  async function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Escribe qué hay que hacer.");
      return;
    }
    setSaving(true);
    setError("");
    const row = { title: title.trim(), description: description.trim() || null, assignedTo: assignedTo || null, dueDate: dueDate || null, priority, relatedLabel: relatedLabel.trim() || null };
    const { error: saveError } = initial?.id ? await supabase.from("tasks").update(row).eq("id", initial.id) : await supabase.from("tasks").insert(row);
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    inbox.reloadTasks();
    showToast(initial?.id ? "Tarea actualizada." : "Tarea creada.");
    onClose();
  }

  return (
    <Modal title={initial?.id ? "Editar tarea" : "Nueva tarea"} width="max-w-md" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className={labelClass}>Qué hay que hacer</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Ej. Revisar las facturas de Tren Maya" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Detalles (opcional)</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={inputClass} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Responsable</label>
            <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} disabled={!isAdmin} className={`${inputClass} disabled:bg-slate-50 disabled:text-slate-400`}>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {personName(p)}
                  {p.id === user?.id ? " (yo)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Fecha límite (opcional)</label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Prioridad</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value)} className={inputClass}>
              <option value="high">Alta</option>
              <option value="normal">Normal</option>
              <option value="low">Baja</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Relacionada con (opcional)</label>
            <input value={relatedLabel} onChange={(e) => setRelatedLabel(e.target.value)} placeholder="Ej. Unidad 07, OT24053" className={inputClass} />
          </div>
        </div>
        {!isAdmin && <p className="text-[11px] text-slate-400">Solo un administrador puede asignar tareas a otras personas.</p>}
        {error && <p className="rounded-lg bg-rose-50 px-2.5 py-2 text-[11px] font-medium text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">
            Cancelar
          </button>
          <button type="submit" disabled={saving} className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
            {saving ? "Guardando…" : initial?.id ? "Guardar cambios" : "Crear tarea"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// La conversación de una tarea: mensajes de las dos personas y los cambios
// de estado, en orden. Al terminar la tarea queda como historial.
function TaskChat({ task }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [items, setItems] = useState(null);
  const [missing, setMissing] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);
  const closed = task.status === "done" || task.status === "cancelled";
  const taskId = task.id;

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("task_comments").select("*").eq("taskId", taskId).order("id", { ascending: true }).limit(500);
    if (error) {
      setMissing(true);
      setItems([]);
    } else setItems(data ?? []);
  }, [taskId]);

  useEffect(() => {
    setItems(null);
    setDraft("");
    load();
    const channel = supabase
      .channel(`task-chat-${taskId}-${++inboxChannelSeq}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "task_comments", filter: `taskId=eq.${taskId}` }, (payload) => {
        const row = payload.new;
        setItems((prev) => (prev && !prev.some((m) => m.id === row.id) ? [...prev, row] : prev));
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [taskId, load]);

  // Los cambios de estado los escribe la base: se vuelve a leer al cambiar.
  useEffect(() => {
    load();
  }, [task.status, load]);

  useEffect(() => {
    const box = scrollRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [items]);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    const { data, error } = await supabase.from("task_comments").insert({ taskId, body }).select().single();
    setSending(false);
    if (error) {
      showToast(`No se pudo enviar: ${error.message}`);
      return;
    }
    setDraft("");
    setItems((prev) => (prev && !prev.some((m) => m.id === data.id) ? [...prev, data] : prev));
  }

  if (missing) {
    return <p className="rounded-xl bg-slate-50 px-3 py-6 text-center text-xs text-slate-400">La conversación de las tareas se activa al aplicar la actualización de la base de datos.</p>;
  }

  let lastDay = null;
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200">
      <div ref={scrollRef} className="min-h-[220px] flex-1 space-y-1 overflow-y-auto bg-slate-50/60 px-3 py-3">
        {items === null && <p className="py-6 text-center text-xs text-slate-400">Cargando conversación…</p>}
        {items?.length === 0 && <p className="py-6 text-center text-xs text-slate-400">Aún no hay mensajes. Escribe para dar seguimiento.</p>}
        {items?.map((m) => {
          const day = dayLabel(m.createdAt);
          const showDay = day !== lastDay;
          lastDay = day;
          if (m.kind === "event") {
            return (
              <div key={m.id}>
                {showDay && <p className="py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-400">{day}</p>}
                <p className="mx-auto w-fit max-w-[90%] rounded-full bg-white px-3 py-1 text-center text-[11px] text-slate-500 shadow-sm">
                  {m.body} <span className="text-slate-400">· {hourLabel(m.createdAt)}</span>
                </p>
              </div>
            );
          }
          const mine = m.authorId === user?.id;
          return (
            <div key={m.id}>
              {showDay && <p className="py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-400">{day}</p>}
              <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[82%] rounded-2xl px-3 py-1.5 ${mine ? "rounded-br-md bg-blue-600 text-white" : "rounded-bl-md bg-white text-slate-700 shadow-sm"}`}>
                  {!mine && <p className="text-[10px] font-bold text-blue-600">{m.authorName || "Alguien"}</p>}
                  <p className="whitespace-pre-wrap break-words text-xs leading-relaxed">{m.body}</p>
                  <p className={`mt-0.5 text-right text-[9px] ${mine ? "text-blue-100" : "text-slate-400"}`}>{hourLabel(m.createdAt)}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {closed ? (
        <p className="flex items-center justify-center gap-1.5 border-t border-slate-100 bg-white px-3 py-2.5 text-[11px] text-slate-400">
          <Lock size={12} /> La conversación se cerró al {task.status === "done" ? "terminar" : "cancelar"} la tarea. Reábrela para escribir.
        </p>
      ) : (
        <div className="flex items-end gap-2 border-t border-slate-100 bg-white p-2.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            maxLength={2000}
            placeholder="Escribe un avance o una pregunta…"
            aria-label="Mensaje de la tarea"
            className="max-h-32 min-h-[38px] flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-blue-400 focus:outline-none"
          />
          <button onClick={send} disabled={!draft.trim() || sending} aria-label="Enviar" className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">
            <Send size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

function useWide(query = "(min-width: 1024px)") {
  const get = () => typeof window !== "undefined" && !!window.matchMedia?.(query).matches;
  const [wide, setWide] = useState(get);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return undefined;
    const update = () => setWide(media.matches);
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, [query]);
  return wide;
}

// Detalle de una tarea con sus acciones y su conversación.
function TaskDetail({ task, isAdmin, onEdit, onSetStatus, onClose }) {
  const { user } = useAuth();
  const { format } = useDateFormat();
  const mine = task.assignedTo === user?.id;
  const canEdit = isAdmin || task.createdBy === user?.id;
  const status = TASK_STATUS[task.status] ?? TASK_STATUS.open;
  const isOpen = task.status === "open" || task.status === "in_progress";
  const canMove = mine || canEdit;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-bold text-slate-800">{task.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-slate-400">
            <span className={`rounded-full px-2 py-0.5 font-semibold ${status.className}`}>{status.label}</span>
            <span className="flex items-center gap-1">
              <User size={11} /> {mine ? "Yo" : task.assignedToName || "Sin asignar"}
            </span>
            {task.createdByName && task.createdBy !== task.assignedTo && <span>Asignó {task.createdByName}</span>}
            {task.dueDate && <span>Para el {formatDate(task.dueDate, format)}</span>}
            {task.completedAt && <span>Terminada el {formatDate(task.completedAt.slice(0, 10), format)}</span>}
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} aria-label="Cerrar detalle" className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 lg:flex">
            <X size={15} />
          </button>
        )}
      </div>
      {task.description && <p className="whitespace-pre-wrap break-words rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">{task.description}</p>}
      {task.relatedLabel && <p className="text-[11px] text-slate-500">Relacionada con: <b>{task.relatedLabel}</b></p>}
      {canMove && (
        <div className="flex flex-wrap gap-1.5">
          {task.status === "open" && mine && (
            <button onClick={() => onSetStatus(task, "in_progress")} className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100">
              Empezar
            </button>
          )}
          {isOpen && (
            <button onClick={() => onSetStatus(task, "done")} className="flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100">
              <CheckCircle2 size={12} /> Marcar como resuelta
            </button>
          )}
          {!isOpen && (
            <button onClick={() => onSetStatus(task, "open")} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
              Reabrir
            </button>
          )}
          {canEdit && isOpen && (
            <button onClick={() => onEdit(task)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
              Editar
            </button>
          )}
          {canEdit && isOpen && (
            <button onClick={() => onSetStatus(task, "cancelled")} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-500 hover:bg-slate-50">
              Cancelar tarea
            </button>
          )}
        </div>
      )}
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
        <MessageSquare size={12} /> {isOpen ? "Seguimiento" : "Historial hasta su resolución"}
      </p>
      <TaskChat task={task} />
    </div>
  );
}

// Vistas: "open" (tareas asignadas sin completar) y "done" (resueltas).
export function TasksPage({ isAdmin, compact = false, view = "open", focusId = null }) {
  const { user } = useAuth();
  const { format } = useDateFormat();
  const { showToast } = useToast();
  const inbox = useInbox();
  const wide = useWide();
  const [scope, setScope] = useState("mine");
  const [form, setForm] = useState(null);
  const [selectedId, setSelectedId] = useState(focusId);
  const tasks = inbox?.tasks ?? [];
  const today = localISODate();
  const resolved = view === "done";

  useEffect(() => {
    if (focusId) setSelectedId(focusId);
  }, [focusId]);

  const scopes = [
    { id: "mine", label: "Mis tareas", filter: (t) => t.assignedTo === user?.id },
    { id: "given", label: "Las que asigné", filter: (t) => t.createdBy === user?.id && t.assignedTo !== user?.id },
    ...(isAdmin ? [{ id: "all", label: "Todas", filter: () => true }] : []),
  ];
  const current = scopes.find((s) => s.id === scope) ?? scopes[0];
  const isOpen = (t) => t.status === "open" || t.status === "in_progress";
  const inView = (t) => (resolved ? !isOpen(t) : isOpen(t));
  const listed = tasks
    .filter(current.filter)
    .filter(inView)
    .sort((a, b) =>
      resolved
        ? String(b.completedAt ?? b.updatedAt ?? "").localeCompare(String(a.completedAt ?? a.updatedAt ?? "")) || b.id - a.id
        : String(a.dueDate ?? "9999").localeCompare(String(b.dueDate ?? "9999")) || b.id - a.id
    );
  const selected = tasks.find((t) => t.id === selectedId) ?? null;

  // En pantalla ancha, la primera tarea de la lista se abre sola.
  useEffect(() => {
    if (wide && !compact && (!selected || !inView(selected)) && listed.length > 0 && !focusId) setSelectedId(listed[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wide, compact, view, scope, listed.length]);

  async function setStatus(task, status) {
    const { error } = await supabase.from("tasks").update({ status }).eq("id", task.id);
    if (error) showToast(`No se pudo actualizar: ${error.message}`);
    else {
      inbox.reloadTasks();
      if (status === "done") showToast("Tarea resuelta. Su conversación queda en \"Tareas resueltas\".");
    }
  }

  async function remove(task) {
    const { error } = await supabase.from("tasks").delete().eq("id", task.id);
    if (error) showToast(`No se pudo eliminar: ${error.message}`);
    else {
      if (selectedId === task.id) setSelectedId(null);
      inbox.reloadTasks();
    }
  }

  if (inbox && !inbox.available) {
    return <p className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-xs text-slate-400">Las tareas se activan al aplicar la actualización de la base de datos.</p>;
  }

  const list = (
    <div className="space-y-2">
      {listed.map((t) => {
        const overdue = isOpen(t) && t.dueDate && t.dueDate < today;
        const mine = t.assignedTo === user?.id;
        const canEdit = isAdmin || t.createdBy === user?.id;
        const status = TASK_STATUS[t.status] ?? TASK_STATUS.open;
        const active = selected?.id === t.id && (wide && !compact);
        return (
          <div
            key={t.id}
            className={`flex items-start gap-3 rounded-2xl border bg-white p-3.5 shadow-sm transition ${active ? "border-blue-300 ring-2 ring-blue-100" : overdue ? "border-rose-200" : "border-slate-200"}`}
          >
            <button
              onClick={() => setStatus(t, t.status === "done" ? "open" : "done")}
              disabled={!mine && !canEdit}
              aria-label={t.status === "done" ? "Reabrir tarea" : "Marcar como resuelta"}
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition disabled:opacity-40 ${
                t.status === "done" ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 text-transparent hover:border-emerald-400"
              }`}
            >
              <CheckCircle2 size={12} />
            </button>
            <button onClick={() => setSelectedId(t.id)} className="min-w-0 flex-1 text-left">
              <p className={`break-words text-sm font-semibold ${t.status === "cancelled" ? "text-slate-400 line-through" : resolved ? "text-slate-600" : "text-slate-800"}`}>{t.title}</p>
              {t.description && <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap break-words text-xs text-slate-500">{t.description}</p>}
              <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
                <span className={`rounded-full px-2 py-0.5 font-semibold ${status.className}`}>{status.label}</span>
                <span className="flex items-center gap-1">
                  <User size={11} /> {mine ? "Yo" : t.assignedToName || "Sin asignar"}
                </span>
                {t.dueDate && !resolved && (
                  <span className={`flex items-center gap-1 ${overdue ? "font-semibold text-rose-600" : ""}`}>
                    {overdue && <AlertTriangle size={11} />}
                    {overdue ? "Venció el" : "Para el"} {formatDate(t.dueDate, format)}
                  </span>
                )}
                {resolved && t.completedAt && <span>Resuelta el {formatDate(t.completedAt.slice(0, 10), format)}</span>}
                {t.priority === "high" && !resolved && <span className={`font-semibold ${TASK_PRIORITY.high.className}`}>Prioridad alta</span>}
                {t.relatedLabel && <span>· {t.relatedLabel}</span>}
                <span className="flex items-center gap-1 font-semibold text-blue-600">
                  <MessageSquare size={11} /> {resolved ? "Ver historial" : "Conversación"}
                </span>
              </span>
            </button>
            {canEdit && (
              <button onClick={() => remove(t)} aria-label="Eliminar tarea" className="shrink-0 rounded-lg border border-slate-200 p-1.5 text-slate-400 hover:bg-slate-50 hover:text-rose-500">
                <Trash2 size={12} />
              </button>
            )}
          </div>
        );
      })}
      {listed.length === 0 && (
        <p className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-white py-10 text-center text-xs text-slate-400">
          <CheckCheck size={20} className="text-emerald-400" />
          {resolved ? "Todavía no hay tareas resueltas en esta vista." : current.id === "mine" ? "No tienes tareas pendientes." : "Sin tareas pendientes en esta vista."}
        </p>
      )}
    </div>
  );

  const sidePanel = wide && !compact;
  return (
    <div className={compact ? "space-y-4 p-4 pb-24" : "space-y-5"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{resolved ? "Tareas resueltas" : "Tareas asignadas"}</h1>
          {!compact && (
            <p className="mt-1 text-sm text-slate-500">
              {resolved ? "Lo que ya se terminó, con su conversación completa hasta que se resolvió." : "Lo que falta por hacer. Cada tarea tiene su propia conversación para dar seguimiento."}
            </p>
          )}
        </div>
        {!resolved && (
          <button onClick={() => setForm({})} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700">
            <Plus size={15} /> Nueva tarea
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {scopes.map((s) => {
          const count = tasks.filter(s.filter).filter(inView).length;
          return (
            <button
              key={s.id}
              onClick={() => setScope(s.id)}
              className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
                current.id === s.id ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
              }`}
            >
              {s.label} <b className={current.id === s.id ? "text-blue-100" : "text-slate-400"}>{count}</b>
            </button>
          );
        })}
      </div>

      {sidePanel ? (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(360px,420px)] items-start gap-4">
          {list}
          <div className="sticky top-20 flex h-[calc(100vh-7rem)] min-h-[420px] flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            {selected ? (
              <TaskDetail task={selected} isAdmin={isAdmin} onEdit={setForm} onSetStatus={setStatus} onClose={() => setSelectedId(null)} />
            ) : (
              <p className="m-auto text-center text-xs text-slate-400">Elige una tarea para ver su conversación.</p>
            )}
          </div>
        </div>
      ) : (
        list
      )}

      {!sidePanel && selected && (
        <Modal title="Tarea" width="max-w-lg" onClose={() => setSelectedId(null)}>
          <div className="flex h-[70vh] min-h-0 flex-col">
            <TaskDetail task={selected} isAdmin={isAdmin} onEdit={setForm} onSetStatus={setStatus} />
          </div>
        </Modal>
      )}
      {form && <TaskFormModal initial={form} isAdmin={isAdmin} onClose={() => setForm(null)} />}
    </div>
  );
}
