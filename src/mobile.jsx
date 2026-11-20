import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Bell,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Fuel,
  HelpCircle,
  Home,
  LayoutGrid,
  MapPin,
  MessageSquare,
  Navigation,
  Plus,
  Receipt,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Truck,
  Wrench,
} from "lucide-react";
import { useAuth, useDateFormat, formatDate, vehicleDriverLabel } from "./NavioDashboard.jsx";
import { goBack } from "./history.js";
import { useInbox, MessagesPage, NotificationsPanel } from "./inbox.jsx";
import { useTracking, TrackingLiveCard } from "./tracking.jsx";
import { MobileTripTab } from "./trips.jsx";
import { LegalLinks } from "./legal.jsx";
import { AndroidAppDownload, isAndroidDevice } from "./background.jsx";
import { ThemeSwitch } from "./navigation.jsx";
import { useHomeLayout, HomeWidgetGrid, HomeShortcuts, CustomizeHomeModal } from "./homewidgets.jsx";

/* ---------------------------------------------------------------------- */
/*  Navio en el teléfono: la misma estructura que en la computadora,      */
/*  con lo de campo (viaje, registrar, mensajes) a un toque.              */
/* ---------------------------------------------------------------------- */

const TABS = [
  { id: "home", label: "Inicio", icon: Home },
  { id: "trip", label: "Viaje", icon: Navigation },
  { id: "register", label: "Registrar", icon: Plus, primary: true },
  { id: "messages", label: "Mensajes", icon: MessageSquare },
  { id: "menu", label: "Menú", icon: LayoutGrid },
];

function Badge({ count }) {
  if (!count) return null;
  return <span className="absolute -right-2 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">{count > 9 ? "9+" : count}</span>;
}

// Barra inferior flotante: una cápsula de vidrio con la sección activa en un
// círculo de color con brillo. "Registrar" (+) va en medio, elevado.
function BottomNav({ tab, onChange, badges }) {
  return (
    // Abajo: casi pegada al borde, justo sobre la rayita de gestos del teléfono.
    <nav className="fixed inset-x-2 z-40 mx-auto max-w-md print:hidden" style={{ bottom: "max(6px, calc(var(--safe-bottom) - 6px))" }} aria-label="Secciones principales">
      <div className="bottom-nav-bar flex h-[68px] items-center rounded-[34px] px-1.5 backdrop-blur-xl">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          if (t.primary) {
            return (
              <div key={t.id} className="flex flex-1 justify-center">
                <button
                  onClick={() => onChange(t.id)}
                  aria-current={active ? "page" : undefined}
                  aria-label={t.label}
                  className={`-mt-5 flex h-[58px] w-[58px] flex-col items-center justify-center gap-0.5 rounded-full bg-[radial-gradient(circle_at_32%_28%,rgb(var(--bg-blue-500)),rgb(var(--bg-blue-700)))] text-white ring-4 ring-[rgb(var(--bg-page))] transition duration-200 active:scale-95 ${
                    active ? "scale-105 shadow-[0_0_26px_rgb(var(--bg-blue-600)/0.8)]" : "shadow-[0_8px_22px_rgb(var(--bg-blue-600)/0.55)]"
                  }`}
                >
                  <Icon size={24} strokeWidth={2.4} />
                  <span className="text-[9px] font-semibold leading-none">{t.label}</span>
                </button>
              </div>
            );
          }
          return (
            <div key={t.id} className="flex flex-1 justify-center">
              <button
                onClick={() => onChange(t.id)}
                aria-current={active ? "page" : undefined}
                className={`relative flex h-[56px] w-[56px] flex-col items-center justify-center gap-1 rounded-full transition-all duration-300 ${
                  active
                    ? "scale-105 bg-[radial-gradient(circle_at_32%_28%,rgb(var(--bg-blue-500)),rgb(var(--bg-blue-700)))] text-white shadow-[0_0_24px_rgb(var(--bg-blue-600)/0.7),0_6px_14px_rgb(0_0_0/0.25)]"
                    : "text-slate-400 hover:text-slate-600"
                }`}
              >
                <span className="relative">
                  <Icon size={20} strokeWidth={active ? 2.4 : 2} />
                  <Badge count={badges[t.id]} />
                </span>
                <span className={`text-[10px] leading-none ${active ? "font-bold" : "font-semibold"}`}>{t.label}</span>
              </button>
            </div>
          );
        })}
      </div>
    </nav>
  );
}

