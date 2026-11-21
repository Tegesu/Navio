// supabase/functions/tomtom/index.ts
//
// Búsqueda de lugares, nombre de un punto del mapa y rutas con tráfico
// (TomTom), pedidos desde Navio con la llave PRIVADA del servidor.
//
// Por qué pasa por aquí y no directo desde la página:
//   - La llave privada nunca llega al navegador: nadie la puede copiar.
//   - Cada persona tiene un tope por hora (generoso para el trabajo normal),
//     así un error o un abuso no se acaba la cuota del día.
//   - Las búsquedas y rutas repetidas se contestan de memoria unos minutos.
//
// Reglas:
//   - Solo con sesión de Navio (se despliega con "Verify JWT" encendido).
//   - Topes por persona y por hora: 150 búsquedas, 150 nombres de punto y
//     40 rutas.
//
// Secretos (Supabase → Edge Functions → Secrets): TOMTOM_SERVER_KEY.
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya existen.

// Versión fija: una actualización de la librería no entra sin revisarla.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const KEY = Deno.env.get("TOMTOM_SERVER_KEY") ?? "";
// Para el tráfico en vivo: la llave de la página (ya es pública, viene en el
// código de Navio y tiene Traffic API). Se puede cambiar con TOMTOM_TRAFFIC_KEY.
const TRAFFIC_KEY = Deno.env.get("TOMTOM_TRAFFIC_KEY") ?? "7L2WxUWmAj04PAArzB9kXpZz58cSdxQB";

const LIMITS: Record<string, number> = { search: 150, reverse: 150, route: 40, traffic_start: 30, traffic_end: 60 };
const CACHE_MS = 10 * 60_000;
const cache = new Map<string, { at: number; data: unknown }>();

// Versión de esta función (para revisar desde fuera que se desplegó la nueva).
const VERSION = "tomtom-5";

const ORIGINS = ["https://navio-fyj2.vercel.app"];
const cors = (origin: string | null) => ({
  "access-control-allow-origin": origin && ORIGINS.includes(origin) ? origin : ORIGINS[0],
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-expose-headers": "x-navio-fn",
  "x-navio-fn": VERSION,
  vary: "origin",
});

// Revisión de la llave del servidor: ¿TomTom la acepta para buscar y para
// rutas? Solo dice "bien" o el código de TomTom (nunca la llave) y se
// guarda 10 minutos, así no gasta consultas.
let statusCache: { at: number; data: unknown } | null = null;
async function keyStatus() {
  if (statusCache && Date.now() - statusCache.at < 10 * 60_000) return statusCache.data;
  const check = async (path: string, params: Record<string, string>) => {
    try {
      await tomtom(path, params);
      return "bien";
    } catch (err) {
      return err instanceof TomTomError ? err.detail : "sin respuesta";
    }
  };
  const data = {
    version: VERSION,
    llave: KEY ? "configurada" : "falta",
    busqueda: KEY ? await check("/search/2/search/Coatzacoalcos.json", { countrySet: "MX", limit: "1" }) : "sin llave",
    rutas: KEY ? await check("/routing/1/calculateRoute/18.14000,-94.45000:18.15000,-94.43000/json", { traffic: "false" }) : "sin llave",
    trafico: await (async () => {
      try {
        await tomtom("/traffic/services/4/flowSegmentData/absolute/10/json", { point: "18.13450,-94.45900", unit: "KMPH" }, TRAFFIC_KEY);
        return "bien";
      } catch (err) {
        return err instanceof TomTomError ? err.detail : "sin respuesta";
      }
    })(),
  };
  statusCache = { at: Date.now(), data };
  return data;
}

