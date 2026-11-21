import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bell,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock,
  Edit2,
  Eye,
  Flag,
  HelpCircle,
  ListTodo,
  Lock,
  MapPin,
  MessageSquare,
  Phone,
  Plus,
  Repeat,
  Trash2,
  Users,
  Video,
  X,
  XCircle,
} from "lucide-react";
import { supabase, useAuth, useToast, Modal, avatarUrl } from "./NavioDashboard.jsx";
import { usePeople, personName } from "./people.jsx";
import { useInbox } from "./inbox.jsx";
import { useCalls } from "./calls.jsx";

/* ---------------------------------------------------------------------- */
/*  Agenda: reuniones, revisiones, tareas, recordatorios y visitas         */
/* ---------------------------------------------------------------------- */
// Vive en la base (migración v32). Cada evento puede repetirse y avisar antes
// (los avisos llegan como notificación, también al teléfono). Lo ven quien lo
// crea y sus participantes, o toda la empresa si así se elige.

export const AGENDA_KINDS = [
  { id: "meeting", label: "Reunión", icon: Users },
  { id: "review", label: "Revisión de proceso", icon: ClipboardCheck },
  { id: "task", label: "Tarea", icon: ListTodo },
  { id: "reminder", label: "Recordatorio", icon: Bell },
  { id: "visit", label: "Visita", icon: MapPin },
  { id: "call", label: "Llamada", icon: Phone },
  { id: "other", label: "Otro", icon: CalendarDays },
];
const kindOf = (id) => AGENDA_KINDS.find((k) => k.id === id) ?? AGENDA_KINDS[AGENDA_KINDS.length - 1];

// Clases escritas completas para que Tailwind las incluya.
const COLORS = {
  blue: { dot: "bg-blue-500", soft: "border-blue-200 bg-blue-50 text-blue-700", ring: "ring-blue-500" },
  violet: { dot: "bg-violet-500", soft: "border-violet-200 bg-violet-50 text-violet-700", ring: "ring-violet-500" },
  emerald: { dot: "bg-emerald-500", soft: "border-emerald-200 bg-emerald-50 text-emerald-700", ring: "ring-emerald-500" },
  amber: { dot: "bg-amber-500", soft: "border-amber-200 bg-amber-50 text-amber-700", ring: "ring-amber-500" },
  rose: { dot: "bg-rose-500", soft: "border-rose-200 bg-rose-50 text-rose-700", ring: "ring-rose-500" },
  sky: { dot: "bg-sky-500", soft: "border-sky-200 bg-sky-50 text-sky-700", ring: "ring-sky-500" },
  slate: { dot: "bg-slate-500", soft: "border-slate-200 bg-slate-50 text-slate-700", ring: "ring-slate-500" },
};
const colorOf = (id) => COLORS[id] ?? COLORS.blue;

const REMINDERS = [
  { min: 0, label: "A la hora" },
  { min: 5, label: "5 min" },
  { min: 10, label: "10 min" },
  { min: 15, label: "15 min" },
  { min: 30, label: "30 min" },
  { min: 60, label: "1 h" },
  { min: 120, label: "2 h" },
  { min: 1440, label: "1 día" },
  { min: 2880, label: "2 días" },
  { min: 10080, label: "1 semana" },
];
const RECURRENCES = [
  { id: "none", label: "No se repite" },
  { id: "daily", label: "Cada día" },
  { id: "weekdays", label: "Entre semana (lun a vie)" },
  { id: "weekly", label: "Cada semana" },
  { id: "biweekly", label: "Cada 2 semanas" },
  { id: "monthly", label: "Cada mes" },
  { id: "yearly", label: "Cada año" },
];
const PRIORITIES = [
  { id: "low", label: "Baja" },
  { id: "normal", label: "Normal" },
  { id: "high", label: "Alta" },
];
const RESPONSES = {
  pending: { label: "Sin responder", className: "bg-slate-100 text-slate-500" },
  accepted: { label: "Asistirá", className: "bg-emerald-50 text-emerald-700" },
  tentative: { label: "Tal vez", className: "bg-amber-50 text-amber-700" },
  declined: { label: "No asistirá", className: "bg-rose-50 text-rose-700" },
};

/* ---------- Fechas ---------- */
const pad = (n) => String(n).padStart(2, "0");
const dateInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeInput = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const sameDay = (a, b) => dateInput(a) === dateInput(b);
const hourLabel = (d) => d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
const chatName = (c) => (c.kind === "general" ? "General" : c.kind === "direct" ? c.otherUserName || "Conversación" : c.name || "Grupo");

