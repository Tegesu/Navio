// supabase/functions/push/index.ts
//
// Manda las notificaciones de Navio (mensajes nuevos y avisos) a los
// navegadores (notificaciones web) y a la app de Android (Firebase) donde
// cada persona las activó.
//
// La llama la base de datos (migraciones v26 y v27) con { table, id } cada
// vez que llega un mensaje, un aviso o una llamada. No confía en lo que
// recibe: lo lee por su cuenta, solo si es reciente y todavía no se ha
// avisado, y lo marca para no repetirlo. Por eso se despliega con la
// verificación de JWT apagada: quien la llame de fuera, como mucho adelanta
// un aviso que de todos modos iba a salir.
//
// También manda un aviso de prueba ({ test: true }) a los teléfonos y
// navegadores de quien lo pide (con su sesión), para revisar que todo llegue.
//
// Secretos (Supabase → Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY (notificaciones web).
//   FIREBASE_SERVICE_ACCOUNT (el .json de la cuenta de servicio de Firebase,
//   completo; para la app de Android).
//   SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya existen.

// Versiones fijas: una actualización de las librerías no entra sin revisarla.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";
import webpush from "npm:web-push@3.6.7";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const WEB_PUSH = !!(PUBLIC_KEY && PRIVATE_KEY);
if (WEB_PUSH) webpush.setVapidDetails("https://navio-fyj2.vercel.app", PUBLIC_KEY, PRIVATE_KEY);

type ServiceAccount = { project_id: string; client_email: string; private_key: string };
const FIREBASE: ServiceAccount | null = (() => {
  try {
    const parsed = JSON.parse(Deno.env.get("FIREBASE_SERVICE_ACCOUNT") ?? "");
    return parsed?.project_id && parsed?.client_email && parsed?.private_key ? parsed : null;
  } catch {
    return null;
  }
})();

const KIND_LABEL: Record<string, string> = { image: "📷 Foto", video: "🎬 Video", file: "📄 Documento", voice: "🎤 Nota de voz", sticker: "Sticker" };

// Freno simple por dirección (por instancia de la función).
const hits = new Map<string, { count: number; since: number }>();
function tooMany(address: string): boolean {
  const now = Date.now();
  const entry = hits.get(address);
  if (!entry || now - entry.since > 60_000) {
    hits.set(address, { count: 1, since: now });
    if (hits.size > 5000) hits.clear();
    return false;
  }
  entry.count += 1;
  return entry.count > 300;
}

const reply = (status: number, text = "") => new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

// channel: canal de Android ("navio_mensajes" o "navio_llamadas"); ttl en segundos.
type Payload = { title: string; body: string; url: string; tag?: string; channel?: string; ttl?: number; test?: boolean };

/* ---------- Qué avisar y a quién ---------- */

async function claim(table: "chat_messages" | "notifications" | "calls", id: number) {
  const since = new Date(Date.now() - (table === "calls" ? 60_000 : 5 * 60_000)).toISOString();
  const { data } = await supabase.from(table).update({ pushedAt: new Date().toISOString() }).eq("id", id).is("pushedAt", null).gte("createdAt", since).select().maybeSingle();
  return data;
}

async function forMessage(id: number): Promise<{ users: string[]; payload: Payload } | null> {
  const message = await claim("chat_messages", id);
  if (!message || message.deletedAt || !message.senderId) return null;
  const { data: channel } = await supabase.from("chat_channels").select("id, kind, name, companyId").eq("id", message.channelId).maybeSingle();
  if (!channel) return null;
  let users: string[] = [];
  if (channel.kind === "general") {
    const { data } = await supabase.from("profiles").select("id").eq("companyId", channel.companyId);
    users = (data ?? []).map((p: { id: string }) => p.id);
  } else {
    const { data } = await supabase.from("chat_members").select("userId").eq("channelId", channel.id);
    users = (data ?? []).map((m: { userId: string }) => m.userId);
  }
  users = users.filter((u) => u !== message.senderId);
  // Llamadas: solo se avisa la perdida (la llamada en sí ya sonó).
  if (message.kind === "call") {
    if (message.attachment?.duration != null) return null;
    return {
      users,
      payload: {
        title: `Llamada perdida de ${message.senderName ?? "alguien"}`,
        body: message.attachment?.call === "video" ? "Videollamada sin contestar" : "Llamada de voz sin contestar",
        url: `/?open=messages&sub=channel:${channel.id}`,
        tag: `chat-${channel.id}`,
      },
    };
  }
  const where = channel.kind === "general" ? " · General" : channel.kind === "group" ? ` · ${channel.name ?? "Grupo"}` : "";
  const text = message.kind && message.kind !== "text" ? `${KIND_LABEL[message.kind] ?? "Archivo"}${message.body ? `: ${message.body}` : ""}` : message.body;
  return {
    users,
    payload: {
      title: `${message.senderName ?? "Mensaje nuevo"}${where}`,
      body: String(text ?? "").slice(0, 160),
      url: `/?open=messages&sub=channel:${channel.id}`,
      tag: `chat-${channel.id}`,
    },
  };
}

