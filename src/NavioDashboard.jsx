import React, { useState, useMemo, useEffect, useCallback, useContext, useRef, createContext } from "react";
import { createClient } from "@supabase/supabase-js";
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

/* ---------------------------------------------------------------------- */
/*  Supabase table hook — fetch/insert/update/delete compartidos          */
/* ---------------------------------------------------------------------- */

function useSupabaseTable(table, { orderBy = "id", ascending = false, companyId = null } = {}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error: fetchError } = await supabase.from(table).select("*").order(orderBy, { ascending });
    if (fetchError) setError(fetchError.message);
    else {
      setError(null);
      setRows(data ?? []);
    }
    setLoading(false);
  }, [table, orderBy, ascending]);

  useEffect(() => {
    refresh();
  }, [refresh]);

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
  mfaVerifying: false,
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
  approveCompany: async () => {},
  rejectCompany: async () => {},
  updateCompanyCurrency: async () => {},
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
  const [mfaVerifying, setMfaVerifying] = useState(false);
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);

  async function refreshAal() {
    if (!supabase) return;
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (!error && data) {
      setMfaRequired(data.nextLevel === "aal2" && data.currentLevel !== data.nextLevel);
    }
  }

  const refreshProfile = useCallback(async (userId) => {
    if (!supabase || !userId) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }
    setProfileLoading(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("*, company:companies(name, currency, botChannel, botChatId, botLinkCode)")
      .eq("id", userId)
      .single();
    if (!error) setProfile(data);
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

  async function signIn(email, password, token) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;

    // ¿La cuenta tiene verificación en dos pasos activa? Si sí, se resuelve
    // aquí mismo con el campo "Token" del formulario — sin pantalla aparte.
    const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const needsSecondFactor = aalData && aalData.nextLevel === "aal2" && aalData.currentLevel !== aalData.nextLevel;
    if (needsSecondFactor) {
      if (!token || !token.trim()) {
        setMfaRequired(true);
        throw new Error("Esta cuenta tiene verificación en dos pasos. Ingresa el código de tu app de autenticación.");
      }
      // Ya tenemos un token: lo verificamos aquí mismo, sin dejar que la
      // pantalla salte momentáneamente a MfaChallengePage mientras tanto
      // (AuthGate ignora mfaRequired/session mientras mfaVerifying es true).
      setMfaVerifying(true);
      try {
        const { data: factorsData, error: factorsError } = await supabase.auth.mfa.listFactors();
        if (factorsError) throw factorsError;
        const factorId = factorsData?.totp?.find((f) => f.status === "verified")?.id;
        if (!factorId) throw new Error("No se encontró tu método de verificación en dos pasos.");
        await verifyFactor(factorId, token.trim());
      } catch (err) {
        await refreshAal(); // el token era incorrecto: refleja que seguimos en aal1
        throw err;
      } finally {
        setMfaVerifying(false);
      }
    } else {
      setMfaRequired(false);
    }
  }

  async function signUp(email, password, fullName) {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
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

  async function approveCompany(companyId) {
    const { data, error } = await supabase.rpc("approve_company", { target_company_id: companyId });
    if (error) throw error;
    return data; // nuevo inviteCode
  }

  async function rejectCompany(companyId) {
    const { error } = await supabase.rpc("reject_company", { target_company_id: companyId });
    if (error) throw error;
  }

  async function updateCompanyCurrency(currency) {
    if (!profile?.companyId) throw new Error("No perteneces a ninguna empresa todavía.");
    const { error } = await supabase.from("companies").update({ currency }).eq("id", profile.companyId);
    if (error) throw error;
    await refreshProfile(session.user.id);
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
        mfaVerifying,
        signIn,
        signUp,
        signOut,
        resetPassword,
        updatePassword,
        joinCompanyWithCode,
        requestCompany,
        approveCompany,
        rejectCompany,
        updateCompanyCurrency,
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
/*  Login — pantallas de autenticación                                    */
/* ---------------------------------------------------------------------- */

function AuthLayout({ children }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-8 flex items-center justify-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-sm font-extrabold text-white">N</div>
          <span className="text-xl font-extrabold tracking-tight text-slate-900">NAVIO</span>
        </div>
        {children}
      </div>
    </div>
  );
}

function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f8fafc]">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-400">
        <RefreshCw size={16} className="animate-spin" /> Cargando...
      </div>
    </div>
  );
}

function SupabaseSetupNotice() {
  return (
    <AuthLayout>
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
        <div className="flex items-center gap-2 text-amber-700">
          <AlertTriangle size={18} />
          <h1 className="text-sm font-bold">Falta configurar Supabase</h1>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-amber-700">
          Para activar el login real, crea un proyecto gratis en <span className="font-semibold">supabase.com</span>,
          ve a Project Settings → API, y pega el "Project URL" y la llave "anon public" en las constantes{" "}
          <code className="rounded bg-amber-100 px-1 py-0.5">SUPABASE_URL</code> y{" "}
          <code className="rounded bg-amber-100 px-1 py-0.5">SUPABASE_ANON_KEY</code> al inicio de{" "}
          <code className="rounded bg-amber-100 px-1 py-0.5">src/NavioDashboard.jsx</code>.
        </p>
      </div>
    </AuthLayout>
  );
}

function AuthErrorMessage({ message }) {
  if (!message) return null;
  return (
    <p className="flex items-center gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
      <AlertTriangle size={13} className="shrink-0" /> {message}
    </p>
  );
}

function translateAuthError(error) {
  const msg = error?.message || "";
  if (msg.includes("Invalid login credentials")) return "Correo o contraseña incorrectos.";
  if (msg.includes("User already registered")) return "Ya existe una cuenta con ese correo.";
  if (msg.toLowerCase().includes("password should be at least")) return "La contraseña debe tener al menos 6 caracteres.";
  if (msg.includes("Email not confirmed")) return "Confirma tu correo antes de iniciar sesión (revisa tu bandeja de entrada).";
  if (msg.includes("rate limit")) return "Demasiados intentos. Espera un momento y vuelve a intentar.";
  return msg || "Ocurrió un error inesperado. Intenta de nuevo.";
}

const AUTH_MODES = { SIGN_IN: "signin", SIGN_UP: "signup", FORGOT: "forgot" };

