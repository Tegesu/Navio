import { useEffect, useMemo, useState } from "react";
import { supabase } from "./NavioDashboard.jsx";

/* ---------------------------------------------------------------------- */
/*  "Está escribiendo": un solo canal privado por chat ("typing:<chat>")   */
/* ---------------------------------------------------------------------- */
// Supabase da el mismo canal a quien pida el mismo nombre, así que aquí se
// reparte: la conversación abierta y la lista de chats escuchan el mismo
// canal sin pisarse. Solo pueden escucharlo y mandarlo quienes pueden leer el
// chat (migración v31). No se guarda nada.

export const TYPING_SEND_EVERY = 2500; // mientras se escribe, se repite el aviso
export const TYPING_TTL = 6000; // si no llega otro aviso, se quita solo
export const TYPING_IDLE = 4000; // sin teclear este tiempo, se avisa que ya no escribe

const hubs = new Map(); // channelId → hub
let sweepTimer = null;

function notify(hub) {
  const list = [...hub.others.values()];
  hub.listeners.forEach((cb) => cb(list));
}

function sweep() {
  const now = Date.now();
  let any = false;
  for (const hub of hubs.values()) {
    let changed = false;
    for (const [id, x] of hub.others) {
      if (x.until < now) {
        hub.others.delete(id);
        changed = true;
      }
    }
    if (changed) notify(hub);
    if (hub.others.size) any = true;
  }
  if (!any && sweepTimer) {
    window.clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

function open(channelId, myId) {
  const key = String(channelId);
  let hub = hubs.get(key);
  if (hub) return hub;
  hub = { key, myId, chan: null, ready: false, failed: false, refs: 0, listeners: new Set(), others: new Map(), closeTimer: null, last: { at: 0, kind: null } };
  hubs.set(key, hub);
  if (typeof supabase.channel !== "function") return hub;
  const chan = supabase.channel(`typing:${key}`, { config: { private: true, broadcast: { self: false } } });
  hub.chan = chan;
  chan.on("broadcast", { event: "typing" }, (message) => {
    const data = message?.payload;
    if (!data?.userId || String(data.userId) === String(hub.myId)) return;
    const userId = String(data.userId);
    if (data.kind === "text" || data.kind === "voice") {
      hub.others.set(userId, { userId, name: String(data.name ?? "").slice(0, 40), kind: data.kind, until: Date.now() + TYPING_TTL });
      if (!sweepTimer) sweepTimer = window.setInterval(sweep, 1000);
    } else {
      hub.others.delete(userId); // dejó de escribir
    }
    notify(hub);
  });
  chan.subscribe((status, err) => {
    hub.ready = status === "SUBSCRIBED";
    // Sin permiso (falta la v31): se deja de intentar con este chat.
    if (status === "CHANNEL_ERROR" && /unauthori|permission|denied|forbidden/i.test(err?.message ?? "")) {
      hub.ready = false;
      hub.failed = true;
      supabase.removeChannel(chan);
      hub.chan = null;
    }
  });
  return hub;
}

function release(hub) {
  hub.refs -= 1;
  if (hub.refs > 0) return;
  // Se cierra un momento después: al cambiar de pantalla, quien sigue lo reusa.
  window.clearTimeout(hub.closeTimer);
  hub.closeTimer = window.setTimeout(() => {
    if (hub.refs > 0) return;
    if (hub.ready && hub.last.kind) hub.chan?.send({ type: "broadcast", event: "typing", payload: { userId: hub.myId, kind: null } })?.catch?.(() => {});
    if (hub.chan) supabase.removeChannel(hub.chan);
    hubs.delete(hub.key);
  }, 1500);
}

// Escucha un chat. cb recibe la lista de quienes escriben ahí.
export function watchTyping(channelId, myId, cb) {
  if (!channelId || !myId) return () => {};
  const hub = open(channelId, myId);
  hub.myId = myId;
  hub.refs += 1;
  window.clearTimeout(hub.closeTimer);
  hub.listeners.add(cb);
  cb([...hub.others.values()]);
  return () => {
    hub.listeners.delete(cb);
    release(hub);
  };
}

// kind: "text" (escribe), "voice" (graba un audio) o null (ya no).
export function sendTyping(channelId, myId, myName, kind) {
  const hub = hubs.get(String(channelId));
  if (!hub?.chan || !hub.ready) return;
  const now = Date.now();
  if (kind === hub.last.kind && (kind === null || now - hub.last.at < TYPING_SEND_EVERY)) return;
  hub.last = { at: now, kind };
  hub.chan.send({ type: "broadcast", event: "typing", payload: { userId: myId, name: myName, kind } })?.catch?.(() => {});
}

// Quienes escriben en un chat (para la conversación abierta).
export function useTypingIn(channelId, myId) {
  const [others, setOthers] = useState([]);
  useEffect(() => {
    setOthers([]);
    return watchTyping(channelId, myId, setOthers);
  }, [channelId, myId]);
  return others;
}

// Quienes escriben en varios chats a la vez (para la lista de chats).
// Devuelve { [channelId]: [{ userId, name, kind }] }.
export function useTypingMany(channelIds, myId) {
  const [map, setMap] = useState({});
  const key = channelIds.join(",");
  useEffect(() => {
    if (!myId || !key) return undefined;
    const offs = key.split(",").map((id) =>
      watchTyping(id, myId, (list) =>
        setMap((prev) => {
          if (!list.length && !prev[id]) return prev;
          const next = { ...prev };
          if (list.length) next[id] = list;
          else delete next[id];
          return next;
        })
      )
    );
    return () => offs.forEach((off) => off());
  }, [key, myId]);
  return useMemo(() => map, [map]);
}

export const firstName = (name) => String(name ?? "").trim().split(/\s+/)[0].slice(0, 30);

// "Johana está escribiendo", "Johana y Luis están escribiendo"…
export function typingLabel(people, { short = false } = {}) {
  if (!people?.length) return "";
  const voice = people.length === 1 && people[0].kind === "voice";
  if (short) return voice ? "Grabando un audio…" : "Escribiendo…";
  const names = people.map((p) => p.name || "Alguien");
  if (people.length === 1) return `${names[0]} está ${voice ? "grabando un audio" : "escribiendo"}…`;
  if (people.length === 2) return `${names[0]} y ${names[1]} están escribiendo…`;
  return `${people.length} personas están escribiendo…`;
}
