import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Camera,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ListPlus,
  ListTodo,
  Lock,
  Search,
  Clock,
  Copy,
  CornerUpLeft,
  Download,
  Edit2,
  FileText,
  Forward,
  Image as ImageIcon,
  Info,
  Languages,
  Mic,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Pin,
  PinOff,
  Plus,
  Send,
  Smile,
  Star,
  StarOff,
  Sticker,
  Trash2,
  Upload,
  Video,
  X,
} from "lucide-react";
import { supabase, useAuth, useToast, Modal } from "./NavioDashboard.jsx";
import { useInbox, TaskFormModal } from "./inbox.jsx";
import { isNativeApp } from "./tracking.jsx";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { useVoiceNote, RecordingBar, MicButton, CameraCapture, AttachmentPreview, GifPanel } from "./chatcomposer.jsx";
import { usePermissionGate } from "./permissions.jsx";
import { useCalls, callDuration } from "./calls.jsx";
import { clearChatNotifications } from "./push.jsx";

/* ---------------------------------------------------------------------- */
/*  Conversación: mensajes, archivos, voz, stickers y acciones            */
/* ---------------------------------------------------------------------- */

const PAGE_SIZE = 50;
const EDIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_FILE_MB = 25;
const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

const EXT_BY_MIME = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/mpeg": "mp3",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/zip": "zip",
};
const MIME_BY_EXT = Object.fromEntries(Object.entries(EXT_BY_MIME).map(([mime, ext]) => [ext, mime]));
MIME_BY_EXT.jpeg = "image/jpeg";
MIME_BY_EXT.m4a = "audio/mp4";

const KIND_LABEL = { image: "📷 Foto", video: "🎬 Video", file: "📄 Documento", voice: "🎤 Nota de voz", sticker: "Sticker" };
export const previewText = (kind, body) =>
  kind === "call" ? `📞 ${body || "Llamada"}` : kind && kind !== "text" ? `${KIND_LABEL[kind] ?? "Archivo"}${body ? `: ${body}` : ""}` : body;

const dayLabel = (iso) => {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 864e5);
  if (date.toDateString() === today.toDateString()) return "Hoy";
  if (date.toDateString() === yesterday.toDateString()) return "Ayer";
  return date.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
};
const hourLabel = (iso) => new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
const sizeLabel = (bytes) => (bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((bytes || 0) / 1024))} KB`);
const durationLabel = (s) => `${Math.floor((s || 0) / 60)}:${String(Math.round(s || 0) % 60).padStart(2, "0")}`;
const time = (iso) => (iso ? Date.parse(iso) : 0);

/* ---------- Archivos ---------- */

// Los archivos del chat son privados: se bajan con la sesión y se muestran
// desde la memoria del navegador (blob:), nunca con un enlace público.
const mediaCache = new Map();
function mediaUrl(path) {
  if (!mediaCache.has(path)) {
    mediaCache.set(
      path,
      supabase.storage
        .from("chat")
        .download(path)
        .then(({ data, error }) => {
          if (error) throw error;
          return URL.createObjectURL(data);
        })
    );
  }
  return mediaCache.get(path);
}
function useMediaUrl(path) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!path) return undefined;
    let alive = true;
    mediaUrl(path)
      .then((u) => alive && setUrl(u))
      .catch(() => {
        mediaCache.delete(path);
        if (alive) setUrl(false);
      });
    return () => {
      alive = false;
    };
  }, [path]);
  return url;
}

function fileInfo(file) {
  const fromName = (file.name || "").split(".").pop()?.toLowerCase();
  const mime = (file.type || MIME_BY_EXT[fromName] || "").split(";")[0];
  const ext = EXT_BY_MIME[mime] || (MIME_BY_EXT[fromName] ? fromName : null);
  return { mime: mime || MIME_BY_EXT[ext], ext };
}

async function uploadChatFile(file, companyId, folder) {
  const { mime, ext } = fileInfo(file);
  if (!ext) throw new Error("Ese tipo de archivo no se puede enviar.");
  if (file.size > MAX_FILE_MB * 1024 * 1024) throw new Error(`El archivo pesa más de ${MAX_FILE_MB} MB.`);
  const path = `${companyId}/${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("chat").upload(path, file, { contentType: mime });
  if (error) throw error;
  return { path, mime };
}

async function imageSize(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
    return size;
  } catch {
    return {};
  }
}

/* ---------- Mantener presionado ---------- */

function useLongPress(onLongPress, ms = 450) {
  const timer = useRef(null);
  const start = useRef(null);
  const cancel = () => {
    window.clearTimeout(timer.current);
    timer.current = null;
  };
  return {
    onPointerDown: (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      start.current = { x: e.clientX, y: e.clientY };
      cancel();
      timer.current = window.setTimeout(() => {
        timer.current = null;
        navigator.vibrate?.(15);
        onLongPress();
      }, ms);
    },
    onPointerMove: (e) => {
      if (!timer.current || !start.current) return;
      if (Math.abs(e.clientX - start.current.x) > 10 || Math.abs(e.clientY - start.current.y) > 10) cancel();
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e) => {
      e.preventDefault();
      cancel();
      onLongPress();
    },
  };
}

// Marca dentro del texto cada vez que aparece la palabra buscada.
function markTerm(text, term) {
  const value = String(text ?? "");
  if (!term) return value;
  const lower = value.toLowerCase();
  const needle = term.toLowerCase();
  const parts = [];
  let from = 0;
  let index = lower.indexOf(needle);
  while (index >= 0 && parts.length < 40) {
    if (index > from) parts.push(value.slice(from, index));
    parts.push(
      <mark key={index} className="rounded bg-amber-200 px-0.5 text-slate-900">
        {value.slice(index, index + needle.length)}
      </mark>
    );
    from = index + needle.length;
    index = lower.indexOf(needle, from);
  }
  if (from < value.length) parts.push(value.slice(from));
  return parts;
}

/* ---------- Deslizar para responder ---------- */

// En el teléfono, deslizar a la derecha un mensaje de la otra persona lo
// deja listo para responder (como en WhatsApp).
const SWIPE_REPLY_PX = 56;
function useSwipeReply(onReply) {
  const [dx, setDx] = useState(0);
  const drag = useRef(null);
  const reset = () => {
    drag.current = null;
    setDx(0);
  };
  if (!onReply) return { dx: 0, handlers: {} };
  return {
    dx,
    handlers: {
      onPointerDown: (e) => {
        if (e.pointerType === "mouse") return;
        drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, mode: null, ready: false };
      },
      onPointerMove: (e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        const mx = e.clientX - d.x;
        const my = e.clientY - d.y;
        if (!d.mode) {
          if (Math.abs(my) > 10 && Math.abs(my) >= Math.abs(mx)) d.mode = "scroll";
          else if (mx > 10 && mx > Math.abs(my) * 1.3) d.mode = "swipe";
          else return;
        }
        if (d.mode !== "swipe") return;
        const pulled = Math.max(0, Math.min(mx, 110));
        const ready = pulled >= SWIPE_REPLY_PX;
        if (ready && !d.ready) {
          try {
            navigator.vibrate?.(12);
          } catch {
            // Sin vibración.
          }
        }
        d.ready = ready;
        setDx(ready ? SWIPE_REPLY_PX + (pulled - SWIPE_REPLY_PX) * 0.3 : pulled);
      },
      onPointerUp: () => {
        const d = drag.current;
        reset();
        if (d?.mode === "swipe" && d.ready) onReply();
      },
      onPointerCancel: reset,
    },
  };
}

/* ---------- Piezas de un mensaje ---------- */

function Ticks({ message, receipts }) {
  if (message.pending) return <Clock size={11} className="opacity-70" aria-label="Enviando" />;
  const created = time(message.createdAt);
  if (receipts?.readUntil && created <= time(receipts.readUntil)) return <CheckCheck size={13} className="text-sky-200" aria-label="Visto" />;
  if (receipts?.deliveredUntil && created <= time(receipts.deliveredUntil)) return <CheckCheck size={13} className="opacity-70" aria-label="Recibido" />;
  return <Check size={13} className="opacity-70" aria-label="Enviado" />;
}

