import { useEffect } from "react";
import { ArrowLeft, Bell, ChevronRight, ClipboardList, Fuel, Home, MapPin, Menu, MessageSquare, Navigation, Plus, Receipt, ShieldCheck, User, Wrench } from "lucide-react";
import { useAuth, useDateFormat, useSessionState, formatDate, vehicleDriverLabel } from "./NavioDashboard.jsx";
import { useInbox, MessagesPage, TasksPage, NotificationsPanel } from "./inbox.jsx";
import { useTracking, TrackingLiveCard, LiveMapPage } from "./tracking.jsx";
import { MobileTripTab } from "./trips.jsx";
import { AccountPage } from "./settings.jsx";
import { LegalLinks } from "./legal.jsx";

/* ---------------------------------------------------------------------- */
/*  Navio en el celular: lo que se usa en campo, a un toque               */
/* ---------------------------------------------------------------------- */

const TABS = [
  { id: "home", label: "Inicio", icon: Home },
  { id: "trip", label: "Viaje", icon: Navigation },
  { id: "register", label: "Registrar", icon: Plus },
  { id: "messages", label: "Mensajes", icon: MessageSquare },
  { id: "more", label: "Más", icon: Menu },
];

function Badge({ count }) {
  if (!count) return null;
  return <span className="absolute -right-2 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">{count > 9 ? "9+" : count}</span>;
}

