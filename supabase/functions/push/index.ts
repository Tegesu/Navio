// supabase/functions/push/index.ts
//
// Manda las notificaciones de Navio (mensajes, reacciones, llamadas y avisos)
// a los navegadores (notificaciones web) y a la app de Android (Firebase)
// donde cada persona las activó.
//
// La llama la base de datos (migraciones v26 a v28) cada vez que llega un
// mensaje, un aviso, una reacción o una invitación a una llamada. No confía
// en lo que recibe: lo lee por su cuenta, solo si es reciente y todavía no se
// ha avisado, y lo marca para no repetirlo. Por eso se despliega con la
// verificación de JWT apagada: quien la llame de fuera, como mucho adelanta
// un aviso que de todos modos iba a salir.
//
// Mensajes: los consecutivos de un chat se juntan en una sola notificación
// con los últimos 3; los stickers y GIF pequeños se ven en la vista previa.
// La app de Android 1.0.7 o más nueva arma la notificación ella misma (foto,
// "Responder" y "Marcar como leído"); a las anteriores les llega la sencilla.
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

// kind: message, call, alert o test. lines: los últimos mensajes del chat.
type Line = { name: string; text: string; at: number };
type Payload = {
  kind: "message" | "call" | "alert" | "test";
  title: string;
  body: string;
  url: string;
  tag?: string;
  channel?: string; // canal de Android
  ttl?: number; // segundos
  channelId?: number;
  group?: boolean;
  lines?: Line[];
  image?: string;
  imageMime?: string;
  avatar?: string;
  canReply?: boolean;
};
type Target = { userId: string; payload: Payload };

/* ---------- Ayudas ---------- */

const MAX_PREVIEW_BYTES = 1_000_000;
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const firstName = (name: string | null) => String(name ?? "Alguien").trim().split(/\s+/)[0] || "Alguien";

type Message = { id: number; senderId: string | null; senderName: string | null; body: string | null; kind: string | null; attachment: Record<string, unknown> | null; createdAt: string };

// Cómo se lee un mensaje en la notificación: con emoji si es un archivo.
function lineText(m: Message): string {
  const caption = m.body ? `: ${m.body}` : "";
  const a = m.attachment ?? {};
  switch (m.kind) {
    case "sticker":
      return "❤️ Sticker";
    case "image":
      return a.name === "GIF" || a.mime === "image/gif" ? `🎞️ GIF${caption}` : `📷 Foto${caption}`;
    case "video":
      return `🎬 Video${caption}`;
    case "voice":
      return "🎤 Nota de voz";
    case "file":
      return `📄 ${typeof a.name === "string" && a.name ? a.name : "Documento"}${caption}`;
    case "call":
      return "📞 Llamada";
    default:
      return String(m.body ?? "");
  }
}

// Sticker o GIF pequeño: enlace temporal para verlo en la vista previa.
async function previewImage(m: Message): Promise<{ url: string; mime: string } | null> {
  const a = m.attachment ?? {};
  const path = typeof a.path === "string" ? a.path : "";
  const isGif = m.kind === "image" && (a.name === "GIF" || a.mime === "image/gif");
  if (!path || !(m.kind === "sticker" || isGif)) return null;
  if (Number(a.size ?? 0) > MAX_PREVIEW_BYTES) return null;
  const { data } = await supabase.storage.from("chat").createSignedUrl(path, 3600);
  return data?.signedUrl ? { url: data.signedUrl, mime: typeof a.mime === "string" && a.mime.startsWith("image/") ? a.mime : "image/webp" } : null;
}

async function mutedUsers(channelId: number): Promise<Set<string>> {
  const { data } = await supabase.from("chat_members").select("userId, mutedAt").eq("channelId", channelId).not("mutedAt", "is", null);
  return new Set((data ?? []).map((m: { userId: string }) => m.userId));
}

/* ---------- Qué avisar y a quién ---------- */

async function claim(table: "chat_messages" | "notifications", id: number) {
  const since = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data } = await supabase.from(table).update({ pushedAt: new Date().toISOString() }).eq("id", id).is("pushedAt", null).gte("createdAt", since).select().maybeSingle();
  return data;
}

