import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

/* ---------- Piezas del formulario: lista desplegable y calendario ---------- */

// Ventanita que sale debajo (o arriba) de un botón. Va en document.body para
// que no la recorte la ventana con desplazamiento.
function Popover({ anchorRef, open, onClose, width = 260, cap = 340, scroll = false, children }) {
  const boxRef = useRef(null);
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const a = anchorRef.current?.getBoundingClientRect();
      if (!a) return;
      const w = Math.min(Math.max(width, a.width), window.innerWidth - 16);
      const left = Math.min(Math.max(8, a.left), window.innerWidth - w - 8);
      const below = window.innerHeight - a.bottom - 8;
      const above = a.top - 8;
      const maxHeight = Math.max(160, Math.min(cap, below >= 220 || below >= above ? below : above));
      const top = below >= 220 || below >= above ? a.bottom + 4 : Math.max(8, a.top - 4 - Math.min(maxHeight, boxRef.current?.offsetHeight ?? maxHeight));
      setPos({ left, top, width: w, maxHeight });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchorRef, width, cap]);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (boxRef.current?.contains(e.target) || anchorRef.current?.contains(e.target)) return;
      onClose();
    };
    const onKey = (e) => e.key === "Escape" && (e.stopPropagation(), onClose());
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose, anchorRef]);
  if (!open) return null;
  return createPortal(
    <div
      ref={boxRef}
      style={pos ? { left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxHeight } : { left: -9999, top: 0 }}
      className={`fixed z-[3200] flex flex-col rounded-xl border border-slate-200 bg-white text-slate-700 shadow-2xl ${scroll ? "overflow-y-auto overscroll-contain" : "overflow-hidden"}`}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body
  );
}

// Lista desplegable. options: [{ value, label, hint?, icon?, swatch?, avatar? }].
// multiple: value es una lista y la ventanita se queda abierta.
function Dropdown({ label, value, options, onChange, multiple = false, searchable = false, placeholder = "Elegir", icon: Icon = null, max = Infinity, display = null, width = 260, footer = null, id }) {
  const tall = !!footer; // con calendario abajo, la ventanita es más alta
  const anchorRef = useRef(null);
  const listRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);
  const selected = multiple ? (Array.isArray(value) ? value : []) : value;
  const isOn = (v) => (multiple ? selected.includes(v) : selected === v);
  const term = query.trim().toLowerCase();
  const shown = term ? options.filter((o) => String(o.label).toLowerCase().includes(term)) : options;
  const current = multiple ? options.filter((o) => selected.includes(o.value)) : options.find((o) => o.value === selected);
  const text =
    display ??
    (multiple
      ? current.length === 0
        ? placeholder
        : current.length <= 2
          ? current.map((o) => o.short ?? o.label).join(", ")
          : `${current
              .slice(0, 2)
              .map((o) => o.short ?? o.label)
              .join(", ")} +${current.length - 2}`
      : current?.label ?? placeholder);
  const lead = !multiple && current ? current : null;

  // Al abrir, la opción elegida queda a la vista.
  useEffect(() => {
    if (!open) return;
    const index = Math.max(0, shown.findIndex((o) => isOn(o.value)));
    setActive(index);
    window.requestAnimationFrame(() => listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "center" }));
    if (!searchable) listRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function pick(option) {
    if (!option || option.disabled) return;
    if (multiple) {
      const on = selected.includes(option.value);
      if (!on && selected.length >= max) return;
      onChange(on ? selected.filter((v) => v !== option.value) : [...selected, option.value]);
    } else {
      onChange(option.value);
      close();
      anchorRef.current?.focus();
    }
  }
  function onKeyDown(e) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.min(shown.length - 1, Math.max(0, active + (e.key === "ArrowDown" ? 1 : -1)));
      setActive(next);
      listRef.current?.querySelector(`[data-index="${next}"]`)?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(shown[active]);
    }
  }

  return (
    <div className="min-w-0">
      {label && (
        <label htmlFor={id} className="mb-1 block text-[11px] font-semibold text-slate-500">
          {label}
        </label>
      )}
      <button
        ref={anchorRef}
        id={id}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex h-9 w-full items-center gap-2 rounded-lg border bg-white px-2.5 text-left text-xs transition ${open ? "border-blue-400 ring-2 ring-blue-100" : "border-slate-200 hover:border-slate-300"}`}
      >
        {Icon && <Icon size={13} className="shrink-0 text-slate-400" />}
        {lead?.swatch && <span className={`h-3 w-3 shrink-0 rounded-full ${lead.swatch}`} />}
        {lead?.icon && <lead.icon size={13} className="shrink-0 text-slate-500" />}
        <span className={`min-w-0 flex-1 truncate ${(multiple ? current.length : current) ? "text-slate-700" : "text-slate-400"}`}>{text}</span>
        <ChevronDown size={13} className={`shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} />
      </button>
      <Popover anchorRef={anchorRef} open={open} onClose={close} width={width} cap={tall ? 520 : 340} scroll={tall}>
        {searchable && (
          <div className="border-b border-slate-100 p-1.5">
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              placeholder="Buscar"
              aria-label={`Buscar en ${label ?? "la lista"}`}
              className="h-8 w-full rounded-lg border border-slate-200 px-2.5 text-xs focus:border-blue-400 focus:outline-none"
            />
          </div>
        )}
        <div ref={listRef} role="listbox" aria-multiselectable={multiple || undefined} tabIndex={-1} onKeyDown={onKeyDown} className={`${tall ? "shrink-0" : "min-h-0 flex-1 overflow-y-auto"} p-1 focus:outline-none`}>
          {shown.map((o, i) => {
            const on = isOn(o.value);
            const blocked = multiple && !on && selected.length >= max;
            return (
              <button
                key={String(o.value)}
                type="button"
                role="option"
                aria-selected={on}
                data-index={i}
                disabled={o.disabled || blocked}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o)}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition disabled:opacity-40 ${i === active ? "bg-slate-100" : ""} ${on ? "font-semibold text-blue-700" : "text-slate-700"}`}
              >
                {multiple && (
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300"}`}>{on && <Check size={11} />}</span>
                )}
                {o.avatar && <img src={o.avatar} alt="" className="h-6 w-6 shrink-0 rounded-full" />}
                {o.swatch && <span className={`h-3.5 w-3.5 shrink-0 rounded-full ${o.swatch}`} />}
                {o.icon && <o.icon size={14} className="shrink-0 text-slate-500" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{o.label}</span>
                  {o.hint && <span className="block truncate text-[10px] font-normal text-slate-400">{o.hint}</span>}
                </span>
                {!multiple && on && <Check size={13} className="shrink-0 text-blue-600" />}
              </button>
            );
          })}
          {shown.length === 0 && <p className="px-2 py-3 text-center text-[11px] text-slate-400">Sin resultados.</p>}
        </div>
        {footer && <div className="shrink-0 border-t border-slate-100 p-1.5">{footer(close)}</div>}
      </Popover>
    </div>
  );
}

