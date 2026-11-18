import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Mic, MicOff, Phone, PhoneOff, SwitchCamera, Video, VideoOff } from "lucide-react";
import { supabase, useAuth, useToast, avatarUrl } from "./NavioDashboard.jsx";
import { usePermissionGate } from "./permissions.jsx";
import { useBackLayer } from "./history.js";

/* ---------------------------------------------------------------------- */
/*  Llamadas y videollamadas entre dos personas de la empresa             */
/* ---------------------------------------------------------------------- */
//
// La voz y el video van directo de un teléfono al otro (WebRTC, cifrado).
// La base de datos (migración v27) solo sirve para "tocar la puerta": quien
// llama deja su oferta en la tabla "calls", quien contesta deja su
// respuesta, y cualquiera de los dos cuelga. Si la otra persona tiene Navio
// cerrado, la función "push" le avisa con una notificación.

const CallContext = createContext({ available: false, busy: false, start: () => {} });
export const useCalls = () => useContext(CallContext);

const RING_MS = 45000; // quien llama deja de esperar
const INCOMING_MAX_AGE_MS = 75000; // una llamada más vieja ya no suena
const CONNECT_MS = 25000; // tiempo para conectar después de contestar
const RECONNECT_MS = 15000; // si se corta, cuánto se espera a que regrese
const FINAL = ["ended", "missed", "declined", "cancelled", "busy", "failed"];
const STUN = [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }];

const supported = () => typeof window !== "undefined" && "RTCPeerConnection" in window && !!navigator.mediaDevices?.getUserMedia;

