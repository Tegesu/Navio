import { useEffect, useRef, useState } from "react";
import { Camera, ChevronUp, FileText, Lock, Mic, Pause, Play, RefreshCw, Search, Send, Trash2, X } from "lucide-react";
import { Modal } from "./NavioDashboard.jsx";
import { GIPHY_KEY } from "./config.js";
import { usePermissionGate, forgetPermission } from "./permissions.jsx";

/* ---------------------------------------------------------------------- */
/*  Piezas para escribir en el chat: voz, cámara, vista previa y GIFs     */
/* ---------------------------------------------------------------------- */

const sizeLabel = (bytes) => (bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((bytes || 0) / 1024))} KB`);
export const durationLabel = (s) => `${Math.floor((s || 0) / 60)}:${String(Math.floor(s || 0) % 60).padStart(2, "0")}`;

/* ---------- Grabadora ---------- */

const MAX_SECONDS = 300;

export function useRecorder() {
  const rec = useRef(null);
  const stream = useRef(null);
  const chunks = useRef([]);
  const startedAt = useRef(0);
  const pausedTotal = useRef(0);
  const pausedAt = useRef(0);
  const [status, setStatus] = useState("idle"); // idle | starting | recording | paused
  const [seconds, setSeconds] = useState(0);

  const elapsed = () => {
    const end = rec.current?.state === "paused" ? pausedAt.current : Date.now();
    return Math.max(0, (end - startedAt.current - pausedTotal.current) / 1000);
  };

  useEffect(() => {
    if (status !== "recording") return undefined;
    const timer = window.setInterval(() => setSeconds(elapsed()), 200);
    return () => window.clearInterval(timer);
  }, [status]);

  async function start() {
    setStatus("starting");
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = s;
      const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((t) => window.MediaRecorder?.isTypeSupported?.(t)) ?? "";
      const r = new MediaRecorder(s, type ? { mimeType: type } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.start(250);
      rec.current = r;
      startedAt.current = Date.now();
      pausedTotal.current = 0;
      setSeconds(0);
      setStatus("recording");
      return true;
    } catch (err) {
      setStatus("idle");
      if (err?.name === "NotAllowedError") forgetPermission("microphone");
      throw err;
    }
  }

  function pause() {
    if (rec.current?.state !== "recording") return;
    rec.current.pause();
    pausedAt.current = Date.now();
    setSeconds(elapsed());
    setStatus("paused");
  }

  function resume() {
    if (rec.current?.state !== "paused") return;
    pausedTotal.current += Date.now() - pausedAt.current;
    rec.current.resume();
    setStatus("recording");
  }

  // keep: true para quedarse con el audio; false para descartarlo.
  function stop(keep) {
    const r = rec.current;
    if (!r) return Promise.resolve(null);
    const secs = elapsed();
    return new Promise((resolve) => {
      r.onstop = () => {
        stream.current?.getTracks().forEach((t) => t.stop());
        stream.current = null;
        rec.current = null;
        setStatus("idle");
        if (!keep) return resolve(null);
        const mime = (r.mimeType || "audio/webm").split(";")[0];
        return resolve({ blob: new Blob(chunks.current, { type: mime }), seconds: secs });
      };
      if (r.state !== "inactive") r.stop();
      else r.onstop();
    });
  }

  // Al salir de la conversación, se suelta el micrófono.
  useEffect(
    () => () => {
      if (rec.current && rec.current.state !== "inactive") rec.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    []
  );

  return { status, seconds, start, pause, resume, stop };
}

// El botón del micrófono:
//   - un toque: empieza a grabar con pausa, reanudar y enviar;
//   - mantener presionado: graba; al soltar se envía, deslizando a la
//     izquierda se cancela y deslizando hacia arriba se bloquea (sigue
//     grabando sin el dedo, con las opciones del toque).
export function useVoiceNote({ onSend, onError }) {
  const recorder = useRecorder();
  const mic = usePermissionGate("microphone");
  const [mode, setMode] = useState(null); // null | "hold" | "locked"
  const [drag, setDrag] = useState({ dx: 0, dy: 0 });
  const gesture = useRef(null);
  const starting = useRef(null);

  function begin(nextMode) {
    setMode(nextMode);
    setDrag({ dx: 0, dy: 0 });
    starting.current = recorder.start().catch((err) => {
      setMode(null);
      onError?.(err);
      return false;
    });
  }

  async function finish(send) {
    const started = await starting.current;
    starting.current = null;
    setMode(null);
    if (!started) return;
    const result = await recorder.stop(send);
    if (send && result && result.seconds >= 0.7) onSend(result.blob, result.seconds);
  }

  // Más de 5 minutos: se envía sola.
  useEffect(() => {
    if (mode && recorder.seconds >= MAX_SECONDS) finish(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder.seconds]);

  const buttonProps = {
    onPointerDown: (e) => {
      if (mic.state !== "granted") {
        e.preventDefault();
        mic.run(() => {});
        return;
      }
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        // Algunos navegadores no lo permiten; el gesto funciona igual.
      }
      gesture.current = {
        x: e.clientX,
        y: e.clientY,
        phase: "pending",
        timer: window.setTimeout(() => {
          if (!gesture.current) return;
          gesture.current.phase = "hold";
          navigator.vibrate?.(20);
          begin("hold");
        }, 220),
      };
    },
    onPointerMove: (e) => {
      const g = gesture.current;
      if (!g || g.phase !== "hold") return;
      const dx = Math.min(0, e.clientX - g.x);
      const dy = Math.min(0, e.clientY - g.y);
      setDrag({ dx, dy });
      if (dx < -100) {
        gesture.current = null;
        finish(false);
      } else if (dy < -70) {
        gesture.current = null;
        navigator.vibrate?.(15);
        setMode("locked");
      }
    },
    onPointerUp: () => {
      const g = gesture.current;
      gesture.current = null;
      if (!g) return;
      window.clearTimeout(g.timer);
      if (g.phase === "pending") begin("locked");
      else if (g.phase === "hold") finish(true);
    },
    onPointerCancel: () => {
      const g = gesture.current;
      gesture.current = null;
      if (!g) return;
      window.clearTimeout(g.timer);
      if (g.phase === "hold") finish(false);
    },
    onContextMenu: (e) => e.preventDefault(),
  };

  return { mode, drag, recorder, buttonProps, finish, sheet: mic.sheet };
}

// Lo que se ve mientras se graba (en lugar de la caja de texto).
export function RecordingBar({ voice }) {
  const { mode, drag, recorder, finish } = voice;
  const paused = recorder.status === "paused";
  if (mode === "hold") {
    const fade = Math.max(0.25, 1 + drag.dx / 120);
    return (
      <div className="flex min-h-[38px] flex-1 items-center gap-2 px-1">
        <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-rose-500" />
        <span className="w-10 shrink-0 text-xs font-semibold tabular-nums text-slate-700">{durationLabel(recorder.seconds)}</span>
        <span className="flex-1 text-center text-[11px] font-medium text-slate-500" style={{ opacity: fade, transform: `translateX(${drag.dx / 3}px)` }}>
          ‹ Desliza para cancelar
        </span>
      </div>
    );
  }
  return (
    <div className="flex min-h-[38px] flex-1 items-center gap-2">
      <button type="button" onClick={() => finish(false)} aria-label="Borrar nota de voz" className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl text-rose-500 hover:bg-rose-50">
        <Trash2 size={17} />
      </button>
      <span className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-slate-100 px-3 py-2">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${paused ? "bg-slate-400" : "animate-pulse bg-rose-500"}`} />
        <span className="text-xs font-semibold tabular-nums text-slate-700">{durationLabel(recorder.seconds)}</span>
        <span className="flex flex-1 items-center justify-center gap-[3px]" aria-hidden="true">
          {Array.from({ length: 18 }, (_, i) => (
            <span key={i} className={`w-[3px] rounded-full bg-slate-400 ${paused ? "" : "voice-bar"}`} style={{ height: 6 + ((i * 7) % 12), animationDelay: `${(i % 6) * 0.12}s` }} />
          ))}
        </span>
        <span className="text-[10px] font-medium text-slate-500">{paused ? "En pausa" : "Grabando"}</span>
      </span>
      <button
        type="button"
        onClick={() => (paused ? recorder.resume() : recorder.pause())}
        aria-label={paused ? "Reanudar grabación" : "Pausar grabación"}
        className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"
      >
        {paused ? <Play size={16} /> : <Pause size={16} />}
      </button>
    </div>
  );
}

