import { useCallback, useEffect, useState } from "react";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { Bell, BellOff, X } from "lucide-react";
import { supabase, useAuth, useToast } from "./NavioDashboard.jsx";
import { PUSH_PUBLIC_KEY } from "./config.js";
import { isNativeApp } from "./tracking.jsx";
import { usePermission, PermissionSheet } from "./permissions.jsx";

/* ---------------------------------------------------------------------- */
/*  Notificaciones: mensajes y tareas nuevas aunque Navio esté cerrado    */
/* ---------------------------------------------------------------------- */
//
// En el navegador: notificaciones web (service worker). En la app de Android
// (1.0.6 o más nueva): Firebase, con el plugin de notificaciones de Capacitor.

// El plugin de la app se pide con la forma oficial de Capacitor; si la app es
// de una versión sin notificaciones, no hay plugin y no se intenta nada.
let pushPlugin = null;
function nativePlugin() {
  if (!isNativeApp()) return null;
  try {
    if (!Capacitor.isPluginAvailable("PushNotifications")) return null;
    pushPlugin = pushPlugin ?? registerPlugin("PushNotifications");
    return pushPlugin;
  } catch {
    return null;
  }
}
const webSupported = () =>
  typeof window !== "undefined" && !isNativeApp() && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && !!PUSH_PUBLIC_KEY;
export const pushSupported = () => !!nativePlugin() || webSupported();

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
const NATIVE_KEY = "navio.push.nativeToken";

