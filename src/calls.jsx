import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Link as LinkIcon, Maximize2, Mic, MicOff, MoreVertical, Phone, PhoneOff, ScreenShare, SwitchCamera, UserPlus, Video, VideoOff } from "lucide-react";
import { supabase, useAuth, useToast, avatarUrl, Modal } from "./NavioDashboard.jsx";
import { usePermissionGate } from "./permissions.jsx";
import { useBackLayer } from "./history.js";
import { useInbox } from "./inbox.jsx";
import { usePeople, personName } from "./people.jsx";

/* ---------------------------------------------------------------------- */
/*  Llamadas y videollamadas (de 2 a 8 personas de la empresa)            */
/* ---------------------------------------------------------------------- */
//
// La voz y el video van directo entre los teléfonos y computadoras (WebRTC,
// cifrado); cada par de personas tiene su propia conexión. La base de datos
// (migración v28) solo "toca la puerta": quién está en la llamada
// (call_participants) y los datos para conectar a cada par (call_signals).
// La llamada abre en una ventana flotante para seguir trabajando; se puede
// ampliar a pantalla completa.

const CallContext = createContext({ available: false, busy: false, start: () => {} });
export const useCalls = () => useContext(CallContext);

const RING_MS = 45000; // quien llama deja de esperar
const INCOMING_MAX_AGE_MS = 60000; // una invitación más vieja ya no suena
const CONNECT_MS = 25000;
const GONE = ["left", "declined", "missed", "busy"];
const STUN = [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }];
// Sin esto, Android muestra un dibujo de "video" mientras carga la imagen.
const BLANK_POSTER = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

const supported = () => typeof window !== "undefined" && "RTCPeerConnection" in window && !!navigator.mediaDevices?.getUserMedia;
const canShareScreen = () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia && !/android|iphone|ipad/i.test(navigator.userAgent);