// El botón del micrófono (y, al mantenerlo, el candado encima).
export function MicButton({ voice }) {
  const holding = voice.mode === "hold";
  const lift = Math.max(0, Math.min(1, -voice.drag.dy / 70));
  return (
    <div className="relative shrink-0">
      {holding && (
        <div className="absolute bottom-full left-1/2 mb-2 flex -translate-x-1/2 flex-col items-center rounded-full bg-white px-2 py-2 shadow-lg ring-1 ring-slate-200" style={{ transform: `translate(-50%, ${-lift * 12}px)` }}>
          <Lock size={16} className={lift > 0.6 ? "text-blue-600" : "text-slate-500"} />
          <span className="mt-1 flex flex-col items-center leading-none">
            <ChevronUp size={14} className="lock-chevron text-slate-500" style={{ animationDelay: "0.4s" }} />
            <ChevronUp size={14} className="-mt-2 lock-chevron text-slate-500" style={{ animationDelay: "0.2s" }} />
            <ChevronUp size={14} className="-mt-2 lock-chevron text-slate-500" style={{ animationDelay: "0s" }} />
          </span>
        </div>
      )}
      <button
        type="button"
        {...voice.buttonProps}
        aria-label="Grabar nota de voz (toca o mantén presionado)"
        className={`flex h-[38px] w-[38px] touch-none select-none items-center justify-center rounded-xl text-white transition ${holding ? "scale-125 bg-rose-500" : "bg-blue-600 hover:bg-blue-700"}`}
      >
        <Mic size={16} />
      </button>
    </div>
  );
}