function keyBytes(base64) {
  const padded = (base64 + "===".slice((base64.length + 3) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

/* ---------- Navegador ---------- */

async function registration() {
  return (await navigator.serviceWorker.getRegistration()) ?? navigator.serviceWorker.register("/sw.js");
}

async function saveSubscription(sub) {
  const json = sub.toJSON();
  const { error } = await supabase.rpc("save_push_subscription", {
    sub_endpoint: json.endpoint,
    sub_p256dh: json.keys?.p256dh,
    sub_auth: json.keys?.auth,
    sub_agent: navigator.userAgent.slice(0, 300),
  });
  return error;
}

async function enableWebPush() {
  const reg = await registration();
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(PUSH_PUBLIC_KEY) });
  const error = await saveSubscription(sub);
  if (error) throw error;
  return true;
}

/* ---------- App de Android ---------- */

// Pide el permiso (ventana del sistema) y registra el teléfono en Firebase.
async function enableNativePush() {
  const plugin = nativePlugin();
  if (!plugin) throw new Error("unsupported");
  let perm = await plugin.checkPermissions();
  if (perm.receive !== "granted") perm = await plugin.requestPermissions();
  if (perm.receive !== "granted") return false;
  const handles = [];
  const token = await new Promise((resolve, reject) => {
    (async () => {
      try {
        handles.push(await plugin.addListener("registration", ({ value }) => resolve(value)));
        handles.push(await plugin.addListener("registrationError", (e) => reject(new Error(e?.error ?? "registro"))));
        await plugin.register();
      } catch (err) {
        reject(err);
      }
    })();
    window.setTimeout(() => reject(new Error("tiempo")), 20000);
  }).finally(() => handles.forEach((h) => h?.remove?.()));
  const { error } = await supabase.rpc("save_push_device", { device_token: token, device_platform: "android" });
  if (error) throw error;
  try {
    window.localStorage.setItem(NATIVE_KEY, token);
  } catch {
    // Solo es para saber que ya está activo.
  }
  return true;
}

async function disableNativePush() {
  let token = null;
  try {
    token = window.localStorage.getItem(NATIVE_KEY);
    window.localStorage.removeItem(NATIVE_KEY);
  } catch {
    // Sin almacenamiento.
  }
  if (token) await supabase.rpc("remove_push_device", { device_token: token });
  try {
    await nativePlugin()?.unregister?.();
  } catch {
    // Ya no estaba registrado.
  }
}

/* ---------- Comunes ---------- */

export async function enablePush() {
  if (nativePlugin()) return enableNativePush();
  return enableWebPush();
}

export async function disablePush() {
  if (nativePlugin()) return disableNativePush();
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return undefined;
  await supabase.rpc("remove_push_subscription", { sub_endpoint: sub.endpoint });
  return sub.unsubscribe();
}

// ¿Este navegador o teléfono ya recibe avisos?
export function usePushStatus() {
  const [webPermission] = usePermission("notifications");
  const [permission, setPermission] = useState(webPermission);
  const [subscribed, setSubscribed] = useState(null);
  const refresh = useCallback(async () => {
    const plugin = nativePlugin();
    if (plugin) {
      const perm = await plugin.checkPermissions().catch(() => ({ receive: "prompt" }));
      setPermission(perm.receive === "granted" ? "granted" : perm.receive === "denied" ? "denied" : "prompt");
      let token = null;
      try {
        token = window.localStorage.getItem(NATIVE_KEY);
      } catch {
        token = null;
      }
      return setSubscribed(perm.receive === "granted" && !!token);
    }
    setPermission(webPermission);
    if (!webSupported()) return setSubscribed(false);
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    return setSubscribed(!!sub);
  }, [webPermission]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  return { permission, subscribed, refresh };
}

// Al entrar: si ya había permiso, se renueva el registro (los navegadores y
// Firebase a veces lo cambian). En la app, tocar un aviso abre su sección.
export function PushKeeper() {
  const { user } = useAuth();
  useEffect(() => {
    if (!user) return undefined;
    const plugin = nativePlugin();
    let handle = null;
    let stopped = false;
    if (plugin) {
      (async () => {
        try {
          const h = await plugin.addListener("pushNotificationActionPerformed", (action) => {
            const url = action?.notification?.data?.url;
            if (url) window.postMessage({ type: "navio:open", url }, window.location.origin);
          });
          if (stopped) h?.remove?.();
          else handle = h;
          let enabled = false;
          try {
            enabled = !!window.localStorage.getItem(NATIVE_KEY);
          } catch {
            enabled = false;
          }
          if (enabled) {
            const perm = await plugin.checkPermissions();
            if (perm.receive === "granted") await enableNativePush();
          }
        } catch {
          // Si el teléfono no deja, Navio sigue funcionando sin avisos.
        }
      })();
    } else if (webSupported() && Notification.permission === "granted") {
      (async () => {
        try {
          const reg = await navigator.serviceWorker.getRegistration();
          const sub = await reg?.pushManager.getSubscription();
          if (sub) await saveSubscription(sub);
          else await enableWebPush();
        } catch {
          // Se reintenta en la siguiente visita.
        }
      })();
    }
    return () => {
      stopped = true;
      handle?.remove?.();
    };
  }, [user]);
  return null;
}

const errorText = (err) =>
  /function|does not exist|rpc|schema cache/i.test(err?.message ?? "") ? "Las notificaciones se activan al aplicar la actualización v26 de la base de datos." : "No se pudieron activar las notificaciones.";

// Invitación a activar las notificaciones (en Mensajes). Se puede cerrar;
// vuelve a salir en una semana.
const DISMISS_KEY = "navio.push.dismissed";
export function PushInvite({ compact = false }) {
  const { showToast } = useToast();
  const { permission, subscribed, refresh } = usePushStatus();
  const [asking, setAsking] = useState(false);
  const [hidden, setHidden] = useState(() => {
    try {
      return Date.now() - Number(window.localStorage.getItem(DISMISS_KEY) || 0) < 7 * 864e5;
    } catch {
      return false;
    }
  });

  if (hidden || subscribed !== false || !pushSupported()) {
    // iPhone sin instalar: las notificaciones solo funcionan desde el ícono.
    if (!hidden && isIOS() && !isStandalone() && !isNativeApp() && PUSH_PUBLIC_KEY && !webSupported()) {
      return (
        <div className={`flex items-start gap-2.5 rounded-2xl border border-slate-200 bg-white p-3 text-xs text-slate-600 ${compact ? "mx-3 mt-3" : ""}`}>
          <Bell size={16} className="mt-0.5 shrink-0 text-blue-600" />
          <span className="min-w-0 flex-1">
            Para recibir avisos de mensajes en iPhone, agrega Navio a tu pantalla de inicio (Compartir → Agregar a pantalla de inicio) y ábrelo desde ese ícono.
          </span>
        </div>
      );
    }
    return null;
  }

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // Solo es comodidad.
    }
    setHidden(true);
  }

  async function turnOn() {
    try {
      const ok = await enablePush();
      await refresh();
      if (ok) showToast("Listo: te avisaremos de mensajes y tareas nuevas.");
      else setAsking(true);
    } catch (err) {
      showToast(errorText(err));
    }
  }

  return (
    <>
      <div className={`flex items-center gap-2.5 rounded-2xl border border-blue-200 bg-blue-50 p-3 ${compact ? "mx-3 mt-3" : ""}`}>
        <Bell size={18} className="shrink-0 text-blue-600" />
        <p className="min-w-0 flex-1 text-xs text-slate-700">
          <b>Activa las notificaciones</b> para enterarte de mensajes nuevos aunque no tengas Navio abierto.
        </p>
        <button
          type="button"
          onClick={() => (permission === "granted" || nativePlugin() ? turnOn() : setAsking(true))}
          className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-700"
        >
          Activar
        </button>
        <button type="button" onClick={dismiss} aria-label="Ahora no" className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-blue-100">
          <X size={14} />
        </button>
      </div>
      {asking && (
        <PermissionSheet
          name="notifications"
          onClose={() => setAsking(false)}
          onGranted={() => {
            setAsking(false);
            turnOn();
          }}
        />
      )}
    </>
  );
}

