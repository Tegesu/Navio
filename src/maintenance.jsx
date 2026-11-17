import { useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, Edit2, Eraser, Megaphone, Plus, Search, Trash2, Wrench, X } from "lucide-react";
import {
  supabase,
  useAuth,
  useToast,
  useDateFormat,
  useSessionState,
  formatDate,
  formatMoney,
  localISODate,
  Modal,
  ConfirmModal,
  DocumentCell,
  sniffDocumentType,
  DOCUMENT_EXTENSIONS,
  DOCUMENT_ACCEPT,
  DOCUMENT_MAX_MB,
} from "./NavioDashboard.jsx";

/* ---------------------------------------------------------------------- */
/*  Mantenimiento: buscador de servicios, campañas y programación         */
/* ---------------------------------------------------------------------- */

const inputClass = "h-9 w-full min-w-0 rounded-lg border border-slate-200 px-2.5 text-xs focus:border-blue-400 focus:outline-none";
const labelClass = "mb-1 block text-[11px] font-semibold text-slate-500";
const card = "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm";

export const SERVICE_CATEGORIES = [
  { id: "engine", label: "Motor y aceite" },
  { id: "brakes", label: "Frenos y balatas" },
  { id: "tires", label: "Llantas" },
  { id: "paperwork", label: "Trámites / guantera" },
];
export const COVERAGE = {
  none: { label: "Sin cobertura", className: "bg-slate-100 text-slate-600" },
  warranty: { label: "Garantía", className: "bg-emerald-50 text-emerald-700" },
  campaign: { label: "Campaña", className: "bg-violet-50 text-violet-700" },
};
export const SERVICE_STATUS = {
  scheduled: { label: "Programado", className: "bg-amber-50 text-amber-700" },
  in_progress: { label: "En proceso", className: "bg-blue-50 text-blue-700" },
  done: { label: "Terminado", className: "bg-emerald-50 text-emerald-700" },
};

const fold = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
const contains = (value, query) => fold(value).includes(fold(query));

// Los campos del buscador. "match" decide si un servicio coincide.
const SEARCH_FIELDS = [
  { id: "project", label: "Proyecto", list: "project", match: (r, q) => contains(r.project, q) },
  { id: "workOrder", label: "Número de orden", match: (r, q) => contains(r.workOrder, q) },
  { id: "claimNumber", label: "Número de reclamo", match: (r, q) => contains(r.claimNumber, q) },
  { id: "technician", label: "Técnico", list: "technician", match: (r, q) => contains(r.technician, q) },
  { id: "engineNumber", label: "Número de motor", match: (r, q) => contains(r.engineNumber, q) },
  { id: "componentNumber", label: "Número de componente", match: (r, q) => contains(r.componentNumber, q) },
  { id: "serviceStart", label: "Inicio de servicio (desde)", type: "date", match: (r, q) => !!r.serviceStart && r.serviceStart >= q },
  { id: "serviceEnd", label: "Término de servicio (hasta)", type: "date", match: (r, q) => !!r.serviceEnd && r.serviceEnd <= q },
  {
    id: "coverage",
    label: "Garantía o campaña",
    options: [
      { id: "warranty", label: "Garantía" },
      { id: "campaign", label: "Campaña" },
      { id: "none", label: "Sin cobertura" },
    ],
    match: (r, q) => (r.coverage || "none") === q,
  },
  { id: "campaignCode", label: "Identificación de campaña", list: "campaign", match: (r, q) => contains(r.campaignCode, q) },
  { id: "unit", label: "Unidad o placa", list: "unit", match: (r, q) => contains(r.unit, q) || contains(r.plate, q) },
  { id: "vendor", label: "Taller o proveedor", list: "vendor", match: (r, q) => contains(r.vendor, q) },
  { id: "category", label: "Tipo de servicio", options: SERVICE_CATEGORIES, match: (r, q) => r.category === q },
  {
    id: "serviceStatus",
    label: "Estado del servicio",
    options: Object.entries(SERVICE_STATUS).map(([id, s]) => ({ id, label: s.label })),
    match: (r, q) => (r.serviceStatus || "done") === q,
  },
  { id: "invoiceFolio", label: "Folio de factura", match: (r, q) => contains(r.invoiceFolio, q) },
];

