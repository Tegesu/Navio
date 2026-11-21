import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import L from "leaflet";
import { ArrowUpDown, Car, Clock, Crosshair, Flag, History, LocateFixed, MapPin, Navigation, Plus, Route, Search, Truck, X } from "lucide-react";
import { useAuth, useToast, profileCan } from "./NavioDashboard.jsx";
import { usePermissionGate, geoProblem } from "./permissions.jsx";
import { useBackLayer } from "./history.js";
import { addBaseLayer, hasTomTom, searchPlaces, placeName, planRoutes, durationText } from "./maps.js";
import { savePlan, readPlan, thinPoints } from "./routeplanner.jsx";
import { useTracking, TrackingLiveCard, TrackingError, TrackingModeNote, OrphanRouteNotice, ANDROID_APP_URL, formatKm } from "./tracking.jsx";

/* ---------------------------------------------------------------------- */
/*  Teléfono — Viaje: el mapa completo, la ruta y el botón para salir      */
/* ---------------------------------------------------------------------- */
// Primero solo el mapa. Arriba, una barra flotante con la salida y el
// destino; abajo, "Iniciar viaje", que abre un menú para elegir la unidad y
// si el viaje es directo o con paradas estimadas.

const MAX_STOPS = 5;
const clock = (d) => d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });

// Una ruta pasando por varios puntos: se pide tramo por tramo y se suman.
async function planVia(points, mode) {
  if (points.length === 2) {
    const [best] = await planRoutes(points[0], points[1], mode);
    return best ? { ...best, legs: [{ minutes: best.minutes, km: best.km }] } : null;
  }
  const legs = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const [best] = await planRoutes(points[i], points[i + 1], mode);
    if (!best) return null;
    legs.push(best);
  }
  return {
    id: 0,
    km: legs.reduce((s, l) => s + l.km, 0),
    minutes: legs.reduce((s, l) => s + l.minutes, 0),
    delayMinutes: legs.reduce((s, l) => s + (l.delayMinutes || 0), 0),
    arrival: null,
    points: legs.flatMap((l) => l.points),
    legs: legs.map((l) => ({ minutes: l.minutes, km: l.km })),
  };
}

/* ---------- Mapa ---------- */
const dotIcon = (color, ring = false) => {
  const el = document.createElement("div");
  el.style.cssText = `transform:translate(-50%,-50%);width:16px;height:16px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 0 0 ${ring ? "6px rgba(37,99,235,.25)" : "1px rgba(0,0,0,.25)"},0 1px 4px rgba(0,0,0,.35)`;
  return L.divIcon({ className: "", html: el, iconSize: [16, 16], iconAnchor: [0, 0] });
};
const pinIcon = (text, color) => {
  const el = document.createElement("div");
  el.style.cssText = `transform:translate(-50%,-100%);width:28px;height:28px;border-radius:50% 50% 50% 0;rotate:-45deg;background:${color};border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center`;
  const span = document.createElement("span");
  span.textContent = text;
  span.style.cssText = "rotate:45deg;color:#fff;font:700 12px system-ui,sans-serif";
  el.append(span);
  return L.divIcon({ className: "", html: el, iconSize: [28, 28], iconAnchor: [0, 0] });
};

