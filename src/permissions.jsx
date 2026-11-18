import { useCallback, useEffect, useState } from "react";
import { Bell, Camera, MapPin, Mic, ShieldCheck } from "lucide-react";
import { Modal } from "./NavioDashboard.jsx";
import { isNativeApp } from "./tracking.jsx";

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
  const ok = await askSystem(name);
  remember(name, ok);
  return ok;
}

async function askSystem(name) {
  try {
    if (name === "microphone" || name === "camera") {
      const stream = await navigator.mediaDevices.getUserMedia(name === "microphone" ? { audio: true } : { video: true });
      stream.getTracks().forEach((t) => t.stop());
      return true;
    }
    if (name === "geolocation") {
      await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000 }));
      return true;
    }
    if (name === "notifications") {
      if (typeof Notification === "undefined") return false;
      return (await Notification.requestPermission()) === "granted";
    }
  } catch (err) {
    // Ubicación: "no se encontró señal" no es una negativa.
    if (name === "geolocation" && err?.code && err.code !== 1) return true;
    return false;
  }
  return false;
}

function settingsSteps(name) {
  if (isNativeApp()) return ["Abre los Ajustes del teléfono.", "Entra a Apps → Navio → Permisos.", `Activa "${INFO[name].title}" y vuelve a Navio.`];
  return [
    "Toca el candado (o el ícono de ajustes) junto a la dirección de la página, arriba.",
    `Busca "${INFO[name].title}" y elige "Permitir".`,
    "Vuelve a Navio; si no cambia, recarga la página.",
  ];
}

// Ventana que explica para qué es el permiso y lo pide.
export function PermissionSheet({ name, onGranted, onClose }) {
  const info = INFO[name];
  const Icon = info.icon;
  const [state, refresh] = usePermission(name);
  const [asking, setAsking] = useState(false);
  const [denied, setDenied] = useState(false);
  const blocked = denied || state === "denied";

  async function ask() {
    setAsking(true);
    const ok = await requestPermission(name);
    setAsking(false);
    await refresh();
    if (ok) onGranted?.();
    else setDenied(true);
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
        {blocked ? (
          <div className="space-y-2 rounded-xl bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-700">El permiso está desactivado. Para activarlo:</p>
            <ol className="list-decimal space-y-1 pl-4 text-[11px] text-slate-600">
              {settingsSteps(name).map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
        ) : (
          <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <ShieldCheck size={12} /> Puedes quitar el permiso cuando quieras desde los ajustes.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">
            Ahora no
          </button>
          <button type="button" onClick={ask} disabled={asking} className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
            {asking ? "Esperando…" : blocked ? "Intentar de nuevo" : "Permitir"}
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
  const [pending, setPending] = useState(null);
  const run = (action) => {
    if (state === "granted") action();
    else setPending(() => action);
  };
  const sheet = pending ? (
    <PermissionSheet
      name={name}
      onClose={() => setPending(null)}
      onGranted={() => {
        const action = pending;
        setPending(null);
        refresh();
        action?.();
      }}
    />
  ) : null;
  return { state, run, sheet, refresh };
}
