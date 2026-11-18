import { useCallback, useEffect, useState } from "react";
import { Bell, Camera, MapPin, Mic, ShieldCheck } from "lucide-react";
import { Modal } from "./NavioDashboard.jsx";
import { isNativeApp } from "./tracking.jsx";
import { Capacitor, registerPlugin } from "@capacitor/core";

// En la app de Android, el permiso de notificaciones lo da el plugin de
// Capacitor (el navegador interno no tiene "Notification").
let pushPlugin = null;
function nativePushPlugin() {
  if (!isNativeApp()) return null;
  try {
    if (!Capacitor.isPluginAvailable("PushNotifications")) return null;
    pushPlugin = pushPlugin ?? registerPlugin("PushNotifications");
    return pushPlugin;
  } catch {
    return null;
  }
}
const nativeState = (receive) => (receive === "granted" ? "granted" : receive === "denied" ? "denied" : "prompt");

/* ---------------------------------------------------------------------- */
/*  Permisos: micrófono, cámara, ubicación y notificaciones               */
/* ---------------------------------------------------------------------- */
//
// Antes de usar algo del teléfono, Navio explica para qué lo necesita y, al
// presionar "Permitir", el teléfono o el navegador muestran su ventana de
// "Permitir / No permitir". Si antes se negó, la ventana del sistema ya no
// vuelve a salir: entonces se explica cómo activarlo en los ajustes.

const INFO = {
  microphone: { icon: Mic, title: "Micrófono", why: "Para grabar notas de voz en Mensajes. Solo se usa mientras grabas." },
  camera: { icon: Camera, title: "Cámara", why: "Para tomar fotos y mandarlas en Mensajes. Solo se usa mientras la cámara está abierta." },
  geolocation: { icon: MapPin, title: "Ubicación", why: "Para saber desde dónde sales, planear la ruta y registrar el recorrido mientras dura el viaje." },
  notifications: { icon: Bell, title: "Notificaciones", why: "Para avisarte de mensajes y tareas nuevas aunque no tengas Navio abierto." },
};

// Algunos teléfonos (la app de Android, por ejemplo) no dicen si el permiso ya
// se dio. Se recuerda aquí que funcionó una vez; si después falla, se olvida.
const remembered = (name) => {
  try {
    return window.localStorage.getItem(`navio.perm.${name}`) === "granted";
  } catch {
    return false;
  }
};
const remember = (name, granted) => {
  try {
    if (granted) window.localStorage.setItem(`navio.perm.${name}`, "granted");
    else window.localStorage.removeItem(`navio.perm.${name}`);
  } catch {
    // Solo es comodidad.
  }
};
export const forgetPermission = (name) => remember(name, false);

function readNotificationState() {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission === "default" ? "prompt" : Notification.permission;
}

// Estado de un permiso: "granted" | "prompt" | "denied" | "unknown" | "unsupported".
export function usePermission(name) {
  const [state, setState] = useState(() => (name === "notifications" ? readNotificationState() : "unknown"));
  const refresh = useCallback(async () => {
    if (name === "notifications") {
      const plugin = nativePushPlugin();
      if (plugin) {
        try {
          setState(nativeState((await plugin.checkPermissions()).receive));
        } catch {
          setState("prompt");
        }
        return;
      }
      setState(readNotificationState());
      return;
    }
    const adjust = (value) => (value === "denied" ? "denied" : value === "granted" || remembered(name) ? "granted" : value);
    try {
      const status = await navigator.permissions.query({ name });
      setState(adjust(status.state));
      status.onchange = () => setState(adjust(status.state));
    } catch {
      setState(adjust("unknown")); // el navegador no dice; se sabrá al pedirlo
    }
  }, [name]);
  useEffect(() => {
    refresh();
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);
  return [state, refresh];
}

// Pide el permiso: hace aparecer la ventana del sistema. true si quedó dado.
export async function requestPermission(name) {
  return (await requestPermissionDetailed(name)).ok;
}

// Igual, pero dice por qué no: "denied" (se negó), "unavailable" (hay
// permiso pero el teléfono no dio la ubicación), "timeout" o "unsupported".
export async function requestPermissionDetailed(name) {
  const result = await askSystem(name);
  // Sin señal o tardanza no es una negativa: el permiso sigue dado.
  if (result.ok || result.reason === "denied") remember(name, result.ok);
  return result;
}

async function askSystem(name) {
  try {
    if (name === "microphone" || name === "camera") {
      if (!navigator.mediaDevices?.getUserMedia) return { ok: false, reason: "unsupported" };
      const stream = await navigator.mediaDevices.getUserMedia(name === "microphone" ? { audio: true } : { video: true });
      stream.getTracks().forEach((t) => t.stop());
      return { ok: true };
    }
    if (name === "geolocation") {
      if (!navigator.geolocation) return { ok: false, reason: "unsupported" };
      // Se llama directo desde el toque: Safari solo muestra su ventana así.
      await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 20000, maximumAge: 60000 }));
      return { ok: true };
    }
    if (name === "notifications") {
      const plugin = nativePushPlugin();
      if (plugin) {
        const perm = await plugin.requestPermissions();
        return perm.receive === "granted" ? { ok: true } : { ok: false, reason: "denied" };
      }
      if (typeof Notification === "undefined") return { ok: false, reason: "unsupported" };
      return (await Notification.requestPermission()) === "granted" ? { ok: true } : { ok: false, reason: "denied" };
    }
  } catch (err) {
    if (name === "geolocation" && err?.code === 2) return { ok: false, reason: "unavailable" };
    if (name === "geolocation" && err?.code === 3) return { ok: false, reason: "timeout" };
    return { ok: false, reason: "denied" };
  }
  return { ok: false, reason: "unsupported" };
}

