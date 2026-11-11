import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, Edit2, FileText, Gauge, MapPin, Plus, ShieldCheck, Trash2, Wrench } from "lucide-react";
import {
  supabase,
  useAuth,
  useToast,
  useDateFormat,
  formatDate,
  formatMoney,
  localISODate,
  timeAgoLabel,
  Modal,
  ConfirmModal,
  DocumentCell,
  sniffDocumentType,
  DOCUMENT_EXTENSIONS,
  DOCUMENT_ACCEPT,
  DOCUMENT_MAX_MB,
  VehiclePhoto,
} from "./NavioDashboard.jsx";
import { RouteMap, routeSummary } from "./tracking.jsx";

/* ---------------------------------------------------------------------- */
/*  Expediente de la unidad y garantías: todo sale de registros reales    */
/* ---------------------------------------------------------------------- */

const card = "rounded-2xl border border-slate-200 bg-white p-4";
const cardTitle = "mb-3 text-xs font-bold uppercase tracking-wide text-slate-400";
const inputClass = "w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-blue-400 focus:outline-none";
const labelClass = "mb-1 block text-[11px] font-semibold text-slate-500";
const smallButton = "inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50";
const DAY_MS = 86400000;

// Días desde hoy hasta una fecha (negativo = ya pasó).
export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const target = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  return Math.round((target - new Date(`${localISODate()}T00:00:00`)) / DAY_MS);
}

const km = (value) => `${(Number(value) || 0).toLocaleString("es-MX")} km`;
const sameUnit = (record, vehicle) => (record.unit && record.unit === vehicle.unit) || (record.plate && record.plate === vehicle.plate);
const byDateDesc = (a, b) => String(b.date ?? "").localeCompare(String(a.date ?? ""));

// Lo que el expediente necesita de la app, sin pasarlo pantalla por pantalla.
const FleetDataContext = createContext({ maintenanceRecords: [], complianceRecords: [], fuelRecords: [], trips: [], vehicles: [], isAdmin: false, onNavigate: () => {} });
export const FleetDataProvider = FleetDataContext.Provider;
const useFleetData = () => useContext(FleetDataContext);
// Los importes se muestran en la moneda de la empresa.
function useMoney() {
  const { profile } = useAuth();
  const currency = profile?.company?.currency || "MXN";
  return (value) => formatMoney(value, currency);
}