function ImageAttachment({ attachment, sticker = false, onOpen }) {
  const url = useMediaUrl(attachment.path);
  const ratio = attachment.width && attachment.height ? attachment.height / attachment.width : 0.75;
  if (url === false) return <p className="text-[11px] italic opacity-70">No se pudo cargar la imagen.</p>;
  if (sticker) {
    return url ? <img src={url} alt="Sticker" className="h-32 w-32 object-contain" draggable={false} /> : <div className="h-32 w-32 animate-pulse rounded-xl bg-slate-100" />;
  }
  return (
    <button type="button" onClick={() => url && onOpen(url)} className="block max-w-full overflow-hidden rounded-xl" style={{ width: 220, aspectRatio: `1 / ${Math.min(1.4, ratio)}` }}>
      {url ? <img src={url} alt={attachment.name || "Foto"} className="h-full w-full object-cover" draggable={false} /> : <span className="block h-full w-full animate-pulse bg-slate-200" />}
    </button>
  );
}

function VideoAttachment({ attachment }) {
  const url = useMediaUrl(attachment.path);
  if (url === false) return <p className="text-[11px] italic opacity-70">No se pudo cargar el video.</p>;
  return url ? <video src={url} controls playsInline preload="metadata" className="max-h-72 w-60 max-w-full rounded-xl bg-black" /> : <div className="h-40 w-60 max-w-full animate-pulse rounded-xl bg-slate-200" />;
}

function VoiceAttachment({ attachment, mine }) {
  const url = useMediaUrl(attachment.path);
  return (
    <div className="flex w-64 max-w-full min-w-0 items-center gap-2">
      <Mic size={16} className={mine ? "text-blue-100" : "text-blue-600"} />
      {url ? <audio src={url} controls preload="metadata" className="h-9 min-w-0 flex-1" /> : <span className="text-[11px] opacity-70">{url === false ? "No se pudo cargar" : "Cargando…"}</span>}
      {attachment.duration ? <span className="text-[10px] opacity-70">{durationLabel(attachment.duration)}</span> : null}
    </div>
  );
}

function FileAttachment({ attachment, mine }) {
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true);
    try {
      const url = await mediaUrl(attachment.path);
      const a = document.createElement("a");
      a.href = url;
      a.download = attachment.name || "archivo";
      a.click();
    } catch {
      // Se avisa en pantalla con el estado del botón.
    } finally {
      setBusy(false);
    }
  }
  return (
    <button type="button" onClick={download} className={`flex w-60 max-w-full min-w-0 items-center gap-2.5 rounded-xl px-2.5 py-2 text-left ${mine ? "bg-[rgb(255_255_255/0.14)]" : "bg-slate-100"}`}>
      <FileText size={22} className="shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold">{attachment.name || "Documento"}</span>
        <span className="block text-[10px] opacity-70">{sizeLabel(attachment.size)}</span>
      </span>
      <Download size={15} className={`shrink-0 ${busy ? "animate-pulse" : ""}`} />
    </button>
  );
}

function ReplyQuote({ reply, mine, onJump }) {
  if (!reply) return null;
  return (
    <button type="button" onClick={onJump} className={`mb-1 block w-full rounded-lg border-l-4 px-2 py-1 text-left ${mine ? "border-blue-200 bg-[rgb(255_255_255/0.14)]" : "border-blue-500 bg-slate-100"}`}>
      <span className={`block text-[10px] font-bold ${mine ? "text-blue-100" : "text-blue-600"}`}>{reply.senderName || "Mensaje"}</span>
      <span className="block truncate text-[11px] opacity-80">{reply.deletedAt ? "Mensaje borrado" : previewText(reply.kind, reply.body) || "Mensaje"}</span>
    </button>
  );
}

// En la PC, al pasar el mouse junto al mensaje: responder, reenviar y más.
function HoverActions({ onReply, onForward, onTask, onMore }) {
  const button = (label, Icon, onClick) => (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
    >
      <Icon size={14} />
    </button>
  );
  return (
    <div className="mb-1.5 hidden shrink-0 items-center rounded-full border border-slate-100 bg-white shadow-sm group-hover:flex group-focus-within:flex">
      {onReply && button("Responder", CornerUpLeft, onReply)}
      {onForward && button("Reenviar", Forward, onForward)}
      {onTask && button("Asignar como tarea", ListPlus, onTask)}
      {button("Más opciones", Smile, onMore)}
    </div>
  );
}

function Bubble({ message, mine, showSender, reply, reactions, starred, receipts, translation, highlighted, onMenu, onJump, onOpenImage, onToggleReaction, onSwipeReply, onReply, onForward, onTask, searchTerm, userId }) {
  const press = useLongPress(() => onMenu(message));
  const swipe = useSwipeReply(message.deletedAt ? null : onSwipeReply);
  const attachment = message.attachment;
  const isSticker = message.kind === "sticker";
  const grouped = useMemo(() => {
    const map = new Map();
    for (const r of reactions) {
      const entry = map.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false, names: [] };
      entry.count += 1;
      entry.mine = entry.mine || r.userId === userId;
      entry.names.push(r.userName || "Alguien");
      map.set(r.emoji, entry);
    }
    return [...map.values()];
  }, [reactions, userId]);

  if (message.deletedAt) {
    return (
      <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
        <p className={`rounded-2xl px-3 py-1.5 text-xs italic ${mine ? "bg-blue-600/60 text-blue-100" : "bg-white text-slate-400 shadow-sm"}`}>Mensaje borrado</p>
      </div>
    );
  }

  const meta = (
    <span className={`mt-0.5 flex items-center justify-end gap-1 text-[9px] ${isSticker ? "text-slate-400" : mine ? "text-blue-100" : "text-slate-400"}`}>
      {starred && <Star size={9} className="fill-current" />}
      {message.pinnedAt && <Pin size={9} />}
      {message.editedAt && <span>editado</span>}
      {hourLabel(message.createdAt)}
      {mine && <Ticks message={message} receipts={receipts} />}
    </span>
  );

  return (
    <div id={`msg-${message.id}`} {...swipe.handlers} className={`group relative flex items-end gap-1 ${onSwipeReply ? "touch-pan-y" : ""} ${mine ? "justify-end" : "justify-start"}`}>
      {onSwipeReply && swipe.dx > 0 && (
        <span
          className="pointer-events-none absolute left-0 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-slate-200 text-slate-600"
          style={{ opacity: Math.min(1, swipe.dx / SWIPE_REPLY_PX), transform: `translateY(-50%) scale(${0.6 + 0.4 * Math.min(1, swipe.dx / SWIPE_REPLY_PX)})` }}
          aria-hidden="true"
        >
          <CornerUpLeft size={14} />
        </span>
      )}
      {mine && <HoverActions onReply={onReply && (() => onReply(message))} onForward={onForward && (() => onForward(message))} onTask={onTask && (() => onTask(message))} onMore={() => onMenu(message)} />}
      <div className="min-w-0 max-w-[80%]" style={swipe.dx ? { transform: `translateX(${swipe.dx}px)` } : { transition: "transform 160ms ease-out" }}>
        <div
          {...press}
          className={`select-none [-webkit-touch-callout:none] ${
            isSticker ? "" : `rounded-2xl px-2.5 py-1.5 ${mine ? "rounded-br-md bg-blue-600 text-white" : "rounded-bl-md bg-white text-slate-700 shadow-sm"}`
          } ${highlighted ? "ring-2 ring-amber-400" : ""}`}
        >
          {!mine && showSender && !isSticker && <p className="text-[10px] font-bold text-blue-600">{message.senderName || "Alguien"}</p>}
          {message.forwarded && (
            <p className={`flex items-center gap-1 text-[10px] italic ${mine ? "text-blue-100" : "text-slate-400"}`}>
              <Forward size={10} /> Reenviado
            </p>
          )}
          <ReplyQuote reply={reply} mine={mine} onJump={() => onJump(message.replyToId)} />
          {attachment && message.kind === "image" && <ImageAttachment attachment={attachment} onOpen={onOpenImage} />}
          {attachment && isSticker && <ImageAttachment attachment={attachment} sticker />}
          {attachment && message.kind === "video" && <VideoAttachment attachment={attachment} />}
          {attachment && message.kind === "voice" && <VoiceAttachment attachment={attachment} mine={mine} />}
          {attachment && message.kind === "file" && <FileAttachment attachment={attachment} mine={mine} />}
          {message.body && <p className="whitespace-pre-wrap break-words px-0.5 pt-0.5 text-xs leading-relaxed">{markTerm(message.body, searchTerm)}</p>}
          {translation && (
            <p className={`mt-1 border-t pt-1 text-[11px] italic ${mine ? "border-blue-400 text-blue-50" : "border-slate-100 text-slate-500"}`}>
              <Languages size={10} className="mr-1 inline" />
              {translation}
            </p>
          )}
          {meta}
        </div>
        {grouped.length > 0 && (
          <div className={`-mt-1 flex flex-wrap gap-1 ${mine ? "justify-end" : "justify-start"}`}>
            {grouped.map((g) => (
              <button
                key={g.emoji}
                type="button"
                title={g.names.join(", ")}
                onClick={() => onToggleReaction(message, g.mine ? null : g.emoji)}
                className={`rounded-full border px-1.5 py-0.5 text-[11px] shadow-sm ${g.mine ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white"}`}
              >
                {g.emoji}
                {g.count > 1 ? ` ${g.count}` : ""}
              </button>
            ))}
          </div>
        )}
      </div>
      {!mine && <HoverActions onReply={onReply && (() => onReply(message))} onForward={onForward && (() => onForward(message))} onTask={onTask && (() => onTask(message))} onMore={() => onMenu(message)} />}
    </div>
  );
}