/* ---------- Cámara dentro de Navio ---------- */

export function CameraCapture({ onCapture, onClose }) {
  const video = useRef(null);
  const stream = useRef(null);
  const [facing, setFacing] = useState("environment");
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        stream.current?.getTracks().forEach((t) => t.stop());
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1920 } }, audio: false });
        if (!alive) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream.current = s;
        if (video.current) video.current.srcObject = s;
        setError("");
      } catch (err) {
        if (err?.name === "NotAllowedError") forgetPermission("camera");
        setError("No se pudo abrir la cámara.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [facing]);

  useEffect(() => () => stream.current?.getTracks().forEach((t) => t.stop()), []);

  async function shoot() {
    const v = video.current;
    if (!v?.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext("2d").drawImage(v, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
    if (blob) onCapture(new File([blob], `foto-${Date.now()}.jpg`, { type: "image/jpeg" }));
  }

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-black">
      <div className="relative min-h-0 flex-1">
        <video ref={video} autoPlay playsInline muted className="absolute inset-0 h-full w-full object-contain" />
        {error && <p className="absolute inset-x-4 top-1/2 -translate-y-1/2 text-center text-sm text-white">{error}</p>}
        <button type="button" onClick={onClose} aria-label="Cerrar cámara" className="absolute left-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white" style={{ marginTop: "var(--safe-top)" }}>
          <X size={20} />
        </button>
      </div>
      <div className="flex items-center justify-around px-6 py-5" style={{ paddingBottom: "max(1.25rem, var(--safe-bottom))" }}>
        <span className="h-11 w-11" />
        <button type="button" onClick={shoot} aria-label="Tomar foto" className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-white">
          <span className="h-12 w-12 rounded-full bg-white" />
        </button>
        <button type="button" onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))} aria-label="Cambiar de cámara" className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white">
          <RefreshCw size={18} />
        </button>
      </div>
    </div>
  );
}