function Chip({ tone, children }) {
  const tones = {
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    amber: "bg-amber-50 text-amber-700 ring-amber-200",
    rose: "bg-rose-50 text-rose-700 ring-rose-200",
    blue: "bg-blue-50 text-blue-700 ring-blue-200",
    slate: "bg-slate-100 text-slate-500 ring-slate-200",
  };
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${tones[tone]}`}>{children}</span>;
}

function Field({ label, value }) {
  return (
    <div className="min-w-0 rounded-xl bg-slate-50 px-3 py-2">
      <p className="text-[11px] font-medium text-slate-400">{label}</p>
      <p className="truncate text-xs font-semibold text-slate-700">{value || "—"}</p>
    </div>
  );
}

function Empty({ children }) {
  return <p className="rounded-xl bg-slate-50 px-3 py-6 text-center text-xs text-slate-400">{children}</p>;
}

/* ---------------------------------------------------------------------- */
/*  Estado de una unidad: qué tiene pendiente, según sus registros        */
/* ---------------------------------------------------------------------- */

const UNIT_DOC_TYPES = ["Póliza de Seguro", "Tarjeta de Circulación", "Verificación Vehicular", "Tenencia"];
const ISSUE_WARN_DAYS = 30;
const ISSUE_WARN_KM = 1000;
const ISSUE_MIN_TREAD_MM = 3;

export function vehicleIssues(vehicle, complianceRecords = []) {
  const issues = [];
  const nextKm = Number(vehicle.kmProximoServicio) || 0;
  const left = nextKm - (Number(vehicle.kmActual) || 0);
  if (nextKm && left <= 0) issues.push({ tone: "rose", text: "Servicio vencido" });
  else if (nextKm && left <= ISSUE_WARN_KM) issues.push({ tone: "amber", text: `Servicio en ${left.toLocaleString("es-MX")} km` });

  const depths = [Number(vehicle.tires?.frontDepth), Number(vehicle.tires?.rearDepth)].filter((mm) => mm > 0);
  if (depths.some((mm) => mm < ISSUE_MIN_TREAD_MM)) issues.push({ tone: "rose", text: "Llantas gastadas" });

  if (vehicle.driver?.mode !== "variable") {
    const days = daysUntil(vehicle.driver?.licenseExpiry);
    if (days !== null && days < 0) issues.push({ tone: "rose", text: "Licencia vencida" });
    else if (days !== null && days <= ISSUE_WARN_DAYS) issues.push({ tone: "amber", text: `Licencia vence en ${days} d` });
  }

  const mine = complianceRecords.filter((r) => sameUnit(r, vehicle)).sort(byDateDesc);
  for (const docType of UNIT_DOC_TYPES) {
    const days = daysUntil(mine.find((r) => r.docType === docType)?.dueDate);
    if (days !== null && days < 0) issues.push({ tone: "rose", text: `${docType} vencida` });
    else if (days !== null && days <= ISSUE_WARN_DAYS) issues.push({ tone: "amber", text: `${docType} vence en ${days} d` });
  }
  return issues;
}

export function VehicleStatusChip({ vehicle, className = "" }) {
  const { complianceRecords } = useFleetData();
  const issues = vehicleIssues(vehicle, complianceRecords);
  const urgent = issues.some((issue) => issue.tone === "rose");
  const tone = issues.length === 0 ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : urgent ? "bg-rose-50 text-rose-700 ring-rose-200" : "bg-amber-50 text-amber-700 ring-amber-200";
  return (
    <span title={issues.map((issue) => issue.text).join(" · ")} className={`rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ${tone} ${className}`}>
      {issues.length === 0 ? "Al día" : issues.length === 1 ? issues[0].text : `${issues.length} pendientes`}
    </span>
  );
}

export function FleetStatusSummary({ vehicles }) {
  const { complianceRecords } = useFleetData();
  const withIssues = vehicles.filter((v) => vehicleIssues(v, complianceRecords).length > 0).length;
  const units = `${vehicles.length} ${vehicles.length === 1 ? "unidad" : "unidades"}`;
  if (vehicles.length === 0) return "Todavía no hay unidades registradas.";
  return withIssues === 0 ? `${units} · todas al día` : `${units} · ${withIssues} con pendientes (servicio, llantas, licencia o trámites)`;
}

/* ---------------------------------------------------------------------- */
/*  Trámites de la unidad                                                 */
/* ---------------------------------------------------------------------- */

function expiryChip(dateStr) {
  const days = daysUntil(dateStr);
  if (days === null) return <Chip tone="slate">Sin fecha de vencimiento</Chip>;
  if (days < 0) return <Chip tone="rose">Venció hace {Math.abs(days)} d</Chip>;
  if (days <= 30) return <Chip tone="amber">Vence en {days} d</Chip>;
  return <Chip tone="emerald">Vigente</Chip>;
}

export function VehicleDocsTab({ vehicle }) {
  const { format } = useDateFormat();
  const { complianceRecords, onNavigate } = useFleetData();
  const mine = useMemo(() => complianceRecords.filter((r) => sameUnit(r, vehicle)).sort(byDateDesc), [complianceRecords, vehicle]);

  return (
    <div className="space-y-3">
      {UNIT_DOC_TYPES.map((docType) => {
        const records = mine.filter((r) => r.docType === docType);
        const current = records[0];
        return (
          <div key={docType} className={card}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="flex items-center gap-2 text-xs font-bold text-slate-700">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <FileText size={14} />
                </span>
                {docType}
              </h4>
              {current ? expiryChip(current.dueDate) : <Chip tone="slate">Sin registro</Chip>}
            </div>
            {current ? (
              <>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Field label="Vence" value={current.dueDate ? formatDate(current.dueDate, format) : ""} />
                  <Field label="Pago" value={current.paymentStatus} />
                  <Field label="Proveedor" value={current.vendor} />
                  <Field label="Folio" value={current.invoiceFolio} />
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                  <span>
                    Registrado el {formatDate(current.date, format)}
                    {records.length > 1 ? ` · ${records.length - 1} anterior${records.length === 2 ? "" : "es"}` : ""}
                  </span>
                  <DocumentCell documentUrl={current.documentUrl} />
                </div>
              </>
            ) : (
              <p className="mt-2 text-[11px] text-slate-400">Todavía no se ha registrado este documento para la unidad.</p>
            )}
          </div>
        );
      })}
      <button onClick={() => onNavigate("compliance")} className={smallButton}>
        <Plus size={12} /> Registrar o renovar un trámite
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Servicio y llantas                                                    */
/* ---------------------------------------------------------------------- */

const SERVICE_KINDS = [
  { id: "engine", label: "Motor y aceite" },
  { id: "brakes", label: "Frenos y balatas" },
  { id: "tires", label: "Llantas" },
];

function NextServiceCard({ vehicle, canEdit, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const next = Number(vehicle.kmProximoServicio) || 0;
  const current = Number(vehicle.kmActual) || 0;
  const remaining = next - current;
  const tone = !next ? "slate" : remaining <= 0 ? "rose" : remaining <= 1500 ? "amber" : "emerald";
  const barTone = { slate: "bg-slate-300", rose: "bg-rose-500", amber: "bg-amber-500", emerald: "bg-blue-600" }[tone];
  const interval = Math.max(Number(vehicle.maintenancePanel?.intervalKm) || 10000, 1);
  const pct = next ? Math.min(100, Math.max(4, 100 - (remaining / interval) * 100)) : 0;

  async function save(e) {
    e.preventDefault();
    const target = Number(value);
    if (!target || target <= current) return;
    const ok = await onUpdate({ kmProximoServicio: target, maintenancePanel: { ...(vehicle.maintenancePanel ?? {}), intervalKm: target - current } }, "Próximo servicio guardado.");
    if (ok) setEditing(false);
  }

  return (
    <div className={card}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
          <Gauge size={14} className="text-blue-600" /> Próximo servicio
        </h4>
        {!next ? <Chip tone="slate">Sin programar</Chip> : remaining <= 0 ? <Chip tone="rose">Servicio vencido</Chip> : <Chip tone={tone}>Faltan {km(remaining)}</Chip>}
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${barTone}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-[11px] text-slate-500">
        Kilometraje actual: <b className="text-slate-700">{km(current)}</b>
        {next ? (
          <>
            {" "}
            · Servicio a los <b className="text-slate-700">{km(next)}</b>
          </>
        ) : null}
      </p>
      <p className="mt-1 text-[11px] text-slate-400">El kilometraje sube solo con cada viaje registrado.</p>
      {canEdit &&
        (editing ? (
          <form onSubmit={save} className="mt-3 flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <label className={labelClass}>Hacer el próximo servicio a los (km)</label>
              <input type="number" min={current + 1} value={value} onChange={(e) => setValue(e.target.value)} autoFocus className={inputClass} />
            </div>
            <button type="submit" className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
              Guardar
            </button>
            <button type="button" onClick={() => setEditing(false)} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">
              Cancelar
            </button>
          </form>
        ) : (
          <button
            onClick={() => {
              setValue(String(next > current ? next : current + 10000));
              setEditing(true);
            }}
            className={`${smallButton} mt-3`}
          >
            <Edit2 size={12} /> Programar
          </button>
        ))}
    </div>
  );
}

function LastServices({ vehicle, kinds = SERVICE_KINDS }) {
  const { format } = useDateFormat();
  const { maintenanceRecords } = useFleetData();
  const money = useMoney();
  const mine = useMemo(() => maintenanceRecords.filter((r) => sameUnit(r, vehicle)).sort(byDateDesc), [maintenanceRecords, vehicle]);
  return (
    <div className={card}>
      <h4 className={cardTitle}>Últimos servicios</h4>
      <div className="space-y-2">
        {kinds.map((kind) => {
          const last = mine.find((r) => r.category === kind.id);
          return (
            <div key={kind.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2">
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-slate-400">{kind.label}</p>
                <p className="truncate text-xs font-semibold text-slate-700">{last ? last.concept || "Servicio" : "Sin servicios registrados"}</p>
                {last && (
                  <p className="truncate text-[11px] text-slate-400">
                    {formatDate(last.date, format)}
                    {last.vendor ? ` · ${last.vendor}` : ""}
                    {last.amount ? ` · ${money(last.amount)}` : ""}
                  </p>
                )}
              </div>
              {last?.documentUrl && <DocumentCell documentUrl={last.documentUrl} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function VehicleServiceTab({ vehicle, canEdit, onUpdate }) {
  return (
    <div className="space-y-3">
      <NextServiceCard vehicle={vehicle} canEdit={canEdit} onUpdate={onUpdate} />
      <LastServices vehicle={vehicle} />
      <div className="grid grid-cols-2 gap-2">
        <Field label="Tipo de aceite" value={vehicle.oilType} />
        <Field label="Refrigerante" value={vehicle.maintenancePanel?.coolantType} />
      </div>
    </div>
  );
}

const TIRE_FIELDS = [
  { id: "frontSize", label: "Medida delantera", placeholder: "Ej. 185/60 R15" },
  { id: "rearSize", label: "Medida trasera", placeholder: "Ej. 190/60 R15" },
  { id: "frontDepth", label: "Piso delantero (mm)", number: true },
  { id: "rearDepth", label: "Piso trasero (mm)", number: true },
  { id: "psi", label: "Presión (PSI)", number: true },
  { id: "lastRotation", label: "Última rotación", date: true },
];
const MIN_TREAD_MM = 3;

export function VehicleTiresTab({ vehicle, canEdit, onUpdate }) {
  const { format } = useDateFormat();
  const tires = vehicle.tires ?? {};
  const [form, setForm] = useState(null);

  async function save(e) {
    e.preventDefault();
    const next = { ...tires };
    for (const field of TIRE_FIELDS) next[field.id] = field.number ? Number(form[field.id]) || 0 : String(form[field.id] ?? "").trim();
    const ok = await onUpdate({ tires: next }, "Datos de llantas guardados.");
    if (ok) setForm(null);
  }

  const depth = (value) => {
    const mm = Number(value);
    if (!mm) return { text: "Sin medir", low: false };
    return { text: `${mm} mm de piso`, low: mm < MIN_TREAD_MM };
  };
  const axle = (label, size, value) => {
    const d = depth(value);
    return (
      <div className={`rounded-xl px-3 py-3 text-center ring-1 ${d.low ? "bg-rose-50 ring-rose-100" : "bg-blue-50 ring-blue-100"}`}>
        <p className={`text-[11px] font-medium ${d.low ? "text-rose-500" : "text-blue-500"}`}>{label}</p>
        <p className={`text-xl font-extrabold ${d.low ? "text-rose-700" : "text-blue-700"}`}>{size || "—"}</p>
        <p className={`mt-1 flex items-center justify-center gap-1 text-[11px] font-semibold ${d.low ? "text-rose-600" : "text-slate-500"}`}>
          {d.text} {d.low && <AlertTriangle size={12} />}
        </p>
        {d.low && <p className="mt-0.5 text-[10px] font-semibold text-rose-600">Por debajo de {MIN_TREAD_MM} mm: conviene cambiarlas</p>}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className={card}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h4 className="text-xs font-bold uppercase tracking-wide text-slate-400">Llantas</h4>
          {canEdit && !form && (
            <button onClick={() => setForm(Object.fromEntries(TIRE_FIELDS.map((f) => [f.id, tires[f.id] ?? ""])))} className={smallButton}>
              <Edit2 size={12} /> Actualizar medición
            </button>
          )}
        </div>
        {form ? (
          <form onSubmit={save} className="grid grid-cols-2 gap-3">
            {TIRE_FIELDS.map((field) => (
              <div key={field.id}>
                <label className={labelClass}>{field.label}</label>
                <input
                  type={field.number ? "number" : field.date ? "date" : "text"}
                  step={field.number ? "0.1" : undefined}
                  min={field.number ? 0 : undefined}
                  max={field.date ? localISODate() : undefined}
                  value={form[field.id]}
                  placeholder={field.placeholder}
                  onChange={(e) => setForm((prev) => ({ ...prev, [field.id]: e.target.value }))}
                  className={inputClass}
                />
              </div>
            ))}
            <div className="col-span-2 flex justify-end gap-2">
              <button type="button" onClick={() => setForm(null)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">
                Cancelar
              </button>
              <button type="submit" className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
                Guardar
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              {axle("Delanteras", tires.frontSize, tires.frontDepth)}
              {axle("Traseras", tires.rearSize, tires.rearDepth)}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Field label="Presión" value={tires.psi ? `${tires.psi} PSI` : ""} />
              <Field label="Última rotación" value={tires.lastRotation ? formatDate(tires.lastRotation, format) : ""} />
            </div>
          </>
        )}
      </div>
      <LastServices vehicle={vehicle} kinds={SERVICE_KINDS.filter((k) => k.id === "tires")} />
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Historial: todo lo registrado de la unidad, en orden                  */
/* ---------------------------------------------------------------------- */

const HISTORY_KINDS = [
  { id: "all", label: "Todo" },
  { id: "service", label: "Servicios" },
  { id: "doc", label: "Trámites" },
  { id: "fuel", label: "Combustible" },
  { id: "trip", label: "Viajes" },
];
const HISTORY_RANGES = [
  { id: 30, label: "30 días" },
  { id: 90, label: "3 meses" },
  { id: 365, label: "1 año" },
  { id: 0, label: "Todo" },
];
const HISTORY_TONE = { service: "bg-amber-500", doc: "bg-emerald-500", fuel: "bg-sky-500", trip: "bg-blue-600" };

export function VehicleHistoryTab({ vehicle }) {
  const { format } = useDateFormat();
  const { maintenanceRecords, complianceRecords, fuelRecords, trips } = useFleetData();
  const money = useMoney();
  const [kind, setKind] = useState("all");
  const [range, setRange] = useState(365);

  const events = useMemo(() => {
    const list = [];
    for (const r of maintenanceRecords) if (sameUnit(r, vehicle)) list.push({ key: `m${r.id}`, kind: "service", date: r.date, title: r.concept || "Servicio", detail: r.vendor, amount: r.amount, documentUrl: r.documentUrl });
    for (const r of complianceRecords) if (sameUnit(r, vehicle)) list.push({ key: `c${r.id}`, kind: "doc", date: r.date, title: r.docType || r.concept || "Trámite", detail: r.vendor, amount: r.amount, documentUrl: r.documentUrl });
    for (const r of fuelRecords) {
      if (sameUnit(r, vehicle) && r.status !== "rejected" && r.status !== "voided") {
        list.push({ key: `f${r.id}`, kind: "fuel", date: r.date, title: `Carga de combustible${r.liters ? ` · ${r.liters} L` : ""}`, detail: r.station, amount: r.amount, documentUrl: r.documentUrl });
      }
    }
    for (const t of trips) {
      if ((t.vehicleId === vehicle.id || t.unit === vehicle.unit) && t.status === "completed") {
        list.push({ key: `t${t.id}`, kind: "trip", date: (t.endedAt || t.date || "").slice(0, 10), title: `${t.origin || "Origen"} → ${t.destination || "Destino"}`, detail: t.distanceKm ? km(t.distanceKm) : "", amount: 0 });
      }
    }
    return list.sort(byDateDesc);
  }, [maintenanceRecords, complianceRecords, fuelRecords, trips, vehicle]);

  const shown = events.filter((e) => {
    if (kind !== "all" && e.kind !== kind) return false;
    if (!range) return true;
    const days = daysUntil(e.date);
    return days !== null && -days <= range;
  });
  const total = shown.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  return (
    <div className={card}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {HISTORY_KINDS.map((k) => (
            <button
              key={k.id}
              onClick={() => setKind(k.id)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${kind === k.id ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}
            >
              {k.label}
            </button>
          ))}
        </div>
        <select value={range} onChange={(e) => setRange(Number(e.target.value))} aria-label="Periodo" className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] focus:border-blue-400 focus:outline-none">
          {HISTORY_RANGES.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      {shown.length === 0 ? (
        <Empty>No hay movimientos de esta unidad en el periodo elegido.</Empty>
      ) : (
        <>
          <p className="mb-2 text-[11px] text-slate-500">
            {shown.length} movimiento{shown.length === 1 ? "" : "s"} · Gasto: <b className="text-slate-700">{money(total)}</b>
          </p>
          <ol className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
            {shown.map((e) => (
              <li key={e.key} className="flex items-center gap-2.5 rounded-xl bg-slate-50 px-3 py-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${HISTORY_TONE[e.kind]}`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-slate-700">{e.title}</p>
                  <p className="truncate text-[11px] text-slate-400">
                    {formatDate(e.date, format)}
                    {e.detail ? ` · ${e.detail}` : ""}
                  </p>
                </div>
                {e.amount ? <span className="shrink-0 text-xs font-semibold text-slate-700">{money(e.amount)}</span> : null}
                {e.documentUrl && <DocumentCell documentUrl={e.documentUrl} />}
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Ubicación: el último recorrido real de la unidad                      */
/* ---------------------------------------------------------------------- */

export function VehicleLocationPanel({ vehicle }) {
  const { onNavigate } = useFleetData();
  const [route, setRoute] = useState(undefined); // undefined = cargando, null = sin recorridos

  useEffect(() => {
    let cancelled = false;
    setRoute(undefined);
    supabase
      .from("routes")
      .select("*")
      .eq("vehicleId", vehicle.id)
      .order("startedAt", { ascending: false })
      .limit(1)
      .then(({ data }) => !cancelled && setRoute(data?.[0] ?? null));
    return () => {
      cancelled = true;
    };
  }, [vehicle.id]);

  if (route === undefined) return <div className="flex h-[420px] items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-xs text-slate-400">Cargando ubicación…</div>;
  if (!route) {
    return (
      <div className="flex h-[420px] flex-col items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-6 text-center">
        <MapPin size={30} className="text-slate-300" />
        <p className="text-sm font-semibold text-slate-600">Esta unidad todavía no ha compartido su ubicación</p>
        <p className="text-xs text-slate-400">Aparecerá aquí cuando alguien inicie un viaje con ella desde Traslados o desde el celular.</p>
      </div>
    );
  }
  const live = route.status === "active";
  return (
    <div className="space-y-3">
      <RouteMap routeId={route.id} live={live} className="h-[330px]" />
      <div className="rounded-2xl border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
            <span className={`h-2 w-2 rounded-full ${live ? "animate-pulse bg-emerald-500" : "bg-slate-300"}`} />
            {live ? "Viaje en curso" : "Último recorrido"}
            <span className="font-normal text-slate-400">· {route.driverName || "Conductor sin nombre"}</span>
          </p>
          <span className="text-[11px] text-slate-400">{timeAgoLabel(route.lastPointAt || route.endedAt || route.startedAt)}</span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {routeSummary(route).map(([label, value]) => (
            <Field key={label} label={label} value={value} />
          ))}
        </div>
        <button onClick={() => onNavigate("map")} className={`${smallButton} mt-3`}>
          <MapPin size={12} /> Ver en el mapa en vivo
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Garantías                                                             */
/* ---------------------------------------------------------------------- */

const WARRANTY_KINDS = [
  { id: "vehicle", label: "Unidad completa" },
  { id: "part", label: "Refacción o pieza" },
  { id: "service", label: "Servicio o reparación" },
  { id: "tire", label: "Llantas" },
  { id: "battery", label: "Batería" },
  { id: "other", label: "Otra" },
];
const WARRANTY_STATES = {
  active: { label: "Vigente", tone: "emerald" },
  expiring: { label: "Por vencer", tone: "amber" },
  expired: { label: "Vencida", tone: "rose" },
  claimed: { label: "Reclamada", tone: "blue" },
  void: { label: "Anulada", tone: "slate" },
};
const WARRANTY_WARN_DAYS = 30;
const WARRANTY_WARN_KM = 1000;

// Una garantía se acaba por fecha o por kilometraje, lo que ocurra primero.
export function warrantyState(warranty, vehicle) {
  if (warranty.status === "void") return { id: "void" };
  if (warranty.status === "claimed") return { id: "claimed" };
  const days = daysUntil(warranty.endDate);
  const kmLeft = warranty.kmLimit && vehicle ? (Number(warranty.kmStart) || 0) + Number(warranty.kmLimit) - (Number(vehicle.kmActual) || 0) : null;
  const info = { days, kmLeft };
  if ((days !== null && days < 0) || (kmLeft !== null && kmLeft <= 0)) return { id: "expired", ...info };
  if ((days !== null && days <= WARRANTY_WARN_DAYS) || (kmLeft !== null && kmLeft <= WARRANTY_WARN_KM)) return { id: "expiring", ...info };
  return { id: "active", ...info };
}

function remainingText(state) {
  const parts = [];
  if (state.days !== null && state.days !== undefined) parts.push(state.days < 0 ? `venció hace ${Math.abs(state.days)} d` : `${state.days} d restantes`);
  if (state.kmLeft !== null && state.kmLeft !== undefined) parts.push(state.kmLeft <= 0 ? "kilometraje agotado" : `${km(state.kmLeft)} restantes`);
  return parts.join(" · ");
}

function addMonths(isoDate, months) {
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime()) || !months) return "";
  d.setMonth(d.getMonth() + Number(months));
  return localISODate(d);
}

function WarrantyFormModal({ initial, vehicles, fixedVehicle, onSaved, onClose }) {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [form, setForm] = useState({
    vehicleId: String(initial?.vehicleId ?? fixedVehicle?.id ?? ""),
    item: initial?.item ?? "",
    kind: initial?.kind ?? "part",
    vendor: initial?.vendor ?? "",
    invoiceFolio: initial?.invoiceFolio ?? "",
    startDate: initial?.startDate ?? localISODate(),
    endDate: initial?.endDate ?? "",
    kmStart: initial?.kmStart ?? "",
    kmLimit: initial?.kmLimit ?? "",
    notes: initial?.notes ?? "",
  });
  const [months, setMonths] = useState("");
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));
  const vehicle = vehicles.find((v) => String(v.id) === form.vehicleId);

  async function pickFile(input) {
    const picked = input.files?.[0];
    input.value = "";
    if (!picked) return;
    if (picked.size > DOCUMENT_MAX_MB * 1024 * 1024) return setError(`El archivo pesa más de ${DOCUMENT_MAX_MB} MB.`);
    if (!(await sniffDocumentType(picked))) return setError("El archivo no es un PDF ni una imagen JPG, PNG o WEBP.");
    setError("");
    return setFile(picked);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.item.trim() || !form.startDate) return setError("Escribe qué cubre la garantía y desde cuándo.");
    if (!form.endDate && !form.kmLimit) return setError("Indica hasta qué fecha o cuántos kilómetros cubre.");
    if (form.endDate && form.endDate < form.startDate) return setError("La fecha de fin no puede ser anterior al inicio.");
    setSaving(true);
    setError("");
    try {
      let documentUrl = initial?.documentUrl ?? null;
      if (file) {
        const mime = await sniffDocumentType(file);
        const path = `${profile.companyId}/warranties/${crypto.randomUUID()}.${DOCUMENT_EXTENSIONS[mime]}`;
        const { error: uploadError } = await supabase.storage.from("documents").upload(path, file, { contentType: mime });
        if (uploadError) throw uploadError;
        documentUrl = path;
      }
      const row = {
        vehicleId: form.vehicleId ? Number(form.vehicleId) : null,
        unit: vehicle?.unit ?? null,
        item: form.item.trim(),
        kind: form.kind,
        vendor: form.vendor.trim() || null,
        invoiceFolio: form.invoiceFolio.trim() || null,
        startDate: form.startDate,
        endDate: form.endDate || null,
        kmStart: form.kmLimit ? Number(form.kmStart) || Number(vehicle?.kmActual) || 0 : null,
        kmLimit: form.kmLimit ? Number(form.kmLimit) : null,
        notes: form.notes.trim() || null,
        documentUrl,
      };
      const query = initial?.id ? supabase.from("warranties").update(row).eq("id", initial.id) : supabase.from("warranties").insert({ ...row, companyId: profile.companyId });
      const { error: saveError } = await query;
      if (saveError) throw saveError;
      showToast(initial?.id ? "Garantía actualizada." : "Garantía registrada.");
      onSaved();
    } catch (err) {
      setError(`No se pudo guardar: ${err.message}`);
    } finally {
      setSaving(false);
    }
    return undefined;
  }

  return (
    <Modal title={initial?.id ? "Editar garantía" : "Registrar garantía"} width="max-w-lg" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className={labelClass}>¿Qué cubre?</label>
          <input value={form.item} onChange={set("item")} maxLength={200} placeholder="Ej. Batería LTH, motor, juego de llantas" autoFocus className={inputClass} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Tipo</label>
            <select value={form.kind} onChange={set("kind")} className={inputClass}>
              {WARRANTY_KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Unidad</label>
            <select value={form.vehicleId} onChange={set("vehicleId")} disabled={!!fixedVehicle} className={inputClass}>
              <option value="">Sin unidad (general)</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.unit} · {v.plate}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Proveedor o taller</label>
            <input value={form.vendor} onChange={set("vendor")} maxLength={160} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Folio de factura (opcional)</label>
            <input value={form.invoiceFolio} onChange={set("invoiceFolio")} maxLength={80} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Empieza</label>
            <input type="date" value={form.startDate} onChange={set("startDate")} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Termina</label>
            <input type="date" value={form.endDate} min={form.startDate} onChange={set("endDate")} className={inputClass} />
          </div>
          <div className="col-span-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
            O dura
            <input
              type="number"
              min="1"
              max="240"
              value={months}
              onChange={(e) => {
                setMonths(e.target.value);
                const end = addMonths(form.startDate, e.target.value);
                if (end) setForm((prev) => ({ ...prev, endDate: end }));
              }}
              aria-label="Duración en meses"
              className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-xs focus:border-blue-400 focus:outline-none"
            />
            meses (calcula la fecha de fin).
          </div>
          <div>
            <label className={labelClass}>Límite de kilómetros (opcional)</label>
            <input type="number" min="0" value={form.kmLimit} onChange={set("kmLimit")} placeholder="Ej. 20000" className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Kilometraje al iniciar</label>
            <input type="number" min="0" value={form.kmStart} onChange={set("kmStart")} disabled={!form.kmLimit} placeholder={vehicle ? String(vehicle.kmActual ?? "") : ""} className={`${inputClass} disabled:bg-slate-50`} />
          </div>
        </div>
        <div>
          <label className={labelClass}>Notas (opcional)</label>
          <textarea value={form.notes} onChange={set("notes")} rows={2} maxLength={2000} placeholder="Condiciones, a quién llamar, qué no cubre…" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Póliza o comprobante (PDF o imagen)</label>
          <label className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-500 hover:bg-slate-50">
            <span className="truncate">{file ? file.name : initial?.documentUrl ? "Ya tiene un documento. Elige otro para reemplazarlo." : "Elegir archivo"}</span>
            <input type="file" accept={DOCUMENT_ACCEPT} className="hidden" onChange={(e) => pickFile(e.target)} />
          </label>
        </div>
        {error && <p className="rounded-lg bg-rose-50 px-2.5 py-2 text-[11px] font-medium text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">
            Cancelar
          </button>
          <button type="submit" disabled={saving} className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ClaimModal({ warranty, onSaved, onClose }) {
  const { showToast } = useToast();
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase.from("warranties").update({ status: "claimed", claimNotes: notes.trim() }).eq("id", warranty.id);
    setSaving(false);
    if (error) showToast(`No se pudo guardar: ${error.message}`);
    else {
      showToast("Garantía marcada como reclamada.");
      onSaved();
    }
  }
  return (
    <Modal title="Reclamar garantía" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-xs text-slate-500">
          Deja constancia de que hiciste válida la garantía de <b className="text-slate-700">{warranty.item}</b>.
        </p>
        <div>
          <label className={labelClass}>¿Qué pasó y qué te resolvieron?</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={2000} autoFocus className={inputClass} />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">
            Cancelar
          </button>
          <button type="submit" disabled={saving || notes.trim().length < 3} className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
            {saving ? "Guardando…" : "Marcar como reclamada"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// Lista de garantías; con `vehicle` muestra solo las de esa unidad.
export function WarrantiesPanel({ vehicle = null }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { format } = useDateFormat();
  const { vehicles, isAdmin } = useFleetData();
  const [rows, setRows] = useState(null);
  const [missing, setMissing] = useState(false);
  const [filter, setFilter] = useState("current");
  const [form, setForm] = useState(null); // null | {} (nueva) | garantía a editar
  const [claiming, setClaiming] = useState(null);
  const [removing, setRemoving] = useState(null);
  const vehicleId = vehicle?.id ?? null;

  const load = useCallback(async () => {
    let query = supabase.from("warranties").select("*").order("endDate", { ascending: true, nullsFirst: false });
    if (vehicleId) query = query.eq("vehicleId", vehicleId);
    const { data, error } = await query;
    setMissing(!!error);
    setRows(data ?? []);
  }, [vehicleId]);

  useEffect(() => {
    load();
  }, [load]);

  const list = useMemo(
    () =>
      (rows ?? []).map((w) => {
        const unit = vehicles.find((v) => v.id === w.vehicleId) ?? null;
        return { ...w, vehicle: unit, state: warrantyState(w, unit) };
      }),
    [rows, vehicles]
  );
  const counts = useMemo(() => {
    const c = { active: 0, expiring: 0, expired: 0, claimed: 0, void: 0 };
    for (const w of list) c[w.state.id] += 1;
    return c;
  }, [list]);
  const shown = list.filter((w) => (filter === "all" ? true : filter === "current" ? w.state.id === "active" || w.state.id === "expiring" : w.state.id === filter));

  async function remove() {
    const { error } = await supabase.from("warranties").delete().eq("id", removing.id);
    if (error) showToast(`No se pudo eliminar: ${error.message}`);
    else {
      if (removing.documentUrl) supabase.storage.from("documents").remove([removing.documentUrl]).catch(() => {});
      showToast("Garantía eliminada.");
      load();
    }
    setRemoving(null);
  }

  const filters = [
    { id: "current", label: `Vigentes (${counts.active + counts.expiring})` },
    { id: "expiring", label: `Por vencer (${counts.expiring})` },
    { id: "expired", label: `Vencidas (${counts.expired})` },
    { id: "claimed", label: `Reclamadas (${counts.claimed})` },
    { id: "all", label: "Todas" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {filters.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${filter === f.id ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button onClick={() => setForm({})} disabled={missing} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          <Plus size={13} /> Registrar garantía
        </button>
      </div>

      {missing && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">Las garantías se activan al aplicar la actualización pendiente de la base de datos.</p>}
      {rows === null && <p className="py-6 text-center text-xs text-slate-400">Cargando…</p>}
      {rows !== null && shown.length === 0 && !missing && (
        <Empty>{list.length === 0 ? "Todavía no hay garantías registradas. Regístralas al comprar una refacción, una batería o un servicio: Navio te avisará antes de que venzan." : "No hay garantías en este filtro."}</Empty>
      )}

      <div className={vehicle ? "space-y-2" : "grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3"}>
        {shown.map((w) => {
          const meta = WARRANTY_STATES[w.state.id];
          const canEdit = isAdmin || w.createdBy === user?.id;
          return (
            <div key={w.id} className={`${card} shadow-sm`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-800">{w.item}</p>
                  <p className="truncate text-[11px] text-slate-400">
                    {WARRANTY_KINDS.find((k) => k.id === w.kind)?.label}
                    {!vehicle ? ` · ${w.vehicle ? w.vehicle.unit : w.unit || "Sin unidad"}` : ""}
                    {w.vendor ? ` · ${w.vendor}` : ""}
                  </p>
                </div>
                <Chip tone={meta.tone}>{meta.label}</Chip>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Field label="Vigencia" value={`${formatDate(w.startDate, format)} – ${w.endDate ? formatDate(w.endDate, format) : "sin fecha"}`} />
                <Field label={w.kmLimit ? "Kilómetros cubiertos" : "Folio"} value={w.kmLimit ? km(w.kmLimit) : w.invoiceFolio} />
              </div>
              {(w.state.id === "active" || w.state.id === "expiring" || w.state.id === "expired") && remainingText(w.state) && (
                <p className={`mt-2 text-[11px] font-semibold ${w.state.id === "active" ? "text-slate-500" : w.state.id === "expiring" ? "text-amber-700" : "text-rose-600"}`}>{remainingText(w.state)}</p>
              )}
              {w.notes && <p className="mt-2 break-words text-[11px] text-slate-500">{w.notes}</p>}
              {w.claimNotes && <p className="mt-2 break-words rounded-lg bg-blue-50 px-2.5 py-1.5 text-[11px] text-blue-800">Reclamo: {w.claimNotes}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {w.documentUrl && <DocumentCell documentUrl={w.documentUrl} />}
                {canEdit && (w.state.id === "active" || w.state.id === "expiring") && (
                  <button onClick={() => setClaiming(w)} className={smallButton}>
                    <CheckCircle2 size={12} /> Reclamar
                  </button>
                )}
                {canEdit && (
                  <button onClick={() => setForm(w)} className={smallButton}>
                    <Edit2 size={12} /> Editar
                  </button>
                )}
                {isAdmin && (
                  <button onClick={() => setRemoving(w)} aria-label={`Eliminar garantía de ${w.item}`} className="inline-flex items-center rounded-lg border border-rose-200 px-2 py-1.5 text-rose-600 hover:bg-rose-50">
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {form && (
        <WarrantyFormModal
          initial={form.id ? form : null}
          vehicles={vehicles}
          fixedVehicle={vehicle}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            load();
          }}
        />
      )}
      {claiming && (
        <ClaimModal
          warranty={claiming}
          onClose={() => setClaiming(null)}
          onSaved={() => {
            setClaiming(null);
            load();
          }}
        />
      )}
      {removing && <ConfirmModal title="Eliminar garantía" message={`¿Eliminar la garantía de "${removing.item}" y su documento? No se puede deshacer.`} confirmLabel="Eliminar" danger onConfirm={remove} onClose={() => setRemoving(null)} />}
    </div>
  );
}

export function WarrantiesPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
          <ShieldCheck size={20} className="text-blue-600" /> Garantías
        </h1>
        <p className="mt-1 text-sm text-slate-500">Lo que todavía está cubierto por el proveedor: refacciones, baterías, llantas, servicios y unidades. Terminan por fecha o por kilometraje, lo que pase primero.</p>
      </div>
      <WarrantiesPanel />
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Mantenimiento → detalle de una unidad                                 */
/* ---------------------------------------------------------------------- */

const MAINT_TABS = [
  { id: "service", label: "Servicio" },
  { id: "tires", label: "Llantas" },
  { id: "warranties", label: "Garantías" },
  { id: "history", label: "Historial" },
];

export function MaintenanceUnitDetail({ vehicle, onBack, onUpdate }) {
  const { isAdmin } = useFleetData();
  const [tab, setTab] = useState("service");
  const update = (patch, message) => onUpdate(vehicle.id, patch, message);
  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-700">
        <ArrowLeft size={16} /> Volver a Unidades
      </button>
      <div className="flex items-center gap-3">
        <VehiclePhoto src={vehicle.photo} alt={vehicle.unit} className="h-12 w-16 rounded-lg ring-1 ring-slate-200" iconSize={16} />
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            {vehicle.unit} <span className="font-medium text-slate-400">· {vehicle.plate}</span>
          </h2>
          <p className="flex items-center gap-1 text-xs text-slate-500">
            <Wrench size={12} /> Mantenimiento de esta unidad
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 rounded-xl bg-slate-100 p-1">
        {MAINT_TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold transition ${tab === t.id ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="max-w-3xl">
        {tab === "service" && <VehicleServiceTab vehicle={vehicle} canEdit={isAdmin} onUpdate={update} />}
        {tab === "tires" && <VehicleTiresTab vehicle={vehicle} canEdit={isAdmin} onUpdate={update} />}
        {tab === "warranties" && <WarrantiesPanel vehicle={vehicle} />}
        {tab === "history" && <VehicleHistoryTab vehicle={vehicle} />}
      </div>
    </div>
  );
}
