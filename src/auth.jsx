import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Eye, EyeOff, FileCheck2, MapPin, RefreshCw, ShieldCheck } from "lucide-react";
import { supabase, useAuth } from "./NavioDashboard.jsx";
import { CookieNotice, LEGAL_VERSION, LegalLinks, LegalModal } from "./legal.jsx";

/* ---------------------------------------------------------------------- */
/*  Pantallas de entrada: iniciar sesión, crear cuenta, unirse a empresa  */
/* ---------------------------------------------------------------------- */

export const MIN_PASSWORD = 10;

// La animación de entrada ("NAVIO" → "N") vive en index.html para verse desde
// el primer instante. Aquí solo se retira cuando la app ya tiene qué mostrar,
// dejando que la animación termine.
const SPLASH_MS = 1050;
export function hideSplash() {
  const splash = document.getElementById("splash");
  if (!splash || splash.classList.contains("splash-done")) return;
  const wait = Math.max(0, SPLASH_MS - performance.now());
  window.setTimeout(() => splash.classList.add("splash-done"), wait);
}

export function translateAuthError(error) {
  const msg = error?.message || "";
  const low = msg.toLowerCase();
  if (low.includes("invalid login credentials")) return "Correo o contraseña incorrectos.";
  if (low.includes("user already registered")) return "Ya existe una cuenta con ese correo.";
  if (low.includes("password should be at least") || low.includes("weak")) return "La contraseña es demasiado corta o fácil de adivinar.";
  if (low.includes("different from the old")) return "La nueva contraseña debe ser distinta de la anterior.";
  if (low.includes("email not confirmed")) return "Confirma tu correo antes de iniciar sesión (revisa tu bandeja de entrada).";
  if (low.includes("rate limit") || low.includes("security purposes")) return "Demasiados intentos. Espera un momento y vuelve a intentar.";
  if (low.includes("totp") || low.includes("mfa")) return "El código no es correcto o ya caducó.";
  if (low.includes("failed to fetch") || low.includes("network")) return "No hay conexión con el servidor. Revisa tu internet.";
  return msg || "Ocurrió un error inesperado. Intenta de nuevo.";
}

export function AuthErrorMessage({ message }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex items-start gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
      <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {message}
    </p>
  );
}

export function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f8fafc]">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-400">
        <RefreshCw size={16} className="animate-spin" /> Cargando…
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Ilustración: una ruta en el mapa, una factura leída y el panel web    */
/* ---------------------------------------------------------------------- */

const ROUTE_PATH = "M120 430 C 230 430 240 300 360 300 S 520 400 620 290 S 720 150 840 150";
const BARS = [46, 70, 38, 84, 58, 96, 66];

