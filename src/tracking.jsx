import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { Capacitor, CapacitorHttp, registerPlugin } from "@capacitor/core";
import { AlertTriangle, Clock, Gauge, LocateFixed, MapPin, Navigation, Route, Truck, User, WifiOff, X } from "lucide-react";
import {
  supabase,
  useAuth,
  useToast,
  Modal,
  timeAgoLabel,
  vehicleDriverLabel,
  GPS_STATUS_STYLES,
  LIVE_MAP_STATUS_STYLES,
  FLEET_STATUS_FILTERS,
  computeVehicleStatus,
} from "./NavioDashboard.jsx";

/* ---------------------------------------------------------------------- */
/*  Rastreo del viaje en curso                                            */
/* ---------------------------------------------------------------------- */

// El rastreo vive por encima de las pantallas: sigue aunque la persona cambie
// de sección. Los puntos se juntan en una cola que se guarda en el teléfono y
// se mandan por lotes en una sola llamada, así que una zona sin señal no
// pierde el recorrido: se envía al volver la conexión.
//
// La ubicación puede salir de tres lugares:
//   - "app":     la app Navio para Android. Un servicio del teléfono sigue
//                leyendo el GPS con la pantalla apagada o con otra app abierta.
//   - "tracker": una app de rastreo aparte (Traccar Client) vinculada a la
//                persona. Manda la ubicación directo al servidor; aquí solo se
//                muestra el avance.
//   - "browser": el navegador. Solo funciona con Navio en pantalla: ningún
//                navegador entrega el GPS a una página que no se está viendo.
const ACTIVE_KEY = "navio.tracking.active.v1";
const QUEUE_KEY = "navio.tracking.queue.v1";
const CONSENT_KEY = "navio.tracking.consent.v1";
const MIN_POINT_MS = 5000; // un punto cada 5 s como mucho
const FLUSH_MS = 15000; // se envía cada 15 s...
const FLUSH_POINTS = 8; // ...o al juntar 8 puntos
const FLUSH_TIMEOUT_MS = 25000; // un envío atorado no bloquea a los siguientes
const MAX_BATCH = 200;
const MAX_QUEUE = 3000; // ~4 horas sin señal
const TRACKER_POLL_MS = 20000;
const PAUSE_NOTICE_MS = 60000; // pausas más cortas no vale la pena avisarlas
const NO_STATS = { distanceKm: 0, pointCount: 0, maxSpeed: 0 };

export const ANDROID_APP_URL = "https://github.com/Tegesu/Navio/releases/latest/download/navio.apk";

// ¿Navio está abierto dentro de su app de Android (o iOS)?
export function isNativeApp() {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

// El servicio de ubicación en segundo plano de la app.
const BackgroundGeolocation = registerPlugin("BackgroundGeolocation");

function readStored(key) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStored(key, value) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Sin almacenamiento (modo privado): el rastreo sigue, solo no sobrevive a una recarga.
  }
}

const routeStats = (route) => ({
  distanceKm: Number(route?.distanceKm) || 0,
  pointCount: route?.pointCount ?? 0,
  maxSpeed: Number(route?.maxSpeed) || 0,
});

const withTimeout = (promise, ms) => Promise.race([promise, new Promise((_, reject) => window.setTimeout(() => reject(new Error("timeout")), ms))]);

