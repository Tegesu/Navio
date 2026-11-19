import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  BellOff,
  LogOut,
  MoreHorizontal,
  MoreVertical,
  Pin,
  PinOff,
  Search,
  ShieldCheck,
  CheckCheck,
  ChevronDown,
  Download,
  FileText,
  Paperclip,
  Upload,
  CheckCircle2,
  ClipboardList,
  Lock,
  Megaphone,
  MessageSquare,
  Navigation,
  Phone,
  Plus,
  Receipt,
  Send,
  Trash2,
  User,
  Users,
  Video,
  X,
} from "lucide-react";
import { supabase, useAuth, useToast, useDateFormat, formatDate, Modal, avatarUrl, timeAgoLabel, localISODate } from "./NavioDashboard.jsx";
import { usePeople, personName } from "./people.jsx";
import { useBackLayer, goBack } from "./history.js";
import { ChatConversation, previewText } from "./chat.jsx";
import { PushInvite } from "./push.jsx";
import { useCalls } from "./calls.jsx";

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

// Aviso arriba de la pantalla: "Fulano: mensaje". Tocarlo abre la conversación.
function MessageBanner({ banner, onClose }) {
  const open = () => {
    onClose();
    window.postMessage({ type: "navio:open", url: `/?open=messages&sub=channel:${banner.channelId}` }, window.location.origin);
  };
  return (
    <div role="status" className="fixed left-1/2 top-[max(env(safe-area-inset-top),0.5rem)] z-[60] w-[min(92vw,380px)] -translate-x-1/2">
      <div className="flex items-center gap-2.5 rounded-2xl border border-slate-200 bg-white p-2.5 shadow-xl">
        <button type="button" onClick={open} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          <img src={avatarUrl(banner.name)} alt="" className="h-9 w-9 shrink-0 rounded-full" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-bold text-slate-800">
              {banner.name}
              <span className="font-normal text-slate-400">{banner.where}</span>
            </span>
            <span className="block truncate text-[11px] text-slate-500">{banner.text}</span>
          </span>
        </button>
        <button type="button" onClick={onClose} aria-label="Cerrar aviso" className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-100">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

export function InboxProvider({ children }) {
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const [notifications, setNotifications] = useState([]);
  const [channels, setChannels] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [available, setAvailable] = useState(true); // false si falta la migración v17
  const messageListeners = useRef(new Set());
  const overviewTimer = useRef(null);
  // Aviso dentro de Navio cuando llega un mensaje de otra conversación.
  const [banner, setBanner] = useState(null);
  const bannerTimer = useRef(null);
  const openChannelRef = useRef(null);
  const channelsRef = useRef([]);
  channelsRef.current = channels;
  const userId = user?.id ?? null;
  const companyId = profile?.companyId ?? null;
  // Sube cuando hay que volver a conectar el tiempo real (al regresar a Navio).
  const [epoch, setEpoch] = useState(0);

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
    // "Recibido": este equipo ya trajo los mensajes (para las palomitas).
    let deliveredTimer = null;
    const markDelivered = () => {
      window.clearTimeout(deliveredTimer);
      deliveredTimer = window.setTimeout(() => supabase.rpc("mark_channels_delivered").then(() => {}, () => {}), 800);
    };
    markDelivered();

    const refreshOverview = () => {
      window.clearTimeout(overviewTimer.current);
      overviewTimer.current = window.setTimeout(loadChannels, 400);
    };
    let retryTimer = null;
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
        if (payload.eventType === "INSERT" && payload.new?.senderId !== userId) {
          markDelivered();
          const m = payload.new;
          const ch = channelsRef.current.find((c) => Number(c.id) === Number(m?.channelId));
          if (m && m.senderId && m.kind !== "call" && Number(m.channelId) !== Number(openChannelRef.current) && !ch?.muted && document.visibilityState === "visible") {
            const where = ch?.kind === "general" ? " · General" : ch?.kind === "group" ? ` · ${ch.name || "Grupo"}` : "";
            setBanner({ id: m.id, channelId: m.channelId, name: m.senderName || "Mensaje nuevo", where, text: previewText(m.kind, m.body) || "Mensaje" });
            window.clearTimeout(bannerTimer.current);
            bannerTimer.current = window.setTimeout(() => setBanner(null), 5000);
          }
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_reactions" }, (payload) => {
        messageListeners.current.forEach((listener) => listener(payload));
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_members" }, (payload) => {
        messageListeners.current.forEach((listener) => listener(payload));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, loadTasks)
      .subscribe((status) => {
        // Si la conexión en tiempo real falla, se vuelve a abrir en unos segundos.
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          window.clearTimeout(retryTimer);
          retryTimer = window.setTimeout(() => setEpoch((n) => n + 1), 4000);
        }
      });
    // Por si el tiempo real se atrasa: la lista se revisa cada 30 s.
    const overviewPoll = window.setInterval(() => document.visibilityState === "visible" && loadChannels(), 30000);
    // El teléfono pausa las páginas en segundo plano y la conexión en tiempo
    // real se pierde: al volver se traen avisos, conversaciones y tareas, y si
    // la conexión se cayó se abre otra.
    const resume = () => {
      if (document.visibilityState !== "visible") return;
      loadNotifications();
      loadChannels();
      loadTasks();
      markDelivered();
      if (channel.state !== "joined" && channel.state !== "joining") setEpoch((n) => n + 1);
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    window.addEventListener("focus", resume);
    return () => {
      window.clearTimeout(overviewTimer.current);
      window.clearTimeout(retryTimer);
      window.clearInterval(overviewPoll);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("focus", resume);
      supabase.removeChannel(channel);
    };
    // showToast cambia en cada render de la app; no debe reiniciar la suscripción.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, companyId, loadNotifications, loadChannels, loadTasks, epoch]);

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

  // La conversación abierta en pantalla (de esa no se muestra el aviso).
  const setOpenChannel = useCallback((id) => {
    openChannelRef.current = id;
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
      setOpenChannel,
      tasks,
      myOpenTasks: openTasks.length,
      reloadTasks: loadTasks,
    };
  }, [available, notifications, channels, tasks, userId, markRead, removeNotification, loadChannels, markChannelRead, subscribeMessages, setOpenChannel, loadTasks]);

  return (
    <InboxContext.Provider value={value}>
      {children}
      {banner && <MessageBanner banner={banner} onClose={() => setBanner(null)} />}
    </InboxContext.Provider>
  );
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
      onNavigate(notification.link.tab, notification.link.sub);
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

// La conversación vive en chat.jsx; aquí va su encabezado (llamar,
// participantes, permisos, fijar, silenciar, salir del grupo).
function Conversation({ channel, isAdmin, onBack, onChanged, jumpTo }) {
  const { user } = useAuth();
  const inbox = useInbox();
  const calls = useCalls();
  const { showToast } = useToast();
  const [editing, setEditing] = useState(null);
  const [permissions, setPermissions] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const channelId = channel.id;

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
  const canCall = calls.available && (channel.kind === "direct" ? !!channel.otherUserId : channel.kind === "group");
  const canSetPermissions = channel.kind !== "direct" && (channel.isChannelAdmin || isAdmin);
  const menu = [
    canManage && { label: "Participantes", icon: Users, run: editGroup },
    canSetPermissions && { label: "Quién puede escribir", icon: ShieldCheck, run: () => setPermissions(true) },
    { label: channel.pinnedAt ? "Dejar de fijar" : "Fijar conversación", icon: channel.pinnedAt ? PinOff : Pin, run: () => channelAction(inbox, showToast, "pin", channel) },
    { label: channel.muted ? "Activar avisos" : "Silenciar avisos", icon: channel.muted ? Bell : BellOff, run: () => channelAction(inbox, showToast, "mute", channel) },
    channel.kind === "group" && channel.createdBy !== user?.id && { label: "Salir del grupo", icon: LogOut, run: leave, danger: true },
  ].filter(Boolean);

  const header = (
    <div className="flex items-center gap-1.5">
      <ChannelAvatar channel={channel} />
      <div className="ml-1 min-w-0 flex-1">
        <p className="flex items-center gap-1 truncate text-sm font-bold text-slate-800">
          {channelTitle(channel)}
          {channel.muted && <BellOff size={12} className="shrink-0 text-slate-400" />}
        </p>
        <p className="truncate text-[11px] text-slate-400">
          {channel.kind === "general" ? `Toda la empresa · ${channel.members} personas` : channel.kind === "group" ? `${channel.members} participantes` : "Conversación directa"}
          {channel.postingMode && channel.postingMode !== "all" && channel.kind !== "direct" ? " · escriben solo algunos" : ""}
        </p>
      </div>
      {canCall && (
        <>
          <button type="button" onClick={() => calls.start(channel, "audio")} aria-label="Llamada de voz" title="Llamada de voz" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-blue-600 hover:bg-blue-50">
            <Phone size={17} />
          </button>
          <button type="button" onClick={() => calls.start(channel, "video")} aria-label="Videollamada" title="Videollamada" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-blue-600 hover:bg-blue-50">
            <Video size={18} />
          </button>
        </>
      )}
      <div className="relative shrink-0">
        <button type="button" onClick={() => setMenuOpen((v) => !v)} aria-label="Más opciones del chat" aria-expanded={menuOpen} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100">
          <MoreVertical size={17} />
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 top-10 z-50 w-56 rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
              {menu.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    item.run();
                  }}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium hover:bg-slate-50 ${item.danger ? "text-rose-600" : "text-slate-700"}`}
                >
                  <item.icon size={14} className="shrink-0" /> {item.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );

  return (
    <>
      <ChatConversation channel={channel} isAdmin={isAdmin} onBack={onBack} header={header} jumpTo={jumpTo} />
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
      {permissions && <ChannelPermissionsModal channel={channel} onClose={() => setPermissions(false)} onSaved={() => inbox.reloadChannels()} />}
    </>
  );
}

// Fijar, silenciar y marcar como leída una conversación.
async function channelAction(inbox, showToast, action, channel) {
  let result;
  if (action === "pin") result = await supabase.rpc("pin_channel", { target_channel: channel.id, pin: !channel.pinnedAt });
  else if (action === "mute") result = await supabase.rpc("mute_channel", { target_channel: channel.id, mute: !channel.muted });
  else if (action === "read") {
    await inbox.markChannelRead(channel.id);
    return;
  }
  if (result?.error) {
    showToast(/function|schema cache/i.test(result.error.message) ? "Esta opción se activa con la actualización v28 de la base de datos." : result.error.message);
    return;
  }
  showToast(
    action === "pin" ? (channel.pinnedAt ? "Ya no está fijada." : "Conversación fijada arriba.") : channel.muted ? "Avisos activados." : "No te llegarán avisos de esta conversación."
  );
  inbox.reloadChannels();
}

// Quién puede escribir en el chat general o en un grupo.
function ChannelPermissionsModal({ channel, onClose, onSaved }) {
  const { showToast } = useToast();
  const [people, setPeople] = useState(null);
  const [mode, setMode] = useState(channel.postingMode || "all");
  const [posters, setPosters] = useState([]);
  const [admins, setAdmins] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.rpc("channel_people", { target_channel: channel.id }).then(({ data, error }) => {
      if (error) {
        showToast(/function|schema cache/i.test(error.message) ? "Los permisos se activan con la actualización v28 de la base de datos." : error.message);
        onClose();
        return;
      }
      setPeople(data ?? []);
      setPosters((data ?? []).filter((p) => p.canPost).map((p) => p.userId));
      setAdmins((data ?? []).filter((p) => p.isAdmin && !(channel.kind === "group" && channel.createdBy === p.userId)).map((p) => p.userId));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id]);

  const toggle = (list, setList, id) => setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  async function save() {
    setBusy(true);
    const { error } = await supabase.rpc("set_channel_posting", { target_channel: channel.id, mode, poster_ids: mode === "selected" ? posters : [], admin_ids: admins });
    setBusy(false);
    if (error) {
      showToast(error.message);
      return;
    }
    showToast("Permisos guardados.");
    onSaved?.();
    onClose();
  }

  const options = [
    ["all", "Todos", "Cualquiera en el chat puede escribir."],
    ["admins", "Solo administradores", channel.kind === "general" ? "Los administradores de la empresa y quienes nombres aquí." : "Quien creó el grupo y quienes nombres administradores."],
    ["selected", "Personas elegidas", "Los administradores y las personas que marques."],
  ];

  return (
    <Modal title="Quién puede escribir" width="max-w-md" onClose={onClose}>
      <div className="space-y-3">
        <div className="space-y-1.5">
          {options.map(([id, label, hint]) => (
            <label key={id} className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2 ${mode === id ? "border-blue-300 bg-blue-50" : "border-slate-200"}`}>
              <input type="radio" name="posting" checked={mode === id} onChange={() => setMode(id)} className="mt-0.5 accent-blue-600" />
              <span>
                <span className="block text-xs font-semibold text-slate-700">{label}</span>
                <span className="block text-[11px] text-slate-500">{hint}</span>
              </span>
            </label>
          ))}
        </div>
        <div>
          <p className="mb-1 text-[11px] font-semibold text-slate-500">Personas</p>
          <div className="max-h-60 space-y-0.5 overflow-y-auto rounded-xl border border-slate-100 p-1">
            {people === null && <p className="py-4 text-center text-xs text-slate-400">Cargando…</p>}
            {(people ?? []).map((p) => {
              const owner = channel.kind === "group" && channel.createdBy === p.userId;
              const fixedAdmin = owner || p.companyAdmin;
              return (
                <div key={p.userId} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                  <img src={avatarUrl(p.fullName)} alt="" className="h-7 w-7 shrink-0 rounded-full" />
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-700">
                    {p.fullName}
                    {fixedAdmin && <span className="ml-1 text-[10px] text-slate-400">{owner ? "· creó el grupo" : "· administrador"}</span>}
                  </span>
                  {mode === "selected" && !fixedAdmin && (
                    <label className="flex items-center gap-1 text-[10px] text-slate-500">
                      <input type="checkbox" checked={posters.includes(p.userId) || admins.includes(p.userId)} disabled={admins.includes(p.userId)} onChange={() => toggle(posters, setPosters, p.userId)} className="accent-blue-600" />
                      Escribe
                    </label>
                  )}
                  {!fixedAdmin && (
                    <label className="flex items-center gap-1 text-[10px] text-slate-500">
                      <input type="checkbox" checked={admins.includes(p.userId)} onChange={() => toggle(admins, setAdmins, p.userId)} className="accent-blue-600" />
                      Admin.
                    </label>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">
            Cancelar
          </button>
          <button type="button" onClick={save} disabled={busy || people === null} className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
            {busy ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// Un renglón de la lista: tocarlo abre el chat; los tres puntos (o mantener
// presionado en el teléfono) dan las opciones.
function ChannelRow({ channel: c, active, onOpen }) {
  const inbox = useInbox();
  const { showToast } = useToast();
  const [menu, setMenu] = useState(false);
  const timer = useRef(null);
  const press = {
    onPointerDown: (e) => {
      if (e.pointerType === "mouse") return;
      timer.current = window.setTimeout(() => setMenu(true), 500);
    },
    onPointerUp: () => window.clearTimeout(timer.current),
    onPointerLeave: () => window.clearTimeout(timer.current),
    onPointerMove: () => window.clearTimeout(timer.current),
    onContextMenu: (e) => {
      e.preventDefault();
      setMenu(true);
    },
  };
  const items = [
    { label: c.pinnedAt ? "Dejar de fijar" : "Fijar", icon: c.pinnedAt ? PinOff : Pin, run: () => channelAction(inbox, showToast, "pin", c) },
    { label: c.muted ? "Activar avisos" : "Silenciar avisos", icon: c.muted ? Bell : BellOff, run: () => channelAction(inbox, showToast, "mute", c) },
    c.unread > 0 && { label: "Marcar como leída", icon: CheckCheck, run: () => channelAction(inbox, showToast, "read", c) },
  ].filter(Boolean);
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={() => onOpen(c)}
        {...press}
        className={`flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition ${active ? "bg-blue-50" : "hover:bg-slate-50"}`}
      >
        <ChannelAvatar channel={c} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className={`flex min-w-0 items-center gap-1 truncate text-xs ${c.unread ? "font-bold text-slate-900" : "font-semibold text-slate-700"}`}>
              <span className="truncate">{channelTitle(c)}</span>
              {c.pinnedAt && <Pin size={10} className="shrink-0 text-slate-400" />}
              {c.muted && <BellOff size={10} className="shrink-0 text-slate-400" />}
            </span>
            {c.lastMessageAt && <span className="shrink-0 text-[10px] text-slate-400 group-hover:invisible">{timeAgoLabel(c.lastMessageAt).replace("hace ", "")}</span>}
          </span>
          <span className="flex items-center justify-between gap-2">
            <span className="truncate text-[11px] text-slate-400">
              {c.lastMessage || (c.lastKind && c.lastKind !== "text") ? `${c.kind !== "direct" && c.lastSender ? `${c.lastSender.split(" ")[0]}: ` : ""}${previewText(c.lastKind, c.lastMessage) ?? ""}` : "Sin mensajes"}
            </span>
            <CountBadge count={c.unread} className="shrink-0" />
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => setMenu((v) => !v)}
        aria-label={`Opciones de ${channelTitle(c)}`}
        className="absolute right-2 top-1.5 hidden h-6 w-6 items-center justify-center rounded-md bg-white text-slate-500 shadow-sm hover:bg-slate-100 group-hover:flex"
      >
        <MoreHorizontal size={14} />
      </button>
      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(false)} />
          <div className="absolute right-2 top-8 z-50 w-48 rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => {
                  setMenu(false);
                  item.run();
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <item.icon size={14} className="shrink-0" /> {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Resalta la palabra buscada dentro de un texto.
function Highlight({ text, term }) {
  const value = String(text ?? "");
  if (!term) return value;
  const index = value.toLowerCase().indexOf(term.toLowerCase());
  if (index < 0) return value;
  const start = Math.max(0, index - 30);
  return (
    <>
      {start > 0 ? "…" : ""}
      {value.slice(start, index)}
      <mark className="rounded bg-amber-200 px-0.5 text-slate-900">{value.slice(index, index + term.length)}</mark>
      {value.slice(index + term.length)}
    </>
  );
}

// Mensajes: todas las conversaciones juntas (general, grupos y directas).
// view "channel:<id>" abre una en particular.
export function MessagesPage({ isAdmin, compact = false, view = "all" }) {
  const inbox = useInbox();
  const [openId, setOpenId] = useState(null);
  const [jump, setJump] = useState(null); // { channelId, messageId }
  const [creating, setCreating] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState([]);
  const pinnedId = typeof view === "string" && view.startsWith("channel:") ? Number(view.slice(8)) : null;
  const channels = inbox?.channels ?? [];
  const open = channels.find((c) => c.id === openId) ?? null;
  const term = query.trim();
  const shown = term ? channels.filter((c) => channelTitle(c).toLowerCase().includes(term.toLowerCase())) : channels;

  // Un chat elegido desde un aviso se abre directo.
  useEffect(() => {
    if (pinnedId) setOpenId(pinnedId);
  }, [pinnedId]);

  // En pantalla ancha siempre hay una conversación abierta.
  useEffect(() => {
    if (!compact && openId === null && channels.length > 0 && window.innerWidth >= 1024) setOpenId(channels[0].id);
  }, [compact, openId, channels]);

  // Buscar palabras en todos los chats (los que la persona puede ver).
  useEffect(() => {
    if (term.length < 3) {
      setFound([]);
      return undefined;
    }
    let alive = true;
    const timer = window.setTimeout(async () => {
      const { data } = await supabase
        .from("chat_messages")
        .select("id, channelId, body, senderName, createdAt, kind")
        .ilike("body", `%${term.replace(/[%_\\]/g, (m) => `\\${m}`)}%`)
        .is("deletedAt", null)
        .neq("kind", "call")
        .order("id", { ascending: false })
        .limit(40);
      if (alive) setFound(data ?? []);
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [term]);

  const choose = (channel, messageId = null) => {
    setOpenId(channel.id);
    setJump(messageId ? { channelId: channel.id, messageId, at: Date.now() } : null);
  };
  // En pantalla angosta la conversación tapa la lista: "atrás" vuelve a ella.
  const narrow = compact || (typeof window !== "undefined" && window.innerWidth < 1024);
  useBackLayer(narrow && !!open, () => setOpenId(null));

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
        <div className="page-intro">
          <h1 className="text-xl font-bold text-slate-900">Mensajes</h1>
          <p className="mt-1 text-sm text-slate-500">Conversaciones entre las personas de tu empresa. Nadie de fuera puede leerlas.</p>
        </div>
      )}
      {!open && <PushInvite compact={compact} />}
      <div className={`grid min-h-0 flex-1 overflow-hidden border-slate-200 bg-white lg:grid-cols-[300px_minmax(0,1fr)] ${compact ? "" : "messages-panel h-[calc(100vh-14rem)] min-h-[420px] rounded-2xl border shadow-sm"}`}>
        <div className={`min-h-0 flex-col border-slate-100 lg:flex lg:border-r ${open ? "hidden" : "flex"}`}>
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2.5">
            <p className="text-xs font-bold text-slate-700">Conversaciones</p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setSearching((v) => !v);
                  setQuery("");
                }}
                aria-label="Buscar en los chats"
                title="Buscar personas o palabras"
                aria-pressed={searching}
                className={`flex h-7 w-7 items-center justify-center rounded-lg ${searching ? "bg-blue-50 text-blue-600" : "text-slate-500 hover:bg-slate-100"}`}
              >
                <Search size={14} />
              </button>
              <button onClick={() => setCreating(true)} className="flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-700">
                <Plus size={12} /> Nueva
              </button>
            </div>
          </div>
          {searching && (
            <div className="border-b border-slate-100 px-3 py-2">
              <div className="relative">
                <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar personas o palabras"
                  aria-label="Buscar personas o palabras"
                  className="h-8 w-full rounded-lg border border-slate-200 pl-8 pr-7 text-xs focus:border-blue-400 focus:outline-none"
                />
                {query && (
                  <button type="button" onClick={() => setQuery("")} aria-label="Borrar búsqueda" className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100">
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>
          )}
          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1.5">
            {term && <p className="px-2 pb-1 pt-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Conversaciones</p>}
            {shown.map((c) => (
              <ChannelRow key={c.id} channel={c} active={openId === c.id} onOpen={(ch) => choose(ch)} />
            ))}
            {term && shown.length === 0 && <p className="px-2 py-2 text-[11px] text-slate-400">Ninguna conversación con ese nombre.</p>}
            {term.length >= 3 && (
              <>
                <p className="px-2 pb-1 pt-3 text-[10px] font-bold uppercase tracking-wide text-slate-400">Mensajes</p>
                {found.length === 0 && <p className="px-2 py-2 text-[11px] text-slate-400">Ningún mensaje con esa palabra.</p>}
                {found.map((m) => {
                  const ch = channels.find((c) => c.id === m.channelId);
                  if (!ch) return null;
                  return (
                    <button key={m.id} type="button" onClick={() => choose(ch, m.id)} className="flex w-full items-start gap-2.5 rounded-xl px-2 py-2 text-left hover:bg-slate-50">
                      <ChannelAvatar channel={ch} size="h-7 w-7" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-[11px] font-semibold text-slate-700">{channelTitle(ch)}</span>
                          <span className="shrink-0 text-[10px] text-slate-400">{timeAgoLabel(m.createdAt).replace("hace ", "")}</span>
                        </span>
                        <span className="line-clamp-2 text-[11px] text-slate-500">
                          {m.senderName ? `${m.senderName.split(" ")[0]}: ` : ""}
                          <Highlight text={m.body} term={term} />
                        </span>
                      </span>
                    </button>
                  );
                })}
              </>
            )}
            {!term && channels.length === 0 && <p className="py-8 text-center text-xs text-slate-400">Cargando conversaciones…</p>}
          </div>
        </div>
        <div className={`min-h-0 lg:block ${open ? "block" : "hidden"}`}>
          {open ? (
            <Conversation
              key={open.id}
              channel={open}
              isAdmin={isAdmin}
              jumpTo={jump?.channelId === open.id ? jump : null}
              onBack={() => goBack(() => setOpenId(null))}
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
      {creating && <NewConversationModal initialMode="direct" onOpen={handleOpened} onClose={() => setCreating(false)} />}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Tareas                                                                */
/* ---------------------------------------------------------------------- */

const TASK_STATUS = {
  open: { label: "Por hacer", className: "bg-slate-100 text-slate-600" },
  in_progress: { label: "En proceso", className: "bg-blue-50 text-blue-700" },
  review: { label: "Entregada", className: "bg-violet-50 text-violet-700" },
  done: { label: "Terminada", className: "bg-emerald-50 text-emerald-700" },
  cancelled: { label: "Cancelada", className: "bg-rose-50 text-rose-600" },
};
const TASK_PRIORITY = { high: { label: "Alta", className: "text-rose-600" }, normal: { label: "Normal", className: "text-slate-400" }, low: { label: "Baja", className: "text-slate-400" } };

// channel y message: la tarea nace de un mensaje del chat.
export function TaskFormModal({ initial, isAdmin, onClose, channel = null, message = null }) {
  const { user } = useAuth();
  const { people: everyone } = usePeople();
  const { showToast } = useToast();
  const inbox = useInbox();
  // En una directa o un grupo se le puede asignar a cualquiera de sus participantes.
  const chatAssign = !!channel && channel.kind !== "general";
  const [memberIds, setMemberIds] = useState(null);
  useEffect(() => {
    if (!chatAssign) return;
    supabase
      .from("chat_members")
      .select("userId")
      .eq("channelId", channel.id)
      .then(({ data }) => setMemberIds((data ?? []).map((m) => m.userId)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel?.id]);
  const people = chatAssign && memberIds && !isAdmin ? everyone.filter((p) => memberIds.includes(p.id) || p.id === user?.id) : everyone;
  const fromText = message?.body ? String(message.body).replace(/\s+/g, " ").trim() : "";
  const [title, setTitle] = useState(initial?.title ?? fromText.slice(0, 200));
  const [description, setDescription] = useState(initial?.description ?? (message ? `De ${message.senderName || "un mensaje"} en el chat${fromText.length > 200 ? `: "${fromText}"` : "."}` : ""));
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
    if (channel && !initial?.id) {
      row.channelId = channel.id;
      if (message?.id && !String(message.id).startsWith("tmp-")) row.messageId = message.id;
    }
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
    <Modal title={initial?.id ? "Editar tarea" : channel ? "Asignar como tarea" : "Nueva tarea"} width="max-w-md" onClose={onClose}>
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
            <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} disabled={!isAdmin && !chatAssign} className={`${inputClass} disabled:bg-slate-50 disabled:text-slate-400`}>
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
        {!isAdmin && !chatAssign && <p className="text-[11px] text-slate-400">Solo un administrador puede asignar tareas a otras personas.</p>}
        {chatAssign && !isAdmin && <p className="text-[11px] text-slate-400">Puedes asignarla a quien participa en esta conversación.</p>}
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
  const [uploading, setUploading] = useState("");
  const scrollRef = useRef(null);
  const fileRef = useRef(null);
  const closed = task.status === "done" || task.status === "cancelled";

  async function attach(files) {
    const list = Array.from(files ?? []).slice(0, 10);
    for (let i = 0; i < list.length; i += 1) {
      setUploading(`Subiendo ${i + 1} de ${list.length}…`);
      try {
        const attachment = await uploadTaskFile(task, list[i]);
        const { data, error } = await supabase.from("task_comments").insert({ taskId, body: "", attachment }).select().single();
        if (error) throw error;
        setItems((prev) => (prev && !prev.some((m) => m.id === data.id) ? [...prev, data] : prev));
      } catch (err) {
        showToast(err?.message ?? "No se pudo subir el archivo.");
      }
    }
    setUploading("");
  }
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
      <div ref={scrollRef} className="min-h-[160px] flex-1 space-y-1 overflow-y-auto overscroll-contain bg-slate-50/60 px-3 py-3">
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
                  {m.attachment ? <TaskFile attachment={m.attachment} mine={mine} /> : <p className="whitespace-pre-wrap break-words text-xs leading-relaxed">{m.body}</p>}
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
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={!!uploading}
            aria-label="Adjuntar archivo"
            title={uploading || `Adjuntar archivo (${TASK_TYPES_TEXT})`}
            className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 disabled:animate-pulse"
          >
            <Paperclip size={17} />
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={TASK_ACCEPT}
            className="hidden"
            onChange={(e) => {
              attach(e.target.files);
              e.target.value = "";
            }}
          />
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

// Archivos de las tareas (almacén "tasks", migración v29).
// Solo formatos de oficina: PDF, Word, Excel, CSV, PowerPoint, texto,
// imágenes JPG/PNG y XML (facturas CFDI).
const TASK_EXT = ["pdf", "doc", "docx", "xls", "xlsx", "csv", "ppt", "pptx", "txt", "jpg", "png", "xml"];
const TASK_ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt,.jpg,.jpeg,.png,.xml";
const TASK_TYPES_TEXT = "PDF, Word, Excel, CSV, PowerPoint, TXT, JPG, PNG o XML";
const TASK_FILE_MB = 25;
const fileSize = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((bytes || 0) / 1024))} KB`);
async function uploadTaskFile(task, file) {
  let ext = (file.name.split(".").pop() || "").toLowerCase();
  if (ext === "jpeg") ext = "jpg";
  if (!TASK_EXT.includes(ext)) throw new Error(`"${file.name}" no se puede adjuntar. Solo ${TASK_TYPES_TEXT}.`);
  if (file.size > TASK_FILE_MB * 1048576) throw new Error(`"${file.name}" pesa más de ${TASK_FILE_MB} MB.`);
  const path = `${task.companyId}/${task.id}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("tasks").upload(path, file, { contentType: file.type || undefined });
  if (error) throw new Error(/bucket|not found/i.test(error.message) ? "Los archivos de tareas se activan con la actualización v29 de la base de datos." : `No se pudo subir "${file.name}".`);
  return { path, name: file.name.slice(0, 200), mime: file.type || null, size: file.size };
}
// Deja solo los archivos permitidos y avisa de los que no.
function keepTaskFiles(fileList, showToast) {
  const all = Array.from(fileList ?? []);
  const ok = all.filter((f) => TASK_EXT.includes(((f.name.split(".").pop() || "").toLowerCase()).replace("jpeg", "jpg")));
  if (ok.length < all.length) showToast(`Solo se pueden adjuntar archivos ${TASK_TYPES_TEXT}.`);
  return ok;
}

async function openTaskFile(attachment) {
  const { data, error } = await supabase.storage.from("tasks").createSignedUrl(attachment.path, 3600, { download: attachment.name || true });
  if (!error && data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
}

// Un archivo dentro de la conversación de la tarea.
function TaskFile({ attachment, mine }) {
  const [thumb, setThumb] = useState(null);
  const image = /^image\//.test(attachment?.mime ?? "");
  useEffect(() => {
    if (!image || !attachment?.path) return;
    let alive = true;
    supabase.storage
      .from("tasks")
      .createSignedUrl(attachment.path, 3600)
      .then(({ data }) => alive && setThumb(data?.signedUrl ?? null));
    return () => {
      alive = false;
    };
  }, [attachment?.path, image]);
  return (
    <button type="button" onClick={() => openTaskFile(attachment)} className={`mt-1 flex w-full items-center gap-2 rounded-xl p-1.5 text-left ${mine ? "bg-[rgb(255_255_255/0.14)]" : "bg-slate-100"}`}>
      {thumb ? (
        <img src={thumb} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
      ) : (
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${mine ? "bg-[rgb(255_255_255/0.2)]" : "bg-white text-blue-600"}`}>
          <FileText size={16} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-semibold">{attachment.name || "Archivo"}</span>
        <span className={`block text-[10px] ${mine ? "text-blue-100" : "text-slate-400"}`}>{attachment.size ? fileSize(attachment.size) : "Toca para abrir"}</span>
      </span>
      <Download size={13} className="shrink-0 opacity-70" />
    </button>
  );
}

// Barra de avance: Por hacer → En proceso → Entregada → Resuelta.
const TASK_STEPS = [
  ["open", "Por hacer"],
  ["in_progress", "En proceso"],
  ["review", "Entregada"],
  ["done", "Resuelta"],
];
function TaskProgress({ status, small = false }) {
  if (status === "cancelled") return <p className={`${small ? "text-[10px]" : "text-[11px]"} font-semibold text-slate-400`}>Tarea cancelada</p>;
  const index = Math.max(0, TASK_STEPS.findIndex(([id]) => id === status));
  const finished = status === "done";
  return (
    <div className="flex items-start gap-1" aria-label={`Avance: ${TASK_STEPS[index][1]}`}>
      {TASK_STEPS.map(([id, label], i) => (
        <div key={id} className="min-w-0 flex-1">
          <div className={`${small ? "h-1" : "h-1.5"} rounded-full transition-colors duration-500 ${i <= index ? (finished ? "bg-emerald-500" : "bg-blue-600") : "bg-slate-200"}`} />
          {!small && <p className={`mt-1 truncate text-[10px] ${i === index ? "font-bold text-slate-700" : i < index ? "text-slate-500" : "text-slate-400"}`}>{label}</p>}
        </div>
      ))}
    </div>
  );
}

// Entregar la tarea: un comentario y los archivos que lo demuestran.
function DeliverModal({ task, onClose, onDelivered }) {
  const { showToast } = useToast();
  const [note, setNote] = useState("");
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState("");
  const pickRef = useRef(null);

  async function deliver() {
    setBusy("Entregando…");
    try {
      if (note.trim()) {
        const { error } = await supabase.from("task_comments").insert({ taskId: task.id, body: note.trim() });
        if (error) throw error;
      }
      for (let i = 0; i < files.length; i += 1) {
        setBusy(`Subiendo ${i + 1} de ${files.length}…`);
        const attachment = await uploadTaskFile(task, files[i]);
        const { error } = await supabase.from("task_comments").insert({ taskId: task.id, body: "", attachment });
        if (error) throw error;
      }
      const { error } = await supabase.from("tasks").update({ status: "review" }).eq("id", task.id);
      if (error) throw error;
      showToast("Tarea entregada. Le avisamos a quien la asignó para que la revise.");
      onDelivered?.();
      onClose();
    } catch (err) {
      setBusy("");
      showToast(/review|check constraint|tasks_status_check/i.test(err?.message ?? "") ? "Entregar tareas se activa con la actualización v29 de la base de datos." : err?.message ?? "No se pudo entregar.");
    }
  }

  return (
    <Modal title="Entregar tarea" width="max-w-md" onClose={busy ? () => {} : onClose}>
      <div className="space-y-3">
        <p className="text-xs text-slate-500">
          <b className="text-slate-700">{task.title}</b>
          <br />
          Escribe qué hiciste y adjunta lo que lo demuestra (fotos, PDF, documentos). Quien te asignó la tarea la revisará.
        </p>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Ej. Ya revisé la factura y coincide con la orden."
          className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-blue-400 focus:outline-none"
        />
        <div className="space-y-1.5">
          {files.map((f, i) => (
            <div key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5">
              <FileText size={14} className="shrink-0 text-blue-600" />
              <span className="min-w-0 flex-1 truncate text-xs text-slate-700">{f.name}</span>
              <span className="shrink-0 text-[10px] text-slate-400">{fileSize(f.size)}</span>
              <button type="button" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} aria-label={`Quitar ${f.name}`} className="rounded p-0.5 text-slate-400 hover:bg-slate-100">
                <X size={12} />
              </button>
            </div>
          ))}
          <button type="button" onClick={() => pickRef.current?.click()} className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">
            <Paperclip size={13} /> Adjuntar archivos
          </button>
          <p className="text-center text-[10px] text-slate-400">{TASK_TYPES_TEXT} · hasta {TASK_FILE_MB} MB cada uno</p>
          <input
            ref={pickRef}
            type="file"
            multiple
            accept={TASK_ACCEPT}
            className="hidden"
            onChange={(e) => {
              // Se copian antes de limpiar el campo (si no, la lista queda vacía).
              const picked = keepTaskFiles(e.target.files, showToast);
              setFiles((prev) => [...prev, ...picked].slice(0, 10));
              e.target.value = "";
            }}
          />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={!!busy} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-50">
            Cancelar
          </button>
          <button
            type="button"
            onClick={deliver}
            disabled={!!busy || (!note.trim() && files.length === 0)}
            className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
          >
            <Upload size={13} /> {busy || "Entregar"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// Resolver una tarea: pide cómo quedó resuelta, confirmar que se revisó y,
// si se quiere, la evidencia. approve: se aprueba una entrega.
function ResolveModal({ task, approve = false, onClose, onResolved }) {
  const { showToast } = useToast();
  const [note, setNote] = useState("");
  const [files, setFiles] = useState([]);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState("");
  const pickRef = useRef(null);
  const noteOk = approve ? true : note.trim().length >= 10;
  const ready = noteOk && checked && !busy;

  async function resolve() {
    setBusy("Guardando…");
    try {
      if (note.trim()) {
        const { error } = await supabase.from("task_comments").insert({ taskId: task.id, body: `${approve ? "✅ Entrega aprobada" : "✅ Resolución"}: ${note.trim()}`.slice(0, 2000) });
        if (error) throw error;
      }
      for (let i = 0; i < files.length; i += 1) {
        setBusy(`Subiendo ${i + 1} de ${files.length}…`);
        const attachment = await uploadTaskFile(task, files[i]);
        const { error } = await supabase.from("task_comments").insert({ taskId: task.id, body: "", attachment });
        if (error) throw error;
      }
      const { error } = await supabase.from("tasks").update({ status: "done" }).eq("id", task.id);
      if (error) throw error;
      showToast(approve ? "Entrega aprobada: la tarea quedó resuelta." : "Tarea resuelta. Sigue en la lista, en \"Resueltas\".");
      onResolved?.();
      onClose();
    } catch (err) {
      setBusy("");
      showToast(err?.message ?? "No se pudo resolver la tarea.");
    }
  }

  return (
    <Modal title={approve ? "Aprobar y resolver" : "Marcar como resuelta"} width="max-w-md" onClose={busy ? () => {} : onClose}>
      <div className="space-y-3">
        <p className="text-xs text-slate-500">
          <b className="text-slate-700">{task.title}</b>
          <br />
          {approve ? "Revisa lo que entregaron antes de aprobar." : "Para cerrar la tarea, deja constancia de cómo quedó resuelta."}
        </p>
        <div>
          <label className="mb-1 block text-[11px] font-semibold text-slate-500">
            {approve ? "Comentario (opcional)" : "¿Cómo quedó resuelta?"} {!approve && <span className="text-rose-500">*</span>}
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={1800}
            placeholder={approve ? "Ej. Todo en orden." : "Ej. Se revisó la factura con el proveedor y coincide con la orden."}
            className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-blue-400 focus:outline-none"
          />
          {!approve && note.trim().length > 0 && note.trim().length < 10 && <p className="mt-0.5 text-[10px] text-slate-400">Escribe un poco más (al menos 10 letras).</p>}
        </div>
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold text-slate-500">Evidencia (opcional)</p>
          {files.map((f, i) => (
            <div key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5">
              <FileText size={14} className="shrink-0 text-blue-600" />
              <span className="min-w-0 flex-1 truncate text-xs text-slate-700">{f.name}</span>
              <span className="shrink-0 text-[10px] text-slate-400">{fileSize(f.size)}</span>
              <button type="button" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} aria-label={`Quitar ${f.name}`} className="rounded p-0.5 text-slate-400 hover:bg-slate-100">
                <X size={12} />
              </button>
            </div>
          ))}
          <button type="button" onClick={() => pickRef.current?.click()} className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">
            <Paperclip size={13} /> Adjuntar fotos o documentos
          </button>
          <input
            ref={pickRef}
            type="file"
            multiple
            accept={TASK_ACCEPT}
            className="hidden"
            onChange={(e) => {
              const picked = keepTaskFiles(e.target.files, showToast);
              setFiles((prev) => [...prev, ...picked].slice(0, 10));
              e.target.value = "";
            }}
          />
        </div>
        <label className="flex cursor-pointer items-start gap-2 rounded-xl bg-slate-50 px-3 py-2">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5 h-4 w-4 accent-emerald-600" />
          <span className="text-[11px] text-slate-600">{approve ? "Revisé la entrega y está completa." : "Confirmo que revisé el resultado y la tarea quedó resuelta."}</span>
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={!!busy} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-50">
            Cancelar
          </button>
          <button type="button" onClick={resolve} disabled={!ready} className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
            <CheckCircle2 size={13} /> {busy || (approve ? "Aprobar y resolver" : "Marcar como resuelta")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// Detalle de una tarea con su avance, sus acciones y su conversación.
function TaskDetail({ task, isAdmin, onEdit, onSetStatus, onClose }) {
  const { user } = useAuth();
  const { format } = useDateFormat();
  const inbox = useInbox();
  const [delivering, setDelivering] = useState(false);
  const [resolving, setResolving] = useState(null); // "resolve" | "approve"
  const mine = task.assignedTo === user?.id;
  const isCreator = task.createdBy === user?.id;
  const canReview = isAdmin || isCreator;
  const selfTask = mine && isCreator;
  const status = TASK_STATUS[task.status] ?? TASK_STATUS.open;
  const pending = ["open", "in_progress", "review"].includes(task.status);
  const working = task.status === "open" || task.status === "in_progress";
  const button = "rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition";

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
      <TaskProgress status={task.status} />
      {(task.description || task.relatedLabel) && (
        <div className="max-h-28 shrink-0 space-y-1 overflow-y-auto">
          {task.description && <p className="whitespace-pre-wrap break-words rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">{task.description}</p>}
          {task.relatedLabel && (
            <p className="text-[11px] text-slate-500">
              Relacionada con: <b>{task.relatedLabel}</b>
            </p>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {task.status === "open" && mine && (
          <button onClick={() => onSetStatus(task, "in_progress")} className={`${button} border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100`}>
            Empezar
          </button>
        )}
        {working && mine && !selfTask && (
          <button onClick={() => setDelivering(true)} className={`${button} flex items-center gap-1 border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100`}>
            <Upload size={12} /> Entregar
          </button>
        )}
        {task.status === "review" && canReview && (
          <button onClick={() => onSetStatus(task, "in_progress")} className={`${button} border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100`}>
            Pedir cambios
          </button>
        )}
        {task.status === "review" && mine && !canReview && <span className="rounded-lg bg-violet-50 px-2.5 py-1.5 text-[11px] font-medium text-violet-700">Entregada: falta que {task.createdByName || "quien la asignó"} la revise.</span>}
        {!pending && (canReview || mine) && (
          <button onClick={() => onSetStatus(task, "open")} className={`${button} border-slate-200 text-slate-600 hover:bg-slate-50`}>
            Reabrir
          </button>
        )}
        {canReview && pending && (
          <button onClick={() => onEdit(task)} className={`${button} border-slate-200 text-slate-600 hover:bg-slate-50`}>
            Editar
          </button>
        )}
        {canReview && pending && (
          <button onClick={() => onSetStatus(task, "cancelled")} className={`${button} border-slate-200 text-slate-500 hover:bg-slate-50`}>
            Cancelar tarea
          </button>
        )}
        {/* Resolver va al final, a la derecha, y pide sus requisitos. */}
        {working && (canReview || selfTask) && (
          <button onClick={() => setResolving("resolve")} className={`${button} ml-auto flex items-center gap-1 border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}>
            <CheckCircle2 size={12} /> Marcar como resuelta
          </button>
        )}
        {task.status === "review" && canReview && (
          <button onClick={() => setResolving("approve")} className={`${button} ml-auto flex items-center gap-1 border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700`}>
            <CheckCircle2 size={12} /> Aprobar y resolver
          </button>
        )}
      </div>
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
        <MessageSquare size={12} /> {pending ? "Seguimiento" : "Historial hasta su resolución"}
      </p>
      <TaskChat task={task} />
      {delivering && <DeliverModal task={task} onClose={() => setDelivering(false)} onDelivered={() => inbox.reloadTasks()} />}
      {resolving && <ResolveModal task={task} approve={resolving === "approve"} onClose={() => setResolving(null)} onResolved={() => inbox.reloadTasks()} />}
    </div>
  );
}

// Tareas: Todas, Mis tareas y Las que asigné. Las pendientes arriba y las
// resueltas abajo (no desaparecen al resolverlas).
export function TasksPage({ isAdmin, compact = false, view = "open", focusId = null }) {
  const { user } = useAuth();
  const { format } = useDateFormat();
  const { showToast } = useToast();
  const inbox = useInbox();
  const wide = useWide();
  const [scope, setScope] = useState("all");
  const [form, setForm] = useState(null);
  const [selectedId, setSelectedId] = useState(focusId);
  const [showClosed, setShowClosed] = useState(true);
  const [resolving, setResolving] = useState(null); // tarea por resolver desde la lista
  const tasks = inbox?.tasks ?? [];
  const today = localISODate();

  useEffect(() => {
    if (focusId) setSelectedId(focusId);
  }, [focusId]);
  useEffect(() => {
    if (view === "done") setShowClosed(true);
  }, [view]);

  const scopes = [
    { id: "all", label: "Todas", filter: () => true },
    { id: "mine", label: "Mis tareas", filter: (t) => t.assignedTo === user?.id },
    { id: "given", label: "Las que asigné", filter: (t) => t.createdBy === user?.id && t.assignedTo !== user?.id },
  ];
  const current = scopes.find((s) => s.id === scope) ?? scopes[0];
  const isPending = (t) => ["open", "in_progress", "review"].includes(t.status);
  const inScope = tasks.filter(current.filter);
  const pendingList = inScope
    .filter(isPending)
    .sort((a, b) => String(a.dueDate ?? "9999").localeCompare(String(b.dueDate ?? "9999")) || b.id - a.id);
  const closedList = inScope
    .filter((t) => !isPending(t))
    .sort((a, b) => String(b.completedAt ?? b.updatedAt ?? "").localeCompare(String(a.completedAt ?? a.updatedAt ?? "")) || b.id - a.id);
  const selected = tasks.find((t) => t.id === selectedId) ?? null;
  const sidePanel = wide && !compact;

  // En pantalla ancha, la primera tarea de la lista se abre sola.
  useEffect(() => {
    if (sidePanel && (!selected || !current.filter(selected)) && !focusId) {
      const first = pendingList[0] ?? closedList[0];
      if (first) setSelectedId(first.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidePanel, scope, pendingList.length, closedList.length]);

  async function setStatus(task, status) {
    const { error } = await supabase.from("tasks").update({ status }).eq("id", task.id);
    if (error) showToast(`No se pudo actualizar: ${error.message}`);
    else {
      inbox.reloadTasks();
      if (status === "done") showToast("Tarea resuelta. Sigue en la lista, en \"Resueltas\".");
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

  const row = (t) => {
    const pending = isPending(t);
    const overdue = pending && t.dueDate && t.dueDate < today;
    const mine = t.assignedTo === user?.id;
    const canEdit = isAdmin || t.createdBy === user?.id;
    const status = TASK_STATUS[t.status] ?? TASK_STATUS.open;
    const active = selected?.id === t.id && sidePanel;
    return (
      <div
        key={t.id}
        className={`flex items-start gap-3 rounded-2xl border bg-white p-3.5 shadow-sm transition ${active ? "border-blue-300 ring-2 ring-blue-100" : overdue ? "border-rose-200" : "border-slate-200"}`}
      >
        <button
          onClick={() => (t.status === "done" || t.status === "cancelled" ? setStatus(t, "open") : setResolving(t))}
          disabled={!canEdit && !(mine && t.createdBy === user?.id)}
          aria-label={t.status === "done" ? "Reabrir tarea" : "Marcar como resuelta"}
          title={canEdit ? (t.status === "done" ? "Reabrir" : "Marcar como resuelta") : "Solo quien asignó la tarea la marca como resuelta"}
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition disabled:opacity-40 ${
            t.status === "done" ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 text-transparent hover:border-emerald-400"
          }`}
        >
          <CheckCircle2 size={12} />
        </button>
        <button onClick={() => setSelectedId(t.id)} className="min-w-0 flex-1 text-left">
          <p className={`break-words text-sm font-semibold ${t.status === "cancelled" ? "text-slate-400 line-through" : pending ? "text-slate-800" : "text-slate-600"}`}>{t.title}</p>
          {t.description && <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap break-words text-xs text-slate-500">{t.description}</p>}
          <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
            <span className={`rounded-full px-2 py-0.5 font-semibold ${status.className}`}>{status.label}</span>
            <span className="flex items-center gap-1">
              <User size={11} /> {mine ? "Yo" : t.assignedToName || "Sin asignar"}
            </span>
            {t.dueDate && pending && (
              <span className={`flex items-center gap-1 ${overdue ? "font-semibold text-rose-600" : ""}`}>
                {overdue && <AlertTriangle size={11} />}
                {overdue ? "Venció el" : "Para el"} {formatDate(t.dueDate, format)}
              </span>
            )}
            {!pending && t.completedAt && <span>Resuelta el {formatDate(t.completedAt.slice(0, 10), format)}</span>}
            {t.priority === "high" && pending && <span className={`font-semibold ${TASK_PRIORITY.high.className}`}>Prioridad alta</span>}
            {t.relatedLabel && <span>· {t.relatedLabel}</span>}
          </span>
          <span className="mt-2 block max-w-[220px]">
            <TaskProgress status={t.status} small />
          </span>
        </button>
        {canEdit && (
          <button onClick={() => remove(t)} aria-label="Eliminar tarea" className="shrink-0 rounded-lg border border-slate-200 p-1.5 text-slate-400 hover:bg-slate-50 hover:text-rose-500">
            <Trash2 size={12} />
          </button>
        )}
      </div>
    );
  };

  const list = (
    <div className="space-y-2">
      {pendingList.map(row)}
      {pendingList.length === 0 && (
        <p className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-white py-8 text-center text-xs text-slate-400">
          <CheckCheck size={20} className="text-emerald-400" />
          {current.id === "mine" ? "No tienes tareas pendientes." : "Sin tareas pendientes en esta vista."}
        </p>
      )}
      {closedList.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowClosed((v) => !v)}
            aria-expanded={showClosed}
            className="flex w-full items-center gap-2 px-1 pt-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-400 hover:text-slate-600"
          >
            <ChevronDown size={13} className={`transition ${showClosed ? "" : "-rotate-90"}`} /> Resueltas y canceladas ({closedList.length})
          </button>
          {showClosed && closedList.map(row)}
        </>
      )}
    </div>
  );

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      {scopes.map((s) => {
        const count = tasks.filter(s.filter).filter(isPending).length;
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
      <button onClick={() => setForm({})} className="ml-auto flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700">
        <Plus size={15} /> Nueva tarea
      </button>
    </div>
  );

  // PC: la lista y el detalle llenan la pantalla y cada uno se desplaza por dentro.
  if (sidePanel) {
    return (
      <div className="flex h-[calc(100vh-7.5rem)] min-h-[480px] flex-col gap-3">
        {toolbar}
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(360px,440px)] gap-4">
          <div className="min-h-0 overflow-y-auto overscroll-contain pr-1">{list}</div>
          <div className="flex min-h-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            {selected ? (
              <TaskDetail task={selected} isAdmin={isAdmin} onEdit={setForm} onSetStatus={setStatus} onClose={() => setSelectedId(null)} />
            ) : (
              <p className="m-auto text-center text-xs text-slate-400">Elige una tarea para ver su avance y su conversación.</p>
            )}
          </div>
        </div>
        {form && <TaskFormModal initial={form} isAdmin={isAdmin} onClose={() => setForm(null)} />}
        {resolving && <ResolveModal task={resolving} approve={resolving.status === "review"} onClose={() => setResolving(null)} onResolved={() => inbox.reloadTasks()} />}
      </div>
    );
  }

  return (
    <div className={compact ? "space-y-4 p-4 pb-24" : "space-y-4"}>
      {compact && <h1 className="text-xl font-bold text-slate-900">Tareas</h1>}
      {toolbar}
      {list}
      {selected && (
        <Modal title="Tarea" width="max-w-lg" onClose={() => setSelectedId(null)}>
          <div className="flex h-[75vh] min-h-0 flex-col">
            <TaskDetail task={selected} isAdmin={isAdmin} onEdit={setForm} onSetStatus={setStatus} />
          </div>
        </Modal>
      )}
      {form && <TaskFormModal initial={form} isAdmin={isAdmin} onClose={() => setForm(null)} />}
      {resolving && <ResolveModal task={resolving} approve={resolving.status === "review"} onClose={() => setResolving(null)} onResolved={() => inbox.reloadTasks()} />}
    </div>
  );
}
