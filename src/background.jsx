import { useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import { CheckCircle2, Copy, Download, Smartphone } from "lucide-react";
import { supabase, useToast, ConfirmModal, timeAgoLabel } from "./NavioDashboard.jsx";
import { useTracking, ANDROID_APP_URL } from "./tracking.jsx";

/* ---------------------------------------------------------------------- */
/*  Rastreo en segundo plano: que el viaje siga con la pantalla apagada   */
/* ---------------------------------------------------------------------- */

const card = "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm";
const plainButton = "inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60";
const primaryButton = "inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60";

// Ajustes con los que queda la app de rastreo al vincularla: precisión alta y
// un punto cada 30 metros en movimiento.
const TRACKER_SETTINGS = "accuracy=high&distance=30&interval=30&buffer=true";
const ingestUrl = () => `${supabase.supabaseUrl}/functions/v1/gps-ingest`;

// El código QR se dibuja aquí mismo (sin pedirlo a ningún servicio externo:
// lleva la clave del teléfono).
function QrCode({ text, size = 200 }) {
  const cells = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    const dark = [];
    for (let row = 0; row < count; row += 1) for (let col = 0; col < count; col += 1) if (qr.isDark(row, col)) dark.push(`M${col} ${row}h1v1h-1z`);
    return { count, path: dark.join("") };
  }, [text]);
  const margin = 3;
  const total = cells.count + margin * 2;
  return (
    <svg viewBox={`${-margin} ${-margin} ${total} ${total}`} width={size} height={size} role="img" aria-label="Código QR para vincular la app de rastreo" shapeRendering="crispEdges" className="rounded-lg bg-white">
      <rect x={-margin} y={-margin} width={total} height={total} fill="#fff" />
      <path d={cells.path} fill="#0f172a" />
    </svg>
  );
}

function CopyField({ label, value }) {
  const { showToast } = useToast();
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold text-slate-500">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 select-all break-all rounded-lg bg-slate-100 px-2.5 py-2 text-[11px] font-semibold text-slate-700">{value}</code>
        <button
          onClick={() => {
            navigator.clipboard?.writeText(value);
            showToast("Copiado.");
          }}
          className={plainButton}
        >
          <Copy size={12} /> Copiar
        </button>
      </div>
    </div>
  );
}

