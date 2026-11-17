import L from "leaflet";
import { TOMTOM_KEY } from "./config.js";

/* ---------------------------------------------------------------------- */
/*  Mapas: TomTom (con su estilo nocturno en modo oscuro y tráfico real)  */
/* ---------------------------------------------------------------------- */
//
// Sin llave de TomTom se usa OpenStreetMap, como antes, y no hay rutas ni
// tráfico. La llave es pública por naturaleza (va en la página); en el portal
// de TomTom conviene limitarla al dominio de Navio.

export const hasTomTom = () => !!TOMTOM_KEY;
const isDark = () => typeof document !== "undefined" && document.documentElement.classList.contains("dark");

// Capa base del mapa. Devuelve la capa y si ya viene oscura (para no invertirla).
export function baseLayer() {
  if (TOMTOM_KEY) {
    const style = isDark() ? "night" : "main";
    return {
      nativeDark: isDark(),
      layer: L.tileLayer(`https://api.tomtom.com/map/1/tile/basic/${style}/{z}/{x}/{y}.png?key=${encodeURIComponent(TOMTOM_KEY)}&tileSize=256&language=es-ES`, {
        attribution: "© TomTom",
        maxZoom: 22,
      }),
    };
  }
  return { nativeDark: false, layer: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap", maxZoom: 19 }) };
}

// Tráfico en vivo encima del mapa (verde = fluido, rojo = detenido).
export function trafficLayer() {
  if (!TOMTOM_KEY) return null;
  const style = isDark() ? "relative0-dark" : "relative0";
  return L.tileLayer(`https://api.tomtom.com/traffic/map/4/tile/flow/${style}/{z}/{x}/{y}.png?key=${encodeURIComponent(TOMTOM_KEY)}&tileSize=256`, {
    maxZoom: 22,
    opacity: 0.85,
    zIndex: 5,
  });
}

// Aplica la capa base a un mapa y marca el contenedor si ya viene oscura.
export function addBaseLayer(map, container) {
  const { layer, nativeDark } = baseLayer();
  layer.addTo(map);
  container?.classList.toggle("tiles-native-dark", nativeDark);
  return layer;
}

/* ---------- Búsqueda de lugares y rutas ---------- */

const api = (path, params) => {
  const query = new URLSearchParams({ key: TOMTOM_KEY, language: "es-ES", ...params });
  return fetch(`https://api.tomtom.com${path}?${query}`).then((res) => {
    if (!res.ok) throw new Error(res.status === 403 ? "La llave de TomTom no tiene permiso." : "TomTom no respondió.");
    return res.json();
  });
};

// Sugerencias mientras se escribe una dirección o un lugar.
export async function searchPlaces(text, near) {
  if (!TOMTOM_KEY || text.trim().length < 3) return [];
  const data = await api(`/search/2/search/${encodeURIComponent(text.trim())}.json`, {
    countrySet: "MX",
    limit: "6",
    typeahead: "true",
    ...(near ? { lat: String(near.lat), lon: String(near.lng) } : {}),
  });
  return (data.results ?? []).map((r) => ({
    label: r.poi?.name ? `${r.poi.name} · ${r.address?.freeformAddress ?? ""}` : r.address?.freeformAddress ?? "Lugar",
    lat: r.position.lat,
    lng: r.position.lon,
  }));
}

// Nombre de un punto elegido en el mapa.
export async function placeName(point) {
  if (!TOMTOM_KEY) return `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
  try {
    const data = await api(`/search/2/reverseGeocode/${point.lat},${point.lng}.json`, { radius: "100" });
    return data.addresses?.[0]?.address?.freeformAddress ?? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
  } catch {
    return `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
  }
}

// La ruta más rápida con el tráfico de este momento y hasta dos alternativas.
// mode: "car" o "truck".
export async function planRoutes(from, to, mode = "car") {
  if (!TOMTOM_KEY) throw new Error("Falta la llave de TomTom.");
  const data = await api(`/routing/1/calculateRoute/${from.lat},${from.lng}:${to.lat},${to.lng}/json`, {
    traffic: "true",
    maxAlternatives: "2",
    travelMode: mode,
    routeType: "fastest",
    computeTravelTimeFor: "all",
    routeRepresentation: "polyline",
  });
  return (data.routes ?? []).map((route, index) => ({
    id: index,
    km: (route.summary.lengthInMeters ?? 0) / 1000,
    minutes: Math.round((route.summary.travelTimeInSeconds ?? 0) / 60),
    delayMinutes: Math.round((route.summary.trafficDelayInSeconds ?? 0) / 60),
    noTrafficMinutes: Math.round((route.summary.noTrafficTravelTimeInSeconds ?? route.summary.travelTimeInSeconds ?? 0) / 60),
    arrival: route.summary.arrivalTime ?? null,
    points: (route.legs ?? []).flatMap((leg) => (leg.points ?? []).map((p) => ({ lat: p.latitude, lng: p.longitude }))),
  }));
}

export const durationText = (minutes) => (minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`);