// Tarjeta para Configuración → Preferencias.
export function PushSettingsCard() {
  const { showToast } = useToast();
  const { permission, subscribed, refresh } = usePushStatus();
  const [asking, setAsking] = useState(false);
  const card = "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm";

  if (!pushSupported()) {
    return (
      <div className={card}>
        <h2 className="mb-1 text-sm font-bold text-slate-800">Notificaciones</h2>
        <p className="text-xs text-slate-500">
          {isNativeApp()
            ? "Actualiza la app de Android a la versión más reciente para recibir avisos con la app cerrada."
            : isIOS() && !isStandalone()
            ? "En iPhone, agrega Navio a tu pantalla de inicio y ábrelo desde ese ícono para recibir avisos."
            : "Este navegador no permite recibir avisos con Navio cerrado."}
        </p>
      </div>
    );
  }

  async function toggle() {
    try {
      if (subscribed) {
        await disablePush();
        showToast("Ya no recibirás avisos aquí.");
      } else if (permission === "granted" || nativePlugin()) {
        const ok = await enablePush();
        if (ok) showToast("Listo: te avisaremos de mensajes y tareas nuevas.");
        else setAsking(true);
      } else {
        setAsking(true);
        return;
      }
    } catch (err) {
      showToast(errorText(err));
    }
    refresh();
  }

  return (
    <div className={card}>
      <h2 className="mb-1 text-sm font-bold text-slate-800">Notificaciones</h2>
      <p className="mb-3 text-xs text-slate-500">Avisos de mensajes, tareas y alertas nuevas aunque Navio esté cerrado. Se activan en cada navegador o teléfono.</p>
      <button type="button" onClick={toggle} className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold ${subscribed ? "border border-slate-200 text-slate-600 hover:bg-slate-50" : "bg-blue-600 text-white hover:bg-blue-700"}`}>
        {subscribed ? <BellOff size={13} /> : <Bell size={13} />} {subscribed ? "Desactivar aquí" : "Activar aquí"}
      </button>
      {asking && (
        <PermissionSheet
          name="notifications"
          onClose={() => setAsking(false)}
          onGranted={async () => {
            setAsking(false);
            try {
              await enablePush();
              showToast("Listo: te avisaremos de mensajes y tareas nuevas.");
            } catch (err) {
              showToast(errorText(err));
            }
            refresh();
          }}
        />
      )}
    </div>
  );
}