function Scene() {
  const still = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  return (
    <svg viewBox="0 0 960 560" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {/* Mapa */}
      <rect x="40" y="40" width="880" height="480" rx="28" fill="#fff" fillOpacity="0.06" stroke="#fff" strokeOpacity="0.14" />
      <g stroke="#fff" strokeOpacity="0.07" strokeWidth="14" strokeLinecap="round" fill="none">
        <path d="M60 190 H900" />
        <path d="M60 372 H900" />
        <path d="M250 60 V500" />
        <path d="M520 60 V500" />
        <path d="M748 60 V500" />
        <path d="M70 492 L410 60" />
      </g>

      {/* Ruta */}
      <path d={ROUTE_PATH} fill="none" stroke="#fff" strokeOpacity="0.28" strokeWidth="5" strokeLinecap="round" strokeDasharray="2 13" />
      <path id="navio-login-route" className="navio-route" d={ROUTE_PATH} fill="none" stroke="#7dd3fc" strokeWidth="5" strokeLinecap="round" />
      <circle className="navio-pulse" cx="120" cy="430" r="11" fill="#fff" fillOpacity="0.5" />
      <circle cx="120" cy="430" r="9" fill="#fff" />
      <circle cx="120" cy="430" r="4" fill="#2563eb" />
      <circle cx="360" cy="300" r="6" fill="#1e40af" stroke="#fff" strokeWidth="3" />
      <circle cx="620" cy="290" r="6" fill="#1e40af" stroke="#fff" strokeWidth="3" />
      <circle className="navio-pulse" cx="840" cy="150" r="11" fill="#34d399" fillOpacity="0.6" />
      <g transform="translate(840 150)">
        <path d="M0 0 C -14 -18 -22 -28 -22 -40 A 22 22 0 1 1 22 -40 C 22 -28 14 -18 0 0 Z" fill="#34d399" />
        <circle cx="0" cy="-40" r="8" fill="#fff" />
      </g>

      {/* Unidad en camino */}
      <g transform={still ? "translate(620 290) rotate(-48)" : undefined}>
        {!still && (
          <animateMotion dur="10s" repeatCount="indefinite" rotate="auto" calcMode="linear">
            <mpath href="#navio-login-route" />
          </animateMotion>
        )}
        <rect x="-28" y="-11" width="32" height="22" rx="4" fill="#fff" />
        <rect x="6" y="-10" width="15" height="20" rx="5" fill="#fbbf24" />
        <rect x="14" y="-7" width="4" height="14" rx="2" fill="#1e3a8a" fillOpacity="0.55" />
      </g>

      {/* Llegada estimada */}
      <g transform="translate(676 52)">
        <g className="navio-rise" style={{ animationDelay: "1.5s" }}>
          <rect width="138" height="30" rx="15" fill="#0f172a" fillOpacity="0.55" />
          <circle cx="16" cy="15" r="4" fill="#34d399" />
          <text x="28" y="19.5" fontSize="12" fontWeight="600" fill="#fff">
            Llegada 14:32
          </text>
        </g>
      </g>

      {/* En ruta */}
      <g transform="translate(396 196)">
        <g className="navio-rise" style={{ animationDelay: "1s" }}>
          <g className="navio-float-slow">
            <rect width="168" height="36" rx="18" fill="#fff" />
            <circle cx="20" cy="18" r="5" fill="#22c55e" />
            <text x="34" y="22.5" fontSize="13" fontWeight="700" fill="#0f172a">
              En ruta · 62 km/h
            </text>
          </g>
        </g>
      </g>

      {/* Factura */}
      <g transform="translate(76 70)">
        <g className="navio-rise" style={{ animationDelay: "0.5s" }}>
          <g className="navio-float">
            <rect x="4" y="8" width="214" height="158" rx="18" fill="#0f172a" fillOpacity="0.18" />
            <rect width="214" height="158" rx="18" fill="#fff" />
            <rect x="16" y="16" width="34" height="34" rx="10" fill="#2563eb" />
            <path d="M27 27 h12 M27 33 h12 M27 39 h7" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
            <text x="60" y="31" fontSize="13" fontWeight="700" fill="#0f172a">
              Factura A-1042
            </text>
            <text x="60" y="46" fontSize="10.5" fill="#64748b">
              Combustible · Tren Maya
            </text>
            <rect x="16" y="66" width="182" height="7" rx="3.5" fill="#e2e8f0" />
            <rect x="16" y="81" width="140" height="7" rx="3.5" fill="#e2e8f0" />
            <rect x="16" y="96" width="162" height="7" rx="3.5" fill="#e2e8f0" />
            <rect x="16" y="120" width="96" height="24" rx="12" fill="#d1fae5" />
            <path d="M27 132 l4 4 l7 -8" fill="none" stroke="#047857" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            <text x="45" y="136" fontSize="11" fontWeight="700" fill="#047857">
              Verificada
            </text>
            <text x="198" y="137" fontSize="14" fontWeight="800" fill="#0f172a" textAnchor="end">
              $4,860
            </text>
          </g>
        </g>
      </g>

      {/* Panel web */}
      <g transform="translate(594 318)">
        <g className="navio-rise" style={{ animationDelay: "0.8s" }}>
          <g className="navio-float-slow">
            <rect x="4" y="8" width="290" height="186" rx="18" fill="#0f172a" fillOpacity="0.18" />
            <rect width="290" height="186" rx="18" fill="#fff" />
            <circle cx="20" cy="19" r="4" fill="#f87171" />
            <circle cx="34" cy="19" r="4" fill="#fbbf24" />
            <circle cx="48" cy="19" r="4" fill="#34d399" />
            <rect x="66" y="11" width="150" height="16" rx="8" fill="#f1f5f9" />
            <text x="18" y="56" fontSize="10.5" fill="#64748b">
              Gasto del mes
            </text>
            <text x="18" y="78" fontSize="19" fontWeight="800" fill="#0f172a">
              $128,400
            </text>
            <rect x="214" y="48" width="58" height="22" rx="11" fill="#dbeafe" />
            <text x="243" y="63" fontSize="10.5" fontWeight="700" fill="#1d4ed8" textAnchor="middle">
              7 unidades
            </text>
            {BARS.map((height, index) => (
              <rect
                key={index}
                className="navio-bar"
                style={{ animationDelay: `${1.1 + index * 0.08}s` }}
                x={18 + index * 37}
                y={172 - height * 0.8}
                width="24"
                height={height * 0.8}
                rx="5"
                fill={index === 5 ? "#2563eb" : "#93c5fd"}
              />
            ))}
          </g>
        </g>
      </g>
    </svg>
  );
}