// Una llamada en la conversación: entrante, saliente o perdida, con su
// duración y un botón para volver a llamar.
function CallLogBubble({ message, mine, onCallBack }) {
  const info = message.attachment ?? {};
  const video = info.call === "video";
  const answered = info.duration != null;
  const Icon = mine ? PhoneOutgoing : answered ? PhoneIncoming : PhoneMissed;
  const title = video
    ? answered
      ? "Videollamada"
      : mine
      ? "Videollamada sin respuesta"
      : "Videollamada perdida"
    : answered
    ? "Llamada de voz"
    : mine
    ? "Llamada sin respuesta"
    : "Llamada perdida";
  const missed = !answered && !mine;
  const people = Number(info.people) > 2 ? Number(info.people) : 0;
  return (
    <div id={`msg-${message.id}`} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`flex min-w-[190px] max-w-[80%] items-center gap-2.5 rounded-2xl px-2.5 py-2 ${mine ? "rounded-br-md bg-blue-600 text-white" : "rounded-bl-md bg-white text-slate-700 shadow-sm"}`}>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${mine ? "bg-[rgb(255_255_255/0.16)]" : missed ? "bg-amber-50 text-amber-600" : "bg-slate-100 text-slate-600"}`}>
          <Icon size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold">{title}</span>
          <span className={`block text-[10px] ${mine ? "text-blue-100" : "text-slate-400"}`}>
            {hourLabel(message.createdAt)}
            {answered ? ` · ${callDuration(info.duration)}` : ""}
            {people ? ` · ${people} personas` : ""}
          </span>
        </span>
        {onCallBack && (
          <button
            type="button"
            onClick={() => onCallBack(video ? "video" : "audio")}
            aria-label="Volver a llamar"
            title="Volver a llamar"
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${mine ? "hover:bg-[rgb(255_255_255/0.16)]" : "text-blue-600 hover:bg-blue-50"}`}
          >
            {video ? <Video size={15} /> : <Phone size={15} />}
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------- Ventanas de acciones ---------- */