// Dentro de la app, con la pantalla apagada Android frena las conexiones de la
// página. El envío de puntos sale por la red del teléfono, que no se frena.
// Si algo no cuadra (sin sesión, token por vencer) se usa el camino normal.
async function sendPoints(args) {
  if (isNativeApp()) {
    try {
      const { data } = await supabase.auth.getSession();
      const session = data?.session;
      if (session?.access_token && (session.expires_at ?? 0) * 1000 - Date.now() > 90000) {
        const response = await CapacitorHttp.request({
          url: `${supabase.supabaseUrl}/rest/v1/rpc/track_route_points`,
          method: "POST",
          headers: { apikey: supabase.supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
          data: args,
          connectTimeout: 15000,
          readTimeout: 20000,
        });
        if (response.status >= 200 && response.status < 300) return { data: response.data, error: null };
        if (response.status >= 400 && response.status < 500 && response.data?.message) return { data: null, error: { message: response.data.message } };
      }
    } catch {
      // Se intenta por el camino normal.
    }
  }
  return supabase.rpc("track_route_points", args);
}

const TrackingContext = createContext(null);

export function useTracking() {
  return useContext(TrackingContext);
}

// Avisa a la app que cambiaron traslados o kilometraje desde el servidor.
export function announceTripsChanged() {
  window.dispatchEvent(new CustomEvent("navio:trips-changed"));
}

export function TrackingProvider({ children }) {
  const { user, profile } = useAuth();
  const [active, setActive] = useState(() => readStored(ACTIVE_KEY));
  const [status, setStatus] = useState("idle"); // idle | starting | tracking | stopping
  const [stats, setStats] = useState(NO_STATS);
  const [lastFix, setLastFix] = useState(null);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState("");
  const [orphan, setOrphan] = useState(null); // ruta abierta que este dispositivo no está siguiendo
  const [consent, setConsent] = useState(() => !!readStored(CONSENT_KEY));
  const [tracker, setTracker] = useState(null); // teléfono vinculado con la app de rastreo (o null)
  const [trackerSeenAt, setTrackerSeenAt] = useState(null); // último punto que llegó del rastreador en este viaje
  const [pausedMs, setPausedMs] = useState(0); // tiempo que el navegador dejó de registrar en este viaje

  const activeRef = useRef(active);
  const queueRef = useRef(readStored(QUEUE_KEY) ?? []);
  const watchRef = useRef(null); // null | número (navegador) | "pending" | { nativeId }
  const lastPointRef = useRef(0);
  const flushingRef = useRef(false);
  const wakeLockRef = useRef(null);
  const hiddenAtRef = useRef(null);

  const native = isNativeApp();
  // Con qué se registra el viaje en curso en este dispositivo.
  const mode = !active ? null : active.source === "tracker" ? "tracker" : native ? "app" : "browser";
  const modeRef = useRef(mode);
  modeRef.current = mode;

  function persistQueue() {
    if (queueRef.current.length > MAX_QUEUE) queueRef.current = queueRef.current.slice(-MAX_QUEUE);
    writeStored(QUEUE_KEY, queueRef.current.length ? queueRef.current : null);
    setPending(queueRef.current.length);
  }

  async function holdScreenAwake() {
    // Solo hace falta en el navegador: es lo único que evita que se pause.
    if (isNativeApp() || activeRef.current?.source === "tracker") return;
    try {
      if (!wakeLockRef.current && "wakeLock" in navigator) {
        const lock = await navigator.wakeLock.request("screen");
        lock.addEventListener?.("release", () => {
          if (wakeLockRef.current === lock) wakeLockRef.current = null;
        });
        wakeLockRef.current = lock;
      }
    } catch {
      // No todos los navegadores lo permiten; el rastreo funciona igual con la pantalla encendida.
    }
  }

  function clearWatch() {
    const current = watchRef.current;
    watchRef.current = null;
    if (typeof current === "number") navigator.geolocation.clearWatch(current);
    else if (current?.nativeId) BackgroundGeolocation.removeWatcher({ id: current.nativeId }).catch(() => {});
    wakeLockRef.current?.release?.().catch(() => {});
    wakeLockRef.current = null;
  }

  function stopLocal() {
    clearWatch();
    queueRef.current = [];
    persistQueue();
    writeStored(ACTIVE_KEY, null);
    activeRef.current = null;
    setActive(null);
    setStatus("idle");
    setLastFix(null);
    setTrackerSeenAt(null);
    setPausedMs(0);
    hiddenAtRef.current = null;
  }

  const flush = useCallback(async () => {
    const current = activeRef.current;
    if (!current || current.source === "tracker" || queueRef.current.length === 0) return true;
    if (flushingRef.current) return false;
    flushingRef.current = true;
    try {
      while (queueRef.current.length > 0) {
        const batch = queueRef.current.slice(0, MAX_BATCH);
        let result;
        try {
          result = await withTimeout(sendPoints({ target_route: current.routeId, points: batch, sent_at: new Date().toISOString() }), FLUSH_TIMEOUT_MS);
        } catch {
          result = { data: null, error: { message: "sin respuesta" } };
        }
        const { data, error: rpcError } = result;
        if (rpcError) {
          if (/ya terminó|no pertenece|no existe/.test(rpcError.message)) {
            // El viaje se cerró desde otro dispositivo o lo terminó un administrador.
            stopLocal();
            setError("Este viaje ya se había terminado.");
            announceTripsChanged();
          } else {
            setError("Sin conexión: el recorrido se guarda en este dispositivo y se envía al volver la señal.");
          }
          return false;
        }
        queueRef.current = queueRef.current.slice(batch.length);
        persistQueue();
        setStats(routeStats(data));
        setError("");
      }
      return true;
    } finally {
      flushingRef.current = false;
    }
    // Solo usa refs y funciones de estado, que no cambian entre renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleFix(position) {
    const now = Date.now();
    const { latitude, longitude, speed, heading, accuracy } = position.coords;
    const kmh = speed != null && speed >= 0 ? Math.round(speed * 36) / 10 : null;
    setLastFix({ lat: latitude, lng: longitude, speed: kmh, accuracy, at: now });
    setError((prev) => (prev.startsWith("Buscando") || prev.startsWith("No se pudo obtener") ? "" : prev));
    if (now - lastPointRef.current < MIN_POINT_MS) return;
    lastPointRef.current = now;
    queueRef.current.push({
      lat: latitude,
      lng: longitude,
      speed: kmh,
      heading: Number.isFinite(heading) ? Math.round(heading) : null,
      accuracy: Number.isFinite(accuracy) ? Math.round(accuracy) : null,
      t: new Date(position.timestamp || now).toISOString(),
    });
    persistQueue();
    if (queueRef.current.length >= FLUSH_POINTS) flush();
  }

  function handleGeoError(geoError) {
    if (geoError.code === 1) {
      setError(
        isNativeApp()
          ? "Navio no tiene permiso para usar la ubicación. Actívalo en los ajustes del teléfono para la app Navio."
          : "Navio no tiene permiso para ver tu ubicación. Actívalo en los ajustes del navegador para este sitio."
      );
    } else if (geoError.code === 2) setError("No se pudo obtener la ubicación. Revisa que el GPS esté encendido.");
    else setError("Buscando señal GPS…");
  }

  // Dentro de la app: el servicio del teléfono entrega la ubicación aunque la
  // pantalla esté apagada. Muestra un aviso fijo mientras el viaje dura.
  function startNativeWatch() {
    if (watchRef.current != null) return;
    watchRef.current = "pending";
    BackgroundGeolocation.addWatcher(
      {
        backgroundTitle: "Navio: viaje en curso",
        backgroundMessage: "Se está registrando el recorrido. Abre Navio para finalizar el viaje.",
        requestPermissions: true,
        stale: false,
        distanceFilter: 10,
      },
      (location, watchError) => {
        if (watchError) handleGeoError({ code: watchError.code === "NOT_AUTHORIZED" ? 1 : 2 });
        else if (location) {
          handleFix({
            coords: { latitude: location.latitude, longitude: location.longitude, speed: location.speed, heading: location.bearing, accuracy: location.accuracy },
            timestamp: location.time,
          });
        }
      }
    )
      .then((id) => {
        // Si el viaje se detuvo mientras el servicio arrancaba, se apaga.
        if (watchRef.current === "pending") watchRef.current = { nativeId: id };
        else BackgroundGeolocation.removeWatcher({ id }).catch(() => {});
      })
      .catch(() => {
        if (watchRef.current === "pending") watchRef.current = null;
        setError("No se pudo iniciar el registro en segundo plano. Cierra y vuelve a abrir Navio.");
      });
  }

  function startWatch() {
    if (activeRef.current?.source === "tracker") return true; // la ubicación la manda la app de rastreo
    if (isNativeApp()) {
      startNativeWatch();
      return true;
    }
    if (!("geolocation" in navigator)) {
      setError("Este dispositivo no permite compartir la ubicación.");
      return false;
    }
    if (watchRef.current == null) {
      watchRef.current = navigator.geolocation.watchPosition(handleFix, handleGeoError, {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 30000,
      });
    }
    holdScreenAwake();
    return true;
  }

  // ¿Hay permiso de ubicación? Se pregunta antes de abrir el viaje: sin
  // ubicación no tiene caso crearlo. Devuelve true si fue negado.
  function locationDenied() {
    if (isNativeApp()) {
      return new Promise((resolve) => {
        let done = false;
        let watcherId = null;
        const finish = (denied) => {
          if (done) return;
          done = true;
          if (watcherId) BackgroundGeolocation.removeWatcher({ id: watcherId }).catch(() => {});
          resolve(denied);
        };
        BackgroundGeolocation.addWatcher({ requestPermissions: true, stale: true }, (location, watchError) => {
          if (watchError?.code === "NOT_AUTHORIZED") finish(true);
          else if (location) finish(false);
        })
          .then((id) => {
            watcherId = id;
            if (done) BackgroundGeolocation.removeWatcher({ id }).catch(() => {});
          })
          .catch(() => finish(false));
        window.setTimeout(() => finish(false), 12000);
      });
    }
    return new Promise((resolve) =>
      navigator.geolocation.getCurrentPosition(
        () => resolve(false),
        (geoError) => resolve(geoError.code === 1),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
      )
    );
  }

  function follow(route, unit) {
    const next = { routeId: route.id, vehicleId: route.vehicleId, tripId: route.tripId ?? null, unit, startedAt: route.startedAt, userId: user.id, source: route.source === "tracker" ? "tracker" : "phone" };
    writeStored(ACTIVE_KEY, next);
    activeRef.current = next;
    setActive(next);
    setStats(routeStats(route));
    setTrackerSeenAt(next.source === "tracker" ? route.lastPointAt ?? null : null);
    setPausedMs(0);
    setOrphan(null);
    setStatus("tracking");
    startWatch();
  }

  // source: "phone" (este dispositivo) o "tracker" (la app de rastreo vinculada).
  async function start({ vehicleId, tripId = null, unit, source = "phone" }) {
    const byTracker = source === "tracker";
    if (!byTracker && !isNativeApp() && !("geolocation" in navigator)) {
      setError("Este dispositivo no permite compartir la ubicación.");
      return false;
    }
    setStatus("starting");
    setError("");
    if (!byTracker && (await locationDenied())) {
      handleGeoError({ code: 1 });
      setStatus("idle");
      return false;
    }
    const args = { target_vehicle: vehicleId, target_trip: tripId };
    if (byTracker) args.route_source = "tracker";
    const { data, error: rpcError } = await supabase.rpc("start_route", args);
    const route = Array.isArray(data) ? data[0] : data;
    if (rpcError || !route) {
      setError(`No se pudo iniciar el viaje: ${rpcError?.message ?? "sin respuesta"}`);
      setStatus("idle");
      return false;
    }
    queueRef.current = [];
    persistQueue();
    lastPointRef.current = 0;
    follow(route, unit);
    announceTripsChanged();
    return true;
  }

  async function stop({ completeTrip = true } = {}) {
    const current = activeRef.current;
    if (!current) return null;
    setStatus("stopping");
    clearWatch();
    const sent = await flush();
    if (!sent && activeRef.current) {
      setStatus("tracking");
      startWatch();
      setError("Sin conexión: no se pudo terminar el viaje. Inténtalo de nuevo cuando tengas señal.");
      return null;
    }
    if (!activeRef.current) return null; // el viaje ya estaba cerrado
    const { data, error: rpcError } = await supabase.rpc("finish_route", { target_route: current.routeId, complete_trip: completeTrip });
    if (rpcError) {
      setStatus("tracking");
      startWatch();
      setError(`No se pudo terminar el viaje: ${rpcError.message}`);
      return null;
    }
    stopLocal();
    setStats(NO_STATS);
    setError("");
    announceTripsChanged();
    return Array.isArray(data) ? data[0] : data;
  }

  async function finishOrphan() {
    if (!orphan) return;
    const { error: rpcError } = await supabase.rpc("finish_route", { target_route: orphan.id, complete_trip: true });
    if (rpcError) setError(`No se pudo terminar el viaje: ${rpcError.message}`);
    else {
      setOrphan(null);
      announceTripsChanged();
    }
  }

  function giveConsent() {
    writeStored(CONSENT_KEY, new Date().toISOString());
    setConsent(true);
  }

  // El teléfono vinculado con la app de rastreo, si lo hay. Antes de la
  // migración v18 la tabla no existe: simplemente no hay ninguno.
  const reloadTracker = useCallback(async () => {
    if (!user) return null;
    const { data } = await supabase.from("tracker_devices").select("id, createdAt, lastSeenAt").eq("userId", user.id).limit(1);
    const device = data?.[0] ?? null;
    setTracker(device);
    return device;
  }, [user]);

  useEffect(() => {
    if (user && profile?.companyId) reloadTracker();
  }, [user, profile?.companyId, reloadTracker]);

  // Al abrir la app: ¿hay un viaje mío abierto? Si este dispositivo lo llevaba,
  // el rastreo se reanuda solo; si no, se ofrece continuarlo o terminarlo.
  useEffect(() => {
    if (!user || !profile?.companyId) return undefined;
    let cancelled = false;
    (async () => {
      if (activeRef.current && activeRef.current.userId !== user.id) stopLocal(); // otra persona usó este dispositivo
      const { data, error: queryError } = await supabase
        .from("routes")
        .select("*")
        .eq("createdBy", user.id)
        .eq("status", "active")
        .order("startedAt", { ascending: false })
        .limit(1);
      if (cancelled) return;
      const mine = activeRef.current;
      if (queryError) {
        // Sin conexión: si este dispositivo llevaba un viaje, lo sigue registrando.
        if (mine) {
          setStatus("tracking");
          startWatch();
        }
        return;
      }
      const open = data?.[0] ?? null;
      if (mine && open && open.id === mine.routeId) {
        setStats(routeStats(open));
        if (mine.source === "tracker") setTrackerSeenAt(open.lastPointAt ?? null);
        setStatus("tracking");
        startWatch();
      } else {
        if (mine) stopLocal();
        setOrphan(open);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, profile?.companyId]);

  // Mientras hay viaje: envío periódico, y al recuperar la señal o volver a
  // la app. En el navegador, al volver se reinicia la lectura del GPS (el
  // teléfono la suelta cuando la página deja de verse) y se anota la pausa.
  useEffect(() => {
    if (status !== "tracking") return undefined;
    const timer = window.setInterval(flush, FLUSH_MS);
    const onVisibility = () => {
      if (document.visibilityState !== "visible") {
        hiddenAtRef.current = Date.now();
        flush(); // lo que haya, antes de que el teléfono duerma la página
        return;
      }
      if (modeRef.current === "browser") {
        const hiddenAt = hiddenAtRef.current;
        if (hiddenAt && Date.now() - hiddenAt >= PAUSE_NOTICE_MS) setPausedMs((total) => total + (Date.now() - hiddenAt));
        if (typeof watchRef.current === "number") {
          navigator.geolocation.clearWatch(watchRef.current);
          watchRef.current = null;
        }
        lastPointRef.current = 0; // el primer punto al volver se guarda de inmediato
        startWatch();
      }
      hiddenAtRef.current = null;
      flush();
    };
    window.addEventListener("online", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [status, flush]);

  // Con la app de rastreo, los puntos llegan directo al servidor: aquí solo
  // se consulta cómo va el viaje.
  useEffect(() => {
    if (status !== "tracking" || active?.source !== "tracker") return undefined;
    let cancelled = false;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      const { data } = await supabase.from("routes").select("*").eq("id", active.routeId).limit(1);
      const route = data?.[0];
      if (cancelled || !route) return;
      if (route.status !== "active") {
        stopLocal();
        setError("Este viaje ya se había terminado.");
        announceTripsChanged();
        return;
      }
      setStats(routeStats(route));
      setTrackerSeenAt(route.lastPointAt ?? null);
    };
    check();
    const timer = window.setInterval(check, TRACKER_POLL_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, active?.source, active?.routeId]);

  useEffect(() => clearWatch, []);

  const value = { active, status, stats, lastFix, pending, error, orphan, consent, mode, native, tracker, trackerSeenAt, pausedMs, start, stop, follow, finishOrphan, giveConsent, reloadTracker };
  return <TrackingContext.Provider value={value}>{children}</TrackingContext.Provider>;
}

export function formatDuration(ms) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
}

export const formatKm = (km) => `${(Number(km) || 0).toLocaleString("es-MX", { maximumFractionDigits: 1 })} km`;

// Tiempo transcurrido que se actualiza solo.
function useElapsed(since) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!since) return undefined;
    const timer = window.setInterval(() => tick((n) => n + 1), 30000);
    return () => window.clearInterval(timer);
  }, [since]);
  return since ? formatDuration(Date.now() - new Date(since).getTime()) : "—";
}

// Lo que ve quien maneja mientras el viaje está activo.
export function TrackingLiveCard({ big = false }) {
  const tracking = useTracking();
  const elapsed = useElapsed(tracking.active?.startedAt);
  if (!tracking.active) return null;
  const { stats, lastFix, pending, active, mode, trackerSeenAt, pausedMs } = tracking;
  const byTracker = mode === "tracker";
  const items = [
    ["Tiempo", elapsed],
    ["Distancia", formatKm(stats.distanceKm)],
    byTracker ? ["Vel. máxima", stats.maxSpeed ? `${Math.round(stats.maxSpeed)} km/h` : "—"] : ["Velocidad", lastFix?.speed != null ? `${Math.round(lastFix.speed)} km/h` : "—"],
  ];
  const signal = byTracker
    ? trackerSeenAt
      ? `Última señal de la app de rastreo ${timeAgoLabel(trackerSeenAt)}`
      : "Esperando la primera señal de la app de rastreo…"
    : lastFix
    ? `Última ubicación ${timeAgoLabel(new Date(lastFix.at).toISOString())}`
    : "Buscando señal GPS…";
  return (
    <div className={`rounded-2xl bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200 ${big ? "p-4" : "p-3"}`}>
      <p className={`flex items-center gap-2 font-bold ${big ? "text-base" : "text-xs"}`}>
        <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-emerald-500" /> Viaje en curso{active.unit ? ` · ${active.unit}` : ""}
      </p>
      <div className={`mt-2 grid grid-cols-3 gap-2 ${big ? "text-sm" : "text-[11px]"}`}>
        {items.map(([label, value]) => (
          <div key={label}>
            <p className="text-emerald-600">{label}</p>
            <p className={`font-bold ${big ? "text-lg" : "text-sm"}`}>{value}</p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-emerald-700">
        {signal}
        {pending > 0 && ` · ${pending} punto${pending === 1 ? "" : "s"} por enviar`}
      </p>
      {mode === "browser" && pausedMs > 0 && (
        <p className="mt-1 text-[11px] font-semibold text-amber-700">El registro estuvo en pausa {formatDuration(pausedMs)}: Navio no estaba en pantalla.</p>
      )}
    </div>
  );
}

function TrackingError() {
  const { error } = useTracking();
  if (!error) return null;
  return (
    <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] font-medium text-amber-800">
      {error.startsWith("Sin conexión") ? <WifiOff size={13} className="mt-0.5 shrink-0" /> : <AlertTriangle size={13} className="mt-0.5 shrink-0" />}
      {error}
    </p>
  );
}

// Qué puede hacer la persona con el teléfono mientras dura el viaje.
function TrackingModeNote() {
  const { mode, trackerSeenAt, active } = useTracking();
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => tick((n) => n + 1), 30000);
    return () => window.clearInterval(timer);
  }, []);
  if (mode === "app") {
    return <p className="text-[11px] text-slate-500">Puedes apagar la pantalla o usar otras apps: Navio sigue registrando el viaje. Verás un aviso fijo en el teléfono mientras dure.</p>;
  }
  if (mode === "tracker") {
    const since = trackerSeenAt ?? active?.startedAt;
    const silent = since && Date.now() - new Date(since).getTime() > 3 * 60000;
    return (
      <p className={`text-[11px] ${silent ? "rounded-lg bg-amber-50 px-2.5 py-2 font-medium text-amber-800" : "text-slate-500"}`}>
        {silent
          ? "No ha llegado señal de tu app de rastreo en los últimos minutos. Ábrela y revisa que el servicio esté encendido y con permiso de ubicación “Siempre”."
          : "El recorrido lo registra tu app de rastreo: puedes apagar la pantalla o usar otras apps. Vuelve a Navio para finalizar el viaje."}
      </p>
    );
  }
  return (
    <p className="rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800">
      Deja Navio abierto y la pantalla encendida: en el navegador el registro se pausa si se apaga la pantalla o abres otra app, y se reanuda al volver. Para que siga en segundo plano, activa el rastreo en Cuenta → Rastreo.
    </p>
  );
}

// Un viaje que quedó abierto (por ejemplo, se inició en otro teléfono).
function OrphanRouteNotice({ vehicles }) {
  const { orphan, follow, finishOrphan, active } = useTracking();
  if (!orphan || active) return null;
  const unit = vehicles.find((v) => v.id === orphan.vehicleId)?.unit ?? "tu unidad";
  return (
    <div className="space-y-2 rounded-2xl bg-amber-50 p-3 text-xs text-amber-800 ring-1 ring-amber-200">
      <p className="font-semibold">
        Tienes un viaje abierto en {unit} desde {new Date(orphan.startedAt).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })}.
      </p>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => follow(orphan, unit)} className="rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-700">
          Continuar aquí
        </button>
        <button onClick={finishOrphan} className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-100">
          Terminar viaje
        </button>
      </div>
    </div>
  );
}