export const callDuration = (seconds) => {
  const s = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${m}:${rest}`;
};

// Servidores para conectar (la función "calls" da también TURN, si está).
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

// Espera a reunir los caminos de conexión (o se sigue con los que haya).
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

// Tono de "llamando" (quien llama) y timbre (quien recibe), hechos aquí mismo.
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
      // Sin sonido: la pantalla de llamada sigue igual.
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

const END_TEXT = {
  declined: "No puede contestar ahora",
  busy: "Está en otra llamada",
  missed: "No contestó",
  cancelled: "Llamada cancelada",
  ended: "Llamada terminada",
  failed: "Se perdió la conexión",
};

let callSeq = 0;
let channelSeq = 0;

export function CallProvider({ children }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const userId = user?.id ?? null;
  const [available, setAvailable] = useState(false);
  const [call, setCallState] = useState(null);
  const [streams, setStreams] = useState({ local: null, remote: null });
  const [epoch, setEpoch] = useState(0);
  const callRef = useRef(null);
  const pcRef = useRef(null);
  const localRef = useRef(null);
  const toneRef = useRef(null);
  const timers = useRef([]);
  const endTimer = useRef(null);
  const handled = useRef(new Set());
  const tokenRef = useRef(null);
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

  // Apaga todo y deja un momento el motivo en pantalla.
  function teardown(text) {
    stopTone();
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    try {
      pcRef.current?.close();
    } catch {
      // Ya estaba cerrada.
    }
    pcRef.current = null;
    localRef.current?.getTracks().forEach((t) => t.stop());
    localRef.current = null;
    setStreams({ local: null, remote: null });
    if (!callRef.current) return;
    const key = callRef.current.key;
    patchCall({ phase: "ended", endText: text, minimized: false, reconnecting: false });
    window.clearTimeout(endTimer.current);
    endTimer.current = window.setTimeout(() => {
      if (callRef.current?.key === key && callRef.current.phase === "ended") setCall(null);
    }, 1800);
  }

  async function hangUp(reason = "ended", text) {
    const current = callRef.current;
    if (!current || current.phase === "ended") return;
    const id = current.id;
    teardown(text ?? (reason === "failed" ? END_TEXT.failed : reason === "missed" ? END_TEXT.missed : current.phase === "incoming" ? "Llamada rechazada" : END_TEXT.ended));
    if (id) {
      const { error } = await supabase.rpc("end_call", { target_call: id, end_reason: reason });
      if (error) console.warn("end_call:", error.message);
    }
  }

  function watchConnection(pc, key) {
    let reconnect = null;
    const onChange = () => {
      if (!alive(key) || pcRef.current !== pc) return;
      const state = pc.connectionState || pc.iceConnectionState;
      if (state === "connected" || state === "completed") {
        window.clearTimeout(reconnect);
        reconnect = null;
        if (callRef.current.phase !== "active") patchCall({ phase: "active", since: callRef.current.since ?? Date.now(), reconnecting: false });
        else if (callRef.current.reconnecting) patchCall({ reconnecting: false });
      } else if (state === "disconnected") {
        if (callRef.current.phase === "active") patchCall({ reconnecting: true });
        if (!reconnect) reconnect = window.setTimeout(() => alive(key) && hangUp("failed"), RECONNECT_MS);
      } else if (state === "failed") {
        hangUp("failed", callRef.current.phase === "active" ? END_TEXT.failed : "No se pudo conectar. La red no lo permitió.");
      }
    };
    pc.addEventListener("connectionstatechange", onChange);
    pc.addEventListener("iceconnectionstatechange", onChange);
  }

  function createPeer(servers, key) {
    const pc = new RTCPeerConnection({ iceServers: servers });
    const remote = new MediaStream();
    pc.addEventListener("track", (event) => {
      if (!remote.getTracks().includes(event.track)) remote.addTrack(event.track);
      setStreams((s) => ({ ...s, remote }));
    });
    watchConnection(pc, key);
    return pc;
  }

  function connectTimeout(key) {
    later(() => {
      if (alive(key) && callRef.current.phase === "connecting") hangUp("failed", "No se pudo conectar. La red no lo permitió.");
    }, CONNECT_MS);
  }

  // Lo que dice la base sobre la llamada en curso (tiempo real o consulta).
  function applyRow(row) {
    const current = callRef.current;
    if (!row || !current || current.id !== row.id || current.phase === "ended") return;
    if (FINAL.includes(row.status)) {
      if (row.endedBy === userId) return; // la colgué yo: ya se apagó
      if (current.role === "callee") teardown(current.phase === "incoming" ? "Llamada perdida" : END_TEXT.ended);
      else teardown(END_TEXT[row.status] ?? END_TEXT.ended);
      return;
    }
    const pc = pcRef.current;
    if (current.role === "caller" && row.status === "accepted" && row.answer?.sdp && pc && pc.signalingState === "have-local-offer") {
      stopTone();
      patchCall({ phase: "connecting" });
      pc.setRemoteDescription({ type: "answer", sdp: row.answer.sdp }).catch(() => hangUp("failed", "No se pudo conectar la llamada."));
      connectTimeout(current.key);
    }
  }

  // Llamar ---------------------------------------------------------------
  async function dial(channel, kind) {
    const key = ++callSeq;
    setCall({
      key,
      role: "caller",
      phase: "preparing",
      id: null,
      kind,
      channelId: channel.id,
      peerName: channel.otherUserName || "Contacto",
      muted: false,
      cameraOff: false,
      facing: "user",
      minimized: false,
    });
    rememberToken();
    try {
      const media = await navigator.mediaDevices.getUserMedia(constraints(kind));
      if (!alive(key)) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      localRef.current = media;
      setStreams((s) => ({ ...s, local: media }));
      const pc = createPeer(await iceServers(), key);
      pcRef.current = pc;
      media.getTracks().forEach((t) => pc.addTrack(t, media));
      await pc.setLocalDescription(await pc.createOffer());
      await gatherCandidates(pc);
      if (!alive(key) || pcRef.current !== pc) return;
      const { data, error } = await supabase.rpc("start_call", { target_channel: channel.id, call_kind: kind, call_offer: { type: "offer", sdp: pc.localDescription.sdp } });
      if (error) throw new Error(error.message);
      const row = Array.isArray(data) ? data[0] : data;
      if (!alive(key)) {
        if (row?.id) supabase.rpc("end_call", { target_call: row.id, end_reason: "cancelled" });
        return;
      }
      handled.current.add(row.id);
      patchCall({ id: row.id, phase: "ringing" });
      startTone("ringback");
      later(() => alive(key) && callRef.current.phase === "ringing" && hangUp("missed"), RING_MS);
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
      showToast("Ya estás en una llamada.");
      return;
    }
    const go = () => dial(channel, kind);
    if (kind === "video") mic.run(() => cam.run(go));
    else mic.run(go);
  };

  // Recibir -------------------------------------------------------------
  function ring(row) {
    if (!row || row.calleeId !== userId || row.status !== "ringing" || handled.current.has(row.id)) return;
    const age = Date.now() - Date.parse(row.createdAt);
    if (age > INCOMING_MAX_AGE_MS) return;
    handled.current.add(row.id);
    if (callRef.current && callRef.current.phase !== "ended") {
      supabase.rpc("end_call", { target_call: row.id, end_reason: "busy" });
      return;
    }
    const key = ++callSeq;
    setCall({
      key,
      role: "callee",
      phase: "incoming",
      id: row.id,
      kind: row.kind === "video" ? "video" : "audio",
      channelId: row.channelId,
      peerName: row.callerName || "Alguien",
      offer: row.offer,
      muted: false,
      cameraOff: false,
      facing: "user",
      minimized: false,
    });
    startTone("ringtone");
    later(() => alive(key) && callRef.current.phase === "incoming" && teardown("Llamada perdida"), Math.max(5000, INCOMING_MAX_AGE_MS - Math.max(0, age)));
  }

  async function answer() {
    const current = callRef.current;
    if (!current || current.phase !== "incoming") return;
    const { key, id, kind } = current;
    stopTone();
    patchCall({ phase: "connecting" });
    rememberToken();
    try {
      const media = await navigator.mediaDevices.getUserMedia(constraints(kind));
      if (!alive(key)) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      localRef.current = media;
      setStreams((s) => ({ ...s, local: media }));
      const pc = createPeer(await iceServers(), key);
      pcRef.current = pc;
      await pc.setRemoteDescription({ type: "offer", sdp: current.offer?.sdp ?? "" });
      media.getTracks().forEach((t) => pc.addTrack(t, media));
      await pc.setLocalDescription(await pc.createAnswer());
      await gatherCandidates(pc);
      if (!alive(key) || pcRef.current !== pc) return;
      const { error } = await supabase.rpc("answer_call", { target_call: id, call_answer: { type: "answer", sdp: pc.localDescription.sdp } });
      if (error) {
        teardown(/terminó|no existe/i.test(error.message) ? "La llamada ya terminó." : "No se pudo contestar.");
        return;
      }
      connectTimeout(key);
    } catch (err) {
      if (!alive(key)) return;
      if (err?.name === "NotAllowedError" || err?.name === "SecurityError") {
        // Sigue sonando mientras se da el permiso.
        localRef.current?.getTracks().forEach((t) => t.stop());
        localRef.current = null;
        pcRef.current?.close();
        pcRef.current = null;
        patchCall({ phase: "incoming" });
        (kind === "video" ? cam : mic).explain("denied", accept);
        return;
      }
      hangUp("failed", "No se pudo contestar la llamada.");
    }
  }

  const accept = () => {
    const current = callRef.current;
    if (!current || current.phase !== "incoming") return;
    if (current.kind === "video") mic.run(() => cam.run(answer));
    else mic.run(answer);
  };

  // Controles -----------------------------------------------------------
  function toggleMute() {
    const track = localRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    patchCall({ muted: !track.enabled });
  }
  function toggleCamera() {
    const track = localRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    patchCall({ cameraOff: !track.enabled });
  }
  async function switchCamera() {
    const current = callRef.current;
    const media = localRef.current;
    const pc = pcRef.current;
    if (!current || !media || !pc) return;
    const facing = current.facing === "user" ? "environment" : "user";
    const old = media.getVideoTracks()[0];
    try {
      old?.stop(); // algunos teléfonos no abren dos cámaras a la vez
      const fresh = await navigator.mediaDevices.getUserMedia({ video: constraints("video", facing).video });
      const track = fresh.getVideoTracks()[0];
      track.enabled = !current.cameraOff;
      await pc.getSenders().find((s) => s.track?.kind === "video" || (!s.track && old))?.replaceTrack(track);
      if (old) media.removeTrack(old);
      media.addTrack(track);
      setStreams((s) => ({ ...s, local: new MediaStream(media.getTracks()) }));
      patchCall({ facing });
    } catch {
      showToast("No se pudo cambiar de cámara.");
    }
  }

  // Disponible solo con la migración v27 y un navegador que lo permita.
  useEffect(() => {
    if (!userId || !supported()) {
      setAvailable(false);
      return undefined;
    }
    let live = true;
    supabase
      .from("calls")
      .select("id")
      .limit(1)
      .then(({ error }) => live && setAvailable(!error));
    return () => {
      live = false;
    };
  }, [userId]);

  // Tiempo real + revisar al volver a Navio (por ejemplo, al tocar el aviso).
  const ringRef = useRef(ring);
  const applyRef = useRef(applyRow);
  ringRef.current = ring;
  applyRef.current = applyRow;
  useEffect(() => {
    if (!userId || !available) return undefined;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      const current = callRef.current;
      if (current?.id && current.phase !== "ended") {
        const { data } = await supabase.from("calls").select("*").eq("id", current.id).maybeSingle();
        applyRef.current(data);
        return;
      }
      const since = new Date(Date.now() - INCOMING_MAX_AGE_MS).toISOString();
      const { data } = await supabase.from("calls").select("*").eq("calleeId", userId).eq("status", "ringing").gte("createdAt", since).order("createdAt", { ascending: false }).limit(1);
      if (data?.[0]) ringRef.current(data[0]);
    };
    const channel = supabase
      .channel(`calls-${++channelSeq}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "calls", filter: `calleeId=eq.${userId}` }, (payload) => ringRef.current(payload.new))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "calls" }, (payload) => applyRef.current(payload.new))
      .subscribe();
    const resume = () => {
      check();
      if (channel.state && channel.state !== "joined" && channel.state !== "joining") setEpoch((n) => n + 1);
    };
    check();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    return () => {
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      supabase.removeChannel(channel);
    };
  }, [userId, available, epoch]);

  // Mientras suena o conecta, se revisa también cada 3 s (por si el tiempo
  // real se atrasó).
  const phase = call?.phase;
  const callId = call?.id;
  useEffect(() => {
    if (!callId || !["ringing", "incoming", "connecting"].includes(phase)) return undefined;
    const timer = window.setInterval(async () => {
      const { data } = await supabase.from("calls").select("*").eq("id", callId).maybeSingle();
      applyRef.current(data);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [callId, phase]);

  // Si se cierra Navio en plena llamada, se cuelga (lo que alcance a salir).
  useEffect(() => {
    const onHide = () => {
      const current = callRef.current;
      if (!current?.id || current.phase === "ended" || !tokenRef.current) return;
      try {
        fetch(`${supabase.supabaseUrl}/rest/v1/rpc/end_call`, {
          method: "POST",
          keepalive: true,
          headers: { apikey: supabase.supabaseKey, authorization: `Bearer ${tokenRef.current}`, "content-type": "application/json" },
          body: JSON.stringify({ target_call: current.id, end_reason: current.phase === "active" ? "ended" : current.role === "callee" ? "declined" : "cancelled" }),
        });
      } catch {
        // Sin red: la otra persona verá que se cortó.
      }
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  // Al cerrar sesión se cuelga.
  useEffect(() => {
    if (!userId && callRef.current) teardown("Llamada terminada");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const busy = !!call && call.phase !== "ended";
  const startRef = useRef(start);
  startRef.current = start;
  const stableStart = useCallback((channel, kind) => startRef.current(channel, kind), []);
  const value = useMemo(() => ({ available, busy, start: stableStart }), [available, busy, stableStart]);

  return (
    <CallContext.Provider value={value}>
      {children}
      {call && (
        <CallScreen
          call={call}
          streams={streams}
          onAccept={accept}
          onDecline={() => hangUp("declined", "Llamada rechazada")}
          onHangUp={() => hangUp(call.phase === "ringing" || call.phase === "preparing" ? "cancelled" : "ended")}
          onMute={toggleMute}
          onCamera={toggleCamera}
          onSwitch={switchCamera}
          onMinimize={() => patchCall({ minimized: true })}
          onRestore={() => patchCall({ minimized: false })}
        />
      )}
      {/* Las ventanas de permiso van encima de la pantalla de llamada. */}
      <div className="relative z-[3100]">
        {mic.sheet}
        {cam.sheet}
      </div>
    </CallContext.Provider>
  );
}

/* ---------- Pantalla de llamada ---------- */

function useAttach(ref, stream, { muted = false } = {}) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.muted = muted;
    if (el.srcObject !== stream) el.srcObject = stream ?? null;
    if (stream) el.play?.().catch(() => {});
  }, [ref, stream, muted]);
}

function RoundButton({ label, onClick, active = false, danger = false, accept = false, children }) {
  const tone = danger ? "bg-red-600 text-white hover:bg-red-700" : accept ? "bg-emerald-500 text-white hover:bg-emerald-600" : active ? "bg-white text-slate-900" : "bg-[rgb(255_255_255/0.16)] text-white hover:bg-[rgb(255_255_255/0.26)]";
  return (
    <div className="flex w-16 flex-col items-center gap-1.5">
      <button type="button" onClick={onClick} aria-label={label} title={label} className={`flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition ${tone}`}>
        {children}
      </button>
      <span className="text-center text-[10px] leading-tight text-[rgb(255_255_255/0.8)]">{label}</span>
    </div>
  );
}

function CallScreen({ call, streams, onAccept, onDecline, onHangUp, onMute, onCamera, onSwitch, onMinimize, onRestore }) {
  const remoteAudio = useRef(null);
  const remoteVideo = useRef(null);
  const localVideo = useRef(null);
  const [, tick] = useState(0);
  const video = call.kind === "video";
  const hasRemoteVideo = video && !!streams.remote?.getVideoTracks().length;
  // El sonido de la otra persona va por un elemento aparte: sigue aunque la
  // pantalla se minimice.
  useAttach(remoteAudio, streams.remote);
  useAttach(remoteVideo, video ? streams.remote : null, { muted: true });
  useAttach(localVideo, video ? streams.local : null, { muted: true });
  useEffect(() => {
    if (call.phase !== "active") return undefined;
    const timer = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [call.phase]);
  // "Atrás" en el teléfono minimiza la llamada en vez de cerrarla.
  useBackLayer(!call.minimized && call.phase !== "ended" && call.phase !== "incoming", onMinimize);

  const elapsed = call.since ? callDuration((Date.now() - call.since) / 1000) : "";
  const status =
    call.phase === "preparing"
      ? "Preparando…"
      : call.phase === "ringing"
      ? "Llamando…"
      : call.phase === "incoming"
      ? video
        ? "Videollamada entrante"
        : "Llamada de voz entrante"
      : call.phase === "connecting"
      ? "Conectando…"
      : call.phase === "active"
      ? call.reconnecting
        ? "Reconectando…"
        : elapsed
      : call.endText;
  const touch = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  const showLocalFull = video && !hasRemoteVideo && call.phase !== "ended" && !!streams.local;

  return (
    <>
      <audio ref={remoteAudio} autoPlay playsInline className="hidden" />
      {call.minimized && call.phase !== "ended" && (
        <button
          type="button"
          onClick={onRestore}
          className="fixed left-1/2 top-[max(env(safe-area-inset-top),0.5rem)] z-[3000] flex max-w-[90vw] -translate-x-1/2 items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-lg"
        >
          {video ? <Video size={14} /> : <Phone size={14} />}
          <span className="truncate">
            {call.peerName} · {status}
          </span>
          <span className="shrink-0 text-[10px] font-normal opacity-80">Volver</span>
        </button>
      )}
      <div
        role="dialog"
        aria-label={`Llamada con ${call.peerName}`}
        className={`fixed inset-0 z-[3000] flex flex-col overflow-hidden bg-slate-950 text-white ${call.minimized && call.phase !== "ended" ? "hidden" : ""}`}
      >
        {/* Video de la otra persona (o el mío mientras conecta) */}
        {video && (
          <video
            ref={remoteVideo}
            autoPlay
            playsInline
            className={`absolute inset-0 h-full w-full object-cover ${hasRemoteVideo && call.phase === "active" ? "" : "hidden"}`}
          />
        )}
        {video && (
          <video
            ref={localVideo}
            autoPlay
            playsInline
            className={`${
              showLocalFull ? "absolute inset-0 h-full w-full opacity-50" : "absolute right-3 top-[max(env(safe-area-inset-top),0.75rem)] z-10 mt-12 h-40 w-28 rounded-2xl border border-[rgb(255_255_255/0.2)] shadow-xl"
            } object-cover ${call.facing === "user" ? "-scale-x-100" : ""} ${call.cameraOff || !streams.local ? "hidden" : ""}`}
          />
        )}

        <div className="relative z-10 flex items-center justify-between px-4 pt-[max(env(safe-area-inset-top),0.75rem)]">
          {call.phase !== "incoming" && call.phase !== "ended" ? (
            <button type="button" onClick={onMinimize} aria-label="Minimizar llamada" title="Minimizar" className="flex h-10 w-10 items-center justify-center rounded-full bg-[rgb(255_255_255/0.12)]">
              <ChevronDown size={20} />
            </button>
          ) : (
            <span className="h-10 w-10" />
          )}
          <span className="text-[11px] text-[rgb(255_255_255/0.7)]">Llamada de Navio · cifrada</span>
          <span className="h-10 w-10" />
        </div>

        <div className={`relative z-10 flex flex-1 flex-col items-center px-6 ${hasRemoteVideo && call.phase === "active" ? "justify-start pt-4" : "justify-center"}`}>
          {!(hasRemoteVideo && call.phase === "active") && (
            <img src={avatarUrl(call.peerName)} alt="" className={`h-24 w-24 rounded-full shadow-xl ${call.phase === "incoming" || call.phase === "ringing" ? "animate-pulse" : ""}`} />
          )}
          <p className="mt-4 max-w-full truncate text-xl font-bold drop-shadow">{call.peerName}</p>
          <p className="mt-1 text-sm text-[rgb(255_255_255/0.8)] drop-shadow">{status}</p>
        </div>

        <div className="relative z-10 px-6 pb-[max(env(safe-area-inset-bottom),1.5rem)] pt-4">
          {call.phase === "incoming" ? (
            <div className="flex items-start justify-around">
              <RoundButton label="Rechazar" onClick={onDecline} danger>
                <PhoneOff size={22} />
              </RoundButton>
              <RoundButton label="Contestar" onClick={onAccept} accept>
                {video ? <Video size={22} /> : <Phone size={22} />}
              </RoundButton>
            </div>
          ) : call.phase !== "ended" ? (
            <div className="flex items-start justify-center gap-4">
              <RoundButton label={call.muted ? "Activar micrófono" : "Silenciar"} onClick={onMute} active={call.muted}>
                {call.muted ? <MicOff size={21} /> : <Mic size={21} />}
              </RoundButton>
              {video && (
                <RoundButton label={call.cameraOff ? "Prender cámara" : "Apagar cámara"} onClick={onCamera} active={call.cameraOff}>
                  {call.cameraOff ? <VideoOff size={21} /> : <Video size={21} />}
                </RoundButton>
              )}
              {video && touch && (
                <RoundButton label="Girar cámara" onClick={onSwitch}>
                  <SwitchCamera size={21} />
                </RoundButton>
              )}
              <RoundButton label="Colgar" onClick={onHangUp} danger>
                <PhoneOff size={22} />
              </RoundButton>
            </div>
          ) : (
            <div className="h-20" />
          )}
        </div>
      </div>
    </>
  );
}