export const callDuration = (seconds) => {
  const s = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${m}:${rest}`;
};

let iceCache = { servers: null, until: 0 };
async function iceServers() {
  if (iceCache.servers && Date.now() < iceCache.until) return iceCache.servers;
  try {
    const { data, error } = await supabase.functions.invoke("calls", { body: { action: "ice" } });
    if (!error && Array.isArray(data?.iceServers) && data.iceServers.length) {
      iceCache = { servers: data.iceServers, until: Date.now() + 60 * 60000 };
      return data.iceServers;
    }
  } catch {
    // Sin la función: solo STUN.
  }
  iceCache = { servers: STUN, until: Date.now() + 10 * 60000 };
  return STUN;
}

function gatherCandidates(pc, ms = 2500) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    let timer = null;
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", check);
      window.clearTimeout(timer);
      resolve();
    };
    const check = () => pc.iceGatheringState === "complete" && done();
    pc.addEventListener("icegatheringstatechange", check);
    timer = window.setTimeout(done, ms);
  });
}

const constraints = (kind, facing = "user") => ({
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  video: kind === "video" ? { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } } : false,
});

// Tono de "llamando" y timbre, hechos aquí mismo.
function playTone(kind) {
  let ctx = null;
  let timer = null;
  let stopped = false;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    ctx = Ctx ? new Ctx() : null;
    ctx?.resume?.().catch(() => {});
  } catch {
    ctx = null;
  }
  const beep = (freqs, seconds, volume) => {
    if (!ctx || stopped) return;
    try {
      const t = ctx.currentTime;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(volume, t + 0.03);
      gain.gain.setValueAtTime(volume, t + seconds - 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
      gain.connect(ctx.destination);
      for (const f of freqs) {
        const osc = ctx.createOscillator();
        osc.frequency.value = f;
        osc.connect(gain);
        osc.start(t);
        osc.stop(t + seconds);
      }
    } catch {
      // Sin sonido.
    }
  };
  const vibrate = (pattern) => {
    try {
      navigator.vibrate?.(pattern);
    } catch {
      // Sin vibración.
    }
  };
  const cycle = () => {
    if (stopped) return;
    if (kind === "ringback") {
      beep([425], 1, 0.08);
      timer = window.setTimeout(cycle, 5000);
    } else {
      beep([480, 620], 0.4, 0.2);
      window.setTimeout(() => beep([480, 620], 0.4, 0.2), 600);
      vibrate([400, 200, 400]);
      timer = window.setTimeout(cycle, 2800);
    }
  };
  cycle();
  return () => {
    stopped = true;
    window.clearTimeout(timer);
    if (kind === "ringtone") vibrate(0);
    ctx?.close?.().catch(() => {});
  };
}

let callSeq = 0;
let channelSeq = 0;

export function CallProvider({ children }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const inbox = useInbox();
  const userId = user?.id ?? null;
  const [available, setAvailable] = useState(false);
  const [call, setCallState] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [peerView, setPeerView] = useState({}); // userId → { stream, state, tick }
  const [localStream, setLocalStream] = useState(null);
  const [joinPrompt, setJoinPrompt] = useState(null); // enlace compartido
  const [inviting, setInviting] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const callRef = useRef(null);
  const peers = useRef(new Map()); // userId → { pc, remote, makingOffer }
  const localRef = useRef(null);
  const cameraTrack = useRef(null);
  const screenTrack = useRef(null);
  const toneRef = useRef(null);
  const timers = useRef([]);
  const endTimer = useRef(null);
  const handledInvites = useRef(new Set());
  const handledSignals = useRef(new Set());
  const signalQueue = useRef(Promise.resolve());
  const signalBaseline = useRef(0);
  const participantsRef = useRef([]);
  const tokenRef = useRef(null);
  const serversRef = useRef(STUN);
  const mic = usePermissionGate("microphone");
  const cam = usePermissionGate("camera");

  const setCall = (value) => {
    callRef.current = value;
    setCallState(value);
  };
  const patchCall = (patch) => {
    if (!callRef.current) return;
    setCall({ ...callRef.current, ...patch });
  };
  const alive = (key) => callRef.current?.key === key && callRef.current.phase !== "ended";
  const later = (fn, ms) => timers.current.push(window.setTimeout(fn, ms));
  useEffect(() => {
    participantsRef.current = participants;
  }, [participants]);
  const updatePeer = (id, patch) => setPeerView((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...patch } }));

  function stopTone() {
    toneRef.current?.();
    toneRef.current = null;
  }
  function startTone(kind) {
    stopTone();
    toneRef.current = playTone(kind);
  }
  async function rememberToken() {
    try {
      tokenRef.current = (await supabase.auth.getSession()).data.session?.access_token ?? null;
    } catch {
      tokenRef.current = null;
    }
  }

  function closePeer(id) {
    const entry = peers.current.get(id);
    if (!entry) return;
    try {
      entry.pc.close();
    } catch {
      // Ya estaba cerrada.
    }
    peers.current.delete(id);
    setPeerView((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function teardown(text) {
    stopTone();
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    for (const id of [...peers.current.keys()]) closePeer(id);
    localRef.current?.getTracks().forEach((t) => t.stop());
    screenTrack.current?.stop();
    screenTrack.current = null;
    cameraTrack.current = null;
    localRef.current = null;
    setLocalStream(null);
    setPeerView({});
    setInviting(false);
    if (!callRef.current) return;
    const key = callRef.current.key;
    patchCall({ phase: "ended", endText: text, reconnecting: false });
    window.clearTimeout(endTimer.current);
    endTimer.current = window.setTimeout(() => {
      if (callRef.current?.key === key && callRef.current.phase === "ended") {
        setCall(null);
        setParticipants([]);
      }
    }, 1800);
  }

  async function leave(reason = "left", text) {
    const current = callRef.current;
    if (!current || current.phase === "ended") return;
    teardown(text ?? (current.phase === "incoming" ? "Llamada rechazada" : reason === "missed" ? "No contestaron" : "Llamada terminada"));
    if (current.id) {
      const { error } = await supabase.rpc("call_leave", { target_call: current.id, reason });
      if (error) console.warn("call_leave:", error.message);
    }
  }

  // ---------- Conexiones con cada persona ----------
  function onPeerState(id, pc) {
    const current = callRef.current;
    if (!current || current.phase === "ended" || peers.current.get(id)?.pc !== pc) return;
    const state = pc.connectionState || pc.iceConnectionState;
    if (state === "connected" || state === "completed") {
      updatePeer(id, { state: "connected" });
      if (current.phase !== "active" || !current.since) {
        stopTone();
        patchCall({ phase: "active", since: current.since ?? Date.now() });
      }
    } else if (state === "disconnected") {
      updatePeer(id, { state: "reconnecting" });
    } else if (state === "failed") {
      updatePeer(id, { state: "failed" });
    }
  }

  function makePeer(id) {
    const pc = new RTCPeerConnection({ iceServers: serversRef.current });
    const remote = new MediaStream();
    pc.addEventListener("track", (event) => {
      if (!remote.getTracks().includes(event.track)) remote.addTrack(event.track);
      event.track.addEventListener("ended", () => {
        remote.removeTrack(event.track);
        updatePeer(id, { tick: Date.now() });
      });
      event.track.addEventListener("unmute", () => updatePeer(id, { tick: Date.now() }));
      updatePeer(id, { stream: remote, tick: Date.now() });
    });
    pc.addEventListener("connectionstatechange", () => onPeerState(id, pc));
    pc.addEventListener("iceconnectionstatechange", () => onPeerState(id, pc));
    const local = localRef.current;
    if (local) {
      for (const track of local.getTracks()) {
        if (track.kind === "video" && screenTrack.current) pc.addTrack(screenTrack.current, local);
        else pc.addTrack(track, local);
      }
      if (screenTrack.current && !local.getVideoTracks().length) pc.addTrack(screenTrack.current, local);
    }
    peers.current.set(id, { pc, remote, makingOffer: false });
    updatePeer(id, { stream: remote, state: "connecting" });
    return pc;
  }

  async function sendOffer(id) {
    const current = callRef.current;
    const entry = peers.current.get(id);
    if (!current?.id || !entry) return;
    entry.makingOffer = true;
    try {
      await entry.pc.setLocalDescription(await entry.pc.createOffer());
      await gatherCandidates(entry.pc);
      if (peers.current.get(id) !== entry) return;
      const { error } = await supabase.rpc("call_signal", { target_call: current.id, to_user: id, signal_kind: "offer", signal_sdp: entry.pc.localDescription.sdp });
      if (error) console.warn("call_signal:", error.message);
    } finally {
      entry.makingOffer = false;
    }
  }

  async function handleSignal(row) {
    const current = callRef.current;
    if (!row || !current?.id || Number(row.callId) !== Number(current.id) || row.toUser !== userId || handledSignals.current.has(row.id)) return;
    if (row.id <= signalBaseline.current) return;
    handledSignals.current.add(row.id);
    if (!localRef.current) return; // todavía no contesto
    const from = row.fromUser;
    if (row.kind === "offer") {
      let entry = peers.current.get(from);
      if (entry && (entry.makingOffer || entry.pc.signalingState === "have-local-offer")) {
        // Los dos ofrecieron a la vez: cede quien tiene el número mayor.
        if (!(userId > from)) return;
        closePeer(from);
        entry = null;
      }
      const pc = entry?.pc ?? makePeer(from);
      try {
        await pc.setRemoteDescription({ type: "offer", sdp: row.sdp });
        await pc.setLocalDescription(await pc.createAnswer());
        await gatherCandidates(pc);
        if (peers.current.get(from)?.pc !== pc) return;
        await supabase.rpc("call_signal", { target_call: current.id, to_user: from, signal_kind: "answer", signal_sdp: pc.localDescription.sdp });
      } catch (err) {
        console.warn("oferta:", err?.message);
      }
    } else if (row.kind === "answer") {
      const entry = peers.current.get(from);
      if (entry && entry.pc.signalingState === "have-local-offer") {
        try {
          await entry.pc.setRemoteDescription({ type: "answer", sdp: row.sdp });
        } catch (err) {
          console.warn("respuesta:", err?.message);
        }
      }
    }
  }
  const queueSignal = (row) => {
    signalQueue.current = signalQueue.current.then(() => handleSignal(row)).catch(() => {});
  };

  // Lo que dice la base de quién está en la llamada.
  function applyParticipant(row) {
    const current = callRef.current;
    if (!row || !current?.id || Number(row.callId) !== Number(current.id)) return;
    setParticipants((prev) => {
      const rest = prev.filter((p) => p.userId !== row.userId);
      return [...rest, row];
    });
    if (row.userId === userId) {
      if (GONE.includes(row.status) && current.phase !== "incoming" && current.phase !== "ended") teardown("Llamada terminada");
      return;
    }
    if (GONE.includes(row.status)) {
      closePeer(row.userId);
      window.setTimeout(checkAlone, 300);
    } else if (row.status === "joined" && current.phase === "outgoing") {
      stopTone();
      patchCall({ phase: "connecting" });
      later(() => {
        if (alive(current.key) && callRef.current.phase === "connecting") leave("left", "No se pudo conectar. La red no lo permitió.");
      }, CONNECT_MS);
    }
  }

  // Si ya no queda nadie más, la llamada termina.
  function checkAlone() {
    const current = callRef.current;
    if (!current || current.phase === "ended" || current.phase === "incoming" || current.phase === "preparing") return;
    const others = participantsRef.current.filter((p) => p.userId !== userId);
    const fresh = (p) => p.status === "ringing" && Date.now() - Date.parse(p.invitedAt) < INCOMING_MAX_AGE_MS;
    if (others.some((p) => p.status === "joined" || fresh(p))) return;
    const someoneAnswered = others.some((p) => p.joinedAt);
    leave(
      "left",
      someoneAnswered ? "Llamada terminada" : others.some((p) => p.status === "declined") ? "No pueden contestar ahora" : others.some((p) => p.status === "busy") ? "Está en otra llamada" : "No contestaron"
    );
  }

  async function loadParticipants(id) {
    const { data } = await supabase.from("call_participants").select("*").eq("callId", id);
    if (callRef.current?.id === id && data) {
      setParticipants(data);
      return data;
    }
    return data ?? [];
  }

  async function getMedia(kind) {
    const media = await navigator.mediaDevices.getUserMedia(constraints(kind));
    localRef.current = media;
    cameraTrack.current = media.getVideoTracks()[0] ?? null;
    setLocalStream(media);
    return media;
  }

  const titleFor = (channelId, fallback) => {
    const ch = (inbox?.channels ?? []).find((c) => Number(c.id) === Number(channelId));
    if (!ch) return fallback;
    return ch.kind === "direct" ? ch.otherUserName || fallback : ch.name || fallback;
  };

  // ---------- Llamar ----------
  async function dial(channel, kind) {
    const key = ++callSeq;
    setParticipants([]);
    setCall({
      key,
      id: null,
      kind,
      channelId: channel.id,
      title: channel.kind === "direct" ? channel.otherUserName || "Contacto" : channel.name || "Grupo",
      group: channel.kind === "group",
      phase: "preparing",
      view: "float",
      muted: false,
      cameraOff: false,
      facing: "user",
      sharing: false,
    });
    rememberToken();
    try {
      const [, servers] = await Promise.all([getMedia(kind), iceServers()]);
      serversRef.current = servers;
      if (!alive(key)) return;
      const { data, error } = await supabase.rpc("call_open", { target_channel: channel.id, call_kind: kind });
      if (error) throw new Error(error.message);
      const row = Array.isArray(data) ? data[0] : data;
      if (!alive(key)) {
        if (row?.id) supabase.rpc("call_leave", { target_call: row.id, reason: "left" });
        return;
      }
      handledSignals.current = new Set();
      signalBaseline.current = 0;
      patchCall({ id: row.id, phase: "outgoing" });
      await loadParticipants(row.id);
      startTone("ringback");
      later(() => alive(key) && callRef.current.phase === "outgoing" && leave("missed", "No contestaron"), RING_MS);
    } catch (err) {
      if (!alive(key)) return;
      if (err?.name === "NotAllowedError" || err?.name === "SecurityError") {
        teardown("Falta el permiso");
        setCall(null);
        (kind === "video" ? cam : mic).explain("denied", () => start(channel, kind));
        return;
      }
      teardown(err?.name === "NotFoundError" ? "No se encontró micrófono o cámara." : err?.message && !/^Failed|TypeError/.test(err.message) ? err.message : "No se pudo iniciar la llamada.");
    }
  }

  const start = (channel, kind = "audio") => {
    if (!available || !channel?.id) return;
    if (callRef.current && callRef.current.phase !== "ended") {
      if (callRef.current.view === "float") patchCall({ view: "full" });
      showToast("Ya estás en una llamada.");
      return;
    }
    const go = () => dial(channel, kind);
    if (kind === "video") mic.run(() => cam.run(go));
    else mic.run(go);
  };

  // ---------- Recibir ----------
  async function ring(invite) {
    if (!invite || invite.userId !== userId || invite.status !== "ringing" || handledInvites.current.has(`${invite.callId}:${invite.invitedAt}`)) return;
    const age = Date.now() - Date.parse(invite.invitedAt);
    if (age > INCOMING_MAX_AGE_MS) return;
    handledInvites.current.add(`${invite.callId}:${invite.invitedAt}`);
    if (callRef.current && callRef.current.phase !== "ended") {
      if (Number(callRef.current.id) !== Number(invite.callId)) supabase.rpc("call_leave", { target_call: invite.callId, reason: "busy" });
      return;
    }
    const { data: info } = await supabase.from("calls").select("*").eq("id", invite.callId).maybeSingle();
    if (!info || !["ringing", "accepted"].includes(info.status)) return;
    const key = ++callSeq;
    const group = (inbox?.channels ?? []).find((c) => Number(c.id) === Number(info.channelId))?.kind === "group";
    setParticipants([]);
    setCall({
      key,
      id: info.id,
      kind: info.kind === "video" ? "video" : "audio",
      channelId: info.channelId,
      title: group ? titleFor(info.channelId, "Grupo") : invite.invitedByName || info.callerName || "Alguien",
      inviter: invite.invitedByName || info.callerName || "Alguien",
      group,
      phase: "incoming",
      view: "float",
      muted: false,
      cameraOff: false,
      facing: "user",
      sharing: false,
    });
    loadParticipants(info.id);
    startTone("ringtone");
    later(() => {
      if (alive(key) && callRef.current.phase === "incoming") {
        teardown("Llamada perdida");
        supabase.rpc("call_leave", { target_call: info.id, reason: "missed" });
      }
    }, Math.max(5000, INCOMING_MAX_AGE_MS - Math.max(0, age) - 5000));
  }

  // Contestar (o unirse con el enlace): entra y conecta con quienes ya están.
  async function join() {
    const current = callRef.current;
    if (!current || (current.phase !== "incoming" && current.phase !== "joining")) return;
    const { key, id, kind } = current;
    stopTone();
    patchCall({ phase: "connecting" });
    rememberToken();
    try {
      const [, servers] = await Promise.all([localRef.current ? null : getMedia(kind), iceServers()]);
      serversRef.current = servers;
      if (!alive(key)) {
        localRef.current?.getTracks().forEach((t) => t.stop());
        return;
      }
      // Lo que ya estaba en la bandeja para mí no cuenta.
      const { data: last } = await supabase.from("call_signals").select("id").eq("toUser", userId).order("id", { ascending: false }).limit(1);
      signalBaseline.current = last?.[0]?.id ?? 0;
      handledSignals.current = new Set();
      const { error } = await supabase.rpc("call_join", { target_call: id });
      if (error) {
        teardown(/terminó/i.test(error.message) ? "La llamada ya terminó." : error.message);
        return;
      }
      const list = await loadParticipants(id);
      const others = (list ?? []).filter((p) => p.userId !== userId && p.status === "joined");
      for (const p of others) {
        makePeer(p.userId);
        await sendOffer(p.userId);
      }
      later(() => {
        if (alive(key) && callRef.current.phase === "connecting") leave("left", "No se pudo conectar. La red no lo permitió.");
      }, CONNECT_MS);
    } catch (err) {
      if (!alive(key)) return;
      if (err?.name === "NotAllowedError" || err?.name === "SecurityError") {
        localRef.current = null;
        patchCall({ phase: current.phase });
        (kind === "video" ? cam : mic).explain("denied", accept);
        return;
      }
      leave("left", "No se pudo contestar la llamada.");
    }
  }

  const accept = () => {
    const current = callRef.current;
    if (!current || (current.phase !== "incoming" && current.phase !== "joining")) return;
    if (current.kind === "video") mic.run(() => cam.run(join));
    else mic.run(join);
  };

  // Enlace compartido: /?call=<id>
  async function openJoinPrompt(id) {
    if (!id || (callRef.current && callRef.current.phase !== "ended")) return;
    const { data } = await supabase.rpc("call_preview", { target_call: id });
    const info = Array.isArray(data) ? data[0] : data;
    if (!info || !["ringing", "accepted"].includes(info.status)) {
      showToast("Esa llamada ya terminó.");
      return;
    }
    setJoinPrompt(info);
  }
  function acceptPrompt() {
    const info = joinPrompt;
    setJoinPrompt(null);
    if (!info) return;
    setCall({
      key: ++callSeq,
      id: info.id,
      kind: info.kind === "video" ? "video" : "audio",
      channelId: info.channelId,
      title: titleFor(info.channelId, `Llamada de ${info.callerName || "Navio"}`),
      group: true,
      phase: "joining",
      view: "float",
      muted: false,
      cameraOff: false,
      facing: "user",
      sharing: false,
    });
    window.setTimeout(accept, 0);
  }

  // ---------- Controles ----------
  function toggleMute() {
    const track = localRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    patchCall({ muted: !track.enabled });
  }
  function toggleCamera() {
    const track = cameraTrack.current;
    if (!track) return;
    track.enabled = !track.enabled;
    patchCall({ cameraOff: !track.enabled });
  }
  async function replaceVideo(track) {
    for (const [id, entry] of peers.current) {
      const sender = entry.pc.getSenders().find((s) => s.track?.kind === "video");
      if (sender) await sender.replaceTrack(track);
      else if (track) {
        entry.pc.addTrack(track, localRef.current);
        await sendOffer(id);
      }
    }
  }
  async function switchCamera() {
    const current = callRef.current;
    const media = localRef.current;
    if (!current || !media) return;
    const facing = current.facing === "user" ? "environment" : "user";
    const old = cameraTrack.current;
    try {
      old?.stop();
      const fresh = await navigator.mediaDevices.getUserMedia({ video: constraints("video", facing).video });
      const track = fresh.getVideoTracks()[0];
      track.enabled = !current.cameraOff;
      if (old) media.removeTrack(old);
      media.addTrack(track);
      cameraTrack.current = track;
      if (!screenTrack.current) await replaceVideo(track);
      setLocalStream(new MediaStream(media.getTracks()));
      patchCall({ facing });
    } catch {
      showToast("No se pudo cambiar de cámara.");
    }
  }
  async function toggleScreen() {
    const current = callRef.current;
    if (!current) return;
    if (screenTrack.current) {
      const track = screenTrack.current;
      screenTrack.current = null;
      track.stop();
      if (cameraTrack.current) await replaceVideo(cameraTrack.current);
      else
        for (const [id, entry] of peers.current) {
          const sender = entry.pc.getSenders().find((s) => s.track === track);
          if (sender) {
            entry.pc.removeTrack(sender);
            await sendOffer(id);
          }
        }
      setLocalStream(localRef.current ? new MediaStream(localRef.current.getTracks()) : null);
      patchCall({ sharing: false });
      return;
    }
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const track = display.getVideoTracks()[0];
      screenTrack.current = track;
      track.addEventListener("ended", () => screenTrack.current === track && toggleScreen());
      await replaceVideo(track);
      setLocalStream(new MediaStream([...(localRef.current?.getAudioTracks() ?? []), track]));
      patchCall({ sharing: true, view: "float" });
      showToast("Estás compartiendo tu pantalla.");
    } catch {
      // Se canceló la selección de pantalla.
    }
  }
  async function shareLink() {
    const current = callRef.current;
    if (!current?.id) return;
    const url = `${window.location.origin}/?call=${current.id}`;
    try {
      if (navigator.share && /android|iphone|ipad/i.test(navigator.userAgent)) await navigator.share({ title: "Llamada de Navio", text: "Únete a la llamada en Navio", url });
      else {
        await navigator.clipboard.writeText(url);
        showToast("Enlace copiado: compártelo con alguien de tu empresa para que se una.");
      }
    } catch {
      // Se canceló.
    }
  }
  async function invite(ids) {
    const current = callRef.current;
    if (!current?.id || ids.length === 0) return;
    const { error } = await supabase.rpc("call_invite", { target_call: current.id, user_ids: ids });
    if (error) showToast(error.message);
    else {
      showToast(ids.length === 1 ? "Llamando a la persona…" : `Llamando a ${ids.length} personas…`);
      loadParticipants(current.id);
    }
  }

  // ---------- Disponibilidad, tiempo real y revisiones ----------
  useEffect(() => {
    if (!userId || !supported()) {
      setAvailable(false);
      return undefined;
    }
    let live = true;
    supabase
      .from("call_participants")
      .select("id")
      .limit(1)
      .then(({ error }) => live && setAvailable(!error));
    return () => {
      live = false;
    };
  }, [userId]);

  const ringRef = useRef(ring);
  const applyRef = useRef(applyParticipant);
  const signalRef = useRef(queueSignal);
  ringRef.current = ring;
  applyRef.current = applyParticipant;
  signalRef.current = queueSignal;
  const teardownRef = useRef(teardown);
  teardownRef.current = teardown;
  const promptRef = useRef(openJoinPrompt);
  promptRef.current = openJoinPrompt;

  useEffect(() => {
    if (!userId || !available) return undefined;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      const current = callRef.current;
      if (current?.id && current.phase !== "ended") return;
      const since = new Date(Date.now() - INCOMING_MAX_AGE_MS).toISOString();
      const { data } = await supabase
        .from("call_participants")
        .select("*")
        .eq("userId", userId)
        .eq("status", "ringing")
        .gte("invitedAt", since)
        .order("invitedAt", { ascending: false })
        .limit(1);
      if (data?.[0]) ringRef.current(data[0]);
    };
    const channel = supabase
      .channel(`calls-${++channelSeq}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "call_participants" }, (payload) => {
        const row = payload.new;
        if (!row) return;
        if (row.userId === userId && row.status === "ringing") ringRef.current(row);
        applyRef.current(row);
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "call_signals" }, (payload) => signalRef.current(payload.new))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "calls" }, (payload) => {
        const row = payload.new;
        const current = callRef.current;
        if (row && current?.id && Number(row.id) === Number(current.id) && !["ringing", "accepted"].includes(row.status) && current.phase !== "ended") {
          teardownRef.current(current.phase === "incoming" ? "Llamada perdida" : "Llamada terminada");
        }
      })
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") window.setTimeout(() => setEpoch((n) => n + 1), 4000);
      });
    const resume = () => {
      check();
      if (channel.state && channel.state !== "joined" && channel.state !== "joining") setEpoch((n) => n + 1);
    };
    check();
    // Enlace para unirse a una llamada.
    const params = new URLSearchParams(window.location.search);
    const shared = Number(params.get("call"));
    if (shared) {
      params.delete("call");
      const rest = params.toString();
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${rest ? `?${rest}` : ""}`);
      promptRef.current(shared);
    }
    const onMessage = (event) => {
      if (event.data?.type !== "navio:open") return;
      try {
        const id = Number(new URL(event.data.url, window.location.origin).searchParams.get("call"));
        if (id) promptRef.current(id);
      } catch {
        // Dirección no válida.
      }
    };
    window.addEventListener("message", onMessage);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    return () => {
      window.removeEventListener("message", onMessage);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      supabase.removeChannel(channel);
    };
  }, [userId, available, epoch]);

  // Durante la llamada se revisa también cada 3 s (por si el tiempo real se atrasa).
  const callId = call?.id;
  const phase = call?.phase;
  useEffect(() => {
    if (!callId || !phase || phase === "ended") return undefined;
    const timer = window.setInterval(async () => {
      const [{ data: list }, { data: signals }, { data: info }] = await Promise.all([
        supabase.from("call_participants").select("*").eq("callId", callId),
        localRef.current
          ? supabase.from("call_signals").select("*").eq("callId", callId).eq("toUser", userId).gt("id", signalBaseline.current).order("id", { ascending: true }).limit(50)
          : Promise.resolve({ data: [] }),
        supabase.from("calls").select("id, status").eq("id", callId).maybeSingle(),
      ]);
      (list ?? []).forEach((row) => applyRef.current(row));
      (signals ?? []).forEach((row) => signalRef.current(row));
      if (info && !["ringing", "accepted"].includes(info.status) && callRef.current?.id === callId && callRef.current.phase !== "ended") {
        teardownRef.current(callRef.current.phase === "incoming" ? "Llamada perdida" : "Llamada terminada");
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [callId, phase, userId]);

  // Si se cierra Navio en plena llamada, se sale de ella.
  useEffect(() => {
    const onHide = () => {
      const current = callRef.current;
      if (!current?.id || current.phase === "ended" || current.phase === "incoming" || !tokenRef.current) return;
      try {
        fetch(`${supabase.supabaseUrl}/rest/v1/rpc/call_leave`, {
          method: "POST",
          keepalive: true,
          headers: { apikey: supabase.supabaseKey, authorization: `Bearer ${tokenRef.current}`, "content-type": "application/json" },
          body: JSON.stringify({ target_call: current.id, reason: "left" }),
        });
      } catch {
        // Sin red.
      }
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  useEffect(() => {
    if (!userId && callRef.current) teardown("Llamada terminada");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const busy = !!call && call.phase !== "ended";
  const startRef = useRef(start);
  startRef.current = start;
  const stableStart = useCallback((channel, kind) => startRef.current(channel, kind), []);
  const value = useMemo(() => ({ available, busy, start: stableStart }), [available, busy, stableStart]);

  const others = participants.filter((p) => p.userId !== userId && !GONE.includes(p.status));

  return (
    <CallContext.Provider value={value}>
      {children}
      {call && (
        <CallWindow
          call={call}
          others={others}
          peerView={peerView}
          localStream={localStream}
          onAccept={accept}
          onDecline={() => leave("declined", "Llamada rechazada")}
          onHangUp={() => leave("left")}
          onMute={toggleMute}
          onCamera={toggleCamera}
          onSwitch={switchCamera}
          onScreen={canShareScreen() ? toggleScreen : null}
          onShareLink={shareLink}
          onInvite={() => setInviting(true)}
          onView={(view) => patchCall({ view })}
        />
      )}
      {joinPrompt && (
        <div className="fixed bottom-[calc(100px+env(safe-area-inset-bottom))] right-4 z-[3000] w-[min(92vw,320px)] rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl">
          <p className="text-sm font-bold text-slate-800">{joinPrompt.kind === "video" ? "Videollamada" : "Llamada"} en curso</p>
          <p className="mt-1 text-xs text-slate-500">
            De {joinPrompt.callerName || "alguien de tu empresa"} · {joinPrompt.people} {joinPrompt.people === 1 ? "persona" : "personas"} dentro.
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => setJoinPrompt(null)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">
              Ahora no
            </button>
            <button type="button" onClick={acceptPrompt} className="rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">
              Unirme
            </button>
          </div>
        </div>
      )}
      {inviting && call?.id && <InviteModal participants={participants} onInvite={invite} onClose={() => setInviting(false)} />}
      {/* Las ventanas de permiso van encima de la llamada. */}
      <div className="relative z-[3100]">
        {mic.sheet}
        {cam.sheet}
      </div>
    </CallContext.Provider>
  );
}

/* ---------- Agregar personas ---------- */

function InviteModal({ participants, onInvite, onClose }) {
  const { user } = useAuth();
  const { people } = usePeople();
  const [chosen, setChosen] = useState([]);
  const [query, setQuery] = useState("");
  const inside = new Set(participants.filter((p) => p.status === "joined" || p.status === "ringing").map((p) => p.userId));
  const list = people.filter((p) => p.id !== user?.id && !inside.has(p.id) && personName(p).toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="relative z-[3100]">
      <Modal title="Agregar a la llamada" width="max-w-sm" onClose={onClose}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar persona" className="mb-2 h-8 w-full rounded-lg border border-slate-200 px-2.5 text-xs focus:border-blue-400 focus:outline-none" />
        <div className="max-h-64 space-y-0.5 overflow-y-auto">
          {list.map((p) => (
            <label key={p.id} className="flex cursor-pointer items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-slate-50">
              <input type="checkbox" checked={chosen.includes(p.id)} onChange={() => setChosen((prev) => (prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id]))} className="h-4 w-4 accent-blue-600" />
              <img src={avatarUrl(personName(p))} alt="" className="h-7 w-7 rounded-full" />
              <span className="truncate text-xs font-medium text-slate-700">{personName(p)}</span>
            </label>
          ))}
          {list.length === 0 && <p className="py-6 text-center text-xs text-slate-400">No hay más personas para agregar.</p>}
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">
            Cancelar
          </button>
          <button
            type="button"
            disabled={chosen.length === 0}
            onClick={() => {
              onInvite(chosen);
              onClose();
            }}
            className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Llamar {chosen.length > 0 ? `(${chosen.length})` : ""}
          </button>
        </div>
      </Modal>
    </div>
  );
}

/* ---------- Ventana de la llamada (flotante o pantalla completa) ---------- */

function useAttach(ref, stream, { muted = false } = {}) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.muted = muted;
    if (el.srcObject !== stream) el.srcObject = stream ?? null;
    if (stream) el.play?.().catch(() => {});
  });
}

// Entra con un pequeño fundido (sin depender de hojas de estilo propias).
function useEntered() {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);
  return entered;
}

function RemoteAudio({ stream }) {
  const ref = useRef(null);
  useAttach(ref, stream);
  return <audio ref={ref} autoPlay playsInline className="hidden" />;
}

// Video que aparece con un fundido cuando de verdad tiene imagen.
function LiveVideo({ stream, mirrored = false, className = "", contain = false }) {
  const ref = useRef(null);
  const [playing, setPlaying] = useState(false);
  useAttach(ref, stream, { muted: true });
  useEffect(() => setPlaying(false), [stream]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      poster={BLANK_POSTER}
      onPlaying={() => setPlaying(true)}
      onLoadedData={() => setPlaying(true)}
      className={`${className} ${contain ? "object-contain" : "object-cover"} ${mirrored ? "-scale-x-100" : ""} bg-transparent transition-opacity duration-500 ${playing ? "opacity-100" : "opacity-0"}`}
    />
  );
}

// Foto con ondas mientras suena.
function RingingAvatar({ name, size = "h-24 w-24", ringing = false }) {
  return (
    <span className={`relative flex shrink-0 items-center justify-center ${size}`}>
      {ringing && (
        <>
          <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400 opacity-30" />
          <span className="absolute -inset-3 animate-pulse rounded-full border-2 border-emerald-300 opacity-40" />
        </>
      )}
      <img src={avatarUrl(name)} alt="" className={`relative ${size} rounded-full shadow-xl transition-transform duration-500 ${ringing ? "scale-95" : "scale-100"}`} />
    </span>
  );
}

function CallButton({ label, onClick, tone = "neutral", small = false, children }) {
  const tones = {
    neutral: "bg-[rgb(255_255_255/0.16)] text-white hover:bg-[rgb(255_255_255/0.26)]",
    active: "bg-white text-slate-900",
    danger: "bg-red-600 text-white hover:bg-red-700",
    accept: "bg-emerald-500 text-white hover:bg-emerald-600",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex shrink-0 items-center justify-center rounded-full shadow-lg transition duration-200 hover:scale-105 active:scale-95 ${small ? "h-10 w-10" : "h-14 w-14"} ${tones[tone]}`}
    >
      {children}
    </button>
  );
}