// Calendario de un mes. value y rangeEnd: "AAAA-MM-DD". marks: días con algo.
function MiniCalendar({ value, onChange, month, onMonth, rangeEnd = null, marks = null, min = null, compact = false }) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = addDays(first, -((first.getDay() + 6) % 7));
  const today = dateInput(new Date());
  const title = month.toLocaleDateString("es-MX", { month: "long", year: "numeric" });
  return (
    <div className="select-none">
      <div className="mb-1.5 flex items-center justify-between">
        <button type="button" onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Mes anterior" className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100">
          <ChevronLeft size={15} />
        </button>
        <p className="text-xs font-bold text-slate-700">{title.charAt(0).toUpperCase() + title.slice(1)}</p>
        <button type="button" onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Mes siguiente" className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100">
          <ChevronRight size={15} />
        </button>
      </div>
      <div className="grid grid-cols-7 text-center text-[10px] font-bold uppercase text-slate-400">
        {["L", "M", "M", "J", "V", "S", "D"].map((d, i) => (
          <span key={i} className="py-1">
            {d}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {Array.from({ length: 42 }, (_, i) => {
          const day = addDays(start, i);
          const key = dateInput(day);
          const inMonth = day.getMonth() === month.getMonth();
          const chosen = key === value;
          const inRange = rangeEnd && key > value && key <= rangeEnd;
          const blocked = min && key < min;
          return (
            <button
              key={key}
              type="button"
              disabled={!!blocked}
              onClick={() => onChange(key)}
              aria-label={day.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" })}
              aria-pressed={chosen}
              className={`relative mx-auto flex ${compact ? "h-7 w-7" : "h-8 w-8"} items-center justify-center rounded-full text-[11px] transition disabled:cursor-not-allowed disabled:opacity-30 ${
                chosen ? "bg-blue-600 font-bold text-white shadow" : inRange ? "bg-blue-100 font-semibold text-blue-700" : key === today ? "font-bold text-blue-600 ring-1 ring-blue-300" : inMonth ? "text-slate-700 hover:bg-slate-100" : "text-slate-300 hover:bg-slate-50"
              }`}
            >
              {day.getDate()}
              {marks?.has(key) && !chosen && <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-blue-500" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const pretty = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240, 480];
const durationText = (min) => (min < 60 ? `${min} min` : min % 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min / 60} h`);
const TIME_OPTIONS = Array.from({ length: 96 }, (_, i) => `${pad(Math.floor(i / 4))}:${pad((i % 4) * 15)}`);
const timeText = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return hourLabel(new Date(2000, 0, 1, h, m));
};
const KIND_COLOR = { meeting: "blue", review: "violet", task: "emerald", reminder: "amber", visit: "sky", call: "blue", other: "slate" };
const COLOR_NAMES = { blue: "Azul", violet: "Violeta", emerald: "Verde", amber: "Ámbar", rose: "Rosa", sky: "Celeste", slate: "Gris" };

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
    const endSource = initial.id ? initial.seriesEndsAt : initial.endsAt;
    const end = endSource ? new Date(endSource) : null;
    const days = initial.allDay && end ? Math.max(1, Math.round((startOfDay(end) - startOfDay(start)) / 864e5) + 1) : 1;
    const duration = end ? Math.max(5, Math.round((end - start) / 60000)) : initial.id ? null : 60;
    return { start, days, duration };
    // Solo al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [title, setTitle] = useState(initial.title ?? "");
  const [kind, setKind] = useState(initial.kind ?? "meeting");
  const [date, setDate] = useState(dateInput(seed.start));
  const [month, setMonth] = useState(new Date(seed.start.getFullYear(), seed.start.getMonth(), 1));
  const [startTime, setStartTime] = useState(timeInput(seed.start));
  const [duration, setDuration] = useState(seed.duration);
  const [allDay, setAllDay] = useState(!!initial.allDay);
  const [days, setDays] = useState(seed.days);
  const [recurrence, setRecurrence] = useState(initial.recurrence ?? "none");
  const [until, setUntil] = useState(initial.recurUntil ? dateInput(new Date(initial.recurUntil)) : "");
  const [untilMonth, setUntilMonth] = useState(null);
  const [reminders, setReminders] = useState(Array.isArray(initial.reminders) ? initial.reminders : [10]);
  const [attendees, setAttendees] = useState(() => (Array.isArray(initial.attendees) ? initial.attendees.map((a) => (typeof a === "string" ? a : a.userId)) : []));
  const [visibility, setVisibility] = useState(initial.visibility ?? "participants");
  const [location, setLocation] = useState(initial.location ?? "");
  const [channelId, setChannelId] = useState(initial.channelId ? String(initial.channelId) : "");
  const [taskId, setTaskId] = useState(initial.taskId ? String(initial.taskId) : "");
  const [priority, setPriority] = useState(initial.priority ?? "normal");
  const [color, setColor] = useState(initial.color ?? KIND_COLOR[initial.kind ?? "meeting"] ?? "blue");
  const [colorTouched, setColorTouched] = useState(!!initial.color);
  const [description, setDescription] = useState(initial.description ?? "");
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

  // Lo que ya hay agendado en el mes que se ve (puntitos en el calendario).
  const monthRange = useMemo(() => {
    const from = addDays(month, -7);
    return { from: from.toISOString(), to: addDays(month, 45).toISOString() };
  }, [month]);
  const { items: monthItems } = useAgendaRange(monthRange.from, monthRange.to);
  const busyDays = useMemo(() => new Set(monthItems.filter((i) => i.status !== "cancelled" && i.id !== initial.id).map((i) => dateInput(new Date(i.startsAt)))), [monthItems, initial.id]);
  const sameDayItems = monthItems.filter((i) => i.status !== "cancelled" && i.id !== initial.id && dateInput(new Date(i.startsAt)) === date).slice(0, 4);

  // Cuándo empieza y termina (para el resumen y para guardar).
  const start = allDay ? new Date(`${date}T00:00`) : new Date(`${date}T${startTime || "09:00"}`);
  const end = allDay ? (days > 1 ? new Date(`${dateInput(addDays(start, days - 1))}T23:59`) : null) : duration ? new Date(start.getTime() + duration * 60000) : null;
  const rangeEnd = allDay && days > 1 ? dateInput(addDays(start, days - 1)) : null;
  const endText = end && !allDay ? (sameDay(start, end) ? `Termina ${hourLabel(end)}` : `Termina ${end.toLocaleDateString("es-MX", { weekday: "short", day: "numeric" })} ${hourLabel(end)}`) : null;

  const others = people.filter((p) => p.id !== user?.id);
  const channels = inbox?.channels ?? [];
  const tasks = (inbox?.tasks ?? []).filter((t) => ["open", "in_progress", "review"].includes(t.status) || String(t.id) === taskId);

  // Opciones de las listas.
  const timeOptions = useMemo(() => {
    const list = TIME_OPTIONS.includes(startTime) ? TIME_OPTIONS : [...TIME_OPTIONS, startTime].sort();
    return list.map((t) => ({ value: t, label: timeText(t) }));
  }, [startTime]);
  const durationOptions = useMemo(() => {
    const list = duration && !DURATIONS.includes(duration) ? [...DURATIONS, duration].sort((a, b) => a - b) : DURATIONS;
    return [...list.map((m) => ({ value: m, label: durationText(m) })), { value: null, label: "Sin hora de fin" }];
  }, [duration]);
  const dayOptions = [1, 2, 3, 4, 5, 6, 7, 14].map((n) => ({ value: n, label: n === 1 ? "1 día" : n === 14 ? "2 semanas" : `${n} días` }));
  const reminderOptions = REMINDERS.map((r) => ({ value: r.min, label: r.min === 0 ? "A la hora del evento" : `${r.label} antes`, short: r.min === 0 ? "A la hora" : `${r.label} antes` }));
  const peopleOptions = others.map((p) => ({ value: p.id, label: personName(p), hint: p.jobTitle || "", avatar: avatarUrl(personName(p)) }));
  const chosen = attendees.map((id) => others.find((p) => p.id === id) ?? { id, fullName: "Persona" });
  const untilPresets = [
    { value: "", label: "Sin fecha final" },
    { value: dateInput(new Date(start.getFullYear(), start.getMonth() + 1, start.getDate())), label: "Durante 1 mes" },
    { value: dateInput(new Date(start.getFullYear(), start.getMonth() + 3, start.getDate())), label: "Durante 3 meses" },
    { value: dateInput(new Date(start.getFullYear(), start.getMonth() + 6, start.getDate())), label: "Durante 6 meses" },
    { value: dateInput(new Date(start.getFullYear() + 1, start.getMonth(), start.getDate())), label: "Durante 1 año" },
  ];
  const untilOptions = until && !untilPresets.some((o) => o.value === until) ? [...untilPresets, { value: until, label: `Hasta el ${new Date(`${until}T00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" })}` }] : untilPresets;

  function chooseKind(value) {
    setKind(value);
    if (!colorTouched) setColor(KIND_COLOR[value] ?? "blue");
  }

  async function save(e) {
    e?.preventDefault();
    setError("");
    if (!title.trim()) return setError("Escribe un título.");
    if (Number.isNaN(start.getTime())) return setError("Revisa la fecha.");
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
  const summary = [
    kindOf(kind).label,
    pretty(start.toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" })),
    allDay ? (days > 1 ? `${days} días` : "todo el día") : `${hourLabel(start)}${end ? ` – ${hourLabel(end)}` : ""}`,
    recurrence !== "none" ? recurrenceLabel(recurrence).toLowerCase() : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Modal title={editing ? "Editar evento" : "Agendar"} width="max-w-3xl" onClose={busy ? () => {} : onClose}>
      <form onSubmit={save} className="flex max-h-[calc(100dvh-8.5rem)] flex-col">
        <div className="-mx-1 min-h-0 flex-1 space-y-4 overflow-y-auto px-1 pb-1">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="Título (ej. Revisión de bitácoras de la flota)"
            aria-label="Título"
            className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-semibold focus:border-blue-400 focus:outline-none"
          />

          <div className="grid gap-4 md:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
            {/* Calendario */}
            <div className="space-y-3 rounded-xl border border-slate-200 p-3">
              <MiniCalendar
                value={date}
                onChange={(key) => {
                  setDate(key);
                  if (until && until < key) setUntil("");
                }}
                month={month}
                onMonth={setMonth}
                rangeEnd={rangeEnd}
                marks={busyDays}
              />
              <div className="border-t border-slate-100 pt-2">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">{dayTitle(new Date(`${date}T00:00`))} ya tienes</p>
                {sameDayItems.length === 0 ? (
                  <p className="text-[11px] text-slate-400">Nada agendado.</p>
                ) : (
                  <div className="space-y-1">
                    {sameDayItems.map((i) => (
                      <p key={`${i.id}-${i.startsAt}`} className="flex items-center gap-1.5 truncate text-[11px] text-slate-600">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${colorOf(i.color).dot}`} />
                        <span className="shrink-0 font-semibold">{i.allDay ? "Todo el día" : hourLabel(new Date(i.startsAt))}</span>
                        <span className="truncate">{i.title}</span>
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Detalles */}
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <Dropdown id="ag-kind" label="Tipo" value={kind} onChange={chooseKind} options={AGENDA_KINDS.map((k) => ({ value: k.id, label: k.label, icon: k.icon }))} />
                <Dropdown
                  id="ag-priority"
                  label="Prioridad"
                  value={priority}
                  onChange={setPriority}
                  options={PRIORITIES.map((p) => ({ value: p.id, label: p.label, icon: p.id === "high" ? Flag : undefined }))}
                />
              </div>

              <div className="rounded-xl bg-slate-50 p-2.5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600">
                    <Clock size={12} /> Horario
                  </p>
                  <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-600">
                    <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="h-3.5 w-3.5 accent-blue-600" /> Todo el día
                  </label>
                </div>
                {allDay ? (
                  <Dropdown id="ag-days" label="Dura" value={days} onChange={setDays} options={dayOptions} />
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <Dropdown id="ag-start" label="Empieza" value={startTime} onChange={setStartTime} options={timeOptions} icon={Clock} width={180} />
                    <Dropdown id="ag-duration" label="Dura" value={duration} onChange={setDuration} options={durationOptions} width={200} />
                  </div>
                )}
                <p className="mt-1.5 text-[10px] text-slate-500">{allDay ? (days > 1 ? `Del ${start.toLocaleDateString("es-MX", { day: "numeric", month: "short" })} al ${addDays(start, days - 1).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}` : "Todo el día") : endText ?? "Sin hora de fin"}</p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Dropdown id="ag-repeat" label="Repetir" value={recurrence} onChange={setRecurrence} options={RECURRENCES.map((r) => ({ value: r.id, label: r.label }))} icon={Repeat} width={220} />
                {recurrence !== "none" ? (
                  <Dropdown
                    id="ag-until"
                    label="Hasta"
                    value={until}
                    onChange={setUntil}
                    options={untilOptions}
                    width={260}
                    footer={(close) => (
                      <div className="p-1">
                        <p className="mb-1 px-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">O elige el último día</p>
                        <MiniCalendar
                          value={until || date}
                          onChange={(key) => {
                            setUntil(key);
                            close();
                          }}
                          month={untilMonth ?? new Date(`${until || date}T00:00`)}
                          onMonth={setUntilMonth}
                          min={date}
                          compact
                        />
                      </div>
                    )}
                  />
                ) : (
                  <div />
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Dropdown id="ag-reminders" label="Avisarme" value={reminders} onChange={(list) => setReminders([...list].sort((a, b) => a - b))} options={reminderOptions} multiple max={6} placeholder="Sin avisos" icon={Bell} />
                <Dropdown
                  id="ag-color"
                  label="Color"
                  value={color}
                  onChange={(c) => {
                    setColor(c);
                    setColorTouched(true);
                  }}
                  options={Object.keys(COLORS).map((c) => ({ value: c, label: COLOR_NAMES[c] ?? c, swatch: COLORS[c].dot }))}
                />
              </div>
            </div>
          </div>

          {/* Quiénes */}
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_220px]">
            <Dropdown
              id="ag-people"
              label={`Participantes (${attendees.length})`}
              value={attendees}
              onChange={setAttendees}
              options={peopleOptions}
              multiple
              searchable
              max={50}
              placeholder="Agregar personas"
              icon={Users}
              display={attendees.length ? `${attendees.length} ${attendees.length === 1 ? "persona" : "personas"}` : null}
              width={300}
            />
            <Dropdown
              id="ag-visibility"
              label="Quién lo ve"
              value={visibility}
              onChange={setVisibility}
              options={[
                { value: "participants", label: "Solo los participantes", icon: Lock, hint: "Y quien lo crea" },
                { value: "company", label: "Toda la empresa", icon: Eye, hint: "Aparece en la agenda de todos" },
              ]}
              width={240}
            />
          </div>
          {chosen.length > 0 && (
            <div className="-mt-2 flex flex-wrap gap-1.5">
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

          {/* Dónde y con qué se relaciona */}
          <div className="grid gap-2 md:grid-cols-3">
            <div>
              <label className={label} htmlFor="ag-location">
                Lugar o enlace
              </label>
              <input id="ag-location" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={300} placeholder="Ej. Patio 2 o https://…" className={field} />
            </div>
            <Dropdown
              id="ag-chat"
              label="Chat (para unirse a la llamada)"
              value={channelId}
              onChange={setChannelId}
              searchable={channels.length > 8}
              options={[{ value: "", label: "Ninguno" }, ...channels.map((c) => ({ value: String(c.id), label: chatName(c), icon: c.kind === "direct" ? undefined : c.kind === "general" ? MessageSquare : Users, avatar: c.kind === "direct" ? avatarUrl(chatName(c)) : undefined }))]}
              width={260}
            />
            <Dropdown
              id="ag-task"
              label="Tarea relacionada"
              value={taskId}
              onChange={setTaskId}
              searchable={tasks.length > 8}
              options={[{ value: "", label: "Ninguna" }, ...tasks.map((t) => ({ value: String(t.id), label: t.title, icon: ListTodo }))]}
              width={280}
            />
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
          {editing && initial.recurrence && initial.recurrence !== "none" && <p className="text-[10px] text-slate-400">Los cambios aplican a todas las repeticiones.</p>}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <p className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] text-slate-500">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${colorOf(color).dot}`} />
            <span className="truncate">{summary}</span>
          </p>
          {error && <p className="w-full rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 sm:order-first">{error}</p>}
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
  const [postponing, setPostponing] = useState(false);
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
  async function cancelOnce() {
    if (!window.confirm(`¿Cancelar solo la vez del ${start.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" })}? Las demás repeticiones siguen igual.`)) return;
    const ok = await run("status", () => supabase.rpc("agenda_skip", { target_event: item.id, occurrence: item.startsAt }), "Se canceló esa vez. Se avisó a los participantes.");
    if (ok) onClose();
  }
  function cancelAll() {
    if (!window.confirm(repeat ? `¿Cancelar "${item.title}" y todas sus repeticiones? Se avisará a los participantes.` : `¿Cancelar "${item.title}"? Se avisará a los participantes.`)) return;
    setStatus("cancelled", "Evento cancelado. Se avisó a los participantes.");
  }
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
            </>
          )}
        </div>
        {item.canEdit && (
          <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-slate-50 p-2">
            <p className="w-full px-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">{item.createdBy === user?.id ? "Como organizador" : "Como administrador"}</p>
            <>
              {item.status === "scheduled" && (
                <button type="button" disabled={!!busy} onClick={() => setPostponing(true)} className="flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-60">
                  <Clock size={12} /> Posponer
                </button>
              )}
              {item.status === "scheduled" && repeat && (
                <button type="button" disabled={!!busy} onClick={cancelOnce} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60">
                  Cancelar solo esta vez
                </button>
              )}
              {item.status === "scheduled" ? (
                <button type="button" disabled={!!busy} onClick={cancelAll} className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-60">
                  {repeat ? "Cancelar todas" : "Cancelar evento"}
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
          </div>
        )}
      </div>
      {postponing && <PostponeModal item={item} onClose={() => setPostponing(false)} onDone={onClose} />}
    </Modal>
  );
}

/* ---------- Posponer (quien organiza o un administrador) ---------- */
function PostponeModal({ item, onClose, onDone }) {
  const { showToast } = useToast();
  const start = new Date(item.startsAt);
  const length = item.endsAt ? Date.parse(item.endsAt) - start.getTime() : null;
  const repeats = item.recurrence && item.recurrence !== "none";
  const [choice, setChoice] = useState("hour");
  const [date, setDate] = useState(dateInput(addDays(start, 1)));
  const [time, setTime] = useState(() => {
    const m = (Math.round((start.getHours() * 60 + start.getMinutes()) / 15) * 15) % 1440;
    return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  });
  const [month, setMonth] = useState(new Date(start.getFullYear(), start.getMonth(), 1));
  const [busy, setBusy] = useState(false);
  const presets = [
    { id: "hour", label: "1 hora después", at: new Date(start.getTime() + 3600000) },
    { id: "tomorrow", label: "Mañana a la misma hora", at: new Date(addDays(start, 1).setHours(start.getHours(), start.getMinutes(), 0, 0)) },
    { id: "week", label: "En una semana", at: new Date(addDays(start, 7).setHours(start.getHours(), start.getMinutes(), 0, 0)) },
    { id: "custom", label: "Elegir otra fecha", at: null },
  ];
  const newStart = choice === "custom" ? (item.allDay ? new Date(`${date}T00:00`) : new Date(`${date}T${time}`)) : presets.find((p) => p.id === choice).at;
  const newEnd = length != null ? new Date(newStart.getTime() + length) : null;
  const timeOptions = TIME_OPTIONS.map((t) => ({ value: t, label: timeText(t) }));
  const when = (d) => `${pretty(d.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" }))}${item.allDay ? "" : ` · ${hourLabel(d)}`}`;

  async function confirm() {
    if (Number.isNaN(newStart.getTime())) return;
    setBusy(true);
    const { error } = await supabase.rpc("agenda_postpone", { target_event: item.id, occurrence: item.startsAt, new_start: newStart.toISOString(), new_end: newEnd ? newEnd.toISOString() : null });
    setBusy(false);
    if (error) {
      showToast(/agenda_postpone|could not find/i.test(error.message) ? "Para posponer hace falta la actualización v33 de la base de datos." : error.message);
      return;
    }
    showToast("Evento pospuesto. Se avisó a los participantes.");
    agendaChanged();
    onDone?.();
    onClose();
  }

  return (
    <Modal title="Posponer" width="max-w-md" onClose={busy ? () => {} : onClose}>
      <div className="space-y-3">
        <p className="text-xs text-slate-500">
          <b className="text-slate-700">{item.title}</b>
          <br />
          Ahora: {when(start)}
          {repeats ? " · solo se moverá esta vez; las demás repeticiones siguen igual." : ""}
        </p>
        <div className="space-y-1.5">
          {presets.map((p) => (
            <label key={p.id} className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 text-xs transition ${choice === p.id ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:bg-slate-50"}`}>
              <input type="radio" name="postpone" checked={choice === p.id} onChange={() => setChoice(p.id)} className="accent-blue-600" />
              <span className="flex-1 font-semibold text-slate-700">{p.label}</span>
              {p.at && <span className="text-[11px] text-slate-400">{p.at.toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" })}{item.allDay ? "" : ` ${hourLabel(p.at)}`}</span>}
            </label>
          ))}
        </div>
        {choice === "custom" && (
          <div className="grid gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-[minmax(0,1fr)_140px]">
            <MiniCalendar value={date} onChange={setDate} month={month} onMonth={setMonth} min={dateInput(new Date())} compact />
            {!item.allDay && <Dropdown id="pp-time" label="Hora" value={time} onChange={setTime} options={timeOptions} icon={Clock} width={170} />}
          </div>
        )}
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
          Nueva fecha: <b>{Number.isNaN(newStart.getTime()) ? "—" : when(newStart)}</b>
          <br />
          Se les avisará a quienes participan.
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg px-3 py-2 text-xs font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-50">
            Cancelar
          </button>
          <button type="button" onClick={confirm} disabled={busy} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
            <Clock size={13} /> {busy ? "Posponiendo…" : "Posponer y avisar"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------- Calendario (Actividades → Agenda) ---------- */
const VIEW_KEY = "navio.agenda.view";
const HOUR_PX = 48;
const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const startOfWeek = (d) => addDays(startOfDay(d), -((d.getDay() + 6) % 7));
const itemEnd = (i) => (i.endsAt ? new Date(i.endsAt) : new Date(Date.parse(i.startsAt) + 30 * 60000));
const shortTime = (d) => d.toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" }).replace(/\s?([ap])\.?\s?m\.?/i, " $1m");
const hourMark = (h) => new Date(2000, 0, 1, h).toLocaleTimeString("es-MX", { hour: "numeric" }).replace(/\s?([ap])\.?\s?m\.?/i, " $1m");

// Los eventos que tocan un día (los de varios días salen en cada uno).
function touchesDay(item, day) {
  const from = startOfDay(day).getTime();
  const to = from + 864e5;
  const s = Date.parse(item.startsAt);
  const e = item.allDay && item.endsAt ? Date.parse(item.endsAt) : itemEnd(item).getTime();
  return s < to && (e > from || (s >= from && s < to));
}
const sortForDay = (list) => [...list].sort((a, b) => (a.allDay === b.allDay ? Date.parse(a.startsAt) - Date.parse(b.startsAt) : a.allDay ? -1 : 1));

// Al tocar un día: a las 9:00, o la siguiente hora si es hoy y ya pasó.
function defaultStart(day) {
  const now = new Date();
  if (sameDay(day, now) && now.getHours() >= 9) return new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.min(23, now.getHours() + 1), 0);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0);
}

// Acomoda los eventos de un día en columnas cuando se enciman.
function layoutDay(list, day) {
  const dayStart = startOfDay(day).getTime();
  const dayEnd = dayStart + 864e5;
  const evs = list
    .map((item) => {
      const s = Math.max(dayStart, Date.parse(item.startsAt));
      const e = Math.min(dayEnd, itemEnd(item).getTime());
      return { item, s, e: Math.max(e, s + 20 * 60000) };
    })
    .sort((a, b) => a.s - b.s || b.e - a.e);
  const out = [];
  let cluster = [];
  let clusterEnd = 0;
  const flush = () => {
    const cols = [];
    for (const ev of cluster) {
      let c = cols.findIndex((end) => end <= ev.s);
      if (c < 0) {
        c = cols.length;
        cols.push(0);
      }
      cols[c] = ev.e;
      ev.col = c;
    }
    for (const ev of cluster) out.push({ ...ev, cols: cols.length });
    cluster = [];
  };
  for (const ev of evs) {
    if (cluster.length && ev.s >= clusterEnd) {
      flush();
      clusterEnd = 0;
    }
    cluster.push(ev);
    clusterEnd = Math.max(clusterEnd, ev.e);
  }
  if (cluster.length) flush();
  return out.map((ev) => ({ ...ev, top: ((ev.s - dayStart) / 3600000) * HOUR_PX, height: Math.max(20, ((ev.e - ev.s) / 3600000) * HOUR_PX - 2) }));
}

function EventPill({ item, onOpen, compact = false }) {
  const c = colorOf(item.color);
  const cancelled = item.status === "cancelled";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen(item);
      }}
      title={`${item.allDay ? "Todo el día" : timeRange(item)} · ${item.title}`}
      className={`flex w-full min-w-0 items-center gap-1 truncate rounded-md px-1.5 py-[3px] text-left text-[10px] font-semibold transition hover:brightness-95 ${
        item.allDay ? `${c.dot} text-white` : `border-l-[3px] ${c.soft}`
      } ${cancelled ? "line-through opacity-50" : ""}`}
    >
      {!item.allDay && !compact && <span className="shrink-0 opacity-80">{shortTime(new Date(item.startsAt))}</span>}
      <span className="truncate">{item.title}</span>
    </button>
  );
}

function MonthView({ anchor, items, onCreate, onOpen, onOpenDay, compact }) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = startOfWeek(first);
  const todayKey = dateInput(new Date());
  const maxPills = compact ? 2 : 3;
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
        {WEEKDAYS.map((w, i) => (
          <p key={w} className={`py-1.5 text-center text-[10px] font-bold uppercase tracking-wide ${i >= 5 ? "text-slate-400" : "text-slate-500"}`}>
            {compact ? w.charAt(0) : w}
          </p>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-7">
        {Array.from({ length: 42 }, (_, i) => {
          const day = addDays(start, i);
          const key = dateInput(day);
          const inMonth = day.getMonth() === anchor.getMonth();
          const list = sortForDay(items.filter((it) => touchesDay(it, day)));
          const more = list.length - maxPills;
          const isToday = key === todayKey;
          return (
            <div
              key={key}
              role="button"
              tabIndex={0}
              aria-label={`Agendar el ${day.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" })}`}
              onClick={() => onCreate(day, null)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onCreate(day, null))}
              className={`group flex min-h-[72px] cursor-pointer flex-col gap-0.5 overflow-hidden border-b border-r border-slate-100 p-1 transition hover:bg-blue-50/40 sm:min-h-[96px] ${inMonth ? "" : "bg-slate-50/60"} ${(i + 1) % 7 === 0 ? "border-r-0" : ""}`}
            >
              <div className="flex items-center justify-between px-0.5">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenDay(day);
                  }}
                  title="Ver el día"
                  className={`flex h-6 min-w-[24px] items-center justify-center rounded-full px-1 text-[11px] font-bold transition ${
                    isToday ? "bg-blue-600 text-white" : inMonth ? "text-slate-700 hover:bg-slate-100" : "text-slate-300 hover:bg-slate-100"
                  }`}
                >
                  {day.getDate() === 1 && !compact ? `${day.getDate()} ${day.toLocaleDateString("es-MX", { month: "short" }).replace(".", "")}` : day.getDate()}
                </button>
                <Plus size={12} className="text-blue-500 opacity-0 transition group-hover:opacity-100" />
              </div>
              {list.slice(0, maxPills).map((item) => (
                <EventPill key={`${item.id}-${item.startsAt}`} item={item} onOpen={onOpen} compact={compact} />
              ))}
              {more > 0 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenDay(day);
                  }}
                  className="px-1 text-left text-[10px] font-semibold text-slate-500 hover:text-blue-600"
                >
                  +{more} más
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TimeGrid({ days, items, onCreate, onOpen, onOpenDay }) {
  const scrollRef = useRef(null);
  const [now, setNow] = useState(Date.now());
  const firstKey = dateInput(days[0]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  // Al abrir, se ve desde las 7:00 (o una hora antes de ahora, si es hoy).
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    const today = days.some((d) => sameDay(d, new Date()));
    box.scrollTop = (today ? Math.max(0, new Date().getHours() - 1) : 7) * HOUR_PX;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstKey, days.length]);
  const cols = `52px repeat(${days.length}, minmax(0, 1fr))`;
  const allDay = days.map((d) => sortForDay(items.filter((i) => i.allDay && touchesDay(i, d))));
  const timed = days.map((d) => layoutDay(items.filter((i) => !i.allDay && touchesDay(i, d)), d));
  const anyAllDay = allDay.some((l) => l.length);
  const nowDate = new Date(now);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="grid border-b border-slate-200 bg-slate-50" style={{ gridTemplateColumns: cols }}>
        <div />
        {days.map((d) => {
          const isToday = sameDay(d, nowDate);
          return (
            <button key={dateInput(d)} type="button" onClick={() => onOpenDay(d)} disabled={days.length === 1} className="flex flex-col items-center py-1.5 transition enabled:hover:bg-slate-100">
              <span className={`text-[10px] font-bold uppercase ${isToday ? "text-blue-600" : "text-slate-400"}`}>{d.toLocaleDateString("es-MX", { weekday: "short" }).replace(".", "")}</span>
              <span className={`mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold ${isToday ? "bg-blue-600 text-white" : "text-slate-700"}`}>{d.getDate()}</span>
            </button>
          );
        })}
      </div>
      {anyAllDay && (
        <div className="grid border-b border-slate-200" style={{ gridTemplateColumns: cols }}>
          <p className="px-1 py-1.5 text-right text-[9px] font-semibold leading-tight text-slate-400">Todo el día</p>
          {days.map((d, idx) => (
            <div key={dateInput(d)} onClick={() => onCreate(d, "allDay")} className="min-h-[30px] cursor-pointer space-y-0.5 border-l border-slate-100 p-0.5 hover:bg-blue-50/40">
              {allDay[idx].map((item) => (
                <EventPill key={`${item.id}-${item.startsAt}`} item={item} onOpen={onOpen} />
              ))}
            </div>
          ))}
        </div>
      )}
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="relative grid" style={{ gridTemplateColumns: cols, height: 24 * HOUR_PX }}>
          <div className="relative">
            {Array.from({ length: 24 }, (_, h) =>
              h === 0 ? null : (
                <span key={h} style={{ top: h * HOUR_PX - 7 }} className="absolute right-2 text-[10px] text-slate-400">
                  {hourMark(h)}
                </span>
              )
            )}
          </div>
          {days.map((d, idx) => {
            const isToday = sameDay(d, nowDate);
            const nowTop = ((nowDate.getHours() * 60 + nowDate.getMinutes()) / 60) * HOUR_PX;
            return (
              <div
                key={dateInput(d)}
                className="relative cursor-pointer border-l border-slate-100 hover:bg-blue-50/20"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const minutes = Math.min(23 * 60 + 30, Math.max(0, Math.floor(((e.clientY - rect.top) / HOUR_PX) * 2) * 30));
                  onCreate(d, minutes);
                }}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} style={{ top: h * HOUR_PX }} className="pointer-events-none absolute inset-x-0 border-t border-slate-100">
                    <div className="absolute inset-x-0 border-t border-dashed border-slate-100" style={{ top: HOUR_PX / 2 }} />
                  </div>
                ))}
                {timed[idx].map((ev) => {
                  const c = colorOf(ev.item.color);
                  const cancelled = ev.item.status === "cancelled";
                  return (
                    <button
                      key={`${ev.item.id}-${ev.item.startsAt}`}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(ev.item);
                      }}
                      title={`${timeRange(ev.item)} · ${ev.item.title}`}
                      style={{ top: ev.top + 1, height: ev.height, left: `calc(${(ev.col / ev.cols) * 100}% + 2px)`, width: `calc(${100 / ev.cols}% - 4px)` }}
                      className={`absolute z-10 overflow-hidden rounded-md border-l-[3px] px-1.5 py-0.5 text-left text-[10px] leading-tight shadow-sm transition hover:z-20 hover:shadow ${c.soft} ${cancelled ? "line-through opacity-50" : ""}`}
                    >
                      <span className="block truncate font-bold">{ev.item.title}</span>
                      {ev.height >= 34 && <span className="block truncate opacity-80">{timeRange(ev.item)}</span>}
                      {ev.height >= 52 && ev.item.location && <span className="block truncate opacity-70">{ev.item.location}</span>}
                    </button>
                  );
                })}
                {isToday && (
                  <div style={{ top: nowTop }} className="pointer-events-none absolute inset-x-0 z-30 flex items-center">
                    <span className="-ml-1 h-2 w-2 rounded-full bg-rose-500" />
                    <span className="h-px flex-1 bg-rose-500" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function AgendaView({ compact: compactProp = false }) {
  // En el teléfono (o una ventana angosta) el calendario se acomoda más compacto.
  const compact = compactProp || (typeof window !== "undefined" && !!window.matchMedia?.("(max-width: 640px)").matches);
  const [view, setView] = useState(() => {
    try {
      const saved = window.localStorage.getItem(VIEW_KEY);
      if (saved === "month" || saved === "week" || saved === "day") return saved;
    } catch {
      // Sin almacenamiento: vista por omisión.
    }
    return compact ? "day" : "month";
  });
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [showCancelled, setShowCancelled] = useState(false);
  const [form, setForm] = useState(null);
  const [detail, setDetail] = useState(null);

  const changeView = (v) => {
    setView(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Solo es comodidad.
    }
  };
  const range = useMemo(() => {
    if (view === "month") {
      const start = startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
      return { from: start, to: addDays(start, 42), days: [] };
    }
    if (view === "week") {
      const start = startOfWeek(anchor);
      return { from: start, to: addDays(start, 7), days: Array.from({ length: 7 }, (_, i) => addDays(start, i)) };
    }
    return { from: anchor, to: addDays(anchor, 1), days: [anchor] };
  }, [view, anchor]);
  const { items, available } = useAgendaRange(addDays(range.from, -1).toISOString(), range.to.toISOString());
  const shown = items.filter((i) => showCancelled || i.status !== "cancelled");

  function move(step) {
    if (view === "month") setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + step, 1));
    else setAnchor(addDays(anchor, view === "week" ? 7 * step : step));
  }
  const title = (() => {
    if (view === "month") return pretty(anchor.toLocaleDateString("es-MX", { month: "long", year: "numeric" }));
    if (view === "week") {
      const a = range.from;
      const b = addDays(range.from, 6);
      return a.getMonth() === b.getMonth()
        ? `${a.getDate()} – ${b.getDate()} de ${b.toLocaleDateString("es-MX", { month: "long", year: "numeric" })}`
        : `${a.toLocaleDateString("es-MX", { day: "numeric", month: "short" })} – ${b.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" })}`;
    }
    return pretty(anchor.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" }));
  })();

  // Tocar un día u hora: empieza a agendar ahí.
  function create(day, minutes) {
    if (minutes === "allDay") {
      setForm({ startsAt: new Date(day.getFullYear(), day.getMonth(), day.getDate()).toISOString(), allDay: true });
      return;
    }
    const at = minutes == null ? defaultStart(day) : new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minutes / 60), minutes % 60);
    setForm({ startsAt: at.toISOString() });
  }
  function openDay(day) {
    setAnchor(startOfDay(day));
    changeView("day");
  }

  return (
    <div className={compact ? "flex flex-col gap-2" : "flex h-[calc(100vh-7.5rem)] min-h-[540px] flex-col gap-3"}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => move(-1)} aria-label="Anterior" className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50">
            <ChevronLeft size={15} />
          </button>
          <button type="button" onClick={() => setAnchor(startOfDay(new Date()))} className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50">
            Hoy
          </button>
          <button type="button" onClick={() => move(1)} aria-label="Siguiente" className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50">
            <ChevronRight size={15} />
          </button>
        </div>
        <h2 className={`min-w-0 font-bold text-slate-800 ${compact ? "w-full text-sm sm:w-auto" : "text-base"}`}>{title}</h2>
        <div className="ml-auto flex items-center gap-2">
          <label className="hidden cursor-pointer items-center gap-1.5 text-[11px] text-slate-500 sm:flex">
            <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} className="h-3.5 w-3.5 accent-blue-600" /> Ver cancelados
          </label>
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5" role="tablist" aria-label="Vista del calendario">
            {[
              { id: "month", label: "Mes" },
              { id: "week", label: "Semana" },
              { id: "day", label: "Día" },
            ].map((v) => (
              <button key={v.id} type="button" role="tab" aria-selected={view === v.id} onClick={() => changeView(v.id)} className={`rounded-md px-3 py-1 text-xs font-semibold transition ${view === v.id ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}>
                {v.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="-mt-1 text-[11px] text-slate-400">{view === "month" ? "Toca un día para agendar ahí." : "Toca una hora para agendar ahí."} Toca un evento para verlo, posponerlo o cancelarlo.</p>

      {!available ? (
        <p className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-xs text-slate-400">La agenda se activa al aplicar la actualización v32 de la base de datos.</p>
      ) : view === "month" ? (
        <MonthView anchor={anchor} items={shown} onCreate={create} onOpen={setDetail} onOpenDay={openDay} compact={compact} />
      ) : (
        <div className={compact ? "flex h-[calc(100dvh-15rem)] min-h-[420px] flex-col" : "flex min-h-0 flex-1 flex-col"}>
          <TimeGrid days={range.days} items={shown} onCreate={create} onOpen={setDetail} onOpenDay={openDay} />
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
