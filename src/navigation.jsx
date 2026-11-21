import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  HelpCircle,
  Home,
  KeyRound,
  LogOut,
  MessageSquare,
  Monitor,
  Moon,
  Radio,
  Receipt,
  Settings,
  Shield,
  ShieldCheck,
  Smartphone,
  Sun,
  Truck,
  User,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { useAuth, InvoiceSidebarMenu, BotFeedPanel } from "./NavioDashboard.jsx";
import { useInbox, NavBadge } from "./inbox.jsx";
import { useTheme, THEME_OPTIONS } from "./theme.js";
import { useBackLayer } from "./history.js";

/* ---------------------------------------------------------------------- */
/*  Rutas de la app                                                       */
/* ---------------------------------------------------------------------- */

// Una ruta es [pestaña, sección]. Las rutas viejas (de avisos, accesos
// rápidos o una pestaña guardada) se traducen a las nuevas.
export function resolveRoute(tab, sub) {
  if (tab === "account") return ["settings", sub && sub !== "privacy" ? sub : "profile"];
  if (tab === "admin") return ["settings", "admin"];
  if (tab === "maintenance" && (sub === "garantias" || sub === "warranties")) return ["warranties", "warranties"];
  if (tab === "maintenance" && sub === "campaigns") return ["warranties", "campaigns"];
  if (tab === "maintenance" && (sub === "servicios" || sub === "ordenes")) return ["services", undefined];
  if (tab === "maintenance" && sub === "programacion") return ["schedule", undefined];
  return [tab, sub];
}

// Sección por omisión de cada pestaña.
export const DEFAULT_SUB = {
  transfers: "open",
  compliance: "all",
  incidents: "all",
  warranties: "warranties",
  messages: "all",
  tasks: "open",
  settings: "profile",
};

// El menú: lo que pidió la persona, en el mismo orden. Los grupos de chat
// salen de las conversaciones reales.
function buildTree({ groupChats }) {
  return [
    { key: "home", label: "Inicio", icon: Home, route: ["home"] },
    {
      key: "fleetGroup",
      label: "Gestión de flotas",
      icon: Truck,
      route: ["fleet"],
      children: [
        { key: "map", label: "Mapa en vivo", route: ["map"] },
        {
          key: "transfers",
          label: "Traslados",
          route: ["transfers", "open"],
          children: [
            { key: "t-scheduled", label: "Programar", route: ["transfers", "scheduled"] },
            { key: "t-ongoing", label: "En curso", route: ["transfers", "ongoing"] },
            { key: "t-completed", label: "Completados", route: ["transfers", "completed"] },
            { key: "t-cancelled", label: "Cancelados", route: ["transfers", "cancelled"] },
          ],
        },
        {
          key: "units",
          label: "Unidades",
          route: ["fleet"],
          children: [
            {
              key: "compliance",
              label: "Trámites",
              route: ["compliance", "all"],
              children: [
                { key: "c-tenencia", label: "Tenencias", route: ["compliance", "Tenencia"] },
                { key: "c-licencia", label: "Licencias", route: ["compliance", "Licencia de Conducir"] },
                { key: "c-tarjeta", label: "Tarjetas de circulación", route: ["compliance", "Tarjeta de Circulación"] },
                { key: "c-multa", label: "Multas", route: ["compliance", "Multa"] },
                { key: "c-seguro", label: "Seguros", route: ["compliance", "Póliza de Seguro"] },
              ],
            },
          ],
        },
      ],
    },
    { key: "fuel", label: "Facturas y gastos", icon: Receipt, route: ["fuel"], invoices: true },
    {
      key: "maintGroup",
      label: "Mantenimiento",
      icon: Wrench,
      route: ["maintenance"],
      children: [
        { key: "services", label: "Servicios", route: ["services"] },
        {
          key: "incidents",
          label: "Incidencias",
          route: ["incidents", "all"],
          children: [
            { key: "i-accident", label: "Accidentes", route: ["incidents", "accident"] },
            { key: "i-failure", label: "Fallas", route: ["incidents", "failure"] },
          ],
        },
        {
          key: "warranties",
          label: "Garantías",
          route: ["warranties", "warranties"],
          children: [
            { key: "w-campaigns", label: "Campañas", route: ["warranties", "campaigns"] },
            { key: "w-warranties", label: "Garantías", route: ["warranties", "warranties"] },
            { key: "w-orders", label: "Órdenes de trabajo", route: ["warranties", "orders"] },
          ],
        },
        { key: "schedule", label: "Programación de mantenimiento", route: ["schedule"] },
      ],
    },
    {
      key: "messages",
      label: "Mensajes",
      icon: MessageSquare,
      badge: "messages",
      // Todas las conversaciones van juntas en Mensajes (sin subsecciones).
      route: ["messages", "all"],
    },
    {
      key: "activities",
      label: "Actividades",
      icon: ClipboardList,
      badge: "tasks",
      route: ["tasks", "open"],
      children: [
        { key: "tasks", label: "Tareas", route: ["tasks", "open"] },
        { key: "agenda", label: "Agenda", route: ["tasks", "agenda"] },
      ],
    },
  ];
}