async function forNotification(id: number): Promise<{ users: string[]; payload: Payload } | null> {
  const row = await claim("notifications", id);
  if (!row?.userId) return null;
  const link = row.link ?? {};
  const params = new URLSearchParams();
  if (link.tab) params.set("open", String(link.tab));
  if (link.sub) params.set("sub", String(link.sub));
  return {
    users: [row.userId],
    payload: { title: String(row.title ?? "Navio").slice(0, 120), body: String(row.body ?? "").slice(0, 160), url: params.toString() ? `/?${params}` : "/", tag: `aviso-${row.id}` },
  };
}

async function forCall(id: number): Promise<{ users: string[]; payload: Payload } | null> {
  const call = await claim("calls", id);
  if (!call || call.status !== "ringing" || !call.calleeId) return null;
  return {
    users: [call.calleeId],
    payload: {
      title: `${call.callerName ?? "Alguien"} te está llamando`,
      body: call.kind === "video" ? "Videollamada de Navio · toca para contestar" : "Llamada de voz de Navio · toca para contestar",
      url: `/?open=messages&sub=channel:${call.channelId}`,
      tag: `call-${call.id}`,
      channel: "navio_llamadas",
      ttl: 45,
    },
  };
}

/* ---------- Firebase (app de Android) ---------- */

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const textUrl = (text: string) => b64url(new TextEncoder().encode(text));

function pemToDer(pem: string): ArrayBuffer {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0)).buffer;
}

let googleToken = { value: "", until: 0 };
async function googleAccessToken(account: ServiceAccount): Promise<string> {
  if (googleToken.value && Date.now() < googleToken.until) return googleToken.value;
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${textUrl(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${textUrl(
    JSON.stringify({ iss: account.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })
  )}`;
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(account.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64url(signature)}` }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error("No se pudo entrar a Firebase");
  googleToken = { value: data.access_token, until: Date.now() + (Number(data.expires_in ?? 3600) - 120) * 1000 };
  return googleToken.value;
}

// result: "ok", "gone" (el teléfono ya no existe) o "error"; code: el motivo
// que da Firebase (para la prueba y el registro de la función).
async function sendFcm(account: ServiceAccount, token: string, payload: Payload): Promise<{ result: string; code?: string }> {
  const access = await googleAccessToken(account);
  const data: Record<string, string> = { url: payload.url };
  if (payload.test) data.test = "1";
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
    method: "POST",
    headers: { authorization: `Bearer ${access}`, "content-type": "application/json" },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: payload.title, body: payload.body },
        data,
        android: {
          priority: "HIGH",
          ttl: `${payload.ttl ?? 3600}s`,
          notification: {
            tag: payload.tag,
            channel_id: payload.channel ?? "navio_mensajes",
            default_sound: true,
            default_vibrate_timings: true,
            notification_priority: payload.channel === "navio_llamadas" ? "PRIORITY_MAX" : "PRIORITY_HIGH",
            visibility: "PRIVATE",
          },
        },
      },
    }),
  });
  if (res.ok) return { result: "ok" };
  const err = await res.json().catch(() => ({}));
  const code = String(err?.error?.details?.find((d: { errorCode?: string }) => d.errorCode)?.errorCode ?? err?.error?.status ?? res.status);
  console.error("firebase:", res.status, code, err?.error?.message ?? "");
  return { result: res.status === 404 || code === "UNREGISTERED" ? "gone" : "error", code };
}

/* ---------- Envío ---------- */

type Report = { total: number; sent: number; errors: string[] };

