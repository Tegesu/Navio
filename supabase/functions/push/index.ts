// supabase/functions/push/index.ts
//
// Manda las notificaciones de Navio (mensajes nuevos y avisos) a los
// navegadores (notificaciones web) y a la app de Android (Firebase) donde
// cada persona las activó.
//
// La llama la base de datos (migración v26) con { table, id } cada vez que
// llega un mensaje o un aviso. No confía en lo que recibe: lee el mensaje o
// el aviso por su cuenta, solo si es de los últimos 5 minutos y todavía no se
// ha avisado, y lo marca para no repetirlo. Por eso se despliega con la
// verificación de JWT apagada: quien la llame de fuera, como mucho adelanta
// un aviso que de todos modos iba a salir.
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

type Payload = { title: string; body: string; url: string; tag?: string };

/* ---------- Qué avisar y a quién ---------- */

async function claim(table: "chat_messages" | "notifications", id: number) {
  const since = new Date(Date.now() - 5 * 60_000).toISOString();
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

// "ok", "gone" (el teléfono ya no existe) o "error".
async function sendFcm(account: ServiceAccount, token: string, payload: Payload): Promise<string> {
  const access = await googleAccessToken(account);
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
    method: "POST",
    headers: { authorization: `Bearer ${access}`, "content-type": "application/json" },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: payload.title, body: payload.body },
        data: { url: payload.url },
        android: { priority: "HIGH", notification: { tag: payload.tag, default_sound: true } },
      },
    }),
  });
  if (res.ok) return "ok";
  const err = await res.json().catch(() => ({}));
  const code = err?.error?.details?.find((d: { errorCode?: string }) => d.errorCode)?.errorCode ?? err?.error?.status;
  return res.status === 404 || code === "UNREGISTERED" ? "gone" : "error";
}

/* ---------- Envío ---------- */

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply(405);
  const address = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ?? "desconocida";
  if (tooMany(address)) return reply(429);
  if (!WEB_PUSH && !FIREBASE) return reply(503, "Faltan las llaves de notificaciones");

  let table = "";
  let id = 0;
  try {
    const body = await req.json();
    table = String(body?.table ?? "");
    id = Number(body?.id);
  } catch {
    return reply(400);
  }
  if (!Number.isSafeInteger(id) || id <= 0) return reply(400);

  const job = table === "chat_messages" ? await forMessage(id) : table === "notifications" ? await forNotification(id) : null;
  if (!job || job.users.length === 0) return reply(200, "nada que avisar");
  const users = job.users.slice(0, 500);
  let sent = 0;

  // Navegadores
  if (WEB_PUSH) {
    const { data: subs } = await supabase.from("push_subscriptions").select("id, endpoint, p256dh, auth").in("userId", users);
    const gone: number[] = [];
    await Promise.all(
      (subs ?? []).map(async (s: { id: number; endpoint: string; p256dh: string; auth: string }) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(job.payload), { TTL: 3600, urgency: "high" });
          sent += 1;
        } catch (err) {
          const code = (err as { statusCode?: number })?.statusCode;
          if (code === 404 || code === 410) gone.push(s.id); // el navegador ya no existe o se desactivó
        }
      })
    );
    if (gone.length) await supabase.from("push_subscriptions").delete().in("id", gone);
  }

  // App de Android
  if (FIREBASE) {
    const { data: devices } = await supabase.from("push_devices").select("id, token").in("userId", users);
    const gone: number[] = [];
    await Promise.all(
      (devices ?? []).map(async (d: { id: number; token: string }) => {
        try {
          const result = await sendFcm(FIREBASE, d.token, job.payload);
          if (result === "ok") sent += 1;
          else if (result === "gone") gone.push(d.id);
        } catch (err) {
          console.error("firebase:", (err as Error).message);
        }
      })
    );
    if (gone.length) await supabase.from("push_devices").delete().in("id", gone);
  }

  return reply(200, `avisos: ${sent}`);
});