// Iniciar o terminar un viaje. "trips" son los traslados que la persona puede
// tomar; también se puede salir sin traslado asignado ("viaje libre").
export function DriverPanel({ vehicles, trips = [], big = false }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const tracking = useTracking();
  const openTrips = trips.filter((t) => ["scheduled", "ongoing"].includes(t.status) && (!t.assignedTo || t.assignedTo === user?.id));
  const [choice, setChoice] = useState(() => (openTrips[0] ? `trip:${openTrips[0].id}` : "free"));
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? null);
  const [confirming, setConfirming] = useState(false);
  // Fuera de la app, quien vinculó su app de rastreo puede elegir con qué registra.
  const canUseTracker = !tracking.native && !!tracking.tracker;
  const [source, setSource] = useState("tracker");
  const chosenSource = canUseTracker ? source : "phone";
  const busy = tracking.status === "starting" || tracking.status === "stopping";
  const chosenTrip = choice.startsWith("trip:") ? openTrips.find((t) => `trip:${t.id}` === choice) : null;
  const tripVehicle = chosenTrip ? vehicles.find((v) => v.id === chosenTrip.vehicleId) ?? vehicles.find((v) => v.unit === chosenTrip.unit) : null;
  const vehicle = chosenTrip ? tripVehicle : vehicles.find((v) => v.id === vehicleId);
  const fieldClass = `w-full rounded-lg border border-slate-200 bg-white focus:border-blue-400 focus:outline-none ${big ? "px-3 py-2.5 text-sm" : "px-2.5 py-1.5 text-xs"}`;
  const buttonClass = `w-full rounded-2xl font-bold text-white shadow-sm disabled:opacity-60 ${big ? "py-4 text-base" : "py-2.5 text-xs"}`;

  async function handleStart() {
    if (!vehicle) return;
    await tracking.start({ vehicleId: vehicle.id, tripId: chosenTrip?.id ?? null, unit: vehicle.unit, source: chosenSource });
  }

  async function handleStop() {
    setConfirming(false);
    const route = await tracking.stop();
    if (route) showToast(`Viaje guardado: ${formatKm(route.distanceKm)} recorridos.`);
  }

  if (tracking.active) {
    return (
      <div className="space-y-3">
        <TrackingLiveCard big={big} />
        <TrackingError />
        <TrackingModeNote />
        {confirming ? (
          <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3">
            <p className="text-xs font-semibold text-slate-700">¿Terminar el viaje? El recorrido queda guardado.</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirming(false)} className="flex-1 rounded-lg border border-slate-200 py-2 text-xs font-semibold text-slate-600">
                Seguir manejando
              </button>
              <button onClick={handleStop} disabled={busy} className="flex-1 rounded-lg bg-rose-600 py-2 text-xs font-semibold text-white disabled:opacity-60">
                {busy ? "Guardando…" : "Sí, terminar"}
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setConfirming(true)} disabled={busy} className={`${buttonClass} bg-rose-600 hover:bg-rose-700`}>
            Finalizar viaje
          </button>
        )}
      </div>
    );
  }

  if (!tracking.consent) {
    return (
      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
        <p className="flex items-center gap-2 text-sm font-bold text-slate-800">
          <MapPin size={16} className="text-blue-600" /> Tu ubicación durante el viaje
        </p>
        <p className="text-xs text-slate-500">
          Mientras un viaje esté activo, Navio registra la ubicación de este dispositivo y la comparte con las personas de tu empresa para dar seguimiento a
          la unidad. El registro empieza cuando inicias el viaje y se detiene cuando lo finalizas. Fuera de un viaje no se registra nada.
        </p>
        <button onClick={tracking.giveConsent} className="w-full rounded-xl bg-blue-600 py-2.5 text-xs font-semibold text-white hover:bg-blue-700">
          Entendido, continuar
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <OrphanRouteNotice vehicles={vehicles} />
      <div>
        <label className="mb-1 block text-[11px] font-semibold text-slate-500">¿Qué viaje vas a hacer?</label>
        <select value={choice} onChange={(e) => setChoice(e.target.value)} className={fieldClass}>
          {openTrips.map((t) => (
            <option key={t.id} value={`trip:${t.id}`}>
              {t.origin} → {t.destination} · {t.unit}
            </option>
          ))}
          <option value="free">Viaje libre (sin traslado asignado)</option>
        </select>
      </div>
      {!chosenTrip && (
        <div>
          <label className="mb-1 block text-[11px] font-semibold text-slate-500">Unidad</label>
          <select value={vehicleId ?? ""} onChange={(e) => setVehicleId(Number(e.target.value))} className={fieldClass}>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.unit} — {v.plate}
              </option>
            ))}
          </select>
        </div>
      )}
      {chosenTrip && !tripVehicle && <p className="text-[11px] font-medium text-rose-600">La unidad de este traslado ya no existe. Pide que lo corrijan.</p>}
      {canUseTracker && (
        <div>
          <label className="mb-1 block text-[11px] font-semibold text-slate-500">¿Con qué se registra el recorrido?</label>
          <select value={source} onChange={(e) => setSource(e.target.value)} className={fieldClass}>
            <option value="tracker">Con mi app de rastreo (sigue con la pantalla apagada)</option>
            <option value="phone">Con este navegador (pantalla encendida)</option>
          </select>
        </div>
      )}
      {!tracking.native && chosenSource === "phone" && (
        <div className="space-y-2 rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800">
          <p>
            En el navegador el registro se pausa si apagas la pantalla o abres otra app.{" "}
            {/android/i.test(navigator.userAgent) ? "Con la app de Android sigue registrando en segundo plano." : "Para que siga en segundo plano, activa el rastreo en Cuenta → Rastreo."}
          </p>
          {/android/i.test(navigator.userAgent) && (
            <a href={ANDROID_APP_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-700">
              <Navigation size={12} /> Descargar la app para Android
            </a>
          )}
        </div>
      )}
      <TrackingError />
      <button onClick={handleStart} disabled={busy || !vehicle} className={`${buttonClass} bg-blue-600 hover:bg-blue-700`}>
        {tracking.status === "starting" ? "Iniciando…" : "Iniciar viaje"}
      </button>
      {vehicles.length === 0 && <p className="text-center text-[11px] text-slate-400">Primero registra una unidad en Gestión de flota.</p>}
    </div>
  );
}