const HIGHLIGHTS = [
  { icon: MapPin, title: "Seguimiento en tiempo real", text: "Cada unidad en el mapa y cada viaje registrado." },
  { icon: FileCheck2, title: "Facturas sin captura manual", text: "Navio las lee y tu equipo solo las revisa." },
  { icon: ShieldCheck, title: "Información separada por empresa", text: "Cada quien ve únicamente lo de su empresa." },
];

function LoginShowcase() {
  return (
    <div className="flex h-full min-h-screen flex-col px-10 py-9 xl:px-14">
      <div className="navio-rise flex items-center gap-2.5">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-base font-extrabold text-blue-700">N</div>
        <span className="text-xl font-extrabold tracking-tight text-white">NAVIO</span>
      </div>
      <div className="navio-rise mt-8 max-w-2xl" style={{ animationDelay: "0.15s" }}>
        <h2 className="text-3xl font-extrabold leading-tight text-white xl:text-4xl">Tu flotilla, tus viajes y tus facturas en un solo lugar.</h2>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-blue-100">
          Sigue cada unidad en el mapa, lleva el registro de los traslados y deja que Navio lea las facturas para que tu equipo solo las revise.
        </p>
      </div>
      <div className="relative my-4 min-h-[260px] flex-1">
        <Scene />
      </div>
      <ul className="grid grid-cols-3 gap-5">
        {HIGHLIGHTS.map(({ icon: Icon, title, text }, index) => (
          <li key={title} className="navio-rise flex gap-2.5" style={{ animationDelay: `${0.9 + index * 0.12}s` }}>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-white">
              <Icon size={16} />
            </span>
            <span>
              <span className="block text-xs font-bold text-white">{title}</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-blue-200">{text}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Tres cuartas partes para la imagen y la cuarta de la derecha para los
// formularios. En pantallas angostas solo quedan los formularios.
export function AuthLayout({ children }) {
  useEffect(hideSplash, []);
  return (
    <div className="flex min-h-screen bg-white">
      <aside className="relative hidden min-w-0 flex-1 overflow-hidden bg-gradient-to-br from-blue-600 via-blue-800 to-slate-900 lg:block">
        <LoginShowcase />
      </aside>
      <main className="flex min-h-screen w-full flex-col lg:w-1/4 lg:min-w-[380px] lg:shrink-0 lg:border-l lg:border-slate-200">
        <div className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center px-6 py-8 lg:px-7">
          <div className="mb-7 flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-sm font-extrabold text-white shadow-lg shadow-blue-600/30">N</div>
            <span className="text-lg font-extrabold tracking-tight text-slate-900 lg:hidden">NAVIO</span>
          </div>
          {children}
        </div>
        <footer className="mx-auto w-full max-w-[420px] px-6 pb-5 lg:px-7">
          <CookieNotice inline />
          <LegalLinks />
        </footer>
      </main>
    </div>
  );
}

export function SupabaseSetupNotice() {
  return (
    <AuthLayout>
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
        <div className="flex items-center gap-2 text-amber-700">
          <AlertTriangle size={18} />
          <h1 className="text-sm font-bold">Falta conectar la base de datos</h1>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-amber-700">La aplicación no tiene los datos de conexión de Supabase. Avisa a quien administra Navio.</p>
      </div>
    </AuthLayout>
  );
}

const inputClass = "w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
const labelClass = "mb-1.5 block text-xs font-semibold text-slate-600";
const submitClass = "w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60";
const linkClass = "font-semibold text-blue-600 hover:text-blue-700";

function PasswordInput({ value, onChange, autoComplete, minLength, id }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input id={id} type={visible ? "text" : "password"} required minLength={minLength} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} className={`${inputClass} pr-10`} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
        className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:text-slate-600"
      >
        {visible ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}

const MODES = { SIGN_IN: "signin", SIGN_UP: "signup", FORGOT: "forgot" };
const MODE_TEXT = {
  signin: { title: "Iniciar sesión", hint: "Entra a tu panel de Navio.", submit: "Entrar" },
  signup: { title: "Crear cuenta", hint: "Después podrás unirte a tu empresa con un código o registrar una nueva.", submit: "Crear cuenta" },
  forgot: { title: "Recuperar contraseña", hint: "Te enviaremos un enlace a tu correo.", submit: "Enviar enlace" },
};

export function LoginPage() {
  const { signIn, signUp, resetPassword } = useAuth();
  const [mode, setMode] = useState(MODES.SIGN_IN);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [legalDoc, setLegalDoc] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function switchMode(next) {
    setError("");
    setNotice("");
    setMode(next);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setNotice("");
    if (mode === MODES.SIGN_UP) {
      if (fullName.trim().length < 2) return setError("Escribe tu nombre completo.");
      if (password.length < MIN_PASSWORD) return setError(`Usa una contraseña de al menos ${MIN_PASSWORD} caracteres.`);
      if (!accepted) return setError("Para crear tu cuenta necesitas aceptar los términos y el aviso de privacidad.");
    }
    setLoading(true);
    try {
      if (mode === MODES.SIGN_IN) await signIn(email.trim(), password);
      else if (mode === MODES.SIGN_UP) {
        await signUp(email.trim(), password, fullName.trim(), LEGAL_VERSION);
        setPassword("");
        setNotice("Listo. Te enviamos un correo para confirmar tu cuenta; ábrelo y después inicia sesión.");
        setMode(MODES.SIGN_IN);
      } else {
        await resetPassword(email.trim());
        // El mismo mensaje exista o no la cuenta: no se revela quién está registrado.
        setNotice("Si ese correo tiene una cuenta, recibirá un enlace para elegir una contraseña nueva.");
      }
    } catch (err) {
      setError(translateAuthError(err));
    } finally {
      setLoading(false);
    }
    return undefined;
  }

  const text = MODE_TEXT[mode];
  return (
    <AuthLayout>
      <h1 className="text-xl font-bold text-slate-900">{text.title}</h1>
      <p className="mt-1.5 text-xs text-slate-500">{text.hint}</p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        {mode === MODES.SIGN_UP && (
          <div>
            <label htmlFor="auth-name" className={labelClass}>
              Nombre completo
            </label>
            <input id="auth-name" value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={120} autoComplete="name" className={inputClass} />
          </div>
        )}
        <div>
          <label htmlFor="auth-email" className={labelClass}>
            Correo electrónico
          </label>
          <input id="auth-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="usuario@empresa.com" autoComplete="username" className={inputClass} />
        </div>
        {mode !== MODES.FORGOT && (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label htmlFor="auth-password" className="block text-xs font-semibold text-slate-600">
                Contraseña
              </label>
              {mode === MODES.SIGN_IN && (
                <button type="button" onClick={() => switchMode(MODES.FORGOT)} className={`text-[11px] ${linkClass}`}>
                  ¿La olvidaste?
                </button>
              )}
            </div>
            <PasswordInput id="auth-password" value={password} onChange={setPassword} autoComplete={mode === MODES.SIGN_UP ? "new-password" : "current-password"} minLength={mode === MODES.SIGN_UP ? MIN_PASSWORD : undefined} />
            {mode === MODES.SIGN_UP && <p className="mt-1 text-[11px] text-slate-400">Al menos {MIN_PASSWORD} caracteres. Una frase larga funciona muy bien.</p>}
          </div>
        )}
        {mode === MODES.SIGN_UP && (
          <label className="flex cursor-pointer items-start gap-2 text-xs leading-relaxed text-slate-600">
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600" />
            <span>
              Leí y acepto los{" "}
              <button type="button" onClick={() => setLegalDoc("terms")} className={linkClass}>
                Términos y condiciones
              </button>{" "}
              y el{" "}
              <button type="button" onClick={() => setLegalDoc("privacy")} className={linkClass}>
                Aviso de privacidad
              </button>
              .
            </span>
          </label>
        )}

        <AuthErrorMessage message={error} />
        {notice && (
          <p role="status" className="flex items-start gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
            <CheckCircle2 size={13} className="mt-0.5 shrink-0" /> {notice}
          </p>
        )}

        <button type="submit" disabled={loading} className={submitClass}>
          {loading ? "Un momento…" : text.submit}
        </button>
      </form>

      <p className="mt-5 text-center text-xs text-slate-500">
        {mode === MODES.SIGN_IN ? (
          <>
            ¿Aún no tienes cuenta?{" "}
            <button onClick={() => switchMode(MODES.SIGN_UP)} className={linkClass}>
              Crear cuenta
            </button>
          </>
        ) : (
          <button onClick={() => switchMode(MODES.SIGN_IN)} className={linkClass}>
            ← Volver a iniciar sesión
          </button>
        )}
      </p>
      {legalDoc && <LegalModal doc={legalDoc} onClose={() => setLegalDoc(null)} />}
    </AuthLayout>
  );
}

export function UpdatePasswordPage() {
  const { updatePassword } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (password.length < MIN_PASSWORD) return setError(`Usa al menos ${MIN_PASSWORD} caracteres.`);
    if (password !== confirm) return setError("Las dos contraseñas no coinciden.");
    setLoading(true);
    try {
      await updatePassword(password);
    } catch (err) {
      setError(translateAuthError(err));
    } finally {
      setLoading(false);
    }
    return undefined;
  }

  return (
    <AuthLayout>
      <h1 className="text-xl font-bold text-slate-900">Elige una contraseña nueva</h1>
      <p className="mt-1.5 text-xs text-slate-500">Tu enlace es válido. Escribe la contraseña que usarás de ahora en adelante.</p>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="new-password" className={labelClass}>
            Contraseña nueva
          </label>
          <PasswordInput id="new-password" value={password} onChange={setPassword} autoComplete="new-password" minLength={MIN_PASSWORD} />
        </div>
        <div>
          <label htmlFor="repeat-password" className={labelClass}>
            Repítela
          </label>
          <PasswordInput id="repeat-password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        </div>
        <AuthErrorMessage message={error} />
        <button type="submit" disabled={loading} className={submitClass}>
          {loading ? "Guardando…" : "Guardar contraseña"}
        </button>
      </form>
    </AuthLayout>
  );
}

export function MfaChallengePage() {
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
        if (!cancelled) setFactorId(data?.totp?.find((f) => f.status === "verified")?.id ?? null);
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
    if (!factorId) return setError("No se encontró tu método de verificación en dos pasos.");
    setLoading(true);
    try {
      await verifyFactor(factorId, code.trim());
    } catch (err) {
      setCode("");
      setError(translateAuthError(err));
    } finally {
      setLoading(false);
    }
    return undefined;
  }

  return (
    <AuthLayout>
      <h1 className="text-xl font-bold text-slate-900">Verificación en dos pasos</h1>
      <p className="mt-1.5 text-xs text-slate-500">Escribe el código de 6 dígitos que muestra tu app de autenticación.</p>
      {loadingFactors ? (
        <p className="mt-6 text-xs text-slate-400">Cargando…</p>
      ) : (
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            aria-label="Código de 6 dígitos"
            placeholder="123456"
            className={`${inputClass} text-center text-lg tracking-[0.5em]`}
          />
          <AuthErrorMessage message={error} />
          <button type="submit" disabled={loading || code.length < 6} className={submitClass}>
            {loading ? "Verificando…" : "Verificar"}
          </button>
        </form>
      )}
      <button onClick={() => signOut()} className="mt-5 w-full text-center text-[11px] font-semibold text-slate-400 hover:text-slate-600">
        Cancelar y cerrar sesión
      </button>
    </AuthLayout>
  );
}

/* ---------------------------------------------------------------------- */
/*  Primer acceso: unirse a una empresa o solicitar el alta de una nueva  */
/* ---------------------------------------------------------------------- */

const COMPANY_INDUSTRIES = ["Transporte de carga", "Transporte de pasajeros", "Logística y distribución", "Construcción", "Otro"];
const FLEET_SIZE_RANGES = ["1-5 unidades", "6-20 unidades", "21-50 unidades", "Más de 50 unidades"];

export function OnboardingPage() {
  const { user, joinCompanyWithCode, requestCompany, signOut } = useAuth();
  const [tab, setTab] = useState("join");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [myRequest, setMyRequest] = useState(undefined); // undefined = cargando, null = sin solicitud
  const [code, setCode] = useState("");
  const [form, setForm] = useState({ name: "", industry: COMPANY_INDUSTRIES[0], fleetSize: FLEET_SIZE_RANGES[0], contactName: "", contactEmail: user?.email ?? "", contactPhone: "", needs: "" });
  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const loadMyRequest = useCallback(() => {
    if (!supabase || !user) return;
    supabase
      .from("companies")
      .select("id, name, status")
      .eq("requestedBy", user.id)
      .order("createdAt", { ascending: false })
      .limit(1)
      .then(({ data }) => setMyRequest(data?.[0] ?? null));
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
    } catch (err) {
      setError(err.message || "El código no es válido.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRequest(e) {
    e.preventDefault();
    setError("");
    if (!form.name.trim() || !form.contactName.trim() || !form.contactEmail.trim()) {
      setError("Escribe al menos el nombre de la empresa y los datos de contacto.");
      return;
    }
    setLoading(true);
    try {
      await requestCompany(Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value.trim()])));
      loadMyRequest();
    } catch (err) {
      setError(err.message || "No se pudo enviar la solicitud.");
    } finally {
      setLoading(false);
    }
  }

  if (myRequest === undefined) return <FullScreenLoader />;

  if (myRequest && myRequest.status !== "rejected") {
    return (
      <AuthLayout>
        <Clock size={26} className="mb-3 text-amber-500" />
        <h1 className="text-xl font-bold text-slate-900">Solicitud en revisión</h1>
        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          Tu solicitud para registrar <span className="font-semibold text-slate-700">{myRequest.name}</span> está pendiente de aprobación. En cuanto quede lista podrás entrar con esta misma cuenta.
        </p>
        <button onClick={() => signOut()} className={`mt-5 text-left text-xs ${linkClass}`}>
          Cerrar sesión
        </button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1 className="text-xl font-bold text-slate-900">Falta un paso</h1>
      <p className="mt-1.5 text-xs text-slate-500">Tu cuenta todavía no pertenece a ninguna empresa.</p>

      {myRequest?.status === "rejected" && (
        <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-[11px] font-medium text-rose-700">Tu solicitud anterior para "{myRequest.name}" no fue aprobada. Puedes enviar otra o unirte con un código.</p>
      )}

      <div className="mt-5 flex gap-1.5 rounded-lg bg-slate-100 p-1" role="tablist">
        {[
          { id: "join", label: "Tengo un código" },
          { id: "request", label: "Registrar mi empresa" },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => {
              setError("");
              setTab(t.id);
            }}
            className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold transition ${tab === t.id ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "join" ? (
        <form onSubmit={handleJoin} className="mt-5 space-y-4">
          <div>
            <label htmlFor="join-code" className={labelClass}>
              Código de invitación
            </label>
            <input id="join-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={40} autoComplete="off" autoCapitalize="characters" className={`${inputClass} font-mono tracking-wider`} />
            <p className="mt-1 text-[11px] text-slate-400">Te lo da el administrador de tu empresa.</p>
          </div>
          <AuthErrorMessage message={error} />
          <button type="submit" disabled={loading || !code.trim()} className={submitClass}>
            {loading ? "Verificando…" : "Unirme"}
          </button>
        </form>
      ) : (
        <form onSubmit={handleRequest} className="mt-5 space-y-3">
          <div>
            <label className={labelClass}>Nombre de la empresa</label>
            <input value={form.name} onChange={set("name")} maxLength={120} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Giro</label>
            <select value={form.industry} onChange={set("industry")} className={inputClass}>
              {COMPANY_INDUSTRIES.map((i) => (
                <option key={i}>{i}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Tamaño de la flotilla</label>
            <select value={form.fleetSize} onChange={set("fleetSize")} className={inputClass}>
              {FLEET_SIZE_RANGES.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Persona de contacto</label>
            <input value={form.contactName} onChange={set("contactName")} maxLength={120} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Correo de contacto</label>
            <input type="email" value={form.contactEmail} onChange={set("contactEmail")} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Teléfono (opcional)</label>
            <input value={form.contactPhone} onChange={set("contactPhone")} inputMode="tel" maxLength={30} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>¿Qué quieres controlar con Navio? (opcional)</label>
            <textarea value={form.needs} onChange={set("needs")} rows={2} maxLength={1000} className={inputClass} />
          </div>
          <AuthErrorMessage message={error} />
          <button type="submit" disabled={loading} className={submitClass}>
            {loading ? "Enviando…" : "Enviar solicitud"}
          </button>
        </form>
      )}

      <button onClick={() => signOut()} className="mt-5 w-full text-center text-[11px] font-semibold text-slate-400 hover:text-slate-600">
        Cerrar sesión
      </button>
    </AuthLayout>
  );
}

// No se pudo leer el perfil (casi siempre, por falta de conexión).
export function ConnectionErrorPage({ onRetry }) {
  const { signOut } = useAuth();
  const [retrying, setRetrying] = useState(false);
  async function retry() {
    setRetrying(true);
    await onRetry();
    setRetrying(false);
  }
  return (
    <AuthLayout>
      <AlertTriangle size={26} className="mb-3 text-amber-500" />
      <h1 className="text-xl font-bold text-slate-900">No pudimos cargar tu cuenta</h1>
      <p className="mt-2 text-xs leading-relaxed text-slate-500">Revisa tu conexión a internet y vuelve a intentarlo. Tu información está a salvo.</p>
      <button onClick={retry} disabled={retrying} className={`${submitClass} mt-5`}>
        {retrying ? "Reintentando…" : "Reintentar"}
      </button>
      <button onClick={() => signOut()} className="mt-4 w-full text-center text-[11px] font-semibold text-slate-400 hover:text-slate-600">
        Cerrar sesión
      </button>
    </AuthLayout>
  );
}

// La empresa existe pero no está activa (por ejemplo, fue suspendida): la
// base de datos ya no entrega nada, así que se explica en lugar de mostrar
// una app vacía.
export function CompanyInactivePage() {
  const { signOut } = useAuth();
  return (
    <AuthLayout>
      <AlertTriangle size={26} className="mb-3 text-amber-500" />
      <h1 className="text-xl font-bold text-slate-900">Tu empresa no está activa</h1>
      <p className="mt-2 text-xs leading-relaxed text-slate-500">El acceso de tu empresa a Navio está en pausa, así que por ahora no se puede consultar su información. Nada se ha borrado. Pide a quien administra la cuenta de tu empresa que se ponga en contacto con Navio.</p>
      <button onClick={() => signOut()} className={`mt-5 text-left text-xs ${linkClass}`}>
        Cerrar sesión
      </button>
    </AuthLayout>
  );
}
