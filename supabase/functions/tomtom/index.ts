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

const LIMITS: Record<string, number> = { search: 150, reverse: 150, route: 40 };
const CACHE_MS = 10 * 60_000;
const cache = new Map<string, { at: number; data: unknown }>();

const ORIGINS = ["https://navio-fyj2.vercel.app"];
const cors = (origin: string | null) => ({
  "access-control-allow-origin": origin && ORIGINS.includes(origin) ? origin : ORIGINS[0],
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  vary: "origin",
});

const num = (v: unknown, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

async function tomtom(path: string, params: Record<string, string>) {
  const query = new URLSearchParams({ key: KEY, language: "es-ES", ...params });
  const res = await fetch(`https://api.tomtom.com${path}?${query}`, { signal: AbortSignal.timeout(15_000) });
  if (res.status === 403 || res.status === 429) throw new Error("cuota");
  if (!res.ok) throw new Error("tomtom");
  return res.json();
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const headers = { ...cors(origin), "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json(405, { error: "Método no permitido" });
  if (!KEY) return json(503, { error: "Falta la llave del servidor de TomTom." });

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authError } = await supabase.auth.getUser(token);
  if (authError || !auth?.user) return json(401, { error: "Inicia sesión en Navio." });

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Petición no válida." });
  }
  const action = String(body.action ?? "");
  if (!(action in LIMITS)) return json(400, { error: "Acción no válida." });

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
    return json((err as Error).message === "cuota" ? 429 : 502, {
      error: (err as Error).message === "cuota" ? "Por hoy se acabaron las consultas de mapas. Puedes iniciar el viaje sin ruta." : "TomTom no respondió. Intenta de nuevo.",
    });
  }
});
