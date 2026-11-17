import { useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, ClipboardCheck, FileText, RotateCcw, Upload } from "lucide-react";
import { supabase, useAuth, useToast, useDateFormat, formatDate, formatMoney, profileCan } from "./NavioDashboard.jsx";
import { usePeople, personName } from "./people.jsx";

/* ---------------------------------------------------------------------- */
/*  Barras de proceso: de cada factura y de cada orden de trabajo         */
/* ---------------------------------------------------------------------- */

// Una barra de pasos. current: índice del paso en curso (los anteriores ya
// están hechos). tone: "rose" o "slate" para un final que no es el normal.
export function StepBar({ steps, current, done = false, tone = null, compact = false }) {
  return (
    <div className={compact ? "min-w-[150px]" : ""}>
      <div className="flex items-center gap-1" role="list" aria-label="Proceso">
        {steps.map((label, index) => {
          const passed = done || index < current;
          const active = !done && index === current;
          const color = tone === "rose" ? "bg-rose-500" : tone === "slate" ? "bg-slate-300" : passed ? "bg-emerald-500" : active ? "bg-blue-500" : "bg-slate-200";
          return <span key={label} role="listitem" aria-label={`${label}${passed ? " (hecho)" : active ? " (en curso)" : ""}`} className={`h-1.5 flex-1 rounded-full ${color}`} />;
        })}
      </div>
      {!compact && (
        <div className="mt-1 flex justify-between gap-1">
          {steps.map((label, index) => {
            const passed = done || index < current;
            const active = !done && index === current;
            return (
              <span key={label} className={`flex-1 truncate text-[10px] ${index === steps.length - 1 ? "text-right" : index === 0 ? "" : "text-center"} ${active ? "font-bold text-blue-700" : passed ? "font-medium text-emerald-700" : "text-slate-400"}`}>
                {label}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

const INVOICE_STEPS = ["Cargada", "Verificada", "Aprobada"];

// Dónde va una factura: cargada (falta verificar) → verificada (falta
// aprobar) → aprobada. Rechazada y anulada terminan el proceso.
export function invoiceStage(inv) {
  if (inv.status === "rejected") return { label: "Rechazada", current: 1, tone: "rose", done: true };
  if (inv.status === "voided") return { label: "Anulada", current: 1, tone: "slate", done: true };
  if (inv.approved) return { label: "Aprobada", current: 3, done: true };
  if (inv.status === "verified") return { label: "Por aprobar", current: 2 };
  return { label: "Por verificar", current: 1 };
}

export function InvoiceProgress({ invoice, compact = true, showLabel = true }) {
  const stage = invoiceStage(invoice);
  return (
    <div title={`Proceso: ${INVOICE_STEPS.join(" → ")}. Ahora: ${stage.label}`}>
      <StepBar steps={INVOICE_STEPS} current={stage.current} done={stage.done} tone={stage.tone} compact={compact} />
      {compact && showLabel && <p className={`mt-0.5 text-[10px] font-semibold ${stage.tone === "rose" ? "text-rose-600" : stage.done ? "text-emerald-700" : "text-blue-700"}`}>{stage.label}</p>}
    </div>
  );
}

export const ORDER_STAGES = {
  upload: { index: 0, label: "Pendiente de carga", hint: "Falta que quien carga suba todas las facturas.", className: "bg-amber-50 text-amber-700" },
  verification: { index: 1, label: "Pendiente de verificación", hint: "Ya están cargadas; falta que las verifique quien revisa facturas.", className: "bg-blue-50 text-blue-700" },
  analysis: { index: 2, label: "En análisis por garantías", hint: "Todo verificado; la persona asignada la está analizando.", className: "bg-violet-50 text-violet-700" },
  closed: { index: 3, label: "Cerrada", hint: "El análisis terminó.", className: "bg-emerald-50 text-emerald-700" },
};
const ORDER_STEPS = ["Carga", "Verificación", "Análisis", "Cerrada"];

export function OrderStageBar({ order, compact = false }) {
  const stage = ORDER_STAGES[order.stage] ?? ORDER_STAGES.upload;
  return <StepBar steps={ORDER_STEPS} current={stage.index} done={order.stage === "closed"} compact={compact} />;
}

/* ---------------------------------------------------------------------- */
/*  Órdenes de trabajo (garantías)                                        */
/* ---------------------------------------------------------------------- */

async function saveOrder(order, companyId, patch) {
  const query = order.id
    ? supabase.from("work_orders").update(patch).eq("id", order.id)
    : supabase.from("work_orders").insert({ companyId, project: order.project || "", code: order.code, ...patch });
  const { error } = await query;
  return error;
}

function OrderCard({ order, currency, canAssign, onChanged, onOpenInvoice }) {
  const { user, profile } = useAuth();
  const { people } = usePeople();
  const { format } = useDateFormat();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(order.analysisNotes ?? "");
  const [busy, setBusy] = useState(false);
  const stage = ORDER_STAGES[order.stage] ?? ORDER_STAGES.upload;
  const total = order.invoices.reduce((sum, inv) => sum + (Number(inv.amount) || 0), 0);
  const mine = order.assignedTo && order.assignedTo === user?.id;
  const isAdmin = !!(profile?.isSuperAdmin || profile?.companyRole === "admin");
  const reviewer = profileCan(profile, "invoices");

  async function apply(patch, message) {
    setBusy(true);
    const error = await saveOrder(order, profile.companyId, patch);
    setBusy(false);
    if (error) showToast(/column|does not exist/i.test(error.message) ? "Esta función se activa al aplicar la actualización v25 de la base de datos." : `No se pudo guardar: ${error.message}`);
    else {
      if (message) showToast(message);
      onChanged();
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-800">
            {order.code} {order.project && <span className="font-medium text-slate-400">· {order.project}</span>}
          </p>
          <p className="text-[11px] text-slate-500">
            {order.invoices.length} factura{order.invoices.length === 1 ? "" : "s"} · {formatMoney(total, currency)}
            {order.deadline && order.stage !== "closed" ? ` · vence ${formatDate(order.deadline, format)}` : ""}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${stage.className}`}>{stage.label}</span>
      </div>

      <div className="mt-3">
        <OrderStageBar order={order} />
        <p className="mt-1.5 text-[11px] text-slate-500">
          {order.stage === "verification" && order.missingDocs && !order.pendingVerification ? "A alguna factura le falta su documento o su monto: complétalo para que pase a análisis." : stage.hint}
        </p>
        {order.invoicesCompleteByName && <p className="text-[11px] text-slate-400">Facturas completas: avisó {order.invoicesCompleteByName}.</p>}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
          Analista de garantías
          <select
            value={order.assignedTo ?? ""}
            disabled={!canAssign || busy}
            onChange={(e) => apply({ assignedTo: e.target.value || null }, e.target.value ? "Orden asignada. Se le avisó a esa persona." : "Orden sin asignar.")}
            className="max-w-[180px] rounded-lg border border-slate-200 px-2 py-1 text-[11px] focus:border-blue-400 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500"
          >
            <option value="">Sin asignar</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {personName(p)}
              </option>
            ))}
          </select>
        </label>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {order.stage === "upload" && order.invoices.length > 0 && (
            <button onClick={() => apply({ invoicesComplete: true }, "Listo: la orden pasó a verificación.")} disabled={busy} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
              <Upload size={12} /> Ya cargué todas las facturas
            </button>
          )}
          {order.invoicesComplete && order.stage !== "closed" && (reviewer || mine) && (
            <button onClick={() => apply({ invoicesComplete: false }, "La orden regresó a carga.")} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
              <RotateCcw size={12} /> Regresar a carga
            </button>
          )}
          {order.stage === "closed" && (mine || isAdmin) && (
            <button onClick={() => apply({ analysisStatus: "open" }, "Análisis reabierto.")} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
              <RotateCcw size={12} /> Reabrir análisis
            </button>
          )}
          <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
            <FileText size={12} /> Facturas <ChevronDown size={12} className={`transition ${open ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {order.stage === "analysis" && (mine || isAdmin) && (
        <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50 p-3">
          <label className="mb-1 block text-[11px] font-semibold text-violet-700">Resultado del análisis (opcional)</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} className="w-full rounded-lg border border-violet-200 px-2.5 py-1.5 text-xs focus:border-violet-400 focus:outline-none" />
          <button onClick={() => apply({ analysisStatus: "done", analysisNotes: notes.trim() || null }, "Orden cerrada.")} disabled={busy} className="mt-2 inline-flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-violet-700 disabled:opacity-60">
            <ClipboardCheck size={12} /> Cerrar análisis
          </button>
        </div>
      )}
      {order.stage === "closed" && order.analysisNotes && <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{order.analysisNotes}</p>}

      {open && (
        <ul className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
          {order.invoices.length === 0 && <li className="text-xs text-slate-400">Todavía no hay facturas con esta orden.</li>}
          {order.invoices.map((inv) => (
            <li key={inv.key}>
              <button onClick={() => onOpenInvoice?.(inv)} className="flex w-full flex-wrap items-center gap-3 rounded-xl border border-slate-100 px-3 py-2 text-left hover:border-blue-200">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-slate-700">{inv.concept || inv.vendor || "Factura"}</span>
                  <span className="block text-[11px] text-slate-400">
                    {formatDate(inv.date, format)} · {formatMoney(inv.amount, currency)} · {inv.uploadedByName || "Sin identificar"}
                  </span>
                </span>
                <span className="w-40 shrink-0">
                  <InvoiceProgress invoice={inv} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const FILTERS = [
  { id: "mine", label: "Asignadas a mí", test: (o, me) => o.assignedTo === me && o.stage !== "closed" },
  { id: "open", label: "En proceso", test: (o) => o.stage !== "closed" },
  { id: "upload", label: "Pendiente de carga", test: (o) => o.stage === "upload" },
  { id: "verification", label: "Pendiente de verificación", test: (o) => o.stage === "verification" },
  { id: "analysis", label: "En análisis", test: (o) => o.stage === "analysis" },
  { id: "closed", label: "Cerradas", test: (o) => o.stage === "closed" },
];

export function WorkOrdersPage({ orders, onChanged, onOpenInvoice, focusId = null }) {
  const { user, profile } = useAuth();
  const currency = profile?.company?.currency || "MXN";
  const canAssign = profileCan(profile, "invoices");
  const hasMine = orders.some((o) => o.assignedTo === user?.id && o.stage !== "closed");
  const [filter, setFilter] = useState(hasMine ? "mine" : "open");
  const current = FILTERS.find((f) => f.id === filter) ?? FILTERS[1];
  const listed = useMemo(
    () =>
      orders
        .filter((o) => o.code)
        .filter((o) => (focusId ? o.id === focusId || current.test(o, user?.id) : current.test(o, user?.id)))
        .sort((a, b) => (ORDER_STAGES[a.stage]?.index ?? 0) - (ORDER_STAGES[b.stage]?.index ?? 0) || String(a.deadline ?? "9999").localeCompare(String(b.deadline ?? "9999"))),
    [orders, current, user?.id, focusId]
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Órdenes de trabajo</h1>
        <p className="mt-1 text-sm text-slate-500">El proceso de cada orden para garantías: carga de facturas, verificación y análisis.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const count = orders.filter((o) => o.code && f.test(o, user?.id)).length;
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${filter === f.id ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}
            >
              {f.label} <b className={filter === f.id ? "text-blue-100" : "text-slate-400"}>{count}</b>
            </button>
          );
        })}
      </div>
      {listed.length === 0 ? (
        <p className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-white py-10 text-center text-xs text-slate-400">
          <CheckCircle2 size={20} className="text-emerald-400" /> No hay órdenes en esta vista.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {listed.map((order) => (
            <OrderCard key={order.key} order={order} currency={currency} canAssign={canAssign} onChanged={onChanged} onOpenInvoice={onOpenInvoice} />
          ))}
        </div>
      )}
    </div>
  );
}