function QuickTile({ icon: Icon, label, hint, tone, count, onClick }) {
  return (
    <button onClick={onClick} className="relative flex flex-col items-start rounded-2xl border border-slate-200 bg-white p-3.5 text-left shadow-sm active:scale-[0.98]">
      <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${tone}`}>
        <Icon size={18} />
      </span>
      <span className="mt-2.5 text-sm font-bold text-slate-800">{label}</span>
      <span className="text-[11px] text-slate-500">{hint}</span>
      {count > 0 && <span className="absolute right-3 top-3 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-500 px-1.5 text-[11px] font-bold text-white">{count > 9 ? "9+" : count}</span>}
    </button>
  );
}

function HomeTab({ vehicles, trips, userName, companyName, homeData, go, openPage, onAddInvoice }) {
  const { user } = useAuth();
  const { format } = useDateFormat();
  const tracking = useTracking();
  const { layout, save } = useHomeLayout({ trips, orders: homeData?.orders ?? [] });
  const [customizing, setCustomizing] = useState(false);
  const nextTrip = trips
    .filter((t) => t.assignedTo === user?.id && (t.status === "scheduled" || t.status === "ongoing"))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Buenos días" : hour < 19 ? "Buenas tardes" : "Buenas noches";

  return (
    <div className="space-y-4 p-4 pb-28">
      {/* Bienvenida: en modo oscuro, carbón con un toque lavanda. */}
      <div className="welcome-card overflow-hidden rounded-3xl p-4 text-white shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs opacity-80">{greeting},</p>
            <h1 className="truncate text-xl font-bold">{userName}</h1>
            {companyName && <p className="truncate text-xs opacity-80">{companyName}</p>}
          </div>
          <button onClick={() => setCustomizing(true)} aria-label="Personalizar inicio" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[rgb(255_255_255/0.14)]">
            <SlidersHorizontal size={16} />
          </button>
        </div>
        {layout.drive && !tracking?.active && (
          <button onClick={() => go("trip")} className="mt-3 flex w-full items-center justify-between gap-2 rounded-2xl bg-[rgb(255_255_255/0.14)] p-3 text-left">
            <span className="min-w-0">
              <span className="block text-[11px] font-medium opacity-80">{nextTrip ? `Tu próximo traslado · ${formatDate(nextTrip.date, format)}` : "¿Vas a manejar?"}</span>
              <span className="block truncate text-sm font-bold">{nextTrip ? `${nextTrip.origin} → ${nextTrip.destination}` : "Iniciar un viaje"}</span>
            </span>
            <Navigation size={20} className="shrink-0" />
          </button>
        )}
      </div>

      {tracking?.active && (
        <button onClick={() => go("trip")} className="block w-full text-left">
          <TrackingLiveCard />
        </button>
      )}

      {layout.drive && isAndroidDevice() && !tracking?.native && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
          <p className="text-sm font-bold text-slate-800">Instala la app Navio</p>
          <p className="mt-1 text-xs text-slate-600">Con la app, el viaje se sigue registrando aunque apagues la pantalla o uses otras apps.</p>
          <AndroidAppDownload className="mt-3 w-full py-2.5" />
        </div>
      )}

      <HomeWidgetGrid
        compact
        ids={layout.widgets}
        data={{ vehicles, trips, invoices: [], maintenanceRecords: [], complianceRecords: [], orders: [], currency: "MXN", ...homeData, userId: user?.id }}
        onNavigate={openPage}
      />

      {layout.shortcuts.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <HomeShortcuts compact ids={layout.shortcuts} onNavigate={openPage} onAddInvoice={onAddInvoice} />
        </div>
      )}

      {layout.fleet && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wide text-slate-400">Unidades ({vehicles.length})</h2>
            <button onClick={() => openPage("map")} className="flex items-center gap-1 text-[11px] font-semibold text-blue-600">
              <MapPin size={12} /> Ver mapa
            </button>
          </div>
          <div className="space-y-2">
            {vehicles.map((v) => (
              <button key={v.id} onClick={() => openPage("fleet", undefined, v.id)} className="flex w-full items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-3 text-left">
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                    <Truck size={16} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-bold text-slate-800">
                      {v.unit} <span className="font-medium text-slate-400">· {v.plate}</span>
                    </span>
                    <span className="block truncate text-[11px] text-slate-500">{vehicleDriverLabel(v)}</span>
                  </span>
                </span>
                <span className="shrink-0 text-[11px] font-semibold text-slate-500">{(Number(v.kmActual) || 0).toLocaleString("es-MX")} km</span>
              </button>
            ))}
            {vehicles.length === 0 && <p className="py-6 text-center text-xs text-slate-400">Todavía no hay unidades registradas.</p>}
          </div>
        </div>
      )}

      {customizing && <CustomizeHomeModal phone layout={layout} onSave={save} onClose={() => setCustomizing(false)} />}
    </div>
  );
}

const REGISTER_OPTIONS = [
  { module: "fuel", label: "Combustible", hint: "Ticket o factura de una carga", icon: Fuel, tone: "bg-sky-50 text-sky-600" },
  { module: "travel", label: "Viáticos", hint: "Comidas, hospedaje, casetas", icon: Receipt, tone: "bg-violet-50 text-violet-600" },
  { module: "maintenance", label: "Servicio de mantenimiento", hint: "Servicio, reparación, garantía o campaña", icon: Wrench, tone: "bg-amber-50 text-amber-600" },
  { module: "compliance", label: "Trámites", hint: "Seguro, tenencia, licencia, multa", icon: ShieldCheck, tone: "bg-emerald-50 text-emerald-600" },
];

function RegisterTab({ onOpenForm, openPage }) {
  return (
    <div className="space-y-4 p-4 pb-28">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Registrar</h1>
        <p className="mt-1 text-sm text-slate-500">Toma la foto del comprobante y llena lo básico. Tu equipo lo revisa después.</p>
      </div>
      <div className="space-y-2">
        {REGISTER_OPTIONS.map((o) => {
          const Icon = o.icon;
          return (
            <button key={o.module} onClick={() => onOpenForm(o.module)} className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm active:scale-[0.99]">
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
        <button onClick={() => openPage("incidents", "all")} className="flex w-full items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-left">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-rose-600">
            <Wrench size={19} />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-bold text-rose-700">Reportar un accidente o una falla</span>
            <span className="block truncate text-[11px] text-rose-600">Avisa a tu equipo al momento</span>
          </span>
          <ChevronRight size={16} className="ml-auto shrink-0 text-rose-300" />
        </button>
      </div>
      <p className="text-[11px] leading-relaxed text-slate-400">¿Tienes Telegram? También puedes mandar la foto o el PDF al bot de tu empresa y Navio la registra sola.</p>
    </div>
  );
}

// El menú: las mismas secciones que la barra lateral de la computadora.
const MENU = [
  {
    title: "Gestión de flotas",
    icon: Truck,
    tone: "bg-blue-50 text-blue-600",
    route: ["fleet"],
    items: [
      { label: "Mapa en vivo", route: ["map"] },
      { label: "Unidades", route: ["fleet"] },
      { label: "Traslados", route: ["transfers", "open"], children: [["Programar", "scheduled"], ["En curso", "ongoing"], ["Completados", "completed"], ["Cancelados", "cancelled"]].map(([l, s]) => ({ label: l, route: ["transfers", s] })) },
      {
        label: "Trámites",
        route: ["compliance", "all"],
        children: [["Tenencias", "Tenencia"], ["Licencias", "Licencia de Conducir"], ["Tarjetas de circulación", "Tarjeta de Circulación"], ["Multas", "Multa"], ["Seguros", "Póliza de Seguro"]].map(([l, s]) => ({ label: l, route: ["compliance", s] })),
      },
    ],
  },
  { title: "Facturas y gastos", icon: Receipt, tone: "bg-emerald-50 text-emerald-600", route: ["fuel"] },
  {
    title: "Mantenimiento",
    icon: Wrench,
    tone: "bg-amber-50 text-amber-600",
    route: ["maintenance"],
    items: [
      { label: "Buscar servicios", route: ["maintenance"] },
      { label: "Servicios", route: ["services"] },
      { label: "Incidencias", route: ["incidents", "all"], children: [{ label: "Accidentes", route: ["incidents", "accident"] }, { label: "Fallas", route: ["incidents", "failure"] }] },
      { label: "Garantías", route: ["warranties", "warranties"], children: [{ label: "Campañas", route: ["warranties", "campaigns"] }, { label: "Garantías", route: ["warranties", "warranties"] }, { label: "Órdenes de trabajo", route: ["warranties", "orders"] }] },
      { label: "Programación de mantenimiento", route: ["schedule"] },
    ],
  },
  {
    title: "Mensajes",
    icon: MessageSquare,
    tone: "bg-sky-50 text-sky-600",
    badge: "unreadMessages",
    route: ["messages", "all"],
  },
  {
    title: "Tareas",
    icon: ClipboardList,
    tone: "bg-violet-50 text-violet-600",
    badge: "myOpenTasks",
    route: ["tasks", "open"],
  },
];

const MENU_BOTTOM = [
  { title: "Configuración", icon: Settings, route: ["settings", "profile"] },
  { title: "Comunidad", icon: HelpCircle, route: ["support"] },
  { title: "App para Android y iOS", icon: Smartphone, route: ["apps"] },
];

function MenuSection({ section, openPage, count }) {
  const [open, setOpen] = useState(false);
  const Icon = section.icon;
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center">
        <button onClick={() => openPage(...section.route)} className="flex min-w-0 flex-1 items-center gap-3 p-3.5 text-left">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${section.tone}`}>
            <Icon size={18} />
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-800">{section.title}</span>
          {count > 0 && <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-500 px-1.5 text-[11px] font-bold text-white">{count > 9 ? "9+" : count}</span>}
        </button>
        {section.items ? (
          <button onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={`${open ? "Ocultar" : "Mostrar"} ${section.title}`} className="flex h-14 w-12 shrink-0 items-center justify-center text-slate-400">
            <ChevronDown size={18} className={`transition ${open ? "rotate-180" : ""}`} />
          </button>
        ) : (
          <ChevronRight size={16} className="mr-4 shrink-0 text-slate-300" />
        )}
      </div>
      {open && section.items && (
        <div className="border-t border-slate-100 px-2 py-1.5">
          {section.items.map((item) => (
            <div key={item.label}>
              <button onClick={() => openPage(...item.route)} className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-[13px] font-semibold text-slate-700 active:bg-slate-50">
                {item.label}
                <ChevronRight size={14} className="text-slate-300" />
              </button>
              {item.children && (
                <div className="mb-1 ml-3 flex flex-wrap gap-1.5 border-l border-slate-100 py-1 pl-3">
                  {item.children.map((child) => (
                    <button key={child.label} onClick={() => openPage(...child.route)} className="rounded-full border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-600 active:bg-slate-50">
                      {child.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MenuTab({ openPage }) {
  const inbox = useInbox();
  return (
    <div className="space-y-3 p-4 pb-28">
      <h1 className="text-xl font-bold text-slate-900">Menú</h1>
      {MENU.map((section) => (
        <MenuSection key={section.title} section={section} openPage={openPage} count={section.badge ? inbox[section.badge] : 0} />
      ))}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {MENU_BOTTOM.map((item, index) => {
          const Icon = item.icon;
          return (
            <button key={item.title} onClick={() => openPage(...item.route)} className={`flex w-full items-center gap-3 px-3.5 py-3 text-left ${index > 0 ? "border-t border-slate-100" : ""}`}>
              <Icon size={17} className="shrink-0 text-slate-400" />
              <span className="flex-1 text-sm font-semibold text-slate-700">{item.title}</span>
              <ChevronRight size={15} className="text-slate-300" />
            </button>
          );
        })}
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Tema</p>
        <ThemeSwitch />
      </div>
      <LegalLinks />
    </div>
  );
}

// page: la misma pantalla que se ve en la computadora para la ruta actual.
// tab / screen viven en NavioApp para que el botón de regreso del teléfono
// vuelva a la pantalla anterior. screen: null | "page" | "alerts".
export function MobileAppShell({ vehicles, trips, userName, userAvatar, companyName, isCompanyAdmin, onOpenRecordForm, page, pageTitle, onGo, tab, setTab, screen, setScreen, homeData, onAddInvoice }) {
  const inbox = useInbox();
  const current = TABS.some((t) => t.id === tab) ? tab : "home";

  function go(nextTab) {
    setTab(nextTab);
    setScreen(null);
  }
  // Abre una sección (la misma de la computadora) dentro del teléfono.
  function openPage(routeTab, routeSub, vehicleId) {
    if (routeTab === "messages" && (routeSub === undefined || routeSub === "all")) {
      go("messages");
      return;
    }
    onGo(routeTab, routeSub, vehicleId);
    setTab("menu");
    setScreen("page");
  }
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [current, screen, pageTitle]);
  // Los avisos flotantes (cookies) se acomodan arriba de la barra inferior.
  useEffect(() => {
    document.body.classList.add("has-bottom-nav");
    return () => document.body.classList.remove("has-bottom-nav");
  }, []);

  const title = screen === "page" ? pageTitle : screen === "alerts" ? "Alertas" : null;

  return (
    <div className="min-h-screen bg-page">
      <header
        className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-slate-200 bg-white/95 px-3 py-2 backdrop-blur"
        style={{ paddingTop: "max(0.5rem, var(--safe-top))" }}
      >
        {title ? (
          <button onClick={() => goBack(() => setScreen(null))} className="flex min-h-[40px] min-w-0 items-center gap-1.5 text-sm font-bold text-slate-800">
            <ArrowLeft size={18} className="shrink-0 text-blue-600" /> <span className="truncate">{title}</span>
          </button>
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-xs font-extrabold text-white">N</div>
            <span className="truncate text-sm font-extrabold tracking-tight text-blue-700">{companyName || "NAVIO"}</span>
          </div>
        )}
        <div className="flex shrink-0 items-center gap-1">
          <button onClick={() => setScreen("alerts")} aria-label="Alertas" className="relative flex h-10 w-10 items-center justify-center rounded-full text-slate-500">
            <Bell size={19} />
            {inbox.unreadNotifications > 0 && <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-white" />}
          </button>
          <button onClick={() => openPage("settings", "profile")} aria-label="Mi cuenta y configuración" className="rounded-full">
            <img src={userAvatar} alt="" className="h-8 w-8 rounded-full bg-blue-50 ring-2 ring-blue-100" />
          </button>
        </div>
      </header>

      <main>
        {screen === "page" && <div className="px-3 pb-28 pt-4">{page}</div>}
        {screen === "alerts" && (
          <div className="p-4 pb-28">
            <NotificationsPanel isAdmin={isCompanyAdmin} onNavigate={(target) => openPage(target)} onClose={() => setScreen(null)} />
          </div>
        )}
        {!screen && current === "home" && <HomeTab vehicles={vehicles} trips={trips} userName={userName} companyName={companyName} homeData={homeData} go={go} openPage={openPage} onAddInvoice={onAddInvoice} />}
        {!screen && current === "trip" && <MobileTripTab vehicles={vehicles} trips={trips} />}
        {!screen && current === "register" && <RegisterTab onOpenForm={onOpenRecordForm} openPage={openPage} />}
        {!screen && current === "messages" && <MessagesPage isAdmin={isCompanyAdmin} compact />}
        {!screen && current === "menu" && <MenuTab openPage={openPage} />}
      </main>

      <BottomNav tab={screen === "page" ? "menu" : current} onChange={(id) => go(id)} badges={{ messages: inbox.unreadMessages, menu: inbox.myOpenTasks ?? 0 }} />
    </div>
  );
}