function LoginPage() {
  const { signIn, signUp, resetPassword } = useAuth();
  const [mode, setMode] = useState(AUTH_MODES.SIGN_IN);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const inputClass =
    "w-full rounded-md border border-slate-300 px-3 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
  const labelClass = "mb-1.5 block text-xs font-semibold text-slate-600";

  function resetMessages() {
    setError("");
    setNotice("");
  }

  function switchMode(next) {
    resetMessages();
    setMode(next);
  }

  async function handleSignIn(e) {
    e.preventDefault();
    resetMessages();
    setLoading(true);
    try {
      await signIn(email.trim(), password, token);
      setToken("");
    } catch (err) {
      setError(translateAuthError(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleSignUp(e) {
    e.preventDefault();
    resetMessages();
    if (!fullName.trim()) {
      setError("Ingresa tu nombre completo.");
      return;
    }
    if (password.length < 6) {
      setError("La contraseña debe tener al menos 6 caracteres.");
      return;
    }
    setLoading(true);
    try {
      await signUp(email.trim(), password, fullName.trim());
      setNotice("Cuenta creada. Revisa tu correo para confirmar tu cuenta antes de iniciar sesión.");
      setMode(AUTH_MODES.SIGN_IN);
    } catch (err) {
      setError(translateAuthError(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleForgot(e) {
    e.preventDefault();
    resetMessages();
    setLoading(true);
    try {
      await resetPassword(email.trim());
      setNotice("Te enviamos un enlace para restablecer tu contraseña. Revisa tu correo.");
    } catch (err) {
      setError(translateAuthError(err));
    } finally {
      setLoading(false);
    }
  }

  const handleSubmit = mode === AUTH_MODES.SIGN_IN ? handleSignIn : mode === AUTH_MODES.SIGN_UP ? handleSignUp : handleForgot;

  return (
    <AuthLayout>
      <div className="rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-bold text-slate-900">
          {mode === AUTH_MODES.SIGN_IN && "Iniciar sesión"}
          {mode === AUTH_MODES.SIGN_UP && "Crear cuenta"}
          {mode === AUTH_MODES.FORGOT && "Restablecer contraseña"}
        </h1>
        <p className="mt-1.5 text-xs text-slate-500">
          {mode === AUTH_MODES.SIGN_IN && "Accede a tu panel de gestión logística."}
          {mode === AUTH_MODES.SIGN_UP && "Crea una cuenta para empezar a usar Navio."}
          {mode === AUTH_MODES.FORGOT && "Te enviaremos un enlace a tu correo."}
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {mode === AUTH_MODES.SIGN_UP && (
            <div>
              <label className={labelClass}>Nombre completo</label>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Ej. Johana Ramírez"
                className={inputClass}
              />
            </div>
          )}
          <div>
            <label className={labelClass}>Correo electrónico</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="usuario@empresa.com"
              autoComplete="username"
              className={inputClass}
            />
            {mode === AUTH_MODES.SIGN_IN && (
              <p className="mt-1 text-[11px] text-slate-400">Usa exactamente el mismo correo con el que te registraste.</p>
            )}
          </div>
          {mode !== AUTH_MODES.FORGOT && (
            <div>
              <label className={labelClass}>Contraseña</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className={`${inputClass} pr-9`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
          )}
          {mode === AUTH_MODES.SIGN_IN && (
            <div>
              <label className={labelClass}>Token</label>
              <input
                value={token}
                onChange={(e) => setToken(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                placeholder="123456"
                autoComplete="one-time-code"
                className={inputClass}
              />
              <p className="mt-1 text-[11px] text-slate-400">
                Solo si activaste verificación en dos pasos en Cuenta → Seguridad. Déjalo en blanco si no.
              </p>
            </div>
          )}

          {mode === AUTH_MODES.SIGN_IN && (
            <button type="button" onClick={() => switchMode(AUTH_MODES.FORGOT)} className="text-[11px] font-semibold text-blue-600 hover:text-blue-700">
              ¿Olvidaste tu contraseña?
            </button>
          )}

          <AuthErrorMessage message={error} />
          {notice && (
            <p className="flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
              <CheckCircle2 size={13} className="shrink-0" /> {notice}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {loading
              ? "Procesando..."
              : mode === AUTH_MODES.SIGN_IN
              ? "Iniciar sesión"
              : mode === AUTH_MODES.SIGN_UP
              ? "Crear cuenta"
              : "Enviar enlace"}
          </button>
        </form>

        <div className="mt-5 text-center text-xs text-slate-500">
          {mode === AUTH_MODES.SIGN_IN && (
            <>
              ¿No tienes cuenta?{" "}
              <button onClick={() => switchMode(AUTH_MODES.SIGN_UP)} className="font-semibold text-blue-600 hover:text-blue-700">
                Crea una
              </button>
            </>
          )}
          {(mode === AUTH_MODES.SIGN_UP || mode === AUTH_MODES.FORGOT) && (
            <button onClick={() => switchMode(AUTH_MODES.SIGN_IN)} className="font-semibold text-blue-600 hover:text-blue-700">
              ← Volver a iniciar sesión
            </button>
          )}
        </div>
      </div>
    </AuthLayout>
  );
}

function UpdatePasswordPage() {
  const { updatePassword } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (password.length < 6) {
      setError("La contraseña debe tener al menos 6 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setLoading(true);
    try {
      await updatePassword(password);
    } catch (err) {
      setError(translateAuthError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-bold text-slate-900">Elige una nueva contraseña</h1>
        <p className="mt-1 text-xs text-slate-500">Tu enlace de recuperación es válido. Define tu nueva contraseña para continuar.</p>
        <form onSubmit={handleSubmit} className="mt-5 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">Nueva contraseña</label>
            <div className="relative">
              <Lock size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
              <input
                type={showPassword ? "text" : "password"}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-200 py-2 pl-8 pr-9 text-sm focus:border-blue-400 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">Confirmar contraseña</label>
            <input
              type={showPassword ? "text" : "password"}
              required
              minLength={6}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
            />
          </div>
          <AuthErrorMessage message={error} />
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {loading ? "Guardando..." : "Guardar nueva contraseña"}
          </button>
        </form>
      </div>
    </AuthLayout>
  );
}

function MfaChallengePage() {
  const { verifyFactor, listMFAFactors, signOut } = useAuth();
  const [factorId, setFactorId] = useState(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingFactors, setLoadingFactors] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    listMFAFactors()
      .then((data) => {
        if (cancelled) return;
        const verifiedTotp = data?.totp?.find((f) => f.status === "verified") ?? data?.totp?.[0];
        setFactorId(verifiedTotp?.id ?? null);
      })
      .catch((err) => !cancelled && setError(translateAuthError(err)))
      .finally(() => !cancelled && setLoadingFactors(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!factorId) {
      setError("No se encontró tu método de verificación en dos pasos.");
      return;
    }
    setLoading(true);
    try {
      await verifyFactor(factorId, code.trim());
    } catch (err) {
      setError(translateAuthError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-bold text-slate-900">Verificación en dos pasos</h1>
        <p className="mt-1 text-xs text-slate-500">
          Ingresa el código de 6 dígitos de tu app de autenticación (Google Authenticator, Authy, etc.).
        </p>
        {loadingFactors ? (
          <p className="mt-4 text-xs text-slate-400">Cargando...</p>
        ) : (
          <form onSubmit={handleSubmit} className="mt-5 space-y-3">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoFocus
              placeholder="123456"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-center text-lg tracking-[0.5em] focus:border-blue-400 focus:outline-none"
            />
            <AuthErrorMessage message={error} />
            <button
              type="submit"
              disabled={loading || code.length < 6}
              className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {loading ? "Verificando..." : "Verificar"}
            </button>
          </form>
        )}
        <button onClick={() => signOut()} className="mt-4 w-full text-center text-[11px] font-semibold text-slate-400 hover:text-slate-600">
          Cancelar y cerrar sesión
        </button>
      </div>
    </AuthLayout>
  );
}

/* ---------------------------------------------------------------------- */
/*  Onboarding — vincular la cuenta a una empresa                        */
/* ---------------------------------------------------------------------- */

const COMPANY_INDUSTRIES = ["Transporte de carga", "Transporte de pasajeros", "Logística y distribución", "Construcción", "Otro"];
const FLEET_SIZE_RANGES = ["1-5 unidades", "6-20 unidades", "21-50 unidades", "Más de 50 unidades"];

const onboardingInputClass =
  "w-full rounded-md border border-slate-300 px-3 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
const onboardingLabelClass = "mb-1.5 block text-xs font-semibold text-slate-600";

function OnboardingPage() {
  const { user, joinCompanyWithCode, requestCompany, signOut } = useAuth();
  const { showToast } = useToast();
  const [tab, setTab] = useState("join");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [myRequest, setMyRequest] = useState(undefined); // undefined = cargando, null = sin solicitud

  const [code, setCode] = useState("");

  const [companyName, setCompanyName] = useState("");
  const [industry, setIndustry] = useState(COMPANY_INDUSTRIES[0]);
  const [fleetSize, setFleetSize] = useState(FLEET_SIZE_RANGES[0]);
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState(user?.email ?? "");
  const [contactPhone, setContactPhone] = useState("");
  const [needs, setNeeds] = useState("");

  const loadMyRequest = useCallback(() => {
    if (!supabase || !user) return;
    supabase
      .from("companies")
      .select("*")
      .eq("requestedBy", user.id)
      .order("createdAt", { ascending: false })
      .limit(1)
      .then(({ data }) => setMyRequest(data && data.length > 0 ? data[0] : null));
  }, [user]);

  useEffect(() => {
    loadMyRequest();
  }, [loadMyRequest]);

  async function handleJoin(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await joinCompanyWithCode(code);
      showToast("Te uniste a la empresa correctamente.");
    } catch (err) {
      setError(err.message || "Código inválido.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRequest(e) {
    e.preventDefault();
    setError("");
    if (!companyName.trim() || !contactName.trim() || !contactEmail.trim()) {
      setError("Completa al menos el nombre de la empresa y los datos de contacto.");
      return;
    }
    setLoading(true);
    try {
      await requestCompany({
        name: companyName.trim(),
        industry,
        fleetSize,
        contactName: contactName.trim(),
        contactEmail: contactEmail.trim(),
        contactPhone: contactPhone.trim(),
        needs: needs.trim(),
      });
      loadMyRequest();
    } catch (err) {
      setError(err.message || "No se pudo enviar la solicitud.");
    } finally {
      setLoading(false);
    }
  }

  if (myRequest === undefined) {
    return <FullScreenLoader />;
  }

  if (myRequest && myRequest.status !== "rejected") {
    return (
      <AuthLayout>
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
          <Clock size={26} className="mx-auto mb-3 text-amber-500" />
          <h1 className="text-lg font-bold text-slate-900">Solicitud en revisión</h1>
          <p className="mt-2 text-xs text-slate-500">
            Tu solicitud para registrar <span className="font-semibold text-slate-700">{myRequest.name}</span> está pendiente de
            aprobación. Te avisaremos en cuanto quede lista.
          </p>
          <button onClick={() => signOut()} className="mt-5 text-xs font-semibold text-blue-600 hover:text-blue-700">
            Cerrar sesión
          </button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div className="rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-lg font-bold text-slate-900">Falta un paso</h1>
        <p className="mt-1.5 text-xs text-slate-500">Tu cuenta todavía no está vinculada a ninguna empresa.</p>

        {myRequest?.status === "rejected" && (
          <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-[11px] font-medium text-rose-700">
            Tu solicitud anterior para "{myRequest.name}" no fue aprobada. Puedes intentar de nuevo o unirte con un código.
          </p>
        )}

        <div className="mt-5 flex gap-1.5 rounded-lg bg-slate-100 p-1">
          {[
            { id: "join", label: "Tengo un código" },
            { id: "request", label: "Registrar mi empresa" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setError("");
                setTab(t.id);
              }}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                tab === t.id ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "join" ? (
          <form onSubmit={handleJoin} className="mt-5 space-y-3">
            <div>
              <label className={onboardingLabelClass}>Código de invitación</label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="Ej. DEMO-NAVIO"
                className={onboardingInputClass}
              />
            </div>
            <AuthErrorMessage message={error} />
            <button
              type="submit"
              disabled={loading || !code.trim()}
              className="w-full rounded-md bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {loading ? "Verificando..." : "Unirme"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleRequest} className="mt-5 space-y-3">
            <div>
              <label className={onboardingLabelClass}>Nombre de la empresa</label>
              <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Ej. SIISA" className={onboardingInputClass} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={onboardingLabelClass}>Giro / industria</label>
                <select value={industry} onChange={(e) => setIndustry(e.target.value)} className={onboardingInputClass}>
                  {COMPANY_INDUSTRIES.map((i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={onboardingLabelClass}>Tamaño de flota</label>
                <select value={fleetSize} onChange={(e) => setFleetSize(e.target.value)} className={onboardingInputClass}>
                  {FLEET_SIZE_RANGES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className={onboardingLabelClass}>Persona de contacto para esta empresa</label>
              <input value={contactName} onChange={(e) => setContactName(e.target.value)} className={onboardingInputClass} />
              <p className="mt-1 text-[10px] text-slate-400">
                No tiene que ser tu nombre de cuenta — es a quién contactar sobre esta empresa dentro de Navío.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={onboardingLabelClass}>Correo de contacto</label>
                <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className={onboardingInputClass} />
              </div>
              <div>
                <label className={onboardingLabelClass}>Teléfono</label>
                <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className={onboardingInputClass} />
              </div>
            </div>
            <div>
              <label className={onboardingLabelClass}>¿Qué necesitas de Navío?</label>
              <textarea
                value={needs}
                onChange={(e) => setNeeds(e.target.value)}
                rows={3}
                placeholder="Cuéntanos brevemente qué buscas gestionar (mantenimiento, combustible, trámites...)."
                className={onboardingInputClass}
              />
            </div>
            <AuthErrorMessage message={error} />
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {loading ? "Enviando..." : "Enviar solicitud"}
            </button>
          </form>
        )}

        <button onClick={() => signOut()} className="mt-5 w-full text-center text-[11px] font-semibold text-slate-400 hover:text-slate-600">
          Cerrar sesión
        </button>
      </div>
    </AuthLayout>
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

const HEALTH_TONE = (score) =>
  score >= 80
    ? { className: "bg-emerald-50 text-emerald-700 ring-emerald-200", label: "Óptimo" }
    : score >= 50
    ? { className: "bg-amber-50 text-amber-700 ring-amber-200", label: "Atención" }
    : { className: "bg-rose-50 text-rose-700 ring-rose-200", label: "Crítico" };

/* ---------------------------------------------------------------------- */
/*  Mock data — Fleet                                                     */
/* ---------------------------------------------------------------------- */

const VEHICLES_FULL = [
  {
    id: 1,
    unit: "Unidad 12",
    plate: "YZA-142-B",
    brand: "Kenworth",
    model: "T680",
    year: 2022,
    color: "Blanco",
    photo: "https://picsum.photos/seed/navio-unidad12/480/280",
    healthScore: 88,
    kmActual: 152400,
    kmProximoServicio: 155000,
    oilType: "Sintético 15W-40",
    avgConsumption: 3.8,
    driver: {
      name: "Ricardo Pérez",
      phone: "+52 921 123 4567",
      photo: "https://api.dicebear.com/7.x/avataaars/svg?seed=RicardoPerez",
      license: "LIC-8845213",
      licenseExpiry: "2026-09-02",
    },
    insurance: { company: "Qualitas", folio: "QLT-559012", expiry: "2026-11-15", pdfUrl: "#" },
    circulationCard: { folio: "TC-2026-4471", pdfUrl: "#" },
    verification: { hologram: "00 (Doble Cero)", validity: "2027-02-28" },
    warranty: { engine: "Motor Cummins X15 — vigente hasta 2027-06-30", parts: "Piezas de transmisión — vigente hasta 2026-12-31" },
    documentHistory: [
      { doc: "Póliza de Seguro (anterior)", expired: "2025-11-15", pdfUrl: "#" },
      { doc: "Tarjeta de Circulación (anterior)", expired: "2025-04-30", pdfUrl: "#" },
    ],
    maintenancePanel: { kmRestante: 2600, coolantType: "Refrigerante Verde", brakesLast: "2026-06-18", oilLast: "2026-07-02" },
    tires: { frontDepth: 7.2, rearDepth: 5.8, frontSize: "185/60 R15", rearSize: "190/60 R15", psi: 110, lastRotation: "2026-07-15" },
    history: [
      { date: "2026-07-02", concept: "Cambio de aceite y filtro", cost: 1850, workshop: "Taller Central Coatzacoalcos" },
      { date: "2026-06-18", concept: "Cambio de balatas delanteras", cost: 3200, workshop: "Frenos y Diesel del Sur" },
      { date: "2026-05-10", concept: "Alineación y balanceo", cost: 950, workshop: "Llantas del Golfo" },
    ],
    gps: {
      status: "moving",
      address: "Carretera Nanchital–Coatzacoalcos, km 8.4",
      speed: 68,
      lastUpdate: "hace 2 min",
      fuelPercent: 62,
      signalType: "GPS Hardware",
      x: 30,
      y: 55,
      mode: "directo",
      destination: "Coatzacoalcos",
      eta: "1.1 hrs",
      stops: [],
    },
    appCapture: { photoUrl: "https://picsum.photos/seed/navio-capture12/480/280", timestamp: "12/08/2026 09:14", driverName: "Ricardo Pérez" },
  },
  {
    id: 2,
    unit: "Unidad 07",
    plate: "XKT-880-A",
    brand: "Freightliner",
    model: "Cascadia",
    year: 2020,
    color: "Gris",
    photo: "https://picsum.photos/seed/navio-unidad07/480/280",
    healthScore: 62,
    kmActual: 208900,
    kmProximoServicio: 210000,
    oilType: "Sintético 15W-40",
    avgConsumption: 3.4,
    driver: {
      name: "Lucía Gómez",
      phone: "+52 921 234 5678",
      photo: "https://api.dicebear.com/7.x/avataaars/svg?seed=LuciaGomez",
      license: "LIC-7723190",
      licenseExpiry: "2026-08-25",
    },
    insurance: { company: "GNP Seguros", folio: "GNP-330217", expiry: "2026-08-30", pdfUrl: "#" },
    circulationCard: { folio: "TC-2025-9012", pdfUrl: "#" },
    verification: { hologram: "0 (Cero)", validity: "2026-09-30" },
    warranty: { engine: "Motor Detroit DD15 — vigente hasta 2026-10-01", parts: "Piezas de suspensión — vencida 2026-02-15" },
    documentHistory: [
      { doc: "Póliza de Seguro (anterior)", expired: "2025-08-30", pdfUrl: "#" },
      { doc: "Verificación Vehicular (anterior)", expired: "2026-02-28", pdfUrl: "#" },
    ],
    maintenancePanel: { kmRestante: 1100, coolantType: "Refrigerante Rosa (OAT)", brakesLast: "2026-08-08", oilLast: "2026-06-15" },
    tires: { frontDepth: 6.1, rearDepth: 4.1, frontSize: "185/60 R15", rearSize: "190/60 R15", psi: 105, lastRotation: "2026-05-30" },
    history: [
      { date: "2026-08-08", concept: "Cambio de balatas delanteras", cost: 3200, workshop: "Frenos y Diesel del Sur" },
      { date: "2026-06-15", concept: "Cambio de aceite y filtro", cost: 1780, workshop: "Taller Central Coatzacoalcos" },
      { date: "2026-04-02", concept: "Reparación de suspensión", cost: 5400, workshop: "Suspensiones del Istmo" },
    ],
    gps: {
      status: "stopped",
      address: "Bama Solís, Coatzacoalcos",
      speed: 0,
      lastUpdate: "hace 8 min",
      fuelPercent: 18,
      signalType: "Smartphone App",
      x: 55,
      y: 40,
      mode: "libre",
      destination: null,
      eta: null,
      stops: [{ place: "Bama Solís", time: "17:52" }],
    },
    appCapture: { photoUrl: "https://picsum.photos/seed/navio-capture07/480/280", timestamp: "11/08/2026 17:52", driverName: "Lucía Gómez" },
  },
  {
    id: 3,
    unit: "Unidad 09",
    plate: "WPL-215-C",
    brand: "International",
    model: "LT625",
    year: 2019,
    color: "Azul",
    photo: "https://picsum.photos/seed/navio-unidad09/480/280",
    healthScore: 41,
    kmActual: 261300,
    kmProximoServicio: 262000,
    oilType: "Mineral 20W-50",
    avgConsumption: 2.9,
    driver: {
      name: "Marco Aguilar",
      phone: "+52 921 345 6789",
      photo: "https://api.dicebear.com/7.x/avataaars/svg?seed=MarcoAguilar",
      license: "LIC-6612044",
      licenseExpiry: "2027-01-14",
    },
    insurance: { company: "AXA Seguros", folio: "AXA-118845", expiry: "2026-09-05", pdfUrl: "#" },
    circulationCard: { folio: "TC-2025-3387", pdfUrl: "#" },
    verification: { hologram: "1 (Uno)", validity: "2026-08-31" },
    warranty: { engine: "Motor Navistar N9 — vencida 2025-12-01", parts: "Piezas de embrague — vencida 2026-01-10" },
    documentHistory: [
      { doc: "Tarjeta de Circulación (anterior)", expired: "2024-12-31", pdfUrl: "#" },
      { doc: "Licencia de Conducir (anterior)", expired: "2025-06-14", pdfUrl: "#" },
    ],
    maintenancePanel: { kmRestante: 700, coolantType: "Refrigerante Verde", brakesLast: "2026-07-22", oilLast: "2026-05-20" },
    tires: { frontDepth: 4.8, rearDepth: 3.6, frontSize: "185/60 R15", rearSize: "190/60 R15", psi: 98, lastRotation: "2026-03-11" },
    history: [
      { date: "2026-07-22", concept: "Servicio completo de frenos", cost: 4100, workshop: "Frenos y Diesel del Sur" },
      { date: "2026-05-20", concept: "Cambio de aceite y filtro", cost: 1650, workshop: "Taller Central Coatzacoalcos" },
      { date: "2026-02-18", concept: "Cambio de embrague", cost: 7200, workshop: "Transmisiones Golfo" },
    ],
    gps: {
      status: "resting",
      address: "Patio Nanchital",
      speed: 0,
      lastUpdate: "hace 3 h",
      fuelPercent: 44,
      signalType: "GPS Hardware",
      x: 15,
      y: 75,
      mode: "libre",
      destination: null,
      eta: null,
      stops: [{ place: "Patio Nanchital", time: "08:30" }],
    },
    appCapture: { photoUrl: "https://picsum.photos/seed/navio-capture09/480/280", timestamp: "10/08/2026 08:30", driverName: "Marco Aguilar" },
  },
  {
    id: 4,
    unit: "Unidad 03",
    plate: "VJH-004-D",
    brand: "Volvo",
    model: "VNL 760",
    year: 2023,
    color: "Rojo",
    photo: "https://picsum.photos/seed/navio-unidad03/480/280",
    healthScore: 95,
    kmActual: 64200,
    kmProximoServicio: 70000,
    oilType: "Sintético 5W-30",
    avgConsumption: 4.3,
    driver: {
      name: "Diana Ruiz",
      phone: "+52 921 456 7890",
      photo: "https://api.dicebear.com/7.x/avataaars/svg?seed=DianaRuiz",
      license: "LIC-9910238",
      licenseExpiry: "2027-05-19",
    },
    insurance: { company: "Qualitas", folio: "QLT-772104", expiry: "2027-01-20", pdfUrl: "#" },
    circulationCard: { folio: "TC-2026-1120", pdfUrl: "#" },
    verification: { hologram: "00 (Doble Cero)", validity: "2027-06-30" },
    warranty: { engine: "Motor Volvo D13 — vigente hasta 2028-01-15", parts: "Piezas de frenos — vigente hasta 2027-01-20" },
    documentHistory: [
      { doc: "Tarjeta de Circulación (anterior)", expired: "2025-01-20", pdfUrl: "#" },
    ],
    maintenancePanel: { kmRestante: 5800, coolantType: "Refrigerante Azul (IAT)", brakesLast: "2026-05-02", oilLast: "2026-07-28" },
    tires: { frontDepth: 8.4, rearDepth: 7.9, frontSize: "185/60 R15", rearSize: "190/60 R15", psi: 112, lastRotation: "2026-07-01" },
    history: [
      { date: "2026-08-01", concept: "Verificación vehicular", cost: 850, workshop: "Verificentro Coatzacoalcos" },
      { date: "2026-07-28", concept: "Revisión de niveles", cost: 0, workshop: "Taller Central Coatzacoalcos" },
      { date: "2026-05-02", concept: "Cambio de balatas traseras", cost: 2900, workshop: "Frenos y Diesel del Sur" },
    ],
    gps: {
      status: "moving",
      address: "Av. Independencia, Coatzacoalcos",
      speed: 42,
      lastUpdate: "hace 1 min",
      fuelPercent: 81,
      signalType: "GPS Hardware",
      x: 60,
      y: 65,
      mode: "directo",
      destination: "Coatzacoalcos Centro",
      eta: "22 min",
      stops: [],
    },
    appCapture: { photoUrl: "https://picsum.photos/seed/navio-capture03/480/280", timestamp: "12/08/2026 07:05", driverName: "Diana Ruiz" },
  },
  {
    id: 5,
    unit: "Unidad 21",
    plate: "TBN-561-E",
    brand: "Kenworth",
    model: "T880",
    year: 2021,
    color: "Negro",
    photo: "https://picsum.photos/seed/navio-unidad21/480/280",
    healthScore: 74,
    kmActual: 118750,
    kmProximoServicio: 121000,
    oilType: "Sintético 15W-40",
    avgConsumption: 3.6,
    driver: {
      name: "José Torres",
      phone: "+52 921 567 8901",
      photo: "https://api.dicebear.com/7.x/avataaars/svg?seed=JoseTorres",
      license: "LIC-5591027",
      licenseExpiry: "2026-12-11",
    },
    insurance: { company: "GNP Seguros", folio: "GNP-441093", expiry: "2026-10-08", pdfUrl: "#" },
    circulationCard: { folio: "TC-2026-6650", pdfUrl: "#" },
    verification: { hologram: "0 (Cero)", validity: "2026-11-30" },
    warranty: { engine: "Motor Cummins X15 — vigente hasta 2026-09-10", parts: "Piezas de transmisión — vencida 2026-03-05" },
    documentHistory: [
      { doc: "Póliza de Seguro (anterior)", expired: "2025-10-08", pdfUrl: "#" },
      { doc: "Tarjeta de Circulación (anterior)", expired: "2025-12-31", pdfUrl: "#" },
    ],
    maintenancePanel: { kmRestante: 2250, coolantType: "Refrigerante Verde", brakesLast: "2026-04-19", oilLast: "2026-06-30" },
    tires: { frontDepth: 6.6, rearDepth: 5.2, frontSize: "185/60 R15", rearSize: "190/60 R15", psi: 108, lastRotation: "2026-08-05" },
    history: [
      { date: "2026-08-05", concept: "Rotación de llantas 4 posiciones", cost: 600, workshop: "Llantas del Golfo" },
      { date: "2026-06-30", concept: "Cambio de aceite y filtro", cost: 1900, workshop: "Taller Central Coatzacoalcos" },
      { date: "2026-04-19", concept: "Cambio de balatas delanteras", cost: 3050, workshop: "Frenos y Diesel del Sur" },
    ],
    gps: {
      status: "alert",
      address: "Puente peatonal, Coatzacoalcos — tráfico intenso",
      speed: 12,
      lastUpdate: "hace 30 seg",
      fuelPercent: 37,
      signalType: "WhatsApp Share",
      x: 70,
      y: 28,
      mode: "directo",
      destination: "Coatzacoalcos",
      eta: "1.2 hrs",
      stops: [],
    },
    appCapture: { photoUrl: "https://picsum.photos/seed/navio-capture21/480/280", timestamp: "12/08/2026 10:47", driverName: "José Torres" },
  },
];

// Nota: "resting"/"alert" siguen aquí porque la ficha del vehículo
// (VehicleGpsPanel, expediente) todavía usa el campo mock "vehicle.gps"
// como resumen decorativo — es un dato distinto de la posición real
// que ahora alimenta Mapa en Vivo (tabla vehicle_positions).
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
/*  Mock data — Maintenance                                               */
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

const MAINTENANCE_RECORDS_SEED = [
  { id: 101, unit: "Unidad 12", plate: "YZA-142-B", category: "engine", concept: "Cambio de aceite y filtro", amount: 1850, date: "2026-08-10", vendor: "Taller Central Coatzacoalcos", invoiceFolio: "FA-33210", origin: "whatsapp", status: "pending", notes: "Reportado por conductor R. Pérez" },
  { id: 102, unit: "Unidad 07", plate: "XKT-880-A", category: "brakes", concept: "Cambio de balatas delanteras", amount: 3200, date: "2026-08-08", vendor: "Frenos y Diesel del Sur", invoiceFolio: "FA-33198", origin: "telegram", status: "pending", notes: "" },
  { id: 103, unit: "Unidad 21", plate: "TBN-561-E", category: "tires", concept: "Rotación de llantas 4 posiciones", amount: 600, date: "2026-08-05", vendor: "Llantas del Golfo", invoiceFolio: "FA-33172", origin: "manual", status: "verified", notes: "Registrado por taller interno" },
  { id: 104, unit: "Unidad 03", plate: "VJH-004-D", category: "paperwork", concept: "Verificación vehicular", amount: 850, date: "2026-08-01", vendor: "Verificentro Coatzacoalcos", invoiceFolio: "FA-33140", origin: "whatsapp", status: "pending", notes: "" },
  { id: 105, unit: "Unidad 09", plate: "WPL-215-C", category: "brakes", concept: "Servicio completo de frenos", amount: 4100, date: "2026-07-22", vendor: "Frenos y Diesel del Sur", invoiceFolio: "FA-33065", origin: "whatsapp", status: "verified", notes: "Validado por supervisor" },
  { id: 106, unit: "Unidad 12", plate: "YZA-142-B", category: "engine", concept: "Revisión de niveles", amount: 0, date: "2026-07-28", vendor: "Taller Central Coatzacoalcos", invoiceFolio: "", origin: "manual", status: "verified", notes: "" },
];

/* ---------------------------------------------------------------------- */
/*  Mock data — Compliance                                                */
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
const COMPLIANCE_RECORDS_SEED = [
  { id: 201, unit: "Unidad 12", plate: "YZA-142-B", docType: "Tenencia", concept: "Pago de tenencia estatal 2026", amount: 1850, date: "2026-08-09", dueDate: "2026-08-31", paymentStatus: "Pendiente de Pago", vendor: "Sec. Finanzas Veracruz", invoiceFolio: "TEN-2026-0912", origin: "whatsapp", status: "pending", notes: "" },
  { id: 202, unit: "Unidad 07", plate: "XKT-880-A", docType: "Póliza de Seguro", concept: "Renovación de póliza anual", amount: 18400, date: "2026-08-02", dueDate: "2026-08-30", paymentStatus: "Pendiente de Pago", vendor: "GNP Seguros", invoiceFolio: "GNP-330217", origin: "manual", status: "verified", notes: "Cotización enviada al cliente" },
  { id: 203, unit: "Unidad 03", plate: "VJH-004-D", docType: "Verificación Vehicular", concept: "Verificación semestral", amount: 850, date: "2026-08-01", dueDate: "2027-01-31", paymentStatus: "Pagado", vendor: "Verificentro Coatzacoalcos", invoiceFolio: "FA-33140", origin: "whatsapp", status: "verified", notes: "" },
  { id: 204, unit: "Unidad 09", plate: "WPL-215-C", docType: "Licencia de Conducir", concept: "Renovación licencia federal — M. Aguilar", amount: 2100, date: "2026-07-29", dueDate: "2027-01-14", paymentStatus: "Pagado", vendor: "SICT", invoiceFolio: "LIC-6612044", origin: "telegram", status: "pending", notes: "" },
  { id: 205, unit: "Unidad 21", plate: "TBN-561-E", docType: "Tarjeta de Circulación", concept: "Refrendo tarjeta de circulación", amount: 620, date: "2026-07-20", dueDate: "2026-12-31", paymentStatus: "Pagado", vendor: "Sec. Finanzas Veracruz", invoiceFolio: "TC-2026-6650", origin: "manual", status: "verified", notes: "" },
];

/* ---------------------------------------------------------------------- */
/*  Mock data — Fuel                                                      */
/* ---------------------------------------------------------------------- */

function getFuelWidgets(records, currency = "MXN") {
  const totalSpend = records.reduce((s, r) => s + (r.amount || 0), 0);
  const totalLiters = records.reduce((s, r) => s + (r.liters || 0), 0);
  const withEfficiency = records.filter((r) => r.efficiency);
  const avgEfficiency = withEfficiency.length
    ? withEfficiency.reduce((s, r) => s + r.efficiency, 0) / withEfficiency.length
    : null;
  const ocrCount = records.filter((r) => r.origin === "whatsapp").length;
  return [
    { id: "totalSpend", label: "Gasto Total del Mes", icon: DollarSign, value: formatCurrency(totalSpend, currency), detail: `${records.length} registro${records.length === 1 ? "" : "s"}`, tone: "blue" },
    { id: "liters", label: "Litros Consumidos", icon: Droplet, value: `${totalLiters.toLocaleString()} L`, detail: "Total registrado", tone: "sky" },
    { id: "efficiency", label: "Rendimiento Promedio", icon: Activity, value: avgEfficiency ? `${avgEfficiency.toFixed(1)} km/L` : "—", detail: "Flota completa", tone: "emerald" },
    { id: "ocr", label: "Tickets Procesados por OCR", icon: Camera, value: `${ocrCount} ticket${ocrCount === 1 ? "" : "s"}`, detail: "Vía WhatsApp", tone: "slate" },
  ];
}

const FUEL_RECORDS_SEED = [
  { id: 301, unit: "Unidad 07", plate: "XKT-880-A", station: "Pemex Nanchital", liters: 180, amount: 3960, odometer: 208900, efficiency: 3.4, date: "2026-08-12", vendor: "Pemex Nanchital", invoiceFolio: "T-99021", origin: "whatsapp", status: "pending", notes: "Ticket foto procesado por OCR" },
  { id: 302, unit: "Unidad 12", plate: "YZA-142-B", station: "Pemex Coatzacoalcos Centro", liters: 210, amount: 4620, odometer: 152400, efficiency: 3.8, date: "2026-08-11", vendor: "Pemex Coatzacoalcos Centro", invoiceFolio: "T-98884", origin: "whatsapp", status: "verified", notes: "" },
  { id: 303, unit: "Unidad 21", plate: "TBN-561-E", station: "G500 Coatzacoalcos", liters: 195, amount: 4290, odometer: 118750, efficiency: 3.6, date: "2026-08-10", vendor: "G500 Coatzacoalcos", invoiceFolio: "T-98701", origin: "telegram", status: "pending", notes: "" },
  { id: 304, unit: "Unidad 09", plate: "WPL-215-C", station: "Pemex Nanchital", liters: 165, amount: 3630, odometer: 261300, efficiency: 2.9, date: "2026-08-09", vendor: "Pemex Nanchital", invoiceFolio: "T-98530", origin: "manual", status: "verified", notes: "Capturado por despachador" },
  { id: 305, unit: "Unidad 03", plate: "VJH-004-D", station: "Pemex Coatzacoalcos Centro", liters: 175, amount: 3850, odometer: 64200, efficiency: 4.3, date: "2026-08-08", vendor: "Pemex Coatzacoalcos Centro", invoiceFolio: "T-98315", origin: "whatsapp", status: "verified", notes: "" },
];

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

function KpiCard({ widget }) {
  const Icon = widget.icon;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${TONE_CLASSES[widget.tone]}`}>
        <Icon size={16} />
      </span>
      <p className="mt-3 text-xs font-medium text-slate-500">{widget.label}</p>
      <p className="text-lg font-bold text-slate-800">{widget.value}</p>
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

function DocumentCell({ documentUrl }) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);

  if (!documentUrl) return <span className="text-[11px] text-slate-300">Sin documento</span>;

  async function handleDownload(e) {
    e.preventDefault();
    setLoading(true);
    try {
      const { data, error } = await supabase.storage.from("documents").createSignedUrl(documentUrl, 60);
      if (error) throw error;
      window.open(data.signedUrl, "_blank");
    } catch (err) {
      showToast(`Error al abrir el documento: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleDownload}
      disabled={loading}
      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
    >
      <FileText size={12} /> {loading ? "Abriendo..." : "Descargar"}
    </button>
  );
}

function RecordFormModal({ mode, module: fixedModule, initial, vehicles, onSave, onClose }) {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [module, setModule] = useState(fixedModule ?? initial?.module ?? "maintenance");
  const [unit, setUnit] = useState(initial?.unit ?? vehicles[0]?.unit ?? "");
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
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const plate = vehicles.find((v) => v.unit === unit)?.plate ?? "";

  async function handleSubmit(e) {
    e.preventDefault();
    if (!concept.trim() || !date || (module !== "travel" && !unit)) {
      setError("Completa al menos el vehículo, el concepto y la fecha.");
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
        const ext = file.type === "application/pdf" ? "pdf" : file.type === "image/png" ? "png" : "jpg";
        const path = `${profile.companyId}/${module}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from("documents").upload(path, file, { contentType: file.type });
        if (uploadError) throw uploadError;
        documentUrl = path;
      }
      const base = {
        ...(initial ?? {}),
        unit,
        plate,
        concept: concept.trim(),
        amount: Number(amount) || 0,
        date,
        vendor: vendor.trim(),
        invoiceFolio: invoiceFolio.trim(),
        notes: notes.trim(),
        documentUrl,
      };
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
      onSave(module, base);
    } catch (err) {
      showToast(`Error al subir el documento: ${err.message}`);
    } finally {
      setUploading(false);
    }
  }

  const inputClass = "w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-blue-400 focus:outline-none";
  const labelClass = "mb-1 block text-[11px] font-semibold text-slate-500";

  return (
    <Modal title={mode === "edit" ? "Editar / Corregir Registro" : "Agregar Registro Manual"} width="max-w-lg" onClose={onClose}>
      <form onSubmit={handleSubmit} className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
        {!fixedModule && (
          <div>
            <label className={labelClass}>Módulo Destino</label>
            <select value={module} onChange={(e) => setModule(e.target.value)} className={inputClass}>
              <option value="maintenance">Mantenimiento</option>
              <option value="compliance">Cumplimiento</option>
              <option value="fuel">Consumo de Combustible</option>
              <option value="travel">Viáticos</option>
            </select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Vehículo{module === "travel" && " (opcional)"}</label>
            <select value={unit} onChange={(e) => setUnit(e.target.value)} className={inputClass}>
              {module === "travel" && <option value="">Sin vehículo asociado</option>}
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

        <div>
          <label className={labelClass}>Concepto</label>
          <input value={concept} onChange={(e) => setConcept(e.target.value)} placeholder='Ej. "Cambio de aceite y filtro"' className={inputClass} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Fecha</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Monto (MXN)</label>
            <input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" className={inputClass} />
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
              <input type="number" min="0" value={liters} onChange={(e) => setLiters(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Odómetro (km)</label>
              <input type="number" min="0" value={odometer} onChange={(e) => setOdometer(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Rendimiento (km/L)</label>
              <input type="number" min="0" step="0.1" value={efficiency} onChange={(e) => setEfficiency(e.target.value)} placeholder="Ej. 3.6" className={inputClass} />
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
            accept="image/*,application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full text-xs text-slate-500 file:mr-3 file:rounded-lg file:border file:border-slate-200 file:bg-white file:px-2.5 file:py-1.5 file:text-xs file:font-semibold file:text-slate-600 hover:file:bg-slate-50"
          />
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
    </Modal>
  );
}

/* ---------------------------------------------------------------------- */
/*  Fleet — mosaic view                                                   */
/* ---------------------------------------------------------------------- */

const TODAY_ISO = "2026-08-12";
function daysUntil(dateStr) {
  return Math.round((new Date(dateStr) - new Date(TODAY_ISO)) / (1000 * 60 * 60 * 24));
}

function VehicleCard({ vehicle, onSelect, isCompanyAdmin, onEdit, onDelete }) {
  const health = HEALTH_TONE(vehicle.healthScore);
  const kmPct = Math.min(100, Math.round((vehicle.kmActual / vehicle.kmProximoServicio) * 100));
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="relative h-36 w-full overflow-hidden bg-slate-100">
        <img src={vehicle.photo} alt={vehicle.unit} className="h-full w-full object-cover" />
        <span className={`absolute right-2 top-2 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ${health.className}`}>
          {vehicle.healthScore}% · {health.label}
        </span>
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
          <img src={vehicle.driver.photo} alt={vehicle.driver.name} className="h-7 w-7 rounded-full bg-slate-100 ring-1 ring-slate-200" />
          <span className="text-xs font-medium text-slate-600">{vehicle.driver.name}</span>
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
  const avgHealth = Math.round(vehicles.reduce((s, v) => s + v.healthScore, 0) / vehicles.length);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Gestión de Flota</h1>
          <p className="mt-1 text-sm text-slate-500">
            {vehicles.length} unidades activas · Salud promedio de flota {avgHealth}%
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
  { id: "ficha", label: "Ficha & Conductor" },
  { id: "guantera", label: "Trámites" },
  { id: "mantenimiento", label: "Mantenimiento Preventivo" },
  { id: "llantas", label: "Llantas y Neumáticos" },
  { id: "historial", label: "Historial Completo" },
];

const DETAIL_DATE_RANGES = ["Últimos 7 días", "Últimos 30 días", "Este trimestre", "Este año"];
const DETAIL_RANGE_DAYS = { "Últimos 7 días": 7, "Últimos 30 días": 30, "Este trimestre": 90, "Este año": 365 };

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
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">Conductor Asignado</h4>
        <div className="flex items-center gap-3">
          <img src={vehicle.driver.photo} alt={vehicle.driver.name} className="h-14 w-14 rounded-full bg-slate-100 ring-2 ring-blue-100" />
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

function DocCard({ icon: Icon, title, rows, pdfUrl, footer }) {
  const { showToast } = useToast();
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
          <Icon size={15} />
        </span>
        <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">{title}</h4>
      </div>
      {pdfUrl && (
        <div className="mb-3 flex h-20 w-full items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-slate-300">
          <FileText size={26} />
        </div>
      )}
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between text-xs">
            <span className="text-slate-400">{r.label}</span>
            <span className="font-semibold text-slate-700">{r.value}</span>
          </div>
        ))}
      </div>
      {pdfUrl && (
        <div className="mt-3 flex gap-2">
          <button
            onClick={(e) => {
              e.preventDefault();
              showToast(`Descarga simulada: ${title}.pdf (no hay archivo real en este demo).`);
            }}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
          >
            <Download size={12} /> Descargar PDF
          </button>
          <label className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-slate-200 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
            <Upload size={12} /> Cargar Documento
            <input
              type="file"
              className="hidden"
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                e.preventDefault();
                showToast(`Documento recibido para ${title} (guardado solo en esta sesión de demo).`);
              }}
            />
          </label>
        </div>
      )}
      {footer}
    </div>
  );
}

function DocHistoryCollapsible({ documents }) {
  const [open, setOpen] = useState(false);
  const { showToast } = useToast();
  if (!documents || documents.length === 0) return null;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between text-left">
        <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">Historial de Documentos Anteriores</h4>
        {open ? <ChevronUp size={15} className="text-slate-400" /> : <ChevronDown size={15} className="text-slate-400" />}
      </button>
      {open && (
        <div className="mt-3 space-y-1.5">
          {documents.map((d, i) => (
            <div key={i} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs">
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-600">{d.doc}</p>
                <p className="text-[10px] text-slate-400">Venció {d.expired}</p>
              </div>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  showToast(`Descarga simulada: ${d.doc}.pdf`);
                }}
                className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
              >
                <Download size={11} /> PDF
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GuanteraDigitalTab({ vehicle }) {
  const { format } = useDateFormat();
  return (
    <div className="space-y-4">
      <DocCard
        icon={ShieldCheck}
        title="Póliza de Seguro"
        pdfUrl={vehicle.insurance.pdfUrl}
        rows={[
          { label: "Aseguradora", value: vehicle.insurance.company },
          { label: "Folio", value: vehicle.insurance.folio },
          { label: "Vencimiento", value: formatDate(vehicle.insurance.expiry, format) },
        ]}
      />
      <DocCard
        icon={FileText}
        title="Tarjeta de Circulación"
        pdfUrl={vehicle.circulationCard.pdfUrl}
        rows={[{ label: "Folio", value: vehicle.circulationCard.folio }]}
      />
      <DocCard
        icon={CheckCircle2}
        title="Verificación Vehicular Ambiental"
        rows={[
          { label: "Holograma", value: vehicle.verification.hologram },
          { label: "Vigencia", value: formatDate(vehicle.verification.validity, format) },
        ]}
      />
      <div className="flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-2.5 text-[11px] font-semibold text-emerald-700">
        <MessageSquare size={13} /> Sincronizado vía WhatsApp Cloud API 📱
      </div>
      <DocHistoryCollapsible documents={vehicle.documentHistory} />
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

function MantenimientoPreventivoTab({ vehicle }) {
  const { format } = useDateFormat();
  const kmPct = Math.max(4, 100 - Math.round((vehicle.maintenancePanel.kmRestante / 3000) * 100));
  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
      <ProgressRow
        label="Kilometraje restante para próximo servicio"
        pct={kmPct}
        detail={`${vehicle.maintenancePanel.kmRestante.toLocaleString()} km restantes`}
        tone={vehicle.maintenancePanel.kmRestante < 1500 ? "rose" : "blue"}
      />
      <div className="grid grid-cols-2 gap-3 pt-1">
        <FichaItem label="Tipo de Refrigerante" value={vehicle.maintenancePanel.coolantType} />
        <FichaItem label="Último Cambio de Frenos" value={formatDate(vehicle.maintenancePanel.brakesLast, format)} />
        <FichaItem label="Último Cambio de Aceite" value={formatDate(vehicle.maintenancePanel.oilLast, format)} />
        <FichaItem label="Tipo de Aceite" value={vehicle.oilType} />
      </div>
    </div>
  );
}

function LlantasTab({ vehicle }) {
  const { format } = useDateFormat();
  const rearAlert = vehicle.tires.rearDepth < 4.5;
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">Medidas Oficiales de Llanta</h4>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-blue-50 px-3 py-3 text-center ring-1 ring-blue-100">
            <p className="text-[11px] font-medium text-blue-500">Delanteras</p>
            <p className="text-2xl font-extrabold text-blue-700">{vehicle.tires.frontSize}</p>
            <p className="mt-1 text-[11px] font-semibold text-slate-500">{vehicle.tires.frontDepth} mm de piso</p>
          </div>
          <div className={`rounded-xl px-3 py-3 text-center ring-1 ${rearAlert ? "bg-rose-50 ring-rose-100" : "bg-blue-50 ring-blue-100"}`}>
            <p className={`text-[11px] font-medium ${rearAlert ? "text-rose-500" : "text-blue-500"}`}>Traseras</p>
            <p className={`text-2xl font-extrabold ${rearAlert ? "text-rose-700" : "text-blue-700"}`}>{vehicle.tires.rearSize}</p>
            <p className={`mt-1 flex items-center justify-center gap-1 text-[11px] font-semibold ${rearAlert ? "text-rose-600" : "text-slate-500"}`}>
              {vehicle.tires.rearDepth} mm de piso {rearAlert && <AlertTriangle size={13} />}
            </p>
            {rearAlert && <p className="mt-0.5 text-[10px] font-semibold text-rose-600">Bajo el mínimo recomendado (4.5 mm)</p>}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FichaItem label="Presión (PSI)" value={`${vehicle.tires.psi} PSI`} />
        <FichaItem label="Última Rotación" value={formatDate(vehicle.tires.lastRotation, format)} />
      </div>
    </div>
  );
}

function HistorialTab({ vehicle }) {
  const { format } = useDateFormat();
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
            <th className="px-4 py-3 font-semibold">Fecha</th>
            <th className="px-4 py-3 font-semibold">Servicio</th>
            <th className="px-4 py-3 font-semibold">Taller</th>
            <th className="px-4 py-3 text-right font-semibold">Costo</th>
          </tr>
        </thead>
        <tbody>
          {vehicle.history.map((h, i) => (
            <tr key={i} className="border-b border-slate-50 last:border-0">
              <td className="px-4 py-3 text-slate-500">{formatDate(h.date, format)}</td>
              <td className="px-4 py-3 font-medium text-slate-700">{h.concept}</td>
              <td className="px-4 py-3 text-slate-500">{h.workshop}</td>
              <td className="px-4 py-3 text-right font-semibold text-slate-700">{h.cost ? `$${h.cost.toLocaleString()}` : "—"}</td>
            </tr>
          ))}
          {vehicle.history.length === 0 && (
            <tr>
              <td colSpan={4} className="px-4 py-8 text-center text-xs text-slate-400">
                Sin movimientos en el rango seleccionado.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function VehiclePanelToggle({ view, setView }) {
  const options = [
    { id: "photo", label: "Foto Principal", icon: ImageIcon },
    { id: "capture", label: "Captura App / Chofer", icon: Camera },
    { id: "gps", label: "Mapa GPS en Vivo", icon: MapPin },
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

function VehicleGpsPanel({ vehicle }) {
  const s = GPS_STATUS_STYLES[vehicle.gps.status];
  return (
    <div className="relative flex h-[420px] flex-col justify-between overflow-hidden rounded-2xl bg-slate-900 p-5 text-white">
      <div
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage: "linear-gradient(#334155 1px, transparent 1px), linear-gradient(90deg, #334155 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />
      <div className="relative flex items-center justify-between">
        <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-semibold">
          <span className={`h-2 w-2 rounded-full ${s.dot} animate-pulse`} /> {s.label}
        </span>
        <span className="text-[11px] text-slate-300">{vehicle.gps.lastUpdate}</span>
      </div>
      <div className="relative">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-500 ring-8 ring-blue-500/20">
          <Navigation size={18} />
        </span>
      </div>
      <div className="relative space-y-2 rounded-xl bg-white/10 p-4 backdrop-blur">
        <p className="flex items-center gap-1.5 text-xs font-semibold">
          <MapPin size={13} /> {vehicle.gps.address}
        </p>
        <div className="grid grid-cols-2 gap-2 pt-1 text-[11px] text-slate-300">
          <span>
            Velocidad: <b className="text-white">{vehicle.gps.speed} km/h</b>
          </span>
          <span>
            Motor: <b className="text-white">{s.label}</b>
          </span>
        </div>
      </div>
    </div>
  );
}

function VehiclePanel({ vehicle }) {
  const [view, setView] = useState("photo");
  return (
    <div className="space-y-3">
      <VehiclePanelToggle view={view} setView={setView} />
      {view === "photo" && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 shadow-sm">
          <img src={vehicle.photo} alt={vehicle.unit} className="h-[420px] w-full object-cover" />
        </div>
      )}
      {view === "capture" && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 shadow-sm">
          <img src={vehicle.appCapture.photoUrl} alt="Captura" className="h-[350px] w-full object-cover" />
          <div className="flex items-center justify-between bg-slate-50 px-4 py-3">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
              <Camera size={13} /> {vehicle.appCapture.driverName}
            </span>
            <span className="text-[11px] text-slate-400">{vehicle.appCapture.timestamp}</span>
          </div>
        </div>
      )}
      {view === "gps" && <VehicleGpsPanel vehicle={vehicle} />}
    </div>
  );
}

function VehicleDetailPage({ vehicle, onBack, isCompanyAdmin, onEdit, onDelete }) {
  const [tab, setTab] = useState("ficha");

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-700">
        <ArrowLeft size={16} /> Volver a la Lista
      </button>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <img src={vehicle.photo} alt={vehicle.unit} className="h-12 w-16 rounded-lg object-cover ring-1 ring-slate-200" />
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              {vehicle.unit} <span className="font-medium text-slate-400">· {vehicle.plate}</span>
            </h2>
            <p className="text-xs text-slate-500">
              {[vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "—"} · Conductor: {vehicle.driver.name || "Sin asignar"}
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
          {tab === "guantera" && <GuanteraDigitalTab vehicle={vehicle} />}
          {tab === "mantenimiento" && <MantenimientoPreventivoTab vehicle={vehicle} />}
          {tab === "llantas" && <LlantasTab vehicle={vehicle} />}
          {tab === "historial" && <HistorialTab vehicle={vehicle} />}
        </div>
        <div>
          <VehiclePanel vehicle={vehicle} />
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
  const existingDrivers = vehicles.map((v) => v.driver.name);
  const [unit, setUnit] = useState("");
  const [plate, setPlate] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());
  const [color, setColor] = useState("");
  const [driverMode, setDriverMode] = useState("reassign");
  const [reassignedDriver, setReassignedDriver] = useState(existingDrivers[0] ?? "");
  const [newDriverName, setNewDriverName] = useState("");
  const [newDriverPhone, setNewDriverPhone] = useState("");

  const inputClass = "w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-blue-400 focus:outline-none";
  const labelClass = "mb-1 block text-[11px] font-semibold text-slate-500";

  function handleSubmit(e) {
    e.preventDefault();
    if (!unit.trim() || !plate.trim()) return;
    const driverName = driverMode === "reassign" ? reassignedDriver : newDriverName.trim() || "Sin asignar";
    const reassignedFrom = driverMode === "reassign" ? vehicles.find((v) => v.driver.name === reassignedDriver) : null;
    const vehicle = {
      unit: unit.trim(),
      plate: plate.trim(),
      brand: brand.trim(),
      model: model.trim(),
      year: Number(year) || new Date().getFullYear(),
      color: color.trim(),
      photo: "https://picsum.photos/seed/navio-new-unit/480/280",
      healthScore: 100,
      kmActual: 0,
      kmProximoServicio: 10000,
      oilType: "Sintético 15W-40",
      avgConsumption: 0,
      driver: {
        name: driverName,
        phone: reassignedFrom ? reassignedFrom.driver.phone : newDriverPhone.trim(),
        photo: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(driverName)}`,
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
      appCapture: { photoUrl: "https://picsum.photos/seed/navio-new-unit-capture/480/280", timestamp: "—", driverName },
    };
    onSave({ vehicle, reassignedFromId: reassignedFrom ? reassignedFrom.id : null });
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

        <div className="rounded-xl border border-slate-100 p-3">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Reasignación de Choferes</p>
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
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">
            Cancelar
          </button>
          <button type="submit" className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
            Agregar Unidad
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EditVehicleModal({ vehicle, onSave, onClose }) {
  const [unit, setUnit] = useState(vehicle.unit ?? "");
  const [plate, setPlate] = useState(vehicle.plate ?? "");
  const [brand, setBrand] = useState(vehicle.brand ?? "");
  const [model, setModel] = useState(vehicle.model ?? "");
  const [year, setYear] = useState(vehicle.year ?? new Date().getFullYear());
  const [color, setColor] = useState(vehicle.color ?? "");
  const [photo, setPhoto] = useState(vehicle.photo ?? "");
  const [driverName, setDriverName] = useState(vehicle.driver?.name ?? "");
  const [driverPhone, setDriverPhone] = useState(vehicle.driver?.phone ?? "");

  const inputClass = "w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-blue-400 focus:outline-none";
  const labelClass = "mb-1 block text-[11px] font-semibold text-slate-500";

  function handleSubmit(e) {
    e.preventDefault();
    if (!unit.trim() || !plate.trim()) return;
    onSave({
      id: vehicle.id,
      unit: unit.trim(),
      plate: plate.trim(),
      brand: brand.trim(),
      model: model.trim(),
      year: Number(year) || vehicle.year,
      color: color.trim(),
      photo: photo.trim() || vehicle.photo,
      driver: {
        ...vehicle.driver,
        name: driverName.trim() || "Sin asignar",
        phone: driverPhone.trim(),
      },
    });
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
        <div>
          <label className={labelClass}>URL de foto del vehículo</label>
          <input value={photo} onChange={(e) => setPhoto(e.target.value)} placeholder="https://..." className={inputClass} />
          <p className="mt-1 text-[10px] text-slate-400">
            Navío todavía no sube archivos desde tu equipo — por ahora pega el enlace de una foto ya publicada.
          </p>
        </div>
        <div className="rounded-xl border border-slate-100 p-3">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Conductor asignado</p>
          <div className="grid grid-cols-2 gap-3">
            <input value={driverName} onChange={(e) => setDriverName(e.target.value)} placeholder="Nombre del conductor" className={inputClass} />
            <input value={driverPhone} onChange={(e) => setDriverPhone(e.target.value)} placeholder="Teléfono" className={inputClass} />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">
            Cancelar
          </button>
          <button type="submit" className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
            Guardar cambios
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
            Ingesta multicanal por WhatsApp, Telegram y registro manual, con trazabilidad y validación de cada dato.
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
  const kmPct = Math.max(4, 100 - Math.round((vehicle.maintenancePanel.kmRestante / 3000) * 100));
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="p-4">
        <div className="flex items-center gap-3">
          <img src={vehicle.photo} alt={vehicle.unit} className="h-14 w-20 shrink-0 rounded-lg object-cover ring-1 ring-slate-200" />
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
            detail={`${vehicle.maintenancePanel.kmRestante.toLocaleString()} km restantes`}
            tone={vehicle.maintenancePanel.kmRestante < 1500 ? "rose" : "blue"}
          />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-slate-500">
          <span>
            Aceite: <b className="text-slate-700">{formatDate(vehicle.maintenancePanel.oilLast, format)}</b>
          </span>
          <span>
            Frenos/Balatas: <b className="text-slate-700">{formatDate(vehicle.maintenancePanel.brakesLast, format)}</b>
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

function FrenosBalatasTab({ vehicle }) {
  const { format } = useDateFormat();
  const brakeHistory = vehicle.history.filter((h) => /balata|freno/i.test(h.concept));
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">Frenos y Balatas</h4>
        <FichaItem label="Último Cambio de Frenos / Balatas" value={formatDate(vehicle.maintenancePanel.brakesLast, format)} />
      </div>
      {brakeHistory.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Historial de Frenos / Balatas</h4>
          <div className="space-y-1.5">
            {brakeHistory.map((h, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-slate-600">{h.concept}</span>
                <span className="text-slate-400">{formatDate(h.date, format)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function GarantiasTab({ vehicle }) {
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">Garantía de Motor</h4>
        <p className="text-sm font-semibold text-slate-700">{vehicle.warranty.engine}</p>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">Garantía de Piezas</h4>
        <p className="text-sm font-semibold text-slate-700">{vehicle.warranty.parts}</p>
      </div>
    </div>
  );
}

const MAINT_UNIT_TABS = [
  { id: "motor", label: "Motor y Aceite" },
  { id: "frenos", label: "Frenos y Balatas" },
  { id: "garantias", label: "Garantías" },
  { id: "historial", label: "Historial" },
];

function MaintenanceUnitDetail({ vehicle, onBack }) {
  const { format } = useDateFormat();
  const [tab, setTab] = useState("motor");
  const [dateRange, setDateRange] = useState("Este año");
  const [dateOpen, setDateOpen] = useState(false);

  const filteredHistory = useMemo(() => {
    const maxDays = DETAIL_RANGE_DAYS[dateRange];
    return vehicle.history.filter((h) => (new Date(TODAY_ISO) - new Date(h.date)) / (1000 * 60 * 60 * 24) <= maxDays);
  }, [vehicle, dateRange]);

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-700">
        <ArrowLeft size={16} /> Volver a Unidades
      </button>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <img src={vehicle.photo} alt={vehicle.unit} className="h-12 w-16 rounded-lg object-cover ring-1 ring-slate-200" />
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              {vehicle.unit} <span className="font-medium text-slate-400">· {vehicle.plate}</span>
            </h2>
            <p className="text-xs text-slate-500">Mantenimiento independiente de esta unidad</p>
          </div>
        </div>
        {tab === "historial" && (
          <div className="relative">
            <button
              onClick={() => setDateOpen((v) => !v)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              <Calendar size={13} /> {dateRange} <ChevronDown size={13} />
            </button>
            {dateOpen && (
              <div className="absolute right-0 z-20 mt-1.5 w-44 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
                {DETAIL_DATE_RANGES.map((r) => (
                  <button
                    key={r}
                    onClick={() => {
                      setDateRange(r);
                      setDateOpen(false);
                    }}
                    className={`block w-full rounded-lg px-2.5 py-1.5 text-left text-xs font-medium hover:bg-blue-50 ${
                      r === dateRange ? "text-blue-600" : "text-slate-600"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 rounded-xl bg-slate-100 p-1">
        {MAINT_UNIT_TABS.map((t) => (
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

      {tab === "motor" && <MantenimientoPreventivoTab vehicle={vehicle} />}
      {tab === "frenos" && <FrenosBalatasTab vehicle={vehicle} />}
      {tab === "garantias" && <GarantiasTab vehicle={vehicle} />}
      {tab === "historial" && <HistorialTab vehicle={{ ...vehicle, history: filteredHistory }} />}
    </div>
  );
}

function MaintenanceWarrantyView({ vehicles }) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Garantías</h1>
        <p className="mt-1 text-sm text-slate-500">Vigencia de garantías de motor y piezas por unidad.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {vehicles.map((v) => (
          <div key={v.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-bold text-slate-800">
              {v.unit} <span className="font-medium text-slate-400">· {v.plate}</span>
            </h3>
            <div className="mt-3 space-y-2 text-xs">
              <p>
                <span className="font-semibold text-slate-500">Motor: </span>
                <span className="text-slate-700">{v.warranty.engine}</span>
              </p>
              <p>
                <span className="font-semibold text-slate-500">Piezas: </span>
                <span className="text-slate-700">{v.warranty.parts}</span>
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MaintenanceSection({ view, vehicles, records, onAddClick, onConfirm, onEditClick, onDeleteClick }) {
  const [selectedUnitId, setSelectedUnitId] = useState(null);

  if (view === "garantias") return <MaintenanceWarrantyView vehicles={vehicles} />;
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
  if (selectedVehicle) return <MaintenanceUnitDetail vehicle={selectedVehicle} onBack={() => setSelectedUnitId(null)} />;
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
  { id: "fuel", label: "Consumo de Combustible" },
  { id: "travel", label: "Viáticos" },
  { id: "consumables", label: "Consumibles" },
  { id: "coolant", label: "Refrigerante" },
  { id: "parts", label: "Refacciones" },
  { id: "tolls", label: "Casetas" },
];

function FuelPage({
  records,
  travelRecords,
  onAddClick,
  onConfirm,
  onEditClick,
  onDeleteClick,
  onAddTravelClick,
  onConfirmTravel,
  onEditTravelClick,
  onDeleteTravelClick,
}) {
  const { format } = useDateFormat();
  const { profile } = useAuth();
  const currency = profile?.company?.currency || "MXN";
  const fuelWidgets = useMemo(() => getFuelWidgets(records, currency), [records, currency]);
  const [visibleWidgets, setVisibleWidgets] = useState({ totalSpend: true, liters: true, efficiency: true, ocr: true });
  const [widgetModalOpen, setWidgetModalOpen] = useState(false);
  const [invoiceCategory, setInvoiceCategory] = useState("fuel");

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
    { key: "station", label: "Estación de Servicio", render: (r) => <span className="text-slate-600">{r.station}</span> },
    { key: "liters", label: "Litros", render: (r) => `${r.liters.toLocaleString()} L` },
    { key: "amount", label: "Monto", render: (r) => formatCurrency(r.amount, currency) },
    { key: "odometer", label: "Odómetro", render: (r) => `${r.odometer.toLocaleString()} km` },
    { key: "efficiency", label: "Rendimiento", render: (r) => (r.efficiency ? `${r.efficiency} km/L` : "—") },
    { key: "date", label: "Fecha", render: (r) => formatDate(r.date, format) },
    { key: "document", label: "Documento", render: (r) => <DocumentCell documentUrl={r.documentUrl} /> },
    { key: "origin", label: "Origen", render: (r) => <OriginBadge origin={r.origin} /> },
    { key: "status", label: "Estado del Dato", render: (r) => <StatusBadge status={r.status} /> },
  ];

  const travelColumns = [
    {
      key: "unit",
      label: "Unidad / Conductor",
      render: (r) => (
        <div>
          <p className="font-semibold text-slate-700">{r.unit || "Sin unidad asociada"}</p>
          <p className="text-[11px] text-slate-400">{r.driverName || "—"}</p>
        </div>
      ),
    },
    { key: "concept", label: "Concepto", render: (r) => <span className="text-slate-600">{r.concept}</span> },
    { key: "amount", label: "Monto", render: (r) => formatCurrency(r.amount, currency) },
    { key: "vendor", label: "Proveedor", render: (r) => r.vendor || "—" },
    { key: "date", label: "Fecha", render: (r) => formatDate(r.date, format) },
    { key: "document", label: "Documento", render: (r) => <DocumentCell documentUrl={r.documentUrl} /> },
    { key: "origin", label: "Origen", render: (r) => <OriginBadge origin={r.origin} /> },
    { key: "status", label: "Estado del Dato", render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Facturas y Gastos</h1>
          <p className="mt-1 text-sm text-slate-500">
            Integra consumo de combustible, consumibles, refrigerante, refacciones y casetas de la flotilla.
          </p>
        </div>
        <button
          onClick={invoiceCategory === "travel" ? onAddTravelClick : onAddClick}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
        >
          <Plus size={15} /> Cargar Factura
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {INVOICE_CATEGORIES.map((c) => (
          <button
            key={c.id}
            onClick={() => setInvoiceCategory(c.id)}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
              invoiceCategory === c.id
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {invoiceCategory === "fuel" ? (
        <>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-800">Resumen del mes — Consumo de Combustible</h2>
              <button
                onClick={() => setWidgetModalOpen(true)}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                <Settings size={13} /> Personalizar Widgets
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {fuelWidgets.filter((w) => visibleWidgets[w.id]).map((w) => (
                <KpiCard key={w.id} widget={w} />
              ))}
              {fuelWidgets.every((w) => !visibleWidgets[w.id]) && (
                <p className="col-span-full py-4 text-center text-xs text-slate-400">
                  No hay widgets visibles. Actívalos desde "Personalizar Widgets".
                </p>
              )}
            </div>
          </div>

          <RecordsTable
            records={records}
            columns={columns}
            onConfirm={onConfirm}
            onEdit={onEditClick}
            onDelete={onDeleteClick}
            emptyLabel="Sin cargas de combustible registradas."
          />
        </>
      ) : invoiceCategory === "travel" ? (
        <RecordsTable
          records={travelRecords}
          columns={travelColumns}
          onConfirm={onConfirmTravel}
          onEdit={onEditTravelClick}
          onDelete={onDeleteTravelClick}
          emptyLabel="Sin viáticos registrados todavía."
        />
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-12 text-center">
          <p className="text-sm font-semibold text-slate-500">
            Sin registros de {INVOICE_CATEGORIES.find((c) => c.id === invoiceCategory)?.label.toLowerCase()} todavía.
          </p>
          <p className="mt-1 text-xs text-slate-400">Usa "Cargar Factura" para comenzar a registrar este tipo de gasto.</p>
        </div>
      )}

      {widgetModalOpen && (
        <WidgetSettingsModal
          widgets={fuelWidgets}
          visible={visibleWidgets}
          onToggle={toggleWidget}
          onClose={() => setWidgetModalOpen(false)}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Sidebar                                                                */
/* ---------------------------------------------------------------------- */

const NAV_ITEMS = [
  { id: "home", label: "Home / Inicio", icon: Home },
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
];

const BOTTOM_NAV_ITEMS = [
  { id: "settings", label: "Conf.", icon: Settings },
  { id: "account", label: "Cuenta", icon: User },
  { id: "support", label: "Comunidad", icon: HelpCircle },
];

const PAGE_META = {
  home: { title: "Home / Inicio", subtitle: "Dashboard general con KPIs globales de la flota." },
  map: { title: "Mapa en Vivo", subtitle: "Torre de control y telemetría en tiempo real." },
  fleet: { title: "Gestión de Flota", subtitle: "Mosaico de unidades y expediente digital por vehículo." },
  transfers: { title: "Traslados", subtitle: "Asignación de viajes, rutas y carga por unidad." },
  maintenance: { title: "Mantenimiento", subtitle: "Desglose por unidad: servicios, garantías y órdenes de trabajo." },
  incidents: { title: "Incidencias", subtitle: "Reporte de fallos y emergencias en ruta." },
  compliance: { title: "Trámites", subtitle: "Tenencias, pólizas, verificaciones y licencias al día." },
  fuel: { title: "Facturas y Gastos", subtitle: "Consumo de combustible, consumibles, refrigerante, refacciones y casetas." },
  settings: { title: "Configuración", subtitle: "Preferencias regionales y de notificaciones de la plataforma." },
  account: { title: "Cuenta", subtitle: "Perfil y permisos del usuario activo." },
  support: { title: "Comunidad", subtitle: "Comunidad y soporte técnico de Navio." },
  admin: { title: "Administración", subtitle: "Aprobación de empresas y gestión de la plataforma Navío." },
};

const COMPANY_STATUS_META = {
  pending: { label: "Pendiente", className: "bg-amber-50 text-amber-700 ring-1 ring-amber-200" },
  approved: { label: "Aprobada", className: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" },
  rejected: { label: "Rechazada", className: "bg-rose-50 text-rose-700 ring-1 ring-rose-200" },
  suspended: { label: "Suspendida", className: "bg-slate-100 text-slate-600 ring-1 ring-slate-200" },
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

const DEFAULT_HOME_SHORTCUTS = [
  { id: "garantia", label: "Garantía", icon: ShieldCheck, tab: "maintenance", sub: "garantias" },
  { id: "facturaComb", label: "Factura Comb", icon: Receipt, tab: "fuel", sub: null },
  { id: "merida", label: "Mérida", icon: Navigation, tab: "transfers", sub: null },
];

const HOME_NAV_TARGET_OPTIONS = NAV_ITEMS.flatMap((item) =>
  item.children
    ? item.children.map((c) => ({ value: `${item.id}|${c.id}`, label: `${item.label} — ${c.label}` }))
    : [{ value: `${item.id}|`, label: item.label }]
);

function AnnouncementEditModal({ title, text, onSave, onClose }) {
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftText, setDraftText] = useState(text);
  const inputClass = "w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-blue-400 focus:outline-none";
  const labelClass = "mb-1 block text-[11px] font-semibold text-slate-500";
  return (
    <Modal title="Editar Anuncio / Novedades" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className={labelClass}>Título</label>
          <input value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Mensaje</label>
          <textarea value={draftText} onChange={(e) => setDraftText(e.target.value)} rows={3} className={inputClass} />
        </div>
        <p className="flex items-center gap-1.5 rounded-lg bg-blue-50 px-2.5 py-2 text-[11px] font-medium text-blue-700">
          <ShieldCheck size={13} /> Visible para todos. Editable solo por administradores o el equipo de Navio.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">
            Cancelar
          </button>
          <button
            onClick={() => onSave({ title: draftTitle, text: draftText })}
            className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
          >
            Guardar
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ShortcutAddModal({ onSave, onClose }) {
  const [label, setLabel] = useState("");
  const [target, setTarget] = useState(HOME_NAV_TARGET_OPTIONS[0]?.value ?? "");
  const inputClass = "w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-blue-400 focus:outline-none";
  const labelClass = "mb-1 block text-[11px] font-semibold text-slate-500";

  function handleSubmit(e) {
    e.preventDefault();
    if (!label.trim()) return;
    const [tab, sub] = target.split("|");
    onSave({ id: `custom-${Date.now()}`, label: label.trim(), icon: ChevronRight, tab, sub: sub || null });
  }

  return (
    <Modal title="Agregar Acceso Rápido" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className={labelClass}>Nombre del acceso</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder='Ej. "Garantías Mérida"' className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Sección destino</label>
          <select value={target} onChange={(e) => setTarget(e.target.value)} className={inputClass}>
            {HOME_NAV_TARGET_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">
            Cancelar
          </button>
          <button type="submit" className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
            Agregar
          </button>
        </div>
      </form>
    </Modal>
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

const HOME_KPI_ICONS = { km: Navigation, fuel: Droplet, cargo: Truck, opCosts: DollarSign, maintCost: Wrench, docCost: ShieldCheck, health: Activity };

function HomePage({ vehicles, maintenanceRecords, complianceRecords, fuelRecords, trips, onSelectVehicle, onNavigate, userName }) {
  const isAdmin = true; // Cualquier usuario autenticado es tratado como administrador — todavía no hay tabla de roles en Supabase.

  const [announcement, setAnnouncement] = useState({
    title: "Nuevas funciones de telemetría",
    text: "Ahora puedes ver el estado de anti-jamming GPS en tiempo real desde el Mapa en Vivo.",
  });
  const [announcementModalOpen, setAnnouncementModalOpen] = useState(false);

  const [dateRange, setDateRange] = useState("Este año");
  const [dateOpen, setDateOpen] = useState(false);

  const [visibleKpis, setVisibleKpis] = useState({
    km: true,
    fuel: true,
    cargo: true,
    opCosts: true,
    maintCost: false,
    docCost: false,
    health: false,
  });
  const [kpiModalOpen, setKpiModalOpen] = useState(false);

  const [shortcuts, setShortcuts] = useState(DEFAULT_HOME_SHORTCUTS);
  const [shortcutModalOpen, setShortcutModalOpen] = useState(false);

  const [chartMetric1, setChartMetric1] = useState("km");
  const [chartMetric2, setChartMetric2] = useState("fuelLiters");
  const [chartMetric3, setChartMetric3] = useState("maintenanceCost");

  function toggleKpi(id) {
    setVisibleKpis((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  const criticalAlerts = vehicles.filter(
    (v) => v.healthScore < 60 || v.tires.rearDepth < 4.5 || daysUntil(v.driver.licenseExpiry) <= 30
  );

  const maxDays = DETAIL_RANGE_DAYS[dateRange];
  const inRange = (dateStr) => (new Date(TODAY_ISO) - new Date(dateStr)) / (1000 * 60 * 60 * 24) <= maxDays;
  const rangedFuel = fuelRecords.filter((r) => inRange(r.date));
  const rangedMaintenance = maintenanceRecords.filter((r) => inRange(r.date));
  const rangedCompliance = complianceRecords.filter((r) => inRange(r.date));

  const kmRecorridos = vehicles.reduce((s, v) => s + v.kmActual, 0);
  const consumoTotal = rangedFuel.reduce((s, r) => s + r.liters, 0);
  const cargaActiva = trips.filter((t) => t.status === "ongoing").length;
  const costoMantenimiento = rangedMaintenance.reduce((s, r) => s + r.amount, 0);
  const costoTramites = rangedCompliance.reduce((s, r) => s + r.amount, 0);
  const costoCombustible = rangedFuel.reduce((s, r) => s + r.amount, 0);
  const costosOperativos = costoMantenimiento + costoTramites + costoCombustible;
  const saludPromedio = Math.round(vehicles.reduce((s, v) => s + v.healthScore, 0) / vehicles.length);

  const HOME_KPIS = [
    { id: "km", label: "Kilómetros Recorridos", value: `${kmRecorridos.toLocaleString()} km`, detail: "Total acumulado de flota", icon: HOME_KPI_ICONS.km, tone: "blue" },
    { id: "fuel", label: "Consumo Total", value: `${consumoTotal.toLocaleString()} L`, detail: dateRange, icon: HOME_KPI_ICONS.fuel, tone: "sky" },
    { id: "cargo", label: "Carga Activa", value: cargaActiva, detail: "Traslados en curso", icon: HOME_KPI_ICONS.cargo, tone: "emerald" },
    { id: "opCosts", label: "Costos Operativos", value: `$${costosOperativos.toLocaleString()}`, detail: dateRange, icon: HOME_KPI_ICONS.opCosts, tone: "blue" },
    { id: "maintCost", label: "Costo de Mantenimiento", value: `$${costoMantenimiento.toLocaleString()}`, detail: dateRange, icon: HOME_KPI_ICONS.maintCost, tone: "amber" },
    { id: "docCost", label: "Costo de Trámites", value: `$${costoTramites.toLocaleString()}`, detail: dateRange, icon: HOME_KPI_ICONS.docCost, tone: "slate" },
    {
      id: "health",
      label: "Salud Promedio de Flota",
      value: `${saludPromedio}%`,
      detail: "Estado actual",
      icon: HOME_KPI_ICONS.health,
      tone: saludPromedio >= 80 ? "emerald" : saludPromedio >= 50 ? "amber" : "red",
    },
  ];

  const kmByUnit = vehicles.map((v) => ({ label: v.unit.replace("Unidad ", "U"), value: v.kmActual }));
  const litersByUnit = vehicles.map((v) => ({
    label: v.unit.replace("Unidad ", "U"),
    value: rangedFuel.filter((r) => r.unit === v.unit).reduce((s, r) => s + r.liters, 0),
  }));
  const fuelCostTrend = [...rangedFuel].sort((a, b) => new Date(a.date) - new Date(b.date)).map((r) => ({ label: r.date.slice(5), value: r.amount }));
  const maintenanceCostTrend = [...rangedMaintenance]
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map((r) => ({ label: r.date.slice(5), value: r.amount }));
  const complianceCostTrend = [...rangedCompliance]
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map((r) => ({ label: r.date.slice(5), value: r.amount }));
  const waitingSegments = [
    { label: "En espera", value: vehicles.filter((v) => v.gps.status === "stopped" || v.gps.status === "resting").length, color: "#f59e0b" },
    { label: "En ruta", value: vehicles.filter((v) => v.gps.status === "moving").length, color: "#10b981" },
    { label: "Alerta", value: vehicles.filter((v) => v.gps.status === "alert").length, color: "#f43f5e" },
  ];

  const chartMetrics = {
    km: { label: "Kilómetros Recorridos por Unidad", type: "bar", data: kmByUnit },
    fuelLiters: { label: "Consumo de Combustible (L)", type: "bar", data: litersByUnit },
    fuelCost: { label: "Costo de Combustible — Tendencia", type: "line", data: fuelCostTrend },
    maintenanceCost: { label: "Costo de Mantenimiento — Tendencia", type: "line", data: maintenanceCostTrend },
    complianceCost: { label: "Costo de Trámites — Tendencia", type: "line", data: complianceCostTrend },
    waiting: { label: "Vehículos en Espera", type: "donut", data: waitingSegments },
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">¡Qué gusto verte de nuevo, {userName}!</h1>
        <p className="mt-1 text-sm text-slate-500">
          Resumen ejecutivo de operaciones de tu flotilla — hoy, 12 de agosto de 2026.
          {criticalAlerts.length > 0 && (
            <>
              {" "}
              <button onClick={() => onSelectVehicle(criticalAlerts[0].id)} className="font-semibold text-rose-600 hover:underline">
                {criticalAlerts.length} unidad{criticalAlerts.length > 1 ? "es" : ""} con alertas críticas →
              </button>
            </>
          )}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="relative rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2">
          {isAdmin && (
            <button
              onClick={() => setAnnouncementModalOpen(true)}
              title="Editar anuncio (solo administradores)"
              className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"
            >
              <Edit2 size={14} />
            </button>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="pr-8">
              <h2 className="text-sm font-bold text-slate-800">{announcement.title}</h2>
              <p className="mt-2 text-xs text-slate-500">{announcement.text}</p>
              <button onClick={() => onNavigate("map")} className="mt-3 text-xs font-semibold text-blue-600 hover:text-blue-700">
                Ver más →
              </button>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {vehicles.map((v) => (
                <button key={v.id} onClick={() => onSelectVehicle(v.id)} className="shrink-0" title={v.unit}>
                  <img src={v.photo} alt={v.unit} className="h-20 w-28 rounded-lg object-cover ring-1 ring-slate-200 hover:ring-blue-300" />
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-800">General information</h2>
            <div className="flex items-center gap-1.5">
              <div className="relative">
                <button
                  onClick={() => setDateOpen((v) => !v)}
                  className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-medium text-slate-500 hover:bg-slate-50"
                >
                  <Calendar size={11} /> {dateRange} <ChevronDown size={11} />
                </button>
                {dateOpen && (
                  <div className="absolute right-0 z-20 mt-1.5 w-40 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
                    {DETAIL_DATE_RANGES.map((r) => (
                      <button
                        key={r}
                        onClick={() => {
                          setDateRange(r);
                          setDateOpen(false);
                        }}
                        className={`block w-full rounded-lg px-2.5 py-1.5 text-left text-[11px] font-medium hover:bg-blue-50 ${
                          r === dateRange ? "text-blue-600" : "text-slate-600"
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={() => setKpiModalOpen(true)}
                title="Personalizar métricas"
                className="flex h-6 w-6 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
              >
                <Settings size={12} />
              </button>
              <button
                onClick={() => setShortcutModalOpen(true)}
                title="Agregar acceso rápido"
                className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-white hover:bg-blue-700"
              >
                <Plus size={13} />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {HOME_KPIS.filter((k) => visibleKpis[k.id]).map((k) => (
              <KpiCard key={k.id} widget={k} />
            ))}
            {HOME_KPIS.every((k) => !visibleKpis[k.id]) && (
              <p className="col-span-full py-4 text-center text-xs text-slate-400">
                Sin métricas visibles. Actívalas desde el ícono de ajustes.
              </p>
            )}
          </div>

          <div className="mt-4 border-t border-slate-100 pt-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Accesos Rápidos</p>
            <div className="grid grid-cols-3 gap-2">
              {shortcuts.map((s) => {
                const Icon = s.icon;
                return (
                  <button
                    key={s.id}
                    onClick={() => onNavigate(s.tab, s.sub)}
                    className="flex flex-col items-center gap-1.5 rounded-xl border border-slate-100 p-2 text-center hover:border-blue-200 hover:bg-blue-50/50"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                      <Icon size={13} />
                    </span>
                    <span className="text-[10px] font-medium leading-tight text-slate-600">{s.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <HomeChartSlot metricKey={chartMetric1} metrics={chartMetrics} onChangeMetric={setChartMetric1} />
        <HomeChartSlot metricKey={chartMetric2} metrics={chartMetrics} onChangeMetric={setChartMetric2} />
        <HomeChartSlot metricKey={chartMetric3} metrics={chartMetrics} onChangeMetric={setChartMetric3} />
      </div>

      {announcementModalOpen && (
        <AnnouncementEditModal
          title={announcement.title}
          text={announcement.text}
          onSave={(next) => {
            setAnnouncement(next);
            setAnnouncementModalOpen(false);
          }}
          onClose={() => setAnnouncementModalOpen(false)}
        />
      )}

      {kpiModalOpen && (
        <WidgetSettingsModal
          widgets={HOME_KPIS}
          visible={visibleKpis}
          onToggle={toggleKpi}
          onClose={() => setKpiModalOpen(false)}
        />
      )}

      {shortcutModalOpen && (
        <ShortcutAddModal
          onSave={(s) => {
            setShortcuts((prev) => [...prev, s]);
            setShortcutModalOpen(false);
          }}
          onClose={() => setShortcutModalOpen(false)}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Mapa en vivo — Torre de Control                                       */
/* ---------------------------------------------------------------------- */

const MAP_MARKER_COLOR = { moving: "#10b981", stopped: "#f59e0b", offline: "#94a3b8" };
const DEFAULT_MAP_CENTER = [18.1345, -94.4269]; // Coatzacoalcos, Veracruz

function useLivePositions() {
  const [positions, setPositions] = useState({});

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase
      .from("vehicle_positions")
      .select("*")
      .then(({ data }) => {
        if (cancelled || !data) return;
        const map = {};
        data.forEach((p) => {
          map[p.vehicleId] = p;
        });
        setPositions(map);
      });
    const channel = supabase
      .channel("vehicle_positions_live")
      .on("postgres_changes", { event: "*", schema: "public", table: "vehicle_positions" }, (payload) => {
        setPositions((prev) => {
          if (payload.eventType === "DELETE") {
            const next = { ...prev };
            delete next[payload.old.vehicleId];
            return next;
          }
          return { ...prev, [payload.new.vehicleId]: payload.new };
        });
      })
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  return positions;
}

function LeafletMap({ markers, routePolyline, onSelectMarker }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef({});
  const polylineRef = useRef(null);
  const firstFitRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current || !window.L) return;
    const map = window.L.map(containerRef.current, { zoomControl: true }).setView(DEFAULT_MAP_CENTER, 12);
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !window.L) return;
    const seen = new Set();
    markers.forEach((m) => {
      seen.add(m.id);
      const color = MAP_MARKER_COLOR[m.status];
      const icon = window.L.divIcon({
        className: "",
        html: `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 1px 4px rgba(0,0,0,.45)"></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });
      let marker = markersRef.current[m.id];
      if (!marker) {
        marker = window.L.marker([m.lat, m.lng], { icon }).addTo(map);
        marker.on("click", () => onSelectMarker(m.id));
        marker.bindTooltip(m.label, { direction: "top", offset: [0, -6] });
        markersRef.current[m.id] = marker;
      } else {
        marker.setLatLng([m.lat, m.lng]);
        marker.setIcon(icon);
      }
    });
    Object.keys(markersRef.current).forEach((id) => {
      if (!seen.has(Number(id))) {
        markersRef.current[id].remove();
        delete markersRef.current[id];
      }
    });
    if (!firstFitRef.current && markers.length > 0) {
      firstFitRef.current = true;
      const bounds = window.L.latLngBounds(markers.map((m) => [m.lat, m.lng]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    }
  }, [markers, onSelectMarker]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !window.L) return;
    if (polylineRef.current) {
      polylineRef.current.remove();
      polylineRef.current = null;
    }
    if (routePolyline && routePolyline.length > 1) {
      const line = window.L.polyline(routePolyline.map((p) => [p.lat, p.lng]), { color: "#2563eb", weight: 4 }).addTo(map);
      polylineRef.current = line;
      map.fitBounds(line.getBounds(), { padding: [40, 40] });
    }
  }, [routePolyline]);

  return <div ref={containerRef} className="absolute inset-0" />;
}

function useVehicleRoutes(vehicleId) {
  const [routes, setRoutes] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    if (!supabase || !vehicleId) {
      setRoutes([]);
      return;
    }
    setLoading(true);
    supabase
      .from("routes")
      .select("*")
      .eq("vehicleId", vehicleId)
      .eq("status", "completed")
      .order("startedAt", { ascending: false })
      .limit(15)
      .then(({ data }) => {
        setRoutes(data ?? []);
        setLoading(false);
      });
  }, [vehicleId]);

  useEffect(() => {
    load();
  }, [load]);

  return { routes, loading };
}

function RouteHistoryPanel({ vehicle, onSelectRoute, selectedRouteId }) {
  const { routes, loading } = useVehicleRoutes(vehicle?.id);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-bold text-slate-800">Historial de Rutas — {vehicle.unit}</h3>
      {loading ? (
        <p className="text-xs text-slate-400">Cargando...</p>
      ) : routes.length === 0 ? (
        <p className="text-xs text-slate-400">Sin rutas guardadas todavía para esta unidad.</p>
      ) : (
        <div className="space-y-1.5">
          {routes.map((r) => (
            <button
              key={r.id}
              onClick={() => onSelectRoute(selectedRouteId === r.id ? null : r.id)}
              className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-xs transition ${
                selectedRouteId === r.id ? "border-blue-300 bg-blue-50" : "border-slate-200 hover:border-blue-200"
              }`}
            >
              <span className="font-semibold text-slate-700">
                {new Date(r.startedAt).toLocaleDateString("es-MX")} · {r.driverName || "Conductor sin nombre"}
              </span>
              <span className="text-slate-500">{r.distanceKm != null ? `${r.distanceKm.toFixed(1)} km` : "—"}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function useDriverTracking(vehicleId) {
  const { profile, user } = useAuth();
  const { showToast } = useToast();
  const [tracking, setTracking] = useState(false);
  const [pointCount, setPointCount] = useState(0);
  const [lastFix, setLastFix] = useState(null);
  const [error, setError] = useState("");
  const watchIdRef = useRef(null);
  const lastSentRef = useRef(0);
  const routeIdRef = useRef(null);
  const vehicleIdRef = useRef(vehicleId);

  useEffect(() => {
    vehicleIdRef.current = vehicleId;
  }, [vehicleId]);

  useEffect(() => {
    return () => {
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, []);

  async function handleFix(pos) {
    const now = Date.now();
    if (now - lastSentRef.current < 8000) return;
    lastSentRef.current = now;
    const { latitude, longitude, speed, heading, accuracy } = pos.coords;
    const speedKmh = speed != null && speed >= 0 ? speed * 3.6 : null;
    setLastFix({ lat: latitude, lng: longitude, speed: speedKmh });

    const currentRouteId = routeIdRef.current;
    const currentVehicleId = vehicleIdRef.current;
    if (!currentRouteId || !currentVehicleId) return;

    await supabase.from("vehicle_positions").upsert({
      vehicleId: currentVehicleId,
      companyId: profile.companyId,
      routeId: currentRouteId,
      lat: latitude,
      lng: longitude,
      speed: speedKmh,
      heading,
      accuracy,
      source: "phone",
      recordedAt: new Date().toISOString(),
    });

    await supabase.from("route_points").insert({
      routeId: currentRouteId,
      companyId: profile.companyId,
      lat: latitude,
      lng: longitude,
      speed: speedKmh,
      heading,
      accuracy,
      source: "phone",
    });

    setPointCount((c) => c + 1);
  }

  async function start() {
    if (!vehicleId) return;
    if (!navigator.geolocation) {
      setError("Este navegador no soporta geolocalización.");
      return;
    }
    setError("");
    try {
      const { data, error: insertError } = await supabase
        .from("routes")
        .insert({
          vehicleId,
          companyId: profile.companyId,
          driverName: user?.user_metadata?.full_name?.trim() || user?.email,
          status: "active",
          createdBy: user.id,
        })
        .select()
        .single();
      if (insertError) throw insertError;
      routeIdRef.current = data.id;
      setPointCount(0);
      setTracking(true);
      watchIdRef.current = navigator.geolocation.watchPosition(
        handleFix,
        (geoErr) => setError(`Error de geolocalización: ${geoErr.message}`),
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
      );
    } catch (err) {
      setError(`No se pudo iniciar la ruta: ${err.message}`);
    }
  }

  async function stop() {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setTracking(false);
    const closingRouteId = routeIdRef.current;
    routeIdRef.current = null;
    if (!closingRouteId) return;
    try {
      const { data: points } = await supabase
        .from("route_points")
        .select("lat, lng")
        .eq("routeId", closingRouteId)
        .order("recordedAt", { ascending: true });
      let distanceKm = 0;
      if (points && points.length > 1) {
        for (let i = 1; i < points.length; i++) distanceKm += haversineKm(points[i - 1], points[i]);
      }
      await supabase.from("routes").update({ status: "completed", endedAt: new Date().toISOString(), distanceKm }).eq("id", closingRouteId);
      showToast(`Ruta guardada — ${distanceKm.toFixed(1)} km recorridos, ${pointCount} puntos.`);
    } catch (err) {
      showToast(`Error al cerrar la ruta: ${err.message}`);
    }
  }

  return { tracking, pointCount, lastFix, error, start, stop };
}

function DriverModeModal({ vehicles, onClose }) {
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? null);
  const { tracking, pointCount, lastFix, error, start, stop } = useDriverTracking(vehicleId);

  return (
    <Modal title="Modo Conductor" onClose={tracking ? () => {} : onClose} width="max-w-sm">
      <div className="space-y-4">
        <p className="text-xs text-slate-500">Deja esta pantalla abierta mientras manejas — el rastreo se detiene si sales de aquí.</p>
        <div>
          <label className="mb-1 block text-[11px] font-semibold text-slate-500">Unidad</label>
          <select
            value={vehicleId ?? ""}
            onChange={(e) => setVehicleId(Number(e.target.value))}
            disabled={tracking}
            className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-blue-400 focus:outline-none disabled:bg-slate-50"
          >
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.unit} — {v.plate}
              </option>
            ))}
          </select>
        </div>

        {tracking ? (
          <div className="space-y-1.5 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-700 ring-1 ring-emerald-200">
            <p className="flex items-center gap-1.5 font-semibold">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> Rastreando en vivo
            </p>
            <p>Puntos registrados: {pointCount}</p>
            {lastFix && (
              <p>
                Última posición: {lastFix.lat.toFixed(5)}, {lastFix.lng.toFixed(5)}
                {lastFix.speed != null && ` · ${lastFix.speed.toFixed(0)} km/h`}
              </p>
            )}
          </div>
        ) : (
          <p className="text-xs text-slate-400">Ruta detenida. Inicia para empezar a registrar tu recorrido.</p>
        )}

        {error && (
          <p className="flex items-center gap-1.5 rounded-lg bg-rose-50 px-2.5 py-2 text-[11px] font-medium text-rose-700">
            <AlertTriangle size={13} /> {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          {!tracking && (
            <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">
              Cerrar
            </button>
          )}
          {tracking ? (
            <button onClick={stop} className="rounded-lg bg-rose-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-700">
              Finalizar Ruta
            </button>
          ) : (
            <button onClick={start} className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
              Iniciar Ruta
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function LiveMapPage({ vehicles, onSelectVehicle }) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [activeVehicleId, setActiveVehicleId] = useState(vehicles[0]?.id ?? null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [driverModeOpen, setDriverModeOpen] = useState(false);
  const [selectedRouteId, setSelectedRouteId] = useState(null);
  const [routePolyline, setRoutePolyline] = useState(null);

  const positions = useLivePositions();

  const vehiclesWithStatus = useMemo(
    () =>
      vehicles.map((v) => {
        const position = positions[v.id] ?? null;
        return { ...v, position, gpsStatus: computeVehicleStatus(position) };
      }),
    [vehicles, positions]
  );

  const filtered = statusFilter === "all" ? vehiclesWithStatus : vehiclesWithStatus.filter((v) => v.gpsStatus === statusFilter);
  const activeVehicle = vehiclesWithStatus.find((v) => v.id === activeVehicleId) ?? vehiclesWithStatus[0];

  const markers = useMemo(
    () =>
      vehiclesWithStatus
        .filter((v) => v.position)
        .map((v) => ({ id: v.id, lat: v.position.lat, lng: v.position.lng, status: v.gpsStatus, label: v.unit })),
    [vehiclesWithStatus]
  );

  function focusVehicle(id) {
    setActiveVehicleId(id);
    setDrawerOpen(true);
    setSelectedRouteId(null);
    setRoutePolyline(null);
  }

  async function handleSelectRoute(routeId) {
    setSelectedRouteId(routeId);
    if (!routeId) {
      setRoutePolyline(null);
      return;
    }
    const { data } = await supabase.from("route_points").select("lat, lng").eq("routeId", routeId).order("recordedAt", { ascending: true });
    setRoutePolyline(data ?? []);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Mapa en Vivo</h1>
          <p className="mt-1 text-sm text-slate-500">Ubicación real de la flotilla, reportada por celular o tracker GPS.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
            <RefreshCw size={12} /> Tiempo real
          </span>
          <button
            onClick={() => setDriverModeOpen(true)}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
          >
            <Navigation size={14} /> Modo Conductor
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {FLEET_STATUS_FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setStatusFilter(f.id)}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
              statusFilter === f.id ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="relative h-[480px] w-full overflow-hidden rounded-2xl border border-slate-200 shadow-sm lg:w-[70%]">
          <LeafletMap markers={markers} routePolyline={routePolyline} onSelectMarker={focusVehicle} />

          {markers.length === 0 && (
            <div className="pointer-events-none absolute inset-x-0 top-3 z-[400] flex justify-center">
              <span className="rounded-full bg-white/95 px-3 py-1.5 text-[11px] font-semibold text-slate-500 shadow-md">
                Ninguna unidad ha reportado posición todavía — usa "Modo Conductor" para empezar.
              </span>
            </div>
          )}

          <div className="absolute bottom-4 left-4 z-[400] flex flex-wrap items-center gap-3 rounded-xl bg-white/95 px-3 py-2 text-[11px] font-medium text-slate-500 shadow-md backdrop-blur">
            {Object.entries(LIVE_MAP_STATUS_STYLES).map(([key, s]) => (
              <span key={key} className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: MAP_MARKER_COLOR[key] }} /> {s.label}
              </span>
            ))}
          </div>
        </div>

        <div className="w-full space-y-2 overflow-y-auto lg:w-[30%]" style={{ maxHeight: 480 }}>
          {filtered.map((v) => {
            const s = GPS_STATUS_STYLES[v.gpsStatus];
            const isActive = activeVehicle?.id === v.id;
            return (
              <button
                key={v.id}
                onClick={() => focusVehicle(v.id)}
                className={`block w-full rounded-2xl border p-3 text-left shadow-sm transition ${
                  isActive ? "border-blue-300 bg-blue-50/60" : "border-slate-200 bg-white hover:border-blue-200"
                }`}
              >
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-slate-800">
                    {v.unit} <span className="font-medium text-slate-400">· {v.plate}</span>
                  </p>
                  <span className="flex items-center gap-1 text-[10px] font-semibold text-slate-500">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: MAP_MARKER_COLOR[v.gpsStatus] }} /> {s.label}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px] text-slate-500">
                  <span>
                    Velocidad: <b className="text-slate-700">{v.position?.speed != null ? `${v.position.speed.toFixed(0)} km/h` : "—"}</b>
                  </span>
                  <span>
                    Odómetro: <b className="text-slate-700">{v.kmActual.toLocaleString()} km</b>
                  </span>
                  <span>
                    Última señal: <b className="text-slate-700">{timeAgoLabel(v.position?.recordedAt)}</b>
                  </span>
                  <span>
                    Fuente: <b className="text-slate-700">{v.position?.source === "hardware" ? "Tracker GPS" : v.position ? "Celular" : "—"}</b>
                  </span>
                </div>
              </button>
            );
          })}
          {filtered.length === 0 && <p className="py-8 text-center text-xs text-slate-400">Sin unidades en este filtro.</p>}
        </div>
      </div>

      {drawerOpen && activeVehicle && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800">Telemetría — {activeVehicle.unit}</h3>
              <button onClick={() => setDrawerOpen(false)} className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
                <X size={14} />
              </button>
            </div>
            <button
              onClick={() => onSelectVehicle(activeVehicle.id)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              <Truck size={13} /> Ver Expediente
            </button>
          </div>

          <RouteHistoryPanel vehicle={activeVehicle} onSelectRoute={handleSelectRoute} selectedRouteId={selectedRouteId} />
        </div>
      )}

      {driverModeOpen && <DriverModeModal vehicles={vehicles} onClose={() => setDriverModeOpen(false)} />}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Traslados                                                              */
/* ---------------------------------------------------------------------- */

const TRIP_STATUS_STYLES = {
  scheduled: { label: "Programado", className: "bg-blue-50 text-blue-700 ring-blue-200" },
  ongoing: { label: "En Curso", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  completed: { label: "Completado", className: "bg-slate-100 text-slate-600 ring-slate-200" },
  cancelled: { label: "Cancelado", className: "bg-rose-50 text-rose-700 ring-rose-200" },
};

const TRIP_STATUS_FILTERS = [
  { id: "all", label: "Todos" },
  { id: "scheduled", label: "Programado" },
  { id: "ongoing", label: "En Curso" },
  { id: "completed", label: "Completado" },
  { id: "cancelled", label: "Cancelado" },
];

const TRIPS_SEED = [
  { id: 1, unit: "Unidad 12", driver: "Ricardo Pérez", origin: "Nanchital", destination: "Coatzacoalcos", date: "2026-08-12", cargo: "Carga general — 12 ton", status: "ongoing" },
  { id: 2, unit: "Unidad 03", driver: "Diana Ruiz", origin: "Coatzacoalcos", destination: "Minatitlán", date: "2026-08-12", cargo: "Materiales de construcción — 8 ton", status: "ongoing" },
  { id: 3, unit: "Unidad 21", driver: "José Torres", origin: "Nanchital", destination: "Coatzacoalcos", date: "2026-08-12", cargo: "Contenedor refrigerado", status: "ongoing" },
  { id: 4, unit: "Unidad 07", driver: "Lucía Gómez", origin: "Coatzacoalcos", destination: "Acayucan", date: "2026-08-13", cargo: "Paquetería industrial", status: "scheduled" },
  { id: 5, unit: "Unidad 09", driver: "Marco Aguilar", origin: "Patio Nanchital", destination: "Coatzacoalcos", date: "2026-08-10", cargo: "Equipo pesado", status: "completed" },
];

function TripFormModal({ vehicles, onSave, onClose }) {
  const [tripType, setTripType] = useState("cargo");
  const [unit, setUnit] = useState(vehicles[0]?.unit ?? "");
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [cargo, setCargo] = useState("");
  const [passengers, setPassengers] = useState("");

  const inputClass = "w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-blue-400 focus:outline-none";
  const labelClass = "mb-1 block text-[11px] font-semibold text-slate-500";

  function handleSubmit(e) {
    e.preventDefault();
    if (!origin.trim() || !destination.trim()) return;
    const driver = vehicles.find((v) => v.unit === unit)?.driver.name ?? "";
    const cargoLabel = tripType === "passengers" ? (passengers.trim() || "Sin detalle de pasajeros") : cargo.trim();
    onSave({ unit, driver, tripType, origin: origin.trim(), destination: destination.trim(), date, cargo: cargoLabel, status: "scheduled" });
  }

  return (
    <Modal title="Nuevo Traslado" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
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
        <div>
          <label className={labelClass}>Unidad</label>
          <select value={unit} onChange={(e) => setUnit(e.target.value)} className={inputClass}>
            {vehicles.map((v) => (
              <option key={v.unit} value={v.unit}>
                {v.unit} — {v.driver.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Origen</label>
            <input value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="Ej. Nanchital" className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Destino</label>
            <input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Ej. Coatzacoalcos" className={inputClass} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Fecha</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
          </div>
          {tripType === "cargo" ? (
            <div>
              <label className={labelClass}>Carga</label>
              <input value={cargo} onChange={(e) => setCargo(e.target.value)} placeholder="Ej. Carga general — 10 ton" className={inputClass} />
            </div>
          ) : (
            <div>
              <label className={labelClass}>Pasajeros</label>
              <input value={passengers} onChange={(e) => setPassengers(e.target.value)} placeholder="Ej. 4 pasajeros — personal administrativo" className={inputClass} />
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">
            Cancelar
          </button>
          <button type="submit" className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
            Asignar Traslado
          </button>
        </div>
      </form>
    </Modal>
  );
}

function TransfersPage({ vehicles, trips, insertTrip, updateTrip }) {
  const { format } = useDateFormat();
  const { showToast } = useToast();
  const [statusFilter, setStatusFilter] = useState("all");
  const [modalOpen, setModalOpen] = useState(false);

  const filtered = statusFilter === "all" ? trips : trips.filter((t) => t.status === statusFilter);
  const order = ["scheduled", "ongoing", "completed"];

  async function addTrip(trip) {
    try {
      await insertTrip(trip);
      setModalOpen(false);
    } catch (err) {
      showToast(`Error al asignar traslado: ${err.message}`);
    }
  }
  async function advanceStatus(trip) {
    const idx = order.indexOf(trip.status);
    if (idx === -1 || idx === order.length - 1) return;
    try {
      await updateTrip(trip.id, { status: order[idx + 1] });
    } catch (err) {
      showToast(`Error al actualizar traslado: ${err.message}`);
    }
  }
  async function cancelTrip(trip) {
    try {
      await updateTrip(trip.id, { status: "cancelled" });
    } catch (err) {
      showToast(`Error al cancelar traslado: ${err.message}`);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Traslados</h1>
          <p className="mt-1 text-sm text-slate-500">Asignación de viajes, rutas y carga por unidad.</p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
        >
          <Plus size={15} /> Nuevo Traslado
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {TRIP_STATUS_FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setStatusFilter(f.id)}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
              statusFilter === f.id ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {filtered.map((t) => {
          const s = TRIP_STATUS_STYLES[t.status];
          const canAdvance = order.includes(t.status) && order.indexOf(t.status) < order.length - 1;
          const canCancel = t.status !== "completed" && t.status !== "cancelled";
          return (
            <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="text-xs font-bold text-slate-800">
                    {t.unit} <span className="font-medium text-slate-400">· {t.driver}</span>
                  </p>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${
                      (t.tripType ?? "cargo") === "passengers"
                        ? "bg-indigo-50 text-indigo-700 ring-indigo-200"
                        : "bg-slate-100 text-slate-600 ring-slate-200"
                    }`}
                  >
                    {(t.tripType ?? "cargo") === "passengers" ? <User size={10} /> : <Truck size={10} />}
                    {(t.tripType ?? "cargo") === "passengers" ? "Pasajeros" : "Carga"}
                  </span>
                </div>
                <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
                  {t.origin} <Navigation size={13} className="text-blue-500" /> {t.destination}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  {t.cargo} · {formatDate(t.date, format)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${s.className}`}>{s.label}</span>
                {canAdvance && (
                  <button
                    onClick={() => advanceStatus(t)}
                    className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    Avanzar Estado
                  </button>
                )}
                {canCancel && (
                  <button
                    onClick={() => cancelTrip(t)}
                    className="rounded-lg border border-rose-200 px-2.5 py-1.5 text-[11px] font-semibold text-rose-600 hover:bg-rose-50"
                  >
                    Cancelar
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && <p className="py-8 text-center text-xs text-slate-400">Sin traslados en este estado.</p>}
      </div>

      {modalOpen && <TripFormModal vehicles={vehicles} onSave={addTrip} onClose={() => setModalOpen(false)} />}
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

const INCIDENTS_SEED = [
  { id: 1, unit: "Unidad 21", severity: "high", status: "attending", description: "Tráfico intenso y posible retención en puente peatonal", reportedBy: "José Torres", date: "2026-08-12" },
  { id: 2, unit: "Unidad 09", severity: "critical", status: "open", description: "Falla mecánica — sobrecalentamiento de motor", reportedBy: "Marco Aguilar", date: "2026-08-10" },
  { id: 3, unit: "Unidad 07", severity: "medium", status: "resolved", description: "Ponchadura de llanta trasera derecha", reportedBy: "Lucía Gómez", date: "2026-08-05" },
  { id: 4, unit: "Unidad 12", severity: "low", status: "resolved", description: "Retraso menor por cierre parcial de vialidad", reportedBy: "Ricardo Pérez", date: "2026-08-02" },
];

function IncidentFormModal({ vehicles, onSave, onClose }) {
  const [unit, setUnit] = useState(vehicles[0]?.unit ?? "");
  const [severity, setSeverity] = useState("medium");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const inputClass = "w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-blue-400 focus:outline-none";
  const labelClass = "mb-1 block text-[11px] font-semibold text-slate-500";

  function handleSubmit(e) {
    e.preventDefault();
    if (!description.trim()) return;
    const driver = vehicles.find((v) => v.unit === unit)?.driver.name ?? "";
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
                  {v.unit} — {v.driver.name}
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
/*  Configuración / Cuenta / Reporte de problemas                         */
/* ---------------------------------------------------------------------- */

const CURRENCY_OPTIONS = [
  { code: "MXN", label: "Peso mexicano (MXN)" },
  { code: "USD", label: "Dólar estadounidense (USD)" },
  { code: "EUR", label: "Euro (EUR)" },
  { code: "GTQ", label: "Quetzal guatemalteco (GTQ)" },
  { code: "COP", label: "Peso colombiano (COP)" },
];

function CompanyCurrencySetting() {
  const { profile, updateCompanyCurrency } = useAuth();
  const { showToast } = useToast();
  const [saving, setSaving] = useState(false);
  const currentCurrency = profile?.company?.currency || "MXN";
  const isCompanyAdmin = !!(profile?.isSuperAdmin || profile?.companyRole === "admin");

  async function handleChange(e) {
    const currency = e.target.value;
    setSaving(true);
    try {
      await updateCompanyCurrency(currency);
      showToast(`Moneda de la empresa actualizada a ${currency}.`);
    } catch (err) {
      showToast(`Error al actualizar moneda: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-1 text-sm font-bold text-slate-800">Moneda de la empresa</h2>
      <p className="mb-3 text-xs text-slate-500">Se usa para mostrar montos en Facturas, Mantenimiento y Trámites.</p>
      {isCompanyAdmin ? (
        <select
          value={currentCurrency}
          onChange={handleChange}
          disabled={saving}
          className="w-full max-w-xs rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-blue-400 focus:outline-none disabled:opacity-60"
        >
          {CURRENCY_OPTIONS.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </select>
      ) : (
        <p className="text-xs font-medium text-slate-600">
          {CURRENCY_OPTIONS.find((c) => c.code === currentCurrency)?.label || currentCurrency}
          <span className="ml-1.5 text-[11px] font-normal text-slate-400">— solo un administrador de la empresa puede cambiarla.</span>
        </p>
      )}
    </div>
  );
}

function BotLinkSetting() {
  const { profile, unlinkCompanyBot } = useAuth();
  const { showToast } = useToast();
  const [unlinking, setUnlinking] = useState(false);
  const isCompanyAdmin = !!(profile?.isSuperAdmin || profile?.companyRole === "admin");
  const company = profile?.company;
  const connected = !!(company?.botChannel && company?.botChatId);

  function copyCode() {
    if (!company?.botLinkCode) return;
    navigator.clipboard?.writeText(company.botLinkCode);
    showToast("Código copiado.");
  }

  async function handleUnlink() {
    setUnlinking(true);
    try {
      await unlinkCompanyBot();
      showToast("Bot desvinculado.");
    } catch (err) {
      showToast(`Error al desvincular: ${err.message}`);
    } finally {
      setUnlinking(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-1 text-sm font-bold text-slate-800">Bot de ingesta (Telegram)</h2>
      <p className="mb-3 text-xs text-slate-500">
        Envía fotos, PDFs o texto de facturas por chat y Navío las registra automáticamente como pendientes de revisión.
      </p>

      {connected ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
            <CheckCircle2 size={14} /> Conectado por Telegram
          </span>
          {isCompanyAdmin && (
            <button
              onClick={handleUnlink}
              disabled={unlinking}
              className="rounded-lg border border-rose-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-60"
            >
              {unlinking ? "Desvinculando..." : "Desvincular"}
            </button>
          )}
        </div>
      ) : isCompanyAdmin ? (
        <div className="space-y-2.5">
          <p className="text-xs text-slate-600">
            1. Abre Telegram y busca al bot de Navío. 2. Envíale este mensaje:
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
              /vincular {company?.botLinkCode || "—"}
            </code>
            <button
              onClick={copyCode}
              className="rounded-lg border border-slate-200 px-2.5 py-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
            >
              Copiar
            </button>
          </div>
          <p className="text-[11px] text-slate-400">
            Este código es solo para tu empresa — no lo compartas fuera de tu equipo.
          </p>
        </div>
      ) : (
        <p className="text-xs font-medium text-slate-600">
          Sin conectar todavía. <span className="text-[11px] font-normal text-slate-400">— solo un administrador de la empresa puede vincularlo.</span>
        </p>
      )}
    </div>
  );
}

function SettingsPage() {
  const [notifPrefs, setNotifPrefs] = useState({ email: true, whatsapp: true, criticalOnly: false });

  function toggle(key) {
    setNotifPrefs((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const options = [
    { key: "email", label: "Notificaciones por correo electrónico" },
    { key: "whatsapp", label: "Notificaciones por WhatsApp" },
    { key: "criticalOnly", label: "Solo alertas críticas" },
  ];

  return (
    <div className="max-w-xl space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Configuración</h1>
        <p className="mt-1 text-sm text-slate-500">Preferencias regionales y de notificaciones de la plataforma.</p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-bold text-slate-800">Formato de fecha regional</h2>
        <DateFormatToggle />
      </div>

      <CompanyCurrencySetting />

      <BotLinkSetting />

      <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-1 text-sm font-bold text-slate-800">Notificaciones</h2>
        {options.map((o) => (
          <label key={o.key} className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-100 px-3 py-2.5 hover:bg-slate-50">
            <span className="text-xs font-medium text-slate-600">{o.label}</span>
            <input type="checkbox" checked={notifPrefs[o.key]} onChange={() => toggle(o.key)} className="h-4 w-4 accent-blue-600" />
          </label>
        ))}
      </div>
    </div>
  );
}

function MfaEnrollModal({ onClose, onEnrolled }) {
  const { enrollMFA, verifyFactor } = useAuth();
  const [step, setStep] = useState("loading"); // loading | scan | error
  const [factorId, setFactorId] = useState(null);
  const [qrCode, setQrCode] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    enrollMFA()
      .then((data) => {
        if (cancelled) return;
        setFactorId(data.id);
        setQrCode(data.totp.qr_code);
        setSecret(data.totp.secret);
        setStep("scan");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(translateAuthError(err));
        setStep("error");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleVerify(e) {
    e.preventDefault();
    setError("");
    setVerifying(true);
    try {
      await verifyFactor(factorId, code.trim());
      onEnrolled();
    } catch (err) {
      setError(translateAuthError(err));
    } finally {
      setVerifying(false);
    }
  }

  return (
    <Modal title="Activar verificación en dos pasos" onClose={onClose}>
      {step === "loading" && <p className="py-4 text-center text-xs text-slate-400">Generando código QR...</p>}
      {step === "error" && <AuthErrorMessage message={error} />}
      {step === "scan" && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            Escanea este código con Google Authenticator, Authy o cualquier app compatible con TOTP.
          </p>
          <div className="flex justify-center rounded-xl border border-slate-100 bg-white p-3">
            {qrCode.startsWith("data:") ? (
              <img src={qrCode} alt="Código QR" className="h-40 w-40" />
            ) : (
              <div className="h-40 w-40" dangerouslySetInnerHTML={{ __html: qrCode }} />
            )}
          </div>
          <p className="text-center text-[10px] text-slate-400">
            ¿No puedes escanear? Ingresa este código manualmente:
            <br />
            <span className="font-mono font-semibold text-slate-600">{secret}</span>
          </p>
          <form onSubmit={handleVerify} className="space-y-2">
            <label className="mb-1 block text-[11px] font-semibold text-slate-500">Código de 6 dígitos</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoFocus
              placeholder="123456"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-center text-lg tracking-[0.5em] focus:border-blue-400 focus:outline-none"
            />
            <AuthErrorMessage message={error} />
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">
                Cancelar
              </button>
              <button
                type="submit"
                disabled={verifying || code.length < 6}
                className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {verifying ? "Verificando..." : "Activar"}
              </button>
            </div>
          </form>
        </div>
      )}
    </Modal>
  );
}

function AccountPage({ userName, userEmail, userAvatar, onSignOut, companyName, isSuperAdmin, isCompanyAdmin }) {
  const { listMFAFactors, unenrollMFA } = useAuth();
  const { showToast } = useToast();
  const [signingOut, setSigningOut] = useState(false);
  const [factors, setFactors] = useState([]);
  const [loadingFactors, setLoadingFactors] = useState(true);
  const [enrollOpen, setEnrollOpen] = useState(false);

  const loadFactors = useCallback(() => {
    setLoadingFactors(true);
    listMFAFactors()
      .then((data) => setFactors((data?.totp ?? []).filter((f) => f.status === "verified")))
      .catch(() => {})
      .finally(() => setLoadingFactors(false));
  }, [listMFAFactors]);

  useEffect(() => {
    loadFactors();
  }, [loadFactors]);

  async function handleRemoveFactor(factorId) {
    try {
      await unenrollMFA(factorId);
      showToast("Verificación en dos pasos desactivada.");
      loadFactors();
    } catch (err) {
      showToast(`Error: ${err.message}`);
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await onSignOut();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="max-w-xl space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Cuenta</h1>
        <p className="mt-1 text-sm text-slate-500">Perfil y permisos del usuario activo.</p>
      </div>

      <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <img src={userAvatar} alt={userName} className="h-16 w-16 rounded-full bg-blue-50 ring-2 ring-blue-100" />
        <div>
          <p className="text-sm font-bold text-slate-800">{userName}</p>
          <p className="text-xs text-slate-400">
            {companyName ? `${companyName} · ` : ""}
            {userEmail}
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {isSuperAdmin && (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 ring-1 ring-blue-200">
                <Shield size={10} /> Super-administrador
              </span>
            )}
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${
                isCompanyAdmin ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-slate-100 text-slate-600 ring-slate-200"
              }`}
            >
              {isCompanyAdmin ? "Administrador de empresa" : "Miembro de empresa"}
            </span>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-bold text-slate-800">Permisos del rol</h2>
        <div className="space-y-1.5 text-xs text-slate-600">
          <p className="flex items-center gap-2"><CheckCircle2 size={13} className="text-emerald-600" /> Ver todos los módulos de tu empresa</p>
          <p className="flex items-center gap-2"><CheckCircle2 size={13} className="text-emerald-600" /> Confirmar y validar registros de IA</p>
          <p className="flex items-center gap-2"><CheckCircle2 size={13} className="text-emerald-600" /> Agregar unidades, traslados e incidencias</p>
          <p className="flex items-center gap-2">
            {isCompanyAdmin ? (
              <CheckCircle2 size={13} className="text-emerald-600" />
            ) : (
              <X size={13} className="text-slate-300" />
            )}
            Editar o eliminar unidades de la flota
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-1 text-sm font-bold text-slate-800">Seguridad</h2>
        <p className="mb-3 text-xs text-slate-500">
          Verificación en dos pasos con una app de autenticación (Google Authenticator, Authy, etc.).
        </p>
        {loadingFactors ? (
          <p className="text-xs text-slate-400">Cargando...</p>
        ) : factors.length > 0 ? (
          <div className="space-y-2">
            {factors.map((f) => (
              <div key={f.id} className="flex items-center justify-between rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2.5">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                  <ShieldCheck size={14} /> Activa — {f.friendly_name || "App de autenticación"}
                </span>
                <button
                  onClick={() => handleRemoveFactor(f.id)}
                  className="rounded-lg border border-rose-200 px-2.5 py-1 text-[11px] font-semibold text-rose-600 hover:bg-rose-50"
                >
                  Desactivar
                </button>
              </div>
            ))}
          </div>
        ) : (
          <button
            onClick={() => setEnrollOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            <Lock size={14} /> Activar verificación en dos pasos
          </button>
        )}
      </div>

      <button
        onClick={handleSignOut}
        disabled={signingOut}
        className="flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-100 disabled:opacity-60"
      >
        <LogOut size={14} /> {signingOut ? "Cerrando sesión..." : "Cerrar Sesión"}
      </button>

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

const COMMUNITY_POSTS_SEED = [
  {
    id: 1,
    title: "Exportar historial de mantenimiento en PDF",
    description: "Sería útil poder exportar el historial de servicios de una unidad directamente en PDF para compartirlo con el cliente.",
    category: "feature",
    status: "next",
    votes: 7,
    author: "Johana",
    date: "2026-08-05",
  },
  {
    id: 2,
    title: "La confirmación de tickets tarda en reflejarse",
    description: "A veces al confirmar un ticket de combustible el estado no cambia hasta recargar la página.",
    category: "bug",
    status: "in-progress",
    votes: 4,
    author: "Ricardo Pérez",
    date: "2026-08-02",
  },
  {
    id: 3,
    title: "Notificaciones push para vencimientos",
    description: "Agregar notificaciones push (no solo la campanita) cuando una tenencia o póliza esté por vencer.",
    category: "feature",
    status: "backlog",
    votes: 5,
    author: "Lucía Gómez",
    date: "2026-07-28",
  },
  {
    id: 4,
    title: "Modo oscuro",
    description: "El dashboard se usa mucho de noche en la central de monitoreo; un modo oscuro ayudaría bastante a la vista.",
    category: "feature",
    status: "backlog",
    votes: 3,
    author: "José Torres",
    date: "2026-07-20",
  },
  {
    id: 5,
    title: "Historial de documentos no carga en móvil",
    description: "En pantallas pequeñas la sección de Trámites del expediente no muestra el historial de documentos anteriores.",
    category: "bug",
    status: "done",
    votes: 6,
    author: "Marco Aguilar",
    date: "2026-07-10",
  },
];

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
  const connected = !!(profile?.company?.botChannel && profile?.company?.botChatId);

  const load = useCallback(() => {
    if (!supabase || !profile?.companyId) return;
    supabase
      .from("bot_ingestions")
      .select("*")
      .order("createdAt", { ascending: false })
      .limit(3)
      .then(({ data }) => setIngestions(data ?? []));
  }, [profile?.companyId]);

  useEffect(() => {
    if (!connected) return;
    load();
    const interval = window.setInterval(load, 30000);
    return () => window.clearInterval(interval);
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

function Sidebar({ open, activeTab, activeSubId, onNavigate, onNavigateSub, onLogoClick, isSuperAdmin }) {
  const [expanded, setExpanded] = useState({ maintenance: true, compliance: true });

  function toggleExpanded(id) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <aside
      className={`sticky top-0 flex h-screen shrink-0 flex-col border-r border-slate-200 bg-white transition-all duration-200 ${
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
          const hasChildren = !!item.children;
          return (
            <div key={item.id}>
              <button
                onClick={() => {
                  onNavigate(item.id);
                  if (hasChildren) toggleExpanded(item.id);
                }}
                title={item.label}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  active ? "bg-blue-600 text-white shadow-sm" : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                } ${open ? "" : "justify-center"}`}
              >
                <Icon size={18} className="shrink-0" />
                {open && <span className="flex-1 truncate text-left">{item.label}</span>}
                {open && hasChildren && (
                  expanded[item.id] ? <ChevronUp size={14} className="shrink-0" /> : <ChevronDown size={14} className="shrink-0" />
                )}
              </button>
              {open && hasChildren && expanded[item.id] && (
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
              v.driver.name.toLowerCase().includes(q)
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
                      <img src={v.photo} alt={v.unit} className="h-8 w-11 shrink-0 rounded object-cover ring-1 ring-slate-200" />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-slate-700">
                          {v.unit} <span className="font-normal text-slate-400">· {v.plate}</span>
                        </p>
                        <p className="truncate text-[10px] text-slate-400">{v.driver.name}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DateFormatToggle />
          <button
            onClick={onLogoClick}
            title="Ir al Home"
            className="hidden text-lg font-extrabold tracking-tight text-blue-700 hover:text-blue-800 lg:block"
          >
            NAVIO
          </button>
          <button
            onClick={() => setNotifOpen((v) => !v)}
            className="relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
            aria-label="Notificaciones"
          >
            <Bell size={19} />
            <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-white" />
          </button>
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
/*  Admin — aprobación de empresas                                        */
/* ---------------------------------------------------------------------- */

function AdminCompaniesPage() {
  const { approveCompany, rejectCompany } = useAuth();
  const { showToast } = useToast();
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [filter, setFilter] = useState("pending");
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(() => {
    if (!supabase) return;
    setLoading(true);
    supabase
      .from("companies")
      .select("*")
      .order("createdAt", { ascending: false })
      .then(({ data, error }) => {
        if (error) setLoadError(error.message);
        else setCompanies(data ?? []);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(
    () => ({
      pending: companies.filter((c) => c.status === "pending").length,
      approved: companies.filter((c) => c.status === "approved").length,
      rejected: companies.filter((c) => c.status === "rejected").length,
    }),
    [companies]
  );

  const filtered = filter === "all" ? companies : companies.filter((c) => c.status === filter);

  async function handleApprove(company) {
    setBusyId(company.id);
    try {
      const code = await approveCompany(company.id);
      showToast(`${company.name} aprobada. Código de invitación: ${code}`);
      load();
    } catch (err) {
      showToast(`Error al aprobar: ${err.message}`);
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(company) {
    setBusyId(company.id);
    try {
      await rejectCompany(company.id);
      showToast(`${company.name} rechazada.`);
      load();
    } catch (err) {
      showToast(`Error al rechazar: ${err.message}`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Administración de empresas</h1>
        <p className="mt-1 text-sm text-slate-500">
          Revisa las solicitudes de alta de empresas y aprueba o rechaza el acceso a Navío.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <KpiCard widget={{ label: "Pendientes", value: counts.pending, detail: "Por revisar", icon: Clock, tone: "amber" }} />
        <KpiCard widget={{ label: "Aprobadas", value: counts.approved, detail: "Con acceso activo", icon: CheckCircle2, tone: "emerald" }} />
        <KpiCard widget={{ label: "Rechazadas", value: counts.rejected, detail: "Solicitud denegada", icon: AlertTriangle, tone: "rose" }} />
      </div>

      <div className="flex flex-wrap gap-2">
        {["pending", "approved", "rejected", "all"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
              filter === f ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
            }`}
          >
            {f === "pending" ? "Pendientes" : f === "approved" ? "Aprobadas" : f === "rejected" ? "Rechazadas" : "Todas"}
          </button>
        ))}
      </div>

      {loadError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-600">
          No se pudo cargar la lista de empresas: {loadError}
        </div>
      )}

      {loading ? (
        <p className="py-10 text-center text-xs text-slate-400">Cargando empresas...</p>
      ) : filtered.length === 0 ? (
        <p className="py-10 text-center text-xs text-slate-400">No hay empresas en este filtro.</p>
      ) : (
        <div className="space-y-3">
          {filtered.map((c) => {
            const statusMeta = COMPANY_STATUS_META[c.status] ?? COMPANY_STATUS_META.pending;
            return (
              <div key={c.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-bold text-slate-800">{c.name}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusMeta.className}`}>{statusMeta.label}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {c.industry || "Giro sin especificar"} · {c.fleetSize || "Tamaño de flota sin especificar"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {c.contactName || "Sin contacto"} · {c.contactEmail || "sin correo"} · {c.contactPhone || "sin teléfono"}
                    </p>
                    {c.needs && <p className="mt-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">"{c.needs}"</p>}
                    {c.status === "approved" && c.inviteCode && (
                      <p className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700">
                        <ShieldCheck size={12} /> Código de invitación: <span className="font-mono">{c.inviteCode}</span>
                      </p>
                    )}
                  </div>
                  {c.status === "pending" && (
                    <div className="flex shrink-0 gap-2">
                      <button
                        onClick={() => handleApprove(c)}
                        disabled={busyId === c.id}
                        className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
                      >
                        Aprobar
                      </button>
                      <button
                        onClick={() => handleReject(c)}
                        disabled={busyId === c.id}
                        className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-[11px] font-semibold text-rose-600 hover:bg-rose-100 disabled:opacity-60"
                      >
                        Rechazar
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  App móvil — Modo de campo (celular)                                   */
/* ---------------------------------------------------------------------- */

const MOBILE_TABS = [
  { id: "home", label: "Inicio", icon: Home },
  { id: "trip", label: "Viaje", icon: Navigation },
  { id: "register", label: "Registrar", icon: Plus },
  { id: "account", label: "Cuenta", icon: User },
];

function MobileBottomNav({ tab, onChange }) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-slate-200 bg-white shadow-[0_-2px_10px_rgba(0,0,0,0.05)]"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {MOBILE_TABS.map((t) => {
        const Icon = t.icon;
        const active = tab === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-semibold ${active ? "text-blue-600" : "text-slate-400"}`}
          >
            <Icon size={20} />
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}

function MobileHomeTab({ vehicles, userName, companyName, onOpenTrip }) {
  return (
    <div className="space-y-4 p-4 pb-24">
      <div>
        <p className="text-sm text-slate-500">Hola,</p>
        <h1 className="text-xl font-bold text-slate-900">{userName}</h1>
        {companyName && <p className="text-xs text-slate-400">{companyName}</p>}
      </div>

      <button onClick={onOpenTrip} className="flex w-full items-center justify-between rounded-2xl bg-blue-600 p-4 text-white shadow-sm">
        <span className="text-left">
          <span className="block text-xs font-medium text-blue-100">¿Vas a manejar?</span>
          <span className="block text-sm font-bold">Iniciar o finalizar viaje</span>
        </span>
        <Navigation size={22} />
      </button>

      <div>
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Flota ({vehicles.length})</h2>
        <div className="space-y-2">
          {vehicles.map((v) => {
            const health = HEALTH_TONE(v.healthScore);
            return (
              <div key={v.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3">
                <div>
                  <p className="text-xs font-bold text-slate-800">
                    {v.unit} <span className="font-medium text-slate-400">· {v.plate}</span>
                  </p>
                  <p className="text-[11px] text-slate-500">{v.driver?.name || "Sin conductor"}</p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${health.className}`}>{v.healthScore}%</span>
              </div>
            );
          })}
          {vehicles.length === 0 && <p className="py-6 text-center text-xs text-slate-400">Sin unidades registradas todavía.</p>}
        </div>
      </div>
    </div>
  );
}

function MobileTripTab({ vehicles }) {
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? null);
  const { tracking, pointCount, lastFix, error, start, stop } = useDriverTracking(vehicleId);

  return (
    <div className="space-y-4 p-4 pb-24">
      <h1 className="text-xl font-bold text-slate-900">Viaje</h1>
      <div>
        <label className="mb-1 block text-[11px] font-semibold text-slate-500">Unidad</label>
        <select
          value={vehicleId ?? ""}
          onChange={(e) => setVehicleId(Number(e.target.value))}
          disabled={tracking}
          className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-blue-400 focus:outline-none disabled:bg-slate-50"
        >
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.unit} — {v.plate}
            </option>
          ))}
        </select>
      </div>

      {tracking ? (
        <div className="space-y-2 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-700 ring-1 ring-emerald-200">
          <p className="flex items-center gap-2 text-base font-bold">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-500" /> Rastreando en vivo
          </p>
          <p>Puntos registrados: {pointCount}</p>
          {lastFix && (
            <p className="text-xs">
              {lastFix.lat.toFixed(5)}, {lastFix.lng.toFixed(5)}
              {lastFix.speed != null && ` · ${lastFix.speed.toFixed(0)} km/h`}
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-slate-400">Sin viaje activo.</p>
      )}

      {error && (
        <p className="flex items-center gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
          <AlertTriangle size={13} /> {error}
        </p>
      )}

      {tracking ? (
        <button onClick={stop} className="w-full rounded-2xl bg-rose-600 py-4 text-base font-bold text-white shadow-sm">
          Finalizar Viaje
        </button>
      ) : (
        <button onClick={start} className="w-full rounded-2xl bg-blue-600 py-4 text-base font-bold text-white shadow-sm">
          Iniciar Viaje
        </button>
      )}
    </div>
  );
}

function MobileRegisterTab({ onOpenForm, maintenanceRecords, complianceRecords, fuelRecords, travelExpenses }) {
  const pendingCount =
    maintenanceRecords.filter((r) => r.status === "pending").length +
    complianceRecords.filter((r) => r.status === "pending").length +
    fuelRecords.filter((r) => r.status === "pending").length +
    travelExpenses.filter((r) => r.status === "pending").length;

  const options = [
    { module: "fuel", label: "Combustible", icon: Fuel, tone: "bg-sky-50 text-sky-600" },
    { module: "maintenance", label: "Mantenimiento", icon: Wrench, tone: "bg-amber-50 text-amber-600" },
    { module: "compliance", label: "Trámites", icon: ShieldCheck, tone: "bg-emerald-50 text-emerald-600" },
    { module: "travel", label: "Viáticos", icon: Receipt, tone: "bg-violet-50 text-violet-600" },
  ];

  return (
    <div className="space-y-4 p-4 pb-24">
      <h1 className="text-xl font-bold text-slate-900">Registrar</h1>
      <p className="text-sm text-slate-500">Sube una factura o registra un gasto directo desde aquí.</p>
      {pendingCount > 0 && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">
          {pendingCount} registro{pendingCount === 1 ? "" : "s"} pendiente{pendingCount === 1 ? "" : "s"} de confirmar.
        </p>
      )}
      <div className="space-y-2">
        {options.map((o) => {
          const Icon = o.icon;
          return (
            <button
              key={o.module}
              onClick={() => onOpenForm(o.module)}
              className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm"
            >
              <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${o.tone}`}>
                <Icon size={18} />
              </span>
              <span className="text-sm font-bold text-slate-800">Agregar {o.label}</span>
              <ChevronRight size={16} className="ml-auto text-slate-300" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MobileAppShell({
  vehicles,
  maintenanceRecords,
  complianceRecords,
  fuelRecords,
  travelExpenses,
  userName,
  userEmail,
  userAvatar,
  companyName,
  isSuperAdmin,
  isCompanyAdmin,
  onSignOut,
  onOpenRecordForm,
}) {
  const [tab, setTab] = useState("home");

  return (
    <div className="min-h-screen bg-[#f8fafc]">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-xs font-extrabold text-white">N</div>
          <span className="text-sm font-extrabold tracking-tight text-blue-700">NAVIO</span>
        </div>
        <img src={userAvatar} alt={userName} className="h-8 w-8 rounded-full bg-blue-50 ring-2 ring-blue-100" />
      </header>

      <main>
        {tab === "home" && (
          <MobileHomeTab vehicles={vehicles} userName={userName} companyName={companyName} onOpenTrip={() => setTab("trip")} />
        )}
        {tab === "trip" && <MobileTripTab vehicles={vehicles} />}
        {tab === "register" && (
          <MobileRegisterTab
            onOpenForm={onOpenRecordForm}
            maintenanceRecords={maintenanceRecords}
            complianceRecords={complianceRecords}
            fuelRecords={fuelRecords}
            travelExpenses={travelExpenses}
          />
        )}
        {tab === "account" && (
          <div className="p-4 pb-24">
            <AccountPage
              userName={userName}
              userEmail={userEmail}
              userAvatar={userAvatar}
              onSignOut={onSignOut}
              companyName={companyName}
              isSuperAdmin={isSuperAdmin}
              isCompanyAdmin={isCompanyAdmin}
            />
          </div>
        )}
      </main>

      <MobileBottomNav tab={tab} onChange={setTab} />
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Root component                                                        */
/* ---------------------------------------------------------------------- */

function NavioApp() {
  const { user, signOut, profile } = useAuth();
  const currentUserName = user?.user_metadata?.full_name?.trim() || user?.email?.split("@")[0] || "Usuario";
  const currentUserEmail = user?.email ?? "";
  const currentUserAvatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(user?.id ?? currentUserName)}`;
  const isMobileViewport = useIsMobileViewport();

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState("home");
  const [selectedVehicleId, setSelectedVehicleId] = useState(null);
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
  } = useSupabaseTable("fuel_records", { companyId });
  const {
    rows: travelExpenses,
    loading: travelLoading,
    insertRow: insertTravelExpense,
    updateRow: updateTravelExpense,
    removeRow: removeTravelExpense,
  } = useSupabaseTable("travel_expenses", { companyId });
  const {
    rows: trips,
    loading: tripsLoading,
    insertRow: insertTrip,
    updateRow: updateTrip,
  } = useSupabaseTable("trips", { companyId });
  const {
    rows: incidents,
    loading: incidentsLoading,
    insertRow: insertIncident,
    updateRow: updateIncident,
  } = useSupabaseTable("incidents", { companyId });
  const {
    rows: communityPosts,
    loading: communityLoading,
    insertRow: insertCommunityPost,
    updateRow: updateCommunityPost,
    refresh: refreshCommunityPosts,
  } = useSupabaseTable("community_posts");

  const dataLoading =
    vehiclesLoading ||
    maintenanceLoading ||
    complianceLoading ||
    fuelLoading ||
    travelLoading ||
    tripsLoading ||
    incidentsLoading ||
    communityLoading;

  const [maintenanceView, setMaintenanceView] = useState("servicios");
  const [complianceDocFilter, setComplianceDocFilter] = useState("all");

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
  };

  const [deleteRecordTarget, setDeleteRecordTarget] = useState(null);

  async function handleSaveRecord(module, record) {
    const { insertRow, updateRow } = recordTables[module];
    try {
      if (record.id) {
        const { id, ...patch } = record;
        await updateRow(id, { ...patch, status: "verified" });
      } else {
        await insertRow({ ...record, origin: "manual", status: "verified" });
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
            photo: "https://api.dicebear.com/7.x/avataaars/svg?seed=SinAsignar",
            license: "",
            licenseExpiry: "",
          },
        });
      }
      setAddVehicleModalOpen(false);
      showToast(`${inserted.unit} agregada a la flota.`);
    } catch (err) {
      showToast(`Error al agregar unidad: ${err.message}`);
    }
  }

  async function handleEditVehicle(patch) {
    const { id, ...rest } = patch;
    try {
      await updateVehicleRow(id, rest);
      setEditVehicleTarget(null);
      showToast("Unidad actualizada.");
    } catch (err) {
      showToast(`Error al editar unidad: ${err.message}`);
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

  if (isMobileViewport) {
    return (
      <DateFormatContext.Provider value={{ format: dateFormat, setFormat: setDateFormat }}>
        <ToastContext.Provider value={{ showToast }}>
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
              maintenanceRecords={maintenanceRecords}
              complianceRecords={complianceRecords}
              fuelRecords={fuelRecords}
              travelExpenses={travelExpenses}
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
              initial={formModal.initial}
              vehicles={vehicles}
              onSave={handleSaveRecord}
              onClose={() => setFormModal(null)}
            />
          )}
          <ToastHost toast={toast} onDismiss={() => setToast(null)} />
        </ToastContext.Provider>
      </DateFormatContext.Provider>
    );
  }

  return (
    <DateFormatContext.Provider value={{ format: dateFormat, setFormat: setDateFormat }}>
      <ToastContext.Provider value={{ showToast }}>
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
          />

          <div className="flex min-h-screen flex-1 flex-col">
            <div data-keep-open>
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
                      fuelRecords={fuelRecords}
                      trips={trips}
                      onSelectVehicle={jumpToVehicle}
                      onNavigate={goToTab}
                      userName={currentUserName}
                    />
                  )}
                  {activeTab === "map" && <LiveMapPage vehicles={vehicles} onSelectVehicle={jumpToVehicle} />}
                  {activeTab === "fleet" && (
                    <FleetTabContainer
                      vehicles={vehicles}
                      selectedVehicleId={selectedVehicleId}
                      setSelectedVehicleId={setSelectedVehicleId}
                      onAddVehicleClick={() => setAddVehicleModalOpen(true)}
                      isCompanyAdmin={isCompanyAdmin}
                      onEditVehicle={setEditVehicleTarget}
                      onDeleteVehicle={setDeleteVehicleTarget}
                    />
                  )}
                  {activeTab === "transfers" && (
                    <TransfersPage vehicles={vehicles} trips={trips} insertTrip={insertTrip} updateTrip={updateTrip} />
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
                      records={fuelRecords}
                      travelRecords={travelExpenses}
                      onAddClick={() => setFormModal({ mode: "add", module: "fuel", initial: null })}
                      onConfirm={(r) => handleConfirmRecord("fuel", r)}
                      onEditClick={(r) => setFormModal({ mode: "edit", module: "fuel", initial: r })}
                      onDeleteClick={(r) => setDeleteRecordTarget({ module: "fuel", record: r })}
                      onAddTravelClick={() => setFormModal({ mode: "add", module: "travel", initial: null })}
                      onConfirmTravel={(r) => handleConfirmRecord("travel", r)}
                      onEditTravelClick={(r) => setFormModal({ mode: "edit", module: "travel", initial: r })}
                      onDeleteTravelClick={(r) => setDeleteRecordTarget({ module: "travel", record: r })}
                    />
                  )}
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
            <div data-keep-open className="fixed right-6 top-16 z-40 w-80 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
              <p className="mb-2 px-1 text-xs font-semibold text-slate-400">Notificaciones</p>
              <div className="space-y-1">
                {[
                  { title: "Licencia por vencer", body: "L. Gómez (Unidad 07) vence en 13 días", time: "hace 10 min" },
                  { title: "Llanta bajo mínimo", body: "Unidad 07 — eje trasero 4.1 mm", time: "hace 1 h" },
                  { title: "Póliza por vencer", body: "Unidad 07 — GNP Seguros, vence 30/08/2026", time: "hace 2 h" },
                ].map((n) => (
                  <div key={n.title} className="rounded-xl px-2.5 py-2 hover:bg-slate-50">
                    <p className="text-xs font-semibold text-slate-700">{n.title}</p>
                    <p className="text-[11px] text-slate-400">{n.body}</p>
                    <p className="mt-0.5 text-[10px] text-slate-300">{n.time}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {formModal && (
            <RecordFormModal
              mode={formModal.mode}
              module={formModal.module}
              initial={formModal.initial}
              vehicles={vehicles}
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
              message={`¿Eliminar "${deleteRecordTarget.record.concept || deleteRecordTarget.record.unit}" (${deleteRecordTarget.record.unit})? Esta acción no se puede deshacer.`}
              confirmLabel="Eliminar"
              danger
              onConfirm={handleDeleteRecord}
              onClose={() => setDeleteRecordTarget(null)}
            />
          )}

          <ToastHost toast={toast} onDismiss={() => setToast(null)} />
        </div>
      </ToastContext.Provider>
    </DateFormatContext.Provider>
  );
}

/* ---------------------------------------------------------------------- */
/*  Auth gate — decide qué pantalla mostrar                               */
/* ---------------------------------------------------------------------- */

function AuthGate() {
  const { user, loading, passwordRecovery, mfaRequired, mfaVerifying, profile, profileLoading } = useAuth();

  if (!isSupabaseConfigured) return <SupabaseSetupNotice />;
  if (loading) return <FullScreenLoader />;
  if (passwordRecovery) return <UpdatePasswordPage />;
  if (!user || mfaVerifying) return <LoginPage />;
  if (mfaRequired) return <MfaChallengePage />;
  if (profileLoading) return <FullScreenLoader />;
  if (!profile?.companyId) return <OnboardingPage />;
  return <NavioApp />;
}

export default function NavioDashboard() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}
