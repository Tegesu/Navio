import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  DollarSign,
  FileText,
  MapPin,
  MessageSquare,
  Navigation,
  Plus,
  Receipt,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Truck,
  Wrench,
} from "lucide-react";
import { supabase, useAuth, useToast, Modal, formatMoney, localISODate, profileCan } from "./NavioDashboard.jsx";
import { useInbox } from "./inbox.jsx";
import { ORDER_STAGES } from "./workorders.jsx";

/* ---------------------------------------------------------------------- */
/*  Inicio a la medida de cada persona                                    */
/* ---------------------------------------------------------------------- */
//
// Cada quien elige qué indicadores ver al entrar y sus accesos rápidos. Se
// guarda en su perfil (preferences.home), así se ve igual en el teléfono y en
// la computadora.

const live = (inv) => inv.status !== "rejected" && inv.status !== "voided";
const month = () => localISODate().slice(0, 7);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Cada indicador: qué muestra y a dónde lleva.
export const HOME_WIDGETS = [
  {
    id: "myOrders",
    group: "Garantías",
    label: "Mis órdenes de trabajo",
    hint: "Las órdenes que tienes asignadas y en qué paso va cada una",
    icon: ClipboardCheck,
    tone: "violet",
    wide: true,
    compute: (d) => {
      const mine = d.orders.filter((o) => o.assignedTo === d.userId && o.stage !== "closed");
      return { value: mine.length, detail: mine.length ? "asignadas para analizar" : "No tienes órdenes asignadas", list: mine.slice(0, 4).map((o) => ({ key: o.key, text: `${o.code}${o.project ? ` · ${o.project}` : ""}`, chip: ORDER_STAGES[o.stage] })), go: ["warranties", "orders"] };
    },
  },
  {
    id: "ordersByStage",
    group: "Garantías",
    label: "Órdenes por etapa",
    hint: "Cuántas órdenes faltan por cargar, verificar o analizar",
    icon: ClipboardList,
    tone: "violet",
    compute: (d) => {
      const open = d.orders.filter((o) => o.code && o.stage !== "closed");
      const by = (stage) => open.filter((o) => o.stage === stage).length;
      return { value: open.length, detail: `${by("upload")} por cargar · ${by("verification")} por verificar · ${by("analysis")} en análisis`, go: ["warranties", "orders"] };
    },
  },
  {
    id: "invoicesUnverified",
    group: "Facturas",
    label: "Facturas sin verificar",
    hint: "Facturas cargadas que aún no revisa nadie",
    icon: Receipt,
    tone: "amber",
    compute: (d) => {
      const rows = d.invoices.filter((i) => i.status === "pending");
      return { value: rows.length, detail: formatMoney(rows.reduce((s, i) => s + (Number(i.amount) || 0), 0), d.currency), go: ["fuel"] };
    },
  },
  {
    id: "invoicesToApprove",
    group: "Facturas",
    label: "Facturas por aprobar",
    hint: "Ya verificadas, esperan la aprobación",
    icon: ShieldCheck,
    tone: "blue",
    compute: (d) => {
      const rows = d.invoices.filter((i) => i.status === "verified" && !i.approved);
      return { value: rows.length, detail: formatMoney(rows.reduce((s, i) => s + (Number(i.amount) || 0), 0), d.currency), go: ["fuel"] };
    },
  },
  {
    id: "invoicesLoaded",
    group: "Facturas",
    label: "Facturas cargadas este mes",
    hint: "Todo lo que se subió en el mes",
    icon: FileText,
    tone: "emerald",
    compute: (d) => {
      const rows = d.invoices.filter((i) => live(i) && String(i.createdAt ?? i.date ?? "").startsWith(month()));
      return { value: rows.length, detail: formatMoney(rows.reduce((s, i) => s + (Number(i.amount) || 0), 0), d.currency), go: ["fuel"] };
    },
  },
  {
    id: "maintenanceCost",
    group: "Facturas",
    label: "Mantenimiento del mes",
    hint: "Costo de servicios del mes, sin garantías ni campañas",
    icon: Wrench,
    tone: "amber",
    compute: (d) => {
      const rows = d.maintenanceRecords.filter((r) => String(r.date ?? "").startsWith(month()) && (r.coverage ?? "none") === "none" && r.status !== "rejected");
      return { value: formatMoney(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0), d.currency), detail: plural(rows.length, "servicio", "servicios"), go: ["services"] };
    },
  },
  {
    id: "spendMonth",
    group: "Facturas",
    label: "Gasto del mes",
    hint: "Facturas, servicios y trámites del mes",
    icon: DollarSign,
    tone: "blue",
    compute: (d) => {
      const all = [...d.invoices.filter(live), ...d.maintenanceRecords, ...d.complianceRecords].filter((r) => String(r.date ?? "").startsWith(month()));
      return { value: formatMoney(all.reduce((s, r) => s + (Number(r.amount) || 0), 0), d.currency), detail: "Facturas, servicios y trámites", go: ["fuel"] };
    },
  },
  {
    id: "myTasks",
    group: "General",
    label: "Mis tareas pendientes",
    hint: "Lo que tienes asignado sin terminar",
    icon: ClipboardList,
    tone: "sky",
    wide: true,
    compute: (d) => {
      const rows = d.tasks.filter((t) => t.assignedTo === d.userId && (t.status === "open" || t.status === "in_progress"));
      return { value: rows.length, detail: rows.length ? "por hacer" : "Sin tareas pendientes", list: rows.slice(0, 3).map((t) => ({ key: t.id, text: t.title })), go: ["tasks", "open"] };
    },
  },
  {
    id: "messages",
    group: "General",
    label: "Mensajes sin leer",
    hint: "Conversaciones con mensajes nuevos",
    icon: MessageSquare,
    tone: "sky",
    compute: (d) => ({ value: d.unreadMessages, detail: "en tus conversaciones", go: ["messages", "all"] }),
  },
  {
    id: "units",
    group: "Logística",
    label: "Unidades",
    hint: "Disponibles y en movimiento",
    icon: Truck,
    tone: "emerald",
    compute: (d) => {
      const moving = new Set(d.trips.filter((t) => t.status === "ongoing").map((t) => t.vehicleId ?? t.unit));
      const busy = d.vehicles.filter((v) => moving.has(v.id) || moving.has(v.unit)).length;
      return { value: d.vehicles.length, detail: `${busy} en movimiento · ${d.vehicles.length - busy} disponibles`, go: ["fleet"] };
    },
  },
  {
    id: "tripsToday",
    group: "Logística",
    label: "Traslados de hoy",
    hint: "En curso y programados para hoy",
    icon: Navigation,
    tone: "blue",
    compute: (d) => {
      const today = localISODate();
      const ongoing = d.trips.filter((t) => t.status === "ongoing").length;
      const scheduled = d.trips.filter((t) => t.status === "scheduled" && t.date === today).length;
      return { value: ongoing, detail: `en curso · ${plural(scheduled, "programado", "programados")} hoy`, go: ["transfers", "open"] };
    },
  },
  {
    id: "compliance",
    group: "Logística",
    label: "Trámites por vencer",
    hint: "Vencen en los próximos 30 días",
    icon: AlertTriangle,
    tone: "rose",
    compute: (d) => {
      const limit = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
      const rows = d.complianceRecords.filter((r) => r.dueDate && r.dueDate <= limit && r.paymentStatus !== "Pagado");
      return { value: rows.length, detail: "en 30 días o vencidos", go: ["compliance", "all"] };
    },
  },
  {
    id: "scheduledServices",
    group: "Logística",
    label: "Servicios programados",
    hint: "Mantenimientos con fecha o en proceso",
    icon: CalendarClock,
    tone: "amber",
    compute: (d) => {
      const rows = d.maintenanceRecords.filter((r) => r.serviceStatus === "scheduled" || r.serviceStatus === "in_progress");
      return { value: rows.length, detail: "programados o en proceso", go: ["schedule"] };
    },
  },
];

