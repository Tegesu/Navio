import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, PauseCircle, ShieldCheck } from "lucide-react";
import { supabase, useToast, ConfirmModal, KpiCard, PillTabs, timeAgoLabel } from "./NavioDashboard.jsx";

/* ---------------------------------------------------------------------- */
/*  Super-administrador: empresas y solicitudes de privacidad             */
/* ---------------------------------------------------------------------- */

const STATUS_META = {
  pending: { label: "Pendiente", className: "bg-amber-50 text-amber-700 ring-1 ring-amber-200" },
  approved: { label: "Activa", className: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" },
  suspended: { label: "Suspendida", className: "bg-slate-100 text-slate-600 ring-1 ring-slate-300" },
  rejected: { label: "Rechazada", className: "bg-rose-50 text-rose-700 ring-1 ring-rose-200" },
};
const FILTERS = [
  { id: "pending", label: "Pendientes" },
  { id: "approved", label: "Activas" },
  { id: "suspended", label: "Suspendidas" },
  { id: "rejected", label: "Rechazadas" },
  { id: "all", label: "Todas" },
];
const actionButton = "rounded-lg border px-3 py-1.5 text-[11px] font-semibold disabled:opacity-60";

function CompaniesPanel() {
  const { showToast } = useToast();
  const [companies, setCompanies] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [filter, setFilter] = useState("pending");
  const [busyId, setBusyId] = useState(null);
  const [confirm, setConfirm] = useState(null); // { company, status }

  const load = useCallback(async () => {
    let { data, error } = await supabase.rpc("admin_list_companies");
    // Antes de la actualización de la base de datos esa función no existe.
    if (error) ({ data, error } = await supabase.from("companies").select("*").order("createdAt", { ascending: false }));
    setLoadError(error?.message ?? "");
    setCompanies(data ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const c = { pending: 0, approved: 0, suspended: 0, rejected: 0 };
    for (const company of companies ?? []) if (c[company.status] !== undefined) c[company.status] += 1;
    return c;
  }, [companies]);
  const shown = (companies ?? []).filter((c) => filter === "all" || c.status === filter);

  async function run(company, label, call) {
    setBusyId(company.id);
    const { data, error } = await call();
    setBusyId(null);
    if (error) showToast(`No se pudo ${label}: ${error.message}`);
    else {
      showToast(typeof data === "string" && data ? `${company.name} aprobada. Código de invitación: ${data}` : `${company.name}: listo.`);
      load();
    }
  }
  const approve = (company) => run(company, "aprobar", () => supabase.rpc("approve_company", { target_company_id: company.id }));
  const setStatus = (company, status) => run(company, "cambiar el estado", () => supabase.rpc("set_company_status", { target_company_id: company.id, new_status: status }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard widget={{ label: "Pendientes", value: counts.pending, detail: "Por revisar", icon: Clock, tone: "amber" }} />
        <KpiCard widget={{ label: "Activas", value: counts.approved, detail: "Con acceso", icon: CheckCircle2, tone: "emerald" }} />
        <KpiCard widget={{ label: "Suspendidas", value: counts.suspended, detail: "Acceso en pausa", icon: PauseCircle, tone: "slate" }} />
        <KpiCard widget={{ label: "Rechazadas", value: counts.rejected, detail: "Solicitud denegada", icon: AlertTriangle, tone: "rose" }} />
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${filter === f.id ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loadError && <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-600">No se pudo cargar la lista de empresas: {loadError}</p>}
      {companies === null ? (
        <p className="py-10 text-center text-xs text-slate-400">Cargando empresas…</p>
      ) : shown.length === 0 ? (
        <p className="py-10 text-center text-xs text-slate-400">No hay empresas en este filtro.</p>
      ) : (
        <div className="space-y-3">
          {shown.map((c) => {
            const meta = STATUS_META[c.status] ?? STATUS_META.pending;
            const busy = busyId === c.id;
            return (
              <div key={c.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-bold text-slate-800">{c.name}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.className}`}>{meta.label}</span>
                      {c.members !== undefined && (
                        <span className="text-[11px] text-slate-400">
                          {c.members} persona{Number(c.members) === 1 ? "" : "s"}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {c.industry || "Giro sin especificar"} · {c.fleetSize || "Flotilla sin especificar"}
                    </p>
                    <p className="mt-1 break-words text-xs text-slate-500">
                      {c.contactName || "Sin contacto"} · {c.contactEmail || "sin correo"} · {c.contactPhone || "sin teléfono"}
                    </p>
                    {c.needs && <p className="mt-2 break-words rounded-lg bg-slate-50 p-2 text-xs text-slate-600">"{c.needs}"</p>}
                    {c.status === "approved" && c.inviteCode && (
                      <p className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700">
                        <ShieldCheck size={12} /> Código de invitación: <span className="select-all font-mono">{c.inviteCode}</span>
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {(c.status === "pending" || c.status === "rejected") && (
                      <button onClick={() => approve(c)} disabled={busy} className={`${actionButton} border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}>
                        Aprobar
                      </button>
                    )}
                    {c.status === "pending" && (
                      <button onClick={() => setConfirm({ company: c, status: "rejected" })} disabled={busy} className={`${actionButton} border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100`}>
                        Rechazar
                      </button>
                    )}
                    {c.status === "approved" && (
                      <button onClick={() => setConfirm({ company: c, status: "suspended" })} disabled={busy} className={`${actionButton} border-slate-200 text-slate-600 hover:bg-slate-50`}>
                        Suspender
                      </button>
                    )}
                    {c.status === "suspended" && (
                      <button onClick={() => setStatus(c, "approved")} disabled={busy} className={`${actionButton} border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}>
                        Reactivar
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {confirm && (
        <ConfirmModal
          title={confirm.status === "suspended" ? "Suspender empresa" : "Rechazar solicitud"}
          message={
            confirm.status === "suspended"
              ? `Nadie de "${confirm.company.name}" podrá ver ni registrar información hasta que la reactives, y su bot dejará de recibir facturas. No se borra nada.`
              : `La solicitud de "${confirm.company.name}" quedará rechazada. Podrás aprobarla más adelante si cambia la decisión.`
          }
          confirmLabel={confirm.status === "suspended" ? "Suspender" : "Rechazar"}
          danger
          onConfirm={() => {
            setStatus(confirm.company, confirm.status);
            setConfirm(null);
          }}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

const REQUEST_KINDS = { access: "Acceso", rectification: "Rectificación", cancellation: "Cancelación", opposition: "Oposición", revocation: "Revocación del consentimiento" };
const REQUEST_STATUS = [
  { id: "open", label: "Recibida" },
  { id: "in_progress", label: "En revisión" },
  { id: "resolved", label: "Atendida" },
  { id: "rejected", label: "No procedió" },
];
const BUSINESS_DAYS_LIMIT = 20;

// Días hábiles (lunes a viernes) transcurridos desde una fecha.
function businessDaysSince(iso) {
  const day = new Date(iso);
  const today = new Date();
  let count = 0;
  day.setHours(0, 0, 0, 0);
  while (day < today) {
    day.setDate(day.getDate() + 1);
    if (day <= today && day.getDay() !== 0 && day.getDay() !== 6) count += 1;
  }
  return count;
}

function PrivacyRequestsPanel() {
  const { showToast } = useToast();
  const [rows, setRows] = useState(null);
  const [drafts, setDrafts] = useState({});

  const [names, setNames] = useState({});

  const load = useCallback(async () => {
    const { data } = await supabase.from("privacy_requests").select("*").order("createdAt", { ascending: false }).limit(200);
    setRows(data ?? []);
    // Para saber de quién es cada solicitud sin mostrar solo su identificador.
    const ids = [...new Set((data ?? []).map((row) => row.userId))];
    if (ids.length === 0) return;
    const { data: people } = await supabase.from("profiles").select("id, fullName").in("id", ids);
    setNames(Object.fromEntries((people ?? []).map((person) => [person.id, person.fullName])));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function save(row) {
    const draft = drafts[row.id] ?? {};
    const status = draft.status ?? row.status;
    const closed = status === "resolved" || status === "rejected";
    const { error } = await supabase
      .from("privacy_requests")
      .update({ status, response: (draft.response ?? row.response ?? "").trim() || null, resolvedAt: closed ? new Date().toISOString() : null })
      .eq("id", row.id);
    if (error) showToast(`No se pudo guardar: ${error.message}`);
    else {
      showToast("Solicitud actualizada.");
      setDrafts((prev) => ({ ...prev, [row.id]: undefined }));
      load();
    }
  }

  if (rows === null) return <p className="py-10 text-center text-xs text-slate-400">Cargando…</p>;
  if (rows.length === 0) return <p className="py-10 text-center text-xs text-slate-400">No hay solicitudes de privacidad.</p>;
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">La ley da un máximo de {BUSINESS_DAYS_LIMIT} días hábiles para responder cada solicitud.</p>
      {rows.map((row) => {
        const draft = drafts[row.id] ?? {};
        const open = row.status === "open" || row.status === "in_progress";
        const days = businessDaysSince(row.createdAt);
        return (
          <div key={row.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-bold text-slate-800">{REQUEST_KINDS[row.kind] ?? row.kind}</p>
              <span className={`text-[11px] font-semibold ${open && days >= BUSINESS_DAYS_LIMIT - 5 ? "text-rose-600" : "text-slate-400"}`}>
                {timeAgoLabel(row.createdAt)}
                {open ? ` · ${days} de ${BUSINESS_DAYS_LIMIT} días hábiles` : ""}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-slate-400">
              {names[row.userId] || "Persona sin nombre"} · <span className="select-all font-mono">{row.userId}</span>
              {row.companyId ? ` · Empresa ${row.companyId}` : ""}
            </p>
            <p className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-2 text-xs text-slate-600">{row.detail}</p>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[180px_1fr_auto] sm:items-start">
              <select
                value={draft.status ?? row.status}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [row.id]: { ...draft, status: e.target.value } }))}
                aria-label="Estado"
                className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:border-blue-400 focus:outline-none"
              >
                {REQUEST_STATUS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              <textarea
                value={draft.response ?? row.response ?? ""}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [row.id]: { ...draft, response: e.target.value } }))}
                rows={2}
                maxLength={4000}
                placeholder="Respuesta para la persona"
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-blue-400 focus:outline-none"
              />
              <button onClick={() => save(row)} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
                Guardar
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function AdminCompaniesPage() {
  const [tab, setTab] = useState("companies");
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Administración de Navio</h1>
        <p className="mt-1 text-sm text-slate-500">Altas de empresas, suspensiones y solicitudes de privacidad.</p>
      </div>
      <PillTabs
        tabs={[
          { id: "companies", label: "Empresas" },
          { id: "privacy", label: "Solicitudes de privacidad" },
        ]}
        active={tab}
        onSelect={setTab}
      />
      {tab === "companies" ? <CompaniesPanel /> : <PrivacyRequestsPanel />}
    </div>
  );
}