function Step({ number, children }) {
  return (
    <li className="flex gap-2.5 text-xs text-slate-600">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[11px] font-bold text-blue-700">{number}</span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

function AndroidAppCard() {
  const { native } = useTracking();
  return (
    <div className={`${card} space-y-3`}>
      <div>
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
          <Smartphone size={16} className="text-blue-600" /> Android: app Navio
        </h2>
        <p className="mt-1 text-xs text-slate-500">Es Navio, instalado como app. Al iniciar un viaje sigue registrando el recorrido con la pantalla apagada o mientras usas otras apps.</p>
      </div>
      {native ? (
        <p className="flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-2.5 text-xs font-semibold text-emerald-700">
          <CheckCircle2 size={14} /> Ya estás usando la app Navio en este teléfono.
        </p>
      ) : (
        <>
          <a href={ANDROID_APP_URL} target="_blank" rel="noopener noreferrer" className={primaryButton}>
            <Download size={14} /> Descargar la app para Android
          </a>
          <ol className="space-y-2">
            <Step number={1}>Abre este enlace desde el teléfono Android y descarga el archivo.</Step>
            <Step number={2}>Al abrirlo, Android pedirá permiso para “instalar apps de esta fuente”: acéptalo solo para esta instalación.</Step>
            <Step number={3}>Entra con tu cuenta. La primera vez que inicies un viaje, permite la ubicación y las notificaciones.</Step>
            <Step number={4}>
              Si tu teléfono cierra apps para ahorrar batería (Xiaomi, Huawei, Samsung), en Ajustes → Apps → Navio → Batería elige <b>Sin restricciones</b>.
            </Step>
          </ol>
        </>
      )}
    </div>
  );
}

function TrackerCard() {
  const { showToast } = useToast();
  const { tracker, reloadTracker, active } = useTracking();
  const [token, setToken] = useState(null); // la clave solo existe aquí, recién creada
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null); // "pair" | "unpair"
  const onTrackerTrip = active?.source === "tracker";

  async function pair() {
    setConfirm(null);
    setBusy(true);
    const { data, error } = await supabase.rpc("pair_tracker_device");
    setBusy(false);
    if (error || !data) {
      showToast(/pair_tracker_device|schema cache/i.test(error?.message ?? "") ? "Esta opción se activa al aplicar la actualización pendiente de la base de datos." : `No se pudo vincular: ${error?.message ?? "sin respuesta"}`);
      return;
    }
    setToken(data);
    reloadTracker();
  }

  async function unpair() {
    setConfirm(null);
    setBusy(true);
    const { error } = await supabase.rpc("unpair_tracker_device");
    setBusy(false);
    if (error) showToast(`No se pudo desvincular: ${error.message}`);
    else {
      setToken(null);
      showToast("Teléfono desvinculado. La app de rastreo ya no puede enviar nada a Navio.");
      reloadTracker();
    }
  }

  return (
    <div className={`${card} space-y-3`}>
      <div>
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
          <Smartphone size={16} className="text-blue-600" /> iPhone (o Android): app de rastreo
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          En iPhone, Navio no puede leer el GPS con la pantalla apagada. La app gratuita <b>Traccar Client</b> sí puede: la vinculas una vez y manda tu ubicación a Navio en segundo plano.
        </p>
      </div>

      {tracker && !token && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
          <span className="text-xs font-semibold text-emerald-700">
            <CheckCircle2 size={14} className="mr-1 inline" />
            Teléfono vinculado · {tracker.lastSeenAt ? `última señal ${timeAgoLabel(tracker.lastSeenAt)}` : "todavía no ha enviado señal"}
          </span>
          <span className="flex gap-1.5">
            <button onClick={() => setConfirm("pair")} disabled={busy || onTrackerTrip} className={plainButton}>
              Volver a vincular
            </button>
            <button onClick={() => setConfirm("unpair")} disabled={busy || onTrackerTrip} className="rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-60">
              Desvincular
            </button>
          </span>
        </div>
      )}
      {onTrackerTrip && <p className="text-[11px] text-slate-400">Tienes un viaje en curso con la app de rastreo: termina el viaje antes de cambiar el vínculo.</p>}

      {!tracker && !token && (
        <button onClick={pair} disabled={busy} className={primaryButton}>
          {busy ? "Vinculando…" : "Vincular mi teléfono"}
        </button>
      )}

      {token && (
        <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/50 p-3">
          <p className="text-xs font-semibold text-slate-700">Sigue estos pasos ahora: la clave solo se muestra esta vez.</p>
          <ol className="space-y-2">
            <Step number={1}>
              Instala <b>Traccar Client</b> desde App Store o Google Play y ábrela.
            </Step>
            <Step number={2}>
              <b>Si ves esta pantalla en otro equipo:</b> en Traccar Client toca el ícono de código QR y escanea este código.
              <span className="mt-2 block">
                <QrCode text={`${ingestUrl()}?id=${token}&${TRACKER_SETTINGS}`} />
              </span>
            </Step>
            <Step number={3}>
              <b>Si estás en el mismo teléfono:</b> en los ajustes de Traccar Client copia y pega estos dos datos.
              <span className="mt-2 block space-y-2">
                <CopyField label="Identificador del dispositivo" value={token} />
                <CopyField label="URL del servidor" value={ingestUrl()} />
              </span>
            </Step>
            <Step number={4}>
              Enciende el servicio en Traccar Client y, cuando pida permiso de ubicación, elige <b>Permitir siempre</b>.
            </Step>
            <Step number={5}>En Navio, al iniciar un viaje elige “Con mi app de rastreo”. Solo se guarda tu ubicación mientras el viaje está en curso.</Step>
          </ol>
          <button onClick={() => setToken(null)} className={plainButton}>
            Ya terminé
          </button>
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-slate-400">
        Privacidad: aunque la app de rastreo quede encendida todo el día, Navio descarta lo que reciba fuera de un viaje iniciado por ti. Puedes apagarla o desvincularla cuando quieras.
      </p>

      {confirm && (
        <ConfirmModal
          title={confirm === "pair" ? "Volver a vincular" : "Desvincular teléfono"}
          message={
            confirm === "pair"
              ? "Se crea una clave nueva y la anterior deja de funcionar: tendrás que configurar otra vez la app de rastreo."
              : "La app de rastreo dejará de poder enviar tu ubicación a Navio. Para volver a usarla tendrás que vincularla de nuevo."
          }
          confirmLabel={confirm === "pair" ? "Crear clave nueva" : "Desvincular"}
          danger={confirm === "unpair"}
          onConfirm={confirm === "pair" ? pair : unpair}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

export function BackgroundTrackingPanel() {
  const { native } = useTracking();
  return (
    <div className="space-y-4">
      <div className={card}>
        <h2 className="text-sm font-bold text-slate-800">Que el viaje siga con la pantalla apagada</h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          Desde el navegador, el teléfono deja de dar la ubicación en cuanto se apaga la pantalla o se abre otra app. Para que el recorrido se siga registrando mientras manejas, usa una de estas dos opciones según tu teléfono.
        </p>
      </div>
      <AndroidAppCard />
      {!native && <TrackerCard />}
    </div>
  );
}