/* ---------- Cómo activarlo en cada teléfono ---------- */

const ua = () => (typeof navigator === "undefined" ? "" : navigator.userAgent);
export const isIOSDevice = () => /iphone|ipad|ipod/i.test(ua()) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isIOSChrome = () => isIOSDevice() && /CriOS/i.test(ua());
const isIOSFirefox = () => isIOSDevice() && /FxiOS/i.test(ua());
const isAndroid = () => /android/i.test(ua());
const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;

const SITE_SETTING = { geolocation: "Ubicación", microphone: "Micrófono", camera: "Cámara", notifications: "Notificaciones" };

export function settingsSteps(name, reason = "denied") {
  const what = SITE_SETTING[name];
  if (isNativeApp()) {
    const steps = ["Abre los Ajustes del teléfono.", `Entra a Apps → Navio → Permisos → ${what} y elige "Permitir".`];
    if (name === "geolocation") steps.push("Revisa también que la Ubicación del teléfono esté encendida (en el panel de arriba de la pantalla).");
    steps.push("Vuelve a Navio y toca \"Intentar de nuevo\".");
    return steps;
  }
  if (isIOSDevice()) {
    if (name === "notifications") {
      return isStandalone()
        ? ["Abre Ajustes del iPhone → Notificaciones → Navio.", "Activa \"Permitir notificaciones\".", "Vuelve a Navio y toca \"Intentar de nuevo\"."]
        : ["En iPhone, los avisos solo funcionan con Navio en la pantalla de inicio.", "En Safari toca Compartir → \"Agregar a pantalla de inicio\".", "Abre Navio desde ese ícono y actívalas ahí."];
    }
    if (isIOSChrome() || isIOSFirefox()) {
      const app = isIOSChrome() ? "Chrome" : "Firefox";
      return name === "geolocation"
        ? [
            "Abre Ajustes del iPhone → Privacidad y seguridad → Localización y revisa que esté activada.",
            `En esa misma lista entra a ${app} y elige "Al usar la app" (activa "Ubicación exacta").`,
            `Vuelve a ${app}, recarga Navio y toca "Intentar de nuevo".`,
          ]
        : [`Abre Ajustes del iPhone → Apps → ${app} y activa ${what}.`, `Vuelve a ${app}, recarga Navio y toca "Intentar de nuevo".`];
    }
    if (name === "geolocation") {
      return [
        "Abre Ajustes del iPhone → Privacidad y seguridad → Localización y revisa que esté activada.",
        "En esa misma lista entra a \"Sitios web de Safari\" y elige \"Al usar la app\" (activa \"Ubicación exacta\").",
        "En Safari, toca el botón \"aA\" (o el de ajustes) junto a la dirección → \"Ajustes del sitio web\" → Ubicación → \"Permitir\".",
        "Vuelve a Navio y toca \"Intentar de nuevo\".",
      ];
    }
    return [
      `En Safari, toca el botón "aA" (o el de ajustes) junto a la dirección → "Ajustes del sitio web" → ${what} → "Permitir".`,
      `Si no aparece, abre Ajustes del iPhone → Apps → Safari → ${what} y elige "Preguntar" o "Permitir".`,
      "Vuelve a Navio y toca \"Intentar de nuevo\".",
    ];
  }
  if (isAndroid()) {
    const steps = [`Toca el ícono de ajustes (o el candado) junto a la dirección de la página → Permisos → ${what} → "Permitir".`];
    if (name === "geolocation") steps.push("Revisa que la Ubicación del teléfono esté encendida (en el panel de arriba de la pantalla).");
    steps.push("Vuelve a Navio y toca \"Intentar de nuevo\".");
    return steps;
  }
  return [`Haz clic en el candado (o el ícono de ajustes) junto a la dirección de la página → ${what} → "Permitir".`, "Si no cambia, recarga la página y toca \"Intentar de nuevo\"."];
}

