// supabase/functions/gps-ingest/index.ts
//
// Recibe la ubicación que manda una app de rastreo (Traccar Client, Android
// y iPhone) y la guarda en el viaje que la persona tiene en curso en Navio.
//
// Así el viaje se sigue registrando con la pantalla apagada o con otra app
// abierta, cosa que un navegador no permite.
//
// Reglas (las aplica la base de datos, en ingest_tracker_points):
//   - Cada teléfono se identifica con la clave que Navio le dio al vincularlo.
//   - Solo se guarda mientras esa persona tiene un viaje iniciado en Navio
//     con la opción "app de rastreo". Fuera de un viaje todo se descarta.
//
// La app de rastreo no manda la llave de Supabase, así que esta función se
// despliega con la verificación de JWT apagada. La protección es la clave del
// teléfono (64 caracteres al azar).
//
// Acepta los dos formatos que usa Traccar Client:
//   1. JSON:      { "device_id": "...", "location": { "timestamp": "...", "coords": { "latitude", "longitude", "speed" (m/s), "heading", "accuracy" } } }
//   2. Parámetros: ?id=...&lat=..&lon=..&timestamp=..&speed=(nudos)&bearing=..&accuracy=..
//
// Variables de entorno (ya existen en el proyecto): SUPABASE_URL y
// SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const MAX_BODY_BYTES = 256 * 1024;
const MAX_POINTS = 500;
const KNOTS_TO_KMH = 1.852;
const MPS_TO_KMH = 3.6;

type Point = { lat: number; lng: number; speed: number | null; heading: number | null; accuracy: number | null; t: string };

const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

// Acepta fecha ISO, "yyyy-MM-dd HH:mm:ss", o segundos / milisegundos desde 1970.
function toIso(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  let date: Date;
  if (typeof value === "number" || /^\d+(\.\d+)?$/.test(String(value))) {
    const n = Number(value);
    date = new Date(n < 1e11 ? n * 1000 : n);
  } else {
    const text = String(value).trim();
    date = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(" ", "T")}Z` : text);
  }
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function makePoint(lat: unknown, lng: unknown, speedKmh: number | null, heading: unknown, accuracy: unknown, time: unknown): Point | null {
  const la = num(lat);
  const lo = num(lng);
  if (la === null || lo === null || la < -90 || la > 90 || lo < -180 || lo > 180) return null;
  const h = num(heading);
  const a = num(accuracy);
  return {
    lat: la,
    lng: lo,
    speed: speedKmh !== null && speedKmh >= 0 && speedKmh < 400 ? Math.round(speedKmh * 10) / 10 : null,
    heading: h !== null && h >= 0 && h <= 360 ? Math.round(h) : null,
    accuracy: a !== null && a >= 0 ? Math.round(a) : null,
    t: toIso(time) ?? new Date().toISOString(),
  };
}

// Formato JSON: una ubicación o una lista de ellas.
function pointsFromJson(body: any): Point[] {
  const list = Array.isArray(body?.location) ? body.location : body?.location ? [body.location] : Array.isArray(body) ? body : [];
  const points: Point[] = [];
  for (const item of list) {
    const coords = item?.coords ?? item;
    const mps = num(coords?.speed);
    const point = makePoint(coords?.latitude ?? coords?.lat, coords?.longitude ?? coords?.lon ?? coords?.lng, mps === null ? null : mps * MPS_TO_KMH, coords?.heading ?? coords?.bearing, coords?.accuracy, item?.timestamp ?? coords?.timestamp);
    if (point) points.push(point);
  }
  return points;
}

// Formato de parámetros (en la dirección o en el cuerpo del formulario).
function pointsFromParams(params: URLSearchParams): Point[] {
  let lat: unknown = params.get("lat");
  let lon: unknown = params.get("lon");
  const pair = params.get("location");
  if ((lat === null || lon === null) && pair?.includes(",")) [lat, lon] = pair.split(",");
  const knots = num(params.get("speed"));
  const point = makePoint(lat, lon, knots === null ? null : knots * KNOTS_TO_KMH, params.get("bearing") ?? params.get("heading"), params.get("accuracy"), params.get("timestamp"));
  return point ? [point] : [];
}

const reply = (status: number, text = "") => new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "POST") return reply(405, "Método no permitido");

  const url = new URL(req.url);
  let token = url.searchParams.get("id") ?? url.searchParams.get("deviceid") ?? "";
  let points: Point[] = [];

  try {
    const raw = req.method === "POST" ? await req.text() : "";
    if (raw.length > MAX_BODY_BYTES) return reply(413, "Demasiados datos en un solo envío");
    const contentType = (req.headers.get("content-type") ?? "").toLowerCase();
    if (raw && contentType.startsWith("application/json")) {
      const body = JSON.parse(raw);
      token = String(body?.device_id ?? body?.deviceId ?? body?.id ?? token ?? "");
      points = pointsFromJson(body);
    } else {
      const form = new URLSearchParams(raw);
      token = token || form.get("id") || form.get("deviceid") || "";
      points = pointsFromParams(url.searchParams.has("lat") || url.searchParams.has("location") ? url.searchParams : form);
    }
  } catch {
    return reply(400, "No se pudo leer el envío");
  }

  token = token.trim();
  if (token.length < 32 || token.length > 128) return reply(404, "Teléfono no vinculado");

  const { data, error } = await supabase.rpc("ingest_tracker_points", { device_token: token, points: points.slice(0, MAX_POINTS) });
  if (error) {
    console.error("ingest_tracker_points:", error.message);
    // Con un 500 la app de rastreo guarda el punto y lo reintenta después.
    return reply(500, "No se pudo guardar");
  }

  // "unknown": la clave no existe → 404, para que se note en la app de rastreo.
  // Lo demás responde 200 aunque no se guarde nada (sin viaje en curso), para
  // que el teléfono no acumule ubicaciones de fuera de un viaje.
  if (data?.status === "unknown") return reply(404, "Teléfono no vinculado");
  return reply(200);
});
