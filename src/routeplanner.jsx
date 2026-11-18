import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { Car, Crosshair, LocateFixed, Lock, MapPin, Search, TrafficCone, Truck, X } from "lucide-react";
import { usePermissionGate } from "./permissions.jsx";
import { addBaseLayer, trafficLayer, hasTomTom, searchPlaces, placeName, planRoutes, durationText } from "./maps.js";

/* ---------------------------------------------------------------------- */
/*  Planear la ruta de un viaje: salida, destino, tráfico y alternativas  */
/* ---------------------------------------------------------------------- */

const ROUTE_COLORS = ["#2563eb", "#64748b", "#94a3b8"];
const PLAN_KEY = "navio.trip.plan";

// La ruta elegida se guarda en este navegador mientras dura el viaje.
export function savePlan(plan) {
  try {
    if (plan) window.sessionStorage.setItem(PLAN_KEY, JSON.stringify(plan));
    else window.sessionStorage.removeItem(PLAN_KEY);
  } catch {
    // Solo es comodidad.
  }
}
export function readPlan() {
  try {
    return JSON.parse(window.sessionStorage.getItem(PLAN_KEY));
  } catch {
    return null;
  }
}

// Menos puntos para guardar y dibujar (uno de cada n).
export function thinPoints(points, max = 400) {
  if (points.length <= max) return points;
  const step = Math.ceil(points.length / max);
  return points.filter((_, i) => i % step === 0 || i === points.length - 1);
}

const pinIcon = (letter, color) => {
  const el = document.createElement("div");
  el.textContent = letter;
  el.style.cssText = `transform:translate(-50%,-100%);width:26px;height:26px;border-radius:50% 50% 50% 0;rotate:-45deg;background:${color};border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center`;
  const span = document.createElement("span");
  span.textContent = letter;
  span.style.cssText = "rotate:45deg;color:#fff;font:700 12px system-ui,sans-serif";
  el.textContent = "";
  el.append(span);
  return L.divIcon({ className: "", html: el, iconSize: [26, 26], iconAnchor: [0, 0] });
};