function dayTitle(d) {
  const today = startOfDay(new Date());
  if (sameDay(d, today)) return "Hoy";
  if (sameDay(d, addDays(today, 1))) return "Mañana";
  if (sameDay(d, addDays(today, -1))) return "Ayer";
  const text = d.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function timeRange(item) {
  const start = new Date(item.startsAt);
  if (item.allDay) return "Todo el día";
  const end = item.endsAt ? new Date(item.endsAt) : null;
  if (!end) return hourLabel(start);
  if (sameDay(start, end)) return `${hourLabel(start)} – ${hourLabel(end)}`;
  return `${hourLabel(start)} – ${end.toLocaleDateString("es-MX", { day: "numeric", month: "short" })} ${hourLabel(end)}`;
}

// "Ahora", "en 25 min", "Hoy 10:30", "Mañana 9:00", "vie 28 · 9:00".
function whenLabel(item, now = Date.now()) {
  const start = Date.parse(item.startsAt);
  const end = item.endsAt ? Date.parse(item.endsAt) : start + 30 * 60000;
  if (start <= now && end > now) return "Ahora";
  const minutes = Math.round((start - now) / 60000);
  if (minutes >= 0 && minutes < 60) return minutes <= 1 ? "En un momento" : `En ${minutes} min`;
  const d = new Date(start);
  const time = item.allDay ? "todo el día" : hourLabel(d);
  if (sameDay(d, new Date(now))) return `Hoy ${time}`;
  if (sameDay(d, addDays(new Date(now), 1))) return `Mañana ${time}`;
  return `${d.toLocaleDateString("es-MX", { weekday: "short", day: "numeric" })} · ${time}`;
}

const recurrenceLabel = (id) => (id && id !== "none" ? RECURRENCES.find((r) => r.id === id)?.label : null);
const isLink = (text) => /^https?:\/\/[^\s]+$/i.test(String(text ?? "").trim());
const agendaChanged = () => window.dispatchEvent(new Event("navio:agenda"));
const openInNavio = (url) => window.postMessage({ type: "navio:open", url }, window.location.origin);

/* ---------- Datos ---------- */
// Lo que hay entre dos fechas (cada repetición por separado).
export function useAgendaRange(fromISO, toISO) {
  const [state, setState] = useState({ items: [], loading: true, available: true });
  const load = useCallback(async () => {
    if (!fromISO || !toISO) return;
    const { data, error } = await supabase.rpc("agenda_list", { from_ts: fromISO, to_ts: toISO });
    if (error) {
      const missing = error.code === "PGRST202" || /agenda_list|could not find|does not exist/i.test(error.message ?? "");
      setState({ items: [], loading: false, available: !missing });
      return;
    }
    setState({ items: Array.isArray(data) ? data : [], loading: false, available: true });
  }, [fromISO, toISO]);
  useEffect(() => {
    load();
    const onChange = () => load();
    window.addEventListener("navio:agenda", onChange);
    const timer = window.setInterval(() => document.visibilityState === "visible" && load(), 120000);
    return () => {
      window.removeEventListener("navio:agenda", onChange);
      window.clearInterval(timer);
    };
  }, [load]);
  return { ...state, reload: load };
}

/* ---------- Agendar (crear o editar) ---------- */
// initial: un evento de agenda_list (para editar) o datos para empezar uno
// nuevo: { kind, title, startsAt, channelId, attendees, attendeesFromChannel }.
export function AgendaEventForm({ initial = {}, onClose, onSaved }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const inbox = useInbox();
  const { people } = usePeople();
  const editing = !!initial.id;
  const seed = useMemo(() => {
    const now = new Date();
    const start = initial.seriesStartsAt ? new Date(initial.seriesStartsAt) : initial.startsAt ? new Date(initial.startsAt) : new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0);
    const endSource = initial.seriesEndsAt ?? (initial.id ? null : initial.endsAt);
    const end = endSource ? new Date(endSource) : new Date(start.getTime() + 60 * 60000);
    return { start, end, hadEnd: !!endSource || !initial.id };
    // Solo al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [title, setTitle] = useState(initial.title ?? "");
  const [kind, setKind] = useState(initial.kind ?? "meeting");
  const [date, setDate] = useState(dateInput(seed.start));
  const [startTime, setStartTime] = useState(timeInput(seed.start));
  const [hasEnd, setHasEnd] = useState(seed.hadEnd);
  const [endDate, setEndDate] = useState(dateInput(seed.end));
  const [endTime, setEndTime] = useState(timeInput(seed.end));
  const [allDay, setAllDay] = useState(!!initial.allDay);
  const [recurrence, setRecurrence] = useState(initial.recurrence ?? "none");
  const [until, setUntil] = useState(initial.recurUntil ? dateInput(new Date(initial.recurUntil)) : "");
  const [reminders, setReminders] = useState(Array.isArray(initial.reminders) ? initial.reminders : [10]);
  const [attendees, setAttendees] = useState(() => (Array.isArray(initial.attendees) ? initial.attendees.map((a) => (typeof a === "string" ? a : a.userId)) : []));
  const [visibility, setVisibility] = useState(initial.visibility ?? "participants");
  const [location, setLocation] = useState(initial.location ?? "");
  const [channelId, setChannelId] = useState(initial.channelId ? String(initial.channelId) : "");
  const [taskId, setTaskId] = useState(initial.taskId ? String(initial.taskId) : "");
  const [priority, setPriority] = useState(initial.priority ?? "normal");
  const [color, setColor] = useState(initial.color ?? "blue");
  const [description, setDescription] = useState(initial.description ?? "");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Desde un chat de grupo: se proponen sus participantes.
  useEffect(() => {
    if (!initial.attendeesFromChannel || !initial.channelId) return;
    let alive = true;
    supabase.rpc("channel_people", { target_channel: initial.channelId }).then(({ data }) => {
      if (!alive || !Array.isArray(data)) return;
      setAttendees((prev) => [...new Set([...prev, ...data.map((p) => p.userId).filter((id) => id !== user?.id)])].slice(0, 50));
    });
    return () => {
      alive = false;
    };
  }, [initial.attendeesFromChannel, initial.channelId, user?.id]);

  const others = people.filter((p) => p.id !== user?.id);
  const term = query.trim().toLowerCase();
  const found = term ? others.filter((p) => personName(p).toLowerCase().includes(term) && !attendees.includes(p.id)).slice(0, 8) : [];
  const chosen = attendees.map((id) => others.find((p) => p.id === id) ?? { id, fullName: "Persona" });
  const channels = inbox?.channels ?? [];
  const tasks = (inbox?.tasks ?? []).filter((t) => ["open", "in_progress", "review"].includes(t.status) || String(t.id) === taskId);

  function toggleReminder(min) {
    setReminders((prev) => (prev.includes(min) ? prev.filter((m) => m !== min) : prev.length >= 6 ? prev : [...prev, min].sort((a, b) => a - b)));
  }

  async function save(e) {
    e?.preventDefault();
    setError("");
    if (!title.trim()) return setError("Escribe un título.");
    const start = allDay ? new Date(`${date}T00:00`) : new Date(`${date}T${startTime || "09:00"}`);
    if (Number.isNaN(start.getTime())) return setError("Revisa la fecha.");
    let end = null;
    if (allDay) end = hasEnd && endDate > date ? new Date(`${endDate}T23:59`) : null;
    else if (hasEnd) end = new Date(`${endDate || date}T${endTime || startTime}`);
    if (end && end < start) return setError("La hora de fin debe ser después del inicio.");
    if (end && end - start > 31 * 864e5) return setError("Un evento puede durar hasta 31 días.");
    const recurUntil = recurrence !== "none" && until ? new Date(`${until}T23:59`) : null;
    if (recurUntil && recurUntil < start) return setError("La repetición debe terminar después del primer día.");
    setBusy(true);
    const payload = {
      id: initial.id ?? null,
      title: title.trim(),
      kind,
      description: description.trim(),
      startsAt: start.toISOString(),
      endsAt: end ? end.toISOString() : null,
      allDay,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Mexico_City",
      location: location.trim(),
      channelId: channelId ? Number(channelId) : null,
      taskId: taskId ? Number(taskId) : null,
      color,
      priority,
      recurrence,
      recurUntil: recurUntil ? recurUntil.toISOString() : null,
      reminders,
      visibility,
      attendees,
    };
    const { data, error: failure } = await supabase.rpc("agenda_save", { payload });
    setBusy(false);
    if (failure) {
      setError(/agenda_save|could not find/i.test(failure.message) ? "La agenda se activa al aplicar la actualización v32 de la base de datos." : failure.message);
      return;
    }
    showToast(editing ? "Evento actualizado." : attendees.length ? "Evento agendado. Ya se les avisó a los participantes." : "Evento agendado.");
    agendaChanged();
    onSaved?.(data);
    onClose();
  }

  const label = "mb-1 block text-[11px] font-semibold text-slate-500";
  const field = "h-9 w-full rounded-lg border border-slate-200 px-2.5 text-xs focus:border-blue-400 focus:outline-none";
  return (
    <Modal title={editing ? "Editar evento" : "Agendar"} width="max-w-2xl" onClose={busy ? () => {} : onClose}>
      <form onSubmit={save} className="space-y-4">
        <div>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="Título (ej. Revisión de bitácoras de la flota)"
            aria-label="Título"
            className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-semibold focus:border-blue-400 focus:outline-none"
          />
        </div>

        <div>
          <p className={label}>Tipo</p>
          <div className="flex flex-wrap gap-1.5">
            {AGENDA_KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                onClick={() => setKind(k.id)}
                aria-pressed={kind === k.id}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition ${kind === k.id ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
              >
                <k.icon size={12} /> {k.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {/* Cuándo */}
          <div className="space-y-2 rounded-xl border border-slate-200 p-3">
            <p className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
              <Clock size={13} /> Cuándo
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={label} htmlFor="ag-date">
                  Fecha
                </label>
                <input id="ag-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required className={field} />
              </div>
              {!allDay && (
                <div>
                  <label className={label} htmlFor="ag-start">
                    Hora
                  </label>
                  <input id="ag-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required className={field} />
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-600">
                <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="h-3.5 w-3.5 accent-blue-600" /> Todo el día
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-600">
                <input type="checkbox" checked={hasEnd} onChange={(e) => setHasEnd(e.target.checked)} className="h-3.5 w-3.5 accent-blue-600" /> {allDay ? "Dura varios días" : "Hora de fin"}
              </label>
            </div>
            {hasEnd && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={label} htmlFor="ag-end-date">
                    Termina
                  </label>
                  <input id="ag-end-date" type="date" value={endDate} min={date} onChange={(e) => setEndDate(e.target.value)} className={field} />
                </div>
                {!allDay && (
                  <div>
                    <label className={label} htmlFor="ag-end">
                      Hora de fin
                    </label>
                    <input id="ag-end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={field} />
                  </div>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={label} htmlFor="ag-repeat">
                  Repetir
                </label>
                <select id="ag-repeat" value={recurrence} onChange={(e) => setRecurrence(e.target.value)} className={field}>
                  {RECURRENCES.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
              {recurrence !== "none" && (
                <div>
                  <label className={label} htmlFor="ag-until">
                    Hasta (opcional)
                  </label>
                  <input id="ag-until" type="date" value={until} min={date} onChange={(e) => setUntil(e.target.value)} className={field} />
                </div>
              )}
            </div>
            {editing && initial.recurrence && initial.recurrence !== "none" && <p className="text-[10px] text-slate-400">Los cambios aplican a todas las repeticiones.</p>}
          </div>

          {/* Avisos */}
          <div className="space-y-2 rounded-xl border border-slate-200 p-3">
            <p className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
              <Bell size={13} /> Avisarme antes
            </p>
            <div className="flex flex-wrap gap-1.5">
              {REMINDERS.map((r) => {
                const on = reminders.includes(r.min);
                return (
                  <button
                    key={r.min}
                    type="button"
                    onClick={() => toggleReminder(r.min)}
                    aria-pressed={on}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${on ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}
                  >
                    {on && <Check size={10} className="mr-0.5 inline" />}
                    {r.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-slate-400">Hasta 6 avisos. Llegan como notificación a quien lo crea y a los participantes (menos a quien dijo que no asistirá).</p>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div>
                <label className={label} htmlFor="ag-priority">
                  Prioridad
                </label>
                <select id="ag-priority" value={priority} onChange={(e) => setPriority(e.target.value)} className={field}>
                  {PRIORITIES.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <p className={label}>Color</p>
                <div className="flex h-9 items-center gap-1.5">
                  {Object.keys(COLORS).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      aria-label={`Color ${c}`}
                      aria-pressed={color === c}
                      className={`h-5 w-5 rounded-full ${COLORS[c].dot} ${color === c ? `ring-2 ring-offset-2 ${COLORS[c].ring}` : ""}`}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Participantes */}
        <div className="space-y-2 rounded-xl border border-slate-200 p-3">
          <p className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
            <Users size={13} /> Participantes <span className="font-normal text-slate-400">({attendees.length})</span>
          </p>
          {chosen.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {chosen.map((p) => (
                <span key={p.id} className="flex items-center gap-1.5 rounded-full bg-slate-100 py-0.5 pl-0.5 pr-2 text-[11px] font-medium text-slate-700">
                  <img src={avatarUrl(personName(p))} alt="" className="h-5 w-5 rounded-full" />
                  {personName(p)}
                  <button type="button" onClick={() => setAttendees((prev) => prev.filter((x) => x !== p.id))} aria-label={`Quitar a ${personName(p)}`} className="text-slate-400 hover:text-slate-600">
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="relative">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Agregar persona por nombre" aria-label="Buscar persona" className={field} />
            {found.length > 0 && (
              <div className="absolute inset-x-0 top-10 z-10 max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
                {found.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setAttendees((prev) => [...prev, p.id].slice(0, 50));
                      setQuery("");
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-slate-50"
                  >
                    <img src={avatarUrl(personName(p))} alt="" className="h-6 w-6 rounded-full" />
                    {personName(p)}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-600">
              <input type="radio" name="ag-visibility" checked={visibility === "participants"} onChange={() => setVisibility("participants")} className="accent-blue-600" />
              <Lock size={11} /> Solo lo ven los participantes
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-600">
              <input type="radio" name="ag-visibility" checked={visibility === "company"} onChange={() => setVisibility("company")} className="accent-blue-600" />
              <Eye size={11} /> Lo ve toda la empresa
            </label>
          </div>
        </div>

        {/* Dónde y con qué se relaciona */}
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label className={label} htmlFor="ag-location">
              Lugar o enlace
            </label>
            <input id="ag-location" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={300} placeholder="Ej. Patio 2 o https://…" className={field} />
          </div>
          <div>
            <label className={label} htmlFor="ag-chat">
              Chat (para unirse a la llamada)
            </label>
            <select id="ag-chat" value={channelId} onChange={(e) => setChannelId(e.target.value)} className={field}>
              <option value="">Ninguno</option>
              {channels.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {chatName(c)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="ag-task">
              Tarea relacionada
            </label>
            <select id="ag-task" value={taskId} onChange={(e) => setTaskId(e.target.value)} className={field}>
              <option value="">Ninguna</option>
              {tasks.map((t) => (
                <option key={t.id} value={String(t.id)}>
                  {t.title}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className={label} htmlFor="ag-notes">
            Notas
          </label>
          <textarea
            id="ag-notes"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={4000}
            placeholder="Temas a revisar, qué traer, pasos a verificar…"
            className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-blue-400 focus:outline-none"
          />
        </div>

        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg px-3 py-2 text-xs font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-50">
            Cancelar
          </button>
          <button type="submit" disabled={busy} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
            <CalendarPlus size={14} /> {busy ? "Guardando…" : editing ? "Guardar cambios" : "Agendar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- Ver un evento ---------- */
export function AgendaEventDetail({ item, onClose, onEdit }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const inbox = useInbox();
  const calls = useCalls();
  const [busy, setBusy] = useState("");
  const kind = kindOf(item.kind);
  const color = colorOf(item.color);
  const channel = item.channelId ? (inbox?.channels ?? []).find((c) => Number(c.id) === Number(item.channelId)) : null;
  const task = item.taskId ? (inbox?.tasks ?? []).find((t) => Number(t.id) === Number(item.taskId)) : null;
  const [answer, setAnswer] = useState(item.myResponse ?? null);
  const mine = answer;
  // Mi respuesta se ve al momento (sin esperar a que se recargue la agenda).
  const attendees = (Array.isArray(item.attendees) ? item.attendees : []).map((a) => (a.userId === user?.id && answer ? { ...a, response: answer } : a));
  const repeat = recurrenceLabel(item.recurrence);
  const start = new Date(item.startsAt);

  async function run(label, fn, done) {
    setBusy(label);
    const { error } = await fn();
    setBusy("");
    if (error) {
      showToast(error.message);
      return false;
    }
    if (done) showToast(done);
    agendaChanged();
    return true;
  }
  const respond = async (value) => {
    const ok = await run("respond", () => supabase.rpc("agenda_respond", { target_event: item.id, answer: value }), value === "accepted" ? "Confirmaste que asistirás." : value === "declined" ? "Avisaste que no asistirás." : "Respondiste que tal vez.");
    if (ok) setAnswer(value);
  };
  const setStatus = (status, text) => run("status", () => supabase.rpc("agenda_set_status", { target_event: item.id, new_status: status }), text).then(onClose);
  async function remove() {
    if (!window.confirm(`¿Borrar "${item.title}"${repeat ? " y todas sus repeticiones" : ""}? No se puede deshacer.`)) return;
    await run("delete", () => supabase.rpc("agenda_delete", { target_event: item.id }), "Evento borrado.");
    onClose();
  }

  return (
    <Modal title={kind.label} width="max-w-lg" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <span className={`mt-1 h-10 w-1.5 shrink-0 rounded-full ${color.dot}`} />
          <div className="min-w-0 flex-1">
            <p className={`text-base font-bold text-slate-900 ${item.status === "cancelled" ? "line-through opacity-60" : ""}`}>{item.title}</p>
            <p className="mt-0.5 text-xs text-slate-500">
              {dayTitle(start)} · {timeRange(item)}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {item.status === "cancelled" && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">Cancelado</span>}
              {item.status === "done" && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Hecho</span>}
              {repeat && (
                <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                  <Repeat size={10} /> {repeat}
                </span>
              )}
              {item.priority === "high" && (
                <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                  <Flag size={10} /> Prioridad alta
                </span>
              )}
              <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                {item.visibility === "company" ? <Eye size={10} /> : <Lock size={10} />}
                {item.visibility === "company" ? "Toda la empresa" : "Solo participantes"}
              </span>
            </div>
          </div>
        </div>

        {(item.location || channel || task) && (
          <div className="space-y-1.5 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
            {item.location && (
              <p className="flex items-start gap-2">
                <MapPin size={13} className="mt-0.5 shrink-0 text-slate-400" />
                {isLink(item.location) ? (
                  <a href={item.location.trim()} target="_blank" rel="noopener noreferrer" className="break-all font-medium text-blue-600 hover:underline">
                    {item.location}
                  </a>
                ) : (
                  <span>{item.location}</span>
                )}
              </p>
            )}
            {channel && (
              <p className="flex items-center gap-2">
                <MessageSquare size={13} className="shrink-0 text-slate-400" /> Chat: <b className="font-semibold">{chatName(channel)}</b>
              </p>
            )}
            {task && (
              <p className="flex items-center gap-2">
                <ListTodo size={13} className="shrink-0 text-slate-400" /> Tarea: <b className="font-semibold">{task.title}</b>
              </p>
            )}
          </div>
        )}

        {item.description && <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-600">{item.description}</p>}

        <div>
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">Participantes</p>
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs">
              <img src={avatarUrl(item.createdByName || "Navio")} alt="" className="h-6 w-6 rounded-full" />
              <span className="min-w-0 flex-1 truncate text-slate-700">{item.createdByName || "Quien lo creó"}</span>
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">Organiza</span>
            </div>
            {attendees.map((a) => (
              <div key={a.userId} className="flex items-center gap-2 text-xs">
                <img src={avatarUrl(a.name || "Persona")} alt="" className="h-6 w-6 rounded-full" />
                <span className="min-w-0 flex-1 truncate text-slate-700">
                  {a.name || "Persona"}
                  {a.userId === user?.id ? " (tú)" : ""}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${(RESPONSES[a.response] ?? RESPONSES.pending).className}`}>{(RESPONSES[a.response] ?? RESPONSES.pending).label}</span>
              </div>
            ))}
            {attendees.length === 0 && <p className="text-[11px] text-slate-400">Sin más participantes.</p>}
          </div>
        </div>

        {mine && item.status === "scheduled" && (
          <div className="rounded-xl border border-slate-200 p-3">
            <p className="mb-2 text-xs font-semibold text-slate-700">¿Vas a asistir?</p>
            <div className="flex flex-wrap gap-1.5">
              {[
                { id: "accepted", label: "Asistiré", icon: CheckCircle2 },
                { id: "tentative", label: "Tal vez", icon: HelpCircle },
                { id: "declined", label: "No asistiré", icon: XCircle },
              ].map((o) => (
                <button
                  key={o.id}
                  type="button"
                  disabled={!!busy}
                  onClick={() => respond(o.id)}
                  aria-pressed={mine === o.id}
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-60 ${mine === o.id ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                >
                  <o.icon size={13} /> {o.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
          {channel && calls?.available && channel.kind !== "general" && item.status === "scheduled" && (
            <button type="button" onClick={() => calls.start(channel, "video")} className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">
              <Video size={13} /> Unirse a la llamada
            </button>
          )}
          {channel && (
            <button
              type="button"
              onClick={() => {
                onClose();
                openInNavio(`/?open=messages&sub=channel:${channel.id}`);
              }}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              <MessageSquare size={13} /> Abrir chat
            </button>
          )}
          {item.canEdit && (
            <>
              <button type="button" onClick={() => onEdit(item)} className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                <Edit2 size={12} /> Editar
              </button>
              {item.status === "scheduled" && item.recurrence === "none" && (
                <button type="button" disabled={!!busy} onClick={() => setStatus("done", "Marcado como hecho.")} className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60">
                  <CheckCircle2 size={12} /> Marcar como hecho
                </button>
              )}
              {item.status === "scheduled" ? (
                <button type="button" disabled={!!busy} onClick={() => setStatus("cancelled", "Evento cancelado. Se avisó a los participantes.")} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50 disabled:opacity-60">
                  Cancelar evento
                </button>
              ) : (
                <button type="button" disabled={!!busy} onClick={() => setStatus("scheduled", "El evento vuelve a estar programado.")} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60">
                  Volver a programar
                </button>
              )}
              <button type="button" disabled={!!busy} onClick={remove} aria-label="Borrar evento" title="Borrar evento" className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-rose-500 hover:bg-rose-50 disabled:opacity-60">
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

/* ---------- Un renglón de la agenda ---------- */
function AgendaRow({ item, onOpen, showDay = false }) {
  const kind = kindOf(item.kind);
  const color = colorOf(item.color);
  const start = new Date(item.startsAt);
  const response = item.myResponse ? RESPONSES[item.myResponse] : null;
  const people = Array.isArray(item.attendees) ? item.attendees.length : 0;
  return (
    <button type="button" onClick={() => onOpen(item)} className="flex w-full items-stretch gap-3 rounded-xl border border-slate-200 bg-white p-2.5 text-left shadow-sm transition hover:border-slate-300 hover:shadow">
      <div className="w-16 shrink-0 text-right">
        <p className="text-xs font-bold text-slate-700">{item.allDay ? "Todo el día" : hourLabel(start)}</p>
        {showDay && <p className="text-[10px] text-slate-400">{start.toLocaleDateString("es-MX", { day: "numeric", month: "short" })}</p>}
        {!item.allDay && item.endsAt && <p className="text-[10px] text-slate-400">{hourLabel(new Date(item.endsAt))}</p>}
      </div>
      <span className={`w-1 shrink-0 rounded-full ${color.dot}`} />
      <div className="min-w-0 flex-1">
        <p className={`flex items-center gap-1.5 text-xs font-semibold text-slate-800 ${item.status === "cancelled" ? "line-through opacity-60" : ""}`}>
          <kind.icon size={12} className="shrink-0 text-slate-400" />
          <span className="truncate">{item.title}</span>
          {item.priority === "high" && <Flag size={11} className="shrink-0 text-amber-500" />}
          {item.recurrence !== "none" && <Repeat size={11} className="shrink-0 text-slate-400" />}
        </p>
        <p className="mt-0.5 truncate text-[11px] text-slate-500">
          {kind.label}
          {item.location ? ` · ${item.location}` : ""}
          {people ? ` · ${people + 1} personas` : ""}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end justify-center gap-1">
        {item.status === "done" && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Hecho</span>}
        {item.status === "cancelled" && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">Cancelado</span>}
        {response && item.status === "scheduled" && <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${response.className}`}>{response.label}</span>}
      </div>
    </button>
  );
}

/* ---------- La agenda completa (en Tareas) ---------- */
export function AgendaView({ compact = false, switcher = null }) {
  const [mode, setMode] = useState("upcoming"); // upcoming | month
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selectedDay, setSelectedDay] = useState(() => dateInput(new Date()));
  const [showCancelled, setShowCancelled] = useState(false);
  const [form, setForm] = useState(null);
  const [detail, setDetail] = useState(null);

  // Rango a pedir: próximos 60 días, o las 6 semanas que se ven del mes.
  const gridStart = useMemo(() => {
    const first = new Date(month);
    const offset = (first.getDay() + 6) % 7; // lunes = 0
    return addDays(first, -offset);
  }, [month]);
  const todayKey = dateInput(new Date());
  const range = useMemo(() => {
    if (mode === "month") return { from: gridStart.toISOString(), to: addDays(gridStart, 42).toISOString() };
    const today = new Date(`${todayKey}T00:00`);
    return { from: today.toISOString(), to: addDays(today, 60).toISOString() };
  }, [mode, gridStart, todayKey]);
  const { items, loading, available } = useAgendaRange(range.from, range.to);
  const shown = items.filter((i) => showCancelled || i.status !== "cancelled");

  const byDay = useMemo(() => {
    const map = new Map();
    for (const item of shown) {
      const key = dateInput(new Date(item.startsAt));
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return map;
  }, [shown]);

  const header = (
    <div className="flex flex-wrap items-center gap-2">
      {switcher}
      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
        {[
          { id: "upcoming", label: "Próximos" },
          { id: "month", label: "Mes" },
        ].map((m) => (
          <button key={m.id} type="button" onClick={() => setMode(m.id)} className={`rounded-md px-3 py-1 text-xs font-semibold transition ${mode === m.id ? "bg-slate-800 text-white" : "text-slate-500 hover:bg-slate-50"}`}>
            {m.label}
          </button>
        ))}
      </div>
      <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-500">
        <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} className="h-3.5 w-3.5 accent-blue-600" /> Ver cancelados
      </label>
      <button type="button" onClick={() => setForm({})} className="ml-auto flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700">
        <CalendarPlus size={15} /> Agendar
      </button>
    </div>
  );

  let body;
  if (!available) {
    body = <p className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-xs text-slate-400">La agenda se activa al aplicar la actualización v32 de la base de datos.</p>;
  } else if (mode === "upcoming") {
    const days = [...byDay.keys()].sort();
    body = (
      <div className="space-y-4">
        {loading && <p className="py-8 text-center text-xs text-slate-400">Cargando agenda…</p>}
        {!loading && days.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center">
            <CalendarClock size={28} className="mx-auto text-slate-300" />
            <p className="mt-2 text-sm font-semibold text-slate-600">Nada agendado en los próximos 60 días</p>
            <p className="mt-1 text-xs text-slate-400">Agenda reuniones, revisiones de procesos, visitas o recordatorios. Te avisamos antes de cada uno.</p>
          </div>
        )}
        {days.map((key) => (
          <section key={key}>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">{dayTitle(new Date(`${key}T00:00`))}</p>
            <div className="space-y-1.5">
              {byDay.get(key).map((item) => (
                <AgendaRow key={`${item.id}-${item.startsAt}`} item={item} onOpen={setDetail} />
              ))}
            </div>
          </section>
        ))}
      </div>
    );
  } else {
    const weekdays = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
    const dayItems = byDay.get(selectedDay) ?? [];
    body = (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Mes anterior" className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50">
            <ChevronLeft size={15} />
          </button>
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold text-slate-800">{(() => {
              const text = month.toLocaleDateString("es-MX", { month: "long", year: "numeric" });
              return text.charAt(0).toUpperCase() + text.slice(1);
            })()}</p>
            <button
              type="button"
              onClick={() => {
                const d = new Date();
                setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
                setSelectedDay(dateInput(d));
              }}
              className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-500 hover:bg-slate-50"
            >
              Hoy
            </button>
          </div>
          <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Mes siguiente" className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50">
            <ChevronRight size={15} />
          </button>
        </div>
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50">
            {weekdays.map((w) => (
              <p key={w} className="py-1.5 text-center text-[10px] font-bold uppercase text-slate-400">
                {w}
              </p>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {Array.from({ length: 42 }, (_, i) => {
              const day = addDays(gridStart, i);
              const key = dateInput(day);
              const list = byDay.get(key) ?? [];
              const inMonth = day.getMonth() === month.getMonth();
              const isToday = key === todayKey;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedDay(key)}
                  onDoubleClick={() => setForm({ startsAt: new Date(`${key}T09:00`).toISOString() })}
                  className={`flex min-h-[64px] flex-col items-stretch gap-0.5 border-b border-r border-slate-100 p-1 text-left transition sm:min-h-[84px] ${selectedDay === key ? "bg-blue-50" : "hover:bg-slate-50"} ${inMonth ? "" : "opacity-40"}`}
                >
                  <span className={`flex h-5 w-5 items-center justify-center self-end rounded-full text-[10px] font-bold ${isToday ? "bg-blue-600 text-white" : "text-slate-500"}`}>{day.getDate()}</span>
                  {list.slice(0, compact ? 2 : 3).map((item) => (
                    <span key={`${item.id}-${item.startsAt}`} className={`truncate rounded border px-1 text-[9px] font-semibold sm:text-[10px] ${colorOf(item.color).soft} ${item.status === "cancelled" ? "line-through opacity-60" : ""}`}>
                      {!item.allDay && <span className="hidden sm:inline">{hourLabel(new Date(item.startsAt))} </span>}
                      {item.title}
                    </span>
                  ))}
                  {list.length > (compact ? 2 : 3) && <span className="text-[9px] font-semibold text-slate-400">+{list.length - (compact ? 2 : 3)} más</span>}
                </button>
              );
            })}
          </div>
        </div>
        <section>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{dayTitle(new Date(`${selectedDay}T00:00`))}</p>
            <button type="button" onClick={() => setForm({ startsAt: new Date(`${selectedDay}T09:00`).toISOString() })} className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:underline">
              <Plus size={12} /> Agendar este día
            </button>
          </div>
          <div className="space-y-1.5">
            {dayItems.map((item) => (
              <AgendaRow key={`${item.id}-${item.startsAt}`} item={item} onOpen={setDetail} />
            ))}
            {dayItems.length === 0 && <p className="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-4 text-center text-[11px] text-slate-400">Nada agendado este día.</p>}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className={compact ? "space-y-4 p-4 pb-24" : "space-y-4"}>
      {compact && <h1 className="text-xl font-bold text-slate-900">Agenda</h1>}
      {header}
      {body}
      {form && <AgendaEventForm initial={form} onClose={() => setForm(null)} />}
      {detail && (
        <AgendaEventDetail
          item={detail}
          onClose={() => setDetail(null)}
          onEdit={(item) => {
            setDetail(null);
            setForm(item);
          }}
        />
      )}
    </div>
  );
}

/* ---------- Debajo de los chats: lo que viene ---------- */
const UPCOMING_KEY = "navio.agenda.upcoming";

export function UpcomingAgenda() {
  const [open, setOpen] = useState(() => {
    try {
      return window.localStorage.getItem(UPCOMING_KEY) !== "closed";
    } catch {
      return true;
    }
  });
  const [form, setForm] = useState(null);
  const [detail, setDetail] = useState(null);
  const [, tick] = useState(0);
  const todayKey = dateInput(new Date());
  const range = useMemo(() => {
    const today = new Date(`${todayKey}T00:00`);
    return { from: today.toISOString(), to: addDays(today, 8).toISOString() };
  }, [todayKey]);
  const { items, available } = useAgendaRange(range.from, range.to);
  // Los "en 25 min" se actualizan solos.
  useEffect(() => {
    const timer = window.setInterval(() => tick((n) => n + 1), 30000);
    return () => window.clearInterval(timer);
  }, []);
  if (!available) return null;
  const now = Date.now();
  const next = items
    .filter((i) => i.status === "scheduled" && (i.endsAt ? Date.parse(i.endsAt) : Date.parse(i.startsAt) + 30 * 60000) > now && i.myResponse !== "declined")
    .slice(0, 4);
  const toggle = () =>
    setOpen((v) => {
      try {
        window.localStorage.setItem(UPCOMING_KEY, v ? "closed" : "open");
      } catch {
        // Solo es comodidad.
      }
      return !v;
    });

  return (
    <div className="shrink-0 border-t border-slate-100 bg-white">
      <div className="flex items-center gap-1 px-3 py-2">
        <button type="button" onClick={toggle} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          <CalendarClock size={14} className="shrink-0 text-blue-600" />
          <span className="truncate text-xs font-bold text-slate-700">Próximo en tu agenda</span>
          {next.length > 0 && <span className="rounded-full bg-blue-50 px-1.5 text-[10px] font-bold text-blue-700">{next.length}</span>}
          <ChevronDown size={13} className={`shrink-0 text-slate-400 transition ${open ? "" : "-rotate-90"}`} />
        </button>
        <button type="button" onClick={() => setForm({})} aria-label="Agendar" title="Agendar" className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100">
          <CalendarPlus size={14} />
        </button>
      </div>
      {open && (
        <div className="max-h-56 space-y-1 overflow-y-auto px-2 pb-2">
          {next.map((item) => {
            const when = whenLabel(item, now);
            const soon = when === "Ahora" || when.startsWith("En ");
            return (
              <button key={`${item.id}-${item.startsAt}`} type="button" onClick={() => setDetail(item)} className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left hover:bg-slate-50">
                <span className={`h-8 w-1 shrink-0 rounded-full ${colorOf(item.color).dot}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-semibold text-slate-700">{item.title}</span>
                  <span className={`block truncate text-[10px] ${soon ? "font-semibold text-blue-600" : "text-slate-400"}`}>
                    {when}
                    {item.location ? ` · ${item.location}` : ""}
                  </span>
                </span>
              </button>
            );
          })}
          {next.length === 0 && <p className="px-2 py-1.5 text-[11px] text-slate-400">Nada en los próximos días.</p>}
          <button type="button" onClick={() => openInNavio("/?open=tasks&sub=agenda")} className="w-full rounded-lg px-2 py-1 text-left text-[11px] font-semibold text-blue-600 hover:bg-blue-50">
            Ver toda la agenda
          </button>
        </div>
      )}
      {form && <AgendaEventForm initial={form} onClose={() => setForm(null)} />}
      {detail && (
        <AgendaEventDetail
          item={detail}
          onClose={() => setDetail(null)}
          onEdit={(item) => {
            setDetail(null);
            setForm(item);
          }}
        />
      )}
    </div>
  );
}