async function forMessage(id: number): Promise<Target[]> {
  const message = await claim("chat_messages", id);
  if (!message || message.deletedAt || !message.senderId) return [];
  // Si todavía no se aplica la v28, se piden solo las columnas de antes.
  let { data: channel, error: channelError } = await supabase.from("chat_channels").select("id, kind, name, companyId, postingMode").eq("id", message.channelId).maybeSingle();
  if (channelError) ({ data: channel } = await supabase.from("chat_channels").select("id, kind, name, companyId").eq("id", message.channelId).maybeSingle());
  if (!channel) return [];

  let { data: members, error: membersError } = await supabase.from("chat_members").select("userId, lastReadAt, mutedAt, canPost, isAdmin").eq("channelId", channel.id);
  if (membersError) ({ data: members } = await supabase.from("chat_members").select("userId, lastReadAt").eq("channelId", channel.id));
  const memberOf = new Map((members ?? []).map((m: { userId: string }) => [m.userId, m as { userId: string; lastReadAt: string | null; mutedAt: string | null; canPost: boolean; isAdmin: boolean }]));
  let users: string[];
  if (channel.kind === "general") {
    const { data } = await supabase.from("profiles").select("id").eq("companyId", channel.companyId);
    users = (data ?? []).map((p: { id: string }) => p.id);
  } else {
    users = [...memberOf.keys()];
  }
  users = users.filter((u) => u !== message.senderId && !memberOf.get(u)?.mutedAt);
  if (users.length === 0) return [];
  const url = `/?open=messages&sub=channel:${channel.id}`;
  const tag = `chat-${channel.id}`;
  const group = channel.kind !== "direct";
  const chatTitle = channel.kind === "general" ? "General" : channel.kind === "group" ? channel.name ?? "Grupo" : message.senderName ?? "Mensaje nuevo";

  // Llamadas: solo se avisa la perdida (la llamada en sí ya sonó).
  if (message.kind === "call") {
    if (message.attachment?.duration != null) return [];
    return users.map((userId) => ({
      userId,
      payload: {
        kind: "alert",
        title: `Llamada perdida de ${message.senderName ?? "alguien"}`,
        body: message.attachment?.call === "video" ? "Videollamada sin contestar" : "Llamada de voz sin contestar",
        url,
        tag,
        avatar: message.senderName ?? "",
      },
    }));
  }

  // Los últimos mensajes del chat (para juntar los seguidos en una notificación).
  const { data: recent } = await supabase
    .from("chat_messages")
    .select("id, senderId, senderName, body, kind, attachment, createdAt")
    .eq("channelId", channel.id)
    .is("deletedAt", null)
    .lte("id", message.id)
    .gte("createdAt", new Date(Date.now() - 24 * 3600_000).toISOString())
    .order("id", { ascending: false })
    .limit(8);
  const history = ((recent ?? []) as Message[]).reverse();
  const image = await previewImage(message as Message);
  const adminsOnly = group && channel.postingMode && channel.postingMode !== "all";

  return users.map((userId) => {
    const lastRead = memberOf.get(userId)?.lastReadAt ?? null;
    let mine = history.filter((m) => m.senderId && m.senderId !== userId && m.kind !== "call" && (!lastRead || m.createdAt > lastRead)).slice(-3);
    if (mine.length === 0) mine = [message as Message];
    const lines: Line[] = mine.map((m) => ({ name: m.senderName ?? "Alguien", text: clip(lineText(m), 300), at: Date.parse(m.createdAt) }));
    const body = lines.map((l) => (group ? `${firstName(l.name)}: ${l.text}` : l.text)).join("\n");
    const member = memberOf.get(userId);
    return {
      userId,
      payload: {
        kind: "message",
        title: group ? chatTitle : message.senderName ?? "Mensaje nuevo",
        body: clip(body, 480),
        url,
        tag,
        channelId: channel.id,
        group,
        lines,
        image: image?.url,
        imageMime: image?.mime,
        avatar: group ? chatTitle : message.senderName ?? "",
        // Donde solo escriben algunos, la respuesta desde el aviso puede no estar permitida.
        canReply: !adminsOnly || !!member?.isAdmin || (channel.postingMode === "selected" && !!member?.canPost),
      },
    };
  });
}

