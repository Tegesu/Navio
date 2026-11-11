import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight, ClipboardList, DollarSign, Edit2, FileText, Gauge, MapPin, Megaphone, MessageSquare, Navigation, Plus, Receipt, ShieldCheck, Truck, User, Wrench } from "lucide-react";
import { supabase, useAuth, useToast, usePersistentState, formatCurrency, localISODate, Modal, KpiCard, VehiclePhoto, HomeChartSlot, isVariableDriver, vehicleDriverLabel } from "./NavioDashboard.jsx";
import { useInbox } from "./inbox.jsx";
import { daysUntil } from "./vehicle.jsx";

/* ---------------------------------------------------------------------- */
/*  Inicio: lo que pasa hoy y lo que necesita atención                    */
/* ---------------------------------------------------------------------- */

const card = "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm";
const WARN_DAYS = 30;
const WARN_KM = 1000;
const MIN_TREAD_MM = 3;
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const RANGES = [
  { id: 30, label: "Últimos 30 días" },
  { id: 90, label: "Últimos 3 meses" },
  { id: 365, label: "Último año" },
];
const TONE_ORDER = { rose: 0, amber: 1, blue: 2 };
const TONE_STYLE = { rose: "bg-rose-50 text-rose-600", amber: "bg-amber-50 text-amber-600", blue: "bg-blue-50 text-blue-600" };

const counts = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const whenText = (days) => (days < 0 ? `venció hace ${counts(-days, "día", "días")}` : days === 0 ? "vence hoy" : `vence en ${counts(days, "día", "días")}`);
const live = (record) => record.status !== "rejected" && record.status !== "voided";

// Suma por mes de los últimos seis meses, para ver la tendencia.
function monthlyTrend(records) {
  const now = new Date();
  const buckets = [];
  for (let back = 5; back >= 0; back -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
    buckets.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: MONTHS[d.getMonth()], value: 0 });
  }
  for (const record of records) {
    const bucket = buckets.find((b) => b.key === String(record.date ?? "").slice(0, 7));
    if (bucket) bucket.value += Number(record.amount) || 0;
  }
  return buckets.some((b) => b.value > 0) ? buckets.map(({ label, value }) => ({ label, value: Math.round(value) })) : [];
}

