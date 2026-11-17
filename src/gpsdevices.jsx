import { useCallback, useEffect, useState } from "react";
import { Plus, Radio, Trash2 } from "lucide-react";
import { supabase, useAuth, useToast, ConfirmModal, timeAgoLabel } from "./NavioDashboard.jsx";

/* ---------------------------------------------------------------------- */
/*  GPS fijos en las unidades (Configuración → Dispositivos GPS)          */
/* ---------------------------------------------------------------------- */

const card = "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm";
const inputClass = "w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-blue-400 focus:outline-none";

export function GpsDevicesPanel() {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const isAdmin = !!(profile?.isSuperAdmin || profile?.companyRole === "admin");
  const [devices, setDevices] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [missing, setMissing] = useState(false);
  const [form, setForm] = useState({ imei: "", label: "", vehicleId: "" });
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(null);

  const load = useCallback(async () => {
    const [d, v] = await Promise.all([
      supabase.from("gps_devices").select("*").order("id", { ascending: true }),
      supabase.from("vehicles").select("id, unit, plate").order("id", { ascending: true }),
    ]);
    if (d.error) setMissing(true);
    setDevices(d.data ?? []);
    setVehicles(v.data ?? []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function add(e) {
    e.preventDefault();
    const imei = form.imei.replace(/\s/g, "");
    if (!/^[0-9]{10,20}$/.test(imei)) {
      showToast("El número de serie (IMEI) son de 10 a 20 dígitos; viene en la etiqueta del GPS.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("gps_devices").insert({ companyId: profile.companyId, imei, label: form.label.trim() || null, vehicleId: form.vehicleId ? Number(form.vehicleId) : null });
    setSaving(false);
    if (error) showToast(/duplicate|unique/i.test(error.message) ? "Ese GPS ya está dado de alta." : `No se pudo guardar: ${error.message}`);
    else {
      setForm({ imei: "", label: "", vehicleId: "" });
      showToast("GPS dado de alta. Navio empezará a recibir su señal cuando el receptor la mande.");
      load();
    }
  }

  async function update(device, patch) {
    const { error } = await supabase.from("gps_devices").update(patch).eq("id", device.id);
    if (error) showToast(`No se pudo guardar: ${error.message}`);
    else load();
  }

  async function remove() {
    const { error } = await supabase.from("gps_devices").delete().eq("id", removing.id);
    if (error) showToast(`No se pudo quitar: ${error.message}`);
    setRemoving(null);
    load();
  }

  if (missing) return <p className={`${card} text-xs text-slate-500`}>Los GPS fijos se activan al aplicar la actualización v25 de la base de datos.</p>;

  return (
    <div className="space-y-4">
      <div className={card}>
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
          <Radio size={16} className="text-blue-600" /> GPS instalados en las unidades
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          Un GPS conectado al encendido manda su ubicación sola: al encender la unidad empieza su recorrido (y su traslado programado de hoy pasa a "en curso"); al apagarla, el recorrido se
          cierra. Navio solo acepta los GPS dados de alta aquí.
        </p>
      </div>

      <div className={`${card} p-0`}>
        {devices === null ? (
          <p className="px-4 py-6 text-center text-xs text-slate-400">Cargando…</p>
        ) : devices.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-slate-400">Todavía no hay GPS dados de alta.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {devices.map((d) => {
              const recent = d.lastSeenAt && Date.now() - Date.parse(d.lastSeenAt) < 10 * 60000;
              return (
                <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${d.active === false ? "bg-slate-300" : recent ? "bg-emerald-500" : "bg-amber-400"}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-bold text-slate-800">{d.label || "GPS"} · {d.imei}</p>
                    <p className="text-[11px] text-slate-500">
                      {d.lastSeenAt ? `Última señal ${timeAgoLabel(d.lastSeenAt)}` : "Todavía no manda señal"}
                      {d.lastIgnition === true ? " · encendida" : d.lastIgnition === false ? " · apagada" : ""}
                      {d.active === false && " · desactivado"}
                    </p>
                  </div>
                  <select
                    value={d.vehicleId ?? ""}
                    disabled={!isAdmin}
                    onChange={(e) => update(d, { vehicleId: e.target.value ? Number(e.target.value) : null })}
                    aria-label="Unidad del GPS"
                    className="max-w-[160px] rounded-lg border border-slate-200 px-2 py-1 text-[11px] disabled:bg-slate-50"
                  >
                    <option value="">Sin unidad</option>
                    {vehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.unit} — {v.plate}
                      </option>
                    ))}
                  </select>
                  {isAdmin && (
                    <>
                      <button onClick={() => update(d, { active: d.active === false })} className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
                        {d.active === false ? "Activar" : "Desactivar"}
                      </button>
                      <button onClick={() => setRemoving(d)} aria-label={`Quitar GPS ${d.imei}`} className="rounded-lg border border-rose-200 p-1.5 text-rose-600 hover:bg-rose-50">
                        <Trash2 size={12} />
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {isAdmin ? (
        <form onSubmit={add} className={`${card} space-y-3`}>
          <h3 className="text-xs font-bold text-slate-700">Dar de alta un GPS</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-slate-500">Número de serie (IMEI)</span>
              <input value={form.imei} onChange={(e) => setForm((f) => ({ ...f, imei: e.target.value }))} inputMode="numeric" maxLength={25} placeholder="Ej. 356307042441013" className={inputClass} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-slate-500">Nombre (opcional)</span>
              <input value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} maxLength={100} placeholder="Ej. Teltonika U12" className={inputClass} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-slate-500">Unidad</span>
              <select value={form.vehicleId} onChange={(e) => setForm((f) => ({ ...f, vehicleId: e.target.value }))} className={inputClass}>
                <option value="">Elegir después</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.unit} — {v.plate}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
            <Plus size={13} /> {saving ? "Guardando…" : "Dar de alta"}
          </button>
          <p className="text-[11px] text-slate-400">
            Recomendado: GPS de marca seria (por ejemplo Teltonika) con la conexión cifrada activada, contraseña de fábrica cambiada, comandos por mensaje bloqueados y, si tiene corte de
            motor, con esa función desactivada.
          </p>
        </form>
      ) : (
        <p className="text-[11px] text-slate-400">Solo un administrador puede dar de alta o quitar GPS.</p>
      )}

      {removing && (
        <ConfirmModal
          title="Quitar GPS"
          message={`¿Quitar el GPS ${removing.imei}? Navio dejará de aceptar su señal. Los recorridos que ya registró se conservan.`}
          confirmLabel="Quitar"
          danger
          onConfirm={remove}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}