const PROBLEM_TEXT = {
  denied: "El permiso está desactivado. Para activarlo:",
  unavailable: "Navio tiene permiso, pero el teléfono no dio tu ubicación. Revisa esto:",
  timeout: "El teléfono tardó demasiado en dar tu ubicación. Revisa esto y vuelve a intentar:",
  unsupported: "Este navegador no permite usarlo. Prueba con Safari o Chrome actualizados.",
};

// Ventana que explica para qué es el permiso y lo pide.
export function PermissionSheet({ name, onGranted, onClose, initialProblem = null }) {
  const info = INFO[name];
  const Icon = info.icon;
  const [state, refresh] = usePermission(name);
  const [asking, setAsking] = useState(false);
  const [problem, setProblem] = useState(initialProblem);
  const shown = problem ?? (state === "denied" ? "denied" : null);

  async function ask() {
    setAsking(true);
    const result = await requestPermissionDetailed(name);
    setAsking(false);
    await refresh();
    if (result.ok) onGranted?.();
    else setProblem(result.reason);
  }

  return (
    <Modal title={`Permiso de ${info.title.toLowerCase()}`} width="max-w-sm" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
            <Icon size={20} />
          </span>
          <p className="text-xs leading-relaxed text-slate-600">{info.why}</p>
        </div>
        {shown ? (
          <div className="space-y-2 rounded-xl bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-700">{PROBLEM_TEXT[shown] ?? PROBLEM_TEXT.denied}</p>
            {shown !== "unsupported" && (
              <ol className="list-decimal space-y-1 pl-4 text-[11px] leading-relaxed text-slate-600">
                {settingsSteps(name, shown).map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            )}
          </div>
        ) : (
          <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <ShieldCheck size={12} /> {isIOSDevice() && name === "geolocation" ? "Al tocar Permitir, el iPhone te preguntará si Navio puede usar tu ubicación." : "Puedes quitar el permiso cuando quieras desde los ajustes."}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">
            Ahora no
          </button>
          <button type="button" onClick={ask} disabled={asking} className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
            {asking ? "Esperando…" : shown ? "Intentar de nuevo" : "Permitir"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// Para un botón que necesita un permiso: si ya está, hace la acción; si no,
// primero muestra la ventana del permiso.
export function usePermissionGate(name) {
  const [state, refresh] = usePermission(name);
  const [pending, setPending] = useState(null); // { action, problem }
  const run = (action) => {
    if (state === "granted") action();
    else setPending({ action, problem: null });
  };
  // Cuando algo falló aunque parecía permitido: abre la ventana ya con la
  // explicación y, al lograrlo, repite la acción.
  const explain = (problem, action) => {
    if (problem === "denied") remember(name, false);
    refresh();
    setPending({ action, problem });
  };
  const sheet = pending ? (
    <PermissionSheet
      name={name}
      initialProblem={pending.problem}
      onClose={() => setPending(null)}
      onGranted={() => {
        const action = pending.action;
        setPending(null);
        refresh();
        action?.();
      }}
    />
  ) : null;
  return { state, run, explain, sheet, refresh };
}

// Traduce el error de ubicación del navegador al motivo que entiende la ventana.
export const geoProblem = (err) => (err?.code === 1 ? "denied" : err?.code === 3 ? "timeout" : "unavailable");