const num = (v: unknown, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

// Error de TomTom con su código y su explicación (para saber qué pasó).
class TomTomError extends Error {
  constructor(public kind: "cuota" | "permiso" | "tomtom", public detail: string) {
    super(kind);
  }
}

async function tomtom(path: string, params: Record<string, string>, key = KEY) {
  const query = new URLSearchParams({ key, language: "es-ES", ...params });
  // Si la llave está limitada al dominio de Navio, TomTom pide que la
  // petición diga que viene de ahí (desde el servidor no lo dice sola).
  const res = await fetch(`https://api.tomtom.com${path}?${query}`, {
    headers: { Referer: `${ORIGINS[0]}/`, Origin: ORIGINS[0] },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = String(body?.detailedError?.message ?? body?.errorText ?? body?.error?.description ?? "").slice(0, 160);
    } catch {
      // Sin explicación.
    }
    const overQuota = res.status === 429 || /over|quota|limit|qps/i.test(detail);
    throw new TomTomError(overQuota ? "cuota" : res.status === 403 || res.status === 401 ? "permiso" : "tomtom", `${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return res.json();
}

/* ---------- Tramos lentos: evidencia de tráfico ---------- */
const INCIDENT_TYPES: Record<number, string> = {
  1: "Accidente", 2: "Niebla", 3: "Condiciones peligrosas", 4: "Lluvia", 5: "Hielo", 6: "Tráfico detenido",
  7: "Carril cerrado", 8: "Calle cerrada", 9: "Obras", 10: "Viento", 11: "Inundación", 14: "Vehículo descompuesto",
};
const toRad = (d: number) => (d * Math.PI) / 180;
function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const h = Math.sin(toRad(b.lat - a.lat) / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// Lo que reporta TomTom ahora en ese punto: velocidad de la calle, incidentes
// cerca y el nombre de la calle.
async function trafficAt(lat: number, lng: number) {
  const out = {
    currentSpeedKmh: null as number | null,
    freeFlowSpeedKmh: null as number | null,
    confidence: null as number | null,
    roadClosure: false,
    incidents: [] as Array<Record<string, unknown>>,
    roadName: null as string | null,
    note: [] as string[],
  };
  try {
    const flow = await tomtom("/traffic/services/4/flowSegmentData/absolute/10/json", { point: `${lat.toFixed(5)},${lng.toFixed(5)}`, unit: "KMPH" }, TRAFFIC_KEY);
    const d = flow?.flowSegmentData ?? {};
    out.currentSpeedKmh = Number.isFinite(d.currentSpeed) ? d.currentSpeed : null;
    out.freeFlowSpeedKmh = Number.isFinite(d.freeFlowSpeed) ? d.freeFlowSpeed : null;
    out.confidence = Number.isFinite(d.confidence) ? d.confidence : null;
    out.roadClosure = !!d.roadClosure;
  } catch (err) {
    out.note.push(`flujo ${err instanceof TomTomError ? err.detail : "sin respuesta"}`);
  }
  try {
    const box = [lng - 0.01, lat - 0.01, lng + 0.01, lat + 0.01].map((n) => n.toFixed(5)).join(",");
    const data = await tomtom(
      "/traffic/services/5/incidentDetails",
      {
        bbox: box,
        fields: "{incidents{geometry{type,coordinates},properties{iconCategory,magnitudeOfDelay,events{description},from,to,delay}}}",
        timeValidityFilter: "present",
      },
      TRAFFIC_KEY
    );
    // deno-lint-ignore no-explicit-any
    const near = (geometry: any) => {
      const coords: number[][] = geometry?.type === "Point" ? [geometry.coordinates] : geometry?.coordinates ?? [];
      return Math.min(...coords.map((c) => km({ lat, lng }, { lat: c[1], lng: c[0] })), 99);
    };
    // deno-lint-ignore no-explicit-any
    const list: any[] = data?.incidents ?? [];
    out.incidents = list
      .map((i) => ({ dist: near(i.geometry), p: i.properties ?? {} }))
      .filter((i) => i.dist <= 0.6)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 5)
      .map(({ dist, p }) => ({
        type: INCIDENT_TYPES[p.iconCategory] ?? "Incidente",
        description: String(p.events?.[0]?.description ?? "").slice(0, 120),
        from: p.from ? String(p.from).slice(0, 80) : null,
        to: p.to ? String(p.to).slice(0, 80) : null,
        delayMinutes: Number.isFinite(p.delay) ? Math.round(p.delay / 60) : null,
        magnitude: p.magnitudeOfDelay ?? null,
        meters: Math.round(dist * 1000),
      }));
  } catch (err) {
    out.note.push(`incidentes ${err instanceof TomTomError ? err.detail : "sin respuesta"}`);
  }
  try {
    const rev = await tomtom(`/search/2/reverseGeocode/${lat.toFixed(5)},${lng.toFixed(5)}.json`, { radius: "100" });
    const a = rev?.addresses?.[0]?.address ?? {};
    out.roadName = String(a.streetName ?? a.freeformAddress ?? "").slice(0, 160) || null;
  } catch {
    // Sin nombre de calle.
  }
  return out;
}

// Cuánto avanzó la unidad entre dos momentos (con sus puntos guardados).
async function movedBetween(routeId: number, from: string, to: string) {
  const { data } = await supabase
    .from("route_points")
    .select("lat, lng, recordedAt")
    .eq("routeId", routeId)
    .gte("recordedAt", from)
    .lte("recordedAt", to)
    .order("recordedAt", { ascending: true })
    .limit(2000);
  const points = data ?? [];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += km(points[i - 1], points[i]);
  const hours = (Date.parse(to) - Date.parse(from)) / 3600000;
  return { movedKm: Math.round(total * 100) / 100, unitSpeedKmh: hours > 0 ? Math.round((total / hours) * 10) / 10 : null };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const headers = { ...cors(origin), "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json(405, { error: "Método no permitido" });

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Petición no válida." });
  }
  // Revisión de la llave (sin sesión): ver keyStatus().
  if (body.action === "status") return json(200, await keyStatus());
  if (!KEY) return json(503, { error: "Falta la llave del servidor de TomTom." });

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authError } = await supabase.auth.getUser(token);
  if (authError || !auth?.user) return json(401, { error: "Inicia sesión en Navio." });

  const action = String(body.action ?? "");
  if (!(action in LIMITS)) return json(400, { error: "Acción no válida." });

  // Tramo lento: empieza (consulta el tráfico) o termina (cuánto avanzó).
  if (action === "traffic_start" || action === "traffic_end") {
    const { error: trafficLimit } = await supabase.rpc("hit_rate_limit", {
      limit_bucket: `tomtom_${action}`,
      limit_subject: auth.user.id,
      max_hits: LIMITS[action],
      per_window: "1 hour",
      message: "Demasiados avisos de tráfico en una hora.",
    });
    if (trafficLimit) return json(429, { error: trafficLimit.message });
    const now = new Date().toISOString();
    if (action === "traffic_start") {
      const routeId = num(body.routeId, 1, Number.MAX_SAFE_INTEGER);
      const lat = num(body.lat, -90, 90);
      const lng = num(body.lng, -180, 180);
      if (routeId === null || lat === null || lng === null) return json(400, { error: "Datos no válidos." });
      const { data: route } = await supabase.from("routes").select('id, "companyId", "createdBy", status, "startedAt"').eq("id", routeId).maybeSingle();
      if (!route || route.createdBy !== auth.user.id || route.status !== "active") return json(403, { error: "Ese viaje no es tuyo o ya terminó." });
      // Desde cuándo va lento: lo dice el teléfono, pero dentro de la última hora y del viaje.
      const sinceRaw = Date.parse(String(body.since ?? ""));
      const floor = Math.max(Date.parse(route.startedAt), Date.now() - 60 * 60_000);
      const since = new Date(Number.isFinite(sinceRaw) ? Math.min(Date.now(), Math.max(floor, sinceRaw)) : Date.now()).toISOString();
      const traffic = await trafficAt(lat, lng);
      const moved = await movedBetween(routeId, since, now);
      const cur = traffic.currentSpeedKmh;
      const free = traffic.freeFlowSpeedKmh;
      const slowRoad = cur !== null && free !== null && free > 0 && cur / free < 0.6;
      const verdict = traffic.roadClosure || slowRoad || traffic.incidents.length > 0 ? "traffic" : cur !== null ? "clear" : "unknown";
      const { data: created, error: insertError } = await supabase
        .from("route_traffic_events")
        .insert({
          companyId: route.companyId,
          routeId,
          startedAt: since,
          checkedAt: now,
          lat,
          lng,
          roadName: traffic.roadName,
          movedKm: moved.movedKm,
          unitSpeedKmh: moved.unitSpeedKmh,
          currentSpeedKmh: cur,
          freeFlowSpeedKmh: free,
          confidence: traffic.confidence,
          roadClosure: traffic.roadClosure,
          incidents: traffic.incidents,
          verdict,
          note: traffic.note.join(" · ") || null,
        })
        .select()
        .single();
      if (insertError) return json(500, { error: /route_traffic_events/.test(insertError.message) ? "Falta la actualización v34 de la base de datos." : "No se pudo guardar el tramo." });
      return json(200, created);
    }
    const eventId = num(body.eventId, 1, Number.MAX_SAFE_INTEGER);
    if (eventId === null) return json(400, { error: "Datos no válidos." });
    const { data: event } = await supabase.from("route_traffic_events").select('id, "routeId", "startedAt", "endedAt"').eq("id", eventId).maybeSingle();
    if (!event) return json(404, { error: "No se encontró el tramo." });
    const { data: owner } = await supabase.from("routes").select('"createdBy"').eq("id", event.routeId).maybeSingle();
    if (!owner || owner.createdBy !== auth.user.id) return json(403, { error: "Ese tramo no es tuyo." });
    if (event.endedAt) return json(200, event);
    const moved = await movedBetween(event.routeId, event.startedAt, now);
    const { data: closed } = await supabase
      .from("route_traffic_events")
      .update({ endedAt: now, movedKm: moved.movedKm, unitSpeedKmh: moved.unitSpeedKmh })
      .eq("id", eventId)
      .select()
      .single();
    return json(200, closed);
  }

  // Qué se va a pedir (validado) y su llave de memoria.
  let path = "";
  let params: Record<string, string> = {};
  if (action === "search") {
    const text = String(body.text ?? "").trim().slice(0, 120);
    if (text.length < 3) return json(200, { results: [] });
    const lat = num(body.lat, -90, 90);
    const lng = num(body.lng, -180, 180);
    path = `/search/2/search/${encodeURIComponent(text)}.json`;
    params = { countrySet: "MX", limit: "6", typeahead: "true", ...(lat !== null && lng !== null ? { lat: lat.toFixed(3), lon: lng.toFixed(3) } : {}) };
  } else if (action === "reverse") {
    const lat = num(body.lat, -90, 90);
    const lng = num(body.lng, -180, 180);
    if (lat === null || lng === null) return json(400, { error: "Punto no válido." });
    path = `/search/2/reverseGeocode/${lat.toFixed(5)},${lng.toFixed(5)}.json`;
    params = { radius: "100" };
  } else {
    const coords = ["fromLat", "fromLng", "toLat", "toLng"].map((k, i) => num(body[k], i % 2 ? -180 : -90, i % 2 ? 180 : 90));
    if (coords.some((c) => c === null)) return json(400, { error: "Puntos no válidos." });
    const mode = body.mode === "truck" ? "truck" : "car";
    path = `/routing/1/calculateRoute/${coords[0]!.toFixed(5)},${coords[1]!.toFixed(5)}:${coords[2]!.toFixed(5)},${coords[3]!.toFixed(5)}/json`;
    params = { traffic: "true", maxAlternatives: "2", travelMode: mode, routeType: "fastest", computeTravelTimeFor: "all", routeRepresentation: "polyline" };
  }
  const cacheKey = `${path}?${new URLSearchParams(params)}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < (action === "route" ? 3 * 60_000 : CACHE_MS)) return json(200, hit.data);

  const { error: limitError } = await supabase.rpc("hit_rate_limit", {
    limit_bucket: `tomtom_${action}`,
    limit_subject: auth.user.id,
    max_hits: LIMITS[action],
    per_window: "1 hour",
    message: "Llegaste al límite de consultas de mapas por hora. Puedes iniciar el viaje sin ruta.",
  });
  if (limitError) return json(429, { error: limitError.message });

  try {
    const data = await tomtom(path, params);
    cache.set(cacheKey, { at: Date.now(), data });
    if (cache.size > 2000) cache.clear();
    return json(200, data);
  } catch (err) {
    const e = err instanceof TomTomError ? err : new TomTomError("tomtom", (err as Error)?.name === "TimeoutError" ? "tardó demasiado" : "sin respuesta");
    console.error("tomtom", action, e.detail);
    if (e.kind === "cuota") return json(429, { error: "Por hoy se acabaron las consultas de mapas. Puedes iniciar el viaje sin ruta." });
    if (e.kind === "permiso") {
      return json(502, {
        error: `TomTom rechazó la llave del servidor (${e.detail}). Revisa en developer.tomtom.com que TOMTOM_SERVER_KEY tenga activadas Search API y Routing API y que no esté limitada a un dominio.`,
      });
    }
    return json(502, { error: `TomTom no respondió (${e.detail}). Intenta de nuevo.` });
  }
});