export const HOME_SHORTCUTS = [
  { id: "addInvoice", label: "Registrar factura", icon: Plus, action: "addInvoice" },
  { id: "newTrip", label: "Nuevo traslado", icon: Navigation, route: ["transfers", "scheduled"] },
  { id: "map", label: "Mapa en vivo", icon: MapPin, route: ["map"] },
  { id: "messages", label: "Mensajes", icon: MessageSquare, route: ["messages", "all"] },
  { id: "tasks", label: "Tareas", icon: ClipboardList, route: ["tasks", "open"] },
  { id: "invoices", label: "Facturas", icon: Receipt, route: ["fuel"] },
  { id: "search", label: "Buscar servicio", icon: Search, route: ["maintenance"] },
  { id: "services", label: "Servicios", icon: Wrench, route: ["services"] },
  { id: "orders", label: "Órdenes de trabajo", icon: ClipboardCheck, route: ["warranties", "orders"] },
  { id: "warranties", label: "Garantías", icon: ShieldCheck, route: ["warranties", "warranties"] },
  { id: "campaigns", label: "Campañas", icon: ShieldCheck, route: ["warranties", "campaigns"] },
  { id: "compliance", label: "Trámites", icon: FileText, route: ["compliance", "all"] },
  { id: "incidents", label: "Reportar incidencia", icon: AlertTriangle, route: ["incidents", "all"] },
  { id: "fleet", label: "Unidades", icon: Truck, route: ["fleet"] },
];