function TripMap({ me, from, to, stops, routePoints, follow, picking, onPick, onUserMove, recenterKey }) {
  const box = useRef(null);
  const map = useRef(null);
  const layers = useRef(null);
  const meLayer = useRef(null);
  const fitted = useRef("");
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const pickingRef = useRef(picking);
  pickingRef.current = picking;
  const moveRef = useRef(onUserMove);
  moveRef.current = onUserMove;

  useEffect(() => {
    const m = L.map(box.current, { zoomControl: false, attributionControl: true }).setView([23.6345, -102.5528], 5);
    addBaseLayer(m, box.current);
    layers.current = L.layerGroup().addTo(m);
    m.on("click", (e) => pickingRef.current && pickRef.current({ lat: e.latlng.lat, lng: e.latlng.lng }));
    m.on("dragstart", () => moveRef.current?.());
    map.current = m;
    const observer = new ResizeObserver(() => m.invalidateSize());
    observer.observe(box.current);
    return () => {
      observer.disconnect();
      m.remove();
    };
  }, []);

  // Salida, paradas, destino y la ruta.
  useEffect(() => {
    const group = layers.current;
    group.clearLayers();
    const bounds = [];
    if (routePoints?.length) {
      const latlngs = routePoints.map((p) => [p.lat, p.lng]);
      L.polyline(latlngs, { color: "#ffffff", weight: 9, opacity: 0.9 }).addTo(group);
      L.polyline(latlngs, { color: "#2563eb", weight: 5, opacity: 0.95 }).addTo(group);
      latlngs.forEach((p) => bounds.push(p));
    }
    if (from && from.label !== "Mi ubicación") {
      L.marker([from.lat, from.lng], { icon: pinIcon("A", "#10b981"), interactive: false }).addTo(group);
      bounds.push([from.lat, from.lng]);
    } else if (from) bounds.push([from.lat, from.lng]);
    (stops ?? []).forEach((s, i) => {
      L.marker([s.lat, s.lng], { icon: pinIcon(String(i + 1), "#f59e0b"), interactive: false }).addTo(group);
      bounds.push([s.lat, s.lng]);
    });
    if (to) {
      L.marker([to.lat, to.lng], { icon: pinIcon("B", "#e11d48"), interactive: false }).addTo(group);
      bounds.push([to.lat, to.lng]);
    }
    const key = bounds.map((b) => b.join(",")).join("|").slice(0, 400);
    if (bounds.length > 1 && key !== fitted.current) {
      fitted.current = key;
      map.current.fitBounds(L.latLngBounds(bounds), { paddingTopLeft: [24, 150], paddingBottomRight: [24, 190], maxZoom: 15 });
    } else if (bounds.length === 1 && key !== fitted.current) {
      fitted.current = key;
      map.current.setView(bounds[0], 14);
    }
  }, [from, to, stops, routePoints]);

  // Mi ubicación (punto azul) y, si se sigue, el mapa centrado en ella.
  useEffect(() => {
    if (!me) return;
    if (!meLayer.current) meLayer.current = L.marker([me.lat, me.lng], { icon: dotIcon("#2563eb", true), interactive: false, zIndexOffset: 1000 }).addTo(map.current);
    else meLayer.current.setLatLng([me.lat, me.lng]);
    if (follow) map.current.setView([me.lat, me.lng], Math.max(map.current.getZoom(), 15), { animate: true });
  }, [me, follow]);

  useEffect(() => {
    if (!recenterKey || !me) return;
    map.current.setView([me.lat, me.lng], 15, { animate: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterKey]);

  // La clase del contenedor de Leaflet no se toca (React le borraría las de
  // Leaflet y el mapa se vería gris): el cursor va en una envoltura.
  return (
    <div className={`absolute inset-0 z-0 ${picking ? "[&_.leaflet-container]:cursor-crosshair" : ""}`}>
      <div ref={box} className="absolute inset-0" />
    </div>
  );
}

/* ---------- Buscar un lugar ---------- */
// { results, state: idle | loading | done | error, error }
function usePlaceSearch(text, near) {
  const [found, setFound] = useState({ results: [], state: "idle", error: "" });
  const nearKey = near ? `${near.lat.toFixed(2)},${near.lng.toFixed(2)}` : "";
  useEffect(() => {
    if (text.trim().length < 3) {
      setFound({ results: [], state: "idle", error: "" });
      return undefined;
    }
    let alive = true;
    setFound((prev) => ({ ...prev, state: "loading", error: "" }));
    const timer = window.setTimeout(() => {
      searchPlaces(text, near).then(
        (results) => alive && setFound({ results, state: "done", error: "" }),
        (err) => alive && setFound({ results: [], state: "error", error: err?.message || "No se pudo buscar." })
      );
    }, 350);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, nearKey]);
  return found;
}

function PlaceRow({ icon, placeholder, value, onChange, near, onPickOnMap, picking, mine = null, autoFocus = false }) {
  const [editing, setEditing] = useState(autoFocus);
  const [text, setText] = useState("");
  const found = usePlaceSearch(editing ? text : "", near);
  const results = found.results;
  const close = () => {
    setEditing(false);
    setText("");
  };
  return (
    <div className="relative">
      <div className="flex items-center gap-2.5 px-2">
        <span className="flex w-4 shrink-0 justify-center">{icon}</span>
        {editing ? (
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => window.setTimeout(close, 200)}
            placeholder={hasTomTom() ? placeholder : "Elige el punto en el mapa"}
            disabled={!hasTomTom()}
            aria-label={placeholder}
            className="h-10 min-w-0 flex-1 bg-transparent text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
          />
        ) : (
          <button type="button" onClick={() => setEditing(true)} className={`h-10 min-w-0 flex-1 truncate text-left text-sm ${value ? "font-medium text-slate-800" : "text-slate-400"}`}>
            {value?.label ?? placeholder}
          </button>
        )}
        {value && !editing && (
          <button type="button" onClick={() => onChange(null)} aria-label={`Quitar ${placeholder.toLowerCase()}`} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100">
            <X size={14} />
          </button>
        )}
      </div>
      {editing && (
        <div className="absolute inset-x-0 top-full z-10 mt-2 max-h-[45dvh] overflow-y-auto rounded-2xl bg-white p-1 shadow-xl ring-1 ring-slate-200">
          {mine && (
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => (mine(), close())} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-blue-600 hover:bg-slate-50">
              <LocateFixed size={15} /> Mi ubicación
            </button>
          )}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onPickOnMap();
              close();
            }}
            className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold hover:bg-slate-50 ${picking ? "text-blue-600" : "text-slate-600"}`}
          >
            <Crosshair size={15} /> Elegir en el mapa
          </button>
          {results.map((r, i) => (
            <button
              key={`${r.lat},${r.lng},${i}`}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(r);
                close();
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              <MapPin size={15} className="shrink-0 text-slate-400" />
              <span className="min-w-0 flex-1 truncate">{r.label}</span>
            </button>
          ))}
          {found.state === "loading" && <p className="px-3 py-2 text-xs text-slate-400">Buscando…</p>}
          {found.state === "done" && results.length === 0 && <p className="px-3 py-2 text-xs text-slate-400">Sin resultados. Prueba con otro nombre o elige el punto en el mapa.</p>}
          {found.state === "error" && <p className="px-3 py-2 text-xs font-medium text-rose-600">No se pudo buscar: {found.error}</p>}
          {text.trim().length > 0 && text.trim().length < 3 && <p className="px-3 py-2 text-xs text-slate-400">Escribe al menos 3 letras.</p>}
        </div>
      )}
    </div>
  );
}

/* ---------- Ventana que sube desde abajo ---------- */
function Sheet({ title, onClose, children }) {
  useBackLayer(true, onClose);
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end bg-slate-900/40" onClick={onClose}>
      <div
        className="max-h-[88dvh] w-full overflow-y-auto rounded-t-3xl bg-white px-4 pt-2 shadow-2xl"
        style={{ paddingBottom: "max(1rem, var(--safe-bottom))" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-slate-200" />
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-800">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100">
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

/* ---------- La pantalla ---------- */
export function TripMapScreen({ vehicles, trips = [], onShowHistory }) {
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const tracking = useTracking();
  const geo = usePermissionGate("geolocation");
  const [me, setMe] = useState(null);
  const [from, setFrom] = useState(null);
  const [to, setTo] = useState(null);
  const [stops, setStops] = useState([]);
  const [tripType, setTripType] = useState("direct"); // direct | stops
  const [mode, setMode] = useState("car");
  const [route, setRoute] = useState(null);
  const [routeState, setRouteState] = useState("idle"); // idle | loading | error
  const [routeError, setRouteError] = useState("");
  const [picking, setPicking] = useState(null); // "from" | "to" | "stop"
  const [follow, setFollow] = useState(true);
  const [recenter, setRecenter] = useState(0);
  const [sheet, setSheet] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [locating, setLocating] = useState(false);

  // Traslados que la persona puede tomar y la unidad.
  const supervisor = profileCan(profile, "supervisor");
  const openTrips = trips.filter((t) => ["scheduled", "ongoing"].includes(t.status) && (supervisor || !t.assignedTo || t.assignedTo === user?.id));
  const [choice, setChoice] = useState("free");
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? null);
  const canUseTracker = !tracking.native && !!tracking.tracker;
  const [source, setSource] = useState("tracker");
  const chosenSource = canUseTracker ? source : "phone";
  const chosenTrip = choice.startsWith("trip:") ? openTrips.find((t) => `trip:${t.id}` === choice) : null;
  const tripVehicle = chosenTrip ? vehicles.find((v) => v.id === chosenTrip.vehicleId) ?? vehicles.find((v) => v.unit === chosenTrip.unit) : null;
  const vehicle = chosenTrip ? tripVehicle : vehicles.find((v) => v.id === vehicleId);
  const busy = tracking.status === "starting" || tracking.status === "stopping";
  useEffect(() => {
    if (vehicleId == null && vehicles[0]) setVehicleId(vehicles[0].id);
  }, [vehicles, vehicleId]);

  // Mi ubicación: al abrir (si ya hay permiso) o al tocar el botón.
  function readLocation({ quiet = false, asOrigin = false } = {}) {
    if (!navigator.geolocation) return;
    setLocating(true);
    const done = (pos) => {
      const here = { label: "Mi ubicación", lat: pos.coords.latitude, lng: pos.coords.longitude };
      setLocating(false);
      setMe(here);
      setFrom((prev) => (asOrigin || !prev || prev.label === "Mi ubicación" ? here : prev));
      setFollow(true);
      setRecenter((n) => n + 1);
    };
    const failed = (err) => {
      setLocating(false);
      if (quiet && err?.code !== 1) return;
      geo.explain(geoProblem(err), () => readLocation({ asOrigin }));
    };
    navigator.geolocation.getCurrentPosition(
      done,
      (err) => {
        if (err?.code === 1) return failed(err);
        navigator.geolocation.getCurrentPosition(done, failed, { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }
  const locate = (asOrigin = false) => geo.run(() => readLocation({ asOrigin }));
  useEffect(() => {
    if (geo.state === "granted" && !me) readLocation({ quiet: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo.state]);
  // Durante el viaje, la posición la da el registro.
  useEffect(() => {
    if (tracking.active && tracking.lastFix) setMe({ label: "Mi ubicación", lat: tracking.lastFix.lat, lng: tracking.lastFix.lng });
  }, [tracking.active, tracking.lastFix]);

  // La ruta: directa, o pasando por las paradas.
  const usedStops = tripType === "stops" ? stops : [];
  const stopsKey = usedStops.map((s) => `${s.lat},${s.lng}`).join("|");
  useEffect(() => {
    let alive = true;
    setRoute(null);
    if (!from || !to || !hasTomTom()) {
      setRouteState("idle");
      return undefined;
    }
    setRouteState("loading");
    setRouteError("");
    planVia([from, ...usedStops, to], mode)
      .then((r) => {
        if (!alive) return;
        setRoute(r);
        setRouteState(r ? "idle" : "error");
        if (!r) setRouteError("No se encontró una ruta entre esos puntos.");
      })
      .catch((err) => {
        if (!alive) return;
        setRouteState("error");
        setRouteError(err?.message || "No se pudo calcular la ruta.");
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from?.lat, from?.lng, to?.lat, to?.lng, stopsKey, mode]);

  async function pickOnMap(point) {
    const target = picking;
    setPicking(null);
    const place = { ...point, label: "Buscando dirección…" };
    const apply = (p) => {
      if (target === "from") setFrom(p);
      else if (target === "to") setTo(p);
      else setStops((prev) => {
        const i = prev.findIndex((s) => s.pending);
        return i < 0 ? [...prev, p].slice(0, MAX_STOPS) : prev.map((s, j) => (j === i ? p : s));
      });
    };
    apply({ ...place, pending: target === "stop" });
    const label = await placeName(point);
    if (target === "stop") {
      setStops((prev) => prev.map((s) => (s.pending ? { ...point, label } : s)));
      setSheet(true);
    } else apply({ ...point, label });
  }

  function swap() {
    setFrom(to);
    setTo(from);
  }

  // Llegada estimada a cada parada (si se sale ahora).
  const etas = useMemo(() => {
    if (!route?.legs?.length) return [];
    let acc = 0;
    return route.legs.map((l) => {
      acc += l.minutes;
      return new Date(Date.now() + acc * 60000);
    });
  }, [route]);
  const arrival = route ? new Date(Date.now() + route.minutes * 60000) : null;

  async function start() {
    if (!vehicle) return;
    if (!tracking.consent) tracking.giveConsent();
    savePlan(
      route
        ? {
            from: from?.label ?? "",
            to: to?.label ?? "",
            km: route.km,
            minutes: route.minutes,
            delayMinutes: route.delayMinutes,
            arrival: arrival.toISOString(),
            points: thinPoints(route.points),
            destination: to ? { lat: to.lat, lng: to.lng } : null,
            stops: usedStops.map((s, i) => ({ label: s.label, lat: s.lat, lng: s.lng, eta: etas[i]?.toISOString() ?? null })),
          }
        : to
        ? { from: from?.label ?? "", to: to.label, points: [], destination: { lat: to.lat, lng: to.lng }, stops: usedStops.map((s) => ({ label: s.label, lat: s.lat, lng: s.lng })) }
        : null
    );
    const ok = await tracking.start({ vehicleId: vehicle.id, tripId: chosenTrip?.id ?? null, unit: vehicle.unit, source: chosenSource });
    if (ok !== false) {
      setSheet(false);
      setFollow(true);
    }
  }
  const handleStart = () => geo.run(start);

  async function finish() {
    setConfirming(false);
    savePlan(null);
    const saved = await tracking.stop();
    if (saved) showToast(`Viaje guardado: ${formatKm(saved.distanceKm)} recorridos.`);
  }

  // ---- Viaje en curso ----
  const active = !!tracking.active;
  const plan = active ? readPlan() : null;
  const shownFrom = active ? null : from;
  const shownTo = active ? (plan?.destination ? { ...plan.destination, label: plan.to } : null) : to;
  const shownStops = active ? (plan?.stops ?? []) : usedStops.filter((s) => !s.pending);
  const shownRoute = active ? plan?.points ?? null : route?.points ?? null;
  const bottomOffset = "calc(max(6px, var(--safe-bottom) - 6px) + 82px)";

  return (
    <div className="trip-screen overflow-hidden bg-slate-100">
      <TripMap
        me={me}
        from={shownFrom}
        to={shownTo}
        stops={shownStops}
        routePoints={shownRoute}
        follow={follow && (active || (!from && !to))}
        picking={picking}
        onPick={pickOnMap}
        onUserMove={() => setFollow(false)}
        recenterKey={recenter}
      />

      {/* Arriba: salida y destino (o el viaje en curso) */}
      <div className="absolute inset-x-3 top-3 z-[500]">
        {active ? (
          <div className="rounded-2xl bg-white/95 p-3 shadow-xl ring-1 ring-slate-200 backdrop-blur">
            <p className="flex items-center gap-2 text-sm font-bold text-slate-800">
              <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-emerald-500" />
              <span className="truncate">{plan?.to ? `Hacia ${plan.to}` : `Viaje en curso${tracking.active.unit ? ` · ${tracking.active.unit}` : ""}`}</span>
            </p>
            {plan?.arrival && (
              <p className="mt-0.5 text-[11px] text-slate-500">
                Llegada estimada {clock(new Date(plan.arrival))}
                {plan.km ? ` · ${Math.round(plan.km)} km` : ""}
                {plan.stops?.length ? ` · ${plan.stops.length} ${plan.stops.length === 1 ? "parada" : "paradas"}` : ""}
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-2xl bg-white/95 py-1 shadow-xl ring-1 ring-slate-200 backdrop-blur">
            <div className="flex items-center">
              <div className="min-w-0 flex-1">
                <PlaceRow
                  icon={<span className="h-3 w-3 rounded-full border-[3px] border-emerald-500" />}
                  placeholder="Punto de salida"
                  value={from}
                  onChange={setFrom}
                  near={to}
                  mine={() => locate(true)}
                  picking={picking === "from"}
                  onPickOnMap={() => setPicking("from")}
                />
                <div className="ml-8 mr-2 border-t border-slate-100" />
                <PlaceRow
                  icon={<MapPin size={16} className="text-rose-500" />}
                  placeholder="¿A dónde vas?"
                  value={to}
                  onChange={setTo}
                  near={from ?? me}
                  picking={picking === "to"}
                  onPickOnMap={() => setPicking("to")}
                />
              </div>
              <button type="button" onClick={swap} disabled={!from && !to} aria-label="Cambiar salida y destino" className="mr-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 disabled:opacity-30">
                <ArrowUpDown size={16} />
              </button>
            </div>
          </div>
        )}
        {picking && (
          <div className="mt-2 flex items-center justify-between gap-2 rounded-xl bg-slate-900/85 px-3 py-2 text-xs font-semibold text-white">
            Toca el mapa para elegir {picking === "from" ? "la salida" : picking === "to" ? "el destino" : "la parada"}
            <button type="button" onClick={() => setPicking(null)} className="rounded-lg bg-white/15 px-2 py-0.5">
              Cancelar
            </button>
          </div>
        )}
      </div>

      {/* Abajo: la ruta y el botón */}
      <div className="absolute inset-x-3 z-[500] space-y-2" style={{ bottom: bottomOffset }}>
        {/* Mi ubicación y mis traslados */}
        <div className="flex justify-end gap-2">
          {!active && onShowHistory && (
            <button type="button" onClick={onShowHistory} aria-label="Mis traslados y viajes" title="Mis traslados y viajes" className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-slate-600 shadow-lg ring-1 ring-slate-200">
              <History size={18} />
            </button>
          )}
          <button
            type="button"
            onClick={() => (me ? (setFollow(true), setRecenter((n) => n + 1)) : locate(false))}
            aria-label="Ir a mi ubicación"
            title="Ir a mi ubicación"
            className={`flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-lg ring-1 ring-slate-200 ${follow && me ? "text-blue-600" : "text-slate-600"}`}
          >
            <LocateFixed size={18} className={locating ? "animate-pulse" : ""} />
          </button>
        </div>
        {active ? (
          <div className="space-y-2 rounded-2xl bg-white/95 p-2.5 shadow-xl ring-1 ring-slate-200 backdrop-blur">
            <TrackingLiveCard />
            <TrackingModeNote />
            <TrackingError />
            {confirming ? (
              <div className="flex gap-2">
                <button type="button" onClick={() => setConfirming(false)} className="flex-1 rounded-xl border border-slate-200 py-3 text-sm font-semibold text-slate-600">
                  Seguir manejando
                </button>
                <button type="button" onClick={finish} disabled={busy} className="flex-1 rounded-xl bg-rose-600 py-3 text-sm font-bold text-white disabled:opacity-60">
                  {busy ? "Guardando…" : "Sí, terminar"}
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirming(true)} disabled={busy} className="w-full rounded-xl bg-rose-600 py-3.5 text-base font-bold text-white shadow-sm disabled:opacity-60">
                Finalizar viaje
              </button>
            )}
          </div>
        ) : (
          <>
            {(route || routeState !== "idle") && (
              <div className="flex items-center gap-2.5 rounded-2xl bg-white/95 px-3 py-2.5 shadow-lg ring-1 ring-slate-200 backdrop-blur">
                <Route size={18} className="shrink-0 text-blue-600" />
                {routeState === "loading" ? (
                  <p className="text-xs text-slate-500">Calculando la ruta con el tráfico de ahora…</p>
                ) : routeState === "error" ? (
                  <p className="text-xs text-slate-500">{routeError || "No se encontró una ruta."} Puedes iniciar el viaje sin ella.</p>
                ) : (
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-slate-800">
                      {durationText(route.minutes)} <span className="text-xs font-medium text-slate-500">· {Math.round(route.km)} km · llegada {clock(arrival)}</span>
                    </p>
                    <p className={`text-[11px] ${route.delayMinutes >= 10 ? "font-semibold text-rose-600" : route.delayMinutes > 0 ? "text-amber-700" : "text-emerald-700"}`}>
                      {route.delayMinutes > 0 ? `+${durationText(route.delayMinutes)} por tráfico` : "Sin retrasos por tráfico"}
                      {usedStops.length ? ` · ${usedStops.length} ${usedStops.length === 1 ? "parada" : "paradas"}` : ""}
                    </p>
                  </div>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={() => setSheet(true)}
              disabled={vehicles.length === 0}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 py-4 text-base font-bold text-white shadow-[0_10px_30px_rgb(var(--bg-blue-600)/0.45)] transition active:scale-[0.98] disabled:opacity-60"
            >
              <Navigation size={18} /> Iniciar viaje
            </button>
            {vehicles.length === 0 && <p className="rounded-xl bg-white/95 px-3 py-1.5 text-center text-[11px] text-slate-500">Primero registra una unidad en Gestión de flota.</p>}
          </>
        )}
      </div>

      {/* Menú para iniciar: unidad y tipo de viaje */}
      {sheet && !active && (
        <Sheet title="Iniciar viaje" onClose={() => setSheet(false)}>
          <div className="space-y-4 pb-2">
            <OrphanRouteNotice vehicles={vehicles} />
            {openTrips.length > 0 && (
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-500" htmlFor="trip-choice">
                  Traslado
                </label>
                <select id="trip-choice" value={choice} onChange={(e) => setChoice(e.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:border-blue-400 focus:outline-none">
                  <option value="free">Viaje libre (sin traslado asignado)</option>
                  {openTrips.map((t) => (
                    <option key={t.id} value={`trip:${t.id}`}>
                      {t.origin} → {t.destination} · {t.unit}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {!chosenTrip ? (
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-500" htmlFor="trip-unit">
                  Unidad
                </label>
                <select id="trip-unit" value={vehicleId ?? ""} onChange={(e) => setVehicleId(Number(e.target.value))} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:border-blue-400 focus:outline-none">
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.unit} — {v.plate}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              !tripVehicle && <p className="text-xs font-medium text-rose-600">La unidad de este traslado ya no existe. Pide que lo corrijan.</p>
            )}

            <div>
              <p className="mb-1.5 text-xs font-semibold text-slate-500">Tipo de viaje</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: "direct", label: "Destino fijo", hint: "Directo al destino", icon: Flag },
                  { id: "stops", label: "Con paradas", hint: "Paradas estimadas en el camino", icon: MapPin },
                ].map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setTripType(o.id)}
                    aria-pressed={tripType === o.id}
                    className={`flex flex-col items-start gap-1 rounded-2xl border p-3 text-left transition ${tripType === o.id ? "border-blue-600 bg-blue-50 ring-1 ring-blue-600" : "border-slate-200 hover:bg-slate-50"}`}
                  >
                    <o.icon size={18} className={tripType === o.id ? "text-blue-600" : "text-slate-400"} />
                    <span className="text-sm font-bold text-slate-800">{o.label}</span>
                    <span className="text-[11px] leading-tight text-slate-500">{o.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            {tripType === "stops" && (
              <div className="space-y-2 rounded-2xl border border-slate-200 p-3">
                <p className="text-xs font-semibold text-slate-500">Paradas (en orden)</p>
                {stops.length === 0 && <p className="text-[11px] text-slate-400">Agrega las paradas que harás antes del destino.</p>}
                {stops.map((s, i) => (
                  <div key={`${s.lat},${s.lng},${i}`} className="flex items-center gap-2.5 rounded-xl bg-slate-50 px-2.5 py-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500 text-[11px] font-bold text-white">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-slate-700">{s.label}</span>
                      {etas[i] && <span className="block text-[10px] text-slate-500">Llegada estimada {clock(etas[i])}</span>}
                    </span>
                    <button type="button" onClick={() => setStops((prev) => prev.filter((_, j) => j !== i))} aria-label={`Quitar parada ${i + 1}`} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200">
                      <X size={13} />
                    </button>
                  </div>
                ))}
                {stops.length < MAX_STOPS && <StopAdder near={to ?? from ?? me} onAdd={(p) => setStops((prev) => [...prev, p].slice(0, MAX_STOPS))} onPickOnMap={() => {
                  setSheet(false);
                  setPicking("stop");
                }} />}
                {!to && <p className="text-[11px] text-amber-700">Elige también el destino final arriba, en el mapa.</p>}
              </div>
            )}

            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold text-slate-500">Ruta para</p>
              <div className="flex rounded-xl border border-slate-200 p-0.5 text-xs font-semibold">
                {[
                  ["car", "Auto o camioneta", Car],
                  ["truck", "Camión", Truck],
                ].map(([id, label, Icon]) => (
                  <button key={id} type="button" onClick={() => setMode(id)} className={`flex items-center gap-1 rounded-lg px-2.5 py-1 ${mode === id ? "bg-blue-600 text-white" : "text-slate-500"}`}>
                    <Icon size={13} /> {label}
                  </button>
                ))}
              </div>
            </div>

            {canUseTracker && (
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-500" htmlFor="trip-source">
                  ¿Con qué se registra el recorrido?
                </label>
                <select id="trip-source" value={source} onChange={(e) => setSource(e.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:border-blue-400 focus:outline-none">
                  <option value="tracker">Con mi app de rastreo (sigue con la pantalla apagada)</option>
                  <option value="phone">Con este navegador (pantalla encendida)</option>
                </select>
              </div>
            )}
            {!tracking.native && chosenSource === "phone" && (
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                En el navegador el registro se pausa si apagas la pantalla o abres otra app.{" "}
                {/android/i.test(navigator.userAgent) ? (
                  <a href={ANDROID_APP_URL} target="_blank" rel="noopener noreferrer" className="font-semibold underline">
                    Con la app de Android sigue en segundo plano.
                  </a>
                ) : (
                  "Para que siga en segundo plano, activa el rastreo en Cuenta → Rastreo."
                )}
              </p>
            )}
            {!tracking.consent && (
              <p className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                Mientras el viaje esté activo, Navio registra la ubicación de este teléfono y la comparte con tu empresa. Se detiene al finalizar el viaje; fuera de un viaje no se registra nada.
              </p>
            )}
            <TrackingError />

            <div className="rounded-2xl bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
              {to ? (
                route ? (
                  <>
                    <b className="text-slate-800">{to.label}</b> · {durationText(route.minutes)} · {Math.round(route.km)} km · llegada {clock(arrival)}
                  </>
                ) : (
                  <>
                    Hacia <b className="text-slate-800">{to.label}</b>
                    {routeState === "loading" ? " · calculando ruta…" : ""}
                  </>
                )
              ) : (
                "Sin destino: se registra el recorrido sin ruta planeada."
              )}
            </div>
            <button type="button" onClick={handleStart} disabled={busy || !vehicle} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 py-4 text-base font-bold text-white shadow-sm disabled:opacity-60">
              <Navigation size={18} /> {tracking.status === "starting" ? "Iniciando…" : tracking.consent ? "Iniciar viaje" : "Aceptar e iniciar viaje"}
            </button>
          </div>
        </Sheet>
      )}
      {geo.sheet}
    </div>
  );
}

// Agregar una parada: escribir el lugar o elegirlo en el mapa.
function StopAdder({ near, onAdd, onPickOnMap }) {
  const [text, setText] = useState("");
  const found = usePlaceSearch(text, near);
  const results = found.results;
  return (
    <div className="relative">
      <div className="flex gap-1.5">
        <div className="relative min-w-0 flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={hasTomTom() ? "Agregar parada" : "Elige la parada en el mapa"}
            disabled={!hasTomTom()}
            aria-label="Agregar parada"
            className="h-10 w-full rounded-xl border border-slate-200 pl-9 pr-2 text-sm focus:border-blue-400 focus:outline-none disabled:bg-slate-50"
          />
        </div>
        <button type="button" onClick={onPickOnMap} className="flex h-10 shrink-0 items-center gap-1 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50">
          <Plus size={13} /> En el mapa
        </button>
      </div>
      {found.state === "error" && <p className="mt-1 text-[11px] font-medium text-rose-600">No se pudo buscar: {found.error}</p>}
      {found.state === "done" && results.length === 0 && <p className="mt-1 text-[11px] text-slate-400">Sin resultados para esa búsqueda.</p>}
      {results.length > 0 && (
        <div className="mt-1 max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
          {results.map((r, i) => (
            <button
              key={`${r.lat},${r.lng},${i}`}
              type="button"
              onClick={() => {
                onAdd(r);
                setText("");
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-slate-700 hover:bg-slate-50"
            >
              <MapPin size={13} className="shrink-0 text-slate-400" />
              <span className="min-w-0 flex-1 truncate">{r.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
