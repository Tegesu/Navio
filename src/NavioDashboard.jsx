import React, { useState, useMemo, useEffect, useLayoutEffect, useCallback, useContext, useRef, createContext } from "react";
import { createClient } from "@supabase/supabase-js";
import { PeopleProvider } from "./people.jsx";
import { TrackingProvider, TrackingPill, DriverModeModal, LiveMapPage } from "./tracking.jsx";
import { TransfersPage } from "./trips.jsx";
import { InboxProvider, NavBadge, BellButton, NotificationsPanel, MessagesPage, TasksPage } from "./inbox.jsx";
import { hideSplash, FullScreenLoader, SupabaseSetupNotice, LoginPage, UpdatePasswordPage, MfaChallengePage, OnboardingPage, CompanyInactivePage, ConnectionErrorPage } from "./auth.jsx";
import { SettingsPage, AccountPage, IdleGuard } from "./settings.jsx";
import { AdminCompaniesPage } from "./admin.jsx";
import { MobileAppShell } from "./mobile.jsx";
import { CookieNotice, LegalAcceptanceGate } from "./legal.jsx";
import { HomePage } from "./home.jsx";
import { FleetDataProvider, VehicleStatusChip, FleetStatusSummary, VehicleDocsTab, VehicleServiceTab, VehicleTiresTab, VehicleHistoryTab, VehicleLocationPanel, WarrantiesPanel, WarrantiesPage, MaintenanceUnitDetail } from "./vehicle.jsx";
import {
  Home,
  Menu,
  Bell,
  LayoutGrid,
  X,
  ChevronDown,
  ChevronRight,
  Calendar,
  DollarSign,
  Truck,
  Wrench,
  ShieldCheck,
  Shield,
  Fuel,
  Plus,
  Edit2,
  CheckCircle2,
  AlertTriangle,
  Bot,
  MessageSquare,
  Settings,
  Sliders,
  Activity,
  MapPin,
  Disc,
  Droplet,
  User,
  Download,
  FileText,
  Camera,
  ArrowLeft,
  Search,
  Gauge,
  RotateCw,
  Zap,
  Navigation,
  Phone,
  Image as ImageIcon,
  HelpCircle,
  Layers,
  RefreshCw,
  Clock,
  Radio,
  Receipt,
  Upload,
  ChevronUp,
  Eye,
  EyeOff,
  LogOut,
  Mail,
  Lock,
  Trash2,
  ChevronLeft,
  ShieldAlert,
  ZoomIn,
  ZoomOut,
  Highlighter,
  Underline,
  Eraser,
  Hash,
  BarChart3,
  Printer,
  ClipboardList,
} from "lucide-react";

/* ---------------------------------------------------------------------- */
/*  Supabase — configuración de autenticación                            */
/* ---------------------------------------------------------------------- */

// 1. Crea un proyecto gratis en https://supabase.com
// 2. Ve a Project Settings > API y copia "Project URL" y la llave "anon public"
// 3. Pega esos dos valores aquí abajo (la llave "anon" está diseñada para vivir en
//    el cliente — NUNCA pegues aquí la "service_role", esa es secreta).
const SUPABASE_URL = "https://bwvetvomcfmolhfrrlcx.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ3dmV0dm9tY2Ztb2xoZnJybGN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2NTg1NjQsImV4cCI6MjEwMjIzNDU2NH0.ICSgvkdMUlKSfnriVUzmTQzYjk66NsDcixHMNMpGC_U";

const isSupabaseConfigured = SUPABASE_URL.startsWith("http") && SUPABASE_ANON_KEY.length > 20;
const supabase = isSupabaseConfigured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

/* ---------------------------------------------------------------------- */
/*  Avatares                                                              */
/* ---------------------------------------------------------------------- */

// Avatares con iniciales, generados aquí mismo: no se pide nada a servicios
// externos (ni se les comparte quién usa la plataforma).
const AVATAR_COLORS = ["#2563eb", "#0891b2", "#059669", "#d97706", "#dc2626", "#7c3aed", "#db2777", "#475569"];
function avatarUrl(name) {
  const clean = String(name || "?").trim() || "?";
  const initials = clean
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase()
    .replace(/[<>&"']/g, "");
  let hash = 0;
  for (const ch of clean) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${AVATAR_COLORS[hash % AVATAR_COLORS.length]}"/>` +
    `<text x="32" y="33" dy=".35em" text-anchor="middle" font-family="system-ui,sans-serif" font-size="26" font-weight="700" fill="#fff">${initials || "?"}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// Las fotos guardadas con el servicio de avatares anterior se cambian por el local.
function personPhoto(photo, name) {
  return photo && !/dicebear\.com/.test(photo) ? photo : avatarUrl(name);
}

/* ---------------------------------------------------------------------- */
/*  Global date-format context                                            */
/* ---------------------------------------------------------------------- */

const DateFormatContext = createContext({ format: "DD/MM/AAAA", setFormat: () => {} });
function useDateFormat() {
  return useContext(DateFormatContext);
}
function formatDate(isoDate, format) {
  if (!isoDate) return "—";
  const [year, month, day] = isoDate.split("-");
  return format === "MM/DD/AAAA" ? `${month}/${day}/${year}` : `${day}/${month}/${year}`;
}

function formatCurrency(amount, currency = "MXN") {
  try {
    return new Intl.NumberFormat("es-MX", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount || 0);
  } catch {
    return `$${(amount || 0).toLocaleString()}`;
  }
}

// Con centavos: para importes de factura, que deben coincidir con el documento.
function formatMoney(amount, currency = "MXN") {
  const value = Number(amount) || 0;
  try {
    return new Intl.NumberFormat("es-MX", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `$${value.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}

/* ---------------------------------------------------------------------- */
/*  Persistence — localStorage-backed state                               */
/* ---------------------------------------------------------------------- */

function useIsMobileViewport(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(() => (typeof window !== "undefined" ? window.innerWidth < breakpoint : false));

  useEffect(() => {
    function handleResize() {
      setIsMobile(window.innerWidth < breakpoint);
    }
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [breakpoint]);

  return isMobile;
}

function usePersistentState(key, initialValue) {
  const [state, setState] = useState(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored ? JSON.parse(stored) : initialValue;
    } catch {
      return initialValue;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // localStorage no disponible (modo privado, cuota excedida, etc.) — la app sigue funcionando en memoria.
    }
  }, [key, state]);
  return [state, setState];
}

// Igual, pero solo para esta pestaña: si el navegador recarga la página (por
// ejemplo, al liberar memoria de pestañas en segundo plano), se vuelve a la
// misma pantalla en lugar de al inicio.
function useSessionState(key, initialValue) {
  const [state, setState] = useState(() => {
    try {
      const stored = window.sessionStorage.getItem(key);
      return stored ? JSON.parse(stored) : initialValue;
    } catch {
      return initialValue;
    }
  });
  useEffect(() => {
    try {
      window.sessionStorage.setItem(key, JSON.stringify(state));
    } catch {
      // sessionStorage no disponible — la app sigue funcionando en memoria.
    }
  }, [key, state]);
  return [state, setState];
}

/* ---------------------------------------------------------------------- */
/*  Supabase table hook — fetch/insert/update/delete compartidos          */
/* ---------------------------------------------------------------------- */

// Con `enabled: false` la tabla no se pide hasta que una pantalla la necesita.
function useSupabaseTable(table, { orderBy = "id", ascending = false, companyId = null, enabled = true } = {}) {
  const [rows, setRows] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);

  // Solo la primera carga muestra "Cargando"; las siguientes actualizan en
  // silencio para no desmontar la pantalla que la persona tiene abierta.
  const refresh = useCallback(async () => {
    if (!supabase) {
      setLoaded(true);
      return;
    }
    const { data, error: fetchError } = await supabase.from(table).select("*").order(orderBy, { ascending });
    if (fetchError) setError(fetchError.message);
    else {
      setError(null);
      setRows(data ?? []);
    }
    setLoaded(true);
  }, [table, orderBy, ascending]);

  useEffect(() => {
    if (enabled) refresh();
  }, [refresh, enabled]);
  const loading = enabled && !loaded;

  async function insertRow(row) {
    const payload = companyId ? { ...row, companyId } : row;
    const { data, error: insertError } = await supabase.from(table).insert(payload).select().single();
    if (insertError) throw insertError;
    setRows((prev) => [data, ...prev]);
    return data;
  }

  async function updateRow(id, patch) {
    const { data, error: updateError } = await supabase.from(table).update(patch).eq("id", id).select().single();
    if (updateError) throw updateError;
    setRows((prev) => prev.map((r) => (r.id === id ? data : r)));
    return data;
  }

  async function removeRow(id) {
    const { error: deleteError } = await supabase.from(table).delete().eq("id", id);
    if (deleteError) throw deleteError;
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  return { rows, setRows, loading, error, insertRow, updateRow, removeRow, refresh };
}

/* ---------------------------------------------------------------------- */
/*  Toast context — lightweight feedback for simulated actions            */
/* ---------------------------------------------------------------------- */

const ToastContext = createContext({ showToast: () => {} });
function useToast() {
  return useContext(ToastContext);
}

function ToastHost({ toast, onDismiss }) {
  if (!toast) return null;
  return (
    <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
      <div className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white shadow-xl">
        <CheckCircle2 size={14} className="text-emerald-400" />
        {toast}
        <button onClick={onDismiss} className="ml-1 text-slate-400 hover:text-white">
          <X size={13} />
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Auth context — Supabase session management                           */
/* ---------------------------------------------------------------------- */

const AuthContext = createContext({
  user: null,
  session: null,
  profile: null,
  profileLoading: true,
  refreshProfile: async () => {},
  loading: true,
  passwordRecovery: false,
  mfaRequired: false,
  profileError: false,
  signIn: async () => {},
  signUp: async () => {},
  signOut: async () => {},
  resetPassword: async () => {},
  updatePassword: async () => {},
  enrollMFA: async () => {},
  verifyFactor: async () => {},
  unenrollMFA: async () => {},
  listMFAFactors: async () => {},
  joinCompanyWithCode: async () => {},
  requestCompany: async () => {},
  unlinkCompanyBot: async () => {},
});
function useAuth() {
  return useContext(AuthContext);
}

function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [profileError, setProfileError] = useState(false);
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);

  async function refreshAal() {
    if (!supabase) return;
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (!error && data) {
      setMfaRequired(data.nextLevel === "aal2" && data.currentLevel !== data.nextLevel);
    }
  }

  // Al volver a la pestaña, Supabase revalida la sesión y vuelve a avisar. Si
  // el perfil de ese usuario ya está cargado, se actualiza sin la pantalla de
  // "cargando": esa pantalla desmontaba la app y la regresaba al inicio.
  const loadedProfileUserRef = useRef(null);
  const refreshProfile = useCallback(async (userId) => {
    if (!supabase || !userId) {
      loadedProfileUserRef.current = null;
      setProfile(null);
      setProfileLoading(false);
      return;
    }
    if (loadedProfileUserRef.current !== userId) setProfileLoading(true);
    const query = (companyColumns) => supabase.from("profiles").select(`*, company:companies(${companyColumns})`).eq("id", userId).single();
    let { data, error } = await query("name, currency, botChannel, legalName, rfc, address, contactName, contactEmail, contactPhone, settings");
    // Antes de la migración v17 esas columnas no existen: se piden las de siempre.
    if (error) ({ data, error } = await query("name, currency, botChannel"));
    if (!error) {
      loadedProfileUserRef.current = userId;
      setProfile(data);
    }
    // Sin perfil no se sabe a qué empresa pertenece: se avisa en vez de adivinar.
    setProfileError(!!error && loadedProfileUserRef.current !== userId);
    setProfileLoading(false);
  }, []);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      setProfileLoading(false);
      return;
    }
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session) {
        await refreshAal();
        await refreshProfile(data.session.user.id);
      } else {
        setProfileLoading(false);
      }
      setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      setSession(newSession);
      if (event === "PASSWORD_RECOVERY") setPasswordRecovery(true);
      if (event === "SIGNED_OUT") {
        setPasswordRecovery(false);
        setMfaRequired(false);
        loadedProfileUserRef.current = null;
        setProfile(null);
      }
      if (newSession) {
        await refreshAal();
        await refreshProfile(newSession.user.id);
      }
    });
    return () => listener.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    // Si la cuenta tiene verificación en dos pasos, sigue la pantalla del código.
    await refreshAal();
  }

  async function signUp(email, password, fullName, legalVersion) {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, legal_version: legalVersion ?? null }, emailRedirectTo: window.location.origin },
    });
    if (error) throw error;
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  async function resetPassword(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname,
    });
    if (error) throw error;
  }

  async function updatePassword(newPassword) {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
    setPasswordRecovery(false);
  }

  // --- Autenticación de dos pasos (TOTP / apps tipo Google Authenticator) ---

  async function enrollMFA() {
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
    if (error) throw error;
    return data; // { id, totp: { qr_code, secret, uri } }
  }

  async function verifyFactor(factorId, code) {
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
    if (challengeError) throw challengeError;
    const { error: verifyError } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code });
    if (verifyError) throw verifyError;
    await refreshAal();
  }

  async function unenrollMFA(factorId) {
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    if (error) throw error;
    await refreshAal();
  }

  async function listMFAFactors() {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) throw error;
    return data; // { totp: [...], phone: [...] }
  }

  // --- Multiempresa: unirse con código / solicitar empresa nueva ---

  async function joinCompanyWithCode(code) {
    const { data, error } = await supabase.rpc("join_company_with_code", { invite_code: code.trim() });
    if (error) throw error;
    // Sin empresa de vuelta, el código no existe (o ya no está vigente).
    if (data == null) throw new Error("Ese código no es válido. Revisa que esté bien escrito o pide uno nuevo a tu administrador.");
    await refreshProfile(session.user.id);
    return data;
  }

  async function requestCompany(payload) {
    const { error } = await supabase.from("companies").insert({
      ...payload,
      requestedBy: session.user.id,
      status: "pending",
    });
    if (error) throw error;
  }

  async function unlinkCompanyBot() {
    if (!profile?.companyId) throw new Error("No perteneces a ninguna empresa todavía.");
    const { error } = await supabase.from("companies").update({ botChannel: null, botChatId: null }).eq("id", profile.companyId);
    if (error) throw error;
    await refreshProfile(session.user.id);
  }

  return (
    <AuthContext.Provider
      value={{
        user: session?.user ?? null,
        session,
        profile,
        profileLoading,
        refreshProfile: () => refreshProfile(session?.user?.id),
        loading,
        passwordRecovery,
        mfaRequired,
        profileError,
        signIn,
        signUp,
        signOut,
        resetPassword,
        updatePassword,
        joinCompanyWithCode,
        requestCompany,
        unlinkCompanyBot,
        enrollMFA,
        verifyFactor,
        unenrollMFA,
        listMFAFactors,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/* ---------------------------------------------------------------------- */
/*  Shared style tokens                                                   */
/* ---------------------------------------------------------------------- */

const ORIGIN_STYLES = {
  whatsapp: { label: "WhatsApp Cloud API", emoji: "📱", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  telegram: { label: "Telegram", emoji: "🤖", className: "bg-sky-50 text-sky-700 ring-sky-200" },
  manual: { label: "Registro Manual", emoji: "✍️", className: "bg-slate-100 text-slate-600 ring-slate-200" },
};

const STATUS_BADGE_STYLES = {
  pending: { label: "Pendiente de Validación", className: "bg-amber-50 text-amber-700 ring-amber-200", icon: AlertTriangle },
  verified: { label: "Verificado", className: "bg-emerald-50 text-emerald-700 ring-emerald-200", icon: CheckCircle2 },
  rejected: { label: "Rechazado", className: "bg-rose-50 text-rose-700 ring-rose-200", icon: X },
  voided: { label: "Anulada", className: "bg-slate-100 text-slate-500 ring-slate-200", icon: X },
};

const TONE_CLASSES = {
  amber: "bg-amber-50 text-amber-600",
  rose: "bg-rose-50 text-rose-600",
  red: "bg-red-50 text-red-600",
  blue: "bg-blue-50 text-blue-600",
  sky: "bg-sky-50 text-sky-600",
  emerald: "bg-emerald-50 text-emerald-600",
  slate: "bg-slate-100 text-slate-600",
};

/* ---------------------------------------------------------------------- */
/*  Flota: estados y estilos                                             */
/* ---------------------------------------------------------------------- */


const GPS_STATUS_STYLES = {
  moving: { label: "En Ruta", dot: "bg-emerald-500" },
  stopped: { label: "Detenida", dot: "bg-amber-500" },
  resting: { label: "En Pernocta", dot: "bg-indigo-400" },
  alert: { label: "Alerta / Incidente", dot: "bg-rose-500" },
  offline: { label: "Sin señal reciente", dot: "bg-slate-400" },
};

const LIVE_MAP_STATUS_STYLES = {
  moving: GPS_STATUS_STYLES.moving,
  stopped: GPS_STATUS_STYLES.stopped,
  offline: GPS_STATUS_STYLES.offline,
};

const FLEET_STATUS_FILTERS = [
  { id: "all", label: "Todas" },
  { id: "moving", label: "🟢 En Ruta" },
  { id: "stopped", label: "🟠 Detenidas" },
  { id: "offline", label: "⚪ Sin señal reciente" },
];

const GPS_STALE_MS = 5 * 60 * 1000;
const GPS_MOVING_KMH = 3;

function computeVehicleStatus(position) {
  if (!position) return "offline";
  const age = Date.now() - new Date(position.recordedAt).getTime();
  if (age > GPS_STALE_MS) return "offline";
  return (position.speed ?? 0) > GPS_MOVING_KMH ? "moving" : "stopped";
}

function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function timeAgoLabel(iso) {
  if (!iso) return "sin datos";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "hace instantes";
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.floor(hours / 24)} d`;
}

/* ---------------------------------------------------------------------- */
/*  Mantenimiento: categorías y resumen                                  */
/* ---------------------------------------------------------------------- */

const MAINTENANCE_CATEGORIES = [
  { id: "all", label: "Todos" },
  { id: "engine", label: "Motor y Aceite", emoji: "🛢️" },
  { id: "brakes", label: "Frenos y Balatas", emoji: "🛑" },
  { id: "tires", label: "Llantas y Neumáticos", emoji: "🛞" },
  { id: "paperwork", label: "Trámites / Guantera", emoji: "📄" },
];

const MAINTENANCE_CATEGORY_MAP = {
  engine: { label: "Motor y Aceite", emoji: "🛢️" },
  brakes: { label: "Frenos y Balatas", emoji: "🛑" },
  tires: { label: "Llantas y Neumáticos", emoji: "🛞" },
  paperwork: { label: "Trámites / Guantera", emoji: "📄" },
};

function getMaintenanceWidgets(records, vehicles) {
  const oilCount = records.filter((r) => r.category === "engine").length;
  const brakesCount = records.filter((r) => r.category === "brakes").length;
  const tiresCount = records.filter((r) => r.category === "tires").length;
  let mileageValue = "—";
  let mileageDetail = "Sin unidades registradas";
  if (vehicles && vehicles.length > 0) {
    const next = vehicles.reduce((min, v) => {
      const remaining = (v.kmProximoServicio ?? 0) - (v.kmActual ?? 0);
      return remaining < min.remaining ? { unit: v.unit, remaining } : min;
    }, { unit: vehicles[0].unit, remaining: (vehicles[0].kmProximoServicio ?? 0) - (vehicles[0].kmActual ?? 0) });
    mileageValue = next.unit;
    mileageDetail = `En ${next.remaining.toLocaleString()} km`;
  }
  return [
    { id: "oil", label: "Cambios de Aceite", icon: Droplet, value: `${oilCount} unidad${oilCount === 1 ? "" : "es"}`, detail: "Motor y aceite", tone: "amber" },
    { id: "brakes", label: "Servicio de Frenos", icon: Disc, value: `${brakesCount} unidad${brakesCount === 1 ? "" : "es"}`, detail: "Frenos y balatas", tone: "rose" },
    { id: "tires", label: "Rotación de Llantas", icon: RotateCw, value: `${tiresCount} unidad${tiresCount === 1 ? "" : "es"}`, detail: "Llantas y neumáticos", tone: "blue" },
    { id: "mileage", label: "Próximo Servicio por Km", icon: Gauge, value: mileageValue, detail: mileageDetail, tone: "slate" },
  ];
}


/* ---------------------------------------------------------------------- */
/*  Trámites: tipos y resumen                                            */
/* ---------------------------------------------------------------------- */

const COMPLIANCE_DOC_TYPES = ["Tenencia", "Póliza de Seguro", "Verificación Vehicular", "Licencia de Conducir", "Tarjeta de Circulación"];

function getComplianceWidgets(records) {
  const tenenciaPending = records.filter((r) => r.docType === "Tenencia" && r.paymentStatus === "Pendiente de Pago").length;
  const insurancePending = records.filter((r) => r.docType === "Póliza de Seguro" && r.paymentStatus === "Pendiente de Pago").length;
  const now = new Date();
  const licenseExpired = records.filter((r) => r.docType === "Licencia de Conducir" && r.dueDate && new Date(r.dueDate) < now).length;
  return [
    { id: "tenencia", label: "Tenencias por Vencer", icon: FileText, value: `${tenenciaPending} unidad${tenenciaPending === 1 ? "" : "es"}`, detail: "Pendientes de pago", tone: "amber" },
    { id: "insurance", label: "Pólizas por Renovar", icon: ShieldCheck, value: `${insurancePending} unidad${insurancePending === 1 ? "" : "es"}`, detail: "Pendientes de pago", tone: "rose" },
    { id: "license", label: "Licencias Expiradas", icon: User, value: `${licenseExpired} conductor${licenseExpired === 1 ? "" : "es"}`, detail: "Requiere renovación", tone: "red" },
  ];
}

/* ---------------------------------------------------------------------- */
/*  Shared UI primitives                                                  */
/* ---------------------------------------------------------------------- */

function Modal({ title, onClose, children, width = "max-w-md" }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4" onClick={onClose}>
      <div className={`w-full ${width} rounded-2xl border border-slate-200 bg-white p-5 shadow-xl`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-800">{title}</h3>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100" aria-label="Cerrar">
            <X size={15} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function DateFormatToggle() {
  const { format, setFormat } = useDateFormat();
  return (
    <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5 text-[11px] font-semibold">
      {["DD/MM/AAAA", "MM/DD/AAAA"].map((f) => (
        <button
          key={f}
          onClick={() => setFormat(f)}
          className={`rounded-md px-2 py-1 transition ${format === f ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}
        >
          {f}
        </button>
      ))}
    </div>
  );
}

function OriginBadge({ origin }) {
  const o = ORIGIN_STYLES[origin];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${o.className}`}>
      {o.emoji} {o.label}
    </span>
  );
}

function StatusBadge({ status }) {
  const s = STATUS_BADGE_STYLES[status];
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${s.className}`}>
      <Icon size={11} /> {s.label}
    </span>
  );
}

function KpiCard({ widget, action = null }) {
  const Icon = widget.icon;
  return (
    <div className="min-w-0 break-inside-avoid rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${TONE_CLASSES[widget.tone]}`}>
          <Icon size={16} />
        </span>
        {action}
      </div>
      <p className="mt-3 text-xs font-medium text-slate-500">{widget.label}</p>
      <p className="truncate text-lg font-bold text-slate-800" title={String(widget.value)}>
        {widget.value}
      </p>
      <p className="text-[11px] text-slate-400">{widget.detail}</p>
    </div>
  );
}

function WidgetSettingsModal({ widgets, visible, onToggle, onClose }) {
  return (
    <Modal title="Personalizar Widgets" onClose={onClose}>
      <p className="mb-3 text-xs text-slate-400">Activa o desactiva las tarjetas de alerta que quieres ver en esta sección.</p>
      <div className="space-y-2">
        {widgets.map((w) => {
          const Icon = w.icon;
          return (
            <label key={w.id} className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-100 px-3 py-2.5 hover:bg-slate-50">
              <span className="flex items-center gap-2 text-xs font-medium text-slate-600">
                <Icon size={15} className="text-blue-600" />
                {w.label}
              </span>
              <input type="checkbox" checked={visible[w.id]} onChange={() => onToggle(w.id)} className="h-4 w-4 accent-blue-600" />
            </label>
          );
        })}
      </div>
      <button onClick={onClose} className="mt-4 w-full rounded-lg bg-blue-600 py-2 text-xs font-semibold text-white hover:bg-blue-700">
        Listo
      </button>
    </Modal>
  );
}

function RecordsTable({ records, columns, onConfirm, onEdit, onDelete, emptyLabel }) {
  const { profile } = useAuth();
  const isCompanyAdmin = !!(profile?.isSuperAdmin || profile?.companyRole === "admin");

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full min-w-[920px] text-left text-xs">
        <thead>
          <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
            {columns.map((c) => (
              <th key={c.key} className={`px-4 py-3 font-semibold ${c.align === "right" ? "text-right" : ""}`}>
                {c.label}
              </th>
            ))}
            <th className="px-4 py-3 text-right font-semibold">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
              {columns.map((c) => (
                <td key={c.key} className={`px-4 py-3 ${c.align === "right" ? "text-right" : ""}`}>
                  {c.render(r)}
                </td>
              ))}
              <td className="px-4 py-3 text-right">
                <div className="flex justify-end gap-1.5">
                  {r.status === "pending" && (
                    <button
                      onClick={() => onConfirm(r)}
                      className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100"
                    >
                      <CheckCircle2 size={12} /> Confirmar
                    </button>
                  )}
                  <button
                    onClick={() => onEdit(r)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    <Edit2 size={12} /> Editar
                  </button>
                  {isCompanyAdmin && onDelete && (
                    <button
                      onClick={() => onDelete(r)}
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2.5 py-1.5 text-[11px] font-semibold text-rose-600 hover:bg-rose-50"
                    >
                      <Trash2 size={12} /> Eliminar
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {records.length === 0 && (
            <tr>
              <td colSpan={columns.length + 1} className="px-4 py-8 text-center text-xs text-slate-400">
                {emptyLabel}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Visor de documentos                                                   */
/* ---------------------------------------------------------------------- */

// Cualquier usuario o el bot puede subir un archivo, así que ninguno se abre
// tal cual: se revisa qué es por su contenido real (no por su nombre) y se
// pinta en un <canvas>. Lo que se ve son solo píxeles, de modo que los scripts,
// enlaces y formularios que traiga un PDF no hacen nada. El documento se pide
// con la sesión del usuario, sin generar ningún enlace temporal.
// El visor de PDF se sirve desde el propio sitio (vendor/pdfjs), no desde un CDN.
const PDFJS_BASE_URL = "/vendor/pdfjs";
const DOCUMENT_EXTENSIONS = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const DOCUMENT_ACCEPT = Object.keys(DOCUMENT_EXTENSIONS).join(",");
const DOCUMENT_TYPE_PROBLEM = "no es un PDF ni una imagen JPG, PNG o WEBP";
const DOCUMENT_MAX_MB = 20;
const MAX_CANVAS_PIXELS = 16000000; // Algunos celulares no dibujan canvas más grandes.

async function sniffDocumentType(blob) {
  const bytes = new Uint8Array(await blob.slice(0, 1024).arrayBuffer());
  const text = (start, end) => String.fromCharCode(...bytes.slice(start, end));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (text(0, 8) === "\x89PNG\r\n\x1a\n") return "image/png";
  if (text(0, 4) === "RIFF" && text(8, 12) === "WEBP") return "image/webp";
  // Igual que los lectores de PDF, se tolera basura antes del encabezado.
  if (text(0, bytes.length).includes("%PDF-")) return "application/pdf";
  return null;
}

function blockedDocument(message) {
  return Object.assign(new Error(message), { blocked: true });
}

let pdfJsPromise = null;
function loadPdfJs() {
  if (!pdfJsPromise) {
    const moduleUrl = `${PDFJS_BASE_URL}/pdf.min.mjs`;
    pdfJsPromise = import(moduleUrl)
      .then((pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE_URL}/pdf.worker.min.mjs`;
        return pdfjs;
      })
      .catch((err) => {
        pdfJsPromise = null;
        throw err;
      });
  }
  return pdfJsPromise;
}

// Da al canvas la resolución que pide el zoom y devuelve la escala a la que hay
// que dibujar. Su tamaño en pantalla lo decide el contenedor de la página.
function fitCanvas(canvas, natural, width, zoom) {
  const cssScale = (width / natural.width) * zoom;
  const maxScale = Math.sqrt(MAX_CANVAS_PIXELS / (natural.width * natural.height));
  const scale = Math.min(cssScale * Math.min(window.devicePixelRatio || 1, 2), maxScale);
  canvas.width = Math.floor(natural.width * scale);
  canvas.height = Math.floor(natural.height * scale);
  return scale;
}

async function openPdfDocument(blob) {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(await blob.arrayBuffer()),
    cMapUrl: `${PDFJS_BASE_URL}/cmaps/`,
    standardFontDataUrl: `${PDFJS_BASE_URL}/standard_fonts/`,
    wasmUrl: `${PDFJS_BASE_URL}/wasm/`,
    iccUrl: `${PDFJS_BASE_URL}/iccs/`,
    enableXfa: false,
  });
  let pdf;
  try {
    pdf = await task.promise;
  } catch (err) {
    task.destroy();
    if (err?.name === "PasswordException") throw blockedDocument("Este PDF tiene contraseña, así que no se puede mostrar.");
    if (err?.name === "InvalidPDFException") throw blockedDocument("Este PDF está dañado, así que no se puede mostrar.");
    throw err;
  }
  return {
    pages: pdf.numPages,
    draw(canvas, { page, rotation, width, zoom }) {
      let renderTask = null;
      let cancelled = false;
      const promise = pdf.getPage(page).then(async (pdfPage) => {
        if (cancelled) return null;
        const angle = (pdfPage.rotate + rotation) % 360;
        const natural = pdfPage.getViewport({ scale: 1, rotation: angle });
        const scale = fitCanvas(canvas, natural, width, zoom);
        renderTask = pdfPage.render({ canvas, viewport: pdfPage.getViewport({ scale, rotation: angle }) });
        await renderTask.promise;
        return natural;
      });
      return {
        promise,
        cancel() {
          cancelled = true;
          renderTask?.cancel();
        },
      };
    },
    close: () => task.destroy(),
  };
}

async function openImageDocument(blob, mime) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(new Blob([blob], { type: mime }));
  } catch {
    throw blockedDocument("Esta imagen está dañada, así que no se puede mostrar.");
  }
  return {
    pages: 1,
    draw(canvas, { rotation, width, zoom }) {
      const natural = rotation % 180 ? { width: bitmap.height, height: bitmap.width } : { width: bitmap.width, height: bitmap.height };
      const scale = fitCanvas(canvas, natural, width, zoom);
      const ctx = canvas.getContext("2d");
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.scale(scale, scale);
      ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
      return { promise: Promise.resolve(natural), cancel() {} };
    },
    close: () => bitmap.close(),
  };
}

async function openDocument(blob) {
  const mime = await sniffDocumentType(blob);
  if (!mime) throw blockedDocument(`Este archivo ${DOCUMENT_TYPE_PROBLEM}, así que no se muestra. Pide que lo carguen de nuevo.`);
  const opened = mime === "application/pdf" ? await openPdfDocument(blob) : await openImageDocument(blob, mime);
  return { ...opened, mime };
}

// Las marcas viven en su propia tabla y se dibujan encima de la página: el
// archivo nunca cambia, así que no hay copias y al descargar sale el original.
// Se guardan en fracciones (0 a 1) de la página sin girar para que no dependan
// del zoom ni del giro. La migración v15 aplica estos permisos en la base de datos.
const MARK_LABELS = { highlight: "Resaltado", underline: "Subrayado" };
const MARK_UNDERLINE_SIDES = { 0: "border-b-2", 90: "border-l-2", 180: "border-t-2", 270: "border-r-2" };

function rotateMark({ x, y, w, h }, rotation) {
  if (rotation === 90) return { x: 1 - y - h, y: x, w: h, h: w };
  if (rotation === 180) return { x: 1 - x - w, y: 1 - y - h, w, h };
  if (rotation === 270) return { x: y, y: 1 - x - w, w: h, h: w };
  return { x, y, w, h };
}

function canMarkInvoice(invoice, isAdmin) {
  return !isInvoiceClosed(invoice) && (isAdmin || (invoice.status || "pending") === "pending");
}

function useInvoiceMarks(invoice, documentUrl) {
  const { showToast } = useToast();
  const [marks, setMarks] = useState([]);
  const table = invoice ? INVOICE_TABLE_BY_MODULE[invoice.module] : null;
  const invoiceId = invoice?.id;

  useEffect(() => {
    setMarks([]);
    if (!table || !documentUrl) return undefined;
    let cancelled = false;
    supabase
      .from("invoice_marks")
      .select("*")
      .eq("invoiceTable", table)
      .eq("invoiceId", invoiceId)
      .eq("documentUrl", documentUrl)
      .order("createdAt", { ascending: true })
      .then(({ data }) => {
        if (!cancelled) setMarks(data ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [table, invoiceId, documentUrl]);

  async function addMark(mark) {
    const tempId = `nueva-${crypto.randomUUID()}`;
    setMarks((prev) => [...prev, { ...mark, id: tempId }]);
    const { data, error } = await supabase
      .from("invoice_marks")
      .insert({ invoiceTable: table, invoiceId, documentUrl, ...mark })
      .select()
      .single();
    setMarks((prev) => (error ? prev.filter((m) => m.id !== tempId) : prev.map((m) => (m.id === tempId ? data : m))));
    if (error) showToast(`No se pudo guardar la marca: ${error.message}`);
  }

  async function removeMark(id) {
    const { data, error } = await supabase.from("invoice_marks").delete().eq("id", id).select();
    if (error || !data?.length) {
      showToast(`No se pudo borrar la marca${error ? `: ${error.message}` : "."}`);
      return;
    }
    setMarks((prev) => prev.filter((m) => m.id !== id));
  }

  return { marks, addMark, removeMark };
}

function MarkBox({ mark, rotation, onErase }) {
  const box = rotateMark(mark, rotation);
  const look = mark.kind === "highlight" ? "bg-yellow-300/60 mix-blend-multiply" : `border-rose-600 ${MARK_UNDERLINE_SIDES[rotation]}`;
  return (
    <div
      title={mark.createdByName ? `${MARK_LABELS[mark.kind]} por ${mark.createdByName}` : MARK_LABELS[mark.kind]}
      onClick={onErase}
      className={`absolute ${look} ${onErase ? "cursor-pointer hover:ring-2 hover:ring-rose-500" : ""}`}
      style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }}
    >
      {onErase && <span className="absolute -inset-1.5" />}
    </div>
  );
}

const clampZoom = (zoom) => Math.min(4, Math.max(0.5, zoom));
const roundMark = (value) => Math.min(1, Math.max(0, Number(value.toFixed(5))));

function DocumentPreview({ path, file, invoice }) {
  const { user, profile } = useAuth();
  const isAdmin = !!(profile?.isSuperAdmin || profile?.companyRole === "admin");
  const { marks, addMark, removeMark } = useInvoiceMarks(file ? null : invoice, file ? null : path);
  const canMark = !file && !!invoice && canMarkInvoice(invoice, isAdmin);
  const [state, setState] = useState({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [width, setWidth] = useState(0);
  // Lo que ya está pintado: las marcas siguen al canvas, no a los botones.
  const [drawn, setDrawn] = useState(null);
  const [tool, setTool] = useState(null);
  const [drag, setDrag] = useState(null);
  const viewerRef = useRef(null);
  const boxRef = useRef(null);
  const pageRef = useRef(null);
  const overlayRef = useRef(null);
  const zoomRef = useRef(1);
  const zoomAnchorRef = useRef(null);
  const source = state.source;
  zoomRef.current = zoom;
  // Un PDF puede traer varias facturas: cada una abre en la página donde empieza.
  const startPageRef = useRef(1);
  startPageRef.current = Math.max(1, Math.floor(Number(invoice?.details?.documentPage)) || 1);

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(boxRef.current);
    return () => observer.disconnect();
  }, []);

  // Ctrl + rueda acerca el documento, no la página. React registra sus eventos
  // de rueda como pasivos, y esos no pueden impedir el zoom del navegador.
  useEffect(() => {
    if (!source) return undefined;
    const viewer = viewerRef.current;
    function handleWheel(e) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      const next = clampZoom(zoomRef.current * Math.exp(-delta * 0.002));
      if (next === zoomRef.current) return;
      const box = boxRef.current.getBoundingClientRect();
      zoomAnchorRef.current = { ratio: next / zoomRef.current, x: e.clientX - box.left, y: e.clientY - box.top };
      zoomRef.current = next;
      setZoom(next);
    }
    viewer.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewer.removeEventListener("wheel", handleWheel);
  }, [source]);

  // Mantiene bajo el puntero el mismo punto del documento al acercar con la rueda.
  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    if (!anchor) return;
    zoomAnchorRef.current = null;
    const box = boxRef.current;
    box.scrollLeft = (box.scrollLeft + anchor.x) * anchor.ratio - anchor.x;
    box.scrollTop = (box.scrollTop + anchor.y) * anchor.ratio - anchor.y;
  }, [zoom]);

  useEffect(() => {
    let cancelled = false;
    let opened = null;
    setState({ status: "loading" });
    setPage(1);
    setZoom(1);
    setRotation(0);
    setDrawn(null);
    setTool(null);
    setDrag(null);
    pageRef.current?.replaceChildren();
    (async () => {
      try {
        let blob = file;
        if (!blob) {
          const { data, error } = await supabase.storage.from("documents").download(path);
          if (error) throw error;
          blob = data;
        }
        const doc = await openDocument(blob);
        if (cancelled) {
          doc.close();
          return;
        }
        opened = doc;
        setPage(Math.min(startPageRef.current, doc.pages));
        setState({ status: "ready", source: doc, blob });
      } catch (err) {
        if (!cancelled) setState({ status: err.blocked ? "blocked" : "error", message: err.message });
      }
    })();
    return () => {
      cancelled = true;
      opened?.close();
    };
  }, [path, file, attempt]);

  // Cada dibujo usa un canvas nuevo: la página anterior sigue visible hasta que
  // la nueva está lista, y cambiar de zoom rápido no choca con el dibujo en curso.
  useEffect(() => {
    if (!source || !width) return undefined;
    const canvas = document.createElement("canvas");
    canvas.className = "block h-full w-full";
    let cancelled = false;
    const task = source.draw(canvas, { page, rotation, width, zoom });
    task.promise
      .then((natural) => {
        if (cancelled || !natural) return;
        pageRef.current?.replaceChildren(canvas);
        setDrawn({ page, rotation, aspect: natural.height / natural.width });
      })
      .catch(() => {
        if (cancelled) return;
        pageRef.current?.replaceChildren();
        setDrawn(null);
        setState({ status: "blocked", message: "Este documento está dañado, así que no se puede mostrar." });
      });
    return () => {
      cancelled = true;
      task.cancel();
    };
  }, [source, page, rotation, width, zoom]);

  function handleDownload() {
    const url = URL.createObjectURL(new Blob([state.blob], { type: "application/octet-stream" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `documento.${DOCUMENT_EXTENSIONS[source.mime]}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function pointerPosition(e) {
    const box = overlayRef.current.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)),
    };
  }

  // Pasa lo que se arrastró en pantalla a la página sin girar.
  function dragToMark({ start, end }) {
    const onScreen = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), w: Math.abs(end.x - start.x), h: Math.abs(end.y - start.y) };
    return rotateMark(onScreen, (360 - drawn.rotation) % 360);
  }

  function handlePointerDown(e) {
    if (tool !== "highlight" && tool !== "underline") return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const position = pointerPosition(e);
    setDrag({ start: position, end: position });
  }

  function handlePointerUp() {
    if (!drag) return;
    const mark = dragToMark(drag);
    setDrag(null);
    // Un clic suelto no deja marca; un subrayado sí puede no tener alto.
    if (Math.max(mark.w, mark.h) < 0.01 || (tool === "highlight" && Math.min(mark.w, mark.h) < 0.005)) return;
    addMark({ page: drawn.page, kind: tool, x: roundMark(mark.x), y: roundMark(mark.y), w: roundMark(mark.w), h: roundMark(mark.h) });
  }

  const toolClass = "flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-white disabled:opacity-40";
  const activeToolClass = "flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-white";
  const ready = state.status === "ready";
  const canErase = (mark) => canMark && typeof mark.id === "number" && (isAdmin || mark.createdBy === user?.id);
  const markedPages = [...new Set(marks.map((m) => m.page))].sort((a, b) => a - b);

  return (
    <div ref={viewerRef} className="flex h-full flex-col overflow-hidden whitespace-normal rounded-xl border border-slate-200 bg-slate-100">
      <div className="flex min-h-[2.5rem] shrink-0 flex-wrap items-center gap-1 border-b border-slate-200 px-2 py-1">
        {ready && (
          <>
            <button type="button" onClick={() => setZoom((z) => clampZoom(z - 0.25))} disabled={zoom <= 0.5} className={toolClass} aria-label="Alejar" title="Alejar (o Ctrl + rueda del ratón)">
              <ZoomOut size={14} />
            </button>
            <button type="button" onClick={() => setZoom(1)} className="w-11 rounded-lg py-1 text-[11px] font-semibold text-slate-500 hover:bg-white" title="Ajustar al ancho">
              {Math.round(zoom * 100)}%
            </button>
            <button type="button" onClick={() => setZoom((z) => clampZoom(z + 0.25))} disabled={zoom >= 4} className={toolClass} aria-label="Acercar" title="Acercar (o Ctrl + rueda del ratón)">
              <ZoomIn size={14} />
            </button>
            <button type="button" onClick={() => setRotation((r) => (r + 90) % 360)} className={toolClass} aria-label="Girar" title="Girar">
              <RotateCw size={14} />
            </button>
            {source.pages > 1 && (
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setPage((p) => p - 1)} disabled={page <= 1} className={toolClass} aria-label="Página anterior" title="Página anterior">
                  <ChevronLeft size={14} />
                </button>
                <span className="text-[11px] font-semibold text-slate-500">
                  {page} / {source.pages}
                </span>
                <button type="button" onClick={() => setPage((p) => p + 1)} disabled={page >= source.pages} className={toolClass} aria-label="Página siguiente" title="Página siguiente">
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
            {canMark && (
              <div className="flex items-center gap-1 border-l border-slate-200 pl-1">
                <button type="button" onClick={() => setTool((t) => (t === "highlight" ? null : "highlight"))} className={tool === "highlight" ? activeToolClass : toolClass} aria-label="Resaltar" aria-pressed={tool === "highlight"} title="Resaltar: arrastra sobre el documento">
                  <Highlighter size={14} />
                </button>
                <button type="button" onClick={() => setTool((t) => (t === "underline" ? null : "underline"))} className={tool === "underline" ? activeToolClass : toolClass} aria-label="Subrayar" aria-pressed={tool === "underline"} title="Subrayar: arrastra sobre el documento">
                  <Underline size={14} />
                </button>
                <button type="button" onClick={() => setTool((t) => (t === "erase" ? null : "erase"))} disabled={!marks.some(canErase)} className={tool === "erase" ? activeToolClass : toolClass} aria-label="Borrar marca" aria-pressed={tool === "erase"} title="Borrar marca: haz clic sobre ella">
                  <Eraser size={14} />
                </button>
              </div>
            )}
            {!file && (
              <button type="button" onClick={handleDownload} className={`${toolClass} ml-auto`} aria-label="Descargar" title="Descargar el archivo original, sin marcas">
                <Download size={14} />
              </button>
            )}
          </>
        )}
      </div>
      <div ref={boxRef} className="relative min-h-0 flex-1 overflow-auto p-2 [scrollbar-gutter:stable]">
        <div
          className={`relative mx-auto ${drawn ? "bg-white shadow" : ""}`}
          style={drawn ? { width: width * zoom, height: width * zoom * drawn.aspect } : undefined}
        >
          <div ref={pageRef} className="h-full w-full" />
          {drawn && (
            <div
              ref={overlayRef}
              onPointerDown={handlePointerDown}
              onPointerMove={(e) => drag && setDrag({ ...drag, end: pointerPosition(e) })}
              onPointerUp={handlePointerUp}
              onPointerCancel={() => setDrag(null)}
              className={`absolute inset-0 ${tool === "highlight" || tool === "underline" ? "cursor-crosshair touch-none" : ""}`}
            >
              {marks
                .filter((mark) => mark.page === drawn.page)
                .map((mark) => (
                  <MarkBox key={mark.id} mark={mark} rotation={drawn.rotation} onErase={tool === "erase" && canErase(mark) ? () => removeMark(mark.id) : undefined} />
                ))}
              {drag && <MarkBox mark={{ ...dragToMark(drag), kind: tool }} rotation={drawn.rotation} />}
            </div>
          )}
        </div>
        {state.status === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center text-xs font-medium text-slate-400">Cargando documento...</div>
        )}
        {state.status === "blocked" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-xs font-medium text-amber-700">
            <ShieldAlert size={22} />
            <p>{state.message}</p>
          </div>
        )}
        {state.status === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-xs font-medium text-slate-500">
            <AlertTriangle size={22} />
            <p>No se pudo abrir el documento: {state.message}</p>
            <button type="button" onClick={() => setAttempt((a) => a + 1)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
              Reintentar
            </button>
          </div>
        )}
      </div>
      <p className="flex shrink-0 items-center gap-1.5 border-t border-slate-200 px-3 py-1.5 text-[11px] text-slate-500">
        <ShieldCheck size={12} className="shrink-0" />
        {file
          ? "Archivo nuevo, todavía sin guardar."
          : marks.length > 0
          ? `${marks.length === 1 ? "1 marca" : `${marks.length} marcas`} (pág. ${markedPages.join(", ")}). No modifican el archivo ni salen al descargar.`
          : "Vista segura: nada de lo que contenga el archivo se ejecuta."}
      </p>
    </div>
  );
}

// Pone el documento a un lado del contenido (arriba en pantallas chicas).
function DocumentSplit({ path, file, invoice, children }) {
  const hasDocument = !!(path || file);
  return (
    <div className={hasDocument ? "flex max-h-[72vh] flex-col gap-4 overflow-y-auto lg:max-h-none lg:flex-row lg:overflow-visible" : ""}>
      {hasDocument && (
        <div className="h-[45vh] shrink-0 lg:h-[76vh] lg:w-1/2">
          <DocumentPreview path={path} file={file} invoice={invoice} />
        </div>
      )}
      <div className={hasDocument ? "min-w-0 pr-1 lg:max-h-[76vh] lg:flex-1 lg:overflow-y-auto" : "max-h-[70vh] overflow-y-auto pr-1"}>{children}</div>
    </div>
  );
}

function DocumentCell({ documentUrl, invoice }) {
  const [open, setOpen] = useState(false);

  if (!documentUrl) return <span className="text-[11px] text-slate-300">Sin documento</span>;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
      >
        <FileText size={12} /> Ver
      </button>
      {open && (
        <Modal title="Documento" width="max-w-4xl" onClose={() => setOpen(false)}>
          <div className="h-[76vh]">
            <DocumentPreview path={documentUrl} invoice={invoice} />
          </div>
        </Modal>
      )}
    </>
  );
}

// "Facturas y Gastos" (fuel/travel/misc) va de la factura hacia la
// unidad, no al revés — muchas veces se sube el documento antes de
// saber a qué vehículo cargarlo, o no aplica a ninguno en particular.
// Mantenimiento y Trámites sí viven en el expediente de una unidad
// específica, así que ahí el vehículo se queda obligatorio.
const VEHICLE_REQUIRED_MODULES = ["maintenance", "compliance"];

/* ---------------------------------------------------------------------- */
/*  Facturas y Gastos — conceptos, órdenes de trabajo y plazos            */
/* ---------------------------------------------------------------------- */

// Las tres tablas que alimentan "Facturas y Gastos".
const INVOICE_MODULES = ["fuel", "travel", "misc"];

// "Concepto" de una factura. Cada uno vive en una de las tres tablas:
// gasolina → fuel_records; viáticos/hotel/alimentos/transporte/otro →
// travel_expenses; los demás → misc_expenses (con su "category").
const EXPENSE_TYPES = [
  { id: "viaticos", label: "Viáticos", defaultDays: 5, module: "travel" },
  { id: "hotel", label: "Hotel", defaultDays: 5, module: "travel" },
  { id: "alimentos", label: "Alimentos", defaultDays: 3, module: "travel" },
  { id: "transporte", label: "Transporte", defaultDays: 3, module: "travel" },
  { id: "gasolina", label: "Gasolina", defaultDays: 3, module: "fuel" },
  { id: "casetas", label: "Casetas", defaultDays: 3, module: "misc", category: "tolls" },
  { id: "consumibles", label: "Consumibles", defaultDays: 7, module: "misc", category: "consumables" },
  { id: "refrigerante", label: "Refrigerante", defaultDays: 7, module: "misc", category: "coolant" },
  { id: "refacciones", label: "Refacciones", defaultDays: 7, module: "misc", category: "parts" },
  { id: "otro", label: "Otro", defaultDays: 7, module: "travel" },
];
const EXPENSE_TYPE_MAP = Object.fromEntries(EXPENSE_TYPES.map((t) => [t.id, t]));

function expenseTypeLabel(id) {
  return EXPENSE_TYPE_MAP[id]?.label ?? id ?? "—";
}

function targetForExpenseType(id) {
  const t = EXPENSE_TYPE_MAP[id] ?? EXPENSE_TYPE_MAP.otro;
  return { module: t.module, category: t.category ?? null };
}

// Concepto por defecto de un registro que todavía no lo trae (los
// anteriores a esta versión), según la tabla donde vive.
function defaultExpenseType(module, category) {
  if (module === "fuel") return "gasolina";
  if (module === "misc") return EXPENSE_TYPES.find((t) => t.category === category)?.id ?? "consumibles";
  return "viaticos";
}

function expenseTypeOf(module, record) {
  return record.expenseType || defaultExpenseType(module, record.category);
}

// Al editar una factura se queda en su tabla, así que solo se ofrecen
// los conceptos que le corresponden a esa tabla.
function expenseTypesForEdit(module, category) {
  return EXPENSE_TYPES.filter((t) => t.module === module && (module !== "misc" || t.category === category));
}

// Datos propios de cada concepto. Viven en la columna "details" (migración
// v16); los de combustible que ya tenían columna (litros, odómetro...) siguen
// en la suya.
const DESTINATION_PARAM = { id: "destination", label: "Destino", placeholder: "Ej. Mérida" };
const PEOPLE_PARAM = { id: "people", label: "Personas", number: true };
const DRIVER_PARAM = { id: "driver", label: "Conductor", placeholder: "Nombre del conductor" };
const ROUTE_PARAM = { id: "route", label: "Ruta", placeholder: "Ej. Coatzacoalcos - Mérida" };
const QUANTITY_PARAM = { id: "quantity", label: "Cantidad", number: true };
const ODOMETER_PARAM = { id: "odometerKm", label: "Odómetro (km)", number: true };
const EXPENSE_PARAMS = {
  gasolina: [{ id: "fuelType", label: "Tipo de combustible", options: ["Magna", "Premium", "Diésel", "Otro"] }, DRIVER_PARAM],
  viaticos: [DESTINATION_PARAM, { id: "tripDays", label: "Días del viaje", number: true }, PEOPLE_PARAM],
  hotel: [DESTINATION_PARAM, { id: "nights", label: "Noches", number: true }, PEOPLE_PARAM],
  alimentos: [DESTINATION_PARAM, PEOPLE_PARAM],
  transporte: [{ id: "transportType", label: "Tipo de transporte", options: ["Avión", "Autobús", "Taxi o app", "Renta de auto", "Otro"] }, ROUTE_PARAM, PEOPLE_PARAM],
  otro: [DESTINATION_PARAM],
  casetas: [
    { id: "plaza", label: "Caseta o plaza", placeholder: "Ej. Cosoleacaque" },
    ROUTE_PARAM,
    { id: "paymentMethod", label: "Forma de pago", options: ["TAG", "Efectivo", "Tarjeta"] },
    { id: "axles", label: "Ejes", number: true },
    DRIVER_PARAM,
  ],
  consumibles: [QUANTITY_PARAM, { id: "measure", label: "Unidad de medida", options: ["Pieza", "Litro", "Kilo", "Caja", "Paquete", "Servicio"] }],
  refrigerante: [
    { id: "coolantType", label: "Tipo de refrigerante", placeholder: "Ej. R-134a" },
    QUANTITY_PARAM,
    { id: "measure", label: "Unidad de medida", options: ["Litro", "Kilo", "Galón", "Pieza"] },
    ODOMETER_PARAM,
  ],
  refacciones: [
    { id: "partNumber", label: "Número de parte" },
    { id: "brand", label: "Marca" },
    QUANTITY_PARAM,
    { id: "warrantyMonths", label: "Garantía (meses)", number: true },
    ODOMETER_PARAM,
  ],
};

// Conserva solo los datos del concepto elegido; números como número.
function cleanExpenseParams(expenseType, values) {
  const out = {};
  for (const param of EXPENSE_PARAMS[expenseType] ?? []) {
    const raw = String(values[param.id] ?? "").trim();
    if (!raw) continue;
    if (!param.number) out[param.id] = raw;
    else if (Number(raw) >= 0) out[param.id] = Number(raw);
  }
  return out;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const ORDER_WARN_DAYS = 2;

function startOfLocalDay(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function localISODate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseISODate(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

function daysFromToday(iso) {
  return Math.round((parseISODate(iso) - startOfLocalDay()) / DAY_MS);
}

function addDaysISO(iso, n) {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + n);
  return localISODate(d);
}

// Plazos por concepto: lo que guardó la empresa, o el valor por defecto.
function getDeadlineDays(deadlineRows = []) {
  const days = Object.fromEntries(EXPENSE_TYPES.map((t) => [t.id, t.defaultDays]));
  for (const row of deadlineRows) days[row.expenseType] = row.days;
  return days;
}

// Une las tres tablas de facturas en una sola lista con el mismo formato.
function normalizeInvoices({ fuel = [], travel = [], misc = [] }) {
  const make = (module) => (r) => ({
    key: `${module}-${r.id}`,
    module,
    id: r.id,
    raw: r,
    expenseType: expenseTypeOf(module, r),
    project: (r.project || "").trim(),
    workOrder: (r.workOrder || "").trim(),
    date: r.date,
    amount: Number(r.amount) || 0,
    liters: module === "fuel" ? Number(r.liters) || 0 : 0,
    description: module === "fuel" ? r.station || r.vendor || "" : r.concept || "",
    vendor: r.vendor || "",
    invoiceFolio: r.invoiceFolio || "",
    unit: r.unit || "",
    plate: r.plate || "",
    driverName: r.driverName || r.details?.driver || "",
    details: r.details || {},
    station: r.station || "",
    odometer: Number(r.odometer) || 0,
    efficiency: Number(r.efficiency) || 0,
    notes: r.notes || "",
    cfdi: r.cfdi || null,
    origin: r.origin || "manual",
    status: r.status || "pending",
    statusReason: r.statusReason || "",
    approved: !!r.approved,
    approvedByName: r.approvedByName || "",
    uploadedByName: r.uploadedByName || "",
    documentUrl: r.documentUrl || null,
    createdAt: r.createdAt || null,
  });
  return [...fuel.map(make("fuel")), ...travel.map(make("travel")), ...misc.map(make("misc"))];
}

// Una factura "cerrada" tiene su documento, un monto y ya fue verificada.
function isInvoiceDone(inv) {
  return !!inv.documentUrl && inv.amount > 0 && inv.status === "verified";
}

// Flujo de una factura: Pendiente → Verificada → Aprobada. Un administrador
// puede rechazarla o anularla (es definitivo) y revertir una aprobación,
// siempre con motivo. Las facturas no se eliminan: las anuladas siguen en el
// historial sin contar en totales. La migración v13 aplica estas mismas
// reglas en la base de datos.
function isInvoiceClosed(inv) {
  return inv.status === "rejected" || inv.status === "voided";
}

function isInvoiceLocked(inv) {
  return isInvoiceClosed(inv) || inv.approved;
}

// Lo capturado a mano o, si no hay, la suma de las partidas que leyó el bot.
function invoiceQuantity(inv) {
  if (inv.details.quantity !== undefined) return Number(inv.details.quantity) || 0;
  return (inv.cfdi?.conceptos ?? []).reduce((s, c) => s + (Number(c.cantidad) || 0), 0);
}

function invoiceMeasure(inv) {
  return inv.details.measure || (inv.details.quantity === undefined ? inv.cfdi?.conceptos?.[0]?.unidad : "") || "";
}

// Las facturas que llegan por el bot traen el combustible en la descripción.
function invoiceFuelType(inv) {
  if (inv.module !== "fuel") return "";
  if (inv.details.fuelType) return inv.details.fuelType;
  const text = (inv.cfdi?.conceptos ?? []).map((c) => c.descripcion).join(" ");
  if (/di[eé]sel/i.test(text)) return "Diésel";
  if (/magna|regular/i.test(text)) return "Magna";
  if (/premium/i.test(text)) return "Premium";
  return "";
}

function invoiceUnitCost(inv) {
  const quantity = inv.module === "fuel" ? inv.liters : invoiceQuantity(inv);
  return quantity > 0 ? inv.amount / quantity : null;
}

// Las órdenes de trabajo se arman agrupando facturas por (proyecto, orden);
// "work_orders" solo aporta datos propios de la orden (su fecha límite).
// Las facturas rechazadas o anuladas no cuentan: se consideran descartadas.
function buildOrders(invoices, workOrderRows = [], deadlineDays = getDeadlineDays()) {
  const map = new Map();
  const ensure = (project, code) => {
    const key = `${project}\u0001${code}`;
    if (!map.has(key)) map.set(key, { key, project, code, dueDate: null, createdAt: null, invoices: [] });
    return map.get(key);
  };
  for (const wo of workOrderRows) {
    const o = ensure((wo.project || "").trim(), wo.code);
    o.dueDate = wo.dueDate || null;
    o.createdAt = wo.createdAt || null;
  }
  for (const inv of invoices) {
    if (inv.workOrder && !isInvoiceClosed(inv)) ensure(inv.project, inv.workOrder).invoices.push(inv);
  }

  return [...map.values()].map((o) => {
    const created = [o.createdAt, ...o.invoices.map((i) => i.createdAt)].filter(Boolean).sort();
    const missingDocs = o.invoices.length === 0 || o.invoices.some((i) => !i.documentUrl || i.amount <= 0);
    const pendingVerification = o.invoices.some((i) => i.status === "pending");
    const complete = o.invoices.length > 0 && o.invoices.every(isInvoiceDone);

    // Fecha límite: la propia de la orden y, por cada factura sin cerrar,
    // su fecha + el plazo del concepto. Manda la que llegue primero.
    let deadline = null;
    let daysLeft = null;
    if (!complete) {
      const candidates = [];
      if (o.dueDate) candidates.push(o.dueDate);
      for (const inv of o.invoices) {
        if (!isInvoiceDone(inv) && inv.date) candidates.push(addDaysISO(inv.date, deadlineDays[inv.expenseType] ?? 7));
      }
      deadline = candidates.sort()[0] ?? null;
      daysLeft = deadline ? daysFromToday(deadline) : null;
    }
    return { ...o, createdAt: created[0] ?? null, missingDocs, pendingVerification, complete, deadline, daysLeft };
  });
}

// Los proyectos salen del nombre escrito en facturas y órdenes. Todos están
// activos salvo los que un administrador cerró. El nombre vacío agrupa lo que
// todavía no tiene proyecto.
function buildProjects(invoices, orders, settingsRows = []) {
  const closed = new Set(settingsRows.filter((row) => row.closed).map((row) => row.project));
  const map = new Map();
  const ensure = (name) => {
    if (!map.has(name)) map.set(name, { name, closed: closed.has(name), invoices: [], orders: [] });
    return map.get(name);
  };
  for (const inv of invoices) ensure(inv.project).invoices.push(inv);
  for (const order of orders) ensure(order.project).orders.push(order);
  const spent = (p) => p.invoices.reduce((s, i) => s + (isInvoiceClosed(i) ? 0 : i.amount), 0);
  return [...map.values()].sort((a, b) => Number(a.closed) - Number(b.closed) || spent(b) - spent(a));
}

/* ---------------------------------------------------------------------- */
/*  Datos fiscales (CFDI)                                                 */
/* ---------------------------------------------------------------------- */

// Catálogos del SAT: la factura trae la clave ("G03") y aquí se traduce.
const SAT_TIPO_COMPROBANTE = { I: "Ingreso", E: "Egreso", T: "Traslado", P: "Pago", N: "Nómina" };
const SAT_METODO_PAGO = { PUE: "Pago en una sola exhibición", PPD: "Pago en parcialidades o diferido" };
const SAT_FORMA_PAGO = {
  "01": "Efectivo",
  "02": "Cheque nominativo",
  "03": "Transferencia electrónica",
  "04": "Tarjeta de crédito",
  "05": "Monedero electrónico",
  "06": "Dinero electrónico",
  "08": "Vales de despensa",
  12: "Dación en pago",
  13: "Pago por subrogación",
  14: "Pago por consignación",
  15: "Condonación",
  17: "Compensación",
  23: "Novación",
  24: "Confusión",
  25: "Remisión de deuda",
  26: "Prescripción o caducidad",
  27: "A satisfacción del acreedor",
  28: "Tarjeta de débito",
  29: "Tarjeta de servicios",
  30: "Aplicación de anticipos",
  31: "Intermediario de pagos",
  99: "Por definir",
};
const SAT_USO_CFDI = {
  G01: "Adquisición de mercancías",
  G02: "Devoluciones, descuentos o bonificaciones",
  G03: "Gastos en general",
  I01: "Construcciones",
  I02: "Mobiliario y equipo de oficina",
  I03: "Equipo de transporte",
  I04: "Equipo de cómputo y accesorios",
  I05: "Dados, troqueles, moldes y herramental",
  I06: "Comunicaciones telefónicas",
  I07: "Comunicaciones satelitales",
  I08: "Otra maquinaria y equipo",
  D01: "Honorarios médicos y gastos hospitalarios",
  D02: "Gastos médicos por incapacidad",
  D03: "Gastos funerales",
  D04: "Donativos",
  D05: "Intereses de créditos hipotecarios",
  D06: "Aportaciones voluntarias al SAR",
  D07: "Primas por seguros de gastos médicos",
  D08: "Transportación escolar obligatoria",
  D09: "Depósitos para el ahorro y pensiones",
  D10: "Servicios educativos (colegiaturas)",
  S01: "Sin efectos fiscales",
  CP01: "Pagos",
  CN01: "Nómina",
};
const SAT_REGIMEN = {
  601: "General de Ley Personas Morales",
  603: "Personas Morales con Fines no Lucrativos",
  605: "Sueldos y Salarios",
  606: "Arrendamiento",
  607: "Enajenación o Adquisición de Bienes",
  608: "Demás ingresos",
  610: "Residentes en el Extranjero",
  611: "Dividendos",
  612: "Personas Físicas con Actividades Empresariales y Profesionales",
  614: "Ingresos por intereses",
  615: "Obtención de premios",
  616: "Sin obligaciones fiscales",
  620: "Sociedades Cooperativas de Producción",
  621: "Incorporación Fiscal",
  622: "Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras",
  623: "Opcional para Grupos de Sociedades",
  624: "Coordinados",
  625: "Plataformas Tecnológicas",
  626: "Régimen Simplificado de Confianza (RESICO)",
};

function decodeSat(catalog, code) {
  if (code === undefined || code === null || code === "") return "";
  const key = String(code).trim();
  const label = catalog[key] ?? catalog[key.padStart(2, "0")];
  return label ? `${code} — ${label}` : String(code);
}

function getAtPath(obj, path) {
  return path.split(".").reduce((value, key) => value?.[key], obj);
}

function setAtPath(obj, path, value) {
  const [head, ...rest] = path.split(".");
  return { ...obj, [head]: rest.length ? setAtPath(obj?.[head] ?? {}, rest.join("."), value) : value };
}

function pruneEmpty(value) {
  if (value === null || value === undefined || value === "") return undefined;
  if (Array.isArray(value)) {
    const items = value.map(pruneEmpty).filter((v) => v !== undefined);
    return items.length ? items : undefined;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value)
      .map(([k, v]) => [k, pruneEmpty(v)])
      .filter(([, v]) => v !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  return value;
}

// Campos fiscales que se pueden capturar o corregir a mano en el formulario.
// Las partidas y los "otros datos" que leyó la IA se conservan sin tocarlos.
const CFDI_FORM_FIELDS = [
  { path: "uuid", label: "Folio fiscal (UUID)", wide: true },
  { path: "emisor.rfc", label: "RFC emisor" },
  { path: "emisor.regimenFiscal", label: "Régimen emisor" },
  { path: "receptor.nombre", label: "Receptor" },
  { path: "receptor.rfc", label: "RFC receptor" },
  { path: "receptor.usoCFDI", label: "Uso de CFDI" },
  { path: "receptor.regimenFiscal", label: "Régimen receptor" },
  { path: "metodoPago", label: "Método de pago" },
  { path: "formaPago", label: "Forma de pago" },
  { path: "moneda", label: "Moneda" },
  { path: "tipoCambio", label: "Tipo de cambio", number: true },
  { path: "importes.subtotal", label: "Subtotal", number: true },
  { path: "importes.descuento", label: "Descuento", number: true },
  { path: "importes.iva", label: "IVA", number: true },
  { path: "importes.ieps", label: "IEPS", number: true },
  { path: "importes.ish", label: "ISH", number: true },
  { path: "importes.otrosImpuestos", label: "Otros impuestos", number: true },
  { path: "importes.retencionIVA", label: "Retención IVA", number: true },
  { path: "importes.retencionISR", label: "Retención ISR", number: true },
];

// Datos fiscales listos para guardar, o null si no hay ninguno. El total
// siempre es el Monto del formulario, para que nunca se contradigan.
function buildCfdiFromForm(cfdi, amount) {
  let out = cfdi;
  for (const field of CFDI_FORM_FIELDS) {
    const value = getAtPath(out, field.path);
    if (field.number && value !== undefined && value !== "") {
      const n = Number(String(value).replace(/[$,\s]/g, ""));
      if (Number.isFinite(n)) out = setAtPath(out, field.path, n);
    }
  }
  const pruned = pruneEmpty(out);
  return pruned ? setAtPath(pruned, "importes.total", amount) : null;
}

// Revisiones simples para detectar una lectura equivocada antes de confirmar.
function cfdiWarnings(cfdi) {
  if (!cfdi) return [];
  const warnings = [];
  if (cfdi.uuid && !/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i.test(cfdi.uuid)) {
    warnings.push("El folio fiscal (UUID) no tiene el formato correcto.");
  }
  const rfcPattern = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i;
  if (cfdi.emisor?.rfc && !rfcPattern.test(cfdi.emisor.rfc)) warnings.push("El RFC del emisor no tiene el formato correcto.");
  if (cfdi.receptor?.rfc && !rfcPattern.test(cfdi.receptor.rfc)) warnings.push("El RFC del receptor no tiene el formato correcto.");
  const i = cfdi.importes ?? {};
  const n = (v) => Number(v) || 0;
  if (i.subtotal !== undefined && i.total !== undefined) {
    const expected = n(i.subtotal) - n(i.descuento) + n(i.iva) + n(i.ieps) + n(i.ish) + n(i.otrosImpuestos) - n(i.retencionIVA) - n(i.retencionISR);
    // La propina a veces va dentro del total y a veces no: cualquiera de los dos cuadra.
    if (Math.abs(expected - n(i.total)) > 1 && Math.abs(expected + n(i.propina) - n(i.total)) > 1) {
      warnings.push(`Los importes no cuadran: la suma da ${formatMoney(expected, cfdi.moneda || "MXN")} y el total dice ${formatMoney(i.total, cfdi.moneda || "MXN")}.`);
    }
  }
  return warnings;
}

function RecordFormModal({ mode, module: fixedModule, fixedCategory, presetExpenseType, presetProject = "", initial, vehicles, orders = [], projectOptions = [], onSave, onClose }) {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [moduleState, setModule] = useState(fixedModule ?? initial?.module ?? "maintenance");
  const [expenseType, setExpenseType] = useState(
    initial?.expenseType ?? presetExpenseType ?? defaultExpenseType(fixedModule ?? initial?.module ?? "maintenance", initial?.category ?? fixedCategory)
  );
  const isInvoiceFlow = INVOICE_MODULES.includes(moduleState);
  const typeTarget = targetForExpenseType(expenseType);
  // Al crear una factura, el concepto elegido decide en qué tabla cae;
  // al editar, se queda en la tabla donde ya vive.
  const module = isInvoiceFlow && !initial ? typeTarget.module : moduleState;
  const typeOptions = initial ? expenseTypesForEdit(module, initial.category) : EXPENSE_TYPES;
  const [project, setProject] = useState(initial?.project ?? presetProject);
  const [params, setParams] = useState(initial?.details ?? {});
  const [cfdi, setCfdi] = useState(initial?.cfdi ?? {});
  const [workOrder, setWorkOrder] = useState(initial?.workOrder ?? "");
  const [orderDueDate, setOrderDueDate] = useState(
    orders.find((o) => o.code === (initial?.workOrder ?? "") && o.project === (initial?.project ?? ""))?.dueDate ?? ""
  );
  // En facturas el vehículo es opcional: no se preselecciona ninguno.
  const [unit, setUnit] = useState(initial?.unit ?? (isInvoiceFlow ? "" : vehicles[0]?.unit ?? ""));
  const [category, setCategory] = useState(initial?.category ?? "engine");
  const [docType, setDocType] = useState(initial?.docType ?? "Tenencia");
  const [paymentStatus, setPaymentStatus] = useState(initial?.paymentStatus ?? "Pendiente de Pago");
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? "");
  const [driverName, setDriverName] = useState(initial?.driverName ?? "");
  const [station, setStation] = useState(initial?.station ?? "");
  const [liters, setLiters] = useState(initial?.liters ?? "");
  const [odometer, setOdometer] = useState(initial?.odometer ?? "");
  const [efficiency, setEfficiency] = useState(initial?.efficiency ?? "");
  const [concept, setConcept] = useState(initial?.concept ?? "");
  const [amount, setAmount] = useState(initial?.amount ?? "");
  const [date, setDate] = useState(initial?.date ?? new Date().toISOString().slice(0, 10));
  const [vendor, setVendor] = useState(initial?.vendor ?? "");
  const [invoiceFolio, setInvoiceFolio] = useState(initial?.invoiceFolio ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const plate = vehicles.find((v) => v.unit === unit)?.plate ?? "";

  async function handleFileChange(e) {
    const input = e.target;
    const picked = input.files?.[0] ?? null;
    let problem = "";
    if (picked && picked.size > DOCUMENT_MAX_MB * 1024 * 1024) problem = `pesa más de ${DOCUMENT_MAX_MB} MB`;
    else if (picked && !(await sniffDocumentType(picked))) problem = DOCUMENT_TYPE_PROBLEM;
    if (problem) input.value = "";
    setFileError(problem ? `Este archivo ${problem}, así que no se puede cargar.` : "");
    setFile(problem ? null : picked);
  }

  // Al escribir una orden que ya existe, se completan su proyecto y fecha límite.
  function handleWorkOrderChange(value) {
    setWorkOrder(value);
    const match = orders.find((o) => o.code === value.trim() && (!project.trim() || o.project === project.trim()));
    if (match) {
      if (!project.trim()) setProject(match.project);
      if (match.dueDate && !orderDueDate) setOrderDueDate(match.dueDate);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if ((module !== "fuel" && !concept.trim()) || !date || (VEHICLE_REQUIRED_MODULES.includes(module) && !unit)) {
      setError(
        isInvoiceFlow ? "Completa al menos la descripción y la fecha." : "Completa al menos el vehículo, el concepto y la fecha."
      );
      return;
    }
    if (module === "fuel" && (!liters || Number(liters) <= 0)) {
      setError("Indica los litros cargados para poder calcular el rendimiento.");
      return;
    }
    setError("");
    setUploading(true);
    try {
      let documentUrl = initial?.documentUrl ?? null;
      if (file) {
        const mime = await sniffDocumentType(file);
        const path = `${profile.companyId}/${module}/${crypto.randomUUID()}.${DOCUMENT_EXTENSIONS[mime]}`;
        const { error: uploadError } = await supabase.storage.from("documents").upload(path, file, { contentType: mime });
        if (uploadError) throw uploadError;
        documentUrl = path;
      }
      const base = {
        ...(initial ?? {}),
        unit,
        plate,
        amount: Number(amount) || 0,
        date,
        vendor: vendor.trim(),
        invoiceFolio: invoiceFolio.trim(),
        notes: notes.trim(),
        documentUrl,
      };
      // "fuel_records" no tiene columna "concept" — usa "station" como su
      // campo descriptivo. Mandarla ahí tira un error de esquema.
      if (module !== "fuel") base.concept = concept.trim();
      if (module === "maintenance") base.category = category;
      if (module === "compliance") {
        base.docType = docType;
        base.paymentStatus = paymentStatus;
        base.dueDate = dueDate;
      }
      if (module === "fuel") {
        base.station = station.trim();
        base.liters = Number(liters) || 0;
        base.odometer = Number(odometer) || 0;
        base.efficiency = Number(efficiency) || 0;
      }
      if (module === "travel") {
        base.driverName = driverName.trim();
      }
      if (module === "misc") {
        base.category = initial?.category ?? typeTarget.category ?? fixedCategory;
      }
      if (INVOICE_MODULES.includes(module)) {
        base.expenseType = expenseType;
        base.project = project.trim();
        base.workOrder = workOrder.trim();
        const fiscal = buildCfdiFromForm(cfdi, base.amount);
        if (fiscal) base.cfdi = fiscal;
        else if (initial?.cfdi) base.cfdi = null;
        const details = cleanExpenseParams(expenseType, params);
        // La página del PDF donde empieza la factura (la pone el bot) sigue
        // valiendo mientras no se reemplace el documento.
        if (initial?.details?.documentPage && !file) details.documentPage = initial.details.documentPage;
        if (Object.keys(details).length > 0) base.details = details;
        else if (initial?.details) base.details = null;
      }
      onSave(module, base, { orderDueDate: orderDueDate || null });
    } catch (err) {
      showToast(`Error al subir el documento: ${err.message}`);
    } finally {
      setUploading(false);
    }
  }

  const inputClass = "w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-blue-400 focus:outline-none";
  const labelClass = "mb-1 block text-[11px] font-semibold text-slate-500";

  return (
    <Modal
      title={
        isInvoiceFlow
          ? mode === "edit"
            ? "Editar factura"
            : "Cargar factura"
          : mode === "edit"
          ? "Editar / Corregir Registro"
          : "Agregar Registro Manual"
      }
      width={file || initial?.documentUrl ? "max-w-6xl" : "max-w-lg"}
      onClose={onClose}
    >
      <DocumentSplit path={initial?.documentUrl} file={file} invoice={isInvoiceFlow && initial ? { ...initial, module } : null}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {!fixedModule && (
          <div>
            <label className={labelClass}>Módulo Destino</label>
            <select
              value={moduleState}
              onChange={(e) => {
                setModule(e.target.value);
                setExpenseType(defaultExpenseType(e.target.value));
              }}
              className={inputClass}
            >
              <option value="maintenance">Mantenimiento</option>
              <option value="compliance">Cumplimiento</option>
              <option value="fuel">Consumo de Combustible</option>
              <option value="travel">Viáticos</option>
            </select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Vehículo{!VEHICLE_REQUIRED_MODULES.includes(module) && " (opcional)"}</label>
            <select value={unit} onChange={(e) => setUnit(e.target.value)} className={inputClass}>
              {!VEHICLE_REQUIRED_MODULES.includes(module) && <option value="">Sin vehículo asociado</option>}
              {vehicles.map((v) => (
                <option key={v.unit} value={v.unit}>
                  {v.unit} — {v.plate}
                </option>
              ))}
            </select>
          </div>
          {module === "travel" && (
            <div>
              <label className={labelClass}>Conductor</label>
              <input value={driverName} onChange={(e) => setDriverName(e.target.value)} placeholder="Nombre del conductor" className={inputClass} />
            </div>
          )}
          {module === "maintenance" && (
            <div>
              <label className={labelClass}>Categoría</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
                {MAINTENANCE_CATEGORIES.filter((c) => c.id !== "all").map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.emoji} {c.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          {module === "compliance" && (
            <div>
              <label className={labelClass}>Tipo de Trámite</label>
              <select value={docType} onChange={(e) => setDocType(e.target.value)} className={inputClass}>
                {COMPLIANCE_DOC_TYPES.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          )}
          {module === "fuel" && (
            <div>
              <label className={labelClass}>Estación de Servicio</label>
              <input value={station} onChange={(e) => setStation(e.target.value)} placeholder="Ej. Pemex Nanchital" className={inputClass} />
            </div>
          )}
        </div>

        {isInvoiceFlow && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Concepto</label>
                <select value={expenseType} onChange={(e) => setExpenseType(e.target.value)} className={inputClass}>
                  {typeOptions.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Proyecto</label>
                <input
                  list="navio-project-options"
                  value={project}
                  onChange={(e) => setProject(e.target.value)}
                  placeholder="Ej. Tren Maya"
                  className={inputClass}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Orden de trabajo</label>
                <input
                  list="navio-order-options"
                  value={workOrder}
                  onChange={(e) => handleWorkOrderChange(e.target.value)}
                  placeholder="Ej. OT24053"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Fecha límite de la orden (opcional)</label>
                <input
                  type="date"
                  value={orderDueDate}
                  onChange={(e) => setOrderDueDate(e.target.value)}
                  disabled={!workOrder.trim()}
                  className={`${inputClass} disabled:bg-slate-50 disabled:text-slate-300`}
                />
              </div>
            </div>
            <datalist id="navio-project-options">
              {projectOptions.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
            <datalist id="navio-order-options">
              {orders
                .filter((o) => !project.trim() || o.project === project.trim())
                .map((o) => (
                  <option key={o.key} value={o.code}>
                    {o.project}
                  </option>
                ))}
            </datalist>
          </>
        )}

        {module !== "fuel" && (
          <div>
            <label className={labelClass}>{isInvoiceFlow ? "Descripción" : "Concepto"}</label>
            <input
              value={concept}
              onChange={(e) => setConcept(e.target.value)}
              placeholder={isInvoiceFlow ? 'Ej. "Renta de habitación"' : 'Ej. "Cambio de aceite y filtro"'}
              className={inputClass}
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Fecha</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Monto (MXN)</label>
            <input type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" className={inputClass} />
          </div>
        </div>

        {module === "compliance" && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Estado de Pago</label>
              <select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)} className={inputClass}>
                <option value="Pagado">Pagado</option>
                <option value="Pendiente de Pago">Pendiente de Pago</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Fecha de Vencimiento</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputClass} />
            </div>
          </div>
        )}

        {module === "fuel" && (
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelClass}>Litros Cargados</label>
              <input type="number" min="0" step="any" value={liters} onChange={(e) => setLiters(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Odómetro (km)</label>
              <input type="number" min="0" step="any" value={odometer} onChange={(e) => setOdometer(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Rendimiento (km/L)</label>
              <input type="number" min="0" step="any" value={efficiency} onChange={(e) => setEfficiency(e.target.value)} placeholder="Ej. 3.6" className={inputClass} />
            </div>
          </div>
        )}

        {isInvoiceFlow && EXPENSE_PARAMS[expenseType] && (
          <div className="rounded-xl border border-slate-200 px-3 py-2.5">
            <p className="mb-2 text-[11px] font-semibold text-slate-600">Datos de {expenseTypeLabel(expenseType).toLowerCase()} (opcional)</p>
            <div className="grid grid-cols-2 gap-3">
              {EXPENSE_PARAMS[expenseType].map((param) => {
                const setParam = (e) => setParams((prev) => ({ ...prev, [param.id]: e.target.value }));
                return (
                  <div key={param.id}>
                    <label className={labelClass}>{param.label}</label>
                    {param.options ? (
                      <select value={params[param.id] ?? ""} onChange={setParam} className={inputClass}>
                        <option value="">Sin indicar</option>
                        {param.options.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={param.number ? "number" : "text"}
                        min={param.number ? "0" : undefined}
                        step={param.number ? "any" : undefined}
                        value={params[param.id] ?? ""}
                        onChange={setParam}
                        placeholder={param.placeholder}
                        className={inputClass}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Taller / Proveedor</label>
            <input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Ej. Taller Central Coatzacoalcos" className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Folio de Factura</label>
            <input value={invoiceFolio} onChange={(e) => setInvoiceFolio(e.target.value)} placeholder="Ej. FA-00123" className={inputClass} />
          </div>
        </div>

        {isInvoiceFlow && (
          <details open={!!initial?.cfdi} className="rounded-xl border border-slate-200 px-3 py-2">
            <summary className="cursor-pointer text-[11px] font-semibold text-slate-600">Datos fiscales (CFDI) — opcional</summary>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {CFDI_FORM_FIELDS.map((field) => (
                <div key={field.path} className={field.wide ? "col-span-2" : ""}>
                  <label className={labelClass}>{field.label}</label>
                  <input
                    value={getAtPath(cfdi, field.path) ?? ""}
                    onChange={(e) => setCfdi((prev) => setAtPath(prev, field.path, e.target.value))}
                    inputMode={field.number ? "decimal" : undefined}
                    className={inputClass}
                  />
                </div>
              ))}
            </div>
            {initial?.cfdi?.conceptos && (
              <p className="mt-2 text-[11px] text-slate-400">Las partidas y otros datos que leyó la IA se conservan; se ven en "Detalle".</p>
            )}
          </details>
        )}

        <div>
          <label className={labelClass}>Notas (opcional)</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputClass} />
        </div>

        <div>
          <label className={labelClass}>Documento (foto o PDF, opcional)</label>
          {initial?.documentUrl && !file && (
            <p className="mb-1.5 text-[11px] text-emerald-600">Ya hay un documento adjunto — sube uno nuevo para reemplazarlo.</p>
          )}
          <input
            type="file"
            accept={DOCUMENT_ACCEPT}
            onChange={handleFileChange}
            className="w-full text-xs text-slate-500 file:mr-3 file:rounded-lg file:border file:border-slate-200 file:bg-white file:px-2.5 file:py-1.5 file:text-xs file:font-semibold file:text-slate-600 hover:file:bg-slate-50"
          />
          {fileError && (
            <p className="mt-1.5 flex items-center gap-1.5 rounded-lg bg-rose-50 px-2.5 py-2 text-[11px] font-medium text-rose-700">
              <AlertTriangle size={13} className="shrink-0" />
              {fileError}
            </p>
          )}
        </div>

        {mode === "edit" && (
          <p className="flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-2 text-[11px] font-medium text-emerald-700">
            <ShieldCheck size={13} />
            Al guardar, este registro se marcará como "Verificado".
          </p>
        )}

        {error && (
          <p className="flex items-center gap-1.5 rounded-lg bg-rose-50 px-2.5 py-2 text-[11px] font-medium text-rose-700">
            <AlertTriangle size={13} />
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={uploading}
            className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {uploading ? "Subiendo..." : mode === "edit" ? "Guardar cambios" : "Agregar registro"}
          </button>
        </div>
      </form>
      </DocumentSplit>
    </Modal>
  );
}

/* ---------------------------------------------------------------------- */
/*  Fleet — mosaic view                                                   */
/* ---------------------------------------------------------------------- */

function daysUntil(dateStr) {
  return Math.round((new Date(dateStr) - new Date(localISODate())) / (1000 * 60 * 60 * 24));
}

/* ---------------------------------------------------------------------- */
/*  Fotos y chofer de cada unidad                                         */
/* ---------------------------------------------------------------------- */

// Un chofer "variable" cambia según el viaje: la unidad no tiene uno asignado.
const isVariableDriver = (vehicle) => vehicle?.driver?.mode === "variable";
const vehicleDriverName = (vehicle) => (isVariableDriver(vehicle) ? "" : vehicle?.driver?.name || "");
const vehicleDriverLabel = (vehicle) => (isVariableDriver(vehicle) ? "Chofer variable" : vehicle?.driver?.name || "Sin asignar");

// Las fotos subidas se guardan en el bucket privado con la ruta de la empresa
// ("3/vehicles/....jpg"). Las de demostración (picsum) no son de la unidad.
const isStoredImage = (src) => typeof src === "string" && /^\d+\//.test(src);
const vehicleImage = (src) => (src && !/picsum\.photos/.test(src) ? src : null);
const VEHICLE_PHOTO_MAX_MB = 10;
const storedImages = new Map();

// Se descargan con la sesión y se muestran desde la memoria del navegador,
// sin enlaces públicos. Cada foto se descarga una sola vez por visita.
function useVehicleImage(src) {
  const source = vehicleImage(src);
  const [url, setUrl] = useState(() => (source && !isStoredImage(source) ? source : storedImages.get(source)?.url ?? null));
  useEffect(() => {
    if (!source || !isStoredImage(source)) {
      setUrl(source);
      return undefined;
    }
    let cancelled = false;
    let entry = storedImages.get(source);
    if (!entry) {
      entry = {};
      entry.promise = supabase.storage
        .from("documents")
        .download(source)
        .then(({ data, error }) => {
          if (error) throw error;
          entry.url = URL.createObjectURL(data);
          return entry.url;
        });
      entry.promise.catch(() => storedImages.delete(source));
      storedImages.set(source, entry);
    }
    entry.promise.then((u) => !cancelled && setUrl(u)).catch(() => !cancelled && setUrl(null));
    return () => {
      cancelled = true;
    };
  }, [source]);
  return url;
}

function VehiclePhoto({ src, alt, className = "", iconSize = 22 }) {
  const url = useVehicleImage(src);
  if (!url) {
    return (
      <div role="img" aria-label={`${alt}: sin foto`} className={`flex items-center justify-center bg-slate-100 text-slate-300 ${className}`}>
        <Truck size={iconSize} />
      </div>
    );
  }
  return <img src={url} alt={alt} className={`object-cover ${className}`} />;
}

// Revisa que sea una foto de verdad (por su contenido, no por su nombre).
async function vehiclePhotoProblem(file) {
  if (file.size > VEHICLE_PHOTO_MAX_MB * 1024 * 1024) return `La foto pesa más de ${VEHICLE_PHOTO_MAX_MB} MB.`;
  const mime = await sniffDocumentType(file);
  return mime && mime.startsWith("image/") ? "" : "Solo se aceptan fotos JPG, PNG o WEBP.";
}

async function uploadVehicleImage(file, companyId) {
  const mime = await sniffDocumentType(file);
  const path = `${companyId}/vehicles/${crypto.randomUUID()}.${DOCUMENT_EXTENSIONS[mime]}`;
  const { error } = await supabase.storage.from("documents").upload(path, file, { contentType: mime });
  if (error) throw error;
  return path;
}

// La foto que se reemplaza ya no la usa nadie; si no se puede borrar, no estorba.
function removeVehicleImage(src) {
  if (isStoredImage(src) && src.includes("/vehicles/")) supabase.storage.from("documents").remove([src]).catch(() => {});
}

function VehiclePhotoPicker({ label, current, file, error, onPick }) {
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold text-slate-500">{label}</p>
      <div className="flex items-center gap-3">
        {preview ? (
          <img src={preview} alt="Foto elegida" className="h-16 w-24 shrink-0 rounded-lg object-cover ring-1 ring-slate-200" />
        ) : (
          <VehiclePhoto src={current} alt={label} className="h-16 w-24 shrink-0 rounded-lg ring-1 ring-slate-200" iconSize={18} />
        )}
        <div className="min-w-0">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
            <Upload size={12} /> {file || vehicleImage(current) ? "Cambiar foto" : "Subir foto"}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => onPick(e.target.files?.[0] ?? null, e.target)} />
          </label>
          <p className="mt-1 text-[10px] text-slate-400">JPG, PNG o WEBP de hasta {VEHICLE_PHOTO_MAX_MB} MB.</p>
          {error && <p className="mt-1 text-[11px] font-medium text-rose-600">{error}</p>}
        </div>
      </div>
    </div>
  );
}

// Para los formularios de unidad: valida la foto en cuanto se elige.
function useVehiclePhotoField() {
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  async function pick(picked, input) {
    if (!picked) return;
    const problem = await vehiclePhotoProblem(picked);
    if (problem) input.value = "";
    setError(problem);
    setFile(problem ? null : picked);
  }
  return { file, error, pick };
}

const DRIVER_MODES = [
  { id: "fixed", label: "Chofer fijo" },
  { id: "variable", label: "Variable (cambia según el viaje)" },
];

function VehicleCard({ vehicle, onSelect, isCompanyAdmin, onEdit, onDelete }) {
  const kmPct = vehicle.kmProximoServicio ? Math.min(100, Math.round((vehicle.kmActual / vehicle.kmProximoServicio) * 100)) : 0;
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="relative h-36 w-full overflow-hidden bg-slate-100">
        <VehiclePhoto src={vehicle.photo} alt={vehicle.unit} className="h-full w-full" iconSize={32} />
        <VehicleStatusChip vehicle={vehicle} className="absolute right-2 top-2" />
        {isCompanyAdmin && (
          <div className="absolute left-2 top-2 flex gap-1">
            <button
              onClick={() => onEdit(vehicle)}
              title="Editar unidad"
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/90 text-slate-600 shadow-sm hover:bg-white"
            >
              <Edit2 size={13} />
            </button>
            <button
              onClick={() => onDelete(vehicle)}
              title="Eliminar unidad"
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/90 text-rose-600 shadow-sm hover:bg-white"
            >
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </div>
      <div className="p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-800">{vehicle.unit}</h3>
          <span className="text-[11px] font-semibold text-slate-400">{vehicle.plate}</span>
        </div>
        <p className="mt-0.5 text-xs text-slate-500">
          {[vehicle.brand, vehicle.model].filter(Boolean).join(" ") || "Sin marca/modelo"} · {vehicle.year || "—"} · {vehicle.color || "—"}
        </p>
        <div className="mt-3 flex items-center gap-2">
          {isVariableDriver(vehicle) ? (
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-400 ring-1 ring-slate-200">
              <User size={14} />
            </span>
          ) : (
            <img src={personPhoto(vehicle.driver.photo, vehicle.driver.name)} alt={vehicle.driver.name} className="h-7 w-7 rounded-full bg-slate-100 ring-1 ring-slate-200" />
          )}
          <span className="text-xs font-medium text-slate-600">{isVariableDriver(vehicle) ? "Chofer variable, según el viaje" : vehicle.driver.name}</span>
        </div>
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-slate-400">
            <span>{vehicle.kmActual.toLocaleString()} km</span>
            <span>{vehicle.kmProximoServicio.toLocaleString()} km</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full ${kmPct > 90 ? "bg-rose-500" : kmPct > 70 ? "bg-amber-500" : "bg-blue-600"}`}
              style={{ width: `${kmPct}%` }}
            />
          </div>
        </div>
        <button
          onClick={() => onSelect(vehicle.id)}
          className="mt-4 w-full rounded-lg bg-blue-600 py-2 text-xs font-semibold text-white hover:bg-blue-700"
        >
          Ver Expediente y Detalles
        </button>
      </div>
    </div>
  );
}

function FleetPage({ vehicles, onSelectVehicle, onAddClick, isCompanyAdmin, onEditVehicle, onDeleteVehicle }) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Gestión de Flota</h1>
          <p className="mt-1 text-sm text-slate-500">
            <FleetStatusSummary vehicles={vehicles} />
          </p>
        </div>
        <button
          onClick={onAddClick}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
        >
          <Plus size={15} /> Agregar Unidad
        </button>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {vehicles.map((v) => (
          <VehicleCard
            key={v.id}
            vehicle={v}
            onSelect={onSelectVehicle}
            isCompanyAdmin={isCompanyAdmin}
            onEdit={onEditVehicle}
            onDelete={onDeleteVehicle}
          />
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Fleet — vehicle detail (expediente split 50/50)                       */
/* ---------------------------------------------------------------------- */

const EXPEDIENTE_TABS = [
  { id: "ficha", label: "Ficha y conductor" },
  { id: "guantera", label: "Trámites" },
  { id: "mantenimiento", label: "Servicio" },
  { id: "llantas", label: "Llantas" },
  { id: "garantias", label: "Garantías" },
  { id: "historial", label: "Historial" },
];

function FichaItem({ label, value }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2.5">
      <p className="text-[11px] font-medium text-slate-400">{label}</p>
      <p className="text-sm font-semibold text-slate-700">{value}</p>
    </div>
  );
}

function FichaConductorTab({ vehicle }) {
  const { format } = useDateFormat();
  const days = daysUntil(vehicle.driver.licenseExpiry);
  const licenseAlert = days <= 30;
  return (
    <div className="space-y-4">
      {isVariableDriver(vehicle) ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">Conductor</h4>
          <div className="flex items-center gap-3">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400 ring-2 ring-blue-100">
              <User size={22} />
            </span>
            <div>
              <p className="text-sm font-bold text-slate-800">Chofer variable</p>
              <p className="text-xs text-slate-500">Esta unidad no tiene un chofer fijo: cambia según el viaje y se elige en cada traslado.</p>
            </div>
          </div>
        </div>
      ) : (
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">Conductor Asignado</h4>
        <div className="flex items-center gap-3">
          <img src={personPhoto(vehicle.driver.photo, vehicle.driver.name)} alt={vehicle.driver.name} className="h-14 w-14 rounded-full bg-slate-100 ring-2 ring-blue-100" />
          <div>
            <p className="text-sm font-bold text-slate-800">{vehicle.driver.name}</p>
            <p className="flex items-center gap-1 text-xs text-slate-500">
              <Phone size={12} /> {vehicle.driver.phone}
            </p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-slate-50 px-3 py-2.5">
            <p className="text-[11px] font-medium text-slate-400">No. de Licencia</p>
            <p className="text-sm font-bold text-slate-700">{vehicle.driver.license}</p>
          </div>
          <div className={`rounded-xl px-3 py-2.5 ${licenseAlert ? "bg-amber-50" : "bg-slate-50"}`}>
            <p className={`text-[11px] font-medium ${licenseAlert ? "text-amber-600" : "text-slate-400"}`}>Vencimiento de Licencia</p>
            <p className={`flex items-center gap-1 text-sm font-bold ${licenseAlert ? "text-amber-700" : "text-slate-700"}`}>
              {formatDate(vehicle.driver.licenseExpiry, format)}
              {licenseAlert && <AlertTriangle size={13} />}
            </p>
            {licenseAlert && <p className="text-[10px] font-semibold text-amber-600">Vence en {days} días</p>}
          </div>
        </div>
      </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">Ficha Técnica</h4>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <FichaItem label="Marca" value={vehicle.brand || "—"} />
          <FichaItem label="Modelo" value={vehicle.model || "—"} />
          <FichaItem label="Año" value={vehicle.year || "—"} />
          <FichaItem label="Color" value={vehicle.color || "—"} />
          <FichaItem label="Matrícula" value={vehicle.plate} />
          <FichaItem label="Tipo de Aceite" value={vehicle.oilType} />
          <FichaItem label="Consumo Promedio" value={`${vehicle.avgConsumption} km/L`} />
          <FichaItem label="Kilometraje Actual" value={`${vehicle.kmActual.toLocaleString()} km`} />
        </div>
      </div>
    </div>
  );
}

function ProgressRow({ label, pct, detail, tone = "blue" }) {
  const barTone = tone === "rose" ? "bg-rose-500" : tone === "amber" ? "bg-amber-500" : "bg-blue-600";
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium text-slate-600">{label}</span>
        <span className="text-[11px] font-semibold text-slate-400">{detail}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${barTone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function VehiclePanelToggle({ view, setView, showCapture }) {
  const options = [
    { id: "photo", label: "Foto Principal", icon: ImageIcon },
    // Con chofer variable no hay a quién atribuir la captura.
    ...(showCapture ? [{ id: "capture", label: "Captura App / Chofer", icon: Camera }] : []),
    { id: "gps", label: "Ubicación", icon: MapPin },
  ];
  return (
    <div className="flex gap-1.5 rounded-xl bg-slate-100 p-1">
      {options.map((o) => {
        const Icon = o.icon;
        return (
          <button
            key={o.id}
            onClick={() => setView(o.id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[11px] font-semibold transition ${
              view === o.id ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <Icon size={13} /> {o.label}
          </button>
        );
      })}
    </div>
  );
}

function VehiclePanel({ vehicle, canEdit, onUpdate }) {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [view, setView] = useState("photo");
  const [uploading, setUploading] = useState(null);
  const showCapture = !isVariableDriver(vehicle);
  const current = view === "capture" && !showCapture ? "photo" : view;
  const capture = vehicle.appCapture ?? {};
  const hasCapture = !!vehicleImage(capture.photoUrl);

  async function upload(kind, input) {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const problem = await vehiclePhotoProblem(file);
    if (problem) {
      showToast(problem);
      return;
    }
    setUploading(kind);
    try {
      const path = await uploadVehicleImage(file, profile.companyId);
      const takenAt = new Date().toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });
      const saved = await onUpdate(
        kind === "photo" ? { photo: path } : { appCapture: { ...capture, photoUrl: path, timestamp: takenAt, driverName: vehicle.driver.name } }
      );
      removeVehicleImage(saved ? (kind === "photo" ? vehicle.photo : capture.photoUrl) : path);
    } catch (err) {
      showToast(`No se pudo subir la foto: ${err.message}`);
    } finally {
      setUploading(null);
    }
  }

  const uploadButton = (kind, label) =>
    canEdit && (
      <label className="absolute right-3 top-3 inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-white/90 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 shadow-sm hover:bg-white">
        <Upload size={12} /> {uploading === kind ? "Subiendo..." : label}
        <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={!!uploading} onChange={(e) => upload(kind, e.target)} />
      </label>
    );

  return (
    <div className="space-y-3">
      <VehiclePanelToggle view={current} setView={setView} showCapture={showCapture} />
      {current === "photo" && (
        <div className="relative overflow-hidden rounded-2xl border border-slate-200 shadow-sm">
          <VehiclePhoto src={vehicle.photo} alt={vehicle.unit} className="h-[420px] w-full" iconSize={48} />
          {uploadButton("photo", vehicleImage(vehicle.photo) ? "Cambiar foto" : "Subir foto")}
        </div>
      )}
      {current === "capture" && (
        <div className="relative overflow-hidden rounded-2xl border border-slate-200 shadow-sm">
          {hasCapture ? (
            <VehiclePhoto src={capture.photoUrl} alt="Captura del chofer" className="h-[350px] w-full" iconSize={40} />
          ) : (
            <div className="flex h-[350px] flex-col items-center justify-center gap-2 bg-slate-50 text-slate-400">
              <Camera size={32} />
              <p className="text-xs font-medium">Todavía no hay capturas del chofer.</p>
            </div>
          )}
          {uploadButton("capture", hasCapture ? "Cambiar captura" : "Subir captura")}
          <div className="flex items-center justify-between bg-slate-50 px-4 py-3">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
              <Camera size={13} /> {(hasCapture && capture.driverName) || vehicle.driver.name}
            </span>
            <span className="text-[11px] text-slate-400">{hasCapture ? capture.timestamp : "—"}</span>
          </div>
        </div>
      )}
      {current === "gps" && <VehicleLocationPanel vehicle={vehicle} />}
    </div>
  );
}

function VehicleDetailPage({ vehicle, onBack, isCompanyAdmin, onEdit, onDelete, onUpdate }) {
  const [tab, setTab] = useState("ficha");

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-700">
        <ArrowLeft size={16} /> Volver a la Lista
      </button>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <VehiclePhoto src={vehicle.photo} alt={vehicle.unit} className="h-12 w-16 rounded-lg ring-1 ring-slate-200" iconSize={16} />
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              {vehicle.unit} <span className="font-medium text-slate-400">· {vehicle.plate}</span>
            </h2>
            <p className="text-xs text-slate-500">
              {[vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "—"} · Conductor: {vehicleDriverLabel(vehicle)}
            </p>
          </div>
        </div>
        {isCompanyAdmin && (
          <div className="flex gap-2">
            <button
              onClick={() => onEdit(vehicle)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              <Edit2 size={13} /> Editar
            </button>
            <button
              onClick={() => onDelete(vehicle)}
              className="flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50"
            >
              <Trash2 size={13} /> Eliminar unidad
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="flex flex-wrap gap-1.5 rounded-xl bg-slate-100 p-1">
            {EXPEDIENTE_TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold transition ${
                  tab === t.id ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {tab === "ficha" && <FichaConductorTab vehicle={vehicle} />}
          {tab === "guantera" && <VehicleDocsTab vehicle={vehicle} />}
          {tab === "mantenimiento" && <VehicleServiceTab vehicle={vehicle} canEdit={isCompanyAdmin} onUpdate={(patch, message) => onUpdate(vehicle.id, patch, message)} />}
          {tab === "llantas" && <VehicleTiresTab vehicle={vehicle} canEdit={isCompanyAdmin} onUpdate={(patch, message) => onUpdate(vehicle.id, patch, message)} />}
          {tab === "garantias" && <WarrantiesPanel vehicle={vehicle} />}
          {tab === "historial" && <VehicleHistoryTab vehicle={vehicle} />}
        </div>
        <div>
          <VehiclePanel vehicle={vehicle} canEdit={isCompanyAdmin} onUpdate={(patch) => onUpdate(vehicle.id, patch)} />
        </div>
      </div>
    </div>
  );
}

function FleetTabContainer({
  vehicles,
  selectedVehicleId,
  setSelectedVehicleId,
  onAddVehicleClick,
  isCompanyAdmin,
  onEditVehicle,
  onDeleteVehicle,
  onUpdateVehicle,
}) {
  const vehicle = vehicles.find((v) => v.id === selectedVehicleId);
  if (vehicle) {
    return (
      <VehicleDetailPage
        vehicle={vehicle}
        onBack={() => setSelectedVehicleId(null)}
        isCompanyAdmin={isCompanyAdmin}
        onEdit={onEditVehicle}
        onDelete={onDeleteVehicle}
        onUpdate={onUpdateVehicle}
      />
    );
  }
  return (
    <FleetPage
      vehicles={vehicles}
      onSelectVehicle={setSelectedVehicleId}
      onAddClick={onAddVehicleClick}
      isCompanyAdmin={isCompanyAdmin}
      onEditVehicle={onEditVehicle}
      onDeleteVehicle={onDeleteVehicle}
    />
  );
}

function AddVehicleModal({ vehicles, onSave, onClose }) {
  const { profile } = useAuth();
  const existingDrivers = vehicles.filter((v) => !isVariableDriver(v) && v.driver?.name && v.driver.name !== "Sin asignar").map((v) => v.driver.name);
  const [unit, setUnit] = useState("");
  const [plate, setPlate] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());
  const [color, setColor] = useState("");
  const [driverType, setDriverType] = useState("fixed");
  const [driverMode, setDriverMode] = useState(existingDrivers.length ? "reassign" : "new");
  const [reassignedDriver, setReassignedDriver] = useState(existingDrivers[0] ?? "");
  const [newDriverName, setNewDriverName] = useState("");
  const [newDriverPhone, setNewDriverPhone] = useState("");
  const photoField = useVehiclePhotoField();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const inputClass = "w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-blue-400 focus:outline-none";
  const labelClass = "mb-1 block text-[11px] font-semibold text-slate-500";

  async function handleSubmit(e) {
    e.preventDefault();
    if (!unit.trim() || !plate.trim()) {
      setError("Indica al menos la unidad y la matrícula.");
      return;
    }
    setError("");
    setSaving(true);
    let photo = null;
    try {
      if (photoField.file) photo = await uploadVehicleImage(photoField.file, profile.companyId);
    } catch (err) {
      setError(`No se pudo subir la foto: ${err.message}`);
      setSaving(false);
      return;
    }
    const variable = driverType === "variable";
    const reassigning = !variable && driverMode === "reassign" && !!reassignedDriver;
    const driverName = variable ? "" : reassigning ? reassignedDriver : newDriverName.trim() || "Sin asignar";
    const reassignedFrom = reassigning ? vehicles.find((v) => v.driver.name === reassignedDriver) : null;
    const vehicle = {
      unit: unit.trim(),
      plate: plate.trim(),
      brand: brand.trim(),
      model: model.trim(),
      year: Number(year) || new Date().getFullYear(),
      color: color.trim(),
      photo,
      healthScore: 100,
      kmActual: 0,
      kmProximoServicio: 10000,
      oilType: "Sintético 15W-40",
      avgConsumption: 0,
      driver: variable
        ? { mode: "variable", name: "", phone: "", photo: "", license: "", licenseExpiry: "" }
        : {
            mode: "fixed",
            name: driverName,
            phone: reassignedFrom ? reassignedFrom.driver.phone : newDriverPhone.trim(),
            photo: avatarUrl(driverName),
            license: reassignedFrom ? reassignedFrom.driver.license : "",
            licenseExpiry: reassignedFrom ? reassignedFrom.driver.licenseExpiry : "",
          },
      insurance: { company: "", folio: "", expiry: "", pdfUrl: "#" },
      circulationCard: { folio: "", pdfUrl: "#" },
      verification: { hologram: "", validity: "" },
      warranty: { engine: "Sin registro de garantía", parts: "Sin registro de garantía" },
      documentHistory: [],
      maintenancePanel: { kmRestante: 3000, coolantType: "Refrigerante Verde", brakesLast: "", oilLast: "" },
      tires: { frontDepth: 8, rearDepth: 8, frontSize: "185/60 R15", rearSize: "190/60 R15", psi: 110, lastRotation: "" },
      history: [],
      gps: { status: "resting", address: "Patio central", speed: 0, lastUpdate: "recién agregada", fuelPercent: 100, signalType: "GPS Hardware", x: 50, y: 50, mode: "libre", destination: null, eta: null, stops: [] },
      appCapture: {},
    };
    const saved = await onSave({ vehicle, reassignedFromId: reassignedFrom ? reassignedFrom.id : null });
    if (!saved) removeVehicleImage(photo);
    setSaving(false);
  }

  return (
    <Modal title="Agregar Unidad" width="max-w-lg" onClose={onClose}>
      <form onSubmit={handleSubmit} className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Unidad</label>
            <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Ej. Unidad 15" className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Matrícula</label>
            <input value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="Ej. ABC-123-D" className={inputClass} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Marca</label>
            <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Ej. Kenworth" className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Modelo</label>
            <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Ej. T680" className={inputClass} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Año</label>
            <input type="number" value={year} onChange={(e) => setYear(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Color</label>
            <input value={color} onChange={(e) => setColor(e.target.value)} placeholder="Ej. Blanco" className={inputClass} />
          </div>
        </div>

        <VehiclePhotoPicker label="Foto del vehículo (opcional)" current={null} file={photoField.file} error={photoField.error} onPick={photoField.pick} />

        <div className="rounded-xl border border-slate-100 p-3">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Chofer</p>
          <div className="mb-3">
            <SegmentedControl label="Tipo de chofer" options={DRIVER_MODES} value={driverType} onChange={setDriverType} />
          </div>
          {driverType === "variable" ? (
            <p className="text-[11px] text-slate-500">El chofer cambia según el viaje y se elige en cada traslado. La unidad no mostrará la sección "Captura App / Chofer".</p>
          ) : (
          <>
          <div className="mb-2 flex gap-1.5 rounded-xl bg-slate-100 p-1">
            {[
              { id: "reassign", label: "Reasignar conductor existente" },
              { id: "new", label: "Nuevo conductor" },
            ].map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setDriverMode(o.id)}
                className={`flex-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition ${
                  driverMode === o.id ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          {driverMode === "reassign" ? (
            <>
              <select value={reassignedDriver} onChange={(e) => setReassignedDriver(e.target.value)} className={inputClass}>
                {existingDrivers.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 flex items-center gap-1 text-[10px] text-amber-600">
                <AlertTriangle size={11} />
                Quedará sin conductor asignado en {vehicles.find((v) => v.driver.name === reassignedDriver)?.unit ?? "su unidad actual"}.
              </p>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <input value={newDriverName} onChange={(e) => setNewDriverName(e.target.value)} placeholder="Nombre del conductor" className={inputClass} />
              <input value={newDriverPhone} onChange={(e) => setNewDriverPhone(e.target.value)} placeholder="Teléfono" className={inputClass} />
            </div>
          )}
          </>
          )}
        </div>

        {error && <p className="rounded-lg bg-rose-50 px-2.5 py-2 text-[11px] font-medium text-rose-700">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">
            Cancelar
          </button>
          <button type="submit" disabled={saving} className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
            {saving ? "Guardando..." : "Agregar Unidad"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EditVehicleModal({ vehicle, onSave, onClose }) {
  const { profile } = useAuth();
  const [unit, setUnit] = useState(vehicle.unit ?? "");
  const [plate, setPlate] = useState(vehicle.plate ?? "");
  const [brand, setBrand] = useState(vehicle.brand ?? "");
  const [model, setModel] = useState(vehicle.model ?? "");
  const [year, setYear] = useState(vehicle.year ?? new Date().getFullYear());
  const [color, setColor] = useState(vehicle.color ?? "");
  const [driverType, setDriverType] = useState(isVariableDriver(vehicle) ? "variable" : "fixed");
  const [driverName, setDriverName] = useState(vehicle.driver?.name ?? "");
  const [driverPhone, setDriverPhone] = useState(vehicle.driver?.phone ?? "");
  const photoField = useVehiclePhotoField();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const inputClass = "w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-blue-400 focus:outline-none";
  const labelClass = "mb-1 block text-[11px] font-semibold text-slate-500";

  async function handleSubmit(e) {
    e.preventDefault();
    if (!unit.trim() || !plate.trim()) {
      setError("Indica al menos la unidad y la matrícula.");
      return;
    }
    setError("");
    setSaving(true);
    let newPhoto = null;
    try {
      if (photoField.file) newPhoto = await uploadVehicleImage(photoField.file, profile.companyId);
    } catch (err) {
      setError(`No se pudo subir la foto: ${err.message}`);
      setSaving(false);
      return;
    }
    // Al pasar a chofer variable se conservan nombre y teléfono, por si se
    // vuelve a fijo; solo dejan de mostrarse.
    const saved = await onSave({
      id: vehicle.id,
      unit: unit.trim(),
      plate: plate.trim(),
      brand: brand.trim(),
      model: model.trim(),
      year: Number(year) || vehicle.year,
      color: color.trim(),
      photo: newPhoto ?? vehicle.photo,
      driver: {
        ...vehicle.driver,
        mode: driverType,
        name: driverName.trim() || (driverType === "variable" ? "" : "Sin asignar"),
        phone: driverPhone.trim(),
      },
    });
    if (newPhoto) removeVehicleImage(saved ? vehicle.photo : newPhoto);
    setSaving(false);
  }

  return (
    <Modal title="Editar Unidad" width="max-w-lg" onClose={onClose}>
      <form onSubmit={handleSubmit} className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Unidad</label>
            <input value={unit} onChange={(e) => setUnit(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Matrícula</label>
            <input value={plate} onChange={(e) => setPlate(e.target.value)} className={inputClass} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Marca</label>
            <input value={brand} onChange={(e) => setBrand(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Modelo</label>
            <input value={model} onChange={(e) => setModel(e.target.value)} className={inputClass} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Año</label>
            <input type="number" value={year} onChange={(e) => setYear(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Color</label>
            <input value={color} onChange={(e) => setColor(e.target.value)} className={inputClass} />
          </div>
        </div>
        <VehiclePhotoPicker label="Foto del vehículo" current={vehicle.photo} file={photoField.file} error={photoField.error} onPick={photoField.pick} />
        <div className="rounded-xl border border-slate-100 p-3">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Chofer</p>
          <div className="mb-3">
            <SegmentedControl label="Tipo de chofer" options={DRIVER_MODES} value={driverType} onChange={setDriverType} />
          </div>
          {driverType === "variable" ? (
            <p className="text-[11px] text-slate-500">El chofer cambia según el viaje y se elige en cada traslado. La unidad no mostrará la sección "Captura App / Chofer".</p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <input value={driverName} onChange={(e) => setDriverName(e.target.value)} placeholder="Nombre del conductor" className={inputClass} />
              <input value={driverPhone} onChange={(e) => setDriverPhone(e.target.value)} placeholder="Teléfono" className={inputClass} />
            </div>
          )}
        </div>

        {error && <p className="rounded-lg bg-rose-50 px-2.5 py-2 text-[11px] font-medium text-rose-700">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">
            Cancelar
          </button>
          <button type="submit" disabled={saving} className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
            {saving ? "Guardando..." : "Guardar cambios"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ConfirmModal({ title, message, confirmLabel = "Confirmar", danger = false, onConfirm, onClose }) {
  const [loading, setLoading] = useState(false);

  async function handleConfirm() {
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title={title} width="max-w-sm" onClose={onClose}>
      <p className="text-xs text-slate-600">{message}</p>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">
          Cancelar
        </button>
        <button
          onClick={handleConfirm}
          disabled={loading}
          className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold text-white disabled:opacity-60 ${
            danger ? "bg-rose-600 hover:bg-rose-700" : "bg-blue-600 hover:bg-blue-700"
          }`}
        >
          {loading ? "Procesando..." : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------------- */
/*  Maintenance module                                                    */
/* ---------------------------------------------------------------------- */

function MaintenanceOrdersTable({ records, vehicles, onAddClick, onConfirm, onEditClick, onDeleteClick }) {
  const maintenanceWidgets = useMemo(() => getMaintenanceWidgets(records, vehicles), [records, vehicles]);
  const { format } = useDateFormat();
  const { profile } = useAuth();
  const currency = profile?.company?.currency || "MXN";
  const [category, setCategory] = useState("all");
  const [visibleWidgets, setVisibleWidgets] = useState({ oil: true, brakes: true, tires: true, mileage: true });
  const [widgetModalOpen, setWidgetModalOpen] = useState(false);

  const filteredRecords = category === "all" ? records : records.filter((r) => r.category === category);

  function toggleWidget(id) {
    setVisibleWidgets((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  const columns = [
    {
      key: "unit",
      label: "Unidad / Matrícula",
      render: (r) => (
        <div>
          <p className="font-semibold text-slate-700">{r.unit}</p>
          <p className="text-[11px] text-slate-400">{r.plate}</p>
        </div>
      ),
    },
    {
      key: "category",
      label: "Categoría",
      render: (r) => {
        const c = MAINTENANCE_CATEGORY_MAP[r.category];
        return `${c.emoji} ${c.label}`;
      },
    },
    { key: "concept", label: "Concepto del Servicio", render: (r) => <span className="text-slate-600">{r.concept}</span> },
    { key: "amount", label: "Monto", render: (r) => (r.amount ? formatCurrency(r.amount, currency) : "—") },
    { key: "date", label: "Fecha", render: (r) => formatDate(r.date, format) },
    { key: "document", label: "Documento", render: (r) => <DocumentCell documentUrl={r.documentUrl} /> },
    { key: "origin", label: "Origen del Dato", render: (r) => <OriginBadge origin={r.origin} /> },
    { key: "status", label: "Estado del Dato", render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Órdenes de Trabajo</h1>
          <p className="mt-1 text-sm text-slate-500">
            Servicios registrados a mano o recibidos por el bot de Telegram, con el origen y la revisión de cada dato.
          </p>
        </div>
        <button
          onClick={onAddClick}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
        >
          <Plus size={15} /> Registrar Servicio
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-800">Resumen de alertas</h2>
          <button
            onClick={() => setWidgetModalOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            <Settings size={13} /> Personalizar Widgets
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {maintenanceWidgets.filter((w) => visibleWidgets[w.id]).map((w) => (
            <KpiCard key={w.id} widget={w} />
          ))}
          {maintenanceWidgets.every((w) => !visibleWidgets[w.id]) && (
            <p className="col-span-full py-4 text-center text-xs text-slate-400">
              No hay widgets visibles. Actívalos desde "Personalizar Widgets".
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {MAINTENANCE_CATEGORIES.map((c) => (
          <button
            key={c.id}
            onClick={() => setCategory(c.id)}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
              category === c.id
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
            }`}
          >
            {c.emoji ? `${c.emoji} ` : ""}
            {c.label}
          </button>
        ))}
      </div>

      <RecordsTable
        records={filteredRecords}
        columns={columns}
        onConfirm={onConfirm}
        onEdit={onEditClick}
        onDelete={onDeleteClick}
        emptyLabel="Sin registros en esta categoría."
      />

      {widgetModalOpen && (
        <WidgetSettingsModal
          widgets={maintenanceWidgets}
          visible={visibleWidgets}
          onToggle={toggleWidget}
          onClose={() => setWidgetModalOpen(false)}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Maintenance — per-unit breakdown ("Servicios" subview)                */
/* ---------------------------------------------------------------------- */

function MaintenanceUnitCard({ vehicle, records, onViewDetails }) {
  const { format } = useDateFormat();
  const unitPending = records.filter((r) => r.unit === vehicle.unit && r.status === "pending").length;
  const lastOf = (category) =>
    records
      .filter((r) => r.unit === vehicle.unit && r.category === category)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0]?.date;
  const nextKm = Number(vehicle.kmProximoServicio) || 0;
  const kmLeft = nextKm - (Number(vehicle.kmActual) || 0);
  const interval = Math.max(Number(vehicle.maintenancePanel?.intervalKm) || 10000, 1);
  const kmPct = nextKm ? Math.min(100, Math.max(4, 100 - Math.round((kmLeft / interval) * 100))) : 0;
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="p-4">
        <div className="flex items-center gap-3">
          <VehiclePhoto src={vehicle.photo} alt={vehicle.unit} className="h-14 w-20 shrink-0 rounded-lg ring-1 ring-slate-200" iconSize={16} />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-slate-800">{vehicle.unit}</h3>
            <p className="truncate text-[11px] text-slate-400">
              {vehicle.plate} · {[vehicle.brand, vehicle.model].filter(Boolean).join(" ") || "—"}
            </p>
          </div>
          {unitPending > 0 && (
            <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200">
              {unitPending} pendiente{unitPending > 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className="mt-3">
          <ProgressRow
            label="Próximo servicio por km"
            pct={kmPct}
            detail={!nextKm ? "Sin programar" : kmLeft <= 0 ? "Servicio vencido" : `${kmLeft.toLocaleString("es-MX")} km restantes`}
            tone={nextKm && kmLeft <= 0 ? "rose" : nextKm && kmLeft <= 1500 ? "amber" : "blue"}
          />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-slate-500">
          <span>
            Aceite: <b className="text-slate-700">{formatDate(lastOf("engine"), format)}</b>
          </span>
          <span>
            Frenos/Balatas: <b className="text-slate-700">{formatDate(lastOf("brakes"), format)}</b>
          </span>
        </div>
        <button
          onClick={() => onViewDetails(vehicle.id)}
          className="mt-4 w-full rounded-lg bg-blue-600 py-2 text-xs font-semibold text-white hover:bg-blue-700"
        >
          Ver Detalles de Mantenimiento
        </button>
      </div>
    </div>
  );
}

function MaintenanceUnitsGrid({ vehicles, records, onAddClick, onViewDetails }) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Mantenimiento — Servicios por Unidad</h1>
          <p className="mt-1 text-sm text-slate-500">Desglose individual de motor, aceite, frenos y balatas por unidad.</p>
        </div>
        <button
          onClick={onAddClick}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
        >
          <Plus size={15} /> Registrar Servicio
        </button>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {vehicles.map((v) => (
          <MaintenanceUnitCard key={v.id} vehicle={v} records={records} onViewDetails={onViewDetails} />
        ))}
      </div>
    </div>
  );
}

function MaintenanceSection({ view, vehicles, records, onAddClick, onConfirm, onEditClick, onDeleteClick, onUpdateVehicle }) {
  const [selectedUnitId, setSelectedUnitId] = useState(null);

  if (view === "garantias") return <WarrantiesPage />;
  if (view === "ordenes") {
    return (
      <MaintenanceOrdersTable
        records={records}
        vehicles={vehicles}
        onAddClick={onAddClick}
        onConfirm={onConfirm}
        onEditClick={onEditClick}
        onDeleteClick={onDeleteClick}
      />
    );
  }

  const selectedVehicle = vehicles.find((v) => v.id === selectedUnitId);
  if (selectedVehicle) return <MaintenanceUnitDetail vehicle={selectedVehicle} onBack={() => setSelectedUnitId(null)} onUpdate={onUpdateVehicle} />;
  return <MaintenanceUnitsGrid vehicles={vehicles} records={records} onAddClick={onAddClick} onViewDetails={setSelectedUnitId} />;
}

/* ---------------------------------------------------------------------- */
/*  Compliance module                                                     */
/* ---------------------------------------------------------------------- */

function CompliancePage({ records, onAddClick, onConfirm, onEditClick, onDeleteClick, docFilter }) {
  const { format } = useDateFormat();
  const complianceWidgets = useMemo(() => getComplianceWidgets(records), [records]);
  const [visibleWidgets, setVisibleWidgets] = useState({ tenencia: true, insurance: true, license: true });
  const [widgetModalOpen, setWidgetModalOpen] = useState(false);
  const [selectedDocType, setSelectedDocType] = useState(docFilter ?? "all");

  useEffect(() => {
    setSelectedDocType(docFilter ?? "all");
  }, [docFilter]);

  const filteredRecords = selectedDocType === "all" ? records : records.filter((r) => r.docType === selectedDocType);

  function toggleWidget(id) {
    setVisibleWidgets((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  const columns = [
    {
      key: "unit",
      label: "Unidad / Matrícula",
      render: (r) => (
        <div>
          <p className="font-semibold text-slate-700">{r.unit}</p>
          <p className="text-[11px] text-slate-400">{r.plate}</p>
        </div>
      ),
    },
    { key: "docType", label: "Trámite", render: (r) => <span className="font-medium text-slate-600">{r.docType}</span> },
    {
      key: "paymentStatus",
      label: "Estado de Pago",
      render: (r) => (
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${
            r.paymentStatus === "Pagado" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-amber-50 text-amber-700 ring-amber-200"
          }`}
        >
          {r.paymentStatus}
        </span>
      ),
    },
    { key: "invoiceFolio", label: "Folio de Factura", render: (r) => r.invoiceFolio || "—" },
    { key: "document", label: "Documento", render: (r) => <DocumentCell documentUrl={r.documentUrl} /> },
    { key: "dueDate", label: "Vencimiento", render: (r) => formatDate(r.dueDate, format) },
    { key: "origin", label: "Origen", render: (r) => <OriginBadge origin={r.origin} /> },
    { key: "status", label: "Estado del Dato", render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Trámites</h1>
          <p className="mt-1 text-sm text-slate-500">Control normativo y legal de la flotilla: tenencias, pólizas, verificaciones y licencias.</p>
        </div>
        <button
          onClick={onAddClick}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
        >
          <Plus size={15} /> Agregar Trámite
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-800">Resumen de alertas</h2>
          <button
            onClick={() => setWidgetModalOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            <Settings size={13} /> Personalizar Widgets
          </button>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {complianceWidgets.filter((w) => visibleWidgets[w.id]).map((w) => (
            <KpiCard key={w.id} widget={w} />
          ))}
          {complianceWidgets.every((w) => !visibleWidgets[w.id]) && (
            <p className="col-span-full py-4 text-center text-xs text-slate-400">
              No hay widgets visibles. Actívalos desde "Personalizar Widgets".
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {["all", ...COMPLIANCE_DOC_TYPES].map((d) => (
          <button
            key={d}
            onClick={() => setSelectedDocType(d)}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
              selectedDocType === d
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
            }`}
          >
            {d === "all" ? "Todos" : d}
          </button>
        ))}
      </div>

      <RecordsTable
        records={filteredRecords}
        columns={columns}
        onConfirm={onConfirm}
        onEdit={onEditClick}
        onDelete={onDeleteClick}
        emptyLabel="Sin trámites registrados."
      />

      {widgetModalOpen && (
        <WidgetSettingsModal
          widgets={complianceWidgets}
          visible={visibleWidgets}
          onToggle={toggleWidget}
          onClose={() => setWidgetModalOpen(false)}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Fuel module                                                           */
/* ---------------------------------------------------------------------- */

const INVOICE_CATEGORIES = [
  { id: "overview", label: "Resumen" },
  { id: "fuel", label: "Consumo de Combustible" },
  { id: "travel", label: "Viáticos" },
  { id: "consumables", label: "Consumibles" },
  { id: "coolant", label: "Refrigerante" },
  { id: "parts", label: "Refacciones" },
  { id: "tolls", label: "Casetas" },
];
const CONCEPT_CATEGORIES = INVOICE_CATEGORIES.filter((c) => c.id !== "overview");

function inConcept(inv, concept) {
  return inv.module === "misc" ? inv.raw.category === concept : inv.module === concept;
}

// Concepto que se preselecciona al darle "Cargar Factura" desde cada pestaña.
const INVOICE_CATEGORY_TYPE = {
  overview: "viaticos",
  fuel: "gasolina",
  travel: "viaticos",
  consumables: "consumibles",
  coolant: "refrigerante",
  parts: "refacciones",
  tolls: "casetas",
};

const DESGLOSE_PRESETS = [
  { label: "Hoy", days: 1 },
  { label: "Esta semana", days: 7 },
  { label: "30 días", days: 30 },
];

function SparkBars({ values, barClass = "bg-blue-500" }) {
  const max = Math.max(...values, 1);
  return (
    <div className="mt-3 flex h-12 items-end gap-[2px]">
      {values.map((v, i) => (
        <div
          key={i}
          className={`flex-1 rounded-t-sm ${v > 0 ? barClass : "bg-slate-100"}`}
          style={{ height: v > 0 ? `${Math.max(10, Math.round((v / max) * 100))}%` : "4%" }}
        />
      ))}
    </div>
  );
}

function OverviewCard({ icon: Icon, tone, label, right = null, className = "", children }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${TONE_CLASSES[tone]}`}>
            <Icon size={15} />
          </span>
          <p className="text-xs font-semibold text-slate-500">{label}</p>
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

const EMPTY_CELL = <span className="text-slate-300">—</span>;
const orEmpty = (value) => (value === undefined || value === null || value === "" ? EMPTY_CELL : value);
const invoiceCurrency = (inv, ctx) => inv.cfdi?.moneda || ctx.currency;
const importeColumn = (id, label, get) => ({
  id,
  label,
  group: "Importes",
  align: "right",
  render: (inv, ctx) => {
    const value = get(inv.cfdi?.importes ?? {});
    return value === undefined || value === null ? EMPTY_CELL : formatMoney(value, invoiceCurrency(inv, ctx));
  },
});
const invoiceConcepts = (inv) => (inv.cfdi?.conceptos ?? []).map((c) => c.descripcion).filter(Boolean).join(", ");
const paramColumn = (id, label, group, align) => ({ id, label, group, align, render: (inv) => orEmpty(inv.details[id]) });
const unitCostColumn = (id, label, group, module) => ({
  id,
  label,
  group,
  align: "right",
  render: (inv, ctx) => {
    const cost = inv.module === module ? invoiceUnitCost(inv) : null;
    return cost === null ? EMPTY_CELL : formatMoney(cost, invoiceCurrency(inv, ctx));
  },
});

// Columnas disponibles en los desgloses, en el orden en que se muestran.
const INVOICE_COLUMNS = [
  {
    id: "unit",
    label: "Unidad / Persona",
    group: "General",
    render: (inv) => {
      // Sin unidad (común en viáticos), se muestra a quien recibió el servicio.
      const detail = inv.unit ? [inv.plate, inv.driverName].filter(Boolean).join(" · ") : "";
      return (
        <div>
          <p className="font-semibold text-slate-700">{inv.unit || inv.driverName || "Sin unidad asociada"}</p>
          {detail && <p className="text-[11px] text-slate-400">{detail}</p>}
        </div>
      );
    },
  },
  { id: "driver", label: "Conductor / Huésped", group: "General", render: (inv) => orEmpty(inv.driverName) },
  {
    id: "project",
    label: "Proyecto",
    group: "General",
    render: (inv) => (inv.project ? <span className="font-semibold text-slate-700">{inv.project}</span> : <span className="text-slate-300">Sin proyecto</span>),
  },
  { id: "workOrder", label: "Orden de trabajo", group: "General", render: (inv) => orEmpty(inv.workOrder) },
  { id: "station", label: "Estación de Servicio", group: "Combustible", render: (inv) => orEmpty(inv.station) },
  { id: "date", label: "Fecha", group: "General", render: (inv, ctx) => formatDate(inv.date, ctx.format) },
  {
    id: "amount",
    label: "Monto",
    group: "General",
    align: "right",
    render: (inv, ctx) => <span className="font-semibold text-slate-700">{formatMoney(inv.amount, invoiceCurrency(inv, ctx))}</span>,
  },
  { id: "liters", label: "Litros", group: "Combustible", align: "right", render: (inv) => (inv.module === "fuel" ? `${inv.liters.toLocaleString()} L` : EMPTY_CELL) },
  unitCostColumn("pricePerLiter", "Precio por litro", "Combustible", "fuel"),
  { id: "fuelType", label: "Tipo de combustible", group: "Combustible", render: (inv) => orEmpty(invoiceFuelType(inv)) },
  {
    id: "odometer",
    label: "Odómetro",
    group: "Recorrido",
    align: "right",
    render: (inv) => {
      const km = inv.odometer || Number(inv.details.odometerKm) || 0;
      return km ? `${km.toLocaleString()} km` : EMPTY_CELL;
    },
  },
  { id: "efficiency", label: "Rendimiento", group: "Combustible", align: "right", render: (inv) => (inv.efficiency ? `${inv.efficiency} km/L` : EMPTY_CELL) },
  { id: "expenseType", label: "Concepto", group: "General", render: (inv) => expenseTypeLabel(inv.expenseType) },
  {
    id: "description",
    label: "Descripción",
    group: "General",
    cellClass: "max-w-[16rem] truncate",
    render: (inv) => <span title={inv.description}>{orEmpty(inv.description)}</span>,
  },
  paramColumn("destination", "Destino", "Viáticos"),
  paramColumn("route", "Ruta", "Recorrido"),
  paramColumn("plaza", "Caseta o plaza", "Casetas"),
  paramColumn("transportType", "Tipo de transporte", "Viáticos"),
  paramColumn("tripDays", "Días del viaje", "Viáticos", "right"),
  paramColumn("nights", "Noches", "Viáticos", "right"),
  paramColumn("people", "Personas", "Viáticos", "right"),
  paramColumn("paymentMethod", "Forma de pago de la caseta", "Casetas"),
  paramColumn("axles", "Ejes", "Casetas", "right"),
  paramColumn("coolantType", "Tipo de refrigerante", "Refrigerante"),
  paramColumn("partNumber", "Número de parte", "Refacciones"),
  paramColumn("brand", "Marca", "Refacciones"),
  {
    id: "quantity",
    label: "Cantidad",
    group: "Cantidades",
    align: "right",
    render: (inv) => orEmpty(invoiceQuantity(inv) ? invoiceQuantity(inv).toLocaleString() : ""),
  },
  { id: "measure", label: "Unidad de medida", group: "Cantidades", render: (inv) => orEmpty(invoiceMeasure(inv)) },
  unitCostColumn("unitCost", "Costo por unidad", "Cantidades", "misc"),
  {
    id: "warranty",
    label: "Garantía",
    group: "Refacciones",
    render: (inv) => (inv.details.warrantyMonths ? `${inv.details.warrantyMonths} meses` : EMPTY_CELL),
  },
  { id: "vendor", label: "Proveedor", group: "Emisor y receptor", render: (inv) => orEmpty(inv.vendor || inv.cfdi?.emisor?.nombre) },
  { id: "emisorRfc", label: "RFC emisor", group: "Emisor y receptor", render: (inv) => orEmpty(inv.cfdi?.emisor?.rfc) },
  { id: "emisorRegimen", label: "Régimen emisor", group: "Emisor y receptor", render: (inv) => orEmpty(decodeSat(SAT_REGIMEN, inv.cfdi?.emisor?.regimenFiscal)) },
  { id: "receptor", label: "Receptor", group: "Emisor y receptor", render: (inv) => orEmpty(inv.cfdi?.receptor?.nombre) },
  { id: "receptorRfc", label: "RFC receptor", group: "Emisor y receptor", render: (inv) => orEmpty(inv.cfdi?.receptor?.rfc) },
  { id: "receptorRegimen", label: "Régimen receptor", group: "Emisor y receptor", render: (inv) => orEmpty(decodeSat(SAT_REGIMEN, inv.cfdi?.receptor?.regimenFiscal)) },
  { id: "usoCfdi", label: "Uso de CFDI", group: "Comprobante fiscal", render: (inv) => orEmpty(decodeSat(SAT_USO_CFDI, inv.cfdi?.receptor?.usoCFDI)) },
  { id: "uuid", label: "Folio fiscal (UUID)", group: "Comprobante fiscal", render: (inv) => (inv.cfdi?.uuid ? <span className="font-mono text-[11px]">{inv.cfdi.uuid}</span> : EMPTY_CELL) },
  { id: "folio", label: "Folio", group: "Comprobante fiscal", render: (inv) => orEmpty(inv.invoiceFolio || inv.cfdi?.folio) },
  { id: "tipoComprobante", label: "Tipo de comprobante", group: "Comprobante fiscal", render: (inv) => orEmpty(decodeSat(SAT_TIPO_COMPROBANTE, inv.cfdi?.tipoComprobante)) },
  { id: "metodoPago", label: "Método de pago", group: "Comprobante fiscal", render: (inv) => orEmpty(decodeSat(SAT_METODO_PAGO, inv.cfdi?.metodoPago)) },
  { id: "formaPago", label: "Forma de pago", group: "Comprobante fiscal", render: (inv) => orEmpty(decodeSat(SAT_FORMA_PAGO, inv.cfdi?.formaPago)) },
  { id: "moneda", label: "Moneda", group: "Comprobante fiscal", render: (inv) => orEmpty(inv.cfdi?.moneda) },
  { id: "tipoCambio", label: "Tipo de cambio", group: "Comprobante fiscal", align: "right", render: (inv) => orEmpty(inv.cfdi?.tipoCambio) },
  {
    id: "partidas",
    label: "Partidas",
    group: "Comprobante fiscal",
    cellClass: "max-w-[16rem] truncate",
    render: (inv) => <span title={invoiceConcepts(inv)}>{orEmpty(invoiceConcepts(inv))}</span>,
  },
  importeColumn("subtotal", "Subtotal", (i) => i.subtotal),
  importeColumn("descuento", "Descuento", (i) => i.descuento),
  importeColumn("iva", "IVA", (i) => i.iva),
  importeColumn("ieps", "IEPS", (i) => i.ieps),
  importeColumn("ish", "ISH", (i) => i.ish),
  importeColumn("otrosImpuestos", "Otros impuestos", (i) => i.otrosImpuestos),
  importeColumn("retenciones", "Retenciones", (i) =>
    i.retencionIVA === undefined && i.retencionISR === undefined ? undefined : (Number(i.retencionIVA) || 0) + (Number(i.retencionISR) || 0)
  ),
  importeColumn("propina", "Propina", (i) => i.propina),
  { id: "origin", label: "Origen", group: "General", render: (inv) => <OriginBadge origin={inv.origin} /> },
  { id: "user", label: "Usuario", group: "General", render: (inv) => orEmpty(inv.uploadedByName) },
  { id: "status", label: "Estado", group: "General", render: (inv) => <StatusBadge status={inv.status} /> },
  {
    id: "approved",
    label: "Aprobado",
    group: "General",
    render: (inv) =>
      inv.approved ? <CheckCircle2 size={16} className="text-emerald-500" aria-label="Aprobada" /> : <X size={16} className="text-rose-400" aria-label="Sin aprobar" />,
  },
  { id: "approvedBy", label: "Aprobado por", group: "General", render: (inv) => orEmpty(inv.approvedByName) },
  {
    id: "statusReason",
    label: "Motivo",
    group: "General",
    cellClass: "max-w-[16rem] truncate",
    render: (inv) => {
      const reason = isInvoiceClosed(inv) ? inv.statusReason : "";
      return <span title={reason}>{orEmpty(reason)}</span>;
    },
  },
  { id: "document", label: "Documento", group: "General", render: (inv) => <DocumentCell documentUrl={inv.documentUrl} invoice={inv} /> },
];

const DEFAULT_INVOICE_COLUMNS = {
  overview: ["project", "workOrder", "date", "amount", "expenseType", "vendor", "emisorRfc", "origin", "user", "status", "approved", "approvedBy", "document"],
  project: ["workOrder", "date", "amount", "expenseType", "description", "vendor", "unit", "origin", "user", "status", "approved", "document"],
  fuel: ["unit", "driver", "project", "workOrder", "station", "date", "amount", "liters", "pricePerLiter", "fuelType", "odometer", "efficiency", "document", "origin", "status"],
  travel: ["unit", "project", "workOrder", "date", "amount", "expenseType", "description", "destination", "nights", "people", "vendor", "document", "origin", "status"],
  consumables: ["unit", "project", "workOrder", "date", "amount", "description", "quantity", "measure", "unitCost", "vendor", "document", "origin", "status"],
  coolant: ["unit", "project", "workOrder", "date", "amount", "coolantType", "quantity", "measure", "unitCost", "odometer", "vendor", "document", "origin", "status"],
  parts: ["unit", "project", "workOrder", "date", "amount", "description", "partNumber", "brand", "quantity", "warranty", "odometer", "vendor", "document", "origin", "status"],
  tolls: ["unit", "driver", "project", "workOrder", "date", "amount", "plaza", "route", "paymentMethod", "axles", "document", "origin", "status"],
};

// En la pestaña de un concepto solo se ofrecen las columnas que le aplican.
const PARAM_COLUMN_GROUPS = ["Combustible", "Viáticos", "Recorrido", "Casetas", "Cantidades", "Refrigerante", "Refacciones"];
const CONCEPT_COLUMN_GROUPS = {
  fuel: ["Combustible", "Recorrido"],
  travel: ["Viáticos", "Recorrido"],
  consumables: ["Cantidades"],
  coolant: ["Refrigerante", "Cantidades", "Recorrido"],
  parts: ["Refacciones", "Cantidades", "Recorrido"],
  tolls: ["Casetas", "Recorrido"],
};

// La tabla se desplaza por dentro; las acciones quedan siempre a la vista.
const STICKY_ACTIONS_CELL = "xl:sticky xl:right-0 xl:bg-white xl:shadow-[-8px_0_8px_-8px_rgba(15,23,42,0.15)]";

function InvoiceDesgloseTable({ rows, columnIds, currency, isAdmin, onEdit, onConfirm, onDecide, onDetail, emptyLabel }) {
  const { format } = useDateFormat();
  const columns = INVOICE_COLUMNS.filter((c) => columnIds.includes(c.id));
  const ctx = { currency, format };
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full min-w-max text-left text-xs">
        <thead>
          <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
            {columns.map((c) => (
              <th key={c.id} className={`whitespace-nowrap px-3 py-3 font-semibold ${c.align === "right" ? "text-right" : ""}`}>
                {c.label}
              </th>
            ))}
            <th className={`px-3 py-3 text-right font-semibold ${STICKY_ACTIONS_CELL}`}>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((inv) => (
            <tr key={inv.key} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
              {columns.map((c) => (
                <td key={c.id} className={`whitespace-nowrap px-3 py-3 text-slate-600 ${c.align === "right" ? "text-right" : ""} ${c.cellClass ?? ""}`}>
                  {c.render(inv, ctx)}
                </td>
              ))}
              <td className={`px-3 py-3 ${STICKY_ACTIONS_CELL}`}>
                <div className="flex justify-end gap-1.5">
                  <button
                    onClick={() => onDetail(inv)}
                    className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    <Eye size={12} /> Detalle
                  </button>
                  {inv.status === "pending" && !inv.approved && (
                    <button
                      onClick={() => onConfirm(inv)}
                      className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100"
                    >
                      <CheckCircle2 size={12} /> Confirmar
                    </button>
                  )}
                  {isAdmin && inv.status === "verified" && !inv.approved && (
                    <button
                      onClick={() => onDecide("approve", inv)}
                      className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
                    >
                      <ShieldCheck size={12} /> Aprobar
                    </button>
                  )}
                  {isAdmin && inv.approved && !isInvoiceClosed(inv) && (
                    <button
                      onClick={() => onDecide("revert", inv)}
                      className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      <RotateCw size={12} /> Revertir aprobación
                    </button>
                  )}
                  {isAdmin && !isInvoiceLocked(inv) && (
                    <button
                      onClick={() => onDecide("reject", inv)}
                      className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-rose-200 px-2.5 py-1.5 text-[11px] font-semibold text-rose-600 hover:bg-rose-50"
                    >
                      <X size={12} /> Rechazar
                    </button>
                  )}
                  {!isInvoiceLocked(inv) && (
                    <button
                      onClick={() => onEdit(inv)}
                      className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      <Edit2 size={12} /> Editar
                    </button>
                  )}
                  {isAdmin && !isInvoiceClosed(inv) && (
                    <button
                      onClick={() => onDecide("void", inv)}
                      className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-500 hover:bg-slate-50"
                    >
                      <Trash2 size={12} /> Anular
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length + 1} className="px-4 py-8 text-center text-xs text-slate-400">
                {emptyLabel}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function InvoiceTableTools({ showVoided, voidedCount, onToggleVoided, onOpenColumns, onExport }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {voidedCount > 0 && (
        <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-500">
          <input type="checkbox" checked={showVoided} onChange={(e) => onToggleVoided(e.target.checked)} className="h-3.5 w-3.5 accent-blue-600" />
          Mostrar anuladas ({voidedCount})
        </label>
      )}
      <button
        onClick={onExport}
        className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
      >
        <Download size={13} /> Excel
      </button>
      <InvoiceColumnsButton onClick={onOpenColumns} />
    </div>
  );
}

const INVOICE_DECISIONS = {
  approve: {
    title: "Aprobar factura",
    verb: "Aprobar",
    confirmLabel: "Aprobar",
    note: "Ya no se podrá editar. Si fue un error, un administrador puede revertir la aprobación indicando el motivo.",
  },
  reject: {
    title: "Rechazar factura",
    verb: "Rechazar",
    confirmLabel: "Rechazar",
    danger: true,
    note: "Es definitivo: ya no se podrá editar ni aprobar. Para corregirla habrá que cargarla de nuevo.",
    placeholder: "Ej. El monto no coincide con el comprobante",
  },
  void: {
    title: "Anular factura",
    verb: "Anular",
    confirmLabel: "Anular",
    danger: true,
    note: "Es definitivo: deja de contar en los totales, pero se conserva en el historial.",
    placeholder: "Ej. Se cargó dos veces",
  },
  revert: {
    title: "Revertir aprobación",
    verb: "Revertir la aprobación de",
    confirmLabel: "Revertir aprobación",
    note: "La factura vuelve a Verificada y se podrá editar o aprobar de nuevo.",
    placeholder: "Ej. Se aprobó por error",
  },
};

function InvoiceDecisionModal({ decision, currency, onSubmit, onClose }) {
  const meta = INVOICE_DECISIONS[decision.type];
  const { inv } = decision;
  const needsReason = !!meta.placeholder;
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const canSubmit = !saving && (!needsReason || reason.trim().length >= 3);

  async function handleSubmit() {
    setSaving(true);
    try {
      await onSubmit(reason.trim());
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={meta.title} width={inv.documentUrl ? "max-w-5xl" : "max-w-md"} onClose={onClose}>
      <DocumentSplit path={inv.documentUrl} invoice={inv}>
      <p className="text-xs text-slate-600">
        ¿{meta.verb} "{inv.description || expenseTypeLabel(inv.expenseType)}" por {formatMoney(inv.amount, inv.cfdi?.moneda || currency)}?
      </p>
      <p className="mt-1 text-xs text-slate-400">{meta.note}</p>
      {needsReason && (
        <div className="mt-3">
          <label className="mb-1 block text-[11px] font-semibold text-slate-500">Motivo (obligatorio)</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder={meta.placeholder}
            className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-blue-400 focus:outline-none"
          />
        </div>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">
          Cancelar
        </button>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50 ${
            meta.danger ? "bg-rose-600 hover:bg-rose-700" : "bg-blue-600 hover:bg-blue-700"
          }`}
        >
          {saving ? "Guardando..." : meta.confirmLabel}
        </button>
      </div>
      </DocumentSplit>
    </Modal>
  );
}

const INVOICE_TABLE_BY_MODULE = { fuel: "fuel_records", travel: "travel_expenses", misc: "misc_expenses" };
const INVOICE_EVENT_LABELS = {
  created: "Registrada",
  verified: "Verificada",
  edited: "Editada",
  approved: "Aprobada",
  approval_reverted: "Aprobación revertida",
  rejected: "Rechazada",
  voided: "Anulada",
};
const INVOICE_FIELD_LABELS = {
  amount: "Monto",
  date: "Fecha",
  vendor: "Proveedor",
  concept: "Descripción",
  project: "Proyecto",
  workOrder: "Orden de trabajo",
  expenseType: "Concepto",
  unit: "Unidad",
  plate: "Matrícula",
  driverName: "Conductor / Huésped",
  invoiceFolio: "Folio",
  notes: "Notas",
  station: "Estación",
  liters: "Litros",
  odometer: "Odómetro",
  efficiency: "Rendimiento",
  category: "Categoría",
};

// Lista legible de lo que cambió en una edición.
function invoiceEventChanges(changes) {
  return Object.entries(changes ?? {}).map(([field, change]) => {
    if (field === "cfdi") return "Datos fiscales actualizados";
    if (field === "details") return "Datos del concepto actualizados";
    if (field === "documentUrl") return "Documento reemplazado";
    const shown = (value) => (value === null || value === undefined || value === "" ? "vacío" : String(value));
    return `${INVOICE_FIELD_LABELS[field] ?? field}: ${shown(change.de)} → ${shown(change.a)}`;
  });
}

const DETAIL_SECTION_TITLE = "mb-2 rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white";

function InvoiceHistory({ invoice }) {
  const [events, setEvents] = useState(null);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("invoice_events")
      .select("*")
      .eq("invoiceTable", INVOICE_TABLE_BY_MODULE[invoice.module])
      .eq("invoiceId", invoice.id)
      .order("createdAt", { ascending: true })
      .then(({ data }) => {
        if (!cancelled) setEvents(data ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [invoice.module, invoice.id, invoice.status, invoice.approved]);

  return (
    <section>
      <h4 className={DETAIL_SECTION_TITLE}>Historial</h4>
      {events === null && <p className="text-xs text-slate-400">Cargando...</p>}
      {events?.length === 0 && <p className="text-xs text-slate-400">Sin movimientos registrados. El historial empieza con los cambios a partir de ahora.</p>}
      {events?.length > 0 && (
        <ol className="space-y-2.5 border-l-2 border-slate-100 pl-3">
          {events.map((event) => (
            <li key={event.id}>
              <p className="text-xs font-semibold text-slate-700">{INVOICE_EVENT_LABELS[event.action] ?? event.action}</p>
              <p className="text-[11px] text-slate-400">
                {event.actorName || "Sistema"} · {new Date(event.createdAt).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}
              </p>
              {event.reason && <p className="text-[11px] text-slate-600">Motivo: {event.reason}</p>}
              {invoiceEventChanges(event.changes).map((line) => (
                <p key={line} className="text-[11px] text-slate-500">
                  {line}
                </p>
              ))}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function InvoiceColumnsButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
    >
      <Sliders size={13} /> Columnas
    </button>
  );
}

function ColumnPickerModal({ view, selected, defaults, onChange, onClose }) {
  const ownGroups = CONCEPT_COLUMN_GROUPS[view];
  const columns = INVOICE_COLUMNS.filter((c) => !ownGroups || !PARAM_COLUMN_GROUPS.includes(c.group) || ownGroups.includes(c.group));
  const groups = [...new Set(columns.map((c) => c.group))];
  function toggle(id) {
    onChange(selected.includes(id) ? selected.filter((c) => c !== id) : [...selected, id]);
  }
  return (
    <Modal title="Columnas visibles" width="max-w-2xl" onClose={onClose}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs text-slate-400">Elige qué datos quieres ver en esta tabla. Se guarda en este navegador.</p>
        <div className="flex shrink-0 gap-3 text-[11px] font-semibold text-blue-600">
          <button onClick={() => onChange(columns.map((c) => c.id))}>Todas</button>
          <button onClick={() => onChange(defaults)}>Restablecer</button>
        </div>
      </div>
      <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
        {groups.map((group) => (
          <div key={group}>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{group}</p>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {columns.filter((c) => c.group === group).map((c) => (
                <label key={c.id} className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-slate-100 px-2.5 py-1.5 hover:bg-slate-50">
                  <span className="text-xs font-medium text-slate-600">{c.label}</span>
                  <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} className="h-4 w-4 shrink-0 accent-blue-600" />
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      <button onClick={onClose} className="mt-4 w-full rounded-lg bg-blue-600 py-2 text-xs font-semibold text-white hover:bg-blue-700">
        Listo
      </button>
    </Modal>
  );
}

function DetailSection({ title, fields }) {
  const visible = fields.filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (visible.length === 0) return null;
  return (
    <section>
      <h4 className={DETAIL_SECTION_TITLE}>{title}</h4>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
        {visible.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[11px] text-slate-400">{label}</dt>
            <dd className="break-words text-xs font-medium text-slate-700">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// Lo propio del concepto de la factura, para el "Detalle".
function invoiceParamFields(invoice, money) {
  const cost = invoiceUnitCost(invoice);
  if (invoice.module === "fuel") {
    return [
      ["Estación de servicio", invoice.station],
      ["Tipo de combustible", invoiceFuelType(invoice)],
      ["Litros", `${invoice.liters.toLocaleString()} L`],
      ["Precio por litro", cost === null ? "" : money(cost)],
      ["Odómetro", invoice.odometer ? `${invoice.odometer.toLocaleString()} km` : ""],
      ["Rendimiento", invoice.efficiency ? `${invoice.efficiency} km/L` : ""],
    ];
  }
  const params = EXPENSE_PARAMS[invoice.expenseType] ?? [];
  const shown = { quantity: invoiceQuantity(invoice) || "", measure: invoiceMeasure(invoice) };
  const fields = params.filter((param) => param.id !== "driver").map((param) => [param.label, shown[param.id] ?? invoice.details[param.id]]);
  return params.some((param) => param.id === "quantity") && cost !== null ? [...fields, ["Costo por unidad", money(cost)]] : fields;
}

function InvoiceDetailModal({ invoice, currency, onEdit, onClose }) {
  const { format } = useDateFormat();
  const c = invoice.cfdi ?? {};
  const money = (value) => formatMoney(value, c.moneda || currency);
  const importe = (value) => (value === undefined || value === null ? undefined : money(value));
  const i = c.importes ?? {};
  const warnings = cfdiWarnings(invoice.cfdi);
  const taxText = (tax) =>
    [tax.tipo, tax.tasa !== undefined ? `${+(Number(tax.tasa) * 100).toFixed(4)}%` : null, tax.importe !== undefined ? money(tax.importe) : null].filter(Boolean).join(" ");

  return (
    <Modal title="Detalle de la factura" width={invoice.documentUrl ? "max-w-7xl" : "max-w-3xl"} onClose={onClose}>
      <DocumentSplit path={invoice.documentUrl} invoice={invoice}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
          <div>
            <p className="text-lg font-bold text-slate-800">{money(invoice.amount)}</p>
            <p className="text-xs text-slate-500">
              {expenseTypeLabel(invoice.expenseType)}
              {invoice.description ? ` · ${invoice.description}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <OriginBadge origin={invoice.origin} />
            <StatusBadge status={invoice.status} />
            {!invoice.documentUrl && <DocumentCell documentUrl={null} />}
          </div>
        </div>

        {warnings.length > 0 && (
          <div className="space-y-1 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-700">
            {warnings.map((w) => (
              <p key={w} className="flex items-start gap-1.5">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {w}
              </p>
            ))}
          </div>
        )}

        {isInvoiceLocked(invoice) && (
          <div className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-medium text-slate-600">
            <p>
              {invoice.status === "rejected"
                ? "Esta factura fue rechazada y ya no se puede modificar. Para corregirla hay que cargarla de nuevo."
                : invoice.status === "voided"
                ? "Esta factura fue anulada: no cuenta en los totales y ya no se puede modificar."
                : "Esta factura ya fue aprobada y no se puede modificar."}
            </p>
            {isInvoiceClosed(invoice) && invoice.statusReason && <p className="mt-1 font-normal">Motivo: {invoice.statusReason}</p>}
          </div>
        )}

        {!invoice.cfdi && (
          <p className="rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-500">
            Esta factura no tiene datos fiscales. Se cargó antes de esta función o a mano. Puedes volver a enviarla al bot o capturarlos con "Editar".
          </p>
        )}

        <DetailSection
          title="Registro"
          fields={[
            ["Proyecto", invoice.project],
            ["Orden de trabajo", invoice.workOrder],
            ["Proveedor", invoice.vendor],
            ["Fecha", invoice.date ? formatDate(invoice.date, format) : ""],
            ["Unidad", invoice.unit && `${invoice.unit}${invoice.plate ? ` — ${invoice.plate}` : ""}`],
            ["Conductor / Huésped", invoice.driverName],
            ["Usuario", invoice.uploadedByName],
            ["Aprobado por", invoice.approvedByName],
            ["Notas", invoice.notes],
          ]}
        />

        <DetailSection title={`Datos de ${expenseTypeLabel(invoice.expenseType).toLowerCase()}`} fields={invoiceParamFields(invoice, money)} />

        <DetailSection
          title="Comprobante fiscal"
          fields={[
            ["Folio fiscal (UUID)", c.uuid],
            ["Serie y folio", [c.serie, c.folio || invoice.invoiceFolio].filter(Boolean).join("-")],
            ["Tipo de comprobante", decodeSat(SAT_TIPO_COMPROBANTE, c.tipoComprobante)],
            ["Fecha de emisión", c.fechaEmision && String(c.fechaEmision).replace("T", " ")],
            ["Fecha de certificación", c.fechaCertificacion && String(c.fechaCertificacion).replace("T", " ")],
            ["Método de pago", decodeSat(SAT_METODO_PAGO, c.metodoPago)],
            ["Forma de pago", decodeSat(SAT_FORMA_PAGO, c.formaPago)],
            ["Moneda", c.moneda],
            ["Tipo de cambio", c.tipoCambio],
            ["Exportación", c.exportacion],
            ["Lugar de expedición", c.lugarExpedicion],
            ["Certificado del emisor", c.certificadoEmisor],
            ["Certificado del SAT", c.certificadoSAT],
          ]}
        />

        <DetailSection
          title="Emisor"
          fields={[
            ["Razón social", c.emisor?.nombre],
            ["Nombre comercial", c.emisor?.nombreComercial],
            ["RFC", c.emisor?.rfc],
            ["Régimen fiscal", decodeSat(SAT_REGIMEN, c.emisor?.regimenFiscal)],
            ["Domicilio", c.emisor?.domicilio],
          ]}
        />

        <DetailSection
          title="Receptor"
          fields={[
            ["Razón social", c.receptor?.nombre],
            ["RFC", c.receptor?.rfc],
            ["Uso de CFDI", decodeSat(SAT_USO_CFDI, c.receptor?.usoCFDI)],
            ["Régimen fiscal", decodeSat(SAT_REGIMEN, c.receptor?.regimenFiscal)],
            ["Domicilio fiscal", c.receptor?.domicilioFiscal],
          ]}
        />

        {c.conceptos?.length > 0 && (
          <section>
            <h4 className={DETAIL_SECTION_TITLE}>Partidas</h4>
            <div className="overflow-x-auto rounded-xl border border-slate-100">
              <table className="w-full min-w-max text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] text-slate-400">
                    {["Cant.", "Unidad", "Clave", "Descripción", "P. unitario", "Importe", "Impuestos"].map((h) => (
                      <th key={h} className="px-2.5 py-2 font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {c.conceptos.map((line, index) => (
                    <tr key={index} className="border-b border-slate-50 text-slate-600 last:border-0">
                      <td className="px-2.5 py-2">{orEmpty(line.cantidad)}</td>
                      <td className="px-2.5 py-2">{orEmpty(line.unidad)}</td>
                      <td className="px-2.5 py-2">{orEmpty(line.claveProdServ)}</td>
                      <td className="px-2.5 py-2 font-medium text-slate-700">{orEmpty(line.descripcion)}</td>
                      <td className="px-2.5 py-2">{line.valorUnitario !== undefined ? money(line.valorUnitario) : EMPTY_CELL}</td>
                      <td className="px-2.5 py-2">{line.importe !== undefined ? money(line.importe) : EMPTY_CELL}</td>
                      <td className="px-2.5 py-2">{line.impuestos?.length ? line.impuestos.map(taxText).join(", ") : EMPTY_CELL}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <DetailSection
          title="Importes"
          fields={[
            ["Subtotal", importe(i.subtotal)],
            ["Descuento", importe(i.descuento)],
            ["IVA", importe(i.iva)],
            ["IEPS", importe(i.ieps)],
            ["ISH (hospedaje)", importe(i.ish)],
            ["Otros impuestos", importe(i.otrosImpuestos)],
            ["Retención de IVA", importe(i.retencionIVA)],
            ["Retención de ISR", importe(i.retencionISR)],
            ["Propina", importe(i.propina)],
            ["Total", importe(i.total)],
            ["Total con letra", i.totalConLetra],
          ]}
        />

        <DetailSection title="Otros datos" fields={(c.otros ?? []).map((o) => [o.campo, o.valor])} />

        <InvoiceHistory invoice={invoice} />
      </div>
      </DocumentSplit>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">
          Cerrar
        </button>
        {!isInvoiceLocked(invoice) && (
          <button onClick={() => onEdit(invoice)} className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
            Editar / Corregir
          </button>
        )}
      </div>
    </Modal>
  );
}

function DesgloseSettingsModal({ settings, onChange, onClose }) {
  const [daysDraft, setDaysDraft] = useState(String(settings.days));

  function setDays(n) {
    const v = Math.min(365, Math.max(1, Math.round(Number(n)) || 1));
    setDaysDraft(String(v));
    onChange({ ...settings, days: v });
  }
  function toggleConcept(id) {
    const has = settings.concepts.includes(id);
    onChange({ ...settings, concepts: has ? settings.concepts.filter((c) => c !== id) : [...settings.concepts, id] });
  }

  return (
    <Modal title="Configurar desglose" onClose={onClose}>
      <p className="mb-2 text-[11px] font-semibold text-slate-500">Mostrar lo subido en los últimos…</p>
      <div className="flex flex-wrap items-center gap-2">
        {DESGLOSE_PRESETS.map((p) => (
          <button
            key={p.days}
            onClick={() => setDays(p.days)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
              settings.days === p.days ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
            }`}
          >
            {p.label}
          </button>
        ))}
        <span className="flex items-center gap-1.5 text-xs text-slate-500">
          o
          <input
            type="number"
            min="1"
            max="365"
            value={daysDraft}
            onChange={(e) => setDaysDraft(e.target.value)}
            onBlur={() => setDays(daysDraft)}
            className="w-16 rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:border-blue-400 focus:outline-none"
          />
          días
        </span>
      </div>

      <div className="mb-2 mt-4 flex items-center justify-between">
        <p className="text-[11px] font-semibold text-slate-500">Conceptos que quiero ver</p>
        <div className="flex gap-3 text-[11px] font-semibold text-blue-600">
          <button onClick={() => onChange({ ...settings, concepts: EXPENSE_TYPES.map((t) => t.id) })}>Todos</button>
          <button onClick={() => onChange({ ...settings, concepts: [] })}>Ninguno</button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {EXPENSE_TYPES.map((t) => (
          <label key={t.id} className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-100 px-3 py-2 hover:bg-slate-50">
            <span className="text-xs font-medium text-slate-600">{t.label}</span>
            <input type="checkbox" checked={settings.concepts.includes(t.id)} onChange={() => toggleConcept(t.id)} className="h-4 w-4 accent-blue-600" />
          </label>
        ))}
      </div>
      <button onClick={onClose} className="mt-4 w-full rounded-lg bg-blue-600 py-2 text-xs font-semibold text-white hover:bg-blue-700">
        Listo
      </button>
    </Modal>
  );
}

function DeadlinesModal({ days, isAdmin, onSave, onClose }) {
  const [draft, setDraft] = useState(() => Object.fromEntries(Object.entries(days).map(([k, v]) => [k, String(v)])));
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const changes = {};
      for (const t of EXPENSE_TYPES) {
        const v = Math.min(365, Math.max(0, Math.round(Number(draft[t.id])) || 0));
        if (v !== days[t.id]) changes[t.id] = v;
      }
      const ok = await onSave(changes);
      if (ok !== false) onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Plazos por concepto" onClose={onClose}>
      <p className="mb-3 text-xs text-slate-400">
        Días que tiene cada tipo de factura, contados desde su fecha, para quedar con documento y verificada. Cuando faltan {ORDER_WARN_DAYS} días o
        menos, su orden aparece como "próxima a expirar".
      </p>
      <div className="grid grid-cols-2 gap-2">
        {EXPENSE_TYPES.map((t) => (
          <label key={t.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2">
            <span className="text-xs font-medium text-slate-600">{t.label}</span>
            <span className="flex items-center gap-1 text-[11px] text-slate-400">
              <input
                type="number"
                min="0"
                max="365"
                value={draft[t.id]}
                disabled={!isAdmin}
                onChange={(e) => setDraft((prev) => ({ ...prev, [t.id]: e.target.value }))}
                className="w-14 rounded-lg border border-slate-200 px-2 py-1 text-xs focus:border-blue-400 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400"
              />
              días
            </span>
          </label>
        ))}
      </div>
      {!isAdmin && <p className="mt-3 text-[11px] text-slate-400">Solo un administrador de la empresa puede cambiar los plazos.</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">
          {isAdmin ? "Cancelar" : "Cerrar"}
        </button>
        {isAdmin && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? "Guardando..." : "Guardar plazos"}
          </button>
        )}
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------------- */
/*  Resúmenes — periodos y widgets de cada concepto                       */
/* ---------------------------------------------------------------------- */

const SUMMARY_PERIODS = [
  { id: "month", label: "Este mes", title: "Resumen del mes", phrase: "este mes" },
  { id: "lastMonth", label: "Mes pasado", title: "Resumen del mes pasado", phrase: "el mes pasado" },
  { id: "year", label: "Este año", title: "Resumen del año", phrase: "este año" },
  { id: "all", label: "Todo", title: "Resumen de todas las fechas", phrase: "en total" },
];
const summaryPeriod = (id) => SUMMARY_PERIODS.find((p) => p.id === id) ?? SUMMARY_PERIODS[0];

// Fechas que abarca un periodo (ISO, ambas incluidas). Un reporte puede traer
// su propio rango { from, to }; "Todo" no tiene límites.
function periodRange(period) {
  if (period && typeof period === "object") return { from: period.from || null, to: period.to || null };
  const now = new Date();
  const year = now.getFullYear();
  if (period === "year") return { from: `${year}-01-01`, to: `${year}-12-31` };
  if (period === "month" || period === "lastMonth") {
    const month = now.getMonth() - (period === "lastMonth" ? 1 : 0);
    return { from: localISODate(new Date(year, month, 1)), to: localISODate(new Date(year, month + 1, 0)) };
  }
  return { from: null, to: null };
}

function inSummaryPeriod(inv, period) {
  const { from, to } = periodRange(period);
  const date = String(inv.date || "").slice(0, 10);
  return (!from || date >= from) && (!to || date <= to);
}

const TIME_GROUPS = [
  { id: "auto", label: "Automático" },
  { id: "day", label: "Por día" },
  { id: "week", label: "Por semana" },
  { id: "month", label: "Por mes" },
];
const GROUP_ORDER = ["day", "week", "month"];
const MAX_CHART_BARS = 62;
const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function bucketKey(iso, group) {
  const d = parseISODate(iso);
  if (group === "month") return localISODate(new Date(d.getFullYear(), d.getMonth(), 1));
  if (group === "week") return localISODate(new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)));
  return localISODate(d);
}

function nextBucketKey(key, group) {
  const d = parseISODate(key);
  if (group === "month") return localISODate(new Date(d.getFullYear(), d.getMonth() + 1, 1));
  return localISODate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + (group === "week" ? 7 : 1)));
}

function bucketKeys(from, to, group) {
  const keys = [];
  for (let key = bucketKey(from, group); key <= to && keys.length <= MAX_CHART_BARS; key = nextBucketKey(key, group)) keys.push(key);
  return keys;
}

// Reparte las facturas en barras de tiempo. Si salen demasiadas barras para
// leerse, se agrupa más grueso (día → semana → mes).
function timeBuckets(rows, period, group = "auto") {
  const dates = rows.map((i) => String(i.date || "").slice(0, 10)).filter(Boolean).sort();
  const range = periodRange(period);
  const today = localISODate();
  const from = range.from ?? dates[0];
  const to = range.to ?? (dates.length && dates[dates.length - 1] > today ? dates[dates.length - 1] : today);
  if (!from || from > to) return { group: "day", buckets: [] };
  const spanDays = Math.round((parseISODate(to) - parseISODate(from)) / DAY_MS) + 1;
  let used = group !== "auto" ? group : spanDays <= 62 ? "day" : spanDays <= 183 ? "week" : "month";
  let keys = bucketKeys(from, to, used);
  while (keys.length > MAX_CHART_BARS && used !== "month") {
    used = GROUP_ORDER[GROUP_ORDER.indexOf(used) + 1];
    keys = bucketKeys(from, to, used);
  }
  if (keys.length > MAX_CHART_BARS) {
    const end = parseISODate(to);
    keys = bucketKeys(localISODate(new Date(end.getFullYear(), end.getMonth() - (MAX_CHART_BARS - 1), 1)), to, "month");
  }
  const byKey = new Map(keys.map((key) => [key, []]));
  for (const i of rows) byKey.get(bucketKey(String(i.date || "").slice(0, 10), used))?.push(i);
  return {
    group: used,
    buckets: keys.map((key) => {
      const d = parseISODate(key);
      const day = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
      const monthLabel = `${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
      return {
        key,
        short: used === "month" ? monthLabel : day,
        label: used === "month" ? monthLabel : used === "week" ? `Semana del ${day} ${d.getFullYear()}` : `${day} ${d.getFullYear()}`,
        rows: byKey.get(key),
      };
    }),
  };
}

// Barras pequeñas del resumen general.
function summaryTrend(rows, period, get) {
  return timeBuckets(rows, period).buckets.map((b) => sumOf(b.rows, get));
}

const amountOf = (i) => i.amount;
const sumOf = (rows, get) => rows.reduce((s, i) => s + (Number(get(i)) || 0), 0);
const distinctOf = (rows, get) => new Set(rows.map(get).filter(Boolean)).size;
const countLabel = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const ratio = (num, den) => (den > 0 ? num / den : null);

function topOf(rows, get) {
  const totals = new Map();
  for (const i of rows) {
    const key = get(i);
    if (key) totals.set(key, (totals.get(key) ?? 0) + i.amount);
  }
  const [name, total] = [...totals].sort((a, b) => b[1] - a[1])[0] ?? [];
  return name ? { name, total } : null;
}

// Kilómetros según el odómetro: de la primera a la última carga de cada unidad.
function kmTraveled(rows) {
  const byUnit = new Map();
  for (const i of rows) {
    if (!i.unit || !i.odometer) continue;
    const [low, high] = byUnit.get(i.unit) ?? [i.odometer, i.odometer];
    byUnit.set(i.unit, [Math.min(low, i.odometer), Math.max(high, i.odometer)]);
  }
  return [...byUnit.values()].reduce((s, [low, high]) => s + high - low, 0);
}

function unitCostOf(rows, quantityOf) {
  const withQuantity = rows.filter((i) => quantityOf(i) > 0);
  return ratio(sumOf(withQuantity, amountOf), sumOf(withQuantity, quantityOf));
}

const asMoney = (n, ctx) => formatCurrency(n, ctx.currency);
const asPrice = (n, ctx) => formatMoney(n, ctx.currency);
const asCount = (n) => Math.round(n).toLocaleString();
const asAmount = (suffix, digits = 0) => (n) => `${n.toLocaleString(undefined, { maximumFractionDigits: digits })}${suffix ? ` ${suffix}` : ""}`;

// Tres clases de widget:
//  - metric: "value" da un número (o null si no hay datos); el mismo cálculo
//    sirve para la tarjeta y para cada barra de su gráfica en el tiempo.
//  - ranking: el "principal" de algo; su gráfica es el ranking por gasto.
//  - read: un estado de hoy (órdenes, proyectos), solo como número.
const metric = (id, label, icon, tone, value, format, detail) => ({ id, label, icon, tone, value, format, detail });
const ranking = (id, label, icon, tone, rank) => ({ id, label, icon, tone, rank });
const countWidget = (id, label, icon, tone, filter, detail) => metric(id, label, icon, tone, (rows) => rows.filter(filter).length, asCount, detail);
const sumWidget = (id, label, icon, tone, filter, detail = (rows) => countLabel(rows.filter(filter).length, "factura")) =>
  metric(id, label, icon, tone, (rows) => sumOf(rows.filter(filter), amountOf), asMoney, detail);
const taxWidget = (id, label, field) =>
  metric(id, label, FileText, "slate", (rows) => sumOf(rows, (i) => i.cfdi?.importes?.[field]), asMoney, () => "Según los datos fiscales");
const amountDetail = (filter, suffix) => (rows, ctx) => `${asMoney(sumOf(rows.filter(filter), amountOf), ctx)} ${suffix}`;
const canChartWidget = (w) => !!(w.value || w.rank);

function widgetReading(w, rows, ctx) {
  if (w.read) return w.read(rows, ctx);
  if (w.rank) {
    const top = topOf(rows, w.rank);
    return top ? [top.name, `${formatCurrency(top.total, ctx.currency)} de gasto`] : ["—", "Sin datos en este periodo"];
  }
  const value = w.value(rows, ctx);
  return [value === null ? "—" : w.format(value, ctx), w.detail ? w.detail(rows, ctx) : ""];
}

const isPendingInvoice = (i) => i.status === "pending";
const isAwaitingApproval = (i) => i.status === "verified" && !i.approved;

// Los que le sirven a cualquier concepto.
const SHARED_WIDGETS = [
  metric("total", "Gasto total", DollarSign, "blue", (rows) => sumOf(rows, amountOf), asMoney, (rows, ctx) => `${countLabel(rows.length, "factura")} ${ctx.phrase}`),
  countWidget("count", "Facturas", Receipt, "slate", () => true, () => "Sin contar rechazadas ni anuladas"),
  metric("average", "Promedio por factura", Activity, "sky", (rows) => ratio(sumOf(rows, amountOf), rows.length), asMoney, () => "Gasto total entre facturas"),
  metric(
    "largest",
    "Factura más alta",
    ChevronUp,
    "amber",
    (rows) => (rows.length ? Math.max(...rows.map(amountOf)) : null),
    asMoney,
    (rows) => {
      if (rows.length === 0) return "Sin datos en este periodo";
      const top = rows.reduce((a, b) => (b.amount > a.amount ? b : a));
      return top.vendor || top.description || expenseTypeLabel(top.expenseType);
    }
  ),
  countWidget("toVerify", "Sin verificar", AlertTriangle, "rose", isPendingInvoice, amountDetail(isPendingInvoice, "por revisar")),
  countWidget("toApprove", "Por aprobar", ShieldCheck, "blue", isAwaitingApproval, amountDetail(isAwaitingApproval, "ya verificados")),
  countWidget("approved", "Aprobadas", CheckCircle2, "emerald", (i) => i.approved, amountDetail((i) => i.approved, "aprobados")),
  metric("closed", "Rechazadas y anuladas", X, "slate", (rows, ctx) => ctx.closed.length, asCount, () => "No cuentan en los totales"),
  countWidget("noDocument", "Sin documento", FileText, "amber", (i) => !i.documentUrl, () => "Les falta el comprobante"),
  taxWidget("iva", "IVA", "iva"),
  ranking("topVendor", "Proveedor principal", Receipt, "slate", (i) => i.vendor || i.cfdi?.emisor?.nombre),
  ranking("topUnit", "Unidad con más gasto", Truck, "slate", (i) => i.unit),
  countWidget("telegram", "Cargadas por Telegram", Bot, "sky", (i) => i.origin === "telegram", () => "Leídas por el bot"),
];

// Las órdenes reflejan cómo van hoy, sin importar el periodo elegido.
const ORDER_WIDGETS = [
  {
    id: "ordersOpen",
    label: "Órdenes abiertas",
    icon: Clock,
    tone: "blue",
    read: (rows, ctx) => [ctx.orders.filter((o) => !o.complete).length.toLocaleString(), `${ctx.orders.length.toLocaleString()} en total, a la fecha`],
  },
  {
    id: "ordersMissingDocs",
    label: "Órdenes sin documentación",
    icon: FileText,
    tone: "amber",
    read: (rows, ctx) => [ctx.orders.filter((o) => o.missingDocs).length.toLocaleString(), "Les falta un documento o el monto"],
  },
  {
    id: "ordersDone",
    label: "Órdenes completadas",
    icon: CheckCircle2,
    tone: "emerald",
    read: (rows, ctx) => [ctx.orders.filter((o) => o.complete).length.toLocaleString(), "Con documentos y todo verificado"],
  },
  {
    id: "ordersExpiring",
    label: "Órdenes por expirar",
    icon: AlertTriangle,
    tone: "rose",
    read: (rows, ctx) => {
      const open = ctx.orders.filter((o) => !o.complete && o.daysLeft !== null);
      return [open.filter((o) => o.daysLeft >= 0 && o.daysLeft <= ORDER_WARN_DAYS).length.toLocaleString(), countLabel(open.filter((o) => o.daysLeft < 0).length, "ya vencida", "ya vencidas")];
    },
  },
];

const litersWidget = metric("liters", "Litros consumidos", Droplet, "sky", (rows) => sumOf(rows, (i) => i.liters), asAmount("L"), (rows) =>
  countLabel(rows.filter((i) => i.liters > 0).length, "carga")
);
const quantityWidget = (label) =>
  metric("quantity", label, Layers, "sky", (rows) => sumOf(rows, invoiceQuantity), asAmount("", 2), (rows) => {
    const top = topOf(rows, invoiceMeasure);
    return top ? `Principalmente: ${top.name}` : "Capturada o leída de las partidas";
  });
const unitCostWidget = metric("unitCost", "Costo por unidad", DollarSign, "emerald", (rows) => unitCostOf(rows, invoiceQuantity), asPrice, () => "Promedio pagado");
const unitsServedWidget = (label) => metric("unitsServed", label, Truck, "slate", (rows) => distinctOf(rows, (i) => i.unit), asCount, () => "Con vehículo asociado");

// "charts": los que arrancan como gráfica hasta que la persona elija otra cosa.
const conceptCatalog = (own, defaults) => ({ widgets: [...own, ...SHARED_WIDGETS], defaults, charts: ["total"] });
const scopeCatalog = (own, defaults) => ({
  widgets: [...own, ...SHARED_WIDGETS, ranking("topConcept", "Concepto con más gasto", Layers, "blue", (i) => expenseTypeLabel(i.expenseType)), litersWidget, ...ORDER_WIDGETS],
  defaults,
  charts: ["total"],
});

const GENERAL_WIDGETS = [
  { id: "totalSpend", label: "Gasto total", icon: DollarSign },
  { id: "liters", label: "Litros consumidos", icon: Droplet },
  { id: "ordersMissingDocs", label: "Órdenes sin documentación completa", icon: FileText },
  { id: "unverified", label: "Servicios sin verificar", icon: AlertTriangle },
  { id: "newOrders", label: "Nuevas órdenes de trabajo", icon: Plus },
  { id: "completedOrders", label: "Órdenes completadas", icon: CheckCircle2 },
  { id: "expiring", label: "Próximas a expirar", icon: Clock },
  { id: "pendingApproval", label: "Pendientes de aprobación", icon: ShieldCheck },
];

const CONCEPT_ICONS = { fuel: Fuel, travel: Navigation, consumables: Layers, coolant: Droplet, parts: Wrench, tolls: Radio };

const SUMMARY_CATALOGS = {
  general: { widgets: GENERAL_WIDGETS, defaults: GENERAL_WIDGETS.map((w) => w.id) },
  // Las tarjetas de "Conceptos": cada una es el gasto de un concepto.
  concepts: {
    widgets: CONCEPT_CATEGORIES.map((c) =>
      sumWidget(c.id, c.label, CONCEPT_ICONS[c.id], "blue", (i) => inConcept(i, c.id))
    ),
    defaults: CONCEPT_CATEGORIES.map((c) => c.id),
  },
  projects: scopeCatalog(
    [
      { id: "projectCount", label: "Proyectos", icon: Layers, tone: "slate", read: (rows, ctx) => [ctx.projects.length.toLocaleString(), "Según la vista elegida"] },
      ranking("topProject", "Proyecto con más gasto", Layers, "amber", (i) => i.project),
    ],
    ["total", "projectCount", "topProject", "topConcept", "toVerify", "toApprove", "ordersOpen", "ordersExpiring"]
  ),
  project: scopeCatalog([], ["total", "count", "topConcept", "topVendor", "toVerify", "toApprove", "ordersOpen", "ordersExpiring"]),
  fuel: conceptCatalog(
    [
      litersWidget,
      metric("pricePerLiter", "Precio por litro", DollarSign, "emerald", (rows) => unitCostOf(rows, (i) => i.liters), asPrice, () => "Promedio pagado"),
      metric(
        "efficiency",
        "Rendimiento promedio",
        Gauge,
        "emerald",
        (rows) => {
          const known = rows.filter((i) => i.efficiency > 0);
          return ratio(sumOf(known, (i) => i.efficiency), known.length);
        },
        asAmount("km/L", 1),
        (rows) => `${countLabel(rows.filter((i) => i.efficiency > 0).length, "carga")} con dato`
      ),
      metric("km", "Kilómetros recorridos", Navigation, "blue", kmTraveled, asAmount("km"), () => "Según el odómetro de cada unidad"),
      metric("costPerKm", "Costo por kilómetro", Activity, "amber", (rows) => ratio(sumOf(rows, amountOf), kmTraveled(rows)), asPrice, () => "Gasto entre kilómetros"),
      ranking("topStation", "Estación principal", Fuel, "slate", (i) => i.station || i.vendor),
      ranking("topFuel", "Combustible principal", Droplet, "sky", invoiceFuelType),
      unitsServedWidget("Unidades abastecidas"),
      taxWidget("ieps", "IEPS", "ieps"),
    ],
    ["total", "liters", "pricePerLiter", "efficiency", "km", "topStation", "toVerify", "toApprove"]
  ),
  travel: conceptCatalog(
    [
      sumWidget("hotel", "Hotel", Home, "blue", (i) => i.expenseType === "hotel"),
      sumWidget("food", "Alimentos", Receipt, "emerald", (i) => i.expenseType === "alimentos"),
      sumWidget("transport", "Transporte", Navigation, "sky", (i) => i.expenseType === "transporte"),
      sumWidget("perDiem", "Viáticos", DollarSign, "amber", (i) => i.expenseType === "viaticos"),
      metric("people", "Personas", User, "slate", (rows) => distinctOf(rows, (i) => i.driverName), asCount, () => "Con nombre registrado"),
      metric(
        "perPerson",
        "Gasto por persona",
        User,
        "emerald",
        (rows) => ratio(sumOf(rows.filter((i) => i.driverName), amountOf), distinctOf(rows, (i) => i.driverName)),
        asMoney,
        () => "De las facturas con nombre"
      ),
      metric("nights", "Noches de hotel", Clock, "blue", (rows) => sumOf(rows, (i) => i.details.nights), asCount, () => "Capturadas en cada factura"),
      metric("perNight", "Costo por noche", DollarSign, "emerald", (rows) => unitCostOf(rows, (i) => Number(i.details.nights) || 0), asPrice, () => "De los hoteles con noches"),
      ranking("topDestination", "Destino principal", MapPin, "slate", (i) => i.details.destination),
      taxWidget("ish", "ISH (hospedaje)", "ish"),
      taxWidget("propina", "Propinas", "propina"),
    ],
    ["total", "hotel", "food", "transport", "people", "nights", "toVerify", "toApprove"]
  ),
  consumables: conceptCatalog(
    [quantityWidget("Cantidad comprada"), unitCostWidget, ranking("topItem", "Artículo principal", Layers, "amber", (i) => i.description), unitsServedWidget("Unidades atendidas")],
    ["total", "quantity", "topItem", "topVendor", "unitsServed", "toVerify", "toApprove", "noDocument"]
  ),
  coolant: conceptCatalog(
    [quantityWidget("Cantidad cargada"), unitCostWidget, ranking("coolantType", "Tipo principal", Droplet, "sky", (i) => i.details.coolantType), unitsServedWidget("Unidades atendidas")],
    ["total", "quantity", "unitCost", "coolantType", "unitsServed", "topVendor", "toVerify", "toApprove"]
  ),
  parts: conceptCatalog(
    [
      quantityWidget("Piezas compradas"),
      unitCostWidget,
      ranking("topPart", "Refacción principal", Wrench, "amber", (i) => i.details.partNumber || i.description),
      ranking("topBrand", "Marca principal", Layers, "slate", (i) => i.details.brand),
      countWidget("withWarranty", "Con garantía", ShieldCheck, "emerald", (i) => i.details.warrantyMonths > 0, () => "Tienen meses de garantía"),
      unitsServedWidget("Unidades atendidas"),
    ],
    ["total", "quantity", "topPart", "topBrand", "withWarranty", "topVendor", "toVerify", "toApprove"]
  ),
  tolls: conceptCatalog(
    [
      countWidget("crossings", "Cruces", Navigation, "sky", () => true, () => "Una factura por cruce"),
      metric("perCrossing", "Promedio por cruce", Activity, "emerald", (rows) => ratio(sumOf(rows, amountOf), rows.length), asPrice, () => "Gasto entre cruces"),
      ranking("topPlaza", "Caseta principal", MapPin, "amber", (i) => i.details.plaza),
      ranking("topRoute", "Ruta principal", Navigation, "slate", (i) => i.details.route),
      sumWidget("tag", "Pagado con TAG", Radio, "blue", (i) => i.details.paymentMethod === "TAG", () => "Según la forma de pago capturada"),
      sumWidget("cash", "Pagado en efectivo", DollarSign, "amber", (i) => i.details.paymentMethod === "Efectivo", () => "Según la forma de pago capturada"),
      unitsServedWidget("Unidades con casetas"),
    ],
    ["total", "crossings", "perCrossing", "topPlaza", "tag", "cash", "toVerify", "toApprove"]
  ),
};

// Qué widgets ve la persona, en qué orden y cuáles como gráfica.
function widgetEntries(saved, catalog) {
  const list = saved ?? catalog.defaults.map((id) => ({ id, chart: (catalog.charts ?? []).includes(id) }));
  return list.map((e) => (typeof e === "string" ? { id: e, chart: false } : e)).filter((e) => catalog.widgets.some((w) => w.id === e.id));
}

function SegmentedControl({ options, value, onChange, label }) {
  return (
    <div role="group" aria-label={label} className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5 text-[11px] font-semibold">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          aria-pressed={value === option.id}
          title={option.title}
          className={`flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 transition ${value === option.id ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}
        >
          {option.icon && <option.icon size={12} />}
          {option.label}
        </button>
      ))}
    </div>
  );
}

const DISPLAY_OPTIONS = [
  { id: "number", label: "Número", icon: Hash },
  { id: "chart", label: "Gráfica", icon: BarChart3 },
];

function SummaryWidgetsModal({ title = "Personalizar widgets", hint, widgets, entries, defaults, onChange, onClose }) {
  const shown = entries.map((e) => ({ entry: e, widget: widgets.find((w) => w.id === e.id) })).filter((x) => x.widget);
  const hidden = widgets.filter((w) => !entries.some((e) => e.id === w.id));

  function move(index, delta) {
    const next = [...entries];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    onChange(next);
  }

  const arrow = "flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent";
  const label = (w, checked, toggle) => {
    const Icon = w.icon;
    return (
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-xs font-medium text-slate-600">
        <input type="checkbox" checked={checked} onChange={toggle} className="h-4 w-4 shrink-0 accent-blue-600" />
        <Icon size={15} className="shrink-0 text-blue-600" />
        <span className="min-w-0">{w.label}</span>
      </label>
    );
  };

  return (
    <Modal title={title} width="max-w-xl" onClose={onClose}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs text-slate-400">{hint ?? "Elige qué ver, en qué orden y cuáles como gráfica. Se guarda en este navegador."}</p>
        <button onClick={() => onChange(defaults)} className="shrink-0 text-[11px] font-semibold text-blue-600">
          Restablecer
        </button>
      </div>
      <div className="max-h-[60vh] space-y-1.5 overflow-y-auto pr-1">
        {shown.length === 0 && <p className="py-2 text-center text-xs text-slate-400">Nada visible.</p>}
        {shown.map(({ entry, widget }, index) => (
          <div key={widget.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 px-3 py-2 hover:bg-slate-50">
            {label(widget, true, () => onChange(entries.filter((e) => e.id !== widget.id)))}
            {canChartWidget(widget) ? (
              <SegmentedControl
                label={`Mostrar ${widget.label} como`}
                options={DISPLAY_OPTIONS}
                value={entry.chart ? "chart" : "number"}
                onChange={(mode) => onChange(entries.map((e) => (e.id === widget.id ? { ...e, chart: mode === "chart" } : e)))}
              />
            ) : (
              <span className="text-[10px] text-slate-400">Solo número</span>
            )}
            <div className="flex shrink-0 gap-0.5">
              <button type="button" onClick={() => move(index, -1)} disabled={index === 0} className={arrow} aria-label={`Subir ${widget.label}`}>
                <ChevronUp size={14} />
              </button>
              <button type="button" onClick={() => move(index, 1)} disabled={index === shown.length - 1} className={arrow} aria-label={`Bajar ${widget.label}`}>
                <ChevronDown size={14} />
              </button>
            </div>
          </div>
        ))}
        {hidden.length > 0 && <p className="pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Disponibles</p>}
        {hidden.map((w) => (
          <div key={w.id} className="flex items-center gap-2 rounded-xl border border-slate-100 px-3 py-2 hover:bg-slate-50">
            {label(w, false, () => onChange([...entries, { id: w.id, chart: false }]))}
          </div>
        ))}
      </div>
      <button onClick={onClose} className="mt-4 w-full rounded-lg bg-blue-600 py-2 text-xs font-semibold text-white hover:bg-blue-700">
        Listo
      </button>
    </Modal>
  );
}

function SummaryControls({ period, onPeriodChange, group, onGroupChange, onCustomize }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SegmentedControl label="Periodo del resumen" options={SUMMARY_PERIODS} value={period} onChange={onPeriodChange} />
      {onGroupChange && (
        <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
          Gráficas
          <select value={group} onChange={(e) => onGroupChange(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 focus:border-blue-400 focus:outline-none">
            {TIME_GROUPS.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <button onClick={onCustomize} className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
        <Settings size={13} /> Personalizar widgets
      </button>
    </div>
  );
}

// Sin esto, un periodo vacío parecería un error: las facturas se cuentan por
// la fecha del documento, no por el día en que se subieron.
function PeriodEmptyNote({ total, period, onShowAll }) {
  if (total === 0 || period === "all") return null;
  return (
    <p className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
      No hay facturas con fecha en este periodo, pero hay {countLabel(total, "factura")} en otras fechas.{" "}
      <button onClick={onShowAll} className="font-semibold text-blue-600 hover:text-blue-700">
        Ver todas las fechas
      </button>
    </p>
  );
}

const compactNumber = (n) => new Intl.NumberFormat("es-MX", { notation: "compact", maximumFractionDigits: 1 }).format(n);

// Techo "redondo" del eje, cercano al valor más alto para que las barras usen la altura.
function niceCeiling(max) {
  if (!(max > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  return [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((f) => f * magnitude).find((v) => v >= max);
}

// Una sola serie en columnas: el valor de cada barra sale al pasar el cursor
// o con el teclado, y "Ver tabla" muestra todos los números.
function TimeBarChart({ points, format, caption }) {
  const [active, setActive] = useState(null);
  const [asTable, setAsTable] = useState(false);
  if (points.length === 0) return <p className="mt-3 py-6 text-center text-[11px] text-slate-400">Sin datos para graficar en este periodo.</p>;
  const top = niceCeiling(Math.max(0, ...points.map((p) => p.value ?? 0)));
  const every = Math.ceil(points.length / 6);
  const current = active === null ? null : points[active];
  const tipLeft = active === null ? 0 : Math.min(85, Math.max(15, ((active + 0.5) / points.length) * 100));

  return (
    <div className="mt-3">
      <div className="mb-2 flex items-center justify-between text-[10px] font-medium text-slate-400">
        <span>{caption}</span>
        <button type="button" onClick={() => setAsTable((v) => !v)} className="font-semibold text-blue-600 hover:text-blue-700 print:hidden">
          {asTable ? "Ver gráfica" : "Ver tabla"}
        </button>
      </div>
      {asTable ? (
        <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-100">
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="text-slate-400">
                <th className="px-2 py-1 font-semibold">Periodo</th>
                <th className="px-2 py-1 text-right font-semibold">Valor</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.key} className="border-t border-slate-50 text-slate-600">
                  <td className="px-2 py-1">{p.label}</td>
                  <td className="px-2 py-1 text-right font-medium">{p.value === null ? "—" : format(p.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex gap-2">
          <div className="flex h-32 w-9 shrink-0 flex-col justify-between text-right text-[10px] leading-none text-slate-400">
            <span>{compactNumber(top)}</span>
            <span>{compactNumber(top / 2)}</span>
            <span>0</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="relative h-32">
              <div className="absolute inset-x-0 top-0 border-t border-slate-100" />
              <div className="absolute inset-x-0 top-1/2 border-t border-slate-100" />
              <div className="absolute inset-0 flex items-end gap-[2px] border-b border-slate-200">
                {points.map((p, i) => (
                  <button
                    key={p.key}
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onMouseLeave={() => setActive(null)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                    aria-label={`${p.label}: ${p.value === null ? "sin datos" : format(p.value)}`}
                    className="flex h-full min-w-0 flex-1 items-end justify-center rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
                  >
                    <span
                      className={`block w-full max-w-[24px] rounded-t ${active === i ? "bg-blue-400" : "bg-blue-600"}`}
                      style={{ height: p.value > 0 ? `${Math.max(2, (p.value / top) * 100)}%` : 0 }}
                    />
                  </button>
                ))}
              </div>
              {current && (
                <div
                  className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg bg-slate-900 px-2 py-1 text-[11px] shadow"
                  style={{ left: `${tipLeft}%` }}
                >
                  <p className="font-semibold text-white">{current.value === null ? "Sin datos" : format(current.value)}</p>
                  <p className="text-slate-300">{current.label}</p>
                </div>
              )}
            </div>
            <div className="mt-1 flex gap-[2px] text-[10px] text-slate-400">
              {points.map((p, i) => (
                <span key={p.key} className="min-w-0 flex-1 whitespace-nowrap text-center">
                  {i % every === 0 ? p.short : ""}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Gráfica de un widget "principal": quiénes concentran el gasto.
function RankingBars({ rows, rank, currency }) {
  const totals = new Map();
  for (const i of rows) {
    const key = rank(i);
    if (key) totals.set(key, (totals.get(key) ?? 0) + i.amount);
  }
  let items = [...totals].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);
  if (items.length === 0) return <p className="mt-3 py-6 text-center text-[11px] text-slate-400">Sin datos en este periodo.</p>;
  if (items.length > 6) {
    const rest = items.slice(5);
    items = [...items.slice(0, 5), { name: `Otros (${rest.length})`, total: sumOf(rest, (r) => r.total) }];
  }
  const max = Math.max(...items.map((it) => it.total));
  return (
    <div className="mt-3 space-y-2">
      {items.map((it) => (
        <div key={it.name} className="flex items-center gap-2 text-[11px]">
          <span className="w-28 shrink-0 truncate text-slate-600" title={it.name}>
            {it.name}
          </span>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="h-3 shrink-0 rounded-r bg-blue-600" style={{ width: `${max > 0 ? Math.max(1, (it.total / max) * 70) : 0}%` }} />
            <span className="shrink-0 font-semibold text-slate-700">{formatCurrency(it.total, currency)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// Una tarjeta del resumen: número o gráfica. "rows" son las facturas del
// periodo, incluidas rechazadas y anuladas (solo las cuenta "Rechazadas").
function WidgetCard({ widget, chart, rows, ctx, period, group, label = widget.label, onToggleChart, onOpen }) {
  const countable = rows.filter((i) => !isInvoiceClosed(i));
  const fullCtx = { ...ctx, closed: rows.filter(isInvoiceClosed) };
  const [value, detail] = widgetReading(widget, countable, fullCtx);
  const chartable = canChartWidget(widget);
  const toggle =
    onToggleChart && chartable ? (
      <button
        type="button"
        onClick={onToggleChart}
        title={chart ? "Ver como número" : "Ver como gráfica"}
        aria-label={chart ? `Ver ${label} como número` : `Ver ${label} como gráfica`}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 print:hidden"
      >
        {chart ? <Hash size={14} /> : <BarChart3 size={14} />}
      </button>
    ) : null;

  if (!chart || !chartable) return <KpiCard widget={{ ...widget, label, value, detail }} action={toggle} />;

  const Icon = widget.icon;
  let body;
  if (widget.rank) {
    body = <RankingBars rows={countable} rank={widget.rank} currency={ctx.currency} />;
  } else {
    const { group: used, buckets } = timeBuckets(rows, period, group);
    const points = buckets.map((b) => ({
      key: b.key,
      short: b.short,
      label: b.label,
      value: widget.value(
        b.rows.filter((i) => !isInvoiceClosed(i)),
        { ...ctx, closed: b.rows.filter(isInvoiceClosed) }
      ),
    }));
    body = <TimeBarChart points={points} format={(n) => widget.format(n, ctx)} caption={TIME_GROUPS.find((g) => g.id === used).label} />;
  }

  return (
    <div className="min-w-0 break-inside-avoid rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:col-span-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${TONE_CLASSES[widget.tone]}`}>
            <Icon size={16} />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-500">{label}</p>
            <p className="truncate text-lg font-bold text-slate-800" title={String(value)}>
              {value}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onOpen && (
            <button type="button" onClick={onOpen} className="rounded-lg px-2 py-1 text-[11px] font-semibold text-blue-600 hover:bg-blue-50 print:hidden">
              Ver concepto
            </button>
          )}
          {toggle}
        </div>
      </div>
      {detail && <p className="mt-0.5 text-[11px] text-slate-400">{detail}</p>}
      {body}
    </div>
  );
}

function InvoiceSummary({ catalogId, invoices, orders = [], projects = [], currency, period, onPeriodChange, group, onGroupChange, widgetPrefs, onWidgetPrefsChange }) {
  const [customizing, setCustomizing] = useState(false);
  const catalog = SUMMARY_CATALOGS[catalogId];
  const entries = widgetEntries(widgetPrefs[catalogId], catalog);
  const setEntries = (next) => onWidgetPrefsChange({ ...widgetPrefs, [catalogId]: next });
  const inPeriod = invoices.filter((i) => inSummaryPeriod(i, period));
  const ctx = { currency, period, orders, projects, phrase: summaryPeriod(period).phrase };

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-800">{summaryPeriod(period).title}</h2>
        <SummaryControls period={period} onPeriodChange={onPeriodChange} group={group} onGroupChange={onGroupChange} onCustomize={() => setCustomizing(true)} />
      </div>
      {!inPeriod.some((i) => !isInvoiceClosed(i)) && (
        <PeriodEmptyNote total={invoices.filter((i) => !isInvoiceClosed(i)).length} period={period} onShowAll={() => onPeriodChange("all")} />
      )}
      <div className="grid grid-flow-row-dense grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {entries.map((entry) => (
          <WidgetCard
            key={entry.id}
            widget={catalog.widgets.find((w) => w.id === entry.id)}
            chart={entry.chart}
            rows={inPeriod}
            ctx={ctx}
            period={period}
            group={group}
            onToggleChart={() => setEntries(entries.map((e) => (e.id === entry.id ? { ...e, chart: !e.chart } : e)))}
          />
        ))}
        {entries.length === 0 && <p className="col-span-full py-4 text-center text-xs text-slate-400">No hay widgets visibles. Actívalos desde "Personalizar widgets".</p>}
      </div>
      {customizing && (
        <SummaryWidgetsModal
          widgets={catalog.widgets}
          entries={entries}
          defaults={widgetEntries(undefined, catalog)}
          onChange={setEntries}
          onClose={() => setCustomizing(false)}
        />
      )}
    </div>
  );
}

// Cada concepto como tarjeta (gasto y su parte del total) o como gráfica de su
// gasto en el tiempo. La persona elige cuáles ver y en qué orden.
function ConceptBreakdown({ invoices, period, group, currency, widgetPrefs, onWidgetPrefsChange, onOpen }) {
  const [customizing, setCustomizing] = useState(false);
  const catalog = SUMMARY_CATALOGS.concepts;
  const entries = widgetEntries(widgetPrefs.concepts, catalog);
  const setEntries = (next) => onWidgetPrefsChange({ ...widgetPrefs, concepts: next });
  const toggleChart = (id) => setEntries(entries.map((e) => (e.id === id ? { ...e, chart: !e.chart } : e)));
  const inPeriod = invoices.filter((i) => inSummaryPeriod(i, period));
  const rows = inPeriod.filter((i) => !isInvoiceClosed(i));
  const grandTotal = sumOf(rows, amountOf);
  const ctx = { currency, period, orders: [], projects: [], phrase: summaryPeriod(period).phrase };

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-slate-800">Conceptos</h2>
          <p className="text-[11px] text-slate-400">Entra a un concepto para ver su propio resumen ({summaryPeriod(period).phrase}).</p>
        </div>
        <button onClick={() => setCustomizing(true)} className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
          <Settings size={13} /> Elegir conceptos
        </button>
      </div>
      <div className="grid grid-flow-row-dense grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {entries.map((entry) => {
          const widget = catalog.widgets.find((w) => w.id === entry.id);
          const conceptRows = inPeriod.filter((i) => inConcept(i, entry.id));
          if (entry.chart) {
            return (
              <WidgetCard
                key={entry.id}
                widget={widget}
                chart
                rows={conceptRows}
                ctx={ctx}
                period={period}
                group={group}
                onToggleChart={() => toggleChart(entry.id)}
                onOpen={() => onOpen(entry.id)}
              />
            );
          }
          const counted = conceptRows.filter((i) => !isInvoiceClosed(i));
          const total = sumOf(counted, amountOf);
          const share = grandTotal > 0 ? total / grandTotal : 0;
          return (
            <div key={entry.id} className="relative min-w-0">
              <button
                onClick={() => onOpen(entry.id)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 pr-11 text-left transition hover:border-blue-300 hover:bg-blue-50/40"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-xs font-semibold text-slate-700">{widget.label}</span>
                  <span className="shrink-0 text-xs font-bold text-slate-800">{formatCurrency(total, currency)}</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.round(share * 100)}%` }} />
                </div>
                <p className="mt-1.5 text-[11px] text-slate-400">
                  {countLabel(counted.length, "factura")} · {Math.round(share * 100)}% del gasto
                </p>
              </button>
              <button
                type="button"
                onClick={() => toggleChart(entry.id)}
                title="Ver como gráfica"
                aria-label={`Ver ${widget.label} como gráfica`}
                className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 print:hidden"
              >
                <BarChart3 size={14} />
              </button>
            </div>
          );
        })}
        {entries.length === 0 && <p className="col-span-full py-4 text-center text-xs text-slate-400">No hay conceptos visibles. Actívalos desde "Elegir conceptos".</p>}
      </div>
      {customizing && (
        <SummaryWidgetsModal
          title="Elegir conceptos"
          hint="Elige qué conceptos ver, en qué orden y cuáles como gráfica de su gasto. Se guarda en este navegador."
          widgets={catalog.widgets}
          entries={entries}
          defaults={widgetEntries(undefined, catalog)}
          onChange={setEntries}
          onClose={() => setCustomizing(false)}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Reportes — los datos que la persona elige, como número o gráfica      */
/* ---------------------------------------------------------------------- */

const REPORT_CONCEPTS = [{ id: "all", label: "Todos los conceptos" }, ...CONCEPT_CATEGORIES];
const REPORT_PERIODS = [...SUMMARY_PERIODS, { id: "custom", label: "Elegir fechas" }];
const reportCatalog = (concept) => SUMMARY_CATALOGS[concept === "all" ? "projects" : concept];

const DEFAULT_REPORT = {
  title: "Reporte de facturas",
  period: "month",
  from: "",
  to: "",
  items: [
    { concept: "all", widget: "total", chart: true, group: "auto" },
    { concept: "all", widget: "toVerify", chart: false, group: "auto" },
    { concept: "all", widget: "toApprove", chart: false, group: "auto" },
    { concept: "all", widget: "topConcept", chart: true, group: "auto" },
    { concept: "fuel", widget: "liters", chart: false, group: "auto" },
    { concept: "travel", widget: "total", chart: false, group: "auto" },
  ],
};

function reportScopeOptions(projects) {
  return [
    { id: "all", label: "Todas las facturas" },
    { id: "projects-active", label: "Proyectos activos" },
    { id: "projects-all", label: "Todos los proyectos" },
    ...projects.filter((p) => p.name).map((p) => ({ id: `project:${p.name}`, label: `Proyecto: ${p.name}${p.closed ? " (cerrado)" : ""}` })),
    { id: "loose", label: "Facturas sin proyecto" },
  ];
}

// Facturas, órdenes y proyectos que abarca el alcance de un reporte.
function reportScopeData(scope, invoices, orders, projects) {
  const named = projects.filter((p) => p.name);
  if (scope === "all") return { invoices, orders, projects: named };
  if (scope === "loose") return { invoices: invoices.filter((i) => !i.project), orders: orders.filter((o) => !o.project), projects: [] };
  const chosen =
    scope === "projects-active" ? named.filter((p) => !p.closed) : scope === "projects-all" ? named : named.filter((p) => `project:${p.name}` === scope);
  return { invoices: chosen.flatMap((p) => p.invoices), orders: chosen.flatMap((p) => p.orders), projects: chosen };
}

const reportPeriodValue = (report) => (report.period === "custom" ? { from: report.from, to: report.to } : report.period);

function ReportBuilderModal({ initial, projects, onGenerate, onClose }) {
  const [draft, setDraft] = useState(initial);
  const set = (patch) => setDraft((prev) => ({ ...prev, ...patch }));
  const setItem = (index, patch) => set({ items: draft.items.map((item, i) => (i === index ? { ...item, ...patch } : item)) });
  const moveItem = (index, delta) => {
    const items = [...draft.items];
    [items[index], items[index + delta]] = [items[index + delta], items[index]];
    set({ items });
  };
  const badRange = draft.period === "custom" && draft.from && draft.to && draft.from > draft.to;
  const canGenerate = draft.items.length > 0 && !badRange;
  const inputClass = "rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs focus:border-blue-400 focus:outline-none";
  const labelClass = "mb-1 block text-[11px] font-semibold text-slate-500";
  const arrow = "flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent";

  return (
    <Modal title="Crear reporte" width="max-w-3xl" onClose={onClose}>
      <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={labelClass}>Título</label>
            <input value={draft.title} onChange={(e) => set({ title: e.target.value })} className={`w-full ${inputClass}`} />
          </div>
          <div>
            <label className={labelClass}>Alcance</label>
            <select value={draft.scope} onChange={(e) => set({ scope: e.target.value })} className={`w-full ${inputClass}`}>
              {reportScopeOptions(projects).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Periodo</label>
            <select value={draft.period} onChange={(e) => set({ period: e.target.value })} className={`w-full ${inputClass}`}>
              {REPORT_PERIODS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          {draft.period === "custom" && (
            <>
              <div>
                <label className={labelClass}>Desde</label>
                <input type="date" value={draft.from} onChange={(e) => set({ from: e.target.value })} className={`w-full ${inputClass}`} />
              </div>
              <div>
                <label className={labelClass}>Hasta</label>
                <input type="date" value={draft.to} onChange={(e) => set({ to: e.target.value })} className={`w-full ${inputClass}`} />
              </div>
              {badRange && <p className="text-[11px] font-medium text-rose-600 sm:col-span-2">La fecha "Desde" va después de "Hasta".</p>}
            </>
          )}
        </div>

        <div>
          <p className="mb-1 text-[11px] font-semibold text-slate-500">Qué incluir</p>
          <p className="mb-2 text-[11px] text-slate-400">
            Elige el concepto y el dato. Cada uno puede salir como número o como gráfica; en las gráficas eliges cómo se reparte en el tiempo.
          </p>
          <div className="space-y-1.5">
            {draft.items.map((item, index) => {
              const catalog = reportCatalog(item.concept);
              const widget = catalog.widgets.find((w) => w.id === item.widget) ?? catalog.widgets[0];
              return (
                <div key={index} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 px-2.5 py-2">
                  <select
                    aria-label="Concepto"
                    value={item.concept}
                    onChange={(e) => {
                      const next = reportCatalog(e.target.value);
                      setItem(index, { concept: e.target.value, widget: next.widgets.some((w) => w.id === item.widget) ? item.widget : "total" });
                    }}
                    className={inputClass}
                  >
                    {REPORT_CONCEPTS.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  <select aria-label="Dato" value={widget.id} onChange={(e) => setItem(index, { widget: e.target.value })} className={`min-w-0 flex-1 ${inputClass}`}>
                    {catalog.widgets.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.label}
                      </option>
                    ))}
                  </select>
                  {canChartWidget(widget) ? (
                    <SegmentedControl
                      label="Mostrar como"
                      options={DISPLAY_OPTIONS}
                      value={item.chart ? "chart" : "number"}
                      onChange={(mode) => setItem(index, { chart: mode === "chart" })}
                    />
                  ) : (
                    <span className="text-[10px] text-slate-400">Solo número</span>
                  )}
                  {item.chart && widget.value && (
                    <select aria-label="Reparto en el tiempo" value={item.group} onChange={(e) => setItem(index, { group: e.target.value })} className={inputClass}>
                      {TIME_GROUPS.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.label}
                        </option>
                      ))}
                    </select>
                  )}
                  <div className="ml-auto flex shrink-0 gap-0.5">
                    <button type="button" onClick={() => moveItem(index, -1)} disabled={index === 0} className={arrow} aria-label="Subir">
                      <ChevronUp size={14} />
                    </button>
                    <button type="button" onClick={() => moveItem(index, 1)} disabled={index === draft.items.length - 1} className={arrow} aria-label="Bajar">
                      <ChevronDown size={14} />
                    </button>
                    <button type="button" onClick={() => set({ items: draft.items.filter((_, i) => i !== index) })} className={`${arrow} hover:text-rose-600`} aria-label="Quitar">
                      <X size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
            {draft.items.length === 0 && <p className="py-2 text-center text-xs text-slate-400">Agrega al menos un dato.</p>}
          </div>
          <div className="mt-2 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => set({ items: [...draft.items, { concept: "all", widget: "total", chart: false, group: "auto" }] })}
              className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700"
            >
              <Plus size={13} /> Agregar dato
            </button>
            <button type="button" onClick={() => set({ items: DEFAULT_REPORT.items })} className="text-[11px] font-semibold text-slate-500 hover:text-slate-700">
              Restablecer datos
            </button>
          </div>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">
          Cancelar
        </button>
        <button
          onClick={() => onGenerate({ ...draft, title: draft.title.trim() || DEFAULT_REPORT.title })}
          disabled={!canGenerate}
          className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Generar reporte
        </button>
      </div>
    </Modal>
  );
}

function InvoiceReport({ report, invoices, orders, projects, currency, userName, onEdit, onBack }) {
  const { format } = useDateFormat();
  const scope = reportScopeData(report.scope, invoices, orders, projects);
  const period = reportPeriodValue(report);
  const inPeriod = scope.invoices.filter((i) => inSummaryPeriod(i, period));
  const dates = inPeriod.map((i) => String(i.date || "").slice(0, 10)).filter(Boolean).sort();
  const range = periodRange(period);
  const from = range.from ?? dates[0];
  const to = range.to ?? localISODate();
  const rangeText = from ? `Del ${formatDate(from, format)} al ${formatDate(to, format)}` : "Sin facturas en el periodo";
  const scopeLabel = reportScopeOptions(projects).find((o) => o.id === report.scope)?.label ?? "Todas las facturas";
  const phrase = report.period === "custom" ? "en el periodo" : summaryPeriod(report.period).phrase;
  const ctx = { currency, period, orders: scope.orders, projects: scope.projects, phrase };
  const generatedAt = new Date().toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });

  return (
    // Sin "print-color-adjust", el navegador no imprime el color de las barras.
    <div className="space-y-4" style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-600">Reporte</p>
          <h1 className="break-words text-xl font-bold text-slate-900">{report.title}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {scopeLabel} · {rangeText}
          </p>
          <p className="text-[11px] text-slate-400">
            Generado el {generatedAt} por {userName}. Las facturas rechazadas y anuladas no cuentan en los totales.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <button onClick={onBack} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">
            Volver
          </button>
          <button onClick={onEdit} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">
            Editar reporte
          </button>
          <button onClick={() => window.print()} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700">
            <Printer size={14} /> Imprimir o guardar PDF
          </button>
        </div>
      </div>
      <div className="grid grid-flow-row-dense grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {report.items.map((item, index) => {
          const catalog = reportCatalog(item.concept);
          const widget = catalog.widgets.find((w) => w.id === item.widget);
          if (!widget) return null;
          const conceptLabel = REPORT_CONCEPTS.find((c) => c.id === item.concept)?.label ?? "";
          const rows = item.concept === "all" ? inPeriod : inPeriod.filter((i) => inConcept(i, item.concept));
          return (
            <WidgetCard
              key={index}
              widget={widget}
              label={`${conceptLabel} · ${widget.label}`}
              chart={item.chart}
              rows={rows}
              ctx={ctx}
              period={period}
              group={item.group}
            />
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Excel — descarga de facturas con los datos que la persona elige       */
/* ---------------------------------------------------------------------- */

// Cada columna posible del Excel. "type" decide cómo se guarda la celda para
// que Excel la pueda ordenar, filtrar y sumar: money, number, date, datetime
// o texto.
const excelField = (id, label, group, get, type = "text") => ({ id, label, group, get, type });
const yesNo = (value) => (value ? "Sí" : "No");
const cfdiOf = (inv) => inv.cfdi ?? {};
const importeOf = (key) => (inv) => cfdiOf(inv).importes?.[key];
const paramOf = (id) => (inv) => inv.details[id];

const EXCEL_FIELDS = [
  excelField("date", "Fecha", "Registro", (inv) => inv.date, "date"),
  excelField("expenseType", "Concepto", "Registro", (inv) => expenseTypeLabel(inv.expenseType)),
  excelField("description", "Descripción", "Registro", (inv) => inv.description),
  excelField("amount", "Monto", "Registro", (inv) => inv.amount, "money"),
  excelField("currency", "Moneda", "Registro", (inv, ctx) => cfdiOf(inv).moneda || ctx.currency),
  excelField("project", "Proyecto", "Registro", (inv) => inv.project),
  excelField("workOrder", "Orden de trabajo", "Registro", (inv) => inv.workOrder),
  excelField("unit", "Unidad", "Registro", (inv) => inv.unit),
  excelField("plate", "Matrícula", "Registro", (inv) => inv.plate),
  excelField("driver", "Conductor / Huésped", "Registro", (inv) => inv.driverName),
  excelField("vendor", "Proveedor", "Registro", (inv) => inv.vendor || cfdiOf(inv).emisor?.nombre),
  excelField("folio", "Folio", "Registro", (inv) => inv.invoiceFolio || cfdiOf(inv).folio),
  excelField("status", "Estado", "Registro", (inv) => STATUS_BADGE_STYLES[inv.status]?.label ?? inv.status),
  excelField("approved", "Aprobada", "Registro", (inv) => yesNo(inv.approved)),
  excelField("approvedBy", "Aprobada por", "Registro", (inv) => inv.approvedByName),
  excelField("statusReason", "Motivo de rechazo o anulación", "Registro", (inv) => (isInvoiceClosed(inv) ? inv.statusReason : "")),
  excelField("origin", "Origen", "Registro", (inv) => ORIGIN_STYLES[inv.origin]?.label ?? inv.origin),
  excelField("uploadedBy", "Subida por", "Registro", (inv) => inv.uploadedByName),
  excelField("createdAt", "Fecha de carga", "Registro", (inv) => inv.createdAt, "datetime"),
  excelField("hasDocument", "Documento adjunto", "Registro", (inv) => yesNo(inv.documentUrl)),
  excelField("notes", "Notas", "Registro", (inv) => inv.notes),

  excelField("station", "Estación de servicio", "Datos del concepto", (inv) => inv.station),
  excelField("fuelType", "Tipo de combustible", "Datos del concepto", invoiceFuelType),
  excelField("liters", "Litros", "Datos del concepto", (inv) => (inv.module === "fuel" ? inv.liters : null), "number"),
  excelField("pricePerLiter", "Precio por litro", "Datos del concepto", (inv) => (inv.module === "fuel" ? invoiceUnitCost(inv) : null), "money"),
  excelField("odometer", "Odómetro (km)", "Datos del concepto", (inv) => inv.odometer || inv.details.odometerKm, "number"),
  excelField("efficiency", "Rendimiento (km/L)", "Datos del concepto", (inv) => inv.efficiency || null, "number"),
  excelField("destination", "Destino", "Datos del concepto", paramOf("destination")),
  excelField("route", "Ruta", "Datos del concepto", paramOf("route")),
  excelField("plaza", "Caseta o plaza", "Datos del concepto", paramOf("plaza")),
  excelField("transportType", "Tipo de transporte", "Datos del concepto", paramOf("transportType")),
  excelField("tripDays", "Días del viaje", "Datos del concepto", paramOf("tripDays"), "number"),
  excelField("nights", "Noches", "Datos del concepto", paramOf("nights"), "number"),
  excelField("people", "Personas", "Datos del concepto", paramOf("people"), "number"),
  excelField("paymentMethod", "Forma de pago de la caseta", "Datos del concepto", paramOf("paymentMethod")),
  excelField("axles", "Ejes", "Datos del concepto", paramOf("axles"), "number"),
  excelField("coolantType", "Tipo de refrigerante", "Datos del concepto", paramOf("coolantType")),
  excelField("partNumber", "Número de parte", "Datos del concepto", paramOf("partNumber")),
  excelField("brand", "Marca", "Datos del concepto", paramOf("brand")),
  excelField("quantity", "Cantidad", "Datos del concepto", (inv) => (inv.module === "misc" ? invoiceQuantity(inv) || null : null), "number"),
  excelField("measure", "Unidad de medida", "Datos del concepto", (inv) => (inv.module === "misc" ? invoiceMeasure(inv) : "")),
  excelField("unitCost", "Costo por unidad", "Datos del concepto", (inv) => (inv.module === "misc" ? invoiceUnitCost(inv) : null), "money"),
  excelField("warrantyMonths", "Garantía (meses)", "Datos del concepto", paramOf("warrantyMonths"), "number"),

  excelField("uuid", "Folio fiscal (UUID)", "Comprobante fiscal", (inv) => cfdiOf(inv).uuid),
  excelField("serie", "Serie", "Comprobante fiscal", (inv) => cfdiOf(inv).serie),
  excelField("tipoComprobante", "Tipo de comprobante", "Comprobante fiscal", (inv) => decodeSat(SAT_TIPO_COMPROBANTE, cfdiOf(inv).tipoComprobante)),
  excelField("fechaEmision", "Fecha de emisión", "Comprobante fiscal", (inv) => cfdiOf(inv).fechaEmision, "datetime"),
  excelField("fechaCertificacion", "Fecha de certificación", "Comprobante fiscal", (inv) => cfdiOf(inv).fechaCertificacion, "datetime"),
  excelField("metodoPago", "Método de pago", "Comprobante fiscal", (inv) => decodeSat(SAT_METODO_PAGO, cfdiOf(inv).metodoPago)),
  excelField("formaPago", "Forma de pago", "Comprobante fiscal", (inv) => decodeSat(SAT_FORMA_PAGO, cfdiOf(inv).formaPago)),
  excelField("usoCfdi", "Uso de CFDI", "Comprobante fiscal", (inv) => decodeSat(SAT_USO_CFDI, cfdiOf(inv).receptor?.usoCFDI)),
  excelField("tipoCambio", "Tipo de cambio", "Comprobante fiscal", (inv) => cfdiOf(inv).tipoCambio, "number"),
  excelField("exportacion", "Exportación", "Comprobante fiscal", (inv) => cfdiOf(inv).exportacion),
  excelField("lugarExpedicion", "Lugar de expedición", "Comprobante fiscal", (inv) => cfdiOf(inv).lugarExpedicion),
  excelField("certificadoEmisor", "Certificado del emisor", "Comprobante fiscal", (inv) => cfdiOf(inv).certificadoEmisor),
  excelField("certificadoSAT", "Certificado del SAT", "Comprobante fiscal", (inv) => cfdiOf(inv).certificadoSAT),

  excelField("emisorNombre", "Razón social del emisor", "Emisor", (inv) => cfdiOf(inv).emisor?.nombre),
  excelField("emisorComercial", "Nombre comercial del emisor", "Emisor", (inv) => cfdiOf(inv).emisor?.nombreComercial),
  excelField("emisorRfc", "RFC del emisor", "Emisor", (inv) => cfdiOf(inv).emisor?.rfc),
  excelField("emisorRegimen", "Régimen fiscal del emisor", "Emisor", (inv) => decodeSat(SAT_REGIMEN, cfdiOf(inv).emisor?.regimenFiscal)),
  excelField("emisorDomicilio", "Domicilio del emisor", "Emisor", (inv) => cfdiOf(inv).emisor?.domicilio),

  excelField("receptorNombre", "Razón social del receptor", "Receptor", (inv) => cfdiOf(inv).receptor?.nombre),
  excelField("receptorRfc", "RFC del receptor", "Receptor", (inv) => cfdiOf(inv).receptor?.rfc),
  excelField("receptorRegimen", "Régimen fiscal del receptor", "Receptor", (inv) => decodeSat(SAT_REGIMEN, cfdiOf(inv).receptor?.regimenFiscal)),
  excelField("receptorDomicilio", "Domicilio fiscal del receptor", "Receptor", (inv) => cfdiOf(inv).receptor?.domicilioFiscal),

  excelField("subtotal", "Subtotal", "Importes", importeOf("subtotal"), "money"),
  excelField("descuento", "Descuento", "Importes", importeOf("descuento"), "money"),
  excelField("iva", "IVA", "Importes", importeOf("iva"), "money"),
  excelField("ieps", "IEPS", "Importes", importeOf("ieps"), "money"),
  excelField("ish", "ISH (hospedaje)", "Importes", importeOf("ish"), "money"),
  excelField("otrosImpuestos", "Otros impuestos", "Importes", importeOf("otrosImpuestos"), "money"),
  excelField("retencionIVA", "Retención de IVA", "Importes", importeOf("retencionIVA"), "money"),
  excelField("retencionISR", "Retención de ISR", "Importes", importeOf("retencionISR"), "money"),
  excelField("propina", "Propina", "Importes", importeOf("propina"), "money"),
  excelField("total", "Total del comprobante", "Importes", importeOf("total"), "money"),
  excelField("totalConLetra", "Total con letra", "Importes", importeOf("totalConLetra")),

  excelField("partidas", "Partidas", "Otros", invoiceConcepts),
  excelField("otros", "Otros datos del comprobante", "Otros", (inv) => (cfdiOf(inv).otros ?? []).map((o) => `${o.campo}: ${o.valor}`).join("; ")),
];

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const EXCEL_STYLE = { header: 1, money: 2, date: 3, datetime: 4 };

// Fecha local → número de serie de Excel (días desde 1899-12-30).
function excelSerial(d) {
  return (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()) - EXCEL_EPOCH) / DAY_MS;
}

// Una celda: número (con su formato) o texto. Vacía si no hay dato.
function excelCell(value, type) {
  if (value === undefined || value === null || value === "") return null;
  if (type === "money" || type === "number") {
    const n = Number(value);
    return Number.isFinite(n) ? { number: n, style: type === "money" ? EXCEL_STYLE.money : 0 } : { text: String(value) };
  }
  if (type === "date" && /^\d{4}-\d{2}-\d{2}/.test(value)) return { number: excelSerial(parseISODate(value)), style: EXCEL_STYLE.date };
  if (type === "datetime") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return { number: excelSerial(d), style: EXCEL_STYLE.datetime };
  }
  return { text: String(value) };
}

// Excel no acepta caracteres de control en el XML y corta las celdas en 32,767.
const xmlText = (value) =>
  String(value)
    .slice(0, 32767)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function excelColumn(index) {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const SHEET_NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';

// Los textos van como "inlineStr": Excel nunca los interpreta como fórmula,
// aunque empiecen con "=".
function excelSheetXml({ header, rows }) {
  const cellXml = (cell, ref) => {
    if (!cell) return "";
    const style = cell.style ? ` s="${cell.style}"` : "";
    if (cell.number !== undefined) return `<c r="${ref}"${style}><v>${cell.number}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xmlText(cell.text)}</t></is></c>`;
  };
  const allRows = [header.map((label) => ({ text: label, style: EXCEL_STYLE.header })), ...rows];
  const widths = header.map((_, c) =>
    Math.min(50, Math.max(10, ...allRows.map((row) => (row[c]?.text !== undefined ? String(row[c].text).length + 2 : row[c] ? 14 : 0))))
  );
  const lastRef = `${excelColumn(header.length - 1)}${allRows.length}`;
  return (
    `${XML_HEAD}<worksheet ${SHEET_NS}>` +
    `<dimension ref="A1:${lastRef}"/>` +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    `<cols>${widths.map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` +
    `<sheetData>${allRows
      .map((row, r) => `<row r="${r + 1}">${row.map((cell, c) => cellXml(cell, `${excelColumn(c)}${r + 1}`)).join("")}</row>`)
      .join("")}</sheetData>` +
    `<autoFilter ref="A1:${lastRef}"/>` +
    "</worksheet>"
  );
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Un .xlsx es un zip de archivos XML. Se arma aquí, sin comprimir, para no
// pasar los datos de las facturas por una librería externa.
function zipFiles(files, type) {
  const encoder = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = [];
  const directory = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.data);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, data);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(12, dosTime, true);
    entry.setUint16(14, dosDate, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    directory.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const directorySize = directory.reduce((s, part) => s + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...directory, new Uint8Array(end.buffer)], { type });
}

function buildXlsx(sheets, dateFormat) {
  const dateCode = dateFormat === "MM/DD/AAAA" ? "mm/dd/yyyy" : "dd/mm/yyyy";
  const rel = (id, type, target) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
  const files = [
    {
      name: "[Content_Types].xml",
      data:
        `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
        "</Types>",
    },
    {
      name: "_rels/.rels",
      data: `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel("rId1", "officeDocument", "xl/workbook.xml")}</Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      data:
        `${XML_HEAD}<workbook ${SHEET_NS} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets>${sheets.map((s, i) => `<sheet name="${xmlText(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>` +
        `<definedNames>${sheets
          .map((s, i) => `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xmlText(s.name)}'!$A$1:$${excelColumn(s.header.length - 1)}$${s.rows.length + 1}</definedName>`)
          .join("")}</definedNames>` +
        "</workbook>",
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data:
        `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        sheets.map((_, i) => rel(`rId${i + 1}`, "worksheet", `worksheets/sheet${i + 1}.xml`)).join("") +
        rel(`rId${sheets.length + 1}`, "styles", "styles.xml") +
        "</Relationships>",
    },
    {
      name: "xl/styles.xml",
      data:
        `${XML_HEAD}<styleSheet ${SHEET_NS}>` +
        `<numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="${dateCode}"/><numFmt numFmtId="166" formatCode="${dateCode} hh:mm"/></numFmts>` +
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>' +
        '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2563EB"/><bgColor indexed="64"/></patternFill></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="5">' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
        '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
        '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
        '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
        "</cellXfs>" +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
        "</styleSheet>",
    },
    ...sheets.map((sheet, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: excelSheetXml(sheet) })),
  ];
  return zipFiles(files, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

// Una fila por partida del comprobante. Para ubicar cada una se repiten los
// datos de su factura que la persona dejó incluidos.
function excelLineItemsSheet(rows, fieldIds, ctx) {
  const reference = EXCEL_FIELDS.filter((f) => ["date", "vendor", "folio", "uuid"].includes(f.id) && fieldIds.includes(f.id));
  const taxText = (tax) =>
    [tax.tipo, tax.tasa !== undefined ? `${+(Number(tax.tasa) * 100).toFixed(4)}%` : null, tax.importe !== undefined ? formatMoney(tax.importe, ctx.currency) : null]
      .filter(Boolean)
      .join(" ");
  const lineColumns = [
    ["Cantidad", (l) => l.cantidad, "number"],
    ["Unidad", (l) => l.unidad],
    ["Clave SAT", (l) => l.claveProdServ],
    ["Descripción", (l) => l.descripcion],
    ["Valor unitario", (l) => l.valorUnitario, "money"],
    ["Importe", (l) => l.importe, "money"],
    ["Impuestos", (l) => (l.impuestos ?? []).map(taxText).join(", ")],
  ];
  return {
    name: "Partidas",
    header: [...reference.map((f) => f.label), ...lineColumns.map(([label]) => label)],
    rows: rows.flatMap((inv) =>
      (cfdiOf(inv).conceptos ?? []).map((line) => [
        ...reference.map((f) => excelCell(f.get(inv, ctx), f.type)),
        ...lineColumns.map(([, get, type]) => excelCell(get(line), type)),
      ])
    ),
  };
}

const EXCEL_PERIODS = [{ id: "all", label: "Todas las fechas" }, ...SUMMARY_PERIODS.filter((p) => p.id !== "all"), { id: "custom", label: "Elegir fechas" }];
const DEFAULT_EXCEL = { excluded: [], period: "all", from: "", to: "", includeClosed: false, lineItems: true };

function ExcelExportModal({ invoices, sectionLabel, currency, onClose }) {
  const { format } = useDateFormat();
  // Lo que se quita se recuerda en este navegador; un dato nuevo entra marcado.
  const [saved, setSaved] = usePersistentState("navio.invoices.excel.v1", DEFAULT_EXCEL);
  const options = { ...DEFAULT_EXCEL, ...saved };
  const set = (patch) => setSaved((prev) => ({ ...DEFAULT_EXCEL, ...prev, ...patch }));
  const period = options.period === "custom" ? { from: options.from, to: options.to } : options.period;
  const badRange = options.period === "custom" && options.from && options.to && options.from > options.to;
  const rows = invoices
    .filter((i) => inSummaryPeriod(i, period) && (options.includeClosed || !isInvoiceClosed(i)))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const fields = EXCEL_FIELDS.filter((f) => !options.excluded.includes(f.id));
  const groups = [...new Set(EXCEL_FIELDS.map((f) => f.group))];
  const lineCount = rows.reduce((s, i) => s + (cfdiOf(i).conceptos?.length ?? 0), 0);
  const canDownload = rows.length > 0 && fields.length > 0 && !badRange;
  const inputClass = "rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs focus:border-blue-400 focus:outline-none";
  const labelClass = "mb-1 block text-[11px] font-semibold text-slate-500";

  function toggleField(id) {
    set({ excluded: options.excluded.includes(id) ? options.excluded.filter((x) => x !== id) : [...options.excluded, id] });
  }
  function setGroup(group, on) {
    const ids = EXCEL_FIELDS.filter((f) => f.group === group).map((f) => f.id);
    set({ excluded: on ? options.excluded.filter((id) => !ids.includes(id)) : [...new Set([...options.excluded, ...ids])] });
  }

  function download() {
    const ctx = { currency };
    const sheets = [{ name: "Facturas", header: fields.map((f) => f.label), rows: rows.map((inv) => fields.map((f) => excelCell(f.get(inv, ctx), f.type))) }];
    if (options.lineItems && lineCount > 0) sheets.push(excelLineItemsSheet(rows, fields.map((f) => f.id), ctx));
    const url = URL.createObjectURL(buildXlsx(sheets, format));
    const link = document.createElement("a");
    link.href = url;
    link.download = `Facturas - ${sectionLabel} - ${localISODate()}.xlsx`.replace(/[\\/:*?"<>|]+/g, "-");
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    onClose();
  }

  return (
    <Modal title="Descargar Excel" width="max-w-3xl" onClose={onClose}>
      <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
        <p className="text-xs text-slate-500">
          Facturas de: <b className="text-slate-700">{sectionLabel}</b>. Cada factura es una fila y cada dato marcado, una columna.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className={labelClass}>Periodo</label>
            <select value={options.period} onChange={(e) => set({ period: e.target.value })} className={`w-full ${inputClass}`}>
              {EXCEL_PERIODS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          {options.period === "custom" && (
            <>
              <div>
                <label className={labelClass}>Desde</label>
                <input type="date" value={options.from} onChange={(e) => set({ from: e.target.value })} className={`w-full ${inputClass}`} />
              </div>
              <div>
                <label className={labelClass}>Hasta</label>
                <input type="date" value={options.to} onChange={(e) => set({ to: e.target.value })} className={`w-full ${inputClass}`} />
              </div>
            </>
          )}
        </div>
        {badRange && <p className="text-[11px] font-medium text-rose-600">La fecha "Desde" va después de "Hasta".</p>}
        <div className="space-y-1.5">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-600">
            <input type="checkbox" checked={options.includeClosed} onChange={(e) => set({ includeClosed: e.target.checked })} className="h-4 w-4 accent-blue-600" />
            Incluir facturas rechazadas y anuladas
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-600">
            <input type="checkbox" checked={options.lineItems} onChange={(e) => set({ lineItems: e.target.checked })} className="h-4 w-4 accent-blue-600" />
            Agregar una hoja con las partidas de cada factura ({countLabel(lineCount, "partida")})
          </label>
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] font-semibold text-slate-500">Datos a incluir (desmarca los que no quieras en el Excel)</p>
            <div className="flex gap-3 text-[11px] font-semibold text-blue-600">
              <button onClick={() => set({ excluded: [] })}>Todos</button>
              <button onClick={() => set({ excluded: EXCEL_FIELDS.map((f) => f.id) })}>Ninguno</button>
            </div>
          </div>
          <div className="space-y-3">
            {groups.map((group) => {
              const groupFields = EXCEL_FIELDS.filter((f) => f.group === group);
              const allOn = groupFields.every((f) => !options.excluded.includes(f.id));
              return (
                <div key={group}>
                  <label className="mb-1.5 flex cursor-pointer items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    <input type="checkbox" checked={allOn} onChange={() => setGroup(group, !allOn)} className="h-3.5 w-3.5 accent-blue-600" />
                    {group}
                  </label>
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                    {groupFields.map((f) => (
                      <label key={f.id} className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-slate-100 px-2.5 py-1.5 hover:bg-slate-50">
                        <span className="text-xs font-medium text-slate-600">{f.label}</span>
                        <input type="checkbox" checked={!options.excluded.includes(f.id)} onChange={() => toggleField(f.id)} className="h-4 w-4 shrink-0 accent-blue-600" />
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-slate-400">
          {countLabel(rows.length, "factura")} · {countLabel(fields.length, "columna")}
        </p>
        <div className="flex gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">
            Cancelar
          </button>
          <button
            onClick={download}
            disabled={!canDownload}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Download size={13} /> Descargar Excel
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ProjectCard({ project, period, currency, onOpen }) {
  const rows = project.invoices.filter((i) => !isInvoiceClosed(i) && inSummaryPeriod(i, period));
  const toVerify = rows.filter((i) => i.status === "pending").length;
  const toApprove = rows.filter((i) => i.status === "verified" && !i.approved).length;
  const openOrders = project.orders.filter((o) => !o.complete).length;
  return (
    <button onClick={() => onOpen(project.name)} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-300 hover:bg-blue-50/40">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-bold text-slate-800" title={project.name}>
          {project.name || "Sin proyecto"}
        </span>
        {project.closed && <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">Cerrado</span>}
      </div>
      <p className="mt-2 text-lg font-bold text-slate-800">{formatCurrency(sumOf(rows, amountOf), currency)}</p>
      <p className="text-[11px] text-slate-400">
        {countLabel(rows.length, "factura")} · {summaryPeriod(period).phrase}
      </p>
      <p className="mt-2 text-[11px] text-slate-500">
        {toVerify} sin verificar · {toApprove} por aprobar · {countLabel(openOrders, "orden abierta", "órdenes abiertas")}
      </p>
    </button>
  );
}

function PillTabs({ tabs, active, onSelect }) {
  return (
    <div className="flex flex-wrap gap-2">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onSelect(tab.id)}
          className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
            active === tab.id ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function InvoiceBreadcrumb({ items }) {
  return (
    <nav aria-label="Ubicación" className="flex flex-wrap items-center gap-1 text-xs font-semibold text-slate-400">
      {items.map((item, index) => (
        <React.Fragment key={index}>
          {index > 0 && <ChevronRight size={13} />}
          {item.onClick ? (
            <button onClick={item.onClick} className="text-blue-600 hover:text-blue-700">
              {item.label}
            </button>
          ) : (
            <span className="text-slate-600">{item.label}</span>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}

function InvoiceOverview({
  invoices,
  orders,
  deadlineDays,
  currency,
  userName,
  isAdmin,
  reminders,
  columnIds,
  tableTools,
  showVoided,
  period,
  onPeriodChange,
  widgetPrefs,
  onWidgetPrefsChange,
  onOpenProject,
  onDetail,
  onEditInvoice,
  onConfirmInvoice,
  onDecideInvoice,
  onSaveDeadlines,
}) {
  const [settings, setSettings] = usePersistentState("navio.invoices.desglose.v1", {
    days: 7,
    concepts: EXPENSE_TYPES.map((t) => t.id),
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deadlinesOpen, setDeadlinesOpen] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [ordersPeriod, setOrdersPeriod] = useState("week");
  const [explore, setExplore] = useState(null);
  const [reminderDraft, setReminderDraft] = useState("");

  const tableActions = {
    columnIds,
    currency,
    isAdmin,
    onDetail,
    onEdit: onEditInvoice,
    onConfirm: onConfirmInvoice,
    onDecide: onDecideInvoice,
  };

  const now = new Date();
  const countable = invoices.filter((i) => !isInvoiceClosed(i));
  const periodInvoices = countable.filter((i) => inSummaryPeriod(i, period));
  const periodPhrase = summaryPeriod(period).phrase;
  const generalEntries = widgetEntries(widgetPrefs.general, SUMMARY_CATALOGS.general);

  const ordersMissingDocs = orders.filter((o) => o.missingDocs);
  const unverifiedCount = invoices.filter((i) => i.status === "pending").length;
  const completedOrders = orders.filter((o) => o.complete);
  const expiringOrders = orders
    .filter((o) => !o.complete && o.daysLeft !== null && o.daysLeft >= 0 && o.daysLeft <= ORDER_WARN_DAYS)
    .sort((a, b) => a.daysLeft - b.daysLeft);
  const overdueOrders = orders.filter((o) => !o.complete && o.daysLeft !== null && o.daysLeft < 0);
  const pendingApprovalCount = invoices.filter((i) => i.status === "verified" && !i.approved).length;

  const periodStart =
    ordersPeriod === "day"
      ? startOfLocalDay(now).getTime()
      : ordersPeriod === "week"
      ? startOfLocalDay(now).getTime() - 6 * DAY_MS
      : new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const newOrdersCount = orders.filter((o) => o.createdAt && new Date(o.createdAt).getTime() >= periodStart).length;
  const periodLabel = { day: "hoy", week: "últimos 7 días", month: "este mes" }[ordersPeriod];

  // Las anuladas se ocultan de listas y exploración, salvo que se pidan.
  const listed = showVoided ? invoices : invoices.filter((i) => i.status !== "voided");

  const latest = invoices
    .filter((i) => i.createdAt && i.status !== "voided")
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 4);

  const since = startOfLocalDay(now).getTime() - (settings.days - 1) * DAY_MS;
  const desgloseRows = listed
    .filter((i) => i.createdAt && new Date(i.createdAt).getTime() >= since && settings.concepts.includes(i.expenseType))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const desgloseWindow = settings.days === 1 ? "hoy" : `los últimos ${settings.days} días`;

  function groupInvoices(keyFn) {
    const map = new Map();
    for (const i of listed) {
      const k = keyFn(i);
      const g = map.get(k) ?? { value: k, count: 0, total: 0 };
      g.count += 1;
      g.total += i.amount;
      map.set(k, g);
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }
  const byConcept = EXPENSE_TYPES.map((t) => {
    const rs = listed.filter((i) => i.expenseType === t.id);
    return { value: t.id, label: t.label, count: rs.length, total: rs.reduce((s, i) => s + i.amount, 0) };
  });
  const byProject = groupInvoices((i) => i.project);
  const byUser = groupInvoices((i) => i.uploadedByName);

  const generalCards = {
    totalSpend: (
      <OverviewCard icon={DollarSign} tone="blue" label="Gasto total">
        <p className="mt-3 text-2xl font-bold text-slate-800">{formatCurrency(sumOf(periodInvoices, amountOf), currency)}</p>
        <p className="text-[11px] text-slate-400">
          {countLabel(periodInvoices.length, "factura")} {periodPhrase}
        </p>
        <SparkBars values={summaryTrend(periodInvoices, period, amountOf)} />
      </OverviewCard>
    ),
    liters: (
      <OverviewCard icon={Droplet} tone="sky" label="Litros consumidos">
        <p className="mt-3 text-2xl font-bold text-slate-800">{sumOf(periodInvoices, (i) => i.liters).toLocaleString()} L</p>
        <p className="text-[11px] text-slate-400">Cargas de combustible {periodPhrase}</p>
        <SparkBars values={summaryTrend(periodInvoices, period, (i) => i.liters)} barClass="bg-sky-500" />
      </OverviewCard>
    ),
    ordersMissingDocs: (
      <OverviewCard icon={FileText} tone="amber" label="Órdenes sin documentación completa">
        <p className="mt-3 text-3xl font-bold text-slate-800">{ordersMissingDocs.length}</p>
        <p className="text-[11px] text-slate-400">Les falta un documento o el monto</p>
      </OverviewCard>
    ),
    unverified: (
      <OverviewCard icon={AlertTriangle} tone="rose" label="Servicios sin verificar">
        <p className="mt-3 text-3xl font-bold text-slate-800">{unverifiedCount}</p>
        <p className="text-[11px] text-slate-400">Facturas pendientes de validación</p>
      </OverviewCard>
    ),
    newOrders: (
      <OverviewCard
        icon={Plus}
        tone="emerald"
        label="Nuevas órdenes de trabajo"
        right={
          <div className="flex items-center rounded-lg border border-slate-200 p-0.5 text-[10px] font-semibold">
            {[
              ["day", "Día"],
              ["week", "Semana"],
              ["month", "Mes"],
            ].map(([id, label]) => (
              <button
                key={id}
                onClick={() => setOrdersPeriod(id)}
                className={`rounded-md px-1.5 py-0.5 transition ${ordersPeriod === id ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}
              >
                {label}
              </button>
            ))}
          </div>
        }
      >
        <p className="mt-3 text-3xl font-bold text-slate-800">{newOrdersCount}</p>
        <p className="text-[11px] text-slate-400">Creadas {periodLabel}</p>
      </OverviewCard>
    ),
    completedOrders: (
      <OverviewCard icon={CheckCircle2} tone="emerald" label="Órdenes completadas">
        <p className="mt-3 text-3xl font-bold text-slate-800">{completedOrders.length}</p>
        <p className="text-[11px] text-slate-400">Con documentos y todo verificado</p>
      </OverviewCard>
    ),
    expiring: (
      <OverviewCard
        icon={Clock}
        tone="amber"
        label="Próximas a expirar"
        className="sm:col-span-2"
        right={
          <button
            onClick={() => setDeadlinesOpen(true)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"
            aria-label="Plazos por concepto"
            title="Plazos por concepto"
          >
            <Settings size={14} />
          </button>
        }
      >
        <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-2">
          <div>
            <p className="text-3xl font-bold text-slate-800">{expiringOrders.length}</p>
            <p className="text-[11px] text-slate-400">Vencen en {ORDER_WARN_DAYS} días o menos</p>
          </div>
          <div>
            <p className={`text-xl font-bold ${overdueOrders.length > 0 ? "text-rose-600" : "text-slate-800"}`}>{overdueOrders.length}</p>
            <p className="text-[11px] text-slate-400">Ya vencidas</p>
          </div>
        </div>
        {expiringOrders.length > 0 && (
          <div className="mt-3 space-y-1">
            {expiringOrders.slice(0, 3).map((o) => (
              <p key={o.key} className="text-[11px] text-slate-500">
                <b className="text-slate-700">{o.code}</b>
                {o.project ? ` · ${o.project}` : ""} — {o.daysLeft === 0 ? "vence hoy" : `vence en ${o.daysLeft} día${o.daysLeft === 1 ? "" : "s"}`}
              </p>
            ))}
          </div>
        )}
      </OverviewCard>
    ),
    pendingApproval: (
      <OverviewCard icon={ShieldCheck} tone="blue" label="Pendientes de aprobación">
        <p className="mt-3 text-3xl font-bold text-slate-800">{pendingApprovalCount}</p>
        <p className="text-[11px] text-slate-400">Verificadas, listas para aprobar</p>
      </OverviewCard>
    ),
  };

  function addReminder(e) {
    e.preventDefault();
    const text = reminderDraft.trim();
    if (!text) return;
    setReminderDraft("");
    reminders.insertRow({ text }).catch(() => setReminderDraft(text));
  }
  const reminderRows = [...reminders.rows].sort((a, b) => Number(a.done) - Number(b.done) || b.id - a.id);
  const firstName = (userName || "").split(" ")[0] || "equipo";

  if (explore) {
    const rows = listed
      .filter((i) => (explore.kind === "concept" ? i.expenseType === explore.value : i.uploadedByName === explore.value))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const total = rows.reduce((s, i) => s + i.amount, 0);
    const title =
      explore.kind === "concept"
        ? `Concepto: ${expenseTypeLabel(explore.value)}`
        : `Usuario: ${explore.value || "Sin identificar"}`;
    return (
      <div className="space-y-4">
        <button onClick={() => setExplore(null)} className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700">
          <ArrowLeft size={13} /> Volver al resumen
        </button>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-900">{title}</h2>
            <p className="text-xs text-slate-500">
              {rows.length} registro{rows.length === 1 ? "" : "s"} · {formatMoney(total, currency)}
            </p>
          </div>
          {tableTools}
        </div>
        <InvoiceDesgloseTable rows={rows} emptyLabel="No hay registros con este filtro." {...tableActions} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-800">Resumen general</h2>
        <SummaryControls period={period} onPeriodChange={onPeriodChange} onCustomize={() => setCustomizing(true)} />
      </div>
      {periodInvoices.length === 0 && <PeriodEmptyNote total={countable.length} period={period} onShowAll={() => onPeriodChange("all")} />}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="order-first flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm xl:order-none xl:col-start-3 xl:row-span-3 xl:row-start-1">
          <div>
            <h2 className="text-sm font-bold text-slate-800">Hola, {firstName}</h2>
            <p className="text-[11px] text-slate-400">Cambios y facturas nuevas</p>
            <div className="mt-2.5 space-y-2">
              {latest.length === 0 && <p className="text-xs text-slate-400">Todavía no hay facturas cargadas.</p>}
              {latest.map((i) => (
                <div key={i.key} className="rounded-xl bg-slate-50 px-2.5 py-2">
                  <p className="text-xs font-semibold text-slate-700">
                    {expenseTypeLabel(i.expenseType)} · {formatMoney(i.amount, currency)}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {i.uploadedByName || "Sin identificar"} · {timeAgoLabel(i.createdAt)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col border-t border-slate-100 pt-3">
            <h3 className="text-sm font-bold text-slate-800">Recordatorios</h3>
            <form onSubmit={addReminder} className="mt-2 flex gap-1.5">
              <input
                value={reminderDraft}
                onChange={(e) => setReminderDraft(e.target.value)}
                placeholder="Escribe una tarea y presiona Enter"
                className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-blue-400 focus:outline-none"
              />
              <button type="submit" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white hover:bg-blue-700" aria-label="Agregar">
                <Plus size={14} />
              </button>
            </form>
            <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
              {reminderRows.length === 0 && <p className="py-2 text-[11px] text-slate-400">Sin recordatorios. Anota aquí lo que no quieres olvidar.</p>}
              {reminderRows.map((r) => (
                <div key={r.id} className="flex items-start gap-2 rounded-lg px-1 py-1 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={r.done}
                    onChange={() => reminders.updateRow(r.id, { done: !r.done })}
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-blue-600"
                  />
                  <span className={`min-w-0 flex-1 break-words text-xs ${r.done ? "text-slate-300 line-through" : "text-slate-600"}`}>{r.text}</span>
                  <button onClick={() => reminders.removeRow(r.id)} className="shrink-0 text-slate-300 hover:text-rose-500" aria-label="Eliminar recordatorio">
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {generalEntries.map(({ id }) => (
          <React.Fragment key={id}>{generalCards[id]}</React.Fragment>
        ))}
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-slate-800">Desglose</h2>
            <p className="text-[11px] text-slate-400">
              Lo subido {desgloseWindow} · {settings.concepts.length} de {EXPENSE_TYPES.length} conceptos
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {tableTools}
            <button
              onClick={() => setSettingsOpen(true)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
              aria-label="Configurar desglose"
              title="Configurar desglose"
            >
              <Settings size={14} />
            </button>
          </div>
        </div>
        <InvoiceDesgloseTable rows={desgloseRows} emptyLabel="No hay facturas subidas en este periodo. Ajusta los días o conceptos con la ruedita." {...tableActions} />
      </div>

      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <h2 className="text-sm font-bold text-slate-800">Explorar registros</h2>
          <p className="text-[11px] text-slate-400">Entra para ver todos los registros de un concepto, proyecto o usuario.</p>
        </div>

        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Por concepto</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {byConcept.map((c) => (
              <button
                key={c.value}
                onClick={() => setExplore({ kind: "concept", value: c.value })}
                className={`rounded-xl border px-3 py-2.5 text-left transition hover:border-blue-300 hover:bg-blue-50/40 ${
                  c.count === 0 ? "border-slate-100 opacity-60" : "border-slate-200"
                }`}
              >
                <p className="text-xs font-semibold text-slate-700">{c.label}</p>
                <p className="text-[11px] text-slate-400">
                  {c.count} · {formatCurrency(c.total, currency)}
                </p>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Por proyecto</p>
            <div className="flex flex-wrap gap-1.5">
              {byProject.length === 0 && <p className="text-[11px] text-slate-400">Aún no hay facturas.</p>}
              {byProject.map((g) => (
                <button
                  key={`p-${g.value}`}
                  onClick={() => onOpenProject(g.value)}
                  className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-blue-300 hover:bg-blue-50/40"
                >
                  {g.value || "Sin proyecto"} <b className="text-slate-400">{g.count}</b>
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Por usuario</p>
            <div className="flex flex-wrap gap-1.5">
              {byUser.length === 0 && <p className="text-[11px] text-slate-400">Aún no hay facturas.</p>}
              {byUser.map((g) => (
                <button
                  key={`u-${g.value}`}
                  onClick={() => setExplore({ kind: "user", value: g.value })}
                  className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-blue-300 hover:bg-blue-50/40"
                >
                  {g.value || "Sin identificar"} <b className="text-slate-400">{g.count}</b>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {settingsOpen && <DesgloseSettingsModal settings={settings} onChange={setSettings} onClose={() => setSettingsOpen(false)} />}
      {deadlinesOpen && <DeadlinesModal days={deadlineDays} isAdmin={isAdmin} onSave={onSaveDeadlines} onClose={() => setDeadlinesOpen(false)} />}
      {customizing && (
        <SummaryWidgetsModal
          widgets={SUMMARY_CATALOGS.general.widgets}
          entries={generalEntries}
          defaults={widgetEntries(undefined, SUMMARY_CATALOGS.general)}
          onChange={(entries) => onWidgetPrefsChange({ ...widgetPrefs, general: entries })}
          onClose={() => setCustomizing(false)}
        />
      )}
    </div>
  );
}

// Dónde está la persona dentro de Facturas y Gastos: el resumen general, o
// Proyectos → un proyecto → un concepto. "report" muestra el reporte armado.
const INVOICE_NAV_START = { inProjects: false, project: null, concept: "overview", report: false };
const INVOICE_NAV_PROJECTS = { inProjects: true, project: null, concept: "overview", report: false };
const PROJECT_SCOPES = [
  { id: "active", label: "Activos" },
  { id: "all", label: "Totales" },
];

function FuelPage({
  invoices,
  orders,
  projects,
  deadlineDays,
  reminders,
  isAdmin,
  userName,
  nav,
  onNavChange,
  onAddInvoice,
  onEditInvoice,
  onConfirmInvoice,
  onDecideInvoice,
  onSaveDeadlines,
  onSetProjectClosed,
}) {
  const { profile } = useAuth();
  const currency = profile?.company?.currency || "MXN";
  const [columnPrefs, setColumnPrefs] = usePersistentState("navio.invoices.columns.v1", {});
  const [widgetPrefs, setWidgetPrefs] = usePersistentState("navio.invoices.widgets.v1", {});
  // Un concepto se revisa mes a mes; un proyecto se mide completo.
  const [periods, setPeriods] = usePersistentState("navio.invoices.periods.v1", { general: "month", projects: "all" });
  const [projectScope, setProjectScope] = usePersistentState("navio.invoices.projectScope.v1", "active");
  const [chartGroup, setChartGroup] = usePersistentState("navio.invoices.chartGroup.v1", "auto");
  const [savedReport, setSavedReport] = usePersistentState("navio.invoices.report.v1", DEFAULT_REPORT);
  const [reportDraft, setReportDraft] = useState(null);
  const [excelOpen, setExcelOpen] = useState(false);
  const [columnPickerView, setColumnPickerView] = useState(null);
  const [detailKey, setDetailKey] = useState(null);
  const detailInvoice = invoices.find((i) => i.key === detailKey) ?? null;
  // Aprobar, rechazar, anular y revertir siempre se piden confirmar.
  const [invoiceDecision, setInvoiceDecision] = useState(null);
  const askDecision = (type, inv) => setInvoiceDecision({ type, inv });
  const [showVoided, setShowVoided] = usePersistentState("navio.invoices.showVoided", false);

  const { inProjects, project: projectName, concept } = nav;
  const namedProjects = projects.filter((p) => p.name);
  const activeProjects = namedProjects.filter((p) => !p.closed);
  const scopedProjects = projectScope === "active" ? activeProjects : namedProjects;
  const looseInvoices = projects.find((p) => !p.name) ?? null;
  const currentProject = projectName === null ? null : projects.find((p) => p.name === projectName) ?? { name: projectName, closed: false, invoices: [], orders: [] };
  const scopeInvoices = !inProjects ? invoices : currentProject ? currentProject.invoices : scopedProjects.flatMap((p) => p.invoices);
  const scopeOrders = !inProjects ? orders : currentProject ? currentProject.orders : scopedProjects.flatMap((p) => p.orders);
  const conceptInvoices = concept === "overview" ? scopeInvoices : scopeInvoices.filter((i) => inConcept(i, concept));

  const periodKey = inProjects ? "projects" : "general";
  const period = periods[periodKey] ?? "month";
  const setPeriod = (id) => setPeriods((prev) => ({ ...prev, [periodKey]: id }));
  const openProject = (name) => onNavChange({ ...INVOICE_NAV_PROJECTS, project: name });
  const conceptLabel = (id) => CONCEPT_CATEGORIES.find((c) => c.id === id)?.label ?? "";
  // El reporte arranca con el alcance de la pantalla donde se pidió.
  const currentScopeId = currentProject
    ? currentProject.name
      ? `project:${currentProject.name}`
      : "loose"
    : inProjects
    ? projectScope === "active"
      ? "projects-active"
      : "projects-all"
    : "all";
  const openReportBuilder = () => setReportDraft({ ...DEFAULT_REPORT, ...savedReport, scope: nav.report ? savedReport.scope : currentScopeId });

  const view = concept !== "overview" ? concept : inProjects ? "project" : "overview";
  // Dentro de un proyecto no hace falta repetir de qué proyecto es cada factura.
  const columnsFor = (id) => (columnPrefs[id] ?? DEFAULT_INVOICE_COLUMNS[id]).filter((c) => !currentProject || c !== "project");
  const handleDetail = (inv) => setDetailKey(inv.key);
  const tableProps = {
    currency,
    isAdmin,
    onDetail: handleDetail,
    onEdit: onEditInvoice,
    onConfirm: onConfirmInvoice,
    onDecide: askDecision,
  };

  // Cada pestaña de concepto es una vista filtrada de las mismas facturas.
  const voidedCount = conceptInvoices.filter((i) => i.status === "voided").length;
  const categoryRows = conceptInvoices.filter((i) => showVoided || i.status !== "voided");
  const tableTools = (
    <InvoiceTableTools
      showVoided={showVoided}
      voidedCount={voidedCount}
      onToggleVoided={setShowVoided}
      onOpenColumns={() => setColumnPickerView(view)}
      onExport={() => setExcelOpen(true)}
    />
  );
  // Lo que cubre el Excel: la sección donde está la persona.
  const excelSection = [
    !inProjects ? "Todas las facturas" : currentProject ? currentProject.name || "Sin proyecto" : projectScope === "active" ? "Proyectos activos" : "Todos los proyectos",
    concept !== "overview" ? conceptLabel(concept) : null,
  ]
    .filter(Boolean)
    .join(" - ");
  const emptyLabel = currentProject
    ? concept === "overview"
      ? "Este proyecto todavía no tiene facturas."
      : `Este proyecto no tiene registros de ${conceptLabel(concept).toLowerCase()}.`
    : concept === "fuel"
    ? "Sin cargas de combustible registradas."
    : concept === "travel"
    ? "Sin viáticos registrados todavía."
    : `Sin registros de ${conceptLabel(concept).toLowerCase()} todavía.`;

  const summaryProps = { currency, period, onPeriodChange: setPeriod, group: chartGroup, onGroupChange: setChartGroup, widgetPrefs, onWidgetPrefsChange: setWidgetPrefs };
  const conceptProps = { period, group: chartGroup, currency, widgetPrefs, onWidgetPrefsChange: setWidgetPrefs, onOpen: (id) => onNavChange({ ...nav, concept: id }) };
  const reportBuilder = reportDraft && (
    <ReportBuilderModal
      initial={reportDraft}
      projects={projects}
      onGenerate={(report) => {
        setSavedReport(report);
        setReportDraft(null);
        onNavChange({ ...nav, report: true });
      }}
      onClose={() => setReportDraft(null)}
    />
  );

  if (nav.report) {
    return (
      <div className="space-y-5">
        <div className="print:hidden">
          <InvoiceBreadcrumb items={[{ label: "Facturas y Gastos", onClick: () => onNavChange({ ...nav, report: false }) }, { label: "Reporte" }]} />
        </div>
        <InvoiceReport
          report={{ ...DEFAULT_REPORT, scope: "all", ...savedReport }}
          invoices={invoices}
          orders={orders}
          projects={projects}
          currency={currency}
          userName={userName}
          onEdit={openReportBuilder}
          onBack={() => onNavChange({ ...nav, report: false })}
        />
        {reportBuilder}
      </div>
    );
  }
  const invoiceTable = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-slate-800">Facturas</h2>
          <p className="text-[11px] text-slate-400">{countLabel(categoryRows.length, "registro")} de todas las fechas</p>
        </div>
        {tableTools}
      </div>
      <InvoiceDesgloseTable rows={categoryRows} columnIds={columnsFor(view)} emptyLabel={emptyLabel} {...tableProps} />
    </div>
  );

  const projectLabel = currentProject ? currentProject.name || "Sin proyecto" : "";
  const breadcrumb = inProjects && [
    { label: "Facturas y Gastos", onClick: () => onNavChange(INVOICE_NAV_START) },
    currentProject || concept !== "overview" ? { label: "Proyectos", onClick: () => onNavChange(INVOICE_NAV_PROJECTS) } : { label: "Proyectos" },
    ...(currentProject ? [concept !== "overview" ? { label: projectLabel, onClick: () => openProject(currentProject.name) } : { label: projectLabel }] : []),
    ...(concept !== "overview" ? [{ label: conceptLabel(concept) }] : []),
  ];

  return (
    <div className="space-y-5">
      {breadcrumb && <InvoiceBreadcrumb items={breadcrumb} />}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="min-w-0 break-words text-xl font-bold text-slate-900">{!inProjects ? "Facturas y Gastos" : projectLabel || "Proyectos"}</h1>
            {currentProject?.name && (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${currentProject.closed ? "bg-slate-100 text-slate-500" : "bg-emerald-50 text-emerald-700"}`}>
                {currentProject.closed ? "Cerrado" : "Activo"}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {!inProjects
              ? "Integra consumo de combustible, consumibles, refrigerante, refacciones y casetas de la flotilla."
              : currentProject
              ? "Todas las facturas de este proyecto y su resumen por concepto."
              : "Resumen de todos los conceptos de tus proyectos."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && currentProject?.name && (
            <button
              onClick={() => onSetProjectClosed(currentProject.name, !currentProject.closed)}
              title="Solo cambia si aparece en la vista de proyectos activos. Sus facturas no se modifican."
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              {currentProject.closed ? "Reabrir proyecto" : "Cerrar proyecto"}
            </button>
          )}
          <button
            onClick={openReportBuilder}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            <BarChart3 size={14} /> Crear reporte
          </button>
          <button
            onClick={() => onAddInvoice(INVOICE_CATEGORY_TYPE[concept], currentProject?.name ?? "")}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
          >
            <Plus size={15} /> Cargar Factura
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Los conceptos se ven dentro de Proyectos; el resumen general no los separa. */}
        {inProjects ? (
          <PillTabs
            tabs={[{ id: "overview", label: currentProject ? "Resumen del proyecto" : "Resumen de proyectos" }, ...CONCEPT_CATEGORIES]}
            active={concept}
            onSelect={(id) => onNavChange({ ...nav, concept: id })}
          />
        ) : (
          <PillTabs
            tabs={[INVOICE_CATEGORIES[0], { id: "projects", label: "Proyectos" }]}
            active={concept}
            onSelect={(id) => onNavChange(id === "projects" ? INVOICE_NAV_PROJECTS : INVOICE_NAV_START)}
          />
        )}
        {inProjects && !currentProject && (
          <SegmentedControl
            label="Proyectos a incluir"
            options={PROJECT_SCOPES.map((scope) => ({ ...scope, label: `${scope.label} (${scope.id === "active" ? activeProjects.length : namedProjects.length})` }))}
            value={projectScope}
            onChange={setProjectScope}
          />
        )}
      </div>

      {view === "overview" && (
        <InvoiceOverview
          invoices={invoices}
          orders={orders}
          deadlineDays={deadlineDays}
          currency={currency}
          userName={userName}
          isAdmin={isAdmin}
          reminders={reminders}
          columnIds={columnsFor("overview")}
          tableTools={tableTools}
          showVoided={showVoided}
          period={period}
          onPeriodChange={setPeriod}
          widgetPrefs={widgetPrefs}
          onWidgetPrefsChange={setWidgetPrefs}
          onOpenProject={openProject}
          onDetail={handleDetail}
          onEditInvoice={onEditInvoice}
          onConfirmInvoice={onConfirmInvoice}
          onDecideInvoice={askDecision}
          onSaveDeadlines={onSaveDeadlines}
        />
      )}

      {view === "project" && !currentProject && (
        <>
          <InvoiceSummary catalogId="projects" invoices={scopeInvoices} orders={scopeOrders} projects={scopedProjects} {...summaryProps} />
          <ConceptBreakdown invoices={scopeInvoices} {...conceptProps} />
          <div className="space-y-3">
            <h2 className="text-sm font-bold text-slate-800">Proyectos</h2>
            {scopedProjects.length === 0 && (
              <p className="rounded-2xl border border-slate-200 bg-white px-4 py-8 text-center text-xs text-slate-400">
                {namedProjects.length > 0 ? 'No hay proyectos activos. Elige "Totales" para ver los cerrados.' : "Todavía no hay proyectos. Aparecen aquí al cargar una factura con proyecto."}
              </p>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {scopedProjects.map((p) => (
                <ProjectCard key={p.name} project={p} period={period} currency={currency} onOpen={openProject} />
              ))}
            </div>
            {looseInvoices && (
              <button
                onClick={() => openProject("")}
                className="flex w-full flex-wrap items-center justify-between gap-2 rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3 text-left text-xs font-medium text-slate-500 transition hover:border-blue-300 hover:bg-blue-50/40"
              >
                <span>Facturas sin proyecto: no cuentan en este resumen. Edítalas para asignarles uno.</span>
                <span className="font-semibold text-slate-700">{countLabel(looseInvoices.invoices.length, "factura")}</span>
              </button>
            )}
          </div>
        </>
      )}

      {view === "project" && currentProject && (
        <>
          <InvoiceSummary catalogId="project" invoices={scopeInvoices} orders={scopeOrders} {...summaryProps} />
          <ConceptBreakdown invoices={scopeInvoices} {...conceptProps} />
          {invoiceTable}
        </>
      )}

      {concept !== "overview" && (
        <>
          <InvoiceSummary catalogId={concept} invoices={conceptInvoices} {...summaryProps} />
          {invoiceTable}
        </>
      )}

      {reportBuilder}
      {excelOpen && <ExcelExportModal invoices={conceptInvoices} sectionLabel={excelSection} currency={currency} onClose={() => setExcelOpen(false)} />}
      {columnPickerView && (
        <ColumnPickerModal
          view={columnPickerView}
          selected={columnPrefs[columnPickerView] ?? DEFAULT_INVOICE_COLUMNS[columnPickerView]}
          defaults={DEFAULT_INVOICE_COLUMNS[columnPickerView]}
          onChange={(ids) => setColumnPrefs((prev) => ({ ...prev, [columnPickerView]: ids }))}
          onClose={() => setColumnPickerView(null)}
        />
      )}
      {detailInvoice && (
        <InvoiceDetailModal
          invoice={detailInvoice}
          currency={currency}
          onEdit={(inv) => {
            setDetailKey(null);
            onEditInvoice(inv);
          }}
          onClose={() => setDetailKey(null)}
        />
      )}
      {invoiceDecision && (
        <InvoiceDecisionModal
          decision={invoiceDecision}
          currency={currency}
          onSubmit={async (reason) => {
            await onDecideInvoice(invoiceDecision.type, invoiceDecision.inv, reason);
            setInvoiceDecision(null);
          }}
          onClose={() => setInvoiceDecision(null)}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Sidebar                                                                */
/* ---------------------------------------------------------------------- */

const NAV_ITEMS = [
  { id: "home", label: "Inicio", icon: Home },
  { id: "map", label: "Mapa en vivo", icon: MapPin },
  { id: "fleet", label: "Gestión de flota", icon: Truck },
  { id: "transfers", label: "Traslados", icon: Navigation },
  { id: "fuel", label: "Facturas y Gastos", icon: Receipt },
  {
    id: "maintenance",
    label: "Mantenimiento",
    icon: Wrench,
    children: [
      { id: "servicios", label: "Servicios" },
      { id: "garantias", label: "Garantías" },
      { id: "ordenes", label: "Órdenes de trabajo" },
    ],
  },
  {
    id: "compliance",
    label: "Trámites",
    icon: ShieldCheck,
    children: [
      { id: "Tenencia", label: "Tenencias" },
      { id: "Licencia de Conducir", label: "Licencias" },
      { id: "Tarjeta de Circulación", label: "Tarjetas de circulación" },
    ],
  },
  { id: "incidents", label: "Incidencias", icon: AlertTriangle },
  { id: "messages", label: "Mensajes", icon: MessageSquare },
  { id: "tasks", label: "Tareas", icon: ClipboardList },
];

const BOTTOM_NAV_ITEMS = [
  { id: "settings", label: "Configuración", icon: Settings },
  { id: "account", label: "Cuenta", icon: User },
  { id: "support", label: "Comunidad", icon: HelpCircle },
];

const PAGE_META = {
  home: { title: "Inicio", subtitle: "Lo que pasa hoy en tu operación y lo que necesita atención." },
  map: { title: "Mapa en vivo", subtitle: "Dónde está cada unidad y el recorrido de sus viajes." },
  fleet: { title: "Gestión de Flota", subtitle: "Mosaico de unidades y expediente digital por vehículo." },
  transfers: { title: "Traslados", subtitle: "Asignación de viajes, rutas y carga por unidad." },
  maintenance: { title: "Mantenimiento", subtitle: "Desglose por unidad: servicios, garantías y órdenes de trabajo." },
  incidents: { title: "Incidencias", subtitle: "Reporte de fallos y emergencias en ruta." },
  messages: { title: "Mensajes", subtitle: "Conversaciones entre las personas de tu empresa." },
  tasks: { title: "Tareas", subtitle: "Pendientes asignados a cada persona." },
  compliance: { title: "Trámites", subtitle: "Tenencias, pólizas, verificaciones y licencias al día." },
  fuel: { title: "Facturas y Gastos", subtitle: "Consumo de combustible, consumibles, refrigerante, refacciones y casetas." },
  settings: { title: "Configuración", subtitle: "Tu empresa, tu equipo, el bot y la seguridad de la información." },
  account: { title: "Cuenta", subtitle: "Tu perfil, tu seguridad y tus datos." },
  support: { title: "Comunidad", subtitle: "Comunidad y soporte técnico de Navio." },
  admin: { title: "Administración", subtitle: "Empresas, suspensiones y solicitudes de privacidad." },
};

/* ---------------------------------------------------------------------- */
/*  Home dashboard                                                        */
/* ---------------------------------------------------------------------- */

function MiniBarChart({ data }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex h-36 items-end gap-2">
      {data.map((d) => (
        <div key={d.label} className="flex flex-1 flex-col items-center gap-1.5">
          <span className="text-[10px] font-semibold text-slate-500">{d.value.toLocaleString()}</span>
          <div className="w-full rounded-t-md bg-blue-500" style={{ height: `${Math.max(6, Math.round((d.value / max) * 100))}%` }} />
          <span className="text-[10px] text-slate-400">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

function MiniDonutChart({ segments }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  let cumulative = 0;
  const stops = segments.map((s) => {
    const start = (cumulative / total) * 360;
    cumulative += s.value;
    const end = (cumulative / total) * 360;
    return `${s.color} ${start}deg ${end}deg`;
  });
  return (
    <div className="flex items-center gap-4">
      <div className="h-24 w-24 shrink-0 rounded-full" style={{ background: `conic-gradient(${stops.join(", ")})` }}>
        <div className="flex h-full w-full items-center justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-sm font-bold text-slate-700">{total}</div>
        </div>
      </div>
      <div className="space-y-1.5">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
            {s.label} <b className="text-slate-700">{s.value}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniLineChart({ points }) {
  const values = points.map((p) => p.value);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const coords = points.map((p, i) => {
    const x = points.length > 1 ? (i / (points.length - 1)) * 100 : 50;
    const y = 100 - ((p.value - min) / range) * 88 - 6;
    return `${x},${y}`;
  });
  return (
    <div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-28 w-full">
        <polyline points={coords.join(" ")} fill="none" stroke="#2563eb" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {coords.map((c, i) => {
          const [x, y] = c.split(",");
          return <circle key={i} cx={x} cy={y} r="1.8" fill="#2563eb" />;
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-slate-400">
        {points.map((p, i) => (
          <span key={i}>{p.label}</span>
        ))}
      </div>
    </div>
  );
}

function HomeChartSlot({ metricKey, metrics, onChangeMetric }) {
  const metric = metrics[metricKey];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-800">{metric.label}</h2>
        <select
          value={metricKey}
          onChange={(e) => onChangeMetric(e.target.value)}
          className="rounded-lg border border-slate-200 px-1.5 py-1 text-[10px] font-medium text-slate-500 focus:border-blue-400 focus:outline-none"
        >
          {Object.entries(metrics).map(([key, m]) => (
            <option key={key} value={key}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
      {metric.data.length === 0 ? (
        <p className="py-10 text-center text-xs text-slate-400">Sin datos en el rango seleccionado.</p>
      ) : metric.type === "bar" ? (
        <MiniBarChart data={metric.data} />
      ) : metric.type === "donut" ? (
        <MiniDonutChart segments={metric.data} />
      ) : (
        <MiniLineChart points={metric.data} />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Incidencias                                                            */
/* ---------------------------------------------------------------------- */

const INCIDENT_SEVERITY_STYLES = {
  critical: { label: "Crítica", className: "bg-rose-50 text-rose-700 ring-rose-200" },
  high: { label: "Alta", className: "bg-amber-50 text-amber-700 ring-amber-200" },
  medium: { label: "Media", className: "bg-blue-50 text-blue-700 ring-blue-200" },
  low: { label: "Baja", className: "bg-slate-100 text-slate-600 ring-slate-200" },
};

const INCIDENT_STATUS_STYLES = {
  open: { label: "Abierta", className: "bg-rose-50 text-rose-700 ring-rose-200" },
  attending: { label: "En Atención", className: "bg-amber-50 text-amber-700 ring-amber-200" },
  resolved: { label: "Resuelta", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
};


function IncidentFormModal({ vehicles, onSave, onClose }) {
  const [unit, setUnit] = useState(vehicles[0]?.unit ?? "");
  const [severity, setSeverity] = useState("medium");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reporter, setReporter] = useState("");
  const selectedVehicle = vehicles.find((v) => v.unit === unit);

  const inputClass = "w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-blue-400 focus:outline-none";
  const labelClass = "mb-1 block text-[11px] font-semibold text-slate-500";

  function handleSubmit(e) {
    e.preventDefault();
    if (!description.trim()) return;
    const driver = isVariableDriver(selectedVehicle) ? reporter.trim() : vehicleDriverName(selectedVehicle);
    onSave({ unit, severity, status: "open", description: description.trim(), reportedBy: driver, date });
  }

  return (
    <Modal title="Reportar Incidencia" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Unidad</label>
            <select value={unit} onChange={(e) => setUnit(e.target.value)} className={inputClass}>
              {vehicles.map((v) => (
                <option key={v.unit} value={v.unit}>
                  {v.unit} — {vehicleDriverLabel(v)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Severidad</label>
            <select value={severity} onChange={(e) => setSeverity(e.target.value)} className={inputClass}>
              <option value="critical">Crítica</option>
              <option value="high">Alta</option>
              <option value="medium">Media</option>
              <option value="low">Baja</option>
            </select>
          </div>
        </div>
        {isVariableDriver(selectedVehicle) && (
          <div>
            <label className={labelClass}>Chofer que reporta</label>
            <input value={reporter} onChange={(e) => setReporter(e.target.value)} placeholder="Nombre de quien manejaba" className={inputClass} />
          </div>
        )}
        <div>
          <label className={labelClass}>Descripción del incidente</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Describe la falla o emergencia..." className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Fecha</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">
            Cancelar
          </button>
          <button type="submit" className="rounded-lg bg-rose-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-700">
            Reportar Incidencia
          </button>
        </div>
      </form>
    </Modal>
  );
}

function IncidentsPage({ vehicles, incidents, insertIncident, updateIncident }) {
  const { format } = useDateFormat();
  const { showToast } = useToast();
  const [severityFilter, setSeverityFilter] = useState("all");
  const [modalOpen, setModalOpen] = useState(false);

  const filtered = severityFilter === "all" ? incidents : incidents.filter((i) => i.severity === severityFilter);

  async function addIncident(incident) {
    try {
      await insertIncident(incident);
      setModalOpen(false);
    } catch (err) {
      showToast(`Error al reportar incidencia: ${err.message}`);
    }
  }
  async function markAttending(incident) {
    try {
      await updateIncident(incident.id, { status: "attending" });
    } catch (err) {
      showToast(`Error: ${err.message}`);
    }
  }
  async function markResolved(incident) {
    try {
      await updateIncident(incident.id, { status: "resolved" });
    } catch (err) {
      showToast(`Error: ${err.message}`);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Incidencias</h1>
          <p className="mt-1 text-sm text-slate-500">Reporte de fallos y emergencias en ruta.</p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-rose-700"
        >
          <AlertTriangle size={15} /> Reportar Incidencia
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {["all", "critical", "high", "medium", "low"].map((s) => (
          <button
            key={s}
            onClick={() => setSeverityFilter(s)}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
              severityFilter === s ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
            }`}
          >
            {s === "all" ? "Todas" : INCIDENT_SEVERITY_STYLES[s].label}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {filtered.map((i) => {
          const sev = INCIDENT_SEVERITY_STYLES[i.severity];
          const st = INCIDENT_STATUS_STYLES[i.status];
          return (
            <div key={i.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-bold text-slate-800">{i.unit}</p>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${sev.className}`}>{sev.label}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${st.className}`}>{st.label}</span>
                </div>
                <p className="mt-1.5 text-sm text-slate-700">{i.description}</p>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  Reportado por {i.reportedBy} · {formatDate(i.date, format)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {i.status === "open" && (
                  <button onClick={() => markAttending(i)} className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-700 hover:bg-amber-100">
                    Marcar en Atención
                  </button>
                )}
                {i.status !== "resolved" && (
                  <button
                    onClick={() => markResolved(i)}
                    className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100"
                  >
                    Marcar Resuelta
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && <p className="py-8 text-center text-xs text-slate-400">Sin incidencias registradas.</p>}
      </div>

      {modalOpen && <IncidentFormModal vehicles={vehicles} onSave={addIncident} onClose={() => setModalOpen(false)} />}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Comunidad — feedback + roadmap (inspirado en FODI)                    */
/* ---------------------------------------------------------------------- */

const COMMUNITY_EMAIL = "jesusibrahimcontacto@gmail.com";

const COMMUNITY_CATEGORIES = [
  { id: "feature", label: "Sugerencia", emoji: "💡" },
  { id: "bug", label: "Error", emoji: "🐞" },
  { id: "other", label: "Otro", emoji: "💬" },
];

const COMMUNITY_STATUS = [
  { id: "backlog", label: "Backlog" },
  { id: "next", label: "Próximamente" },
  { id: "in-progress", label: "En Progreso" },
  { id: "done", label: "Completado" },
];
const COMMUNITY_STATUS_MAP = Object.fromEntries(COMMUNITY_STATUS.map((s) => [s.id, s]));


function openMailto(subject, body) {
  window.location.href = `mailto:${COMMUNITY_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function CommunityPostModal({ initialCategory, onSave, onClose }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState(initialCategory ?? "feature");
  const inputClass = "w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-blue-400 focus:outline-none";
  const labelClass = "mb-1 block text-[11px] font-semibold text-slate-500";

  function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim() || !description.trim()) return;
    onSave({ title: title.trim(), description: description.trim(), category });
  }

  return (
    <Modal title={category === "bug" ? "Reportar Error" : "Crear Publicación"} width="max-w-lg" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className={labelClass}>Categoría</label>
          <div className="flex gap-1.5 rounded-xl bg-slate-100 p-1">
            {COMMUNITY_CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategory(c.id)}
                className={`flex-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition ${
                  category === c.id ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {c.emoji} {c.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className={labelClass}>Título</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder='Ej. "Exportar reportes en PDF"' className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Descripción</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="Cuéntanos con detalle qué necesitas o qué falló..."
            className={inputClass}
          />
        </div>
        <p className="flex items-center gap-1.5 rounded-lg bg-blue-50 px-2.5 py-2 text-[11px] font-medium text-blue-700">
          <MessageSquare size={13} /> Se abrirá tu cliente de correo para notificar al equipo de Navio, además de publicarse aquí.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">
            Cancelar
          </button>
          <button type="submit" className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
            Publicar
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ContactModal({ defaultName, defaultEmail, onSubmit, onClose }) {
  const [name, setName] = useState(defaultName ?? "");
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [message, setMessage] = useState("");
  const inputClass = "w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-blue-400 focus:outline-none";
  const labelClass = "mb-1 block text-[11px] font-semibold text-slate-500";

  function handleSubmit(e) {
    e.preventDefault();
    if (!message.trim()) return;
    onSubmit({ name: name.trim(), email: email.trim(), message: message.trim() });
  }

  return (
    <Modal title="Contáctanos" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Nombre</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Correo</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
          </div>
        </div>
        <div>
          <label className={labelClass}>Mensaje</label>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} placeholder="¿En qué te podemos ayudar?" className={inputClass} />
        </div>
        <p className="flex items-center gap-1.5 rounded-lg bg-blue-50 px-2.5 py-2 text-[11px] font-medium text-blue-700">
          <Phone size={13} /> Este mensaje no se publica en la comunidad: se abrirá tu cliente de correo directo al equipo de Navio.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">
            Cancelar
          </button>
          <button type="submit" className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
            Enviar
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CommunityPostCard({ post, onUpvote, voted, isAdmin, onStatusChange }) {
  const cat = COMMUNITY_CATEGORIES.find((c) => c.id === post.category) ?? COMMUNITY_CATEGORIES[2];
  const status = COMMUNITY_STATUS_MAP[post.status];
  const statusTone =
    post.status === "done"
      ? "bg-emerald-50 text-emerald-700"
      : post.status === "in-progress"
      ? "bg-blue-50 text-blue-700"
      : post.status === "next"
      ? "bg-amber-50 text-amber-700"
      : "bg-slate-100 text-slate-500";
  return (
    <div className="flex gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <button
        onClick={() => onUpvote(post.id)}
        disabled={voted}
        title={voted ? "Ya votaste esta publicación" : "Votar"}
        className={`flex h-14 w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border text-xs font-bold transition ${
          voted ? "border-blue-200 bg-blue-50 text-blue-600" : "border-slate-200 text-slate-500 hover:border-blue-200 hover:bg-blue-50/50"
        }`}
      >
        <ChevronUp size={14} />
        {post.votes}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
            {cat.emoji} {cat.label}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusTone}`}>{status.label}</span>
        </div>
        <h3 className="mt-1.5 text-sm font-bold text-slate-800">{post.title}</h3>
        <p className="mt-1 text-xs text-slate-500">{post.description}</p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-slate-400">
            {post.author} · {post.date}
          </p>
          {isAdmin && (
            <select
              value={post.status}
              onChange={(e) => onStatusChange(post.id, e.target.value)}
              className="rounded-lg border border-slate-200 px-1.5 py-1 text-[10px] font-medium text-slate-500 focus:border-blue-400 focus:outline-none"
            >
              {COMMUNITY_STATUS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
    </div>
  );
}

function CommunityRoadmap({ posts }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {COMMUNITY_STATUS.map((col) => {
        const items = posts.filter((p) => p.status === col.id);
        return (
          <div key={col.id} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">{col.label}</h3>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">{items.length}</span>
            </div>
            <div className="space-y-2">
              {items.map((p) => {
                const cat = COMMUNITY_CATEGORIES.find((c) => c.id === p.category) ?? COMMUNITY_CATEGORIES[2];
                return (
                  <div key={p.id} className="rounded-xl border border-slate-100 bg-slate-50/60 p-2.5">
                    <p className="text-xs font-semibold text-slate-700">{p.title}</p>
                    <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400">
                      <span>
                        {cat.emoji} {cat.label}
                      </span>
                      <span className="flex items-center gap-0.5">
                        <ChevronUp size={10} /> {p.votes}
                      </span>
                    </div>
                  </div>
                );
              })}
              {items.length === 0 && <p className="py-4 text-center text-[11px] text-slate-400">Sin publicaciones.</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CommunityPage({ posts, insertCommunityPost, updateCommunityPost, refreshPosts, userName, userEmail }) {
  const { showToast } = useToast();
  const { user } = useAuth();
  const isAdmin = true; // Cualquier usuario autenticado es tratado como administrador — todavía no hay roles reales.
  const [tab, setTab] = useState("feedback");
  const [sort, setSort] = useState("new");
  const [postModalOpen, setPostModalOpen] = useState(false);
  const [postModalCategory, setPostModalCategory] = useState("feature");
  const [contactOpen, setContactOpen] = useState(false);
  const [votedIds, setVotedIds] = useState([]);

  useEffect(() => {
    if (!supabase || !user) return;
    let cancelled = false;
    supabase
      .from("community_votes")
      .select("postId")
      .eq("userId", user.id)
      .then(({ data }) => {
        if (!cancelled && data) setVotedIds(data.map((v) => v.postId));
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function upvote(id) {
    if (votedIds.includes(id) || !user) return;
    try {
      const { error } = await supabase.from("community_votes").insert({ postId: id, userId: user.id });
      if (error) throw error;
      setVotedIds((prev) => [...prev, id]);
      await refreshPosts();
    } catch (err) {
      showToast(`No se pudo registrar tu voto: ${err.message}`);
    }
  }

  async function changeStatus(id, status) {
    try {
      await updateCommunityPost(id, { status });
    } catch (err) {
      showToast(`Error al actualizar estado: ${err.message}`);
    }
  }

  async function handleNewPost({ title, description, category }) {
    try {
      await insertCommunityPost({
        title,
        description,
        category,
        status: "backlog",
        votes: 0,
        author: userName,
        authorId: user?.id ?? null,
        date: new Date().toISOString().slice(0, 10),
      });
      setPostModalOpen(false);
      openMailto(
        `[Navio Comunidad] ${category === "bug" ? "Reporte de error" : "Nueva publicación"}: ${title}`,
        `${description}\n\nCategoría: ${COMMUNITY_CATEGORIES.find((c) => c.id === category)?.label}\nEnviado por: ${userName} (Navio)`
      );
      showToast("Publicación creada. Se abrió tu cliente de correo para notificar al equipo.");
    } catch (err) {
      showToast(`Error al publicar: ${err.message}`);
    }
  }

  function handleContactSubmit({ name, email, message }) {
    openMailto(`[Navio] Contacto directo de ${name}`, `${message}\n\nResponder a: ${email}`);
    setContactOpen(false);
    showToast("Se abrió tu cliente de correo para enviar tu mensaje al equipo de Navio.");
  }

  const sortedPosts = [...posts].sort((a, b) => (sort === "top" ? b.votes - a.votes : new Date(b.date) - new Date(a.date)));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Comunidad</h1>
        <p className="mt-1 text-sm text-slate-500">Comparte ideas, reporta errores y sigue el avance del equipo de Navio.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          onClick={() => {
            setPostModalCategory("bug");
            setPostModalOpen(true);
          }}
          className="flex items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-left hover:bg-rose-100"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-rose-600 shadow-sm">
            <AlertTriangle size={18} />
          </span>
          <div>
            <p className="text-sm font-bold text-rose-700">Reportar Error</p>
            <p className="text-[11px] text-rose-500">Publícalo en la comunidad y notifica al equipo.</p>
          </div>
        </button>
        <button
          onClick={() => setContactOpen(true)}
          className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-left hover:bg-blue-100"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-blue-600 shadow-sm">
            <Phone size={18} />
          </span>
          <div>
            <p className="text-sm font-bold text-blue-700">Contáctanos</p>
            <p className="text-[11px] text-blue-500">Mensaje directo y privado al equipo de Navio.</p>
          </div>
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1.5 rounded-xl bg-slate-100 p-1">
          {[
            { id: "feedback", label: "Feedback" },
            { id: "roadmap", label: "Roadmap" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
                tab === t.id ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab === "feedback" && (
          <div className="flex items-center gap-2">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-500 focus:border-blue-400 focus:outline-none"
            >
              <option value="new">Más recientes</option>
              <option value="top">Más votados</option>
            </select>
            <button
              onClick={() => {
                setPostModalCategory("feature");
                setPostModalOpen(true);
              }}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
            >
              <Plus size={14} /> Crear Publicación
            </button>
          </div>
        )}
      </div>

      {tab === "feedback" ? (
        <div className="space-y-3">
          {sortedPosts.map((p) => (
            <CommunityPostCard key={p.id} post={p} onUpvote={upvote} voted={votedIds.includes(p.id)} isAdmin={isAdmin} onStatusChange={changeStatus} />
          ))}
          {sortedPosts.length === 0 && <p className="py-8 text-center text-xs text-slate-400">Aún no hay publicaciones.</p>}
        </div>
      ) : (
        <CommunityRoadmap posts={posts} />
      )}

      {postModalOpen && (
        <CommunityPostModal initialCategory={postModalCategory} onSave={handleNewPost} onClose={() => setPostModalOpen(false)} />
      )}
      {contactOpen && (
        <ContactModal defaultName={userName} defaultEmail={userEmail} onSubmit={handleContactSubmit} onClose={() => setContactOpen(false)} />
      )}
    </div>
  );
}

const BOT_MODULE_ICON = { fuel: "⛽", maintenance: "🔧", compliance: "📋", travel: "🧳" };

function BotFeedPanel() {
  const { profile } = useAuth();
  const [ingestions, setIngestions] = useState([]);
  const connected = !!profile?.company?.botChannel;

  const load = useCallback(() => {
    if (!supabase || !profile?.companyId) return;
    supabase
      .from("bot_ingestions")
      .select("*")
      .order("createdAt", { ascending: false })
      .limit(3)
      .then(({ data }) => setIngestions(data ?? []));
  }, [profile?.companyId]);

  // Se consulta al abrir y al volver a la pestaña, no cada tantos segundos.
  useEffect(() => {
    if (!connected) return undefined;
    load();
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [connected, load]);

  if (!connected) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-2.5 py-3 text-center">
        <p className="text-[11px] font-semibold text-slate-500">Ningún canal conectado todavía</p>
        <p className="mt-0.5 text-[10px] text-slate-400">Vincúlalo en Configuración → Bot para ver aquí los últimos documentos recibidos.</p>
      </div>
    );
  }

  if (ingestions.length === 0) {
    return <p className="px-1 text-[11px] text-slate-400">Conectado — esperando el primer documento.</p>;
  }

  return (
    <div className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
      {ingestions.map((f) => (
        <div key={f.id} className={`rounded-lg px-2.5 py-2 ${f.status === "failed" ? "bg-rose-50" : "bg-slate-50"}`}>
          <p className="text-[11px] font-semibold text-slate-600">
            {BOT_MODULE_ICON[f.module] ?? "⚠️"} {f.summary}
          </p>
          <p className="text-[10px] text-slate-400">{new Date(f.createdAt).toLocaleString("es-MX")}</p>
        </div>
      ))}
    </div>
  );
}

// Minisecciones de Facturas y Gastos, en árbol: General → Proyectos → cada
// proyecto activo.
function InvoiceSidebarMenu({ active, nav, projects, expanded, onToggle, onNav }) {
  const item = (isActive) =>
    `block w-full min-w-0 flex-1 truncate rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition ${
      isActive ? "bg-blue-50 text-blue-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
    }`;
  const branch = "ml-3 mt-0.5 space-y-0.5 border-l border-slate-200 pl-2";
  const toggle = (key, what) => (
    <button
      onClick={() => onToggle(key)}
      aria-label={`${expanded[key] ? "Ocultar" : "Mostrar"} ${what}`}
      aria-expanded={!!expanded[key]}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-50 hover:text-slate-600"
    >
      {expanded[key] ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
    </button>
  );
  const inReport = nav.report;
  return (
    <div className="ml-[22px] mt-1 space-y-0.5 border-l border-slate-100 pl-3">
      <div className="flex items-center gap-0.5">
        <button onClick={() => onNav(INVOICE_NAV_START)} className={item(active && !inReport && !nav.inProjects)}>
          General
        </button>
        {toggle("invoiceGeneral", "proyectos")}
      </div>
      {expanded.invoiceGeneral && (
        <div className={branch}>
          <div className="flex items-center gap-0.5">
            <button onClick={() => onNav(INVOICE_NAV_PROJECTS)} className={item(active && !inReport && nav.inProjects && nav.project === null)}>
              Proyectos
            </button>
            {toggle("invoiceProjects", "la lista de proyectos")}
          </div>
          {expanded.invoiceProjects && (
            <div className={branch}>
              {projects.map((name) => (
                <button key={name} title={name} onClick={() => onNav({ ...INVOICE_NAV_PROJECTS, project: name })} className={item(active && !inReport && nav.project === name)}>
                  {name}
                </button>
              ))}
              {projects.length === 0 && <p className="px-2.5 py-1 text-[11px] text-slate-400">Sin proyectos activos</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Sidebar({ open, activeTab, activeSubId, onNavigate, onNavigateSub, onLogoClick, isSuperAdmin, invoiceMenu }) {
  const [expanded, setExpanded] = useState({ maintenance: true, compliance: true, fuel: true, invoiceGeneral: true, invoiceProjects: true });

  function toggleExpanded(id) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <aside
      className={`sticky top-0 flex h-screen shrink-0 flex-col border-r border-slate-200 bg-white transition-all duration-200 print:hidden ${
        open ? "w-64" : "w-[72px]"
      }`}
    >
      <button
        onClick={onLogoClick}
        title="Ir al Home"
        className={`flex h-16 items-center border-b border-slate-100 hover:bg-slate-50 ${open ? "px-5" : "justify-center"}`}
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-sm font-extrabold text-white">N</div>
        {open && <span className="ml-2.5 text-lg font-extrabold tracking-tight text-blue-700">NAVIO</span>}
      </button>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          const isInvoices = item.id === "fuel" && !!invoiceMenu;
          const hasChildren = !!item.children || isInvoices;
          return (
            <div key={item.id}>
              <button
                onClick={() => {
                  onNavigate(item.id);
                  // Al llegar desde otra sección se abre; estando ahí, se pliega o despliega.
                  if (hasChildren) setExpanded((prev) => ({ ...prev, [item.id]: active ? !prev[item.id] : true }));
                }}
                title={item.label}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  active ? "bg-blue-600 text-white shadow-sm" : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                } ${open ? "" : "justify-center"}`}
              >
                <Icon size={18} className="shrink-0" />
                {open && <span className="flex-1 truncate text-left">{item.label}</span>}
                {open && <NavBadge id={item.id} />}
                {open && hasChildren && (
                  expanded[item.id] ? <ChevronUp size={14} className="shrink-0" /> : <ChevronDown size={14} className="shrink-0" />
                )}
              </button>
              {open && isInvoices && expanded.fuel && (
                <InvoiceSidebarMenu
                  active={active}
                  nav={invoiceMenu.nav}
                  projects={invoiceMenu.projects}
                  expanded={expanded}
                  onToggle={toggleExpanded}
                  onNav={invoiceMenu.onNav}
                />
              )}
              {open && item.children && expanded[item.id] && (
                <div className="ml-[22px] mt-1 space-y-0.5 border-l border-slate-100 pl-3">
                  {item.children.map((child) => {
                    const childActive = active && activeSubId === child.id;
                    return (
                      <button
                        key={child.id}
                        onClick={() => onNavigateSub(item.id, child.id)}
                        className={`block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition ${
                          childActive ? "bg-blue-50 text-blue-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                        }`}
                      >
                        {child.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="space-y-1 border-t border-slate-100 px-3 py-3">
        {BOTTOM_NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              title={item.label}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-xs font-medium transition ${
                active ? "bg-blue-50 text-blue-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
              } ${open ? "" : "justify-center"}`}
            >
              <Icon size={16} className="shrink-0" />
              {open && <span className="truncate">{item.label}</span>}
            </button>
          );
        })}
        {isSuperAdmin && (
          <button
            onClick={() => onNavigate("admin")}
            title="Administración"
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-xs font-medium transition ${
              activeTab === "admin" ? "bg-blue-50 text-blue-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
            } ${open ? "" : "justify-center"}`}
          >
            <Shield size={16} className="shrink-0" />
            {open && <span className="truncate">Administración</span>}
          </button>
        )}
      </div>

      {open ? (
        <div className="border-t border-slate-100 p-3">
          <div className="mb-2 flex items-center gap-1.5 px-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">
            <Bot size={13} /> Bot de Ingesta
          </div>
          <BotFeedPanel />
        </div>
      ) : (
        <div className="flex justify-center border-t border-slate-100 p-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-50 text-slate-400">
            <Bot size={16} />
          </span>
        </div>
      )}
    </aside>
  );
}

/* ---------------------------------------------------------------------- */
/*  Header                                                                 */
/* ---------------------------------------------------------------------- */

const BENTO_APPS = [
  { label: "Gestión de Flota", icon: Truck, tab: "fleet" },
  { label: "Mantenimiento", icon: Wrench, tab: "maintenance" },
  { label: "Cumplimiento", icon: ShieldCheck, tab: "compliance" },
  { label: "Combustible", icon: Fuel, tab: "fuel" },
  { label: "Reportes", icon: FileText, tab: null },
  { label: "Alertas", icon: AlertTriangle, tab: "incidents" },
  { label: "Facturación", icon: DollarSign, tab: "fuel" },
  { label: "Soporte", icon: MessageSquare, tab: "support" },
  { label: "Ajustes", icon: Sliders, tab: "settings" },
];

function Header({
  toggleSidebar,
  title,
  subtitle,
  onLogoClick,
  bentoOpen,
  setBentoOpen,
  notifOpen,
  setNotifOpen,
  searchOpen,
  setSearchOpen,
  searchQuery,
  setSearchQuery,
  vehicles,
  onSelectVehicle,
  onNavigate,
  userName,
  userAvatar,
  companyName,
}) {
  const { showToast } = useToast();

  const searchResults =
    searchQuery.trim().length > 0
      ? vehicles
          .filter((v) => {
            const q = searchQuery.trim().toLowerCase();
            return (
              v.unit.toLowerCase().includes(q) ||
              v.plate.toLowerCase().includes(q) ||
              vehicleDriverName(v).toLowerCase().includes(q)
            );
          })
          .slice(0, 6)
      : [];

  function goToBentoApp(app) {
    if (app.tab) {
      onNavigate(app.tab);
    } else {
      showToast(`${app.label}: próximamente disponible.`);
    }
    setBentoOpen(false);
  }

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 px-6 py-3 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <button
            onClick={toggleSidebar}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
            aria-label="Alternar menú lateral"
          >
            <Menu size={20} />
          </button>
          <div>
            <h1 className="text-base font-bold text-slate-800">{title}</h1>
            <p className="text-xs text-slate-400">{subtitle}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative" data-keep-open>
            <button
              onClick={() => setSearchOpen((v) => !v)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              aria-label="Buscar unidad"
            >
              <Search size={18} />
            </button>
            {searchOpen && (
              <div className="absolute right-0 z-20 mt-2 w-72 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                <input
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar por unidad, placa o conductor..."
                  className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-blue-400 focus:outline-none"
                />
                <div className="mt-1.5 max-h-64 overflow-y-auto">
                  {searchQuery.trim().length === 0 && (
                    <p className="px-2 py-3 text-center text-[11px] text-slate-400">Escribe para buscar en toda la flota.</p>
                  )}
                  {searchQuery.trim().length > 0 && searchResults.length === 0 && (
                    <p className="px-2 py-3 text-center text-[11px] text-slate-400">Sin resultados para "{searchQuery}".</p>
                  )}
                  {searchResults.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => {
                        onSelectVehicle(v.id);
                        setSearchOpen(false);
                        setSearchQuery("");
                      }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-slate-50"
                    >
                      <VehiclePhoto src={v.photo} alt={v.unit} className="h-8 w-11 shrink-0 rounded ring-1 ring-slate-200" iconSize={16} />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-slate-700">
                          {v.unit} <span className="font-normal text-slate-400">· {v.plate}</span>
                        </p>
                        <p className="truncate text-[10px] text-slate-400">{vehicleDriverLabel(v)}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <button
            onClick={onLogoClick}
            title="Ir al Home"
            className="hidden text-lg font-extrabold tracking-tight text-blue-700 hover:text-blue-800 lg:block"
          >
            NAVIO
          </button>
          <BellButton onClick={() => setNotifOpen((v) => !v)} />
          <div className="hidden items-center gap-2.5 sm:flex">
            <img src={userAvatar} alt={userName} className="h-9 w-9 rounded-full bg-blue-50 ring-2 ring-blue-100" />
            <div className="leading-tight">
              <p className="text-sm font-semibold text-slate-800">{userName}</p>
              <p className="text-xs text-slate-400">{companyName || "Administrador"}</p>
            </div>
          </div>
          <div className="relative">
            <button
              onClick={() => setBentoOpen((v) => !v)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              aria-label="Menú rápido"
            >
              <LayoutGrid size={19} />
            </button>
            {bentoOpen && (
              <div className="absolute right-0 z-20 mt-2 w-64 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
                <p className="mb-2 px-1 text-xs font-semibold text-slate-400">Herramientas Navio</p>
                <div className="grid grid-cols-3 gap-2">
                  {BENTO_APPS.map((app) => {
                    const Icon = app.icon;
                    return (
                      <button
                        key={app.label}
                        onClick={() => goToBentoApp(app)}
                        className="flex flex-col items-center gap-1.5 rounded-xl p-2.5 text-center hover:bg-blue-50"
                      >
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-50 text-blue-600">
                          <Icon size={16} />
                        </span>
                        <span className="text-[10.5px] font-medium leading-tight text-slate-600">{app.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

/* ---------------------------------------------------------------------- */
/*  Root component                                                        */
/* ---------------------------------------------------------------------- */

// Lo que comparten todas las pantallas una vez dentro: la gente de la
// empresa, la bandeja (alertas, mensajes, tareas) y el rastreo del viaje.
function AppProviders({ fleet, children }) {
  return (
    <PeopleProvider>
      <InboxProvider>
        <TrackingProvider>
          <FleetDataProvider value={fleet}>{children}</FleetDataProvider>
          <IdleGuard />
          <LegalAcceptanceGate />
          <CookieNotice />
        </TrackingProvider>
      </InboxProvider>
    </PeopleProvider>
  );
}

function NavioApp() {
  const { user, signOut, profile } = useAuth();
  const currentUserName = user?.user_metadata?.full_name?.trim() || user?.email?.split("@")[0] || "Usuario";
  const currentUserEmail = user?.email ?? "";
  const currentUserAvatar = avatarUrl(currentUserName);
  const isMobileViewport = useIsMobileViewport();

  const [sidebarOpen, setSidebarOpen] = useState(true);
  // La pantalla abierta sobrevive a una recarga de la pestaña.
  const [activeTab, setActiveTab] = useSessionState("navio.nav.tab", "home");
  const [selectedVehicleId, setSelectedVehicleId] = useSessionState("navio.nav.vehicle", null);
  const [bentoOpen, setBentoOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFormat, setDateFormat] = usePersistentState("navio.dateFormat", "DD/MM/AAAA");

  const companyId = profile?.companyId ?? null;

  const {
    rows: vehicles,
    loading: vehiclesLoading,
    error: vehiclesError,
    insertRow: insertVehicle,
    updateRow: updateVehicleRow,
    removeRow: removeVehicleRow,
    refresh: refreshVehicles,
  } = useSupabaseTable("vehicles", { orderBy: "id", ascending: true, companyId });
  const {
    rows: maintenanceRecords,
    loading: maintenanceLoading,
    insertRow: insertMaintenanceRecord,
    updateRow: updateMaintenanceRecord,
    removeRow: removeMaintenanceRecord,
  } = useSupabaseTable("maintenance_records", { companyId });
  const {
    rows: complianceRecords,
    loading: complianceLoading,
    insertRow: insertComplianceRecord,
    updateRow: updateComplianceRecord,
    removeRow: removeComplianceRecord,
  } = useSupabaseTable("compliance_records", { companyId });
  const {
    rows: fuelRecords,
    loading: fuelLoading,
    insertRow: insertFuelRecord,
    updateRow: updateFuelRecord,
    removeRow: removeFuelRecord,
    refresh: refreshFuelRecords,
  } = useSupabaseTable("fuel_records", { companyId });
  const {
    rows: travelExpenses,
    loading: travelLoading,
    insertRow: insertTravelExpense,
    updateRow: updateTravelExpense,
    removeRow: removeTravelExpense,
    refresh: refreshTravelExpenses,
  } = useSupabaseTable("travel_expenses", { companyId });
  const {
    rows: miscExpenses,
    loading: miscLoading,
    insertRow: insertMiscExpense,
    updateRow: updateMiscExpense,
    removeRow: removeMiscExpense,
    refresh: refreshMiscExpenses,
  } = useSupabaseTable("misc_expenses", { companyId });
  // Datos propios del resumen de Facturas y Gastos (migración v11): si esa
  // migración todavía no se corrió, estas tablas vienen vacías y el resto
  // de la app sigue funcionando.
  const { rows: workOrderRows, refresh: refreshWorkOrders } = useSupabaseTable("work_orders", { companyId });
  const { rows: deadlineRows, refresh: refreshDeadlines } = useSupabaseTable("concept_deadlines", { orderBy: "expenseType", companyId });
  // Igual que las anteriores: sin la migración v16, todos los proyectos salen activos.
  const { rows: projectSettings, refresh: refreshProjectSettings } = useSupabaseTable("project_settings", { orderBy: "project", companyId });
  const [invoiceNav, setInvoiceNav] = useSessionState("navio.nav.invoices", INVOICE_NAV_START);
  const reminders = useSupabaseTable("user_reminders", { enabled: activeTab === "fuel" });
  const invoices = useMemo(
    () => normalizeInvoices({ fuel: fuelRecords, travel: travelExpenses, misc: miscExpenses }),
    [fuelRecords, travelExpenses, miscExpenses]
  );
  // Rechazadas y anuladas no cuentan en ningún total.
  const countableFuelRecords = useMemo(() => fuelRecords.filter((r) => r.status !== "rejected" && r.status !== "voided"), [fuelRecords]);
  const deadlineDays = useMemo(() => getDeadlineDays(deadlineRows), [deadlineRows]);
  const invoiceOrders = useMemo(() => buildOrders(invoices, workOrderRows, deadlineDays), [invoices, workOrderRows, deadlineDays]);
  const invoiceProjects = useMemo(() => buildProjects(invoices, invoiceOrders, projectSettings), [invoices, invoiceOrders, projectSettings]);
  const sidebarProjects = useMemo(
    () => invoiceProjects.filter((p) => p.name && !p.closed).map((p) => p.name).sort((a, b) => a.localeCompare(b, "es")),
    [invoiceProjects]
  );
  const projectOptions = useMemo(
    () =>
      [...new Set([...invoices.map((i) => i.project), ...workOrderRows.map((w) => (w.project || "").trim())].filter(Boolean))].sort(),
    [invoices, workOrderRows]
  );
  const {
    rows: trips,
    loading: tripsLoading,
    insertRow: insertTrip,
    updateRow: updateTrip,
    removeRow: removeTrip,
    refresh: refreshTrips,
  } = useSupabaseTable("trips", { companyId });
  // Al iniciar o terminar un viaje, el servidor cambia el traslado y el
  // kilometraje de la unidad: se vuelven a leer.
  useEffect(() => {
    const reload = () => {
      refreshTrips();
      refreshVehicles();
    };
    window.addEventListener("navio:trips-changed", reload);
    return () => window.removeEventListener("navio:trips-changed", reload);
  }, [refreshTrips, refreshVehicles]);
  const [driverModeOpen, setDriverModeOpen] = useState(false);
  const {
    rows: incidents,
    loading: incidentsLoading,
    insertRow: insertIncident,
    updateRow: updateIncident,
  } = useSupabaseTable("incidents", { companyId, enabled: activeTab === "incidents" });
  const {
    rows: communityPosts,
    loading: communityLoading,
    insertRow: insertCommunityPost,
    updateRow: updateCommunityPost,
    refresh: refreshCommunityPosts,
  } = useSupabaseTable("community_posts", { enabled: activeTab === "support" });

  const dataLoading =
    vehiclesLoading ||
    maintenanceLoading ||
    complianceLoading ||
    fuelLoading ||
    travelLoading ||
    miscLoading ||
    tripsLoading ||
    incidentsLoading ||
    communityLoading;

  const [maintenanceView, setMaintenanceView] = useSessionState("navio.nav.maintenance", "servicios");
  const [complianceDocFilter, setComplianceDocFilter] = useSessionState("navio.nav.compliance", "all");

  const [formModal, setFormModal] = useState(null);
  const [addVehicleModalOpen, setAddVehicleModalOpen] = useState(false);
  const [editVehicleTarget, setEditVehicleTarget] = useState(null);
  const [deleteVehicleTarget, setDeleteVehicleTarget] = useState(null);
  const isCompanyAdmin = !!(profile?.isSuperAdmin || profile?.companyRole === "admin");

  const [toast, setToast] = useState(null);
  function showToast(message) {
    setToast(message);
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToast(null), 3200);
  }

  const recordTables = {
    maintenance: { insertRow: insertMaintenanceRecord, updateRow: updateMaintenanceRecord, removeRow: removeMaintenanceRecord },
    compliance: { insertRow: insertComplianceRecord, updateRow: updateComplianceRecord, removeRow: removeComplianceRecord },
    fuel: { insertRow: insertFuelRecord, updateRow: updateFuelRecord, removeRow: removeFuelRecord },
    travel: { insertRow: insertTravelExpense, updateRow: updateTravelExpense, removeRow: removeTravelExpense },
    misc: { insertRow: insertMiscExpense, updateRow: updateMiscExpense, removeRow: removeMiscExpense },
  };

  const [deleteRecordTarget, setDeleteRecordTarget] = useState(null);

  // Guarda los datos propios de una orden de trabajo (por ahora su fecha
  // límite). Si falla (p. ej. la migración v11 aún no se corrió), no
  // estorba: la factura ya se guardó.
  async function ensureWorkOrder(project, code, dueDate) {
    if (!code || !companyId) return;
    const { error } = await supabase
      .from("work_orders")
      .upsert({ companyId, project: project || "", code, dueDate: dueDate || null }, { onConflict: "companyId,project,code" });
    if (!error) refreshWorkOrders();
  }

  async function handleSaveRecord(module, record, extra = {}) {
    const { insertRow, updateRow } = recordTables[module];
    try {
      if (record.id) {
        const { id, ...patch } = record;
        await updateRow(id, { ...patch, status: "verified" });
      } else {
        const author = INVOICE_MODULES.includes(module) ? { uploadedByName: currentUserName } : {};
        await insertRow({ ...record, ...author, origin: "manual", status: "verified" });
      }
      if (INVOICE_MODULES.includes(module) && record.workOrder) {
        await ensureWorkOrder(record.project, record.workOrder, extra.orderDueDate);
      }
      setFormModal(null);
      showToast("Registro guardado en Supabase.");
    } catch (err) {
      showToast(`Error al guardar: ${err.message}`);
    }
  }

  async function handleConfirmRecord(module, record) {
    const { updateRow } = recordTables[module];
    try {
      await updateRow(record.id, { status: "verified" });
    } catch (err) {
      showToast(`Error al confirmar: ${err.message}`);
    }
  }

  // Acciones de Facturas y Gastos sobre una factura ya normalizada
  // (inv.module / inv.id indican en qué tabla vive). Si la base de datos la
  // rechaza (por ejemplo, otra persona ya la aprobó), se muestra el motivo y
  // se recarga la tabla para ver su estado real.
  async function updateInvoice(inv, patch, errorLabel) {
    try {
      await recordTables[inv.module].updateRow(inv.id, patch);
    } catch (err) {
      showToast(`${errorLabel}: ${err.message}`);
      ({ fuel: refreshFuelRecords, travel: refreshTravelExpenses, misc: refreshMiscExpenses })[inv.module]();
    }
  }
  const handleConfirmInvoice = (inv) => updateInvoice(inv, { status: "verified" }, "Error al confirmar");

  async function handleInvoiceDecision(type, inv, reason) {
    const noApproval = { approved: false, approvedBy: null, approvedByName: null, approvedAt: null };
    if (type === "approve") {
      await updateInvoice(
        inv,
        { approved: true, approvedBy: user?.id ?? null, approvedByName: currentUserName, approvedAt: new Date().toISOString() },
        "Error al aprobar"
      );
    } else if (type === "reject") {
      await updateInvoice(inv, { ...noApproval, status: "rejected", statusReason: reason }, "Error al rechazar");
    } else if (type === "void") {
      await updateInvoice(inv, { ...noApproval, status: "voided", statusReason: reason }, "Error al anular");
    } else {
      await updateInvoice(inv, { ...noApproval, statusReason: reason }, "Error al revertir la aprobación");
    }
  }

  async function handleSaveDeadlines(changes) {
    const entries = Object.entries(changes);
    if (entries.length === 0) return true;
    const { error } = await supabase
      .from("concept_deadlines")
      .upsert(entries.map(([expenseType, days]) => ({ companyId, expenseType, days })), { onConflict: "companyId,expenseType" });
    if (error) {
      showToast(`Error al guardar plazos: ${error.message}`);
      return false;
    }
    await refreshDeadlines();
    showToast("Plazos guardados.");
    return true;
  }

  async function handleSetProjectClosed(project, closed) {
    const { error } = await supabase.from("project_settings").upsert({ companyId, project, closed }, { onConflict: "companyId,project" });
    if (error) {
      showToast(`Error al actualizar el proyecto: ${error.message}`);
      return;
    }
    await refreshProjectSettings();
    showToast(closed ? "Proyecto cerrado. Sus facturas no cambian." : "Proyecto reabierto.");
  }

  function handleAddInvoice(expenseType, project = "") {
    const target = targetForExpenseType(expenseType);
    setFormModal({ mode: "add", module: target.module, category: target.category, expenseType, project, initial: null });
  }

  function handleEditInvoice(inv) {
    setFormModal({ mode: "edit", module: inv.module, category: inv.raw.category, initial: inv.raw });
  }

  async function handleDeleteRecord() {
    if (!deleteRecordTarget) return;
    const { removeRow } = recordTables[deleteRecordTarget.module];
    try {
      await removeRow(deleteRecordTarget.record.id);
      showToast("Registro eliminado.");
      setDeleteRecordTarget(null);
    } catch (err) {
      showToast(`Error al eliminar: ${err.message}`);
    }
  }

  async function handleAddVehicle({ vehicle, reassignedFromId }) {
    const { id, ...vehicleData } = vehicle;
    try {
      const inserted = await insertVehicle(vehicleData);
      if (reassignedFromId) {
        await updateVehicleRow(reassignedFromId, {
          driver: {
            name: "Sin asignar",
            phone: "",
            photo: avatarUrl("Sin asignar"),
            license: "",
            licenseExpiry: "",
          },
        });
      }
      setAddVehicleModalOpen(false);
      showToast(`${inserted.unit} agregada a la flota.`);
      return true;
    } catch (err) {
      showToast(`Error al agregar unidad: ${err.message}`);
      return false;
    }
  }

  async function handleEditVehicle(patch) {
    const { id, ...rest } = patch;
    try {
      await updateVehicleRow(id, rest);
      setEditVehicleTarget(null);
      showToast("Unidad actualizada.");
      return true;
    } catch (err) {
      showToast(`Error al editar unidad: ${err.message}`);
      return false;
    }
  }

  // Cambios puntuales desde el expediente (por ejemplo, subir una foto).
  async function handleUpdateVehicle(id, patch, message = "Foto guardada.") {
    try {
      await updateVehicleRow(id, patch);
      showToast(message);
      return true;
    } catch (err) {
      showToast(`Error al guardar: ${err.message}`);
      return false;
    }
  }

  async function handleDeleteVehicle() {
    if (!deleteVehicleTarget) return;
    try {
      await removeVehicleRow(deleteVehicleTarget.id);
      if (selectedVehicleId === deleteVehicleTarget.id) setSelectedVehicleId(null);
      showToast(`${deleteVehicleTarget.unit} eliminada de la flota.`);
      setDeleteVehicleTarget(null);
    } catch (err) {
      showToast(`Error al eliminar unidad: ${err.message}`);
    }
  }

  const meta = PAGE_META[activeTab];
  const selectedVehicle = selectedVehicleId ? vehicles.find((v) => v.id === selectedVehicleId) : null;
  const headerTitle = selectedVehicle && activeTab === "fleet" ? selectedVehicle.unit : meta.title;
  const headerSubtitle = selectedVehicle && activeTab === "fleet" ? "Expediente digital del vehículo" : meta.subtitle;

  function goHome() {
    setActiveTab("home");
    setSelectedVehicleId(null);
  }
  function jumpToVehicle(id) {
    setActiveTab("fleet");
    setSelectedVehicleId(id);
  }
  function goToTab(id, subId) {
    setActiveTab(id);
    setSelectedVehicleId(null);
    if (id === "maintenance") setMaintenanceView(subId ?? "servicios");
    if (id === "compliance") setComplianceDocFilter(subId ?? "all");
  }

  const activeSubId = activeTab === "maintenance" ? maintenanceView : activeTab === "compliance" ? complianceDocFilter : undefined;

  // Lo que consultan el expediente de una unidad y las garantías.
  const fleetData = useMemo(
    () => ({ maintenanceRecords, complianceRecords, fuelRecords: countableFuelRecords, trips, vehicles, isAdmin: isCompanyAdmin, onNavigate: goToTab }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [maintenanceRecords, complianceRecords, countableFuelRecords, trips, vehicles, isCompanyAdmin]
  );
  const pendingReviewCount = [maintenanceRecords, complianceRecords, fuelRecords, travelExpenses, miscExpenses].reduce(
    (sum, rows) => sum + rows.filter((r) => r.status === "pending").length,
    0
  );

  if (isMobileViewport) {
    return (
      <DateFormatContext.Provider value={{ format: dateFormat, setFormat: setDateFormat }}>
        <ToastContext.Provider value={{ showToast }}>
          <AppProviders fleet={fleetData}>
          {dataLoading && !vehiclesError && (
            <div className="flex min-h-screen items-center justify-center">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-400">
                <RefreshCw size={16} className="animate-spin" /> Cargando datos de Supabase...
              </div>
            </div>
          )}
          {vehiclesError && (
            <div className="flex min-h-screen items-center justify-center px-4">
              <div className="max-w-md rounded-2xl border border-rose-200 bg-rose-50 p-5 text-center">
                <AlertTriangle size={20} className="mx-auto mb-2 text-rose-600" />
                <p className="text-sm font-bold text-rose-700">No se pudo conectar a la base de datos</p>
                <p className="mt-1 text-xs text-rose-600">{vehiclesError}</p>
              </div>
            </div>
          )}
          {!dataLoading && !vehiclesError && (
            <MobileAppShell
              vehicles={vehicles}
              trips={trips}
              pendingCount={pendingReviewCount}
              userName={currentUserName}
              userEmail={currentUserEmail}
              userAvatar={currentUserAvatar}
              companyName={profile?.company?.name}
              isSuperAdmin={!!profile?.isSuperAdmin}
              isCompanyAdmin={isCompanyAdmin}
              onSignOut={signOut}
              onOpenRecordForm={(module) => setFormModal({ mode: "add", module, initial: null })}
            />
          )}
          {formModal && (
            <RecordFormModal
              mode={formModal.mode}
              module={formModal.module}
              fixedCategory={formModal.category}
              presetExpenseType={formModal.expenseType}
              presetProject={formModal.project}
              initial={formModal.initial}
              vehicles={vehicles}
              orders={invoiceOrders}
              projectOptions={projectOptions}
              onSave={handleSaveRecord}
              onClose={() => setFormModal(null)}
            />
          )}
          <ToastHost toast={toast} onDismiss={() => setToast(null)} />
          </AppProviders>
        </ToastContext.Provider>
      </DateFormatContext.Provider>
    );
  }

  return (
    <DateFormatContext.Provider value={{ format: dateFormat, setFormat: setDateFormat }}>
      <ToastContext.Provider value={{ showToast }}>
        <AppProviders fleet={fleetData}>
        <div
          className="flex min-h-screen w-full bg-[#f8fafc]"
          onClick={(e) => {
            if (!e.target.closest?.("[data-keep-open]")) {
              setBentoOpen(false);
              setNotifOpen(false);
              setSearchOpen(false);
            }
          }}
        >
          <Sidebar
            open={sidebarOpen}
            activeTab={activeTab}
            activeSubId={activeSubId}
            onNavigate={(id) => goToTab(id)}
            onNavigateSub={(parentId, childId) => goToTab(parentId, childId)}
            onLogoClick={goHome}
            isSuperAdmin={!!profile?.isSuperAdmin}
            invoiceMenu={{
              nav: invoiceNav,
              projects: sidebarProjects,
              onNav: (nav) => {
                goToTab("fuel");
                setInvoiceNav(nav);
              },
            }}
          />

          <div className="flex min-h-screen min-w-0 flex-1 flex-col">
            <div data-keep-open className="print:hidden">
              <Header
                toggleSidebar={() => setSidebarOpen((v) => !v)}
                title={headerTitle}
                subtitle={headerSubtitle}
                onLogoClick={goHome}
                bentoOpen={bentoOpen}
                setBentoOpen={setBentoOpen}
                notifOpen={notifOpen}
                setNotifOpen={setNotifOpen}
                searchOpen={searchOpen}
                setSearchOpen={setSearchOpen}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                vehicles={vehicles}
                onSelectVehicle={jumpToVehicle}
                onNavigate={goToTab}
                userName={currentUserName}
                userAvatar={currentUserAvatar}
                companyName={profile?.company?.name}
              />
            </div>

            <main className="flex-1 px-6 py-6">
              {dataLoading && !vehiclesError && (
                <div className="flex min-h-[60vh] items-center justify-center">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-400">
                    <RefreshCw size={16} className="animate-spin" /> Cargando datos de Supabase...
                  </div>
                </div>
              )}
              {vehiclesError && (
                <div className="flex min-h-[60vh] items-center justify-center px-4">
                  <div className="max-w-md rounded-2xl border border-rose-200 bg-rose-50 p-5 text-center">
                    <AlertTriangle size={20} className="mx-auto mb-2 text-rose-600" />
                    <p className="text-sm font-bold text-rose-700">No se pudo conectar a la base de datos</p>
                    <p className="mt-1 text-xs text-rose-600">{vehiclesError}</p>
                    <p className="mt-2 text-[11px] text-rose-500">
                      Verifica que corriste supabase_migration.sql en tu proyecto de Supabase.
                    </p>
                  </div>
                </div>
              )}
              {!dataLoading && !vehiclesError && (
                <>
                  {activeTab === "home" && (
                    <HomePage
                      vehicles={vehicles}
                      maintenanceRecords={maintenanceRecords}
                      complianceRecords={complianceRecords}
                      invoices={invoices}
                      trips={trips}
                      currency={profile?.company?.currency || "MXN"}
                      isAdmin={isCompanyAdmin}
                      onSelectVehicle={jumpToVehicle}
                      onNavigate={goToTab}
                      onAddInvoice={handleAddInvoice}
                      userName={currentUserName}
                    />
                  )}
                  {activeTab === "map" && <LiveMapPage vehicles={vehicles} trips={trips} isAdmin={isCompanyAdmin} onSelectVehicle={jumpToVehicle} />}
                  {activeTab === "fleet" && (
                    <FleetTabContainer
                      vehicles={vehicles}
                      selectedVehicleId={selectedVehicleId}
                      setSelectedVehicleId={setSelectedVehicleId}
                      onAddVehicleClick={() => setAddVehicleModalOpen(true)}
                      isCompanyAdmin={isCompanyAdmin}
                      onEditVehicle={setEditVehicleTarget}
                      onDeleteVehicle={setDeleteVehicleTarget}
                      onUpdateVehicle={handleUpdateVehicle}
                    />
                  )}
                  {activeTab === "transfers" && (
                    <TransfersPage
                      vehicles={vehicles}
                      trips={trips}
                      insertTrip={insertTrip}
                      updateTrip={updateTrip}
                      removeTrip={removeTrip}
                      isAdmin={isCompanyAdmin}
                      projectOptions={projectOptions}
                      onOpenDriverMode={() => setDriverModeOpen(true)}
                    />
                  )}
                  {activeTab === "maintenance" && (
                    <MaintenanceSection
                      view={maintenanceView}
                      vehicles={vehicles}
                      records={maintenanceRecords}
                      onAddClick={() => setFormModal({ mode: "add", module: "maintenance", initial: null })}
                      onConfirm={(r) => handleConfirmRecord("maintenance", r)}
                      onEditClick={(r) => setFormModal({ mode: "edit", module: "maintenance", initial: r })}
                      onDeleteClick={(r) => setDeleteRecordTarget({ module: "maintenance", record: r })}
                      onUpdateVehicle={handleUpdateVehicle}
                    />
                  )}
                  {activeTab === "incidents" && (
                    <IncidentsPage vehicles={vehicles} incidents={incidents} insertIncident={insertIncident} updateIncident={updateIncident} />
                  )}
                  {activeTab === "compliance" && (
                    <CompliancePage
                      records={complianceRecords}
                      docFilter={complianceDocFilter}
                      onAddClick={() => setFormModal({ mode: "add", module: "compliance", initial: null })}
                      onConfirm={(r) => handleConfirmRecord("compliance", r)}
                      onEditClick={(r) => setFormModal({ mode: "edit", module: "compliance", initial: r })}
                      onDeleteClick={(r) => setDeleteRecordTarget({ module: "compliance", record: r })}
                    />
                  )}
                  {activeTab === "fuel" && (
                    <FuelPage
                      invoices={invoices}
                      orders={invoiceOrders}
                      projects={invoiceProjects}
                      nav={invoiceNav}
                      onNavChange={setInvoiceNav}
                      deadlineDays={deadlineDays}
                      reminders={reminders}
                      isAdmin={isCompanyAdmin}
                      userName={currentUserName}
                      onAddInvoice={handleAddInvoice}
                      onEditInvoice={handleEditInvoice}
                      onConfirmInvoice={handleConfirmInvoice}
                      onDecideInvoice={handleInvoiceDecision}
                      onSaveDeadlines={handleSaveDeadlines}
                      onSetProjectClosed={handleSetProjectClosed}
                    />
                  )}
                  {activeTab === "messages" && <MessagesPage isAdmin={isCompanyAdmin} />}
                  {activeTab === "tasks" && <TasksPage isAdmin={isCompanyAdmin} />}
                  {activeTab === "settings" && <SettingsPage />}
                  {activeTab === "account" && (
                    <AccountPage
                      userName={currentUserName}
                      userEmail={currentUserEmail}
                      userAvatar={currentUserAvatar}
                      onSignOut={signOut}
                      companyName={profile?.company?.name}
                      isSuperAdmin={!!profile?.isSuperAdmin}
                      isCompanyAdmin={isCompanyAdmin}
                    />
                  )}
                  {activeTab === "support" && (
                    <CommunityPage
                      posts={communityPosts}
                      insertCommunityPost={insertCommunityPost}
                      updateCommunityPost={updateCommunityPost}
                      refreshPosts={refreshCommunityPosts}
                      userName={currentUserName}
                      userEmail={currentUserEmail}
                    />
                  )}
                  {activeTab === "admin" && profile?.isSuperAdmin && <AdminCompaniesPage />}
                </>
              )}
            </main>
          </div>

          {notifOpen && (
            <div data-keep-open className="fixed right-6 top-16 z-40 w-96 max-w-[calc(100vw-3rem)] rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
              <NotificationsPanel isAdmin={isCompanyAdmin} onNavigate={goToTab} onClose={() => setNotifOpen(false)} />
            </div>
          )}

          {formModal && (
            <RecordFormModal
              mode={formModal.mode}
              module={formModal.module}
              fixedCategory={formModal.category}
              presetExpenseType={formModal.expenseType}
              presetProject={formModal.project}
              initial={formModal.initial}
              vehicles={vehicles}
              orders={invoiceOrders}
              projectOptions={projectOptions}
              onSave={handleSaveRecord}
              onClose={() => setFormModal(null)}
            />
          )}

          {addVehicleModalOpen && (
            <AddVehicleModal vehicles={vehicles} onSave={handleAddVehicle} onClose={() => setAddVehicleModalOpen(false)} />
          )}

          {editVehicleTarget && (
            <EditVehicleModal vehicle={editVehicleTarget} onSave={handleEditVehicle} onClose={() => setEditVehicleTarget(null)} />
          )}

          {deleteVehicleTarget && (
            <ConfirmModal
              title="Eliminar unidad"
              message={`¿Eliminar "${deleteVehicleTarget.unit}" (${deleteVehicleTarget.plate}) de la flota? Esta acción no se puede deshacer. Si la unidad fue vendida, primero registra su factura de compra-venta en Facturas y Gastos.`}
              confirmLabel="Eliminar"
              danger
              onConfirm={handleDeleteVehicle}
              onClose={() => setDeleteVehicleTarget(null)}
            />
          )}

          {deleteRecordTarget && (
            <ConfirmModal
              title="Eliminar registro"
              message={`¿Eliminar "${
                deleteRecordTarget.record.concept || deleteRecordTarget.record.station || deleteRecordTarget.record.vendor || "este registro"
              }"${deleteRecordTarget.record.unit ? ` (${deleteRecordTarget.record.unit})` : ""}? Esta acción no se puede deshacer.`}
              confirmLabel="Eliminar"
              danger
              onConfirm={handleDeleteRecord}
              onClose={() => setDeleteRecordTarget(null)}
            />
          )}

          <TrackingPill onOpen={() => setDriverModeOpen(true)} />
          {driverModeOpen && <DriverModeModal vehicles={vehicles} trips={trips} onClose={() => setDriverModeOpen(false)} />}
          <ToastHost toast={toast} onDismiss={() => setToast(null)} />
        </div>
        </AppProviders>
      </ToastContext.Provider>
    </DateFormatContext.Provider>
  );
}

/* ---------------------------------------------------------------------- */
/*  Auth gate — decide qué pantalla mostrar                               */
/* ---------------------------------------------------------------------- */

function AuthGate() {
  const { user, loading, passwordRecovery, mfaRequired, profile, profileLoading, profileError, refreshProfile } = useAuth();
  const waiting = loading || (!!user && !passwordRecovery && !mfaRequired && profileLoading);

  // La animación de entrada se retira cuando ya hay algo que mostrar.
  useEffect(() => {
    if (!waiting) hideSplash();
  }, [waiting]);

  if (!isSupabaseConfigured) return <SupabaseSetupNotice />;
  if (waiting) return <FullScreenLoader />;
  if (passwordRecovery) return <UpdatePasswordPage />;
  if (!user) return <LoginPage />;
  if (mfaRequired) return <MfaChallengePage />;
  if (profileError) return <ConnectionErrorPage onRetry={refreshProfile} />;
  if (!profile?.companyId) return <OnboardingPage />;
  // La empresa existe pero la base de datos no la entrega: está suspendida.
  if (!profile.company) return <CompanyInactivePage />;
  return <NavioApp />;
}

export default function NavioDashboard() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}

// Piezas compartidas con los demás archivos de src/ (y con las pruebas).
export {
  supabase,
  AuthContext,
  AuthProvider,
  useAuth,
  ToastContext,
  useToast,
  DateFormatContext,
  useDateFormat,
  DateFormatToggle,
  HomeChartSlot,
  NavioApp,
  Modal,
  ConfirmModal,
  SegmentedControl,
  PillTabs,
  KpiCard,
  TONE_CLASSES,
  usePersistentState,
  useSessionState,
  useSupabaseTable,
  useIsMobileViewport,
  formatDate,
  formatCurrency,
  formatMoney,
  localISODate,
  parseISODate,
  timeAgoLabel,
  countLabel,
  haversineKm,
  avatarUrl,
  personPhoto,
  DocumentCell,
  DocumentPreview,
  sniffDocumentType,
  DOCUMENT_EXTENSIONS,
  DOCUMENT_ACCEPT,
  DOCUMENT_MAX_MB,
  VehiclePhoto,
  isVariableDriver,
  vehicleDriverName,
  vehicleDriverLabel,
  normalizeInvoices,
  getDeadlineDays,
  buildOrders,
  buildProjects,
  FuelPage,
  RecordFormModal,
  InvoiceDetailModal,
  InvoiceDecisionModal,
  INVOICE_NAV_START,
  GPS_STATUS_STYLES,
  LIVE_MAP_STATUS_STYLES,
  FLEET_STATUS_FILTERS,
  computeVehicleStatus,
};