// Lo que ve alguien que todavía no personaliza su inicio, según lo que hace.
function defaultLayout(profile, drives, hasOrders) {
  const admin = !!(profile?.isSuperAdmin || profile?.companyRole === "admin");
  let widgets;
  if (admin) widgets = ["tripsToday", "spendMonth", "invoicesUnverified", "myTasks"];
  else if (profileCan(profile, "invoices")) widgets = ["invoicesUnverified", "myTasks", "maintenanceCost", "invoicesLoaded"];
  else if (profileCan(profile, "supervisor")) widgets = ["tripsToday", "units", "myTasks", "messages"];
  else widgets = ["myTasks", "messages", "invoicesLoaded", "tripsToday"];
  if (hasOrders) widgets = ["myOrders", ...widgets.filter((w) => w !== "myOrders")];
  return {
    widgets,
    shortcuts: drives ? ["newTrip", "addInvoice", "map", "messages"] : ["addInvoice", "invoices", "tasks", "messages"],
    drive: drives,
    attention: true,
    fleet: true,
    trends: true,
  };
}

export function useHomeLayout({ trips = [], orders = [] } = {}) {
  const { user, profile, refreshProfile } = useAuth();
  const { showToast } = useToast();
  const drives = trips.some((t) => t.assignedTo === user?.id);
  const hasOrders = orders.some((o) => o.assignedTo === user?.id);
  const saved = profile?.preferences?.home;
  const layout = useMemo(() => {
    const base = defaultLayout(profile, drives, hasOrders);
    if (!saved) return { ...base, custom: false };
    const known = new Set(HOME_WIDGETS.map((w) => w.id));
    const shortcutIds = new Set(HOME_SHORTCUTS.map((s) => s.id));
    return {
      ...base,
      ...saved,
      widgets: (saved.widgets ?? base.widgets).filter((id) => known.has(id)),
      shortcuts: (saved.shortcuts ?? base.shortcuts).filter((id) => shortcutIds.has(id)),
      custom: true,
    };
  }, [profile, saved, drives, hasOrders]);

  async function save(next) {
    const clean = {
      widgets: next.widgets.slice(0, 12),
      shortcuts: next.shortcuts.slice(0, 8),
      drive: !!next.drive,
      attention: !!next.attention,
      fleet: !!next.fleet,
      trends: !!next.trends,
    };
    const { error } = await supabase
      .from("profiles")
      .update({ preferences: { ...(profile?.preferences ?? {}), home: clean } })
      .eq("id", user.id);
    if (error) {
      showToast(`No se pudo guardar: ${error.message}`);
      return false;
    }
    await refreshProfile(user.id);
    showToast("Inicio actualizado.");
    return true;
  }
  return { layout, save };
}

