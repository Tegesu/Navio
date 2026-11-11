import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Building2, CheckCircle2, Copy, History, KeyRound, Lock, LogOut, RefreshCw, Shield, ShieldCheck, UserMinus, Users, X } from "lucide-react";
import {
  supabase,
  useAuth,
  useToast,
  ConfirmModal,
  PillTabs,
  avatarUrl,
  timeAgoLabel,
  DateFormatToggle,
  Modal,
} from "./NavioDashboard.jsx";
import { usePeople } from "./people.jsx";
import { useTracking } from "./tracking.jsx";
import { LEGAL_DOCS, LEGAL_VERSION, LegalModal } from "./legal.jsx";
import { MIN_PASSWORD, translateAuthError } from "./auth.jsx";

const card = "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm";
const inputClass = "w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-blue-400 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500";
const labelClass = "mb-1 block text-[11px] font-semibold text-slate-500";
const primaryButton = "rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60";
const plainButton = "rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60";

const CURRENCY_OPTIONS = [
  { code: "MXN", label: "Peso mexicano (MXN)" },
  { code: "USD", label: "Dólar estadounidense (USD)" },
  { code: "EUR", label: "Euro (EUR)" },
  { code: "GTQ", label: "Quetzal guatemalteco (GTQ)" },
  { code: "COP", label: "Peso colombiano (COP)" },
];
const TEAM_ROLES = [
  { id: "admin", label: "Administrador" },
  { id: "member", label: "Usuario" },
];

function useIsAdmin() {
  const { profile } = useAuth();
  return !!(profile?.isSuperAdmin || profile?.companyRole === "admin");
}

function CopyButton({ text }) {
  const { showToast } = useToast();
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(text);
        showToast("Copiado.");
      }}
      disabled={!text}
      className={`${plainButton} flex items-center gap-1`}
    >
      <Copy size={12} /> Copiar
    </button>
  );
}

/* ---------------------------------------------------------------------- */
/*  Configuración → Empresa                                               */
/* ---------------------------------------------------------------------- */