// Aviso flotante en escritorio mientras hay un viaje activo en este equipo.
export function TrackingPill({ onOpen }) {
  const tracking = useTracking();
  if (!tracking?.active) return null;
  return (
    <button
      onClick={onOpen}
      className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-lg hover:bg-emerald-700 print:hidden"
    >
      <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
      Viaje en curso · {formatKm(tracking.stats.distanceKm)}
      {tracking.pending > 0 && <WifiOff size={13} />}
    </button>
  );
}

export function DriverModeModal({ vehicles, trips, onClose }) {
  return (
    <Modal title="Modo conductor" width="max-w-sm" onClose={onClose}>
      <DriverPanel vehicles={vehicles} trips={trips} />
    </Modal>
  );
}

/* ---------------------------------------------------------------------- */
/*  Mapa                                                                  */
/* ---------------------------------------------------------------------- */

const MAP_COLORS = { moving: "#10b981", stopped: "#f59e0b", offline: "#94a3b8" };
const DEFAULT_MAP_CENTER = [23.6345, -102.5528]; // México
const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

// Los nombres de unidad los escribe la gente: se insertan como texto, nunca
// como HTML, para que no puedan colar código en el mapa.
function unitIcon({ color, label, selected }) {
  const wrap = document.createElement("div");
  wrap.style.cssText = "display:flex;align-items:center;gap:5px;transform:translate(-9px,-9px);white-space:nowrap";
  const dot = document.createElement("span");
  dot.style.cssText = `flex:none;width:18px;height:18px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 0 0 ${selected ? "3px #2563eb" : "1px rgba(15,23,42,.25)"},0 1px 4px rgba(0,0,0,.4)`;
  const text = document.createElement("span");
  text.textContent = label;
  text.style.cssText = `background:${selected ? "#2563eb" : "#fff"};color:${selected ? "#fff" : "#334155"};border-radius:6px;padding:1px 6px;font:600 11px system-ui,sans-serif;box-shadow:0 1px 3px rgba(0,0,0,.25)`;
  wrap.append(dot, text);
  return L.divIcon({ className: "", html: wrap, iconSize: [18, 18], iconAnchor: [0, 0] });
}