const TONES = {
  violet: "bg-violet-50 text-violet-600",
  amber: "bg-amber-50 text-amber-600",
  blue: "bg-blue-50 text-blue-600",
  emerald: "bg-emerald-50 text-emerald-600",
  sky: "bg-sky-50 text-sky-600",
  rose: "bg-rose-50 text-rose-600",
};

export function HomeWidgetGrid({ ids, data, onNavigate, compact = false }) {
  const inbox = useInbox();
  const full = { ...data, tasks: inbox?.tasks ?? [], unreadMessages: inbox?.unreadMessages ?? 0 };
  const widgets = ids.map((id) => HOME_WIDGETS.find((w) => w.id === id)).filter(Boolean);
  if (widgets.length === 0) return null;
  return (
    <div className={`grid grid-flow-row-dense gap-3 ${compact ? "grid-cols-2" : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4"}`}>
      {widgets.map((w) => {
        const result = w.compute(full);
        const Icon = w.icon;
        return (
          <button
            key={w.id}
            onClick={() => onNavigate(...result.go)}
            className={`flex flex-col rounded-2xl border border-slate-200 bg-white p-3.5 text-left shadow-sm transition hover:shadow-md active:scale-[0.99] ${w.wide && result.list?.length ? (compact ? "col-span-2" : "sm:col-span-2") : ""}`}
          >
            <span className="flex items-center gap-2">
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${TONES[w.tone]}`}>
                <Icon size={16} />
              </span>
              <span className="min-w-0 truncate text-[11px] font-semibold text-slate-500">{w.label}</span>
            </span>
            <span className={`mt-2 font-extrabold leading-none text-slate-900 ${String(result.value).length > 9 ? "text-lg" : "text-2xl"}`}>{result.value}</span>
            <span className="mt-1 text-[11px] text-slate-500">{result.detail}</span>
            {result.list?.length > 0 && (
              <span className="mt-2 block space-y-1">
                {result.list.map((item) => (
                  <span key={item.key} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2 py-1 text-[11px] text-slate-600">
                    <span className="min-w-0 truncate">{item.text}</span>
                    {item.chip && <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${item.chip.className}`}>{item.chip.label}</span>}
                  </span>
                ))}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function HomeShortcuts({ ids, onNavigate, onAddInvoice, compact = false }) {
  const items = ids.map((id) => HOME_SHORTCUTS.find((s) => s.id === id)).filter(Boolean);
  if (items.length === 0) return null;
  return (
    <div className={`grid gap-2 ${compact ? "grid-cols-4" : "grid-cols-2"}`}>
      {items.map((s) => {
        const Icon = s.icon;
        const go = () => (s.action === "addInvoice" ? onAddInvoice?.() : onNavigate(...s.route));
        return compact ? (
          <button key={s.id} onClick={go} className="flex flex-col items-center gap-1.5 rounded-2xl p-1.5 text-center active:bg-slate-100">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
              <Icon size={19} />
            </span>
            <span className="text-[10.5px] font-medium leading-tight text-slate-600">{s.label}</span>
          </button>
        ) : (
          <button key={s.id} onClick={go} className="flex items-center gap-2 rounded-xl border border-slate-100 px-2.5 py-2.5 text-left hover:border-blue-200 hover:bg-blue-50/50">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <Icon size={14} />
            </span>
            <span className="truncate text-xs font-medium text-slate-600">{s.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function CustomizeHomeButton({ onClick, compact = false }) {
  return (
    <button onClick={onClick} className={`inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white font-semibold text-slate-600 hover:bg-slate-50 ${compact ? "px-2.5 py-1.5 text-[11px]" : "px-3 py-1.5 text-xs"}`}>
      <SlidersHorizontal size={13} /> Personalizar inicio
    </button>
  );
}

function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-200 px-3 py-2.5 hover:bg-slate-50">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600" />
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-slate-700">{label}</span>
        {hint && <span className="block text-[11px] text-slate-400">{hint}</span>}
      </span>
    </label>
  );
}

export function CustomizeHomeModal({ layout, onSave, onClose, phone = false }) {
  const [draft, setDraft] = useState(layout);
  const [saving, setSaving] = useState(false);
  const groups = [...new Set(HOME_WIDGETS.map((w) => w.group))];
  const toggleIn = (key, id) =>
    setDraft((prev) => ({ ...prev, [key]: prev[key].includes(id) ? prev[key].filter((x) => x !== id) : [...prev[key], id] }));
  const move = (id, delta) =>
    setDraft((prev) => {
      const list = [...prev.widgets];
      const index = list.indexOf(id);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= list.length) return prev;
      [list[index], list[target]] = [list[target], list[index]];
      return { ...prev, widgets: list };
    });

  async function submit() {
    setSaving(true);
    const ok = await onSave(draft);
    setSaving(false);
    if (ok) onClose();
  }

  return (
    <Modal title="Personalizar inicio" width="max-w-2xl" onClose={onClose}>
      <div className="max-h-[68vh] space-y-5 overflow-y-auto pr-1">
        <section className="space-y-2">
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Al entrar</h3>
          <Toggle
            checked={draft.drive}
            onChange={(v) => setDraft((p) => ({ ...p, drive: v }))}
            label='Mostrar "¿Vas a manejar? Iniciar un viaje"'
            hint="Déjalo apagado si no manejas ni viajas: solo verás tu bienvenida y tu empresa."
          />
          {!phone && <Toggle checked={draft.attention} onChange={(v) => setDraft((p) => ({ ...p, attention: v }))} label="Requiere atención" hint="Trámites por vencer, servicios, tareas vencidas y facturas por revisar." />}
          <Toggle checked={draft.fleet} onChange={(v) => setDraft((p) => ({ ...p, fleet: v }))} label="Tu flotilla" hint="La lista de unidades." />
          {!phone && <Toggle checked={draft.trends} onChange={(v) => setDraft((p) => ({ ...p, trends: v }))} label="Tendencias" hint="Gráficas de gasto, combustible y traslados." />}
        </section>

        <section>
          <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Indicadores (en este orden)</h3>
          {draft.widgets.length > 0 && (
            <ol className="mb-3 space-y-1">
              {draft.widgets.map((id, index) => {
                const w = HOME_WIDGETS.find((x) => x.id === id);
                if (!w) return null;
                return (
                  <li key={id} className="flex items-center gap-2 rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-800">
                    <span className="w-4 text-center text-[11px] text-blue-400">{index + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{w.label}</span>
                    <button onClick={() => move(id, -1)} disabled={index === 0} aria-label={`Subir ${w.label}`} className="rounded p-1 hover:bg-blue-100 disabled:opacity-30">
                      <ArrowUp size={12} />
                    </button>
                    <button onClick={() => move(id, 1)} disabled={index === draft.widgets.length - 1} aria-label={`Bajar ${w.label}`} className="rounded p-1 hover:bg-blue-100 disabled:opacity-30">
                      <ArrowDown size={12} />
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
          {groups.map((group) => (
            <div key={group} className="mb-3">
              <p className="mb-1.5 text-[11px] font-semibold text-slate-500">{group}</p>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {HOME_WIDGETS.filter((w) => w.group === group).map((w) => (
                  <Toggle key={w.id} checked={draft.widgets.includes(w.id)} onChange={() => toggleIn("widgets", w.id)} label={w.label} hint={w.hint} />
                ))}
              </div>
            </div>
          ))}
        </section>

        <section>
          <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Accesos rápidos (hasta 8)</h3>
          <div className="flex flex-wrap gap-1.5">
            {HOME_SHORTCUTS.map((s) => {
              const on = draft.shortcuts.includes(s.id);
              return (
                <button
                  key={s.id}
                  onClick={() => toggleIn("shortcuts", s.id)}
                  disabled={!on && draft.shortcuts.length >= 8}
                  aria-pressed={on}
                  className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold transition disabled:opacity-40 ${on ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        </section>
      </div>
      <div className="mt-4 flex justify-end gap-2 border-t border-slate-100 pt-3">
        <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">
          Cancelar
        </button>
        <button onClick={submit} disabled={saving} className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
          {saving ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </Modal>
  );
}
