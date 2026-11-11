import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Edit2, Eye, Navigation, Plus, Route, Search, Trash2, Truck, User, X } from "lucide-react";
import {
  supabase,
  useAuth,
  useToast,
  useDateFormat,
  formatDate,
  Modal,
  ConfirmModal,
  KpiCard,
  localISODate,
  isVariableDriver,
  vehicleDriverName,
  vehicleDriverLabel,
} from "./NavioDashboard.jsx";
import { usePeople, personName } from "./people.jsx";
import { DriverPanel, RouteMap, formatDuration, formatKm, routeSummary, useTracking } from "./tracking.jsx";

/* ---------------------------------------------------------------------- */
/*  Traslados — viajes programados y su registro real                     */
/* ---------------------------------------------------------------------- */

const TRIP_STATUS = {
  scheduled: { label: "Programado", className: "bg-slate-100 text-slate-600 ring-slate-200" },
  ongoing: { label: "En curso", className: "bg-blue-50 text-blue-700 ring-blue-200" },
  completed: { label: "Completado", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  cancelled: { label: "Cancelado", className: "bg-rose-50 text-rose-700 ring-rose-200" },
};
const TRIP_FILTERS = [
  { id: "open", label: "Por hacer y en curso" },
  { id: "scheduled", label: "Programados" },
  { id: "ongoing", label: "En curso" },
  { id: "completed", label: "Completados" },
  { id: "cancelled", label: "Cancelados" },
  { id: "all", label: "Todos" },
];

const tripDriver = (trip) => trip.assignedToName || trip.driver || "Sin chofer";
const timeLabel = (iso) => (iso ? new Date(iso).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" }) : "—");

function TripStatusBadge({ status }) {
  const s = TRIP_STATUS[status] ?? TRIP_STATUS.scheduled;
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${s.className}`}>{s.label}</span>;
}

function TripFormModal({ initial, vehicles, projectOptions = [], onSave, onClose }) {
  const { people } = usePeople();
  const firstVehicle = vehicles.find((v) => v.id === initial?.vehicleId) ?? vehicles.find((v) => v.unit === initial?.unit) ?? vehicles[0];
  const [tripType, setTripType] = useState(initial?.tripType ?? "cargo");
  const [vehicleId, setVehicleId] = useState(firstVehicle?.id ?? "");
  const [assignedTo, setAssignedTo] = useState(initial?.assignedTo ?? "");
  const [driver, setDriver] = useState(initial?.driver ?? "");
  const [origin, setOrigin] = useState(initial?.origin ?? "");
  const [destination, setDestination] = useState(initial?.destination ?? "");
  const [date, setDate] = useState(initial?.date ?? localISODate());
  const [cargo, setCargo] = useState(initial?.cargo ?? "");
  const [project, setProject] = useState(initial?.project ?? "");
  const [workOrder, setWorkOrder] = useState(initial?.workOrder ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const vehicle = vehicles.find((v) => v.id === Number(vehicleId));
  const inputClass = "w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-blue-400 focus:outline-none";
  const labelClass = "mb-1 block text-[11px] font-semibold text-slate-500";

  async function handleSubmit(e) {
    e.preventDefault();
    if (!vehicle || !origin.trim() || !destination.trim() || !date) {
      setError("Indica la unidad, el origen, el destino y la fecha.");
      return;
    }
    setError("");
    setSaving(true);
    // Sin persona asignada, queda el nombre escrito o el chofer fijo de la unidad.
    const driverName = assignedTo ? "" : driver.trim() || vehicleDriverName(vehicle);
    const ok = await onSave({
      ...(initial?.id ? { id: initial.id } : { status: "scheduled" }),
      tripType,
      vehicleId: vehicle.id,
      unit: vehicle.unit,
      assignedTo: assignedTo || null,
      ...(assignedTo ? {} : { assignedToName: null }),
      driver: driverName,
      origin: origin.trim(),
      destination: destination.trim(),
      date,
      cargo: cargo.trim(),
      project: project.trim(),
      workOrder: workOrder.trim(),
      notes: notes.trim(),
    });
    setSaving(false);
    if (ok === false) setError("No se pudo guardar. Revisa tu conexión e inténtalo de nuevo.");
  }

  return (
    <Modal title={initial?.id ? "Editar traslado" : "Nuevo traslado"} width="max-w-lg" onClose={onClose}>
      <form onSubmit={handleSubmit} className="max-h-[75vh] space-y-3 overflow-y-auto pr-1">
        <div className="flex gap-1.5 rounded-xl bg-slate-100 p-1">
          {[
            { id: "cargo", label: "Carga" },
            { id: "passengers", label: "Pasajeros" },
          ].map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => setTripType(o.id)}
              className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                tripType === o.id ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass}>Unidad</label>
            <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} className={inputClass}>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.unit} — {vehicleDriverLabel(v)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Quién lo maneja</label>
            <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className={inputClass}>
              <option value="">Sin cuenta en Navio</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {personName(p)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {assignedTo ? (
          <p className="text-[11px] text-slate-400">Le llegará una alerta y podrá iniciar el viaje desde su celular para que quede el recorrido.</p>
        ) : (
          <div>
            <label className={labelClass}>Nombre del chofer{vehicle && !isVariableDriver(vehicle) ? " (si no es el de la unidad)" : ""}</label>
            <input value={driver} onChange={(e) => setDriver(e.target.value)} placeholder={vehicleDriverName(vehicle) || "Nombre de quien maneja"} className={inputClass} />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Origen</label>
            <input value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="Ej. Coatzacoalcos" className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Destino</label>
            <input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Ej. Mérida" className={inputClass} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Fecha</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>{tripType === "passengers" ? "Pasajeros" : "Carga"}</label>
            <input
              value={cargo}
              onChange={(e) => setCargo(e.target.value)}
              placeholder={tripType === "passengers" ? "Ej. 4 personas de obra" : "Ej. Materiales, 8 toneladas"}
              className={inputClass}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Proyecto (opcional)</label>
            <input list="navio-trip-projects" value={project} onChange={(e) => setProject(e.target.value)} placeholder="Ej. Tren Maya" className={inputClass} />
            <datalist id="navio-trip-projects">
              {projectOptions.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>
          <div>
            <label className={labelClass}>Orden de trabajo (opcional)</label>
            <input value={workOrder} onChange={(e) => setWorkOrder(e.target.value)} placeholder="Ej. OT24053" className={inputClass} />
          </div>
        </div>
        <div>
          <label className={labelClass}>Notas (opcional)</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputClass} />
        </div>
        {error && (
          <p className="flex items-center gap-1.5 rounded-lg bg-rose-50 px-2.5 py-2 text-[11px] font-medium text-rose-700">
            <AlertTriangle size={13} /> {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">
            Cancelar
          </button>
          <button type="submit" disabled={saving} className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
            {saving ? "Guardando…" : initial?.id ? "Guardar cambios" : "Programar traslado"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// El registro del viaje: lo programado y lo que realmente pasó.
function TripDetailModal({ trip, onClose }) {
  const { format } = useDateFormat();
  const [route, setRoute] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setRoute(null);
    if (trip.routeId) {
      supabase
        .from("routes")
        .select("*")
        .eq("id", trip.routeId)
        .maybeSingle()
        .then(({ data }) => !cancelled && setRoute(data ?? null));
    }
    return () => {
      cancelled = true;
    };
  }, [trip.routeId, trip.status]);

  const facts = [
    ["Unidad", trip.unit],
    ["Chofer", tripDriver(trip)],
    ["Fecha programada", formatDate(trip.date, format)],
    [(trip.tripType ?? "cargo") === "passengers" ? "Pasajeros" : "Carga", trip.cargo],
    ["Proyecto", trip.project],
    ["Orden de trabajo", trip.workOrder],
    ["Salida real", trip.startedAt ? timeLabel(trip.startedAt) : ""],
    ["Llegada real", trip.endedAt ? timeLabel(trip.endedAt) : ""],
    ["Programó", trip.createdByName],
    ["Notas", trip.notes],
  ].filter(([, value]) => value);

  return (
    <Modal title="Registro del traslado" width="max-w-3xl" onClose={onClose}>
      <div className="max-h-[78vh] space-y-4 overflow-y-auto pr-1">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2.5">
          <p className="flex min-w-0 items-center gap-1.5 text-sm font-bold text-slate-800">
            <span className="truncate">{trip.origin}</span> <Navigation size={14} className="shrink-0 text-blue-500" /> <span className="truncate">{trip.destination}</span>
          </p>
          <TripStatusBadge status={trip.status} />
        </div>
        {trip.routeId ? (
          <>
            <RouteMap routeId={trip.routeId} live={trip.status === "ongoing"} className="h-80" />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {routeSummary(route ?? { startedAt: trip.startedAt, endedAt: trip.endedAt, distanceKm: trip.distanceKm }).map(([label, value]) => (
                <div key={label} className="rounded-xl bg-slate-50 px-3 py-2">
                  <p className="text-[11px] text-slate-400">{label}</p>
                  <p className="text-sm font-bold text-slate-800">{value}</p>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400">
            Este traslado no tiene recorrido guardado: queda registrado cuando quien maneja inicia el viaje desde Navio.
          </p>
        )}
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
          {facts.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-[11px] text-slate-400">{label}</dt>
              <dd className="break-words text-xs font-medium text-slate-700">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="mt-4 flex justify-end">
        <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">
          Cerrar
        </button>
      </div>
    </Modal>
  );
}

export function TransfersPage({ vehicles, trips, insertTrip, updateTrip, removeTrip, isAdmin, projectOptions = [], onOpenDriverMode }) {
  const { format } = useDateFormat();
  const { showToast } = useToast();
  const { user } = useAuth();
  const tracking = useTracking();
  const [filter, setFilter] = useState("open");
  const [query, setQuery] = useState("");
  const [form, setForm] = useState(null); // null | {} | trip
  const [detailId, setDetailId] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const detail = trips.find((t) => t.id === detailId) ?? null;

  const monthKey = localISODate().slice(0, 7);
  const widgets = useMemo(() => {
    const month = trips.filter((t) => String(t.date).slice(0, 7) === monthKey);
    const done = month.filter((t) => t.status === "completed");
    return [
      { id: "scheduled", label: "Programados", icon: Clock, tone: "slate", value: trips.filter((t) => t.status === "scheduled").length, detail: "Pendientes de salir" },
      { id: "ongoing", label: "En curso", icon: Navigation, tone: "blue", value: trips.filter((t) => t.status === "ongoing").length, detail: "En este momento" },
      { id: "done", label: "Completados este mes", icon: CheckCircle2, tone: "emerald", value: done.length, detail: `De ${month.length} del mes` },
      { id: "km", label: "Kilómetros este mes", icon: Route, tone: "sky", value: formatKm(done.reduce((s, t) => s + (Number(t.distanceKm) || 0), 0)), detail: "Recorrido registrado" },
    ];
  }, [trips, monthKey]);

  const text = query.trim().toLowerCase();
  const listed = trips
    .filter((t) => (filter === "all" ? true : filter === "open" ? ["scheduled", "ongoing"].includes(t.status) : t.status === filter))
    .filter((t) => !text || [t.unit, tripDriver(t), t.origin, t.destination, t.cargo, t.project, t.workOrder].some((v) => String(v ?? "").toLowerCase().includes(text)))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.id - a.id);

  async function saveTrip(trip) {
    try {
      if (trip.id) {
        const { id, ...patch } = trip;
        await updateTrip(id, patch);
      } else {
        await insertTrip(trip);
      }
      setForm(null);
      return true;
    } catch (err) {
      showToast(`No se pudo guardar el traslado: ${err.message}`);
      return false;
    }
  }

  async function changeStatus(trip, patch, failure) {
    try {
      await updateTrip(trip.id, patch);
    } catch (err) {
      showToast(`${failure}: ${err.message}`);
    }
  }

  async function handleDelete() {
    try {
      await removeTrip(toDelete.id);
      setToDelete(null);
      showToast("Traslado eliminado.");
    } catch (err) {
      showToast(`No se pudo eliminar: ${err.message}`);
    }
  }

  const actionClass = "inline-flex items-center gap-1 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Traslados</h1>
          <p className="mt-1 text-sm text-slate-500">Programa los viajes, asígnalos y consulta el recorrido real de cada uno.</p>
        </div>
        <button onClick={() => setForm({})} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700">
          <Plus size={15} /> Nuevo traslado
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {widgets.map((w) => (
          <KpiCard key={w.id} widget={w} />
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {TRIP_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
                filter === f.id ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-400 focus-within:border-blue-400">
          <Search size={13} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar unidad, chofer, destino…" className="w-48 text-slate-700 focus:outline-none" />
        </label>
      </div>

      <div className="space-y-3">
        {listed.map((t) => {
          const open = t.status === "scheduled" || t.status === "ongoing";
          const mine = !t.assignedTo || t.assignedTo === user?.id;
          const trackedHere = tracking?.active?.tripId === t.id;
          return (
            <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="text-xs font-bold text-slate-800">{t.unit}</p>
                  <span className="flex items-center gap-1 text-[11px] font-medium text-slate-500">
                    <User size={11} /> {tripDriver(t)}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                    {(t.tripType ?? "cargo") === "passengers" ? <User size={10} /> : <Truck size={10} />}
                    {(t.tripType ?? "cargo") === "passengers" ? "Pasajeros" : "Carga"}
                  </span>
                  {t.project && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">{t.project}</span>}
                </div>
                <p className="mt-1 flex min-w-0 items-center gap-1.5 text-sm font-semibold text-slate-700">
                  <span className="truncate">{t.origin}</span> <Navigation size={13} className="shrink-0 text-blue-500" /> <span className="truncate">{t.destination}</span>
                </p>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  {formatDate(t.date, format)}
                  {t.cargo ? ` · ${t.cargo}` : ""}
                  {t.startedAt ? ` · Salió ${timeLabel(t.startedAt)}` : ""}
                  {t.endedAt ? ` · Llegó ${timeLabel(t.endedAt)}` : ""}
                  {t.startedAt && t.endedAt ? ` · ${formatDuration(new Date(t.endedAt) - new Date(t.startedAt))}` : ""}
                  {Number(t.distanceKm) > 0 ? ` · ${formatKm(t.distanceKm)}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                <TripStatusBadge status={t.status} />
                <button onClick={() => setDetailId(t.id)} className={`${actionClass} border-slate-200 text-slate-600 hover:bg-slate-50`}>
                  <Eye size={12} /> {t.routeId ? "Ver recorrido" : "Detalle"}
                </button>
                {open && mine && !tracking?.active && (
                  <button onClick={() => onOpenDriverMode()} className={`${actionClass} border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100`}>
                    <Navigation size={12} /> Iniciar con rastreo
                  </button>
                )}
                {trackedHere && (
                  <button onClick={() => onOpenDriverMode()} className={`${actionClass} border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}>
                    <Navigation size={12} /> Mi viaje en curso
                  </button>
                )}
                {t.status === "scheduled" && (
                  <button
                    onClick={() => changeStatus(t, { status: "ongoing", startedAt: new Date().toISOString() }, "No se pudo marcar en curso")}
                    className={`${actionClass} border-slate-200 text-slate-600 hover:bg-slate-50`}
                    title="Sin rastreo: solo cambia el estado"
                  >
                    Marcar en curso
                  </button>
                )}
                {t.status === "ongoing" && !trackedHere && (
                  <button
                    onClick={() => changeStatus(t, { status: "completed", endedAt: new Date().toISOString() }, "No se pudo completar")}
                    className={`${actionClass} border-emerald-200 text-emerald-700 hover:bg-emerald-50`}
                  >
                    <CheckCircle2 size={12} /> Completar
                  </button>
                )}
                {open && (
                  <button onClick={() => setForm(t)} className={`${actionClass} border-slate-200 text-slate-600 hover:bg-slate-50`}>
                    <Edit2 size={12} /> Editar
                  </button>
                )}
                {open && !trackedHere && (
                  <button onClick={() => changeStatus(t, { status: "cancelled" }, "No se pudo cancelar")} className={`${actionClass} border-rose-200 text-rose-600 hover:bg-rose-50`}>
                    <X size={12} /> Cancelar
                  </button>
                )}
                {isAdmin && !open && (
                  <button onClick={() => setToDelete(t)} aria-label="Eliminar traslado" title="Eliminar" className={`${actionClass} border-slate-200 text-slate-400 hover:bg-slate-50`}>
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {listed.length === 0 && (
          <p className="rounded-2xl border border-dashed border-slate-200 bg-white py-10 text-center text-xs text-slate-400">
            {trips.length === 0 ? 'Todavía no hay traslados. Programa el primero con "Nuevo traslado".' : "Sin traslados con este filtro."}
          </p>
        )}
      </div>

      {form && <TripFormModal initial={form} vehicles={vehicles} projectOptions={projectOptions} onSave={saveTrip} onClose={() => setForm(null)} />}
      {detail && <TripDetailModal trip={detail} onClose={() => setDetailId(null)} />}
      {toDelete && (
        <ConfirmModal
          title="Eliminar traslado"
          message={`¿Eliminar el traslado ${toDelete.origin} → ${toDelete.destination} del ${formatDate(toDelete.date, format)}? Queda anotado en la bitácora.`}
          confirmLabel="Eliminar"
          danger
          onConfirm={handleDelete}
          onClose={() => setToDelete(null)}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Celular — pestaña "Viaje"                                             */
/* ---------------------------------------------------------------------- */

export function MobileTripTab({ vehicles, trips }) {
  const { user } = useAuth();
  const { format } = useDateFormat();
  const tracking = useTracking();
  const [detailId, setDetailId] = useState(null);
  const mine = trips
    .filter((t) => t.assignedTo === user?.id)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.id - a.id);
  const upcoming = mine.filter((t) => ["scheduled", "ongoing"].includes(t.status));
  const recent = mine.filter((t) => t.status === "completed").slice(0, 5);
  const detail = trips.find((t) => t.id === detailId) ?? null;

  return (
    <div className="space-y-4 p-4 pb-24">
      <h1 className="text-xl font-bold text-slate-900">Viaje</h1>
      <DriverPanel vehicles={vehicles} trips={trips} big />

      {!tracking?.active && upcoming.length > 0 && (
        <div>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Tus traslados</h2>
          <div className="space-y-2">
            {upcoming.map((t) => (
              <button key={t.id} onClick={() => setDetailId(t.id)} className="block w-full rounded-xl border border-slate-200 bg-white p-3 text-left">
                <p className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
                  <span className="truncate">{t.origin}</span> <Navigation size={13} className="shrink-0 text-blue-500" /> <span className="truncate">{t.destination}</span>
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {t.unit} · {formatDate(t.date, format)}
                  {t.cargo ? ` · ${t.cargo}` : ""}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {recent.length > 0 && (
        <div>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Viajes recientes</h2>
          <div className="space-y-2">
            {recent.map((t) => (
              <button key={t.id} onClick={() => setDetailId(t.id)} className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3 text-left">
                <span className="min-w-0">
                  <span className="block truncate text-xs font-bold text-slate-800">
                    {t.origin} → {t.destination}
                  </span>
                  <span className="block text-[11px] text-slate-400">{formatDate(t.date, format)}</span>
                </span>
                <span className="shrink-0 text-xs font-semibold text-slate-600">{formatKm(t.distanceKm)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {detail && <TripDetailModal trip={detail} onClose={() => setDetailId(null)} />}
    </div>
  );
}