function pinIcon(text, color) {
  const el = document.createElement("div");
  el.textContent = text;
  el.style.cssText = `transform:translate(-50%,-50%);width:22px;height:22px;border-radius:50%;background:${color};color:#fff;border:2px solid #fff;font:700 11px/18px system-ui,sans-serif;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.4)`;
  return L.divIcon({ className: "", html: el, iconSize: [22, 22], iconAnchor: [0, 0] });
}

// markers: [{ id, lat, lng, color, label, selected }]
// lines:   [{ id, points: [{ lat, lng }], color, dashed }]
// pins:    [{ id, lat, lng, text, color }]
// fitKey:  al cambiar, el mapa se ajusta para mostrar todo lo dibujado.
// follow:  { lat, lng } — el mapa se mantiene centrado ahí.
export function MapView({ markers = [], lines = [], pins = [], fitKey, follow = null, onSelectMarker }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef({ markers: new Map(), lines: null, pins: null });
  const fittedRef = useRef(null);
  const selectRef = useRef(onSelectMarker);
  selectRef.current = onSelectMarker;

  useEffect(() => {
    const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true }).setView(DEFAULT_MAP_CENTER, 5);
    L.tileLayer(TILE_URL, { attribution: "© OpenStreetMap", maxZoom: 19 }).addTo(map);
    layersRef.current.lines = L.layerGroup().addTo(map);
    layersRef.current.pins = L.layerGroup().addTo(map);
    mapRef.current = map;
    // El mapa necesita saber cuando su contenedor cambia de tamaño.
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      layersRef.current.markers = new Map();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const known = layersRef.current.markers;
    const seen = new Set();
    for (const m of markers) {
      seen.add(m.id);
      const signature = `${m.color}|${m.label}|${m.selected ? 1 : 0}`;
      let entry = known.get(m.id);
      if (!entry) {
        const marker = L.marker([m.lat, m.lng], { icon: unitIcon(m), zIndexOffset: m.selected ? 500 : 0 }).addTo(map);
        marker.on("click", () => selectRef.current?.(m.id));
        entry = { marker, signature };
        known.set(m.id, entry);
      } else {
        entry.marker.setLatLng([m.lat, m.lng]);
        if (entry.signature !== signature) {
          entry.marker.setIcon(unitIcon(m));
          entry.marker.setZIndexOffset(m.selected ? 500 : 0);
          entry.signature = signature;
        }
      }
    }
    for (const [id, entry] of known) {
      if (!seen.has(id)) {
        entry.marker.remove();
        known.delete(id);
      }
    }
  }, [markers]);

  useEffect(() => {
    const group = layersRef.current.lines;
    group.clearLayers();
    for (const line of lines) {
      if (line.points.length < 2) continue;
      L.polyline(
        line.points.map((p) => [p.lat, p.lng]),
        { color: line.color ?? "#2563eb", weight: 4, opacity: 0.9, dashArray: line.dashed ? "6 8" : null }
      ).addTo(group);
    }
  }, [lines]);

  useEffect(() => {
    const group = layersRef.current.pins;
    group.clearLayers();
    for (const pin of pins) L.marker([pin.lat, pin.lng], { icon: pinIcon(pin.text, pin.color), interactive: false }).addTo(group);
  }, [pins]);

  // Ajusta la vista una vez por cada fitKey, cuando ya hay algo que mostrar.
  useEffect(() => {
    if (fitKey === undefined || fittedRef.current === fitKey) return;
    const points = [...markers, ...pins, ...lines.flatMap((l) => l.points)].map((p) => [p.lat, p.lng]);
    if (points.length === 0) return;
    fittedRef.current = fitKey;
    mapRef.current.fitBounds(L.latLngBounds(points), { padding: [48, 48], maxZoom: 15 });
  }, [fitKey, markers, pins, lines]);

  useEffect(() => {
    if (follow) mapRef.current.panTo([follow.lat, follow.lng], { animate: true });
  }, [follow?.lat, follow?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={containerRef} className="absolute inset-0 z-0" />;
}

/* ---------------------------------------------------------------------- */
/*  Datos en vivo                                                         */
/* ---------------------------------------------------------------------- */

let channelSeq = 0;

// Última posición de cada unidad; se actualiza sola en tiempo real.
function useLivePositions() {
  const [positions, setPositions] = useState({});
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("vehicle_positions")
      .select("*")
      .then(({ data }) => {
        if (!cancelled && data) setPositions(Object.fromEntries(data.map((p) => [p.vehicleId, p])));
      });
    const channel = supabase
      .channel(`live-positions-${++channelSeq}`)
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

// Rutas abiertas de la empresa: quién maneja cada unidad en este momento.
function useActiveRoutes() {
  const [routes, setRoutes] = useState([]);
  const load = useCallback(() => {
    supabase
      .from("routes")
      .select("*")
      .eq("status", "active")
      .order("startedAt", { ascending: false })
      .then(({ data }) => data && setRoutes(data));
  }, []);
  useEffect(() => {
    load();
    const channel = supabase
      .channel(`live-routes-${++channelSeq}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "routes" }, load)
      .subscribe();
    window.addEventListener("navio:trips-changed", load);
    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener("navio:trips-changed", load);
    };
  }, [load]);
  return { routes, reload: load };
}

// El estado de "sin señal" depende del reloj: se recalcula cada medio minuto.
function useClockTick(ms = 30000) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((n) => n + 1), ms);
    return () => window.clearInterval(timer);
  }, [ms]);
  return tick;
}

export async function loadRoutePoints(routeId) {
  const { data } = await supabase
    .from("route_points")
    .select("lat, lng, speed, recordedAt")
    .eq("routeId", routeId)
    .order("recordedAt", { ascending: true })
    .limit(5000);
  return data ?? [];
}

export function routeSummary(route) {
  if (!route) return [];
  const end = route.endedAt ? new Date(route.endedAt).getTime() : Date.now();
  const ms = end - new Date(route.startedAt).getTime();
  const km = Number(route.distanceKm) || 0;
  const hours = ms / 3600000;
  return [
    ["Distancia", formatKm(km)],
    ["Duración", formatDuration(ms)],
    ["Velocidad media", hours > 0.01 && km > 0 ? `${Math.round(km / hours)} km/h` : "—"],
    ["Velocidad máxima", route.maxSpeed ? `${Math.round(route.maxSpeed)} km/h` : "—"],
  ];
}

// El recorrido de una ruta ya guardada, con inicio (A) y fin (B).
export function RouteMap({ routeId, live = false, className = "h-72" }) {
  const [points, setPoints] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setPoints(null);
    loadRoutePoints(routeId).then((data) => !cancelled && setPoints(data));
    return () => {
      cancelled = true;
    };
  }, [routeId]);
  const lines = useMemo(() => (points ? [{ id: "route", points }] : []), [points]);
  const pins = useMemo(() => {
    if (!points || points.length === 0) return [];
    const first = points[0];
    const last = points[points.length - 1];
    return [
      { id: "a", lat: first.lat, lng: first.lng, text: "A", color: "#10b981" },
      { id: "b", lat: last.lat, lng: last.lng, text: live ? "●" : "B", color: live ? "#2563eb" : "#e11d48" },
    ];
  }, [points, live]);
  return (
    <div className={`relative overflow-hidden rounded-xl border border-slate-200 ${className}`}>
      <MapView lines={lines} pins={pins} fitKey={points ? `${routeId}:${points.length}` : undefined} />
      {points === null && <p className="absolute inset-x-0 top-3 z-10 text-center text-[11px] font-semibold text-slate-500">Cargando recorrido…</p>}
      {points?.length === 0 && (
        <p className="absolute inset-x-0 top-3 z-10 mx-auto w-fit rounded-full bg-white/95 px-3 py-1.5 text-[11px] font-semibold text-slate-500 shadow">
          Este viaje no registró ubicación.
        </p>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Mapa en vivo                                                          */
/* ---------------------------------------------------------------------- */

function RouteHistory({ vehicle, selectedId, onSelect }) {
  const [routes, setRoutes] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setRoutes(null);
    supabase
      .from("routes")
      .select("*")
      .eq("vehicleId", vehicle.id)
      .eq("status", "completed")
      .order("startedAt", { ascending: false })
      .limit(20)
      .then(({ data }) => !cancelled && setRoutes(data ?? []));
    return () => {
      cancelled = true;
    };
  }, [vehicle.id]);

  return (
    <div>
      <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Recorridos anteriores</h4>
      {routes === null && <p className="text-xs text-slate-400">Cargando…</p>}
      {routes?.length === 0 && <p className="text-xs text-slate-400">Esta unidad todavía no tiene recorridos guardados.</p>}
      <div className="space-y-1.5">
        {routes?.map((r) => (
          <button
            key={r.id}
            onClick={() => onSelect(selectedId === r.id ? null : r)}
            className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-xs transition ${
              selectedId === r.id ? "border-blue-300 bg-blue-50" : "border-slate-200 hover:border-blue-200"
            }`}
          >
            <span className="min-w-0">
              <span className="block truncate font-semibold text-slate-700">
                {new Date(r.startedAt).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}
              </span>
              <span className="block truncate text-[11px] text-slate-400">{r.driverName || "Conductor sin nombre"}</span>
            </span>
            <span className="shrink-0 text-right text-[11px] text-slate-500">
              <b className="block text-slate-700">{formatKm(r.distanceKm)}</b>
              {r.endedAt ? formatDuration(new Date(r.endedAt) - new Date(r.startedAt)) : ""}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function LiveMapPage({ vehicles, trips = [], isAdmin, onSelectVehicle }) {
  const { showToast } = useToast();
  const tracking = useTracking();
  const positions = useLivePositions();
  const { routes: activeRoutes, reload: reloadRoutes } = useActiveRoutes();
  const tick = useClockTick();
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [following, setFollowing] = useState(true);
  const [trail, setTrail] = useState([]); // recorrido del viaje en curso de la unidad elegida
  const [pastRoute, setPastRoute] = useState(null);
  const [pastPoints, setPastPoints] = useState([]);
  const [driverOpen, setDriverOpen] = useState(false);
  const [fitKey, setFitKey] = useState(0);

  const fleet = useMemo(
    () =>
      vehicles.map((v) => {
        const position = positions[v.id] ?? null;
        const route = activeRoutes.find((r) => r.vehicleId === v.id) ?? null;
        return { ...v, position, route, trip: route?.tripId ? trips.find((t) => t.id === route.tripId) ?? null : null, gpsStatus: computeVehicleStatus(position) };
      }),
    // "tick" vuelve a calcular quién quedó sin señal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vehicles, positions, activeRoutes, trips, tick]
  );
  const counts = useMemo(() => {
    const c = { all: fleet.length, moving: 0, stopped: 0, offline: 0 };
    for (const v of fleet) c[v.gpsStatus] += 1;
    return c;
  }, [fleet]);
  const listed = statusFilter === "all" ? fleet : fleet.filter((v) => v.gpsStatus === statusFilter);
  const selected = fleet.find((v) => v.id === selectedId) ?? null;
  const selectedRouteId = selected?.route?.id ?? null;

  // Recorrido del viaje en curso: se carga al elegir la unidad...
  useEffect(() => {
    let cancelled = false;
    setTrail([]);
    if (selectedRouteId) loadRoutePoints(selectedRouteId).then((data) => !cancelled && setTrail(data));
    return () => {
      cancelled = true;
    };
  }, [selectedRouteId]);

  // ...y se alarga con cada posición nueva que llega.
  const livePosition = selected?.position ?? null;
  useEffect(() => {
    if (!livePosition || livePosition.routeId !== selectedRouteId) return;
    setTrail((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.lat === livePosition.lat && last.lng === livePosition.lng) return prev;
      return [...prev, { lat: livePosition.lat, lng: livePosition.lng, recordedAt: livePosition.recordedAt }];
    });
  }, [livePosition?.lat, livePosition?.lng, livePosition?.routeId, selectedRouteId]); // eslint-disable-line react-hooks/exhaustive-deps

  const markers = useMemo(
    () =>
      fleet
        .filter((v) => v.position && (statusFilter === "all" || v.gpsStatus === statusFilter || v.id === selectedId))
        .map((v) => ({ id: v.id, lat: v.position.lat, lng: v.position.lng, color: MAP_COLORS[v.gpsStatus], label: v.unit, selected: v.id === selectedId })),
    [fleet, statusFilter, selectedId]
  );
  const lines = useMemo(() => {
    if (pastRoute) return [{ id: `past-${pastRoute.id}`, points: pastPoints, color: "#7c3aed" }];
    return trail.length > 1 ? [{ id: "trail", points: trail, color: "#2563eb" }] : [];
  }, [pastRoute, pastPoints, trail]);
  const pins = useMemo(() => {
    if (!pastRoute || pastPoints.length === 0) return [];
    const first = pastPoints[0];
    const last = pastPoints[pastPoints.length - 1];
    return [
      { id: "a", lat: first.lat, lng: first.lng, text: "A", color: "#10b981" },
      { id: "b", lat: last.lat, lng: last.lng, text: "B", color: "#e11d48" },
    ];
  }, [pastRoute, pastPoints]);

  function selectVehicle(id) {
    setSelectedId(id);
    setPastRoute(null);
    setPastPoints([]);
    setFollowing(true);
  }

  async function selectPastRoute(route) {
    setPastRoute(route);
    setPastPoints([]);
    if (!route) return;
    setFollowing(false);
    const points = await loadRoutePoints(route.id);
    setPastPoints(points);
    setFitKey((k) => k + 1);
  }

  async function finishStaleRoute(route) {
    const { error } = await supabase.rpc("finish_route", { target_route: route.id, complete_trip: false });
    if (error) showToast(`No se pudo cerrar la ruta: ${error.message}`);
    else {
      showToast("Ruta cerrada.");
      reloadRoutes();
    }
  }

  const follow = following && !pastRoute && selected?.position ? selected.position : null;
  const withSignal = fleet.filter((v) => v.position).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Mapa en vivo</h1>
          <p className="mt-1 text-sm text-slate-500">Dónde está cada unidad y el recorrido de sus viajes, en tiempo real.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> Tiempo real
          </span>
          <button
            onClick={() => setFitKey((k) => k + 1)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            <LocateFixed size={14} /> Ver toda la flota
          </button>
          <button
            onClick={() => setDriverOpen(true)}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
          >
            <Navigation size={14} /> {tracking?.active ? "Mi viaje en curso" : "Modo conductor"}
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
            {f.label} <b className={statusFilter === f.id ? "text-blue-100" : "text-slate-400"}>{counts[f.id]}</b>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="relative h-[60vh] min-h-[420px] overflow-hidden rounded-2xl border border-slate-200 shadow-sm">
          <MapView markers={markers} lines={lines} pins={pins} fitKey={withSignal > 0 ? fitKey : undefined} follow={follow} onSelectMarker={selectVehicle} />
          {withSignal === 0 && (
            <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center px-3">
              <span className="rounded-full bg-white/95 px-3 py-1.5 text-center text-[11px] font-semibold text-slate-500 shadow-md">
                Ninguna unidad ha compartido su ubicación todavía. Inicia un viaje desde el celular o con "Modo conductor".
              </span>
            </div>
          )}
          <div className="absolute bottom-4 left-4 z-10 flex flex-wrap items-center gap-3 rounded-xl bg-white/95 px-3 py-2 text-[11px] font-medium text-slate-500 shadow-md">
            {Object.entries(LIVE_MAP_STATUS_STYLES).map(([key, s]) => (
              <span key={key} className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: MAP_COLORS[key] }} /> {s.label}
              </span>
            ))}
          </div>
        </div>

        <div className="max-h-[60vh] min-h-0 space-y-2 overflow-y-auto lg:min-h-[420px]">
          {selected ? (
            <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-bold text-slate-800">
                    {selected.unit} <span className="font-medium text-slate-400">· {selected.plate}</span>
                  </h3>
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: MAP_COLORS[selected.gpsStatus] }} />
                    {GPS_STATUS_STYLES[selected.gpsStatus].label}
                    {selected.position && ` · ${timeAgoLabel(selected.position.recordedAt)}`}
                  </p>
                </div>
                <button onClick={() => selectVehicle(null)} aria-label="Cerrar" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
                  <X size={14} />
                </button>
              </div>

              {selected.route ? (
                <div className="space-y-2 rounded-xl bg-blue-50 p-3 text-xs text-blue-900">
                  <p className="flex items-center gap-1.5 font-semibold">
                    <User size={13} /> {selected.route.driverName || "Conductor sin nombre"}
                  </p>
                  {selected.trip && (
                    <p className="flex items-center gap-1.5">
                      <Route size={13} className="shrink-0" /> {selected.trip.origin} → {selected.trip.destination}
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    {[
                      ["Velocidad", selected.position?.speed != null ? `${Math.round(selected.position.speed)} km/h` : "—"],
                      ["Recorrido", formatKm(selected.route.distanceKm)],
                      ["En viaje", formatDuration(Date.now() - new Date(selected.route.startedAt).getTime())],
                      ["Salió", new Date(selected.route.startedAt).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <p className="text-[11px] text-blue-600">{label}</p>
                        <p className="text-sm font-bold">{value}</p>
                      </div>
                    ))}
                  </div>
                  {isAdmin && selected.gpsStatus === "offline" && (
                    <button
                      onClick={() => finishStaleRoute(selected.route)}
                      className="w-full rounded-lg border border-blue-200 bg-white py-1.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
                    >
                      Cerrar esta ruta (sin señal)
                    </button>
                  )}
                </div>
              ) : (
                <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  Sin viaje en curso. {vehicleDriverLabel(selected) !== "Sin asignar" && `Chofer: ${vehicleDriverLabel(selected)}.`}
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                {selected.position && !pastRoute && (
                  <button
                    onClick={() => setFollowing((f) => !f)}
                    aria-pressed={following}
                    className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ${
                      following ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <LocateFixed size={12} /> {following ? "Siguiendo" : "Seguir"}
                  </button>
                )}
                <button
                  onClick={() => onSelectVehicle(selected.id)}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                >
                  <Truck size={12} /> Ver expediente
                </button>
              </div>

              {pastRoute && (
                <div className="grid grid-cols-2 gap-2 rounded-xl bg-violet-50 p-3 text-xs text-violet-900">
                  {routeSummary(pastRoute).map(([label, value]) => (
                    <div key={label}>
                      <p className="text-[11px] text-violet-600">{label}</p>
                      <p className="text-sm font-bold">{value}</p>
                    </div>
                  ))}
                </div>
              )}

              <RouteHistory vehicle={selected} selectedId={pastRoute?.id ?? null} onSelect={selectPastRoute} />
            </div>
          ) : (
            <>
              {listed.map((v) => (
                <button
                  key={v.id}
                  onClick={() => selectVehicle(v.id)}
                  className="block w-full rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-blue-300"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-xs font-bold text-slate-800">
                      {v.unit} <span className="font-medium text-slate-400">· {v.plate}</span>
                    </p>
                    <span className="flex shrink-0 items-center gap-1 text-[10px] font-semibold text-slate-500">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: MAP_COLORS[v.gpsStatus] }} /> {GPS_STATUS_STYLES[v.gpsStatus].label}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                    {v.route ? (
                      <span className="flex items-center gap-1 font-semibold text-blue-700">
                        <Navigation size={11} /> {v.route.driverName || "En viaje"}
                        {v.trip ? ` → ${v.trip.destination}` : ""}
                      </span>
                    ) : (
                      <span>Sin viaje en curso</span>
                    )}
                    {v.position && (
                      <>
                        <span className="flex items-center gap-1">
                          <Gauge size={11} /> {v.position.speed != null ? `${Math.round(v.position.speed)} km/h` : "—"}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock size={11} /> {timeAgoLabel(v.position.recordedAt)}
                        </span>
                      </>
                    )}
                  </div>
                </button>
              ))}
              {listed.length === 0 && <p className="py-8 text-center text-xs text-slate-400">Sin unidades en este filtro.</p>}
            </>
          )}
        </div>
      </div>

      {driverOpen && <DriverModeModal vehicles={vehicles} trips={trips} onClose={() => setDriverOpen(false)} />}
    </div>
  );
}