async function forReaction(messageId: number, reactorId: string): Promise<Target[]> {
  const since = new Date(Date.now() - 2 * 60_000).toISOString();
  const { data: reaction } = await supabase
    .from("chat_reactions")
    .update({ pushedAt: new Date().toISOString() })
    .eq("messageId", messageId)
    .eq("userId", reactorId)
    .is("pushedAt", null)
    .gte("createdAt", since)
    .select()
    .maybeSingle();
  if (!reaction) return [];
  const { data: message } = await supabase.from("chat_messages").select("id, senderId, senderName, body, kind, attachment, channelId, deletedAt, createdAt").eq("id", messageId).maybeSingle();
  if (!message?.senderId || message.senderId === reactorId || message.deletedAt) return [];
  if ((await mutedUsers(message.channelId)).has(message.senderId)) return [];
  const who = reaction.userName ?? "Alguien";
  return [
    {
      userId: message.senderId,
      payload: {
        kind: "alert",
        title: `${who} reaccionó ${reaction.emoji}`,
        body: `A tu mensaje: "${clip(lineText(message as Message), 90)}"`,
        url: `/?open=messages&sub=channel:${message.channelId}`,
        tag: `react-${messageId}`,
        avatar: who,
      },
    },
  ];
}

async function forNotification(id: number): Promise<Target[]> {
  const row = await claim("notifications", id);
  if (!row?.userId) return [];
  const link = row.link ?? {};
  const params = new URLSearchParams();
  if (link.tab) params.set("open", String(link.tab));
  if (link.sub) params.set("sub", String(link.sub));
  return [
    {
      userId: row.userId,
      payload: {
        kind: "alert",
        title: clip(String(row.title ?? "Navio"), 120),
        body: clip(String(row.body ?? ""), 200),
        url: params.toString() ? `/?${params}` : "/",
        tag: `aviso-${row.id}`,
        avatar: row.createdByName ?? "",
      },
    },
  ];
}