function AnnouncementModal({ current, onClose }) {
  const { user, profile, refreshProfile } = useAuth();
  const { showToast } = useToast();
  const [title, setTitle] = useState(current?.title ?? "");
  const [text, setText] = useState(current?.text ?? "");
  const [saving, setSaving] = useState(false);
  const inputClass = "w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-blue-400 focus:outline-none";

  async function save(announcement) {
    setSaving(true);
    const settings = { ...(profile?.company?.settings ?? {}), announcement };
    const { error } = await supabase.from("companies").update({ settings }).eq("id", profile.companyId);
    setSaving(false);
    if (error) return showToast(`No se pudo guardar el aviso: ${error.message}`);
    await refreshProfile(user.id);
    showToast(announcement ? "Aviso publicado para tu equipo." : "Aviso retirado.");
    return onClose();
  }

  return (
    <Modal title="Aviso para tu equipo" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) save({ title: title.trim(), text: text.trim(), by: profile?.fullName ?? "", at: new Date().toISOString() });
        }}
        className="space-y-3"
      >
        <p className="text-xs text-slate-500">Lo ven todas las personas de tu empresa al entrar a Navio.</p>
        <div>
          <label className="mb-1 block text-[11px] font-semibold text-slate-500">Título</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} autoFocus placeholder="Ej. Junta de seguridad el viernes" className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-semibold text-slate-500">Mensaje (opcional)</label>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={600} className={inputClass} />
        </div>
        <div className="flex items-center justify-between gap-2 pt-1">
          {current ? (
            <button type="button" onClick={() => save(null)} disabled={saving} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50">
              Retirar aviso
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">
              Cancelar
            </button>
            <button type="submit" disabled={saving || !title.trim()} className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
              {saving ? "Guardando…" : "Publicar"}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

export function HomePage({ vehicles, maintenanceRecords, complianceRecords, invoices, trips, currency, isAdmin, userName, onSelectVehicle, onNavigate, onAddInvoice }) {
  const { user, profile } = useAuth();
  const inbox = useInbox();
  const [prefs, setPrefs] = usePersistentState("navio.home.v2", { range: 90, charts: ["spend", "liters", "trips"] });
  const [editingNotice, setEditingNotice] = useState(false);
  const money = (value) => formatCurrency(value, currency);
  const today = localISODate();
  const announcement = profile?.company?.settings?.announcement ?? null;

  const stats = useMemo(() => {
    const month = today.slice(0, 7);
    const previous = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
    const lastMonth = `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, "0")}`;
    const spending = [...invoices.filter(live), ...maintenanceRecords, ...complianceRecords];
    const sumOf = (prefix) => spending.filter((r) => String(r.date ?? "").startsWith(prefix)).reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    const thisMonth = sumOf(month);
    const before = sumOf(lastMonth);
    return {
      ongoing: trips.filter((t) => t.status === "ongoing").length,
      scheduledToday: trips.filter((t) => t.status === "scheduled" && t.date === today).length,
      thisMonth,
      change: before > 0 ? Math.round(((thisMonth - before) / before) * 100) : null,
      pending: invoices.filter((i) => i.status === "pending").length + [...maintenanceRecords, ...complianceRecords].filter((r) => r.status === "pending").length,
      toApprove: invoices.filter((i) => i.status === "verified" && !i.approved).length,
    };
  }, [invoices, maintenanceRecords, complianceRecords, trips, today]);

  // Todo lo que pide una acción, lo más urgente primero.
  const attention = useMemo(() => {
    const list = [];
    const seenDocs = new Set();
    for (const record of [...complianceRecords].sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")))) {
      const key = `${record.unit}|${record.docType}`;
      if (seenDocs.has(key)) continue; // solo cuenta el registro más reciente de cada documento
      seenDocs.add(key);
      const days = daysUntil(record.dueDate);
      if (days !== null && days <= WARN_DAYS) {
        list.push({ key: `doc-${record.id}`, tone: days < 0 ? "rose" : "amber", icon: FileText, title: `${record.docType || "Trámite"} · ${record.unit || "sin unidad"}`, detail: whenText(days), go: () => onNavigate("compliance") });
      }
    }
    for (const v of vehicles) {
      const licenseDays = isVariableDriver(v) ? null : daysUntil(v.driver?.licenseExpiry);
      if (licenseDays !== null && licenseDays <= WARN_DAYS) {
        list.push({ key: `lic-${v.id}`, tone: licenseDays < 0 ? "rose" : "amber", icon: User, title: `Licencia de ${vehicleDriverLabel(v)} · ${v.unit}`, detail: whenText(licenseDays), go: () => onSelectVehicle(v.id) });
      }
      const nextKm = Number(v.kmProximoServicio) || 0;
      const left = nextKm - (Number(v.kmActual) || 0);
      if (nextKm && left <= WARN_KM) {
        list.push({ key: `srv-${v.id}`, tone: left <= 0 ? "rose" : "amber", icon: Wrench, title: `Servicio de ${v.unit}`, detail: left <= 0 ? "ya le toca servicio" : `le toca en ${left.toLocaleString("es-MX")} km`, go: () => onSelectVehicle(v.id) });
      }
      const depths = [Number(v.tires?.frontDepth), Number(v.tires?.rearDepth)].filter((mm) => mm > 0);
      if (depths.some((mm) => mm < MIN_TREAD_MM)) {
        list.push({ key: `tire-${v.id}`, tone: "rose", icon: Gauge, title: `Llantas de ${v.unit}`, detail: `piso por debajo de ${MIN_TREAD_MM} mm`, go: () => onSelectVehicle(v.id) });
      }
    }
    const overdue = (inbox.tasks ?? []).filter((t) => t.assignedTo === user?.id && (t.status === "open" || t.status === "in_progress") && t.dueDate && t.dueDate < today);
    if (overdue.length > 0) list.push({ key: "tasks", tone: "rose", icon: ClipboardList, title: counts(overdue.length, "tarea tuya vencida", "tareas tuyas vencidas"), detail: overdue[0].title, go: () => onNavigate("tasks") });
    if (stats.scheduledToday > 0) list.push({ key: "trips", tone: "blue", icon: Navigation, title: counts(stats.scheduledToday, "traslado programado para hoy", "traslados programados para hoy"), detail: "todavía sin iniciar", go: () => onNavigate("transfers") });
    if (stats.pending > 0) list.push({ key: "pending", tone: "blue", icon: Receipt, title: counts(stats.pending, "registro por revisar", "registros por revisar"), detail: "datos leídos por el bot o capturados sin verificar", go: () => onNavigate("fuel") });
    if (isAdmin && stats.toApprove > 0) list.push({ key: "approve", tone: "blue", icon: CheckCircle2, title: counts(stats.toApprove, "factura por aprobar", "facturas por aprobar"), detail: "ya verificadas, esperan tu decisión", go: () => onNavigate("fuel") });
    return list.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complianceRecords, vehicles, inbox.tasks, stats, isAdmin, user?.id, today]);

  const metrics = useMemo(() => {
    const inRange = (record) => {
      const days = daysUntil(record.date);
      return days !== null && -days <= prefs.range;
    };
    const short = (unit) => String(unit).replace(/^Unidad\s+/i, "U");
    const fuel = invoices.filter((i) => i.module === "fuel" && live(i));
    const tripsInRange = trips.filter(inRange);
    const tripCount = (status) => tripsInRange.filter((t) => t.status === status).length;
    return {
      spend: { label: "Gasto total por mes", type: "line", data: monthlyTrend([...invoices.filter(live), ...maintenanceRecords, ...complianceRecords]) },
      fuelCost: { label: "Combustible por mes", type: "line", data: monthlyTrend(fuel) },
      maintenance: { label: "Mantenimiento por mes", type: "line", data: monthlyTrend(maintenanceRecords) },
      liters: {
        label: "Litros cargados por unidad",
        type: "bar",
        data: vehicles.map((v) => ({ label: short(v.unit), value: Math.round(fuel.filter((i) => i.unit === v.unit && inRange(i)).reduce((sum, i) => sum + i.liters, 0)) })).filter((d) => d.value > 0),
      },
      km: { label: "Kilometraje por unidad", type: "bar", data: vehicles.map((v) => ({ label: short(v.unit), value: Number(v.kmActual) || 0 })) },
      trips: {
        label: "Traslados por estado",
        type: "donut",
        data: tripsInRange.length
          ? [
              { label: "Completados", value: tripCount("completed"), color: "#10b981" },
              { label: "En curso", value: tripCount("ongoing"), color: "#2563eb" },
              { label: "Programados", value: tripCount("scheduled"), color: "#f59e0b" },
              { label: "Cancelados", value: tripCount("cancelled"), color: "#cbd5e1" },
            ]
          : [],
      },
    };
  }, [invoices, maintenanceRecords, complianceRecords, vehicles, trips, prefs.range]);
  const chartKeys = [0, 1, 2].map((slot) => (metrics[prefs.charts?.[slot]] ? prefs.charts[slot] : ["spend", "liters", "trips"][slot]));

  const kpis = [
    { id: "trips", go: () => onNavigate("transfers"), widget: { label: "Viajes en curso", value: stats.ongoing, detail: `${counts(stats.scheduledToday, "programado", "programados")} para hoy`, icon: Truck, tone: "emerald" } },
    {
      id: "spend",
      go: () => onNavigate("fuel"),
      widget: { label: "Gasto del mes", value: money(stats.thisMonth), detail: stats.change === null ? "Facturas, servicios y trámites" : `${stats.change >= 0 ? "▲" : "▼"} ${Math.abs(stats.change)}% contra el mes pasado`, icon: DollarSign, tone: "blue" },
    },
    { id: "review", go: () => onNavigate("fuel"), widget: { label: "Por revisar", value: stats.pending, detail: isAdmin ? `${stats.toApprove} por aprobar` : "Registros sin verificar", icon: Receipt, tone: stats.pending > 0 ? "amber" : "slate" } },
    { id: "tasks", go: () => onNavigate("tasks"), widget: { label: "Mis tareas", value: inbox.myOpenTasks ?? 0, detail: `${counts(inbox.unreadMessages ?? 0, "mensaje nuevo", "mensajes nuevos")}`, icon: ClipboardList, tone: "sky" } },
  ];
  const shortcuts = [
    { label: "Registrar factura", icon: Plus, go: () => onAddInvoice() },
    { label: "Nuevo traslado", icon: Navigation, go: () => onNavigate("transfers") },
    { label: "Mapa en vivo", icon: MapPin, go: () => onNavigate("map") },
    { label: "Mensajes", icon: MessageSquare, go: () => onNavigate("messages") },
    { label: "Garantías", icon: ShieldCheck, go: () => onNavigate("maintenance", "garantias") },
    { label: "Trámites", icon: FileText, go: () => onNavigate("compliance") },
  ];
  const shown = attention.slice(0, 7);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Hola, {String(userName).split(" ")[0]}</h1>
        <p className="mt-1 text-sm text-slate-500">
          <span className="capitalize">{new Date().toLocaleDateString("es-MX", { weekday: "long" })}</span> {new Date().toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })} ·{" "}
          {attention.length === 0 ? "todo en orden." : `${counts(attention.length, "asunto necesita", "asuntos necesitan")} tu atención.`}
        </p>
      </div>

      {(announcement || isAdmin) && (
        <div className={`flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 ${announcement ? "border-blue-200 bg-blue-50" : "border-dashed border-slate-200 bg-white"}`}>
          <Megaphone size={18} className={announcement ? "shrink-0 text-blue-600" : "shrink-0 text-slate-300"} />
          <div className="min-w-0 flex-1">
            {announcement ? (
              <>
                <p className="break-words text-sm font-bold text-slate-800">{announcement.title}</p>
                {announcement.text && <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-slate-600">{announcement.text}</p>}
                {announcement.by && <p className="mt-1 text-[11px] text-slate-400">{announcement.by}</p>}
              </>
            ) : (
              <p className="text-xs text-slate-500">Publica un aviso para que todo tu equipo lo vea al entrar.</p>
            )}
          </div>
          {isAdmin && (
            <button onClick={() => setEditingNotice(true)} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
              <Edit2 size={12} /> {announcement ? "Editar" : "Escribir aviso"}
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <button key={kpi.id} onClick={kpi.go} className="rounded-2xl text-left transition hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
            <KpiCard widget={kpi.widget} />
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className={`${card} lg:col-span-2`}>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-800">
            <AlertTriangle size={15} className={attention.length ? "text-amber-500" : "text-slate-300"} /> Requiere atención
          </h2>
          {attention.length === 0 ? (
            <p className="flex items-center justify-center gap-2 rounded-xl bg-emerald-50 px-3 py-6 text-xs font-semibold text-emerald-700">
              <CheckCircle2 size={15} /> No hay pendientes urgentes: trámites, servicios y tareas están al día.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {shown.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.key}>
                    <button onClick={item.go} className="flex w-full items-center gap-3 rounded-xl border border-slate-100 px-3 py-2 text-left hover:border-blue-200 hover:bg-blue-50/40">
                      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${TONE_STYLE[item.tone]}`}>
                        <Icon size={15} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold text-slate-700">{item.title}</span>
                        <span className="block truncate text-[11px] text-slate-500">{item.detail}</span>
                      </span>
                      <ChevronRight size={14} className="shrink-0 text-slate-300" />
                    </button>
                  </li>
                );
              })}
              {attention.length > shown.length && <li className="px-3 pt-1 text-[11px] text-slate-400">y {attention.length - shown.length} más.</li>}
            </ul>
          )}
        </div>

        <div className={card}>
          <h2 className="mb-3 text-sm font-bold text-slate-800">Accesos rápidos</h2>
          <div className="grid grid-cols-2 gap-2">
            {shortcuts.map((s) => {
              const Icon = s.icon;
              return (
                <button key={s.label} onClick={s.go} className="flex items-center gap-2 rounded-xl border border-slate-100 px-2.5 py-2.5 text-left hover:border-blue-200 hover:bg-blue-50/50">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                    <Icon size={14} />
                  </span>
                  <span className="text-[11px] font-semibold leading-tight text-slate-600">{s.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className={card}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-slate-800">Tu flotilla ({vehicles.length})</h2>
          <button onClick={() => onNavigate("fleet")} className="text-xs font-semibold text-blue-600 hover:text-blue-700">
            Ver todas →
          </button>
        </div>
        {vehicles.length === 0 ? (
          <p className="rounded-xl bg-slate-50 px-3 py-6 text-center text-xs text-slate-400">Todavía no hay unidades. Agrega la primera en Gestión de flota.</p>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-1">
            {vehicles.map((v) => (
              <button key={v.id} onClick={() => onSelectVehicle(v.id)} className="w-36 shrink-0 text-left">
                <VehiclePhoto src={v.photo} alt="" className="h-20 w-36 rounded-xl ring-1 ring-slate-200" iconSize={18} />
                <span className="mt-1.5 block truncate text-xs font-bold text-slate-700">{v.unit}</span>
                <span className="block truncate text-[11px] text-slate-400">{vehicleDriverLabel(v)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-slate-800">Tendencias</h2>
          <select value={prefs.range} onChange={(e) => setPrefs((prev) => ({ ...prev, range: Number(e.target.value) }))} aria-label="Periodo de las gráficas por unidad" className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 focus:border-blue-400 focus:outline-none">
            {RANGES.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {chartKeys.map((key, slot) => (
            <HomeChartSlot key={slot} metricKey={key} metrics={metrics} onChangeMetric={(next) => setPrefs((prev) => ({ ...prev, charts: chartKeys.map((k, i) => (i === slot ? next : k)) }))} />
          ))}
        </div>
      </div>

      {editingNotice && <AnnouncementModal current={announcement} onClose={() => setEditingNotice(false)} />}
    </div>
  );
}