function ActionSheet({ message, mine, canDeleteAll, canEdit, starred, advanced, onAction, onClose }) {
  const item = (id, Icon, label, danger = false) => (
    <button
      key={id}
      type="button"
      onClick={() => onAction(id)}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium ${danger ? "text-rose-600 hover:bg-rose-50" : "text-slate-700 hover:bg-slate-50"}`}
    >
      <Icon size={17} className="shrink-0" /> {label}
    </button>
  );
  return (
    <Modal title="Mensaje" width="max-w-sm" onClose={onClose}>
      {advanced && (
        <div className="mb-2 flex justify-between rounded-2xl bg-slate-50 p-1.5">
          {REACTIONS.map((emoji) => (
            <button key={emoji} type="button" onClick={() => onAction(`react:${emoji}`)} className="flex h-10 w-10 items-center justify-center rounded-full text-xl hover:bg-white">
              {emoji}
            </button>
          ))}
        </div>
      )}
      <div className="space-y-0.5">
        {advanced && item("reply", CornerUpLeft, "Responder")}
        {message.body && item("copy", Copy, "Copiar")}
        {advanced && item("forward", Forward, "Reenviar")}
        {advanced && item("task", ListPlus, "Asignar como tarea")}
        {canEdit && item("edit", Edit2, "Editar")}
        {advanced && item(message.pinnedAt ? "unpin" : "pin", message.pinnedAt ? PinOff : Pin, message.pinnedAt ? "Dejar de fijar" : "Fijar")}
        {advanced && item(starred ? "unstar" : "star", starred ? StarOff : Star, starred ? "Quitar de destacados" : "Destacar")}
        {mine && advanced && item("info", Info, "Información")}
        {message.body && advanced && item("translate", Languages, "Traducir")}
        {advanced && item("hide", Trash2, "Eliminar para mí", true)}
        {canDeleteAll && item("delete", Trash2, "Eliminar para todos", true)}
      </div>
    </Modal>
  );
}

function InfoModal({ message, onClose }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    supabase.rpc("message_receipts", { target_message: message.id }).then(({ data }) => setRows(data ?? []));
  }, [message.id]);
  const read = (rows ?? []).filter((r) => r.readAt);
  const delivered = (rows ?? []).filter((r) => !r.readAt && r.deliveredAt);
  const waiting = (rows ?? []).filter((r) => !r.readAt && !r.deliveredAt);
  const section = (title, list, Icon, field) => (
    <div>
      <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
        <Icon size={13} /> {title} ({list.length})
      </p>
      {list.length === 0 ? (
        <p className="text-xs text-slate-400">Nadie todavía.</p>
      ) : (
        <ul className="space-y-1">
          {list.map((r) => (
            <li key={r.userId} className="flex justify-between gap-2 text-xs text-slate-600">
              <span className="truncate">{r.name}</span>
              {field && <span className="shrink-0 text-slate-400">{new Date(r[field]).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  return (
    <Modal title="Información del mensaje" width="max-w-sm" onClose={onClose}>
      <p className="mb-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
        Enviado {new Date(message.createdAt).toLocaleString("es-MX", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
      </p>
      {rows === null ? (
        <p className="text-xs text-slate-400">Cargando…</p>
      ) : (
        <div className="space-y-3">
          {section("Visto por", read, CheckCheck, "readAt")}
          {section("Recibido por", delivered, CheckCheck, "deliveredAt")}
          {section("Aún no lo recibe", waiting, Check, null)}
        </div>
      )}
    </Modal>
  );
}

function ForwardModal({ message, currentChannelId, onClose }) {
  const inbox = useInbox();
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const channels = inbox?.channels ?? [];
  const title = (c) => (c.kind === "general" ? "General" : c.kind === "direct" ? c.otherUserName || "Conversación" : c.name || "Grupo");

  async function send() {
    setBusy(true);
    let failed = 0;
    for (const channelId of selected) {
      try {
        let attachment = null;
        if (message.attachment?.path) {
          const ext = message.attachment.path.split(".").pop();
          const path = `${profile.companyId}/${channelId}/${crypto.randomUUID()}.${ext}`;
          const { error } = await supabase.storage.from("chat").copy(message.attachment.path, path);
          if (error) throw error;
          attachment = { ...message.attachment, path };
        }
        const { error } = await supabase.from("chat_messages").insert({ channelId, body: message.body || "", kind: message.kind || "text", attachment, forwarded: true });
        if (error) throw error;
      } catch {
        failed += 1;
      }
    }
    setBusy(false);
    inbox?.reloadChannels();
    showToast(failed ? `No se pudo reenviar a ${failed} conversación(es).` : "Mensaje reenviado.");
    onClose();
  }

  return (
    <Modal title="Reenviar a…" width="max-w-sm" onClose={onClose}>
      <div className="max-h-[55vh] space-y-1 overflow-y-auto">
        {channels
          .filter((c) => c.id !== currentChannelId)
          .map((c) => (
            <label key={c.id} className="flex cursor-pointer items-center gap-2.5 rounded-xl px-2 py-2 hover:bg-slate-50">
              <input type="checkbox" checked={selected.includes(c.id)} onChange={() => setSelected((prev) => (prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id]))} className="h-4 w-4 accent-blue-600" />
              <span className="truncate text-sm text-slate-700">{title(c)}</span>
            </label>
          ))}
        {channels.length <= 1 && <p className="py-6 text-center text-xs text-slate-400">No tienes otras conversaciones.</p>}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">
          Cancelar
        </button>
        <button type="button" onClick={send} disabled={!selected.length || busy} className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          {busy ? "Reenviando…" : `Reenviar${selected.length ? ` (${selected.length})` : ""}`}
        </button>
      </div>
    </Modal>
  );
}

function ImageViewer({ url, onClose }) {
  return (
    <Modal title="Foto" width="max-w-3xl" onClose={onClose}>
      <img src={url} alt="" className="max-h-[75vh] w-full rounded-xl object-contain" />
    </Modal>
  );
}

/* ---------- Stickers ---------- */

// Lee los archivos de un .zip o .wastickers (paquete de stickers de WhatsApp)
// sin librerías: el formato zip se recorre a mano y cada archivo se
// descomprime con el navegador.
async function readZip(file) {
  const buffer = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(buffer.buffer);
  let end = buffer.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error("El paquete no es un .zip válido.");
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const files = [];
  for (let i = 0; i < count && files.length < 60; i += 1) {
    const method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(buffer.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
    if (!/\.(webp|png|gif)$/i.test(name) || /tray/i.test(name)) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = buffer.subarray(start, start + compressed);
    let bytes = data;
    if (method === 8) bytes = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
    else if (method !== 0) continue;
    const ext = name.split(".").pop().toLowerCase();
    files.push(new File([bytes], name.split("/").pop(), { type: ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : "image/webp" }));
  }
  return files;
}

// Un sticker de WhatsApp: 512×512 en WEBP, de menos de 100 KB.
async function toWhatsAppSticker(blob, size = 512, type = "image/webp", maxBytes = 100 * 1024) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const scale = Math.min(size / bitmap.width, size / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
  bitmap.close?.();
  let quality = 0.9;
  let out = null;
  do {
    out = await new Promise((resolve) => canvas.toBlob(resolve, type, quality));
    quality -= 0.15;
  } while (out && out.size > maxBytes && quality > 0.2);
  return out;
}

const toBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

function StickerThumb({ sticker, onClick }) {
  const url = useMediaUrl(sticker.path);
  return (
    <button type="button" onClick={onClick} className="flex h-16 w-16 items-center justify-center rounded-xl hover:bg-slate-100">
      {url ? <img src={url} alt="" className="max-h-14 max-w-14 object-contain" draggable={false} /> : <span className="h-12 w-12 animate-pulse rounded-lg bg-slate-100" />}
    </button>
  );
}

function StickerPanel({ onSend, onClose }) {
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const [stickers, setStickers] = useState(null);
  const [busy, setBusy] = useState("");
  const [pack, setPack] = useState(null);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("chat_stickers").select("*").order("id", { ascending: false }).limit(300);
    setStickers(data ?? []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const packs = [...new Set((stickers ?? []).map((s) => s.pack))];
  const currentPack = pack ?? packs[0] ?? null;
  const shown = (stickers ?? []).filter((s) => s.pack === currentPack);

  async function importFiles(fileList) {
    const picked = [...fileList];
    if (!picked.length) return;
    setBusy("Importando stickers…");
    let images = [];
    let packName = "Mis stickers";
    try {
      for (const file of picked) {
        if (/\.(zip|wastickers)$/i.test(file.name)) {
          images = images.concat(await readZip(file));
          packName = file.name.replace(/\.(zip|wastickers)$/i, "").slice(0, 60) || packName;
        } else if (/^image\/(webp|png|gif)$/.test(file.type) || /\.(webp|png|gif)$/i.test(file.name)) {
          images.push(file);
        }
      }
      let added = 0;
      for (const image of images.slice(0, 60)) {
        const blob = image.size > 500 * 1024 || image.type === "image/png" ? await toWhatsAppSticker(image) : image;
        const file = new File([blob], "sticker.webp", { type: blob.type || "image/webp" });
        const { path } = await uploadChatFile(file, profile.companyId, `stickers/${user.id}`);
        const { error } = await supabase.from("chat_stickers").insert({ path, pack: packName });
        if (!error) added += 1;
      }
      showToast(added ? `Se importaron ${added} stickers.` : "No se encontraron stickers en esos archivos.");
      setPack(packName);
      await load();
    } catch (err) {
      showToast(`No se pudieron importar: ${err.message}`);
    } finally {
      setBusy("");
    }
  }

  // App Android: el paquete pasa directo a WhatsApp.
  async function exportToWhatsApp() {
    let plugin = null;
    try {
      plugin = isNativeApp() && Capacitor.isPluginAvailable("WhatsAppStickers") ? registerPlugin("WhatsAppStickers") : null;
    } catch {
      plugin = null;
    }
    if (!plugin) {
      showToast("Para mandarlos a WhatsApp, abre Navio desde la app de Android (versión 1.0.5 o más nueva).");
      return;
    }
    if (shown.length < 3) {
      showToast("WhatsApp pide al menos 3 stickers por paquete.");
      return;
    }
    setBusy("Preparando el paquete para WhatsApp…");
    try {
      const files = [];
      for (const s of shown.slice(0, 30)) {
        const { data, error } = await supabase.storage.from("chat").download(s.path);
        if (error) throw error;
        files.push(await toBase64(await toWhatsAppSticker(data)));
      }
      const { data: first } = await supabase.storage.from("chat").download(shown[0].path);
      const tray = await toBase64(await toWhatsAppSticker(first, 96, "image/png", 50 * 1024));
      await plugin.addPack({ identifier: `navio_${String(currentPack).toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 30)}`, name: currentPack, publisher: "Navio", trayImage: tray, stickers: files });
    } catch (err) {
      showToast(`No se pudo enviar a WhatsApp: ${err.message}`);
    } finally {
      setBusy("");
    }
  }

  async function removeSticker(sticker) {
    await supabase.from("chat_stickers").delete().eq("id", sticker.id);
    supabase.storage.from("chat").remove([sticker.path]).catch(() => {});
    load();
  }

  return (
    <div className="border-t border-slate-100 bg-white p-2.5">
      <div className="mb-2 flex items-center gap-2">
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {packs.map((p) => (
            <button key={p} type="button" onClick={() => setPack(p)} className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${p === currentPack ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}>
              {p}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
          <Upload size={12} /> Importar
        </button>
        {isNativeApp() && shown.length >= 3 && (
          <button type="button" onClick={exportToWhatsApp} className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700">
            Agregar a WhatsApp
          </button>
        )}
        <button type="button" onClick={onClose} aria-label="Cerrar stickers" className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-100">
          <X size={15} />
        </button>
        <input ref={fileRef} type="file" multiple accept=".webp,.png,.gif,.zip,.wastickers,image/webp,image/png,image/gif" className="hidden" onChange={(e) => importFiles(e.target.files).finally(() => (e.target.value = ""))} />
      </div>
      {busy && <p className="py-2 text-center text-[11px] text-slate-500">{busy}</p>}
      {stickers === null ? (
        <p className="py-4 text-center text-xs text-slate-400">Cargando…</p>
      ) : shown.length === 0 ? (
        <p className="py-4 text-center text-[11px] leading-relaxed text-slate-400">
          Importa tus stickers: los de WhatsApp están en el teléfono en la carpeta <b>WhatsApp/Media/WhatsApp Stickers</b> (archivos .webp), o usa un paquete .wastickers.
        </p>
      ) : (
        <div className="grid max-h-52 grid-cols-5 gap-1 overflow-y-auto sm:grid-cols-8">
          {shown.map((s) => (
            <div key={s.id} className="group relative">
              <StickerThumb sticker={s} onClick={() => onSend(s)} />
              <button type="button" onClick={() => removeSticker(s)} aria-label="Quitar sticker" className="absolute right-0 top-0 hidden rounded-full bg-white p-0.5 text-slate-400 shadow group-hover:block">
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
      {!isNativeApp() && shown.length > 0 && <p className="mt-1 text-[10px] text-slate-400">Para pasar este paquete a WhatsApp, ábrelo desde la app Navio para Android.</p>}
    </div>
  );
}

/* ---------- La conversación ---------- */

export function ChatConversation({ channel, isAdmin, onBack, header, jumpTo: jumpRequest = null }) {
  const { user, profile } = useAuth();
  const inbox = useInbox();
  const calls = useCalls();
  const composerRef = useRef(null);
  // Buscar en este chat, tareas del chat y "asignar como tarea".
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [searchHits, setSearchHits] = useState(null); // ids, del más nuevo al más viejo
  const [searchIndex, setSearchIndex] = useState(0);
  const [taskFrom, setTaskFrom] = useState(null); // mensaje (o {} para una tarea suelta)
  const [tasksOpen, setTasksOpen] = useState(() => {
    try {
      return window.localStorage.getItem("navio.chat.tasks") === "open" && window.innerWidth >= 1024;
    } catch {
      return false;
    }
  });
  const pendingJump = useRef(null);
  const lastIdRef = useRef(0);
  const { showToast } = useToast();
  const [messages, setMessages] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [reactions, setReactions] = useState([]);
  const [hidden, setHidden] = useState(() => new Set());
  const [stars, setStars] = useState(() => new Set());
  const [pinned, setPinned] = useState([]);
  const [receipts, setReceipts] = useState(null);
  const [advanced, setAdvanced] = useState(true); // false si falta la migración v25
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [menuFor, setMenuFor] = useState(null);
  const [infoFor, setInfoFor] = useState(null);
  const [forwardFor, setForwardFor] = useState(null);
  const [viewer, setViewer] = useState(null);
  const [translations, setTranslations] = useState({});
  const [attachOpen, setAttachOpen] = useState(false);
  const [stickersOpen, setStickersOpen] = useState(false);
  const [pending, setPending] = useState([]); // archivos por revisar antes de enviar
  const [cameraOpen, setCameraOpen] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const camera = usePermissionGate("camera");
  const [uploading, setUploading] = useState("");
  const [onlyStarred, setOnlyStarred] = useState(false);
  const [highlight, setHighlight] = useState(null);
  const scrollRef = useRef(null);
  const stickRef = useRef(true);
  const galleryRef = useRef(null);
  const docRef = useRef(null);
  const channelId = channel.id;

  const loadMessages = useCallback(
    async (beforeId = null) => {
      let query = supabase.from("chat_messages").select("*").eq("channelId", channelId).order("id", { ascending: false }).limit(PAGE_SIZE);
      if (beforeId) query = query.lt("id", beforeId);
      const { data } = await query;
      const page = (data ?? []).slice().reverse();
      setHasMore(page.length === PAGE_SIZE);
      setMessages((prev) => (beforeId ? [...page, ...(prev ?? [])] : page));
    },
    [channelId]
  );

  const loadExtras = useCallback(async () => {
    const [r, h, s, p] = await Promise.all([
      supabase.from("chat_reactions").select("*").eq("channelId", channelId).limit(3000),
      supabase.from("chat_hidden").select("messageId").limit(3000),
      supabase.from("chat_stars").select("messageId").eq("channelId", channelId).limit(1000),
      supabase.from("chat_messages").select("*").eq("channelId", channelId).not("pinnedAt", "is", null).order("pinnedAt", { ascending: false }).limit(3),
    ]);
    if (r.error) {
      setAdvanced(false);
      return;
    }
    setReactions(r.data ?? []);
    setHidden(new Set((h.data ?? []).map((x) => x.messageId)));
    setStars(new Set((s.data ?? []).map((x) => x.messageId)));
    setPinned(p.data ?? []);
  }, [channelId]);

  const loadReceipts = useCallback(async () => {
    const { data, error } = await supabase.rpc("channel_receipts", { target_channel: channelId });
    if (!error) setReceipts(Array.isArray(data) ? data[0] : data);
  }, [channelId]);

  // Mientras esta conversación está abierta, sus mensajes no salen como aviso.
  useEffect(() => {
    inbox.setOpenChannel?.(channelId);
    clearChatNotifications(channelId);
    return () => inbox.setOpenChannel?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  useEffect(() => {
    setMessages(null);
    setDraft("");
    setReplyTo(null);
    setEditing(null);
    stickRef.current = true;
    loadMessages();
    loadExtras();
    loadReceipts();
    inbox.markChannelRead(channelId);
    const off = inbox.subscribeMessages((payload) => {
      const table = payload.table ?? "chat_messages";
      const row = payload.new ?? payload.old;
      if (table === "chat_reactions") {
        if (Number(row?.channelId) !== Number(channelId)) return;
        setReactions((prev) => {
          const rest = prev.filter((x) => !(x.messageId === row.messageId && x.userId === row.userId));
          return payload.eventType === "DELETE" ? rest : [...rest, payload.new];
        });
        return;
      }
      if (table === "chat_members") {
        if (Number(row?.channelId) === Number(channelId) || channel.kind === "general") loadReceipts();
        return;
      }
      if (!row || Number(row.channelId) !== Number(channelId)) return;
      setMessages((prev) => {
        if (!prev) return prev;
        if (payload.eventType === "INSERT") return prev.some((m) => m.id === row.id) ? prev : [...prev.filter((m) => !(m.pending && m.body === row.body && row.senderId === user?.id)), row];
        return prev.map((m) => (m.id === row.id ? row : m));
      });
      if (payload.eventType === "UPDATE") {
        setPinned((prev) => {
          const rest = prev.filter((m) => m.id !== row.id);
          return row.pinnedAt ? [row, ...rest].slice(0, 3) : rest;
        });
      }
      if (payload.eventType === "INSERT" && row.senderId !== user?.id) inbox.markChannelRead(channelId);
    });
    const poll = window.setInterval(loadReceipts, 20000);
    const freshPoll = window.setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      const last = lastIdRef.current;
      if (!last) return;
      const { data } = await supabase.from("chat_messages").select("*").eq("channelId", channelId).gt("id", last).order("id", { ascending: true }).limit(50);
      if (!data?.length) return;
      setMessages((prev) => {
        if (!prev) return prev;
        const byId = new Map(prev.filter((m) => !m.pending || !data.some((d) => d.senderId === m.senderId && d.body === m.body)).map((m) => [m.id, m]));
        for (const row of data) byId.set(row.id, row);
        return [...byId.values()].sort((x, y) => (typeof x.id === "number" && typeof y.id === "number" ? x.id - y.id : 0));
      });
      if (data.some((m) => m.senderId !== user?.id)) inbox.markChannelRead(channelId);
    }, 8000);
    // Si el teléfono pausó Navio (otra app, pantalla apagada), al volver se
    // traen los mensajes que llegaron mientras tanto.
    const catchUp = async () => {
      if (document.visibilityState !== "visible") return;
      const { data } = await supabase.from("chat_messages").select("*").eq("channelId", channelId).order("id", { ascending: false }).limit(PAGE_SIZE);
      if (data) {
        setMessages((prev) => {
          const byId = new Map((prev ?? []).filter((m) => !m.pending).map((m) => [m.id, m]));
          for (const row of data) byId.set(row.id, row);
          return [...byId.values()].sort((x, y) => x.id - y.id);
        });
      }
      loadExtras();
      loadReceipts();
      inbox.markChannelRead(channelId);
    };
    document.addEventListener("visibilitychange", catchUp);
    window.addEventListener("online", catchUp);
    window.addEventListener("focus", catchUp);
    return () => {
      off();
      window.clearInterval(poll);
      window.clearInterval(freshPoll);
      document.removeEventListener("visibilitychange", catchUp);
      window.removeEventListener("online", catchUp);
      window.removeEventListener("focus", catchUp);
    };
    // "inbox" cambia con cada mensaje; solo interesa la conversación abierta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, loadMessages, loadExtras, loadReceipts]);

  useEffect(() => {
    const box = scrollRef.current;
    if (box && stickRef.current) box.scrollTop = box.scrollHeight;
  }, [messages, stickersOpen]);

  const byId = useMemo(() => new Map((messages ?? []).map((m) => [m.id, m])), [messages]);
  const reactionsBy = useMemo(() => {
    const map = new Map();
    for (const r of reactions) map.set(r.messageId, [...(map.get(r.messageId) ?? []), r]);
    return map;
  }, [reactions]);

  function jumpTo(id) {
    const el = document.getElementById(`msg-${id}`);
    if (!el) {
      loadAround(id);
      return;
    }
    stickRef.current = false;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlight(id);
    window.setTimeout(() => setHighlight(null), 1600);
  }

  // Trae un mensaje viejo (y los que siguen) para poder ir a él.
  async function loadAround(id) {
    stickRef.current = false;
    pendingJump.current = id;
    const [after, before] = await Promise.all([
      supabase.from("chat_messages").select("*").eq("channelId", channelId).gte("id", id).order("id", { ascending: true }).limit(300),
      supabase.from("chat_messages").select("*").eq("channelId", channelId).lt("id", id).order("id", { ascending: false }).limit(20),
    ]);
    const rows = [...(before.data ?? []), ...(after.data ?? [])];
    if (!rows.some((m) => m.id === id)) {
      pendingJump.current = null;
      showToast("No se encontró ese mensaje.");
      return;
    }
    setHasMore((before.data ?? []).length === 20);
    setMessages((prev) => {
      const byId = new Map((prev ?? []).filter((m) => !m.pending).map((m) => [m.id, m]));
      for (const row of rows) byId.set(row.id, row);
      return [...byId.values()].sort((x, y) => x.id - y.id);
    });
  }

  // Al terminar de cargar, se va al mensaje pendiente.
  useEffect(() => {
    const id = pendingJump.current;
    if (!id) return;
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    pendingJump.current = null;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlight(id);
    window.setTimeout(() => setHighlight(null), 1600);
  }, [messages]);

  // Desde la búsqueda de la lista: ir al mensaje encontrado.
  useEffect(() => {
    if (!jumpRequest?.messageId || messages === null) return;
    jumpTo(jumpRequest.messageId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpRequest?.at, messages === null]);

  // Buscar palabras en este chat.
  const searchTerm = searchOpen ? searchText.trim() : "";
  useEffect(() => {
    if (searchTerm.length < 2) {
      setSearchHits(null);
      return undefined;
    }
    let alive = true;
    const timer = window.setTimeout(async () => {
      const { data } = await supabase
        .from("chat_messages")
        .select("id")
        .eq("channelId", channelId)
        .ilike("body", `%${searchTerm.replace(/[%_\\]/g, (m) => `\\${m}`)}%`)
        .is("deletedAt", null)
        .order("id", { ascending: false })
        .limit(200);
      if (!alive) return;
      const ids = (data ?? []).map((m) => m.id);
      setSearchHits(ids);
      setSearchIndex(0);
      if (ids[0]) jumpTo(ids[0]);
    }, 350);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm, channelId]);
  const moveSearch = (step) => {
    if (!searchHits?.length) return;
    const next = (searchIndex + step + searchHits.length) % searchHits.length;
    setSearchIndex(next);
    jumpTo(searchHits[next]);
  };

  // Tareas pendientes de este chat.
  const chatTasks = (inbox?.tasks ?? []).filter((t) => Number(t.channelId) === Number(channelId) && ["open", "in_progress", "review"].includes(t.status));
  const toggleTasks = () =>
    setTasksOpen((v) => {
      try {
        window.localStorage.setItem("navio.chat.tasks", v ? "closed" : "open");
      } catch {
        // Solo es comodidad.
      }
      return !v;
    });
  async function finishTask(task) {
    const { error } = await supabase.from("tasks").update({ status: "done" }).eq("id", task.id);
    if (error) showToast(error.message);
    else {
      showToast("Tarea terminada.");
      inbox.reloadTasks?.();
    }
  }

  async function insertMessage(row) {
    stickRef.current = true;
    const temp = { id: `tmp-${crypto.randomUUID()}`, channelId, senderId: user?.id, senderName: "", createdAt: new Date().toISOString(), pending: true, kind: "text", ...row };
    setMessages((prev) => [...(prev ?? []), temp]);
    const payload = advanced ? row : { channelId, body: row.body };
    const { data, error } = await supabase.from("chat_messages").insert({ channelId, ...payload }).select().single();
    if (error) {
      setMessages((prev) => (prev ?? []).filter((m) => m.id !== temp.id));
      showToast(`No se pudo enviar: ${error.message}`);
      return false;
    }
    setMessages((prev) => {
      const rest = (prev ?? []).filter((m) => m.id !== temp.id);
      return rest.some((m) => m.id === data.id) ? rest : [...rest, data];
    });
    inbox.reloadChannels();
    return true;
  }

  async function send() {
    const body = draft.trim();
    if (!body) return;
    if (editing) {
      const { error } = await supabase.rpc("edit_chat_message", { target_message: editing.id, new_body: body });
      if (error) showToast(error.message);
      else {
        setMessages((prev) => prev.map((m) => (m.id === editing.id ? { ...m, body, editedAt: new Date().toISOString() } : m)));
        setEditing(null);
        setDraft("");
      }
      return;
    }
    setDraft("");
    const reply = replyTo;
    setReplyTo(null);
    const ok = await insertMessage({ body, kind: "text", ...(reply ? { replyToId: reply.id } : {}) });
    if (!ok) setDraft(body);
  }

  async function sendFile(file, kindOverride = null, extra = {}, caption = "") {
    setAttachOpen(false);
    setUploading(`Enviando ${file.name || "archivo"}…`);
    try {
      const { path, mime } = await uploadChatFile(file, profile.companyId, channelId);
      const kind = kindOverride ?? (mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : "file");
      const dims = kind === "image" ? await imageSize(file) : {};
      const reply = replyTo;
      setReplyTo(null);
      await insertMessage({ body: kind === "voice" ? "" : caption, kind, attachment: { path, name: file.name || null, mime, size: file.size, ...dims, ...extra }, ...(reply ? { replyToId: reply.id } : {}) });
    } catch (err) {
      showToast(/bucket|not found|policy|row-level/i.test(err.message) ? "Los archivos del chat se activan al aplicar la actualización v25 de la base de datos." : `No se pudo enviar: ${err.message}`);
    } finally {
      setUploading("");
    }
  }

  const voice = useVoiceNote({
    onSend: (blob, seconds) => {
      const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
      sendFile(new File([blob], `nota-de-voz.${ext}`, { type: blob.type }), "voice", { duration: Math.round(seconds * 10) / 10 });
    },
    onError: () => showToast("No se pudo usar el micrófono. Revisa el permiso en los ajustes."),
  });

  // Fotos, videos y documentos esperan aquí a que se revisen y se comenten.
  function addPending(fileList, kind, reset) {
    const files = [...(fileList ?? [])].slice(0, 10);
    reset?.();
    if (!files.length) return;
    setAttachOpen(false);
    setPending((prev) => [
      ...prev,
      ...files.map((file) => {
        const type = file.type || "";
        const k = kind ?? (type.startsWith("image/") ? "image" : type.startsWith("video/") ? "video" : "file");
        return { file, kind: k, url: URL.createObjectURL(file) };
      }),
    ].slice(0, 10));
  }
  function clearPending(revoke = true) {
    setPending((prev) => {
      if (revoke) prev.forEach((item) => URL.revokeObjectURL(item.url));
      return [];
    });
  }

  async function sendSticker(sticker) {
    setStickersOpen(false);
    const path = `${profile.companyId}/${channelId}/${crypto.randomUUID()}.${sticker.path.split(".").pop()}`;
    const { error } = await supabase.storage.from("chat").copy(sticker.path, path);
    if (error) {
      showToast(`No se pudo enviar el sticker: ${error.message}`);
      return;
    }
    await insertMessage({ body: "", kind: "sticker", attachment: { path, mime: "image/webp" } });
  }

  async function toggleReaction(message, emoji) {
    if (!emoji) {
      setReactions((prev) => prev.filter((r) => !(r.messageId === message.id && r.userId === user?.id)));
      await supabase.from("chat_reactions").delete().eq("messageId", message.id).eq("userId", user?.id);
      return;
    }
    const mine = { messageId: message.id, userId: user?.id, channelId, emoji, userName: "Tú" };
    setReactions((prev) => [...prev.filter((r) => !(r.messageId === message.id && r.userId === user?.id)), mine]);
    const { error } = await supabase.from("chat_reactions").upsert({ messageId: message.id, emoji }, { onConflict: "messageId,userId" });
    if (error) showToast(`No se pudo reaccionar: ${error.message}`);
  }

  function startReply(message) {
    setEditing(null);
    setReplyTo(message);
    composerRef.current?.focus();
  }

  async function onAction(action) {
    const message = menuFor;
    setMenuFor(null);
    if (!message) return;
    if (action.startsWith("react:")) return toggleReaction(message, action.slice(6));
    if (action === "reply") {
      setEditing(null);
      setReplyTo(message);
    } else if (action === "copy") {
      navigator.clipboard?.writeText(message.body ?? "");
      showToast("Copiado.");
    } else if (action === "forward") setForwardFor(message);
    else if (action === "task") setTaskFrom(message);
    else if (action === "edit") {
      setReplyTo(null);
      setEditing(message);
      setDraft(message.body ?? "");
    } else if (action === "pin" || action === "unpin") {
      const { error } = await supabase.rpc("pin_chat_message", { target_message: message.id, pin: action === "pin" });
      if (error) showToast(error.message);
      else loadExtras();
    } else if (action === "star" || action === "unstar") {
      const next = new Set(stars);
      if (action === "star") {
        next.add(message.id);
        await supabase.from("chat_stars").insert({ messageId: message.id });
      } else {
        next.delete(message.id);
        await supabase.from("chat_stars").delete().eq("messageId", message.id);
      }
      setStars(next);
    } else if (action === "info") setInfoFor(message);
    else if (action === "translate") {
      setTranslations((prev) => ({ ...prev, [message.id]: "Traduciendo…" }));
      const { data, error } = await supabase.functions.invoke("translate", { body: { text: message.body } });
      setTranslations((prev) => ({ ...prev, [message.id]: error || !data?.translation ? "No se pudo traducir. (La traducción se activa al publicar la función translate en Supabase.)" : data.translation }));
    } else if (action === "hide") {
      setHidden((prev) => new Set([...prev, message.id]));
      const { error } = await supabase.from("chat_hidden").insert({ messageId: message.id });
      if (error) showToast(`No se pudo borrar: ${error.message}`);
    } else if (action === "delete") {
      const { error } = await supabase.rpc("delete_chat_message", { target_message: message.id });
      if (error) showToast(`No se pudo borrar: ${error.message}`);
      else {
        if (message.attachment?.path) supabase.storage.from("chat").remove([message.attachment.path]).catch(() => {});
        setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, body: "", attachment: null, deletedAt: new Date().toISOString() } : m)));
      }
    }
    return undefined;
  }

  const visible = (messages ?? []).filter((m) => !hidden.has(m.id) && (!onlyStarred || stars.has(m.id)));
  lastIdRef.current = (messages ?? []).reduce((max, m) => (typeof m.id === "number" && m.id > max ? m.id : max), 0);
  const canPost = channel.canPost !== false;
  let lastDay = null;
  const menuMessage = menuFor;
  const menuMine = menuMessage?.senderId === user?.id;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-0.5 border-b border-slate-100 px-2 py-2 sm:gap-2 sm:px-3">
        {onBack && (
          <button type="button" onClick={onBack} aria-label="Volver a las conversaciones" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 lg:hidden">
            <ArrowLeft size={16} />
          </button>
        )}
        <div className="min-w-0 flex-1">{header}</div>
        <button
          type="button"
          onClick={() => {
            setSearchOpen((v) => !v);
            setSearchText("");
          }}
          aria-pressed={searchOpen}
          aria-label="Buscar en este chat"
          title="Buscar en este chat"
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${searchOpen ? "bg-blue-50 text-blue-600" : "text-slate-400 hover:bg-slate-100"}`}
        >
          <Search size={15} />
        </button>
        <button
          type="button"
          onClick={toggleTasks}
          aria-pressed={tasksOpen}
          aria-label="Tareas pendientes de este chat"
          title="Tareas pendientes de este chat"
          className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tasksOpen ? "bg-blue-50 text-blue-600" : "text-slate-400 hover:bg-slate-100"}`}
        >
          <ListTodo size={15} />
          {chatTasks.length > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-blue-600 px-1 text-[9px] font-bold text-white">{chatTasks.length}</span>
          )}
        </button>
        {advanced && (
          <button type="button" onClick={() => setOnlyStarred((v) => !v)} aria-pressed={onlyStarred} title="Ver solo destacados" className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${onlyStarred ? "bg-amber-50 text-amber-600" : "text-slate-400 hover:bg-slate-100"}`}>
            <Star size={15} className={onlyStarred ? "fill-current" : ""} />
          </button>
        )}
      </div>
      {searchOpen && (
        <div className="flex items-center gap-1.5 border-b border-slate-100 bg-white px-3 py-1.5">
          <div className="relative min-w-0 flex-1">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              autoFocus
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  moveSearch(e.shiftKey ? -1 : 1);
                } else if (e.key === "Escape") setSearchOpen(false);
              }}
              placeholder="Buscar en este chat"
              aria-label="Buscar en este chat"
              className="h-8 w-full rounded-lg border border-slate-200 pl-8 pr-2 text-xs focus:border-blue-400 focus:outline-none"
            />
          </div>
          <span className="shrink-0 text-[11px] text-slate-400">
            {searchHits === null ? "" : searchHits.length === 0 ? "Sin resultados" : `${searchIndex + 1} de ${searchHits.length}`}
          </span>
          <button type="button" onClick={() => moveSearch(1)} disabled={!searchHits?.length} aria-label="Resultado anterior" title="Más antiguo" className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-40">
            <ChevronUp size={15} />
          </button>
          <button type="button" onClick={() => moveSearch(-1)} disabled={!searchHits?.length} aria-label="Resultado siguiente" title="Más reciente" className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-40">
            <ChevronDown size={15} />
          </button>
          <button type="button" onClick={() => setSearchOpen(false)} aria-label="Cerrar búsqueda" className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
            <X size={14} />
          </button>
        </div>
      )}
      <div className="relative flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">

      {pinned.length > 0 && !onlyStarred && (
        <div className="space-y-0.5 border-b border-slate-100 bg-slate-50 px-3 py-1.5">
          {pinned.map((m) => (
            <button key={m.id} type="button" onClick={() => jumpTo(m.id)} className="flex w-full items-center gap-1.5 text-left text-[11px] text-slate-600">
              <Pin size={11} className="shrink-0 text-blue-600" />
              <span className="truncate">
                <b>{m.senderName}:</b> {previewText(m.kind, m.body) || "Mensaje"}
              </span>
            </button>
          ))}
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const box = e.currentTarget;
          stickRef.current = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
        }}
        className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overflow-x-hidden bg-slate-50/60 px-3 py-3"
      >
        {messages === null && <p className="py-8 text-center text-xs text-slate-400">Cargando mensajes…</p>}
        {hasMore && !onlyStarred && (
          <button
            type="button"
            onClick={() => {
              stickRef.current = false;
              loadMessages(messages[0].id);
            }}
            className="mx-auto block rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-blue-600 shadow-sm"
          >
            Cargar mensajes anteriores
          </button>
        )}
        {messages?.length === 0 && <p className="py-8 text-center text-xs text-slate-400">Todavía no hay mensajes. Escribe el primero.</p>}
        {onlyStarred && visible.length === 0 && <p className="py-8 text-center text-xs text-slate-400">No hay mensajes destacados en esta conversación.</p>}
        {visible.map((m) => {
          const mine = m.senderId === user?.id;
          const day = dayLabel(m.createdAt);
          const showDay = day !== lastDay;
          lastDay = day;
          return (
            <div key={m.id}>
              {showDay && <p className="py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-400">{day}</p>}
              {m.kind === "call" ? (
                <CallLogBubble message={m} mine={mine} onCallBack={calls.available && channel.kind !== "general" ? (kind) => calls.start(channel, kind) : null} />
              ) : (
              <Bubble
                message={m}
                mine={mine}
                showSender={channel.kind !== "direct"}
                reply={m.replyToId ? byId.get(m.replyToId) ?? { senderName: "Mensaje anterior", body: "", kind: "text" } : null}
                reactions={reactionsBy.get(m.id) ?? []}
                starred={stars.has(m.id)}
                receipts={receipts}
                translation={translations[m.id]}
                highlighted={highlight === m.id}
                onMenu={(msg) => !msg.pending && setMenuFor(msg)}
                onJump={jumpTo}
                onOpenImage={setViewer}
                onToggleReaction={toggleReaction}
                onSwipeReply={!mine && !m.pending && canPost ? () => startReply(m) : null}
                onReply={advanced && !m.pending && canPost ? startReply : null}
                onForward={advanced && !m.pending ? setForwardFor : null}
                onTask={advanced && !m.pending ? setTaskFrom : null}
                searchTerm={searchTerm.length >= 2 ? searchTerm : ""}
                userId={user?.id}
              />
              )}
            </div>
          );
        })}
      </div>

      {(replyTo || editing) && (
        <div className="flex items-center gap-2 border-t border-slate-100 bg-white px-3 py-2">
          <div className="min-w-0 flex-1 border-l-4 border-blue-500 pl-2">
            <p className="text-[10px] font-bold text-blue-600">{editing ? "Editando mensaje" : `Respondiendo a ${replyTo.senderName || "mensaje"}`}</p>
            <p className="truncate text-[11px] text-slate-500">{previewText((editing ?? replyTo).kind, (editing ?? replyTo).body)}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setReplyTo(null);
              if (editing) setDraft("");
              setEditing(null);
            }}
            aria-label="Cancelar"
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
          >
            <X size={15} />
          </button>
        </div>
      )}
      {uploading && <p className="border-t border-slate-100 bg-white px-3 py-1.5 text-[11px] text-slate-500">{uploading}</p>}
      {stickersOpen && <StickerPanel onSend={sendSticker} onClose={() => setStickersOpen(false)} />}
      {gifOpen && (
        <GifPanel
          onClose={() => setGifOpen(false)}
          onPick={async (file, dims) => {
            setGifOpen(false);
            await sendFile(file, "image", { ...dims, name: "GIF" }, "");
          }}
        />
      )}
      {attachOpen && (
        <div className="grid grid-cols-4 gap-2 border-t border-slate-100 bg-white p-3">
          {[
            { label: "Galería", icon: ImageIcon, tone: "bg-violet-50 text-violet-600", go: () => galleryRef.current?.click() },
            {
              label: "Cámara",
              icon: Camera,
              tone: "bg-rose-50 text-rose-600",
              go: () => {
                setAttachOpen(false);
                camera.run(() => setCameraOpen(true));
              },
            },
            { label: "Documento", icon: FileText, tone: "bg-blue-50 text-blue-600", go: () => docRef.current?.click() },
            {
              label: "Stickers",
              icon: Sticker,
              tone: "bg-amber-50 text-amber-600",
              go: () => {
                setAttachOpen(false);
                setStickersOpen(true);
              },
            },
          ].map((o) => {
            const Icon = o.icon;
            return (
              <button key={o.label} type="button" onClick={o.go} className="flex flex-col items-center gap-1 rounded-xl p-2 hover:bg-slate-50">
                <span className={`flex h-11 w-11 items-center justify-center rounded-2xl ${o.tone}`}>
                  <Icon size={19} />
                </span>
                <span className="text-[11px] font-medium text-slate-600">{o.label}</span>
              </button>
            );
          })}
        </div>
      )}
      <input ref={galleryRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={(e) => addPending(e.target.files, null, () => (e.target.value = ""))} />
      <input
        ref={docRef}
        type="file"
        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,application/pdf"
        multiple
        className="hidden"
        onChange={(e) => addPending(e.target.files, "file", () => (e.target.value = ""))}
      />

      {!canPost ? (
        <p className="flex items-center justify-center gap-1.5 border-t border-slate-100 bg-slate-50 px-3 py-3 text-center text-[11px] text-slate-500">
          <Lock size={12} className="shrink-0" />
          {channel.postingMode === "admins" ? "Solo los administradores pueden enviar mensajes en este chat." : "Solo algunas personas pueden enviar mensajes en este chat."}
        </p>
      ) : pending.length > 0 ? (
        <AttachmentPreview
          items={pending}
          onRemove={(index) =>
            setPending((prev) => {
              const next = [...prev];
              const [gone] = next.splice(index, 1);
              if (gone) URL.revokeObjectURL(gone.url);
              return next;
            })
          }
          onCancel={clearPending}
          onAddMore={pending.some((p) => p.kind === "file") ? () => docRef.current?.click() : () => galleryRef.current?.click()}
          onSend={async (items, caption) => {
            const list = [...items];
            clearPending(false);
            for (let i = 0; i < list.length; i += 1) await sendFile(list[i].file, list[i].kind, {}, i === 0 ? caption : "");
            list.forEach((item) => URL.revokeObjectURL(item.url));
          }}
        />
      ) : (
        <div className="flex items-end gap-2 border-t border-slate-100 bg-white p-2.5">
          {voice.mode ? (
            <RecordingBar voice={voice} />
          ) : (
            <>
              {advanced && !editing && (
                <button
                  type="button"
                  onClick={() => {
                    setStickersOpen(false);
                    setGifOpen(false);
                    setAttachOpen((v) => !v);
                  }}
                  aria-label="Adjuntar"
                  aria-expanded={attachOpen}
                  className={`flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl transition ${attachOpen ? "rotate-45 bg-slate-100 text-slate-700" : "text-slate-500 hover:bg-slate-100"}`}
                >
                  <Plus size={19} />
                </button>
              )}
              <textarea
                ref={composerRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={1}
                maxLength={4000}
                placeholder={editing ? "Edita tu mensaje…" : "Escribe un mensaje…"}
                aria-label="Mensaje"
                className="max-h-32 min-h-[38px] min-w-0 flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-blue-400 focus:outline-none"
              />
            </>
          )}
          {voice.mode === "locked" ? (
            <button type="button" onClick={() => voice.finish(true)} aria-label="Enviar nota de voz" className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white hover:bg-blue-700">
              <Send size={15} />
            </button>
          ) : draft.trim() || editing || !advanced ? (
            <button type="button" onClick={send} disabled={!draft.trim()} aria-label={editing ? "Guardar cambios" : "Enviar"} className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">
              {editing ? <Check size={16} /> : <Send size={15} />}
            </button>
          ) : (
            <>
              {!voice.mode && (
                <button
                  type="button"
                  onClick={() => {
                    setAttachOpen(false);
                    setStickersOpen(false);
                    setGifOpen((v) => !v);
                  }}
                  aria-label="GIFs"
                  aria-expanded={gifOpen}
                  className={`flex h-[38px] shrink-0 items-center justify-center rounded-xl border px-2 text-[11px] font-extrabold tracking-wide ${gifOpen ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}
                >
                  GIF
                </button>
              )}
              <MicButton voice={voice} />
            </>
          )}
        </div>
      )}
      {voice.sheet}
      {camera.sheet}
      {cameraOpen && (
        <CameraCapture
          onClose={() => setCameraOpen(false)}
          onCapture={(file) => {
            setCameraOpen(false);
            addPending([file], "image");
          }}
        />
      )}

      {menuMessage && (
        <ActionSheet
          message={menuMessage}
          mine={menuMine}
          advanced={advanced}
          starred={stars.has(menuMessage.id)}
          canEdit={menuMine && advanced && !["voice", "sticker"].includes(menuMessage.kind) && Date.now() - time(menuMessage.createdAt) < EDIT_WINDOW_MS}
          canDeleteAll={menuMine || isAdmin}
          onAction={onAction}
          onClose={() => setMenuFor(null)}
        />
      )}
      {infoFor && <InfoModal message={infoFor} onClose={() => setInfoFor(null)} />}
      {forwardFor && <ForwardModal message={forwardFor} currentChannelId={channelId} onClose={() => setForwardFor(null)} />}
      {viewer && <ImageViewer url={viewer} onClose={() => setViewer(null)} />}
      {taskFrom && <TaskFormModal isAdmin={isAdmin} channel={channel} message={taskFrom.id ? taskFrom : null} onClose={() => setTaskFrom(null)} />}
      </div>
      {tasksOpen && (
        <aside className="absolute inset-y-0 right-0 z-20 flex w-[85%] max-w-[300px] flex-col border-l border-slate-100 bg-white shadow-xl lg:static lg:z-auto lg:w-64 lg:shadow-none">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2.5">
            <p className="text-xs font-bold text-slate-700">Tareas pendientes</p>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setTaskFrom({})} title="Nueva tarea en este chat" className="flex items-center gap-1 rounded-lg bg-blue-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-blue-700">
                <Plus size={11} /> Nueva
              </button>
              <button type="button" onClick={toggleTasks} aria-label="Ocultar tareas" className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100">
                <X size={13} />
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
            {chatTasks.length === 0 && (
              <p className="px-2 py-6 text-center text-[11px] leading-relaxed text-slate-400">
                No hay tareas pendientes en este chat. Pasa el mouse junto a un mensaje (o mantenlo presionado) y elige "Asignar como tarea".
              </p>
            )}
            {chatTasks.map((t) => {
              const canFinish = isAdmin || t.assignedTo === user?.id || t.createdBy === user?.id;
              const late = t.dueDate && t.dueDate < new Date().toISOString().slice(0, 10);
              return (
                <div key={t.id} className="rounded-xl border border-slate-200 bg-white p-2.5">
                  <button
                    type="button"
                    onClick={() => t.messageId && jumpTo(t.messageId)}
                    className={`block w-full text-left text-xs font-semibold text-slate-700 ${t.messageId ? "hover:text-blue-600" : "cursor-default"}`}
                    title={t.messageId ? "Ir al mensaje" : undefined}
                  >
                    {t.title}
                  </button>
                  <p className="mt-0.5 text-[10px] text-slate-400">
                    {t.assignedToName || "Sin responsable"}
                    {t.dueDate ? <span className={late ? "font-semibold text-amber-600" : ""}> · {late ? "venció" : "para"} el {t.dueDate.split("-").reverse().join("/")}</span> : null}
                    {t.priority === "high" ? " · prioridad alta" : ""}
                  </p>
                  {canFinish && (
                    <button type="button" onClick={() => finishTask(t)} className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-50">
                      <CheckCircle2 size={11} /> Terminar
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </aside>
      )}
      </div>
    </div>
  );
}