function BottomNav({ tab, onChange, badges }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-slate-200 bg-white shadow-[0_-2px_10px_rgba(0,0,0,0.05)] print:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      {TABS.map((t) => {
        const Icon = t.icon;
        const active = tab === t.id;
        return (
          <button key={t.id} onClick={() => onChange(t.id)} aria-current={active ? "page" : undefined} className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 text-[11px] font-semibold ${active ? "text-blue-600" : "text-slate-400"}`}>
            <span className="relative">
              <Icon size={20} />
              <Badge count={badges[t.id]} />
            </span>
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}

function StatButton({ icon: Icon, label, value, tone, onClick }) {
  return (
    <button onClick={onClick} className="flex flex-col items-start rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-sm">
      <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${tone}`}>
        <Icon size={16} />
      </span>
      <span className="mt-2 text-xl font-extrabold leading-none text-slate-900">{value}</span>
      <span className="mt-1 text-[11px] font-medium text-slate-500">{label}</span>
    </button>
  );
}

function HomeTab({ vehicles, trips, userName, companyName, pendingCount, isAdmin, go }) {
  const { user } = useAuth();
  const { format } = useDateFormat();
  const tracking = useTracking();
  const inbox = useInbox();
  const nextTrip = trips
    .filter((t) => t.assignedTo === user?.id && (t.status === "scheduled" || t.status === "ongoing"))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];

  return (
    <div className="space-y-4 p-4 pb-24">
      <div>
        <p className="text-sm text-slate-500">Hola,</p>
        <h1 className="text-xl font-bold text-slate-900">{userName}</h1>
        {companyName && <p className="text-xs text-slate-400">{companyName}</p>}
      </div>

      {tracking?.active ? (
        <button onClick={() => go("trip")} className="block w-full text-left">
          <TrackingLiveCard />
        </button>
      ) : (
        <button onClick={() => go("trip")} className="flex w-full items-center justify-between rounded-2xl bg-blue-600 p-4 text-white shadow-sm">
          <span className="min-w-0 text-left">
            <span className="block text-xs font-medium text-blue-100">{nextTrip ? `Tu próximo traslado · ${formatDate(nextTrip.date, format)}` : "¿Vas a manejar?"}</span>
            <span className="block truncate text-sm font-bold">{nextTrip ? `${nextTrip.origin} → ${nextTrip.destination}` : "Iniciar un viaje"}</span>
          </span>
          <Navigation size={22} className="shrink-0" />
        </button>
      )}

      <div className="grid grid-cols-3 gap-2">
        <StatButton icon={ClipboardList} label="Mis tareas" value={inbox.myOpenTasks ?? 0} tone="bg-amber-50 text-amber-600" onClick={() => go("more", "tasks")} />
        <StatButton icon={Bell} label="Alertas nuevas" value={inbox.unreadNotifications ?? 0} tone="bg-rose-50 text-rose-600" onClick={() => go("more", "alerts")} />
        <StatButton icon={MessageSquare} label="Mensajes" value={inbox.unreadMessages ?? 0} tone="bg-blue-50 text-blue-600" onClick={() => go("messages")} />
      </div>

      {pendingCount > 0 && (
        <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">
          {pendingCount} registro{pendingCount === 1 ? "" : "s"} por revisar{isAdmin ? "" : " por tu equipo"}. La revisión completa se hace desde una computadora.
        </p>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-400">Unidades ({vehicles.length})</h2>
          <button onClick={() => go("more", "map")} className="flex items-center gap-1 text-[11px] font-semibold text-blue-600">
            <MapPin size={12} /> Ver mapa
          </button>
        </div>
        <div className="space-y-2">
          {vehicles.map((v) => (
            <div key={v.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
              <div className="min-w-0">
                <p className="truncate text-xs font-bold text-slate-800">
                  {v.unit} <span className="font-medium text-slate-400">· {v.plate}</span>
                </p>
                <p className="truncate text-[11px] text-slate-500">{vehicleDriverLabel(v)}</p>
              </div>
              <span className="shrink-0 text-[11px] font-semibold text-slate-500">{(Number(v.kmActual) || 0).toLocaleString("es-MX")} km</span>
            </div>
          ))}
          {vehicles.length === 0 && <p className="py-6 text-center text-xs text-slate-400">Todavía no hay unidades registradas.</p>}
        </div>
      </div>
    </div>
  );
}

const REGISTER_OPTIONS = [
  { module: "fuel", label: "Combustible", hint: "Ticket o factura de una carga", icon: Fuel, tone: "bg-sky-50 text-sky-600" },
  { module: "travel", label: "Viáticos", hint: "Comidas, hospedaje, casetas", icon: Receipt, tone: "bg-violet-50 text-violet-600" },
  { module: "maintenance", label: "Mantenimiento", hint: "Servicio o reparación de una unidad", icon: Wrench, tone: "bg-amber-50 text-amber-600" },
  { module: "compliance", label: "Trámites", hint: "Seguro, tenencia, verificación", icon: ShieldCheck, tone: "bg-emerald-50 text-emerald-600" },
];

function RegisterTab({ onOpenForm }) {
  return (
    <div className="space-y-4 p-4 pb-24">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Registrar</h1>
        <p className="mt-1 text-sm text-slate-500">Toma la foto del comprobante y llena lo básico. Tu equipo lo revisa después.</p>
      </div>
      <div className="space-y-2">
        {REGISTER_OPTIONS.map((o) => {
          const Icon = o.icon;
          return (
            <button key={o.module} onClick={() => onOpenForm(o.module)} className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm">
              <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${o.tone}`}>
                <Icon size={19} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold text-slate-800">{o.label}</span>
                <span className="block truncate text-[11px] text-slate-500">{o.hint}</span>
              </span>
              <ChevronRight size={16} className="ml-auto shrink-0 text-slate-300" />
            </button>
          );
        })}
      </div>
      <p className="text-[11px] leading-relaxed text-slate-400">¿Tienes Telegram? También puedes mandar la foto o el PDF al bot de tu empresa y Navio la registra sola.</p>
    </div>
  );
}

const MORE_ITEMS = [
  { id: "tasks", label: "Tareas", hint: "Lo que tienes pendiente", icon: ClipboardList, badge: "myOpenTasks" },
  { id: "alerts", label: "Alertas", hint: "Avisos para ti", icon: Bell, badge: "unreadNotifications" },
  { id: "map", label: "Mapa de unidades", hint: "Dónde está cada una", icon: MapPin },
  { id: "account", label: "Mi cuenta", hint: "Perfil, seguridad y privacidad", icon: User },
];

function MoreMenu({ onOpen }) {
  const inbox = useInbox();
  return (
    <div className="space-y-4 p-4 pb-24">
      <h1 className="text-xl font-bold text-slate-900">Más</h1>
      <div className="space-y-2">
        {MORE_ITEMS.map((item) => {
          const Icon = item.icon;
          const count = item.badge ? inbox[item.badge] : 0;
          return (
            <button key={item.id} onClick={() => onOpen(item.id)} className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <Icon size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-slate-800">{item.label}</span>
                <span className="block truncate text-[11px] text-slate-500">{item.hint}</span>
              </span>
              {count > 0 && <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-500 px-1.5 text-[11px] font-bold text-white">{count}</span>}
              <ChevronRight size={16} className="shrink-0 text-slate-300" />
            </button>
          );
        })}
      </div>
      <p className="text-[11px] leading-relaxed text-slate-400">Facturas, reportes, expedientes y configuración de la empresa se manejan desde una computadora.</p>
      <LegalLinks />
    </div>
  );
}

export function MobileAppShell({ vehicles, trips, pendingCount, userName, userEmail, userAvatar, companyName, isSuperAdmin, isCompanyAdmin, onSignOut, onOpenRecordForm }) {
  const [tab, setTab] = useSessionState("navio.nav.mobileTab", "home");
  const [screen, setScreen] = useSessionState("navio.nav.mobileScreen", null);
  const inbox = useInbox();
  const current = TABS.some((t) => t.id === tab) ? tab : "home";

  function go(nextTab, nextScreen = null) {
    setTab(nextTab);
    setScreen(nextTab === "more" ? nextScreen : null);
  }
  // Desde una alerta: a dónde lleva en el celular.
  function fromAlert(target) {
    if (target === "messages") go("messages");
    else if (target === "tasks") go("more", "tasks");
    else if (target === "transfers" || target === "map") go("trip");
    else go("home");
  }
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [current, screen]);

  const sub = current === "more" ? MORE_ITEMS.find((item) => item.id === screen) : null;

  return (
    <div className="min-h-screen bg-[#f8fafc]">
      <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2.5" style={{ paddingTop: "max(0.625rem, env(safe-area-inset-top))" }}>
        {sub ? (
          <button onClick={() => setScreen(null)} className="flex min-h-[40px] items-center gap-1.5 text-sm font-bold text-slate-800">
            <ArrowLeft size={18} className="text-blue-600" /> {sub.label}
          </button>
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-xs font-extrabold text-white">N</div>
            <span className="truncate text-sm font-extrabold tracking-tight text-blue-700">{companyName || "NAVIO"}</span>
          </div>
        )}
        <div className="flex shrink-0 items-center gap-1">
          <button onClick={() => go("more", "alerts")} aria-label="Alertas" className="relative flex h-10 w-10 items-center justify-center rounded-full text-slate-500">
            <Bell size={19} />
            {inbox.unreadNotifications > 0 && <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-white" />}
          </button>
          <button onClick={() => go("more", "account")} aria-label="Mi cuenta">
            <img src={userAvatar} alt="" className="h-8 w-8 rounded-full bg-blue-50 ring-2 ring-blue-100" />
          </button>
        </div>
      </header>

      <main>
        {current === "home" && <HomeTab vehicles={vehicles} trips={trips} userName={userName} companyName={companyName} pendingCount={pendingCount} isAdmin={isCompanyAdmin} go={go} />}
        {current === "trip" && <MobileTripTab vehicles={vehicles} trips={trips} />}
        {current === "register" && <RegisterTab onOpenForm={onOpenRecordForm} />}
        {current === "messages" && <MessagesPage isAdmin={isCompanyAdmin} compact />}
        {current === "more" && !sub && <MoreMenu onOpen={setScreen} />}
        {sub?.id === "tasks" && <TasksPage isAdmin={isCompanyAdmin} compact />}
        {sub?.id === "alerts" && (
          <div className="p-4 pb-24">
            <NotificationsPanel isAdmin={isCompanyAdmin} onNavigate={fromAlert} onClose={() => {}} />
          </div>
        )}
        {sub?.id === "map" && (
          <div className="p-3 pb-24">
            <LiveMapPage vehicles={vehicles} trips={trips} isAdmin={isCompanyAdmin} onSelectVehicle={() => {}} />
          </div>
        )}
        {sub?.id === "account" && (
          <div className="p-4 pb-24">
            <AccountPage userName={userName} userEmail={userEmail} userAvatar={userAvatar} onSignOut={onSignOut} companyName={companyName} isSuperAdmin={isSuperAdmin} isCompanyAdmin={isCompanyAdmin} compact />
          </div>
        )}
      </main>

      <BottomNav tab={current} onChange={(id) => go(id)} badges={{ messages: inbox.unreadMessages, more: (inbox.myOpenTasks ?? 0) + (inbox.unreadNotifications ?? 0) }} />
    </div>
  );
}