/* ---------- Vista previa antes de enviar ---------- */

function PreviewItem({ item, onRemove }) {
  return (
    <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
      {item.kind === "image" && <img src={item.url} alt="" className="h-full w-full object-cover" />}
      {item.kind === "video" && <video src={item.url} muted playsInline className="h-full w-full object-cover" />}
      {item.kind === "file" && (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center">
          <FileText size={22} className="text-blue-600" />
          <span className="line-clamp-2 break-all text-[10px] font-medium text-slate-600">{item.file.name}</span>
          <span className="text-[9px] text-slate-400">{sizeLabel(item.file.size)}</span>
        </div>
      )}
      <button type="button" onClick={onRemove} aria-label="Quitar" className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white">
        <X size={12} />
      </button>
    </div>
  );
}

// items: [{ file, kind, url }]. onSend(items, comentario).
export function AttachmentPreview({ items, onRemove, onCancel, onSend, onAddMore }) {
  const [caption, setCaption] = useState("");
  const big = items.length === 1 && items[0].kind !== "file";
  return (
    <div className="border-t border-slate-100 bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-bold text-slate-700">
          {items.length === 1 ? "Revisa antes de enviar" : `Revisa antes de enviar (${items.length})`}
        </p>
        <button type="button" onClick={onCancel} aria-label="Cancelar envío" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
          <X size={16} />
        </button>
      </div>
      {big ? (
        <div className="relative mb-2 flex max-h-64 justify-center overflow-hidden rounded-xl bg-slate-100">
          {items[0].kind === "image" ? <img src={items[0].url} alt="" className="max-h-64 object-contain" /> : <video src={items[0].url} controls playsInline className="max-h-64" />}
        </div>
      ) : (
        <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
          {items.map((item, index) => (
            <PreviewItem key={item.url} item={item} onRemove={() => onRemove(index)} />
          ))}
          {onAddMore && (
            <button type="button" onClick={onAddMore} className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl border border-dashed border-slate-300 text-2xl text-slate-400 hover:bg-slate-50">
              +
            </button>
          )}
        </div>
      )}
      {items.length === 1 && items[0].kind === "file" && (
        <p className="mb-2 flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <FileText size={16} className="shrink-0 text-blue-600" />
          <span className="min-w-0 flex-1 truncate font-medium">{items[0].file.name}</span>
          <span className="shrink-0 text-[11px] text-slate-400">{sizeLabel(items[0].file.size)}</span>
        </p>
      )}
      <div className="flex items-end gap-2">
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          rows={1}
          maxLength={4000}
          autoFocus
          placeholder="Agrega un comentario (opcional)…"
          aria-label="Comentario del archivo"
          className="max-h-28 min-h-[38px] flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-blue-400 focus:outline-none"
        />
        <button type="button" onClick={() => onSend(items, caption.trim())} aria-label="Enviar" className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white hover:bg-blue-700">
          <Send size={15} />
        </button>
      </div>
    </div>
  );
}

/* ---------- GIFs (GIPHY) ---------- */

async function giphy(path, params) {
  const query = new URLSearchParams({ api_key: GIPHY_KEY, rating: "pg-13", lang: "es", limit: "24", ...params });
  const res = await fetch(`https://api.giphy.com/v1/gifs/${path}?${query}`);
  if (!res.ok) throw new Error("GIPHY no respondió.");
  const data = await res.json();
  return (data.data ?? []).map((g) => ({
    id: g.id,
    title: g.title,
    preview: g.images?.fixed_width_small?.webp || g.images?.fixed_width_small?.url,
    send: g.images?.fixed_height?.webp || g.images?.fixed_height?.url,
    width: Number(g.images?.fixed_height?.width) || null,
    height: Number(g.images?.fixed_height?.height) || null,
  }));
}