function PlannerMap({ from, to, routes, selected, traffic, picking, onPick, onSelectRoute }) {
  const box = useRef(null);
  const map = useRef(null);
  const layers = useRef(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const pickingRef = useRef(picking);
  pickingRef.current = picking;
  const selectRef = useRef(onSelectRoute);
  selectRef.current = onSelectRoute;

  useEffect(() => {
    const m = L.map(box.current, { zoomControl: true }).setView([23.6345, -102.5528], 5);
    addBaseLayer(m, box.current);
    layers.current = L.layerGroup().addTo(m);
    m.on("click", (e) => {
      if (pickingRef.current) pickRef.current({ lat: e.latlng.lat, lng: e.latlng.lng });
    });
    map.current = m;
    const observer = new ResizeObserver(() => m.invalidateSize());
    observer.observe(box.current);
    return () => {
      observer.disconnect();
      m.remove();
    };
  }, []);

  useEffect(() => {
    if (!traffic) return undefined;
    const layer = trafficLayer();
    if (!layer) return undefined;
    layer.addTo(map.current);
    return () => layer.remove();
  }, [traffic]);

  useEffect(() => {
    const group = layers.current;
    group.clearLayers();
    const bounds = [];
    // Alternativas primero (debajo) y la elegida encima.
    routes
      .map((r, i) => ({ r, i }))
      .sort((a, b) => (a.i === selected ? 1 : 0) - (b.i === selected ? 1 : 0))
      .forEach(({ r, i }) => {
        const line = L.polyline(
          r.points.map((p) => [p.lat, p.lng]),
          { color: i === selected ? ROUTE_COLORS[0] : ROUTE_COLORS[2], weight: i === selected ? 6 : 4, opacity: i === selected ? 0.95 : 0.7 }
        ).addTo(group);
        line.on("click", () => selectRef.current(i));
        r.points.forEach((p) => bounds.push([p.lat, p.lng]));
      });
    if (from) {
      L.marker([from.lat, from.lng], { icon: pinIcon("A", "#10b981"), interactive: false }).addTo(group);
      bounds.push([from.lat, from.lng]);
    }
    if (to) {
      L.marker([to.lat, to.lng], { icon: pinIcon("B", "#e11d48"), interactive: false }).addTo(group);
      bounds.push([to.lat, to.lng]);
    }
    if (bounds.length === 1) map.current.setView(bounds[0], 14);
    else if (bounds.length > 1) map.current.fitBounds(L.latLngBounds(bounds), { padding: [36, 36], maxZoom: 15 });
  }, [from, to, routes, selected]);

  return (
    <div className="relative h-64 overflow-hidden rounded-2xl border border-slate-200 sm:h-80">
      <div ref={box} className={`absolute inset-0 z-0 ${picking ? "cursor-crosshair" : ""}`} />
      {picking && (
        <p className="pointer-events-none absolute inset-x-2 top-2 z-[500] rounded-xl bg-slate-900/80 px-3 py-1.5 text-center text-[11px] font-semibold text-white">
          Toca el mapa para elegir {picking === "from" ? "la salida" : "el destino"}
        </p>
      )}
    </div>
  );
}

function PlaceField({ label, value, onChange, onPickOnMap, picking, near, extra, locked = null }) {
  const [text, setText] = useState("");
  const [results, setResults] = useState([]);
  const timer = useRef(null);

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (text.trim().length < 3) {
      setResults([]);
      return undefined;
    }
    timer.current = window.setTimeout(() => {
      searchPlaces(text, near).then(setResults, () => setResults([]));
    }, 350);
    return () => window.clearTimeout(timer.current);
  }, [text, near]);

  return (
    <div className="relative">
      <p className="mb-1 text-[11px] font-semibold text-slate-500">{label}</p>
      {locked && !value ? (
        <button type="button" onClick={locked.onClick} className="flex w-full items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-left">
          <Lock size={14} className="shrink-0 text-slate-400" />
          <span className="min-w-0 flex-1 truncate text-xs text-slate-400">{locked.text}</span>
          <span className="shrink-0 text-[11px] font-semibold text-blue-600">Permitir</span>
        </button>
      ) : value ? (
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
          <MapPin size={14} className="shrink-0 text-blue-600" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700">{value.label}</span>
          <button type="button" onClick={() => onChange(null)} aria-label={`Quitar ${label.toLowerCase()}`} className="rounded p-0.5 text-slate-400 hover:bg-slate-100">
            <X size={13} />
          </button>
        </div>
      ) : (
        <div className="flex gap-1.5">
          <div className="relative min-w-0 flex-1">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={hasTomTom() ? "Escribe una dirección o lugar" : "Elige el punto en el mapa"}
              disabled={!hasTomTom()}
              className="h-9 w-full rounded-xl border border-slate-200 pl-8 pr-2 text-xs focus:border-blue-400 focus:outline-none disabled:bg-slate-50"
            />
          </div>
          <button
            type="button"
            onClick={onPickOnMap}
            aria-pressed={picking}
            title="Elegir en el mapa"
            className={`flex h-9 shrink-0 items-center gap-1 rounded-xl border px-2.5 text-[11px] font-semibold ${picking ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
          >
            <Crosshair size={13} /> Mapa
          </button>
          {extra}
        </div>
      )}
      {results.length > 0 && !value && (
        <ul className="absolute inset-x-0 top-full z-[600] mt-1 max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
          {results.map((r, i) => (
            <li key={`${r.lat},${r.lng},${i}`}>
              <button
                type="button"
                onClick={() => {
                  onChange(r);
                  setText("");
                  setResults([]);
                }}
                className="block w-full truncate rounded-lg px-2.5 py-2 text-left text-xs text-slate-700 hover:bg-slate-50"
              >
                {r.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// onChange({ from, to, route }) con la ruta elegida (o null).
export function RoutePlanner({ onChange, initialTo = null }) {
  const [from, setFrom] = useState(null);
  const [to, setTo] = useState(initialTo);
  const [picking, setPicking] = useState(null);
  const [mode, setMode] = useState("car");
  const [routes, setRoutes] = useState([]);
  const [selected, setSelected] = useState(0);
  const [traffic, setTraffic] = useState(false);
  const [state, setState] = useState("idle"); // idle | locating | loading | error
  const [error, setError] = useState("");
  const geo = usePermissionGate("geolocation");

  function readLocation() {
    if (!navigator.geolocation) return;
    setState("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setFrom({ label: "Mi ubicación", lat: pos.coords.latitude, lng: pos.coords.longitude });
        setState("idle");
      },
      () => setState("idle"),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  }
  const useMyLocation = () => geo.run(readLocation);

  // Al abrir, si ya hay permiso, la salida es la ubicación actual.
  useEffect(() => {
    if (geo.state === "granted" && !from) readLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo.state]);

  useEffect(() => {
    let alive = true;
    setRoutes([]);
    setSelected(0);
    setError("");
    if (!from || !to) return undefined;
    if (!hasTomTom()) return undefined;
    setState("loading");
    planRoutes(from, to, mode)
      .then((list) => {
        if (!alive) return;
        setRoutes(list);
        setState("idle");
        if (list.length === 0) setError("No se encontró una ruta entre esos puntos.");
      })
      .catch((err) => {
        if (!alive) return;
        setState("error");
        setError(err.message);
      });
    return () => {
      alive = false;
    };
  }, [from, to, mode]);

  useEffect(() => {
    onChange?.({ from, to, route: routes[selected] ?? null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, routes, selected]);

  async function pick(point) {
    const target = picking;
    setPicking(null);
    const place = { ...point, label: "Buscando dirección…" };
    if (target === "from") setFrom(place);
    else setTo(place);
    const label = await placeName(point);
    if (target === "from") setFrom({ ...point, label });
    else setTo({ ...point, label });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <PlaceField
          label="Salida"
          value={from}
          locked={geo.state !== "granted" ? { text: "Toca para usar tu ubicación", onClick: useMyLocation } : null}
          onChange={setFrom}
          picking={picking === "from"}
          onPickOnMap={() => setPicking((p) => (p === "from" ? null : "from"))}
          near={to}
          extra={
            <button type="button" onClick={useMyLocation} title="Usar mi ubicación" className="flex h-9 shrink-0 items-center rounded-xl border border-slate-200 px-2.5 text-slate-600 hover:bg-slate-50">
              <LocateFixed size={14} className={state === "locating" ? "animate-pulse" : ""} />
            </button>
          }
        />
        <PlaceField label="Destino" value={to} onChange={setTo} picking={picking === "to"} onPickOnMap={() => setPicking((p) => (p === "to" ? null : "to"))} near={from} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-slate-200 p-0.5 text-[11px] font-semibold">
          {[
            ["car", "Auto o camioneta", Car],
            ["truck", "Camión", Truck],
          ].map(([id, label, Icon]) => (
            <button key={id} type="button" onClick={() => setMode(id)} className={`flex items-center gap-1 rounded-lg px-2.5 py-1 ${mode === id ? "bg-blue-600 text-white" : "text-slate-500"}`}>
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>
        {hasTomTom() && (
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-slate-600">
            <input type="checkbox" checked={traffic} onChange={(e) => setTraffic(e.target.checked)} className="h-3.5 w-3.5 accent-blue-600" />
            <TrafficCone size={13} /> Tráfico en vivo
          </label>
        )}
      </div>

      <PlannerMap from={from} to={to} routes={routes} selected={selected} traffic={traffic} picking={picking} onPick={pick} onSelectRoute={setSelected} />

      {state === "loading" && <p className="text-center text-xs text-slate-500">Calculando rutas con el tráfico de ahora…</p>}
      {error && <p className="px-1 text-[11px] text-slate-500">{error}</p>}
      {geo.sheet}
      {routes.length > 0 && (
        <div className="space-y-1.5">
          {routes.map((r, i) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelected(i)}
              className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left ${i === selected ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
            >
              <span className={`h-8 w-1.5 shrink-0 rounded-full ${i === selected ? "bg-blue-600" : "bg-slate-300"}`} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-slate-800">
                  {durationText(r.minutes)} <span className="text-xs font-medium text-slate-500">· {r.km.toFixed(0)} km</span>
                </span>
                <span className={`block text-[11px] ${r.delayMinutes >= 10 ? "font-semibold text-rose-600" : r.delayMinutes > 0 ? "text-amber-700" : "text-emerald-700"}`}>
                  {r.delayMinutes > 0 ? `+${durationText(r.delayMinutes)} por tráfico` : "Sin retrasos por tráfico"}
                  {r.arrival ? ` · llegada ${new Date(r.arrival).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}` : ""}
                </span>
              </span>
              <span className="shrink-0 text-[10px] font-semibold text-slate-400">{i === 0 ? "Más rápida" : "Alternativa"}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
