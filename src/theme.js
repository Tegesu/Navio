import { useCallback, useEffect, useSyncExternalStore } from "react";
import { Capacitor, SystemBars } from "@capacitor/core";

/* ---------------------------------------------------------------------- */
/*  Tema claro / oscuro                                                   */
/* ---------------------------------------------------------------------- */

// "light", "dark" o "system". Se guarda en este navegador (cada equipo puede
// tener el suyo). /theme-init.js lo aplica antes de que cargue la app.
const KEY = "navio.theme";
const listeners = new Set();
const media = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

function readChoice() {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

const isDark = (choice) => choice === "dark" || (choice === "system" && !!media?.matches);

function apply(choice, animate) {
  const root = document.documentElement;
  if (animate) {
    root.classList.add("theme-switching");
    window.setTimeout(() => root.classList.remove("theme-switching"), 320);
  }
  root.classList.toggle("dark", isDark(choice));
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", isDark(choice) ? "#1e1e1d" : "#2563eb");
  syncSystemBars();
}

// App de Android: la página llega hasta arriba, detrás de la hora y la batería.
// Esos íconos van claros sobre el tema oscuro y oscuros sobre el claro. Solo
// cuando la app avisó las medidas de las barras (--navio-safe-top); si no, se
// dejan como los pone el teléfono.
function syncSystemBars() {
  try {
    if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable("SystemBars")) return;
    if (!document.documentElement.style.getPropertyValue("--navio-safe-top")) return;
    const dark = document.documentElement.classList.contains("dark");
    SystemBars.setStyle({ style: dark ? "DARK" : "LIGHT" }).catch(() => {});
  } catch {
    // Sin la app: nada que hacer.
  }
}

let current = typeof window !== "undefined" ? readChoice() : "system";
if (typeof window !== "undefined") {
  apply(current, false);
  // "Según el sistema": si el teléfono o la computadora cambian de tema, se sigue.
  media?.addEventListener?.("change", () => {
    if (current === "system") {
      apply(current, true);
      listeners.forEach((l) => l());
    }
  });
  // La app de Android mandó las medidas de las barras del teléfono.
  window.addEventListener("navio:safearea", syncSystemBars);
  // Otra pestaña cambió el tema.
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    current = readChoice();
    apply(current, true);
    listeners.forEach((l) => l());
  });
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setThemeChoice(choice) {
  current = choice === "light" || choice === "dark" ? choice : "system";
  try {
    if (current === "system") window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, current);
  } catch {
    // Sin almacenamiento: dura mientras la página esté abierta.
  }
  apply(current, true);
  listeners.forEach((l) => l());
}

// { choice: "light" | "dark" | "system", dark: boolean, setChoice, toggle }
export function useTheme() {
  const choice = useSyncExternalStore(subscribe, () => current, () => "system");
  const dark = useSyncExternalStore(subscribe, () => document.documentElement.classList.contains("dark"), () => false);
  const toggle = useCallback(() => setThemeChoice(dark ? "light" : "dark"), [dark]);
  // Mantiene la clase al día si algo externo la cambió.
  useEffect(() => {
    apply(current, false);
  }, []);
  return { choice, dark, setChoice: setThemeChoice, toggle };
}

export const THEME_OPTIONS = [
  { id: "light", label: "Claro" },
  { id: "dark", label: "Oscuro" },
  { id: "system", label: "Según el equipo" },
];
