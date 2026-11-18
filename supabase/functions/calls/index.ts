// supabase/functions/calls/index.ts
//
// Servidores para conectar las llamadas y videollamadas de Navio.
//
// Las llamadas van directo de un teléfono a otro (WebRTC). Casi siempre
// basta con los servidores públicos "STUN" que ya trae la página; pero
// algunas redes de datos móviles no dejan la conexión directa, y entonces
// hace falta un servidor "TURN" que pase el audio y el video. Esta función
// entrega claves temporales (2 horas) del TURN de Cloudflare, sin que la
// llave principal llegue nunca a la página.
//
// Es OPCIONAL: si no está publicada o no tiene sus secretos, Navio llama
// solo con STUN.
//
// Reglas:
//   - Solo con sesión de Navio (se despliega con "Verify JWT" encendido).
//   - Hasta 60 pedidos por persona por hora.
//
// Secretos (Supabase → Edge Functions → Secrets), de Cloudflare → Realtime →
// TURN Server: CLOUDFLARE_TURN_KEY_ID y CLOUDFLARE_TURN_KEY_TOKEN.

// Versión fija: una actualización de la librería no entra sin revisarla.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const KEY_ID = Deno.env.get("CLOUDFLARE_TURN_KEY_ID") ?? "";
const KEY_TOKEN = Deno.env.get("CLOUDFLARE_TURN_KEY_TOKEN") ?? "";

const STUN = [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }];

const ORIGINS = ["https://navio-fyj2.vercel.app"];
const cors = (origin: string | null) => ({
  "access-control-allow-origin": origin && ORIGINS.includes(origin) ? origin : ORIGINS[0],
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  vary: "origin",
});

const hits = new Map<string, number[]>();
function tooMany(userId: string) {
  const now = Date.now();
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < 3600_000);
  recent.push(now);
  hits.set(userId, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > 60;
}

type IceServer = { urls: string | string[]; username?: string; credential?: string };

async function cloudflare(): Promise<IceServer[] | null> {
  if (!KEY_ID || !KEY_TOKEN) return null;
  const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(KEY_ID)}/credentials/generate-ice-servers`, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ ttl: 7200 }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    console.error("cloudflare turn:", res.status);
    return null;
  }
  const data = await res.json();
  const list: IceServer[] = Array.isArray(data?.iceServers) ? data.iceServers : data?.iceServers ? [data.iceServers] : [];
  // Los navegadores no usan el puerto 53: se quita para no esperar de más.
  return list
    .map((s) => ({ ...s, urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u)) }))
    .filter((s) => s.urls.length > 0);
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const headers = { ...cors(origin), "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json(405, { error: "Método no permitido" });

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authError } = await supabase.auth.getUser(token);
  if (authError || !auth?.user) return json(401, { error: "Inicia sesión en Navio." });
  if (tooMany(auth.user.id)) return json(429, { error: "Demasiados intentos. Espera un momento." });

  try {
    const turn = await cloudflare();
    return json(200, { iceServers: turn?.length ? turn : STUN, turn: !!turn?.length });
  } catch (err) {
    console.error("calls:", (err as Error).message);
    return json(200, { iceServers: STUN, turn: false });
  }
});