const BOTTOM_ITEMS = [
  { key: "settings", label: "Configuración", icon: Settings, route: ["settings"] },
  { key: "support", label: "Comunidad", icon: HelpCircle, route: ["support"] },
  { key: "apps", label: "App para Android y iOS", icon: Smartphone, route: ["apps"] },
];

// ¿Qué tan bien coincide un elemento con la ruta actual? 2 = exacto,
// 1 = misma pestaña (sin sección), 0 = no.
function matchScore(route, tab, sub) {
  if (route[0] !== tab) return 0;
  if (route[1] === undefined) return 1;
  return route[1] === sub ? 2 : 0;
}

// Encuentra el elemento seleccionado (el que mejor coincide y más profundo) y
// el camino de sus padres.
function findSelection(tree, tab, sub) {
  let best = null;
  const walk = (nodes, path) => {
    for (const node of nodes) {
      const score = matchScore(node.route, tab, sub);
      const depth = path.length;
      if (score > 0 && (!best || score > best.score || (score === best.score && depth > best.depth))) best = { key: node.key, path: [...path], score, depth };
      if (node.children) walk(node.children, [...path, node.key]);
    }
  };
  walk(tree, []);
  return best;
}

function useStoredExpanded() {
  const [expanded, setExpanded] = useState(() => {
    try {
      return JSON.parse(window.localStorage.getItem("navio.nav.expanded.v2")) ?? {};
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem("navio.nav.expanded.v2", JSON.stringify(expanded));
    } catch {
      // Solo es comodidad.
    }
  }, [expanded]);
  return [expanded, setExpanded];
}

function SmallCount({ count }) {
  if (!count) return null;
  return <span className="ml-auto flex h-4 min-w-[16px] shrink-0 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">{count > 9 ? "9+" : count}</span>;
}

function TreeNode({ node, depth, selection, expanded, onToggle, onGo, invoiceMenu }) {
  const hasChildren = !!node.children?.length || !!node.invoices;
  const isOpen = expanded[node.key] ?? (selection?.path.includes(node.key) || false);
  const selected = selection?.key === node.key;
  const inPath = selection?.path.includes(node.key);
  const Icon = node.icon;

  const top = depth === 0;
  const rowClass = top
    ? `flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
        selected || inPath ? (selected ? "bg-blue-600 text-white shadow-sm" : "bg-blue-50 text-blue-700") : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
      }`
    : `flex w-full min-w-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition ${
        selected ? "bg-blue-50 text-blue-700" : inPath ? "text-slate-800" : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
      }`;

  return (
    <div>
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => {
            onGo(node.route);
            if (hasChildren && !isOpen) onToggle(node.key, true);
          }}
          title={node.label}
          aria-current={selected ? "page" : undefined}
          className={rowClass}
        >
          {Icon && <Icon size={18} className="shrink-0" />}
          <span className="min-w-0 flex-1 truncate text-left">{node.label}</span>
          {node.badge && <NavBadge id={node.badge} />}
          {node.count ? <SmallCount count={node.count} /> : null}
        </button>
        {hasChildren && (
          <button
            onClick={() => onToggle(node.key, !isOpen)}
            aria-label={`${isOpen ? "Ocultar" : "Mostrar"} ${node.label}`}
            aria-expanded={isOpen}
            className={`flex shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-50 hover:text-slate-600 ${top ? "h-8 w-7" : "h-6 w-6"}`}
          >
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        )}
      </div>
      {hasChildren && isOpen && (
        <div className={`${top ? "ml-[22px] mt-1" : "ml-3 mt-0.5"} space-y-0.5 border-l border-slate-100 pl-2.5`}>
          {node.invoices && invoiceMenu ? (
            <InvoiceSidebarMenu
              active={invoiceMenu.active}
              nav={invoiceMenu.nav}
              projects={invoiceMenu.projects}
              expanded={invoiceMenu.expanded}
              onToggle={invoiceMenu.onToggle}
              onNav={invoiceMenu.onNav}
              flush
            />
          ) : (
            node.children.map((child) => (
              <TreeNode key={child.key} node={child} depth={depth + 1} selection={selection} expanded={expanded} onToggle={onToggle} onGo={onGo} />
            ))
          )}
          {node.key === "m-group" && node.children.length === 0 && <p className="px-2.5 py-1 text-[11px] text-slate-400">Sin chats grupales</p>}
        </div>
      )}
    </div>
  );
}