const SEARCH_KEY = "navio.maintenance.search.v1";

// Para que otra pantalla (por ejemplo, una campaña) abra el buscador ya filtrado.
export function presetMaintenanceSearch(applied) {
  try {
    window.sessionStorage.setItem(SEARCH_KEY, JSON.stringify({ draft: applied, applied }));
  } catch {
    // Sin almacenamiento: el buscador abre vacío.
  }
}

function Chip({ className, children }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${className}`}>{children}</span>;
}

function SearchField({ field, value, onChange, onSearch, onClear, options }) {
  const id = `ms-${field.id}`;
  const control = field.options ? (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
      <option value="">Cualquiera</option>
      {field.options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  ) : (
    <input
      id={id}
      type={field.type ?? "text"}
      value={value}
      list={field.list ? `ms-list-${field.list}` : undefined}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onSearch();
        }
      }}
      maxLength={120}
      className={inputClass}
    />
  );
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={labelClass}>
        {field.label}
      </label>
      <div className="flex items-stretch gap-1.5">
        {control}
        <button
          type="button"
          onClick={onSearch}
          title={`Buscar por ${field.label.toLowerCase()}`}
          className="flex h-9 shrink-0 items-center justify-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
        >
          <Search size={12} /> Buscar
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={!value}
          title={`Borrar ${field.label.toLowerCase()}`}
          className="flex h-9 shrink-0 items-center justify-center gap-1 rounded-lg border border-slate-200 px-2.5 text-[11px] font-semibold text-slate-500 hover:bg-slate-50 disabled:opacity-40"
        >
          <Eraser size={12} /> Borrar
        </button>
      </div>
      {options && (
        <datalist id={`ms-list-${field.list}`}>
          {options.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      )}
    </div>
  );
}

const fieldLabel = (id) => SEARCH_FIELDS.find((f) => f.id === id)?.label ?? id;
function appliedText(id, value) {
  const field = SEARCH_FIELDS.find((f) => f.id === id);
  if (field?.options) return field.options.find((o) => o.id === value)?.label ?? value;
  return value;
}

export function MaintenanceSearchPage({ records, vehicles, campaigns = [], onOpenRecord, onAdd }) {
  const { format } = useDateFormat();
  const { profile } = useAuth();
  const currency = profile?.company?.currency || "MXN";
  const [state, setState] = useSessionState(SEARCH_KEY, { draft: {}, applied: {} });
  const draft = state.draft ?? {};
  const applied = state.applied ?? {};

  const lists = useMemo(() => {
    const uniq = (values) => [...new Set(values.map((v) => String(v ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")).slice(0, 200);
    return {
      project: uniq(records.map((r) => r.project)),
      technician: uniq(records.map((r) => r.technician)),
      vendor: uniq(records.map((r) => r.vendor)),
      campaign: uniq([...campaigns.map((c) => c.code), ...records.map((r) => r.campaignCode)]),
      unit: uniq(vehicles.map((v) => v.unit)),
    };
  }, [records, vehicles, campaigns]);

  const setDraft = (id, value) => setState((prev) => ({ ...prev, draft: { ...(prev.draft ?? {}), [id]: value } }));
  const search = (id) =>
    setState((prev) => {
      const value = String(prev.draft?.[id] ?? "").trim();
      const next = { ...(prev.applied ?? {}) };
      if (value) next[id] = value;
      else delete next[id];
      return { ...prev, applied: next };
    });
  const clear = (id) =>
    setState((prev) => {
      const nextDraft = { ...(prev.draft ?? {}) };
      const nextApplied = { ...(prev.applied ?? {}) };
      delete nextDraft[id];
      delete nextApplied[id];
      return { draft: nextDraft, applied: nextApplied };
    });
  const searchAll = () =>
    setState((prev) => ({
      ...prev,
      applied: Object.fromEntries(Object.entries(prev.draft ?? {}).filter(([, v]) => String(v ?? "").trim()).map(([k, v]) => [k, String(v).trim()])),
    }));
  const clearAll = () => setState({ draft: {}, applied: {} });

  const activeIds = Object.keys(applied);
  const results = useMemo(() => {
    if (activeIds.length === 0) return [];
    return records
      .filter((r) => activeIds.every((id) => SEARCH_FIELDS.find((f) => f.id === id)?.match(r, applied[id]) ?? true))
      .sort((a, b) => String(b.serviceStart || b.date || "").localeCompare(String(a.serviceStart || a.date || "")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, JSON.stringify(applied)]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Mantenimiento</h1>
          <p className="mt-1 text-sm text-slate-500">Busca servicios por cualquiera de estos datos. Escribe en un campo y presiona "Buscar"; los resultados aparecen abajo.</p>
        </div>
        <button onClick={onAdd} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700">
          <Plus size={15} /> Registrar servicio
        </button>
      </div>

      <div className={card}>
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2 2xl:grid-cols-3">
          {SEARCH_FIELDS.map((field) => (
            <SearchField
              key={field.id}
              field={field}
              value={draft[field.id] ?? ""}
              onChange={(value) => setDraft(field.id, value)}
              onSearch={() => search(field.id)}
              onClear={() => clear(field.id)}
              options={field.list ? lists[field.list] : null}
            />
          ))}
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
          <button onClick={clearAll} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100">
            Borrar todo
          </button>
          <button onClick={searchAll} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
            <Search size={13} /> Buscar con todos los campos
          </button>
        </div>
      </div>

      <div className={`${card} p-0`}>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="mr-auto text-sm font-bold text-slate-800">Resultados {activeIds.length > 0 && <span className="font-normal text-slate-400">({results.length})</span>}</h2>
          {activeIds.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 rounded-full bg-blue-50 py-0.5 pl-2.5 pr-1 text-[11px] font-medium text-blue-700">
              {fieldLabel(id)}: <b>{appliedText(id, applied[id])}</b>
              <button onClick={() => clear(id)} aria-label={`Quitar ${fieldLabel(id)}`} className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-blue-100">
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
        {activeIds.length === 0 ? (
          <p className="px-4 py-10 text-center text-xs text-slate-400">Llena al menos un campo y presiona "Buscar" para ver los servicios que coinciden.</p>
        ) : results.length === 0 ? (
          <p className="px-4 py-10 text-center text-xs text-slate-400">Ningún servicio coincide con esa búsqueda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                  {["No. de reclamo", "Unidad", "Proyecto", "Orden", "Técnico", "Inicio", "Término", "Cobertura", "Estado", "Monto"].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-2.5 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.map((r) => {
                  const coverage = COVERAGE[r.coverage || "none"] ?? COVERAGE.none;
                  const status = SERVICE_STATUS[r.serviceStatus || "done"] ?? SERVICE_STATUS.done;
                  return (
                    <tr key={r.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                      <td className="whitespace-nowrap px-4 py-2.5">
                        <button onClick={() => onOpenRecord(r)} className="font-semibold text-blue-600 underline-offset-2 hover:underline">
                          {r.claimNumber || `Sin número (#${r.id})`}
                        </button>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 font-medium text-slate-700">{r.unit || "—"}</td>
                      <td className="px-4 py-2.5 text-slate-600">{r.project || "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{r.workOrder || "—"}</td>
                      <td className="px-4 py-2.5 text-slate-600">{r.technician || "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">{r.serviceStart ? formatDate(r.serviceStart, format) : "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">{r.serviceEnd ? formatDate(r.serviceEnd, format) : "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2.5">
                        <Chip className={coverage.className}>{coverage.label}</Chip>
                        {r.campaignCode && <span className="ml-1 text-[11px] text-slate-400">{r.campaignCode}</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5">
                        <Chip className={status.className}>{status.label}</Chip>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold text-slate-700">{r.amount ? formatMoney(r.amount, currency) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Detalle de un servicio                                                */
/* ---------------------------------------------------------------------- */

function Detail({ label, value }) {
  return (
    <div className="min-w-0 rounded-xl bg-slate-50 px-3 py-2">
      <p className="text-[11px] font-medium text-slate-400">{label}</p>
      <p className="break-words text-xs font-semibold text-slate-700">{value || "—"}</p>
    </div>
  );
}

export function ServiceDetailModal({ record, onClose, onEdit, onConfirm }) {
  const { format } = useDateFormat();
  const { profile } = useAuth();
  const currency = profile?.company?.currency || "MXN";
  const coverage = COVERAGE[record.coverage || "none"] ?? COVERAGE.none;
  const status = SERVICE_STATUS[record.serviceStatus || "done"] ?? SERVICE_STATUS.done;
  const category = SERVICE_CATEGORIES.find((c) => c.id === record.category)?.label;
  const date = (value) => (value ? formatDate(value, format) : "");

  return (
    <Modal title={`Servicio ${record.claimNumber ? `· reclamo ${record.claimNumber}` : `#${record.id}`}`} width="max-w-2xl" onClose={onClose}>
      <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
        <div className="flex flex-wrap items-center gap-2">
          <Chip className={status.className}>{status.label}</Chip>
          <Chip className={coverage.className}>{coverage.label}</Chip>
          {record.status === "pending" && <Chip className="bg-amber-50 text-amber-700">Datos por verificar</Chip>}
          <span className="text-[11px] text-slate-400">Registrado el {date(record.date)}</span>
        </div>
        <section>
          <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Servicio</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Detail label="Unidad" value={[record.unit, record.plate].filter(Boolean).join(" · ")} />
            <Detail label="Tipo de servicio" value={category} />
            <Detail label="Concepto" value={record.concept} />
            <Detail label="Taller o proveedor" value={record.vendor} />
            <Detail label="Técnico" value={record.technician} />
            <Detail label="Kilometraje" value={record.odometerKm ? `${Number(record.odometerKm).toLocaleString("es-MX")} km` : ""} />
          </div>
        </section>
        <section>
          <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Identificación</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Detail label="Proyecto" value={record.project} />
            <Detail label="Número de orden" value={record.workOrder} />
            <Detail label="Número de reclamo" value={record.claimNumber} />
            <Detail label="Número de motor" value={record.engineNumber} />
            <Detail label="Número de componente" value={record.componentNumber} />
            <Detail label="Identificación de campaña" value={record.campaignCode} />
          </div>
        </section>
        <section>
          <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Fechas e importe</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Detail label="Inicio de servicio" value={date(record.serviceStart)} />
            <Detail label="Término de servicio" value={date(record.serviceEnd)} />
            <Detail label="Monto" value={record.amount ? formatMoney(record.amount, currency) : ""} />
            <Detail label="Folio de factura" value={record.invoiceFolio} />
          </div>
        </section>
        {record.notes && (
          <section>
            <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Notas</h3>
            <p className="whitespace-pre-wrap break-words rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">{record.notes}</p>
          </section>
        )}
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-slate-500">Documento:</span>
          <DocumentCell documentUrl={record.documentUrl} />
        </div>
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
        {record.status === "pending" && onConfirm && (
          <button onClick={() => onConfirm(record)} className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100">
            <CheckCircle2 size={13} /> Verificar datos
          </button>
        )}
        {onEdit && (
          <button onClick={() => onEdit(record)} className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
            <Edit2 size={13} /> Editar
          </button>
        )}
        <button onClick={onClose} className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
          Cerrar
        </button>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------------- */
/*  Campos del servicio dentro del formulario de registro                 */
/* ---------------------------------------------------------------------- */

export const EMPTY_SERVICE = {
  project: "",
  workOrder: "",
  claimNumber: "",
  technician: "",
  engineNumber: "",
  componentNumber: "",
  serviceStart: "",
  serviceEnd: "",
  coverage: "none",
  campaignCode: "",
  odometerKm: "",
  serviceStatus: "done",
};

export function serviceFromRecord(record) {
  const out = { ...EMPTY_SERVICE };
  for (const key of Object.keys(EMPTY_SERVICE)) if (record?.[key] !== undefined && record?.[key] !== null) out[key] = String(record[key]);
  return out;
}

// Lo que se guarda: textos recortados, vacíos como null, números como número.
export function cleanService(service) {
  const text = (v) => String(v ?? "").trim() || null;
  return {
    project: text(service.project),
    workOrder: text(service.workOrder),
    claimNumber: text(service.claimNumber),
    technician: text(service.technician),
    engineNumber: text(service.engineNumber),
    componentNumber: text(service.componentNumber),
    serviceStart: service.serviceStart || null,
    serviceEnd: service.serviceEnd || null,
    coverage: service.coverage || "none",
    campaignCode: service.coverage === "campaign" ? text(service.campaignCode) : null,
    odometerKm: service.odometerKm === "" || service.odometerKm == null ? null : Math.max(0, Math.round(Number(service.odometerKm) || 0)),
    serviceStatus: service.serviceStatus || "done",
  };
}

export function serviceProblem(service) {
  if (service.serviceStart && service.serviceEnd && service.serviceEnd < service.serviceStart) return "La fecha de término no puede ser anterior a la de inicio.";
  if (service.coverage === "campaign" && !String(service.campaignCode ?? "").trim()) return "Escribe la identificación de la campaña.";
  return "";
}

export function MaintenanceServiceFields({ value, onChange, projectOptions = [], campaigns = [] }) {
  const set = (key) => (e) => onChange({ ...value, [key]: e.target.value });
  const field = "w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-blue-400 focus:outline-none";
  return (
    <fieldset className="space-y-3 rounded-xl border border-slate-200 p-3">
      <legend className="px-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">Datos del servicio</legend>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Estado del servicio</label>
          <select value={value.serviceStatus} onChange={set("serviceStatus")} className={field}>
            {Object.entries(SERVICE_STATUS).map(([id, s]) => (
              <option key={id} value={id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Proyecto</label>
          <input list="ms-form-projects" value={value.project} onChange={set("project")} maxLength={200} placeholder="Ej. Tren Maya" className={field} />
          <datalist id="ms-form-projects">
            {projectOptions.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </div>
        <div>
          <label className={labelClass}>Número de orden</label>
          <input value={value.workOrder} onChange={set("workOrder")} maxLength={100} placeholder="Ej. OT24053" className={field} />
        </div>
        <div>
          <label className={labelClass}>Número de reclamo</label>
          <input value={value.claimNumber} onChange={set("claimNumber")} maxLength={100} placeholder="Ej. RC-1029" className={field} />
        </div>
        <div>
          <label className={labelClass}>Técnico</label>
          <input value={value.technician} onChange={set("technician")} maxLength={200} className={field} />
        </div>
        <div>
          <label className={labelClass}>Kilometraje al servicio</label>
          <input type="number" min="0" value={value.odometerKm} onChange={set("odometerKm")} className={field} />
        </div>
        <div>
          <label className={labelClass}>Número de motor</label>
          <input value={value.engineNumber} onChange={set("engineNumber")} maxLength={100} className={field} />
        </div>
        <div>
          <label className={labelClass}>Número de componente</label>
          <input value={value.componentNumber} onChange={set("componentNumber")} maxLength={100} className={field} />
        </div>
        <div>
          <label className={labelClass}>Inicio de servicio</label>
          <input type="date" value={value.serviceStart} onChange={set("serviceStart")} className={field} />
        </div>
        <div>
          <label className={labelClass}>Término de servicio</label>
          <input type="date" value={value.serviceEnd} min={value.serviceStart || undefined} onChange={set("serviceEnd")} className={field} />
        </div>
        <div>
          <label className={labelClass}>Garantía o campaña</label>
          <select value={value.coverage} onChange={set("coverage")} className={field}>
            <option value="none">Sin cobertura</option>
            <option value="warranty">Garantía</option>
            <option value="campaign">Campaña</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>Identificación de campaña</label>
          <input
            list="ms-form-campaigns"
            value={value.campaignCode}
            onChange={set("campaignCode")}
            disabled={value.coverage !== "campaign"}
            maxLength={100}
            placeholder={value.coverage === "campaign" ? "Ej. CAMP-2026-04" : "Solo para campañas"}
            className={`${field} disabled:bg-slate-50 disabled:text-slate-400`}
          />
          <datalist id="ms-form-campaigns">
            {campaigns.map((c) => (
              <option key={c.id} value={c.code}>
                {c.title}
              </option>
            ))}
          </datalist>
        </div>
      </div>
    </fieldset>
  );
}

/* ---------------------------------------------------------------------- */
/*  Programación: servicios programados                                   */
/* ---------------------------------------------------------------------- */

export function ScheduledServices({ records, onOpenRecord, onSchedule }) {
  const { format } = useDateFormat();
  const today = localISODate();
  const upcoming = records
    .filter((r) => (r.serviceStatus || "done") !== "done")
    .sort((a, b) => String(a.serviceStart || "9999").localeCompare(String(b.serviceStart || "9999")));
  return (
    <div className={card}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
            <CalendarClock size={15} className="text-blue-600" /> Servicios programados y en proceso
          </h2>
          <p className="text-xs text-slate-500">Lo que ya tiene fecha. Al terminarlo, cambia su estado a "Terminado".</p>
        </div>
        <button onClick={onSchedule} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
          <Plus size={13} /> Programar servicio
        </button>
      </div>
      {upcoming.length === 0 ? (
        <p className="rounded-xl bg-slate-50 px-3 py-6 text-center text-xs text-slate-400">No hay servicios programados.</p>
      ) : (
        <ul className="space-y-1.5">
          {upcoming.map((r) => {
            const late = r.serviceStart && r.serviceStart < today && (r.serviceStatus || "done") === "scheduled";
            const status = SERVICE_STATUS[r.serviceStatus] ?? SERVICE_STATUS.scheduled;
            return (
              <li key={r.id}>
                <button onClick={() => onOpenRecord(r)} className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-slate-100 px-3 py-2 text-left hover:border-blue-200 hover:bg-blue-50/40">
                  <Wrench size={14} className="shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-slate-700">
                      {r.unit || "Sin unidad"} · {r.concept || "Servicio"}
                    </span>
                    <span className={`block text-[11px] ${late ? "font-semibold text-rose-600" : "text-slate-400"}`}>
                      {r.serviceStart ? `${late ? "Debió empezar el" : "Empieza el"} ${formatDate(r.serviceStart, format)}` : "Sin fecha"}
                      {r.technician ? ` · ${r.technician}` : ""}
                      {r.claimNumber ? ` · reclamo ${r.claimNumber}` : ""}
                    </span>
                  </span>
                  <Chip className={status.className}>{status.label}</Chip>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Campañas de servicio                                                  */
/* ---------------------------------------------------------------------- */

function CampaignFormModal({ initial, onSaved, onClose }) {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [form, setForm] = useState({
    code: initial?.code ?? "",
    title: initial?.title ?? "",
    manufacturer: initial?.manufacturer ?? "",
    affectedUnits: initial?.affectedUnits ?? "",
    description: initial?.description ?? "",
    startDate: initial?.startDate ?? localISODate(),
    endDate: initial?.endDate ?? "",
  });
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));
  const field = "w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-blue-400 focus:outline-none";

  async function pickFile(input) {
    const picked = input.files?.[0];
    input.value = "";
    if (!picked) return undefined;
    if (picked.size > DOCUMENT_MAX_MB * 1024 * 1024) return setError(`El archivo pesa más de ${DOCUMENT_MAX_MB} MB.`);
    if (!(await sniffDocumentType(picked))) return setError("El archivo no es un PDF ni una imagen JPG, PNG o WEBP.");
    setError("");
    return setFile(picked);
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.code.trim() || !form.title.trim()) return setError("Escribe la identificación y el nombre de la campaña.");
    if (form.endDate && form.startDate && form.endDate < form.startDate) return setError("La fecha de fin no puede ser anterior al inicio.");
    setSaving(true);
    setError("");
    try {
      let documentUrl = initial?.documentUrl ?? null;
      if (file) {
        const mime = await sniffDocumentType(file);
        const path = `${profile.companyId}/campaigns/${crypto.randomUUID()}.${DOCUMENT_EXTENSIONS[mime]}`;
        const { error: uploadError } = await supabase.storage.from("documents").upload(path, file, { contentType: mime });
        if (uploadError) throw uploadError;
        documentUrl = path;
      }
      const row = {
        code: form.code.trim().toUpperCase(),
        title: form.title.trim(),
        manufacturer: form.manufacturer.trim() || null,
        affectedUnits: form.affectedUnits.trim() || null,
        description: form.description.trim() || null,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        documentUrl,
      };
      const { error: saveError } = initial?.id
        ? await supabase.from("service_campaigns").update(row).eq("id", initial.id)
        : await supabase.from("service_campaigns").insert({ ...row, companyId: profile.companyId });
      if (saveError) throw saveError;
      showToast(initial?.id ? "Campaña actualizada." : "Campaña registrada.");
      onSaved();
    } catch (err) {
      setError(/duplicate|unique/i.test(err.message) ? "Ya existe una campaña con esa identificación." : `No se pudo guardar: ${err.message}`);
    } finally {
      setSaving(false);
    }
    return undefined;
  }

  return (
    <Modal title={initial?.id ? "Editar campaña" : "Registrar campaña"} width="max-w-lg" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Identificación de la campaña</label>
            <input value={form.code} onChange={set("code")} maxLength={100} placeholder="Ej. CAMP-2026-04" autoFocus className={field} />
          </div>
          <div>
            <label className={labelClass}>Fabricante o marca</label>
            <input value={form.manufacturer} onChange={set("manufacturer")} maxLength={150} placeholder="Ej. Kenworth" className={field} />
          </div>
        </div>
        <div>
          <label className={labelClass}>Nombre</label>
          <input value={form.title} onChange={set("title")} maxLength={200} placeholder="Ej. Revisión del sistema de frenos" className={field} />
        </div>
        <div>
          <label className={labelClass}>Unidades o modelos que aplica</label>
          <input value={form.affectedUnits} onChange={set("affectedUnits")} maxLength={500} placeholder="Ej. T680 2021–2023" className={field} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Inicio</label>
            <input type="date" value={form.startDate} onChange={set("startDate")} className={field} />
          </div>
          <div>
            <label className={labelClass}>Fin (opcional)</label>
            <input type="date" value={form.endDate} min={form.startDate || undefined} onChange={set("endDate")} className={field} />
          </div>
        </div>
        <div>
          <label className={labelClass}>Descripción (opcional)</label>
          <textarea value={form.description} onChange={set("description")} rows={3} maxLength={4000} className={field} />
        </div>
        <div>
          <label className={labelClass}>Boletín o documento (PDF o imagen)</label>
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

export function CampaignsPage({ campaigns, records, isAdmin, missing, onChanged, onSearchServices }) {
  const { user } = useAuth();
  const { format } = useDateFormat();
  const { showToast } = useToast();
  const [form, setForm] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [filter, setFilter] = useState("active");

  const serviceCount = (code) => records.filter((r) => String(r.campaignCode ?? "").toUpperCase() === String(code).toUpperCase()).length;
  const listed = campaigns
    .filter((c) => filter === "all" || c.status === filter)
    .sort((a, b) => String(b.startDate ?? "").localeCompare(String(a.startDate ?? "")));

  async function setStatus(campaign, status) {
    const { error } = await supabase.from("service_campaigns").update({ status }).eq("id", campaign.id);
    if (error) showToast(`No se pudo actualizar: ${error.message}`);
    else onChanged();
  }

  async function remove() {
    const { error } = await supabase.from("service_campaigns").delete().eq("id", removing.id);
    if (error) showToast(`No se pudo eliminar: ${error.message}`);
    else {
      if (removing.documentUrl) supabase.storage.from("documents").remove([removing.documentUrl]).catch(() => {});
      showToast("Campaña eliminada.");
      onChanged();
    }
    setRemoving(null);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
            <Megaphone size={20} className="text-violet-600" /> Campañas de servicio
          </h1>
          <p className="mt-1 text-sm text-slate-500">Llamados del fabricante para revisar o corregir una pieza. Registra cada campaña y liga a ella los servicios que se hicieron.</p>
        </div>
        <button onClick={() => setForm({})} disabled={missing} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50">
          <Plus size={15} /> Registrar campaña
        </button>
      </div>
      {missing && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">Las campañas se activan al aplicar la actualización pendiente de la base de datos.</p>}

      <div className="flex flex-wrap gap-2">
        {[
          { id: "active", label: "Vigentes" },
          { id: "closed", label: "Cerradas" },
          { id: "all", label: "Todas" },
        ].map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${filter === f.id ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {listed.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-xs text-slate-400">
          {campaigns.length === 0 ? "Todavía no hay campañas registradas." : "No hay campañas en este filtro."}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {listed.map((c) => {
            const count = serviceCount(c.code);
            const canEdit = isAdmin || c.createdBy === user?.id;
            return (
              <div key={c.id} className={card}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-violet-600">{c.code}</p>
                    <p className="break-words text-sm font-bold text-slate-800">{c.title}</p>
                    <p className="truncate text-[11px] text-slate-400">{[c.manufacturer, c.affectedUnits].filter(Boolean).join(" · ") || "Sin datos del fabricante"}</p>
                  </div>
                  <Chip className={c.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}>{c.status === "active" ? "Vigente" : "Cerrada"}</Chip>
                </div>
                {c.description && <p className="mt-2 line-clamp-3 whitespace-pre-wrap break-words text-xs text-slate-500">{c.description}</p>}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Detail label="Vigencia" value={`${c.startDate ? formatDate(c.startDate, format) : "—"} – ${c.endDate ? formatDate(c.endDate, format) : "sin fecha"}`} />
                  <Detail label="Servicios hechos" value={String(count)} />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <button
                    onClick={() => onSearchServices(c.code)}
                    className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
                  >
                    <Search size={12} /> Ver servicios
                  </button>
                  {c.documentUrl && <DocumentCell documentUrl={c.documentUrl} />}
                  {canEdit && (
                    <button onClick={() => setForm(c)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
                      <Edit2 size={12} /> Editar
                    </button>
                  )}
                  {canEdit && (
                    <button
                      onClick={() => setStatus(c, c.status === "active" ? "closed" : "active")}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      {c.status === "active" ? "Cerrar campaña" : "Reabrir"}
                    </button>
                  )}
                  {isAdmin && (
                    <button onClick={() => setRemoving(c)} aria-label={`Eliminar campaña ${c.code}`} className="inline-flex items-center rounded-lg border border-rose-200 px-2 py-1.5 text-rose-600 hover:bg-rose-50">
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {form && (
        <CampaignFormModal
          initial={form.id ? form : null}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            onChanged();
          }}
        />
      )}
      {removing && (
        <ConfirmModal
          title="Eliminar campaña"
          message={`¿Eliminar la campaña "${removing.code}"? Los servicios que la mencionan no se borran. No se puede deshacer.`}
          confirmLabel="Eliminar"
          danger
          onConfirm={remove}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}