function CompanyPanel() {
  const { user, profile, refreshProfile } = useAuth();
  const { showToast } = useToast();
  const isAdmin = useIsAdmin();
  const company = profile?.company ?? {};
  const [form, setForm] = useState({
    name: company.name ?? "",
    legalName: company.legalName ?? "",
    rfc: company.rfc ?? "",
    address: company.address ?? "",
    contactName: company.contactName ?? "",
    contactEmail: company.contactEmail ?? "",
    contactPhone: company.contactPhone ?? "",
    currency: company.currency ?? "MXN",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  async function handleSave(e) {
    e.preventDefault();
    const rfc = form.rfc.trim().toUpperCase();
    if (!form.name.trim()) {
      setError("La empresa necesita un nombre.");
      return;
    }
    if (rfc && !/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfc)) {
      setError("El RFC no tiene el formato correcto.");
      return;
    }
    setSaving(true);
    setError("");
    const { error: saveError } = await supabase
      .from("companies")
      .update({ ...Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim()])), rfc })
      .eq("id", profile.companyId);
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    await refreshProfile(user.id);
    showToast("Datos de la empresa guardados.");
  }

  const field = (key, label, props = {}) => (
    <div className={props.wide ? "sm:col-span-2" : ""}>
      <label className={labelClass}>{label}</label>
      <input value={form[key]} onChange={set(key)} disabled={!isAdmin} className={inputClass} {...props.input} />
    </div>
  );

  return (
    <form onSubmit={handleSave} className={`${card} space-y-3`}>
      <div>
        <h2 className="text-sm font-bold text-slate-800">Datos de la empresa</h2>
        <p className="text-xs text-slate-500">{isAdmin ? "Aparecen en reportes y sirven para identificar a tu empresa." : "Solo un administrador puede cambiarlos."}</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {field("name", "Nombre comercial")}
        {field("legalName", "Razón social")}
        {field("rfc", "RFC", { input: { maxLength: 13, placeholder: "Ej. ABC010203XY9" } })}
        <div>
          <label className={labelClass}>Moneda</label>
          <select value={form.currency} onChange={set("currency")} disabled={!isAdmin} className={inputClass}>
            {CURRENCY_OPTIONS.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        {field("address", "Domicilio", { wide: true })}
        {field("contactName", "Persona de contacto")}
        {field("contactPhone", "Teléfono de contacto", { input: { inputMode: "tel" } })}
        {field("contactEmail", "Correo de contacto", { wide: true, input: { type: "email" } })}
      </div>
      {error && <p className="rounded-lg bg-rose-50 px-2.5 py-2 text-[11px] font-medium text-rose-700">{error}</p>}
      {isAdmin && (
        <div className="flex justify-end">
          <button type="submit" disabled={saving} className={primaryButton}>
            {saving ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      )}
    </form>
  );
}

/* ---------------------------------------------------------------------- */
/*  Configuración → Equipo                                                */
/* ---------------------------------------------------------------------- */

// Los códigos solo los ve un administrador: se piden aparte, no vienen con
// los datos de la empresa.
function useCompanyCodes(enabled) {
  const [codes, setCodes] = useState(null);
  const load = useCallback(async () => {
    const { data } = await supabase.rpc("get_company_codes");
    setCodes((Array.isArray(data) ? data[0] : data) ?? {});
  }, []);
  useEffect(() => {
    if (enabled) load();
  }, [enabled, load]);
  return { codes, reload: load };
}

function CodeBox({ label, hint, value, prefix = "", which, onRotated }) {
  const { showToast } = useToast();
  const [confirming, setConfirming] = useState(false);

  async function rotate() {
    const { error } = await supabase.rpc("rotate_company_code", { which });
    if (error) showToast(`No se pudo regenerar: ${error.message}`);
    else {
      showToast("Código regenerado. El anterior dejó de funcionar.");
      onRotated();
    }
    setConfirming(false);
  }

  return (
    <div>
      <p className={labelClass}>{label}</p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
          {value === undefined ? "Cargando…" : `${prefix}${value || "—"}`}
        </code>
        <CopyButton text={value ? `${prefix}${value}` : ""} />
        <button onClick={() => setConfirming(true)} className={`${plainButton} flex items-center gap-1`}>
          <RefreshCw size={12} /> Regenerar
        </button>
      </div>
      <p className="mt-1 text-[11px] text-slate-400">{hint}</p>
      {confirming && (
        <ConfirmModal
          title="Regenerar código"
          message="El código actual dejará de funcionar de inmediato. Quien ya está dentro de la empresa no se ve afectado."
          confirmLabel="Regenerar"
          onConfirm={rotate}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

function TeamPanel() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { refresh: refreshPeople } = usePeople();
  const isAdmin = useIsAdmin();
  const [members, setMembers] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [toRemove, setToRemove] = useState(null);
  const { codes, reload: reloadCodes } = useCompanyCodes(isAdmin);

  const loadMembers = useCallback(async () => {
    const { data, error } = await supabase.rpc("list_company_members");
    if (error) showToast(`No se pudo cargar el equipo: ${error.message}`);
    setMembers(data ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isAdmin) loadMembers();
  }, [isAdmin, loadMembers]);

  async function changeRole(member, role) {
    setBusyId(member.id);
    const { error } = await supabase.rpc("set_member_role", { target_user: member.id, new_role: role });
    showToast(error ? `No se pudo cambiar el rol: ${error.message}` : "Rol actualizado.");
    await loadMembers();
    refreshPeople();
    setBusyId(null);
  }

  async function removeMember() {
    const { error } = await supabase.rpc("remove_company_member", { target_user: toRemove.id });
    showToast(error ? `No se pudo dar de baja: ${error.message}` : `${toRemove.fullName || "La persona"} ya no tiene acceso a la empresa.`);
    setToRemove(null);
    await loadMembers();
    refreshPeople();
  }

  if (!isAdmin) {
    return (
      <div className={card}>
        <h2 className="text-sm font-bold text-slate-800">Equipo</h2>
        <p className="mt-1 text-xs text-slate-500">Solo un administrador de la empresa puede ver y gestionar al equipo.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className={`${card} space-y-3`}>
        <div>
          <h2 className="text-sm font-bold text-slate-800">Invitar personas</h2>
          <p className="text-xs text-slate-500">Quien cree su cuenta y escriba este código entra a tu empresa como Usuario. Compártelo solo con tu gente.</p>
        </div>
        <CodeBox
          label="Código de invitación"
          hint="Si se filtra o alguien deja la empresa, regenéralo: el anterior deja de servir."
          value={codes === null ? undefined : codes.inviteCode}
          which="invite"
          onRotated={reloadCodes}
        />
      </div>

      <div className={card}>
        <h2 className="mb-1 text-sm font-bold text-slate-800">Personas ({members?.length ?? "…"})</h2>
        <p className="mb-3 text-xs text-slate-500">Administrador: aprueba, rechaza y anula facturas, edita unidades, asigna tareas y gestiona al equipo. Usuario: registra y verifica, pero no aprueba.</p>
        {members === null && <p className="text-xs text-slate-400">Cargando…</p>}
        <div className="space-y-2">
          {members?.map((member) => {
            const self = member.id === user?.id;
            return (
              <div key={member.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <img src={avatarUrl(member.fullName)} alt="" className="h-8 w-8 shrink-0 rounded-full" />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-slate-700">
                      {member.fullName || "Sin nombre"}
                      {self && <span className="ml-1.5 font-normal text-slate-400">(tú)</span>}
                    </p>
                    <p className="truncate text-[11px] text-slate-400">{[member.email, member.jobTitle, member.phone].filter(Boolean).join(" · ")}</p>
                  </div>
                </div>
                {self ? (
                  <span className="text-[11px] font-medium text-slate-500">{TEAM_ROLES.find((r) => r.id === member.companyRole)?.label}</span>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <select
                      value={member.companyRole}
                      disabled={busyId === member.id}
                      onChange={(e) => changeRole(member, e.target.value)}
                      aria-label={`Rol de ${member.fullName}`}
                      className="rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] focus:border-blue-400 focus:outline-none disabled:opacity-60"
                    >
                      {TEAM_ROLES.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                    <button onClick={() => setToRemove(member)} className="flex items-center gap-1 rounded-lg border border-rose-200 px-2.5 py-1.5 text-[11px] font-semibold text-rose-600 hover:bg-rose-50">
                      <UserMinus size={12} /> Dar de baja
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {toRemove && (
        <ConfirmModal
          title="Dar de baja"
          message={`${toRemove.fullName || "Esta persona"} perderá el acceso a la empresa de inmediato. Lo que registró (facturas, viajes, mensajes) se conserva. Si después debe volver, tendrá que unirse otra vez con el código de invitación.`}
          confirmLabel="Dar de baja"
          danger
          onConfirm={removeMember}
          onClose={() => setToRemove(null)}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Configuración → Bot de Telegram                                       */
/* ---------------------------------------------------------------------- */

function BotPanel() {
  const { profile, unlinkCompanyBot } = useAuth();
  const { showToast } = useToast();
  const isAdmin = useIsAdmin();
  const connected = !!profile?.company?.botChannel;
  const { codes, reload } = useCompanyCodes(isAdmin);
  const [unlinking, setUnlinking] = useState(false);

  async function handleUnlink() {
    setUnlinking(true);
    try {
      await unlinkCompanyBot();
      showToast("Bot desvinculado.");
    } catch (err) {
      showToast(`No se pudo desvincular: ${err.message}`);
    } finally {
      setUnlinking(false);
    }
  }

  return (
    <div className={`${card} space-y-3`}>
      <div>
        <h2 className="text-sm font-bold text-slate-800">Bot de Telegram</h2>
        <p className="text-xs text-slate-500">Envía fotos o PDF de facturas por Telegram y Navio las registra como pendientes de revisión. Un PDF puede traer varias facturas.</p>
      </div>
      {connected ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
            <CheckCircle2 size={14} /> Conectado
          </span>
          {isAdmin && (
            <button onClick={handleUnlink} disabled={unlinking} className="rounded-lg border border-rose-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-60">
              {unlinking ? "Desvinculando…" : "Desvincular"}
            </button>
          )}
        </div>
      ) : (
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">Todavía no hay un chat conectado.</p>
      )}
      {isAdmin ? (
        <CodeBox
          label={connected ? "Para conectar otro chat, envíale esto al bot" : "Abre Telegram, busca al bot de Navio y envíale este mensaje"}
          hint="El chat que mande este código queda ligado a tu empresa. No lo compartas fuera de tu equipo."
          value={codes === null ? undefined : codes.botLinkCode}
          prefix="/vincular "
          which="bot"
          onRotated={reload}
        />
      ) : (
        <p className="text-[11px] text-slate-400">Solo un administrador de la empresa puede conectar o desconectar el bot.</p>
      )}
      <p className="text-[11px] text-slate-400">Los documentos que recibe el bot se leen con inteligencia artificial: revisa siempre los datos antes de verificarlos.</p>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Configuración → Bitácora                                              */
/* ---------------------------------------------------------------------- */

const AUDIT_ENTITIES = {
  vehicles: "Unidad",
  trips: "Traslado",
  incidents: "Incidencia",
  maintenance_records: "Servicio",
  compliance_records: "Trámite",
  warranties: "Garantía",
  profiles: "Equipo",
  companies: "Empresa",
  notifications: "Alerta",
};
const AUDIT_ACTIONS = { insert: "Alta", update: "Cambio", delete: "Eliminación" };

function AuditPanel() {
  const isAdmin = useIsAdmin();
  const [rows, setRows] = useState(null);
  const [entity, setEntity] = useState("all");

  useEffect(() => {
    if (!isAdmin) return;
    supabase
      .from("audit_log")
      .select("*")
      .order("createdAt", { ascending: false })
      .limit(200)
      .then(({ data }) => setRows(data ?? []));
  }, [isAdmin]);

  if (!isAdmin) {
    return (
      <div className={card}>
        <h2 className="text-sm font-bold text-slate-800">Bitácora</h2>
        <p className="mt-1 text-xs text-slate-500">Solo un administrador de la empresa puede consultarla.</p>
      </div>
    );
  }
  const listed = (rows ?? []).filter((r) => entity === "all" || r.entity === entity);
  const entities = [...new Set((rows ?? []).map((r) => r.entity))];

  return (
    <div className={card}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-slate-800">Bitácora de actividad</h2>
          <p className="text-xs text-slate-500">Quién hizo qué y cuándo. La escribe el sistema y nadie puede modificarla. (El historial de cada factura está en su "Detalle".)</p>
        </div>
        <select value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Filtrar por tipo" className="rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] focus:border-blue-400 focus:outline-none">
          <option value="all">Todo</option>
          {entities.map((id) => (
            <option key={id} value={id}>
              {AUDIT_ENTITIES[id] ?? id}
            </option>
          ))}
        </select>
      </div>
      {rows === null && <p className="text-xs text-slate-400">Cargando…</p>}
      {rows?.length === 0 && <p className="py-6 text-center text-xs text-slate-400">Todavía no hay movimientos registrados.</p>}
      <ol className="max-h-[60vh] space-y-2 overflow-y-auto border-l-2 border-slate-100 pl-3">
        {listed.map((r) => (
          <li key={r.id}>
            <p className="text-xs font-semibold text-slate-700">
              {AUDIT_ENTITIES[r.entity] ?? r.entity}
              {AUDIT_ACTIONS[r.action] ? ` · ${AUDIT_ACTIONS[r.action]}` : ""}
              {r.summary ? `: ${r.summary}` : ""}
            </p>
            <p className="text-[11px] text-slate-400">
              {r.actorName || "Sistema"} · {new Date(r.createdAt).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}
              {Array.isArray(r.details?.campos) ? ` · Campos: ${r.details.campos.join(", ")}` : ""}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Configuración → Preferencias                                          */
/* ---------------------------------------------------------------------- */

const IDLE_OPTIONS = [
  { minutes: 0, label: "Nunca" },
  { minutes: 15, label: "15 minutos" },
  { minutes: 30, label: "30 minutos" },
  { minutes: 60, label: "1 hora" },
];

function useSavePreferences() {
  const { user, profile, refreshProfile } = useAuth();
  const { showToast } = useToast();
  return async (patch) => {
    const { error } = await supabase
      .from("profiles")
      .update({ preferences: { ...(profile?.preferences ?? {}), ...patch } })
      .eq("id", user.id);
    if (error) showToast(`No se pudo guardar: ${error.message}`);
    else await refreshProfile(user.id);
  };
}

function PreferencesPanel() {
  const { profile } = useAuth();
  const save = useSavePreferences();
  const idleMinutes = Number(profile?.preferences?.idleMinutes) || 0;
  return (
    <div className="space-y-4">
      <div className={card}>
        <h2 className="mb-1 text-sm font-bold text-slate-800">Formato de fecha</h2>
        <p className="mb-3 text-xs text-slate-500">Cómo se muestran las fechas en este navegador.</p>
        <DateFormatToggle />
      </div>
      <div className={card}>
        <h2 className="mb-1 text-sm font-bold text-slate-800">Cierre de sesión por inactividad</h2>
        <p className="mb-3 text-xs text-slate-500">Recomendado si usas un equipo compartido. No se aplica mientras llevas un viaje activo.</p>
        <select value={idleMinutes} onChange={(e) => save({ idleMinutes: Number(e.target.value) })} aria-label="Cerrar sesión tras" className={`${inputClass} max-w-xs`}>
          {IDLE_OPTIONS.map((o) => (
            <option key={o.minutes} value={o.minutes}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

// Cierra la sesión si nadie toca la app durante el tiempo elegido.
export function IdleGuard() {
  const { profile, signOut } = useAuth();
  const tracking = useTracking();
  const minutes = Number(profile?.preferences?.idleMinutes) || 0;
  const lastActivity = useRef(Date.now());
  const trackingActive = !!tracking?.active;

  useEffect(() => {
    if (!minutes || trackingActive) return undefined;
    lastActivity.current = Date.now();
    const touch = () => {
      lastActivity.current = Date.now();
    };
    const events = ["pointerdown", "keydown", "wheel", "touchstart"];
    events.forEach((name) => window.addEventListener(name, touch, { passive: true }));
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivity.current > minutes * 60000) signOut();
    }, 30000);
    return () => {
      events.forEach((name) => window.removeEventListener(name, touch));
      window.clearInterval(timer);
    };
  }, [minutes, trackingActive, signOut]);
  return null;
}

/* ---------------------------------------------------------------------- */
/*  Configuración → Privacidad                                            */
/* ---------------------------------------------------------------------- */

const REQUEST_KINDS = [
  { id: "access", label: "Acceso: quiero saber qué datos míos tienen" },
  { id: "rectification", label: "Rectificación: un dato mío está mal" },
  { id: "cancellation", label: "Cancelación: quiero que eliminen mis datos" },
  { id: "opposition", label: "Oposición: no quiero que usen mis datos para algo" },
  { id: "revocation", label: "Revocar mi consentimiento" },
];
const REQUEST_STATUS = { open: "Recibida", in_progress: "En revisión", resolved: "Atendida", rejected: "No procedió" };

export function PrivacyPanel() {
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const [doc, setDoc] = useState(null);
  const [requests, setRequests] = useState(null);
  const [acceptances, setAcceptances] = useState([]);
  const [kind, setKind] = useState("access");
  const [detail, setDetail] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    const [{ data: reqs }, { data: accepted }] = await Promise.all([
      supabase.from("privacy_requests").select("*").eq("userId", user.id).order("createdAt", { ascending: false }),
      supabase.from("legal_acceptances").select("*").eq("userId", user.id).order("acceptedAt", { ascending: false }),
    ]);
    setRequests(reqs ?? []);
    setAcceptances(accepted ?? []);
  }, [user.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function submit(e) {
    e.preventDefault();
    if (detail.trim().length < 10) return;
    setSending(true);
    const { error } = await supabase.from("privacy_requests").insert({ kind, detail: detail.trim(), companyId: profile?.companyId ?? null });
    setSending(false);
    if (error) showToast(`No se pudo enviar: ${error.message}`);
    else {
      setDetail("");
      showToast("Solicitud enviada. Recibirás respuesta en un máximo de 20 días hábiles.");
      load();
    }
  }

  // Lo que Navio guarda de la cuenta, en un archivo que la persona se lleva.
  function downloadMyData() {
    const data = {
      generado: new Date().toISOString(),
      cuenta: { id: user.id, correo: user.email, nombre: profile?.fullName, telefono: profile?.phone, puesto: profile?.jobTitle, rol: profile?.companyRole, preferencias: profile?.preferences },
      empresa: profile?.company?.name ?? null,
      aceptaciones: acceptances.map((a) => ({ documento: a.document, version: a.version, fecha: a.acceptedAt })),
      solicitudes: (requests ?? []).map((r) => ({ tipo: r.kind, detalle: r.detail, estado: r.status, fecha: r.createdAt, respuesta: r.response })),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "mis-datos-navio.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="space-y-4">
      <div className={card}>
        <h2 className="mb-1 text-sm font-bold text-slate-800">Documentos legales</h2>
        <p className="mb-3 text-xs text-slate-500">Las reglas de uso y cómo se cuidan tus datos. Versión vigente: {LEGAL_VERSION.split("-").reverse().join("/")}.</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {Object.entries(LEGAL_DOCS).map(([id, item]) => {
            const Icon = item.icon;
            const accepted = acceptances.find((a) => a.document === id && a.version === LEGAL_VERSION);
            return (
              <button key={id} onClick={() => setDoc(id)} className="rounded-xl border border-slate-200 px-3 py-2.5 text-left hover:bg-slate-50">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                  <Icon size={14} className="text-blue-600" /> {item.label}
                </span>
                <span className="mt-0.5 block text-[11px] text-slate-400">{accepted ? `Aceptado el ${new Date(accepted.acceptedAt).toLocaleDateString("es-MX")}` : "Leer"}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className={card}>
        <h2 className="mb-1 text-sm font-bold text-slate-800">Mis datos</h2>
        <p className="mb-3 text-xs text-slate-500">Descarga lo que Navio guarda de tu cuenta, o ejerce tus derechos de acceso, rectificación, cancelación y oposición (ARCO).</p>
        <button onClick={downloadMyData} className={plainButton}>
          Descargar los datos de mi cuenta
        </button>
        <form onSubmit={submit} className="mt-4 space-y-2 border-t border-slate-100 pt-3">
          <label className={labelClass}>Nueva solicitud</label>
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={inputClass}>
            {REQUEST_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
          <textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={3} maxLength={4000} placeholder="Describe con claridad qué necesitas." className={inputClass} />
          <div className="flex justify-end">
            <button type="submit" disabled={sending || detail.trim().length < 10} className={primaryButton}>
              {sending ? "Enviando…" : "Enviar solicitud"}
            </button>
          </div>
        </form>
        {requests?.length > 0 && (
          <div className="mt-3 space-y-2">
            {requests.map((r) => (
              <div key={r.id} className="rounded-xl bg-slate-50 px-3 py-2 text-xs">
                <p className="font-semibold text-slate-700">
                  {REQUEST_KINDS.find((k) => k.id === r.kind)?.label.split(":")[0]} · {REQUEST_STATUS[r.status] ?? r.status}
                </p>
                <p className="break-words text-slate-500">{r.detail}</p>
                {r.response && <p className="mt-1 break-words text-slate-600">Respuesta: {r.response}</p>}
                <p className="mt-0.5 text-[10px] text-slate-400">{timeAgoLabel(r.createdAt)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
      {doc && <LegalModal doc={doc} onClose={() => setDoc(null)} />}
    </div>
  );
}

const SETTINGS_TABS = [
  { id: "company", label: "Empresa", icon: Building2 },
  { id: "team", label: "Equipo", icon: Users },
  { id: "bot", label: "Bot de Telegram", icon: KeyRound },
  { id: "preferences", label: "Preferencias", icon: Lock },
  { id: "audit", label: "Bitácora", icon: History },
  { id: "privacy", label: "Privacidad", icon: ShieldCheck },
];

export function SettingsPage() {
  const [tab, setTab] = useState("company");
  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Configuración</h1>
        <p className="mt-1 text-sm text-slate-500">Tu empresa, tu equipo y cómo se protege la información.</p>
      </div>
      <PillTabs tabs={SETTINGS_TABS} active={tab} onSelect={setTab} />
      {tab === "company" && <CompanyPanel />}
      {tab === "team" && <TeamPanel />}
      {tab === "bot" && <BotPanel />}
      {tab === "preferences" && <PreferencesPanel />}
      {tab === "audit" && <AuditPanel />}
      {tab === "privacy" && <PrivacyPanel />}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Cuenta                                                                */
/* ---------------------------------------------------------------------- */

// El QR llega como imagen SVG. Se muestra dentro de <img>, donde no puede
// ejecutar nada, en lugar de insertarlo como HTML en la página.
function qrImageSource(qr) {
  if (!qr) return "";
  return qr.startsWith("data:") ? qr : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr)}`;
}

function MfaEnrollModal({ onClose, onEnrolled }) {
  const { verifyFactor } = useAuth();
  const [step, setStep] = useState("loading"); // loading | scan | error
  const [factor, setFactor] = useState(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const pendingFactor = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Un intento anterior sin terminar estorbaría al nuevo: se limpia.
        const { data: existing } = await supabase.auth.mfa.listFactors();
        for (const old of existing?.all ?? []) {
          if (old.factor_type === "totp" && old.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: old.id });
        }
        const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Navio ${new Date().toISOString().slice(0, 10)}` });
        if (enrollError) throw enrollError;
        pendingFactor.current = data.id;
        if (cancelled) return;
        setFactor(data);
        setStep("scan");
      } catch (err) {
        if (cancelled) return;
        setError(translateAuthError(err));
        setStep("error");
      }
    })();
    return () => {
      cancelled = true;
      // Si se cerró sin terminar, no se deja un método a medias.
      if (pendingFactor.current) supabase.auth.mfa.unenroll({ factorId: pendingFactor.current }).catch(() => {});
    };
  }, []);

  async function handleVerify(e) {
    e.preventDefault();
    setError("");
    setVerifying(true);
    try {
      await verifyFactor(factor.id, code.trim());
      pendingFactor.current = null;
      onEnrolled();
    } catch (err) {
      setCode("");
      setError(translateAuthError(err));
    } finally {
      setVerifying(false);
    }
  }

  return (
    <Modal title="Activar verificación en dos pasos" onClose={onClose}>
      {step === "loading" && <p className="py-4 text-center text-xs text-slate-400">Generando código…</p>}
      {step === "error" && <p className="rounded-lg bg-rose-50 px-2.5 py-2 text-[11px] font-medium text-rose-700">{error}</p>}
      {step === "scan" && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">1. Abre tu app de autenticación (Google Authenticator, Authy u otra) y escanea este código.</p>
          <div className="flex justify-center rounded-xl border border-slate-100 bg-white p-3">
            <img src={qrImageSource(factor.totp.qr_code)} alt="Código QR para la app de autenticación" className="h-40 w-40" />
          </div>
          <p className="text-center text-[11px] text-slate-400">
            ¿No puedes escanear? Escribe esta clave en la app:
            <br />
            <span className="select-all break-all font-mono font-semibold text-slate-600">{factor.totp.secret}</span>
          </p>
          <form onSubmit={handleVerify} className="space-y-2">
            <label className={labelClass}>2. Escribe el código de 6 dígitos que muestra la app</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              placeholder="123456"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-center text-lg tracking-[0.5em] focus:border-blue-400 focus:outline-none"
            />
            {error && <p className="rounded-lg bg-rose-50 px-2.5 py-2 text-[11px] font-medium text-rose-700">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">
                Cancelar
              </button>
              <button type="submit" disabled={verifying || code.length < 6} className={primaryButton}>
                {verifying ? "Verificando…" : "Activar"}
              </button>
            </div>
          </form>
        </div>
      )}
    </Modal>
  );
}

function ProfileCard({ userEmail }) {
  const { user, profile, refreshProfile } = useAuth();
  const { showToast } = useToast();
  const { refresh: refreshPeople } = usePeople();
  const [fullName, setFullName] = useState(profile?.fullName ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [jobTitle, setJobTitle] = useState(profile?.jobTitle ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave(e) {
    e.preventDefault();
    const name = fullName.trim();
    if (name.length < 2) {
      setError("Escribe tu nombre.");
      return;
    }
    setSaving(true);
    setError("");
    const { error: saveError } = await supabase.from("profiles").update({ fullName: name, phone: phone.trim(), jobTitle: jobTitle.trim() }).eq("id", user.id);
    // El nombre también vive en la sesión: se mantiene igual en ambos lados.
    if (!saveError) await supabase.auth.updateUser({ data: { full_name: name } });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    await refreshProfile(user.id);
    refreshPeople();
    showToast("Perfil guardado.");
  }

  return (
    <form onSubmit={handleSave} className={`${card} space-y-3`}>
      <h2 className="text-sm font-bold text-slate-800">Mi perfil</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass}>Nombre</label>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={120} autoComplete="name" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Correo (no se puede cambiar aquí)</label>
          <input value={userEmail} disabled className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Teléfono (opcional)</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} inputMode="tel" autoComplete="tel" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Puesto (opcional)</label>
          <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} maxLength={80} placeholder="Ej. Chofer, Administración" className={inputClass} />
        </div>
      </div>
      <p className="text-[11px] text-slate-400">Tu nombre, puesto y teléfono los ven las demás personas de tu empresa.</p>
      {error && <p className="rounded-lg bg-rose-50 px-2.5 py-2 text-[11px] font-medium text-rose-700">{error}</p>}
      <div className="flex justify-end">
        <button type="submit" disabled={saving} className={primaryButton}>
          {saving ? "Guardando…" : "Guardar perfil"}
        </button>
      </div>
    </form>
  );
}

function PasswordCard() {
  const { updatePassword } = useAuth();
  const { showToast } = useToast();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave(e) {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) {
      setError(`Usa al menos ${MIN_PASSWORD} caracteres.`);
      return;
    }
    if (password !== repeat) {
      setError("Las dos contraseñas no coinciden.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await updatePassword(password);
      setPassword("");
      setRepeat("");
      showToast("Contraseña actualizada.");
    } catch (err) {
      setError(translateAuthError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className={`${card} space-y-3`}>
      <div>
        <h2 className="text-sm font-bold text-slate-800">Cambiar contraseña</h2>
        <p className="text-xs text-slate-500">Al menos {MIN_PASSWORD} caracteres. Una frase larga es más segura y fácil de recordar que símbolos raros.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass}>Nueva contraseña</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Repítela</label>
          <input type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" className={inputClass} />
        </div>
      </div>
      {error && <p className="rounded-lg bg-rose-50 px-2.5 py-2 text-[11px] font-medium text-rose-700">{error}</p>}
      <div className="flex justify-end">
        <button type="submit" disabled={saving || !password} className={primaryButton}>
          {saving ? "Guardando…" : "Cambiar contraseña"}
        </button>
      </div>
    </form>
  );
}

function SecurityCard() {
  const { listMFAFactors, unenrollMFA } = useAuth();
  const { showToast } = useToast();
  const [factors, setFactors] = useState(null);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [closing, setClosing] = useState(false);

  const loadFactors = useCallback(() => {
    listMFAFactors()
      .then((data) => setFactors((data?.totp ?? []).filter((f) => f.status === "verified")))
      .catch(() => setFactors([]));
  }, [listMFAFactors]);

  useEffect(() => {
    loadFactors();
  }, [loadFactors]);

  async function removeFactor(factorId) {
    try {
      await unenrollMFA(factorId);
      showToast("Verificación en dos pasos desactivada.");
      loadFactors();
    } catch (err) {
      showToast(`No se pudo desactivar: ${err.message}`);
    }
  }

  async function signOutEverywhere() {
    setClosing(true);
    const { error } = await supabase.auth.signOut({ scope: "global" });
    if (error) {
      showToast(`No se pudo cerrar las sesiones: ${error.message}`);
      setClosing(false);
    }
  }

  return (
    <div className={`${card} space-y-3`}>
      <div>
        <h2 className="text-sm font-bold text-slate-800">Verificación en dos pasos</h2>
        <p className="text-xs text-slate-500">Además de tu contraseña, pide un código de tu teléfono (Google Authenticator, Authy u otra app). Es la mejor protección para tu cuenta.</p>
      </div>
      {factors === null ? (
        <p className="text-xs text-slate-400">Cargando…</p>
      ) : factors.length > 0 ? (
        factors.map((f) => (
          <div key={f.id} className="flex items-center justify-between rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2.5">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
              <ShieldCheck size={14} /> Activa — {f.friendly_name || "App de autenticación"}
            </span>
            <button onClick={() => removeFactor(f.id)} className="rounded-lg border border-rose-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-rose-600 hover:bg-rose-50">
              Desactivar
            </button>
          </div>
        ))
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
            <AlertTriangle size={14} /> Todavía no está activa
          </span>
          <button onClick={() => setEnrollOpen(true)} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-700">
            <Lock size={12} /> Activar
          </button>
        </div>
      )}
      <div className="border-t border-slate-100 pt-3">
        <p className="mb-2 text-xs text-slate-500">¿Entraste en un equipo ajeno o perdiste tu teléfono? Cierra tu sesión en todos los dispositivos.</p>
        <button onClick={signOutEverywhere} disabled={closing} className={plainButton}>
          {closing ? "Cerrando…" : "Cerrar sesión en todos los dispositivos"}
        </button>
      </div>
      {enrollOpen && (
        <MfaEnrollModal
          onClose={() => setEnrollOpen(false)}
          onEnrolled={() => {
            setEnrollOpen(false);
            showToast("Verificación en dos pasos activada.");
            loadFactors();
          }}
        />
      )}
    </div>
  );
}

const ROLE_PERMISSIONS = [
  ["Ver todos los módulos de tu empresa", true],
  ["Registrar facturas, traslados e incidencias", true],
  ["Verificar los datos que lee la inteligencia artificial", true],
  ["Escribir en los mensajes y crear tus propias tareas", true],
  ["Aprobar, rechazar y anular facturas", false],
  ["Editar o eliminar unidades y cerrar proyectos", false],
  ["Asignar tareas y enviar alertas a otras personas", false],
  ["Gestionar al equipo, los códigos y la bitácora", false],
];

export function AccountPage({ userName, userEmail, userAvatar, onSignOut, companyName, isSuperAdmin, isCompanyAdmin, compact = false }) {
  const [tab, setTab] = useState("profile");
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await onSignOut();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-5">
      {!compact && (
        <div>
          <h1 className="text-xl font-bold text-slate-900">Cuenta</h1>
          <p className="mt-1 text-sm text-slate-500">Tu perfil, tu seguridad y tus datos.</p>
        </div>
      )}

      <div className={`${card} flex flex-wrap items-center gap-4`}>
        <img src={userAvatar} alt="" className="h-14 w-14 rounded-full" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-slate-800">{userName}</p>
          <p className="truncate text-xs text-slate-400">
            {companyName ? `${companyName} · ` : ""}
            {userEmail}
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {isSuperAdmin && (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 ring-1 ring-blue-200">
                <Shield size={10} /> Super-administrador
              </span>
            )}
            <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${isCompanyAdmin ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-slate-100 text-slate-600 ring-slate-200"}`}>
              {isCompanyAdmin ? "Administrador de empresa" : "Usuario de empresa"}
            </span>
          </div>
        </div>
        <button onClick={handleSignOut} disabled={signingOut} className="flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-100 disabled:opacity-60">
          <LogOut size={14} /> {signingOut ? "Cerrando…" : "Cerrar sesión"}
        </button>
      </div>

      <PillTabs
        tabs={[
          { id: "profile", label: "Perfil" },
          { id: "security", label: "Seguridad" },
          { id: "role", label: "Mi rol" },
          { id: "privacy", label: "Privacidad" },
        ]}
        active={tab}
        onSelect={setTab}
      />

      {tab === "profile" && <ProfileCard userEmail={userEmail} />}
      {tab === "security" && (
        <div className="space-y-4">
          <SecurityCard />
          <PasswordCard />
        </div>
      )}
      {tab === "role" && (
        <div className={card}>
          <h2 className="mb-3 text-sm font-bold text-slate-800">Lo que puedes hacer como {isCompanyAdmin ? "administrador" : "usuario"}</h2>
          <div className="space-y-1.5 text-xs text-slate-600">
            {ROLE_PERMISSIONS.map(([label, forEveryone]) => {
              const allowed = forEveryone || isCompanyAdmin;
              return (
                <p key={label} className={`flex items-center gap-2 ${allowed ? "" : "text-slate-400"}`}>
                  {allowed ? <CheckCircle2 size={13} className="shrink-0 text-emerald-600" /> : <X size={13} className="shrink-0 text-slate-300" />}
                  {label}
                </p>
              );
            })}
          </div>
          {!isCompanyAdmin && <p className="mt-3 text-[11px] text-slate-400">Si necesitas más permisos, pídeselos a un administrador de tu empresa.</p>}
        </div>
      )}
      {tab === "privacy" && <PrivacyPanel />}
    </div>
  );
}