// only: para la prueba, solo este teléfono (device) o este navegador (endpoint).
async function deliver(users: string[], payload: Payload, only: { device?: string; endpoint?: string } = {}) {
  const web: Report = { total: 0, sent: 0, errors: [] };
  const android: Report = { total: 0, sent: 0, errors: [] };

  // Navegadores
  if (WEB_PUSH && !only.device) {
    let subsQuery = supabase.from("push_subscriptions").select("id, endpoint, p256dh, auth").in("userId", users);
    if (only.endpoint) subsQuery = subsQuery.eq("endpoint", only.endpoint);
    const { data: subs } = await subsQuery;
    const gone: number[] = [];
    web.total = subs?.length ?? 0;
    const call = payload.channel === "navio_llamadas";
    // La prueba se muestra aunque Navio esté abierto; la llamada se queda en
    // pantalla hasta que se toca.
    const body = JSON.stringify(payload.test || call ? { ...payload, skipIfVisible: !payload.test, requireInteraction: call } : payload);
    await Promise.all(
      (subs ?? []).map(async (s: { id: number; endpoint: string; p256dh: string; auth: string }) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: payload.ttl ?? 3600, urgency: "high" });
          web.sent += 1;
        } catch (err) {
          const code = (err as { statusCode?: number })?.statusCode;
          if (code === 404 || code === 410) gone.push(s.id); // el navegador ya no existe o se desactivó
          else web.errors.push(String(code ?? "error"));
        }
      })
    );
    if (gone.length) await supabase.from("push_subscriptions").delete().in("id", gone);
  }

  // App de Android
  if (FIREBASE && !only.endpoint) {
    let query = supabase.from("push_devices").select("id, token").in("userId", users);
    if (only.device) query = query.eq("token", only.device);
    const { data: devices } = await query;
    const gone: number[] = [];
    android.total = devices?.length ?? 0;
    await Promise.all(
      (devices ?? []).map(async (d: { id: number; token: string }) => {
        try {
          const { result, code } = await sendFcm(FIREBASE, d.token, payload);
          if (result === "ok") android.sent += 1;
          else {
            if (result === "gone") gone.push(d.id);
            android.errors.push(code ?? result);
          }
        } catch (err) {
          console.error("firebase:", (err as Error).message);
          android.errors.push("LOGIN_FIREBASE");
        }
      })
    );
    if (gone.length) await supabase.from("push_devices").delete().in("id", gone);
  }
  return { web, android };
}

const CORS = {
  "access-control-allow-origin": "https://navio-fyj2.vercel.app",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

// Aviso de prueba: solo a quien lo pide (con su sesión), pocas veces.
const tests = new Map<string, number[]>();
async function sendTest(req: Request, device: unknown, endpoint: unknown) {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await supabase.auth.getUser(token);
  const userId = auth?.user?.id;
  if (!userId) return json(401, { error: "Inicia sesión en Navio." });
  const now = Date.now();
  const recent = (tests.get(userId) ?? []).filter((t) => now - t < 10 * 60_000);
  if (recent.length >= 5) return json(429, { error: "Ya mandaste varias pruebas. Espera unos minutos." });
  tests.set(userId, [...recent, now]);
  if (tests.size > 5000) tests.clear();
  const report = await deliver(
    [userId],
    { title: "Prueba de Navio", body: "Si ves este aviso, las notificaciones funcionan en este equipo.", url: "/", tag: "prueba", test: true, ttl: 600 },
    {
      device: typeof device === "string" && device.length >= 20 && device.length <= 4096 ? device : undefined,
      endpoint: typeof endpoint === "string" && endpoint.startsWith("https://") && endpoint.length <= 1000 ? endpoint : undefined,
    }
  );
  return json(200, { keys: { web: WEB_PUSH, firebase: !!FIREBASE }, ...report });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return reply(405);
  const address = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ?? "desconocida";
  if (tooMany(address)) return reply(429);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return reply(400);
  }
  if (body?.test === true) return sendTest(req, body.device, body.endpoint);
  if (!WEB_PUSH && !FIREBASE) return reply(503, "Faltan las llaves de notificaciones");
  const table = String(body?.table ?? "");
  const id = Number(body?.id);
  if (!Number.isSafeInteger(id) || id <= 0) return reply(400);

  const job =
    table === "chat_messages" ? await forMessage(id) : table === "notifications" ? await forNotification(id) : table === "calls" ? await forCall(id) : null;
  if (!job || job.users.length === 0) return reply(200, "nada que avisar");
  const { web, android } = await deliver(job.users.slice(0, 500), job.payload);
  return reply(200, `avisos: ${web.sent + android.sent}`);
});