export function GifPanel({ onPick, onClose }) {
  const [text, setText] = useState("");
  const [gifs, setGifs] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!GIPHY_KEY) return undefined;
    let alive = true;
    const timer = window.setTimeout(() => {
      (text.trim() ? giphy("search", { q: text.trim() }) : giphy("trending", {}))
        .then((list) => alive && setGifs(list))
        .catch(() => alive && setGifs([]));
    }, text ? 350 : 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [text]);

  async function pick(gif) {
    setBusy(true);
    try {
      const res = await fetch(gif.send);
      const blob = await res.blob();
      const type = blob.type || (gif.send.includes(".webp") ? "image/webp" : "image/gif");
      await onPick(new File([blob], `gif.${type.includes("webp") ? "webp" : "gif"}`, { type }), { width: gif.width, height: gif.height });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-slate-100 bg-white p-2.5">
      <div className="mb-2 flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Buscar GIF" disabled={!GIPHY_KEY} className="h-9 w-full rounded-xl border border-slate-200 pl-8 pr-2 text-xs focus:border-blue-400 focus:outline-none disabled:bg-slate-50" />
        </div>
        <button type="button" onClick={onClose} aria-label="Cerrar GIFs" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
          <X size={15} />
        </button>
      </div>
      {!GIPHY_KEY ? (
        <p className="py-6 text-center text-[11px] text-slate-400">Los GIF se activan al agregar la llave de GIPHY en Navio.</p>
      ) : gifs === null ? (
        <p className="py-6 text-center text-xs text-slate-400">Cargando…</p>
      ) : gifs.length === 0 ? (
        <p className="py-6 text-center text-xs text-slate-400">No se encontraron GIFs.</p>
      ) : (
        <div className={`grid max-h-56 grid-cols-3 gap-1 overflow-y-auto sm:grid-cols-4 ${busy ? "pointer-events-none opacity-60" : ""}`}>
          {gifs.map((g) => (
            <button key={g.id} type="button" onClick={() => pick(g)} title={g.title} className="aspect-square overflow-hidden rounded-lg bg-slate-100">
              <img src={g.preview} alt={g.title || "GIF"} loading="lazy" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
      <p className="mt-1 text-right text-[9px] font-semibold uppercase tracking-wide text-slate-400">Powered by GIPHY</p>
    </div>
  );
}


/* ---------- Forma del audio (notas de voz) ---------- */
// Se guarda como texto corto: un carácter por barra, de "0" (silencio) a "v" (máximo).
const WAVE_DIGITS = "0123456789abcdefghijklmnopqrstuv";

export function encodeWave(levels) {
  return levels.map((v) => WAVE_DIGITS[Math.max(0, Math.min(31, Math.round(v * 31)))]).join("");
}

export function decodeWave(text) {
  if (typeof text !== "string" || !/^[0-9a-v]{8,64}$/.test(text)) return null;
  return [...text].map((c) => WAVE_DIGITS.indexOf(c) / 31);
}

// Lee el audio y calcula qué tan fuerte suena en cada tramo (48 barras).
export async function waveFromBlob(blob, bars = 48) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx || !blob) return null;
  const ctx = new Ctx();
  try {
    const buffer = await new Promise((resolve, reject) => {
      blob.arrayBuffer().then((data) => {
        const done = ctx.decodeAudioData(data, resolve, reject);
        if (done?.then) done.then(resolve, reject);
      }, reject);
    });
    const samples = buffer.getChannelData(0);
    const size = Math.max(1, Math.floor(samples.length / bars));
    const levels = [];
    for (let b = 0; b < bars; b += 1) {
      let sum = 0;
      const from = b * size;
      const to = Math.min(samples.length, from + size);
      for (let i = from; i < to; i += 8) sum += samples[i] * samples[i];
      levels.push(Math.sqrt(sum / Math.max(1, (to - from) / 8)));
    }
    const max = Math.max(...levels, 0.0001);
    return encodeWave(levels.map((v) => Math.pow(v / max, 0.7)));
  } catch {
    return null;
  } finally {
    ctx.close?.().catch?.(() => {});
  }
}