// La barra lateral. En pantallas angostas (por ejemplo, la computadora con
// la ventana a la mitad) se queda en íconos y, al abrirla, flota encima.
export function Sidebar({ open, overlay, onClose, tab, sub, onGo, onLogoClick, invoiceMenu }) {
  const inbox = useInbox();
  const groupChats = useMemo(() => (inbox?.channels ?? []).filter((c) => c.kind === "general" || c.kind === "group"), [inbox?.channels]);
  const tree = useMemo(() => buildTree({ groupChats }), [groupChats]);
  const selection = useMemo(() => findSelection([...tree, ...BOTTOM_ITEMS], tab, sub), [tree, tab, sub]);
  const [expanded, setExpanded] = useStoredExpanded();
  // Con el menú encima de la página, "atrás" lo cierra.
  useBackLayer(!!overlay && !!open, onClose);
  const [invoiceExpanded, setInvoiceExpanded] = useState({ invoiceGeneral: true, invoiceProjects: true });
  const toggle = (key, value) => setExpanded((prev) => ({ ...prev, [key]: value }));
  const go = (route) => {
    onGo(route[0], route[1]);
    if (overlay) onClose();
  };

  const invoices = invoiceMenu && {
    ...invoiceMenu,
    active: tab === "fuel",
    expanded: invoiceExpanded,
    onToggle: (key) => setInvoiceExpanded((prev) => ({ ...prev, [key]: !prev[key] })),
    onNav: (nav) => {
      invoiceMenu.onNav(nav);
      if (overlay) onClose();
    },
  };

  const panel = (
    <aside
      className={`flex h-screen shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-200 print:hidden ${open ? "w-72" : "w-[72px]"} ${
        overlay ? "fixed inset-y-0 left-0 z-50 shadow-2xl" : "sticky top-0"
      }`}
    >
      <div className={`flex h-16 shrink-0 items-center border-b border-slate-100 ${open ? "px-4" : "justify-center"}`}>
        <button onClick={onLogoClick} title="Ir al inicio" className="flex items-center rounded-lg hover:opacity-90">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-sm font-extrabold text-white">N</span>
          {open && <span className="ml-2.5 text-lg font-extrabold tracking-tight text-blue-700">NAVIO</span>}
        </button>
        {open && overlay && (
          <button onClick={onClose} aria-label="Cerrar menú" className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label="Secciones de Navio">
        {open
          ? tree.map((node) => <TreeNode key={node.key} node={node} depth={0} selection={selection} expanded={expanded} onToggle={toggle} onGo={go} invoiceMenu={invoices} />)
          : tree.map((node) => {
              const Icon = node.icon;
              const active = selection?.key === node.key || selection?.path.includes(node.key);
              return (
                <button
                  key={node.key}
                  onClick={() => go(node.route)}
                  title={node.label}
                  aria-label={node.label}
                  className={`relative flex w-full items-center justify-center rounded-xl py-2.5 transition ${active ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"}`}
                >
                  <Icon size={18} />
                  {node.badge && (
                    <span className="absolute right-1.5 top-1">
                      <NavBadge id={node.badge} />
                    </span>
                  )}
                </button>
              );
            })}
      </nav>

      <div className="space-y-1 border-t border-slate-100 px-3 py-3">
        {BOTTOM_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = selection?.key === item.key;
          return (
            <button
              key={item.key}
              onClick={() => go(item.route)}
              title={item.label}
              aria-label={item.label}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-xs font-medium transition ${
                active ? "bg-blue-50 text-blue-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
              } ${open ? "" : "justify-center"}`}
            >
              <Icon size={16} className="shrink-0" />
              {open && <span className="truncate">{item.label}</span>}
            </button>
          );
        })}
      </div>

      {open ? (
        <div className="border-t border-slate-100 p-3">
          <div className="mb-2 flex items-center gap-1.5 px-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">
            <Bot size={13} /> Bot de ingesta
          </div>
          <BotFeedPanel />
        </div>
      ) : null}
    </aside>
  );

  if (!overlay) return panel;
  return (
    <>
      {/* Ocupa el lugar de la barra en íconos para que la página no brinque. */}
      <div className="w-[72px] shrink-0 print:hidden" />
      {open ? (
        <>
          <div className="fixed inset-0 z-40 bg-slate-900/40 print:hidden" onClick={onClose} aria-hidden="true" />
          {panel}
        </>
      ) : (
        <div className="fixed inset-y-0 left-0 z-30">{panel}</div>
      )}
    </>
  );
}

/* ---------------------------------------------------------------------- */
/*  Menú del usuario (el círculo con sus iniciales)                       */
/* ---------------------------------------------------------------------- */

export const SETTINGS_SECTIONS = [
  { id: "profile", group: "Mi cuenta", label: "Perfil", icon: User },
  { id: "security", group: "Mi cuenta", label: "Seguridad", icon: ShieldCheck },
  { id: "tracking", group: "Mi cuenta", label: "Rastreo del viaje", icon: Smartphone },
  { id: "role", group: "Mi cuenta", label: "Mi rol", icon: KeyRound },
  { id: "company", group: "Empresa", label: "Datos de la empresa", icon: Truck },
  { id: "team", group: "Empresa", label: "Equipo", icon: Users },
  { id: "bot", group: "Empresa", label: "Bot de Telegram", icon: Bot },
  { id: "gps", group: "Empresa", label: "Dispositivos GPS", icon: Radio },
  { id: "audit", group: "Empresa", label: "Bitácora", icon: ClipboardList },
  { id: "preferences", group: "General", label: "Preferencias", icon: Settings },
  { id: "privacy", group: "General", label: "Privacidad", icon: Shield },
  { id: "admin", group: "Plataforma", label: "Administración", icon: Shield, superAdmin: true },
];

export function ThemeSwitch({ compact = false }) {
  const { choice, setChoice } = useTheme();
  const icons = { light: Sun, dark: Moon, system: Monitor };
  return (
    <div role="radiogroup" aria-label="Tema" className="flex gap-1 rounded-xl bg-slate-100 p-1">
      {THEME_OPTIONS.map((option) => {
        const Icon = icons[option.id];
        const active = choice === option.id;
        return (
          <button
            key={option.id}
            role="radio"
            aria-checked={active}
            onClick={() => setChoice(option.id)}
            title={option.label}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition ${
              active ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <Icon size={13} /> {!compact && option.label}
          </button>
        );
      })}
    </div>
  );
}

export function UserMenu({ userName, userAvatar, companyName, userEmail, isSuperAdmin, isCompanyAdmin, onGo, onSignOut }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const { signOut } = useAuth();

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (!box.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const sections = SETTINGS_SECTIONS.filter((s) => !s.superAdmin || isSuperAdmin);
  const groups = [...new Set(sections.map((s) => s.group))];

  return (
    <div className="relative" ref={box}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Menú de tu cuenta y configuración"
        className="flex items-center gap-2.5 rounded-xl p-1 pr-2 hover:bg-slate-100"
      >
        <img src={userAvatar} alt="" className="h-9 w-9 rounded-full bg-blue-50 ring-2 ring-blue-100" />
        <span className="hidden min-w-0 text-left leading-tight xl:block">
          <span className="block max-w-[160px] truncate text-sm font-semibold text-slate-800">{userName}</span>
          <span className="block max-w-[160px] truncate text-xs text-slate-400">{companyName || (isCompanyAdmin ? "Administrador" : "Usuario")}</span>
        </span>
        <ChevronDown size={14} className="hidden text-slate-400 xl:block" />
      </button>

      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-72 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center gap-3 border-b border-slate-100 p-3.5">
            <img src={userAvatar} alt="" className="h-10 w-10 rounded-full" />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-slate-800">{userName}</p>
              <p className="truncate text-[11px] text-slate-400">{userEmail}</p>
              <p className="truncate text-[11px] font-medium text-slate-500">
                {companyName ? `${companyName} · ` : ""}
                {isSuperAdmin ? "Super-administrador" : isCompanyAdmin ? "Administrador" : "Usuario"}
              </p>
            </div>
          </div>
          <div className="max-h-[60vh] overflow-y-auto p-2">
            {groups.map((group) => (
              <div key={group} className="mb-1">
                <p className="px-2 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">{group}</p>
                {sections
                  .filter((s) => s.group === group)
                  .map((s) => {
                    const Icon = s.icon;
                    return (
                      <button
                        key={s.id}
                        role="menuitem"
                        onClick={() => {
                          setOpen(false);
                          onGo("settings", s.id);
                        }}
                        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-800"
                      >
                        <Icon size={14} className="shrink-0 text-slate-400" /> {s.label}
                      </button>
                    );
                  })}
              </div>
            ))}
          </div>
          <div className="space-y-2 border-t border-slate-100 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Tema</p>
            <ThemeSwitch />
            <button
              role="menuitem"
              onClick={() => (onSignOut ?? signOut)()}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-100"
            >
              <LogOut size={14} /> Cerrar sesión
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