function statusText(call, elapsed) {
  if (call.phase === "preparing") return "Preparando…";
  if (call.phase === "outgoing") return call.group ? "Llamando al grupo…" : "Llamando…";
  if (call.phase === "incoming") return call.group ? `${call.inviter} te invita a una ${call.kind === "video" ? "videollamada" : "llamada"}` : call.kind === "video" ? "Videollamada entrante" : "Llamada de voz entrante";
  if (call.phase === "joining" || call.phase === "connecting") return "Conectando…";
  if (call.phase === "active") return elapsed;
  return call.endText;
}

function CallWindow({ call, others, peerView, localStream, onAccept, onDecline, onHangUp, onMute, onCamera, onSwitch, onScreen, onShareLink, onInvite, onView }) {
  const [, tick] = useState(0);
  const [menu, setMenu] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef(null);
  const entered = useEntered();
  const video = call.kind === "video" || call.sharing;
  const full = call.view === "full" && call.phase !== "ended";
  const touch = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  useEffect(() => {
    if (call.phase !== "active") return undefined;
    const timer = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [call.phase]);
  // "Atrás" en el teléfono: de pantalla completa a la ventana flotante.
  useBackLayer(full, () => onView("float"));
  const elapsed = call.since ? callDuration((Date.now() - call.since) / 1000) : "";
  const status = statusText(call, elapsed);
  const joined = others.filter((p) => p.status === "joined");
  const ringing = call.phase === "incoming" || call.phase === "outgoing";
  const withVideo = joined.filter((p) => peerView[p.userId]?.stream?.getVideoTracks().some((t) => t.readyState === "live"));
  const primary = withVideo[0] ?? null;
  // Con varias personas dentro, el título son sus nombres.
  const shownTitle = joined.length > 1 ? joined.map((p) => String(p.userName || "Alguien").split(" ")[0]).join(", ") : call.title;

  // Todo el sonido de los demás (sigue aunque la ventana cambie).
  const audios = joined.map((p) => peerView[p.userId]?.stream && <RemoteAudio key={p.userId} stream={peerView[p.userId].stream} />);

  const menuItems = [
    call.id && call.phase !== "incoming" && { label: "Agregar personas", icon: UserPlus, run: onInvite },
    call.id && call.phase !== "incoming" && { label: "Compartir enlace de la llamada", icon: LinkIcon, run: onShareLink },
    onScreen && call.phase === "active" && { label: call.sharing ? "Dejar de compartir pantalla" : "Compartir pantalla", icon: ScreenShare, run: onScreen },
    call.kind === "video" && touch && { label: "Girar cámara", icon: SwitchCamera, run: onSwitch },
  ].filter(Boolean);

  const controls = (small) =>
    call.phase === "incoming" ? (
      <div className={`flex items-center ${small ? "gap-3" : "justify-around"}`}>
        <CallButton label="Rechazar" onClick={onDecline} tone="danger" small={small}>
          <PhoneOff size={small ? 17 : 22} />
        </CallButton>
        <span className={small ? "" : "animate-bounce"}>
          <CallButton label="Contestar" onClick={onAccept} tone="accept" small={small}>
            {call.kind === "video" ? <Video size={small ? 17 : 22} /> : <Phone size={small ? 17 : 22} />}
          </CallButton>
        </span>
      </div>
    ) : call.phase === "ended" ? null : (
      <div className={`flex items-center justify-center ${small ? "gap-2" : "gap-4"}`}>
        <CallButton label={call.muted ? "Activar micrófono" : "Silenciar"} onClick={onMute} tone={call.muted ? "active" : "neutral"} small={small}>
          {call.muted ? <MicOff size={small ? 16 : 21} /> : <Mic size={small ? 16 : 21} />}
        </CallButton>
        {call.kind === "video" && (
          <CallButton label={call.cameraOff ? "Prender cámara" : "Apagar cámara"} onClick={onCamera} tone={call.cameraOff ? "active" : "neutral"} small={small}>
            {call.cameraOff ? <VideoOff size={small ? 16 : 21} /> : <Video size={small ? 16 : 21} />}
          </CallButton>
        )}
        <CallButton label="Colgar" onClick={onHangUp} tone="danger" small={small}>
          <PhoneOff size={small ? 17 : 22} />
        </CallButton>
      </div>
    );

  const tile = (p, big) => {
    const view = peerView[p.userId] ?? {};
    const hasVideo = view.stream?.getVideoTracks().some((t) => t.readyState === "live");
    return (
      <div key={p.userId} className={`relative flex items-center justify-center overflow-hidden rounded-2xl bg-slate-900 ${big ? "min-h-0" : ""}`}>
        {hasVideo && <LiveVideo stream={view.stream} className="absolute inset-0 h-full w-full" />}
        {!hasVideo && <RingingAvatar name={p.userName} size={big ? "h-20 w-20" : "h-14 w-14"} />}
        <span className="absolute bottom-2 left-2 rounded-full bg-[rgb(0_0_0/0.5)] px-2 py-0.5 text-[11px] font-semibold text-white">
          {p.userName}
          {view.state && view.state !== "connected" ? ` · ${view.state === "failed" ? "sin conexión" : view.state === "reconnecting" ? "reconectando…" : "conectando…"}` : ""}
        </span>
      </div>
    );
  };

  // ---- Ventana flotante ----
  if (!full) {
    const onPointerDown = (e) => {
      if (e.target.closest("button")) return;
      drag.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
      e.currentTarget.setPointerCapture?.(e.pointerId);
    };
    const onPointerMove = (e) => {
      if (!drag.current) return;
      const maxX = 0;
      const minX = -(window.innerWidth - 300);
      const maxY = 0;
      const minY = -(window.innerHeight - 200);
      setOffset({ x: Math.min(maxX, Math.max(minX, e.clientX - drag.current.x)), y: Math.min(maxY, Math.max(minY, e.clientY - drag.current.y)) });
    };
    const onPointerUp = () => {
      drag.current = null;
    };
    const showVideo = video && call.phase !== "incoming" && call.phase !== "ended";
    return (
      <>
        {audios}
        <div
          role="dialog"
          aria-label={`Llamada con ${call.title}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{ translate: `${offset.x}px ${offset.y}px` }}
          className={`fixed bottom-[calc(100px+env(safe-area-inset-bottom))] right-3 z-[3000] w-[min(92vw,300px)] touch-none select-none overflow-hidden rounded-2xl bg-slate-950 text-white shadow-2xl ring-1 ring-[rgb(255_255_255/0.08)] transition-[opacity,transform] duration-300 lg:bottom-5 lg:right-5 ${entered ? "scale-100 opacity-100" : "scale-90 opacity-0"}`}
        >
          {showVideo && (
            <div className="relative h-40 w-full bg-slate-900">
              {primary ? (
                <LiveVideo stream={peerView[primary.userId].stream} className="absolute inset-0 h-full w-full" />
              ) : (
                localStream && <LiveVideo stream={localStream} mirrored={call.facing === "user" && !call.sharing} contain={call.sharing} className="absolute inset-0 h-full w-full" />
              )}
              {primary && localStream && !call.cameraOff && (
                <LiveVideo stream={localStream} mirrored={call.facing === "user" && !call.sharing} className="absolute bottom-2 right-2 h-16 w-12 rounded-lg ring-1 ring-[rgb(255_255_255/0.3)]" />
              )}
              {!primary && call.phase !== "active" && (
                <div className="absolute inset-0 flex items-center justify-center bg-[rgb(2_6_23/0.35)]">
                  <RingingAvatar name={call.title} size="h-14 w-14" ringing={ringing} />
                </div>
              )}
            </div>
          )}
          <div className="flex items-center gap-2.5 px-3 pb-3 pt-2.5">
            {!showVideo && <RingingAvatar name={call.title} size="h-10 w-10" ringing={ringing} />}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">{shownTitle}</p>
              <p className="truncate text-[11px] text-[rgb(255_255_255/0.7)]">
                {status}
                {joined.length > 1 ? ` · ${joined.length + 1} personas` : ""}
              </p>
            </div>
            {call.phase !== "ended" && call.phase !== "incoming" && (
              <button type="button" onClick={() => onView("full")} aria-label="Pantalla completa" title="Pantalla completa" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[rgb(255_255_255/0.12)] hover:bg-[rgb(255_255_255/0.22)]">
                <Maximize2 size={14} />
              </button>
            )}
          </div>
          {call.phase !== "ended" && <div className="px-3 pb-3">{controls(true)}</div>}
        </div>
      </>
    );
  }

  // ---- Pantalla completa ----
  const gridCols = joined.length <= 1 ? "grid-cols-1" : joined.length <= 4 ? "grid-cols-2" : "grid-cols-3";
  return (
    <>
      {audios}
      <div
        role="dialog"
        aria-label={`Llamada con ${call.title}`}
        className={`fixed inset-0 z-[3000] flex flex-col overflow-hidden bg-slate-950 text-white transition-opacity duration-300 ${entered ? "opacity-100" : "opacity-0"}`}
      >
        {/* Fondo: mi cámara mientras conecta; luego, quienes están */}
        {video && joined.length === 0 && localStream && (
          <LiveVideo stream={localStream} mirrored={call.facing === "user" && !call.sharing} contain={call.sharing} className="absolute inset-0 h-full w-full" />
        )}
        <div className="relative z-10 flex items-center justify-between px-4 pt-[max(env(safe-area-inset-top),0.75rem)]">
          <button type="button" onClick={() => onView("float")} aria-label="Ventana flotante" title="Ventana flotante" className="flex h-10 w-10 items-center justify-center rounded-full bg-[rgb(255_255_255/0.12)] hover:bg-[rgb(255_255_255/0.22)]">
            <ChevronDown size={20} />
          </button>
          <span className="truncate px-2 text-[11px] text-[rgb(255_255_255/0.7)]">Llamada de Navio · cifrada</span>
          <div className="relative">
            <button type="button" onClick={() => setMenu((v) => !v)} aria-label="Más opciones de la llamada" disabled={menuItems.length === 0} className="flex h-10 w-10 items-center justify-center rounded-full bg-[rgb(255_255_255/0.12)] hover:bg-[rgb(255_255_255/0.22)] disabled:opacity-40">
              <MoreVertical size={18} />
            </button>
            {menu && (
              <>
                <div className="fixed inset-0" onClick={() => setMenu(false)} />
                <div className="absolute right-0 top-12 w-60 rounded-xl bg-white p-1 text-slate-700 shadow-2xl">
                  {menuItems.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => {
                        setMenu(false);
                        item.run();
                      }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium hover:bg-slate-50"
                    >
                      <item.icon size={14} className="shrink-0" /> {item.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {joined.length > 0 && (withVideo.length > 0 || joined.length > 1) ? (
          <div className={`relative z-10 grid min-h-0 flex-1 gap-2 p-3 ${gridCols}`}>{joined.map((p) => tile(p, joined.length === 1))}</div>
        ) : (
          <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6">
            <RingingAvatar name={call.title} ringing={ringing} />
            <p className="mt-5 max-w-full truncate text-xl font-bold drop-shadow">{call.title}</p>
            <p className="mt-1 text-sm text-[rgb(255_255_255/0.8)] drop-shadow">{status}</p>
          </div>
        )}
        {joined.length > 0 && (withVideo.length > 0 || joined.length > 1) && (
          <p className="relative z-10 text-center text-xs text-[rgb(255_255_255/0.8)]">
            {shownTitle} · {status}
          </p>
        )}

        {video && joined.length > 0 && localStream && !call.cameraOff && (
          <LiveVideo
            stream={localStream}
            mirrored={call.facing === "user" && !call.sharing}
            className="absolute right-4 top-[max(env(safe-area-inset-top),0.75rem)] z-20 mt-14 h-36 w-24 rounded-2xl shadow-xl ring-1 ring-[rgb(255_255_255/0.25)] sm:h-44 sm:w-32"
          />
        )}

        <div className="relative z-10 px-6 pb-[max(env(safe-area-inset-bottom),1.5rem)] pt-4">{controls(false) ?? <div className="h-20" />}</div>
      </div>
    </>
  );
}