async function forCallInvite(id: number): Promise<Target[]> {
  const since = new Date(Date.now() - 60_000).toISOString();
  const { data: part } = await supabase
    .from("call_participants")
    .update({ pushedAt: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "ringing")
    .is("pushedAt", null)
    .gte("invitedAt", since)
    .select()
    .maybeSingle();
  if (!part) return [];
  const { data: call } = await supabase.from("calls").select("id, kind, channelId, callerName, status").eq("id", part.callId).maybeSingle();
  if (!call || !["ringing", "accepted"].includes(call.status)) return [];
  const { data: channel } = await supabase.from("chat_channels").select("kind, name").eq("id", call.channelId).maybeSingle();
  const inviter = part.invitedByName ?? call.callerName ?? "Alguien";
  const video = call.kind === "video";
  const group = channel?.kind === "group" || (call.status === "accepted" && part.invitedBy);
  return [
    {
      userId: part.userId,
      payload: {
        kind: "call",
        title: group ? `${inviter} te invita a una ${video ? "videollamada" : "llamada"}` : `${inviter} te está llamando`,
        body: group ? `${channel?.name ? `${channel.name} · ` : ""}toca para unirte` : video ? "Videollamada de Navio · toca para contestar" : "Llamada de voz de Navio · toca para contestar",
        url: `/?open=messages&sub=channel:${call.channelId}`,
        tag: `call-${call.id}`,
        channel: "navio_llamadas",
        ttl: 45,
        avatar: inviter,
      },
    },
  ];
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

// rich: la app arma la notificación (solo datos); si no, la arma Firebase.
async function sendFcm(account: ServiceAccount, token: string, payload: Payload, rich: boolean): Promise<{ result: string; code?: string }> {
  const access = await googleAccessToken(account);
  const ttl = `${payload.ttl ?? 3600}s`;
  const data: Record<string, string> = { url: payload.url };
  if (payload.kind === "test") data.test = "1";
  if (payload.channelId) data.channelId = String(payload.channelId);
  let message: Record<string, unknown>;
  if (rich) {
    data.navio = JSON.stringify(payload);
    message = { token, data, android: { priority: "HIGH", ttl } };
  } else {
    message = {
      token,
      notification: { title: payload.title, body: payload.body, ...(payload.image ? { image: payload.image } : {}) },
      data,
      android: {
        priority: "HIGH",
        ttl,
        notification: {
          tag: payload.tag,
          channel_id: payload.channel ?? "navio_mensajes",
          default_sound: true,
          default_vibrate_timings: true,
          notification_priority: payload.channel === "navio_llamadas" ? "PRIORITY_MAX" : "PRIORITY_HIGH",
          visibility: "PRIVATE",
        },
      },
    };
  }
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
    method: "POST",
    headers: { authorization: `Bearer ${access}`, "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (res.ok) return { result: "ok" };
  const err = await res.json().catch(() => ({}));
  const code = String(err?.error?.details?.find((d: { errorCode?: string }) => d.errorCode)?.errorCode ?? err?.error?.status ?? res.status);
  console.error("firebase:", res.status, code, err?.error?.message ?? "");
  return { result: res.status === 404 || code === "UNREGISTERED" ? "gone" : "error", code };
}

/* ---------- Envío ---------- */

type Report = { total: number; sent: number; errors: string[] };

// Lo que recibe el navegador (sw.js).
function webBody(payload: Payload): string {
  const call = payload.channel === "navio_llamadas";
  return JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url,
    tag: payload.tag,
    image: payload.image,
    channelId: payload.channelId,
    actions: payload.kind === "message" ? ["read", "open"] : [],
    skipIfVisible: payload.kind !== "test",
    requireInteraction: call,
  });
}

// only: para la prueba, solo este teléfono (device) o este navegador (endpoint).
async function deliver(targets: Target[], only: { device?: string; endpoint?: string } = {}) {
  const web: Report = { total: 0, sent: 0, errors: [] };
  const android: Report = { total: 0, sent: 0, errors: [] };
  const byUser = new Map(targets.map((t) => [t.userId, t.payload]));
  const users = [...byUser.keys()].slice(0, 500);
  if (users.length === 0) return { web, android };

  // Navegadores
  if (WEB_PUSH && !only.device) {
    let subsQuery = supabase.from("push_subscriptions").select("id, userId, endpoint, p256dh, auth").in("userId", users);
    if (only.endpoint) subsQuery = subsQuery.eq("endpoint", only.endpoint);
    const { data: subs } = await subsQuery;
    const gone: number[] = [];
    web.total = subs?.length ?? 0;
    await Promise.all(
      (subs ?? []).map(async (s: { id: number; userId: string; endpoint: string; p256dh: string; auth: string }) => {
        const payload = byUser.get(s.userId);
        if (!payload) return;
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, webBody(payload), { TTL: payload.ttl ?? 3600, urgency: "high" });
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
    let query = supabase.from("push_devices").select("id, userId, token, rich").in("userId", users);
    if (only.device) query = query.eq("token", only.device);
    let { data: devices, error } = await query;
    if (error) {
      // Antes de la v28 no existe la columna "rich".
      let fallback = supabase.from("push_devices").select("id, userId, token").in("userId", users);
      if (only.device) fallback = fallback.eq("token", only.device);
      ({ data: devices } = await fallback);
    }
    const gone: number[] = [];
    android.total = devices?.length ?? 0;
    await Promise.all(
      (devices ?? []).map(async (d: { id: number; userId: string; token: string; rich?: boolean }) => {
        const payload = byUser.get(d.userId);
        if (!payload) return;
        try {
          const { result, code } = await sendFcm(FIREBASE, d.token, payload, !!d.rich);
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
    [{ userId, payload: { kind: "test", title: "Prueba de Navio", body: "Si ves este aviso, las notificaciones funcionan en este equipo.", url: "/", tag: "prueba", ttl: 600, avatar: "Navio" } }],
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

  let targets: Target[] = [];
  if (table === "chat_reactions") {
    const messageId = Number(body?.messageId);
    const userId = String(body?.userId ?? "");
    if (!Number.isSafeInteger(messageId) || messageId <= 0 || !/^[0-9a-f-]{36}$/i.test(userId)) return reply(400);
    targets = await forReaction(messageId, userId);
  } else {
    const id = Number(body?.id);
    if (!Number.isSafeInteger(id) || id <= 0) return reply(400);
    targets =
      table === "chat_messages" ? await forMessage(id) : table === "notifications" ? await forNotification(id) : table === "call_participants" ? await forCallInvite(id) : [];
  }
  if (targets.length === 0) return reply(200, "nada que avisar");
  const { web, android } = await deliver(targets);
  return reply(200, `avisos: ${web.sent + android.sent}`);
});
