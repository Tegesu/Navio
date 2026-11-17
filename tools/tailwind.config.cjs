// Solo se generan las clases que aparecen en el código de src/.
//
// Modo oscuro: cada color de la paleta es una variable de CSS que cambia de
// valor cuando <html> lleva la clase "dark". Así las pantallas no necesitan
// clases "dark:" una por una: un fondo "bg-white" pasa a ser la superficie
// oscura, un texto "text-slate-800" pasa a ser claro, etc.
//
// Los papeles van por separado (fondo, texto, borde) porque cada uno se
// invierte distinto: un botón "bg-blue-600 text-white" sigue igual, pero un
// aviso "bg-blue-50 text-blue-700" pasa a fondo azul oscuro con texto azul claro.
const colors = require("tailwindcss/colors");
const plugin = require("tailwindcss/plugin");

const NAMES = ["slate", "gray", "blue", "sky", "indigo", "violet", "purple", "emerald", "green", "teal", "cyan", "amber", "yellow", "orange", "rose", "red", "pink"];
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const NEUTRAL = new Set(["slate", "gray"]);

const hexToRgb = (hex) => {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const rgb = (hex) => hexToRgb(hex).join(" ");
const mix = (a, b, weight) => {
  const [x, y] = [hexToRgb(a), hexToRgb(b)];
  return x.map((v, i) => Math.round(v * weight + y[i] * (1 - weight))).join(" ");
};

// Modo oscuro con personalidad: grises carbón cálidos (no azulados), el
// color de Navio pasa a un lavanda y los acentos van en tonos naranja. Los
// verdes y rojos conservan su significado (bien / problema).
const DARK = { page: "#1e1e1d", surface: "#272726" };

// Color de marca en oscuro (lavanda).
const LAVENDER = {
  50: "#f3f1ff", 100: "#e9e5ff", 200: "#d5cdff", 300: "#bdb2ff", 400: "#a597fd", 500: "#8f7ff6",
  600: "#6f5de8", 700: "#5e4bd6", 800: "#4a3ba8", 900: "#3a3085", 950: "#241e52",
};
// Acentos (naranja terracota).
const ORANGE = {
  50: "#fdf3ee", 100: "#fbe3d7", 200: "#f6c4ae", 300: "#efa27f", 400: "#e8895f", 500: "#d97757",
  600: "#c2633f", 700: "#a24f31", 800: "#7f3e28", 900: "#5f2f1f", 950: "#341910",
};
// Qué escala usa cada color en oscuro.
const DARK_SOURCE = {
  blue: LAVENDER, indigo: LAVENDER, violet: LAVENDER, purple: LAVENDER,
  sky: ORANGE, cyan: ORANGE, teal: ORANGE, amber: ORANGE, orange: ORANGE, yellow: ORANGE,
};

// Valores del modo oscuro según el papel del color (grises carbón).
const NEUTRAL_DARK = {
  bg: { 50: "#2e2e2c", 100: "#343432", 200: "#3e3e3b", 300: "#4a4a47", 400: "#5f5e5a", 500: "#6b6a65", 600: "#55544f", 700: "#42413e", 800: "#30302e", 900: "#171716", 950: "#0f0f0e" },
  tx: { 50: "#1e1e1d", 100: "#2a2a28", 200: "#3e3e3b", 300: "#57564f", 400: "#85847e", 500: "#a09f99", 600: "#b6b5af", 700: "#d0cfc9", 800: "#e8e7e1", 900: "#f3f2ed", 950: "#faf9f5" },
  bd: { 50: "#2d2d2b", 100: "#323230", 200: "#3b3b38", 300: "#484744", 400: "#5a5955", 500: "#6f6e69", 600: "#8a8984", 700: "#a3a29c", 800: "#cfcec8", 900: "#e6e5df", 950: "#f2f1ec" },
};

function darkValue(role, name, shade) {
  const c = DARK_SOURCE[name] ?? colors[name];
  if (NEUTRAL.has(name)) return rgb(NEUTRAL_DARK[role][shade]);
  if (role === "bg") {
    // Fondos suaves (avisos, chips): un toque del color sobre la superficie.
    if (shade === 50) return mix(c[700], DARK.surface, 0.16);
    if (shade === 100) return mix(c[700], DARK.surface, 0.26);
    if (shade === 200) return mix(c[600], DARK.surface, 0.36);
    if (shade === 300) return mix(c[600], DARK.surface, 0.6);
    return rgb(c[shade]);
  }
  if (role === "tx") {
    // Textos claros (50–400) se usan sobre fondos de color: no cambian.
    if (shade === 500) return rgb(c[400]);
    if (shade === 600) return rgb(c[400]);
    if (shade === 700) return rgb(c[300]);
    if (shade === 800) return rgb(c[200]);
    if (shade === 900 || shade === 950) return rgb(c[100]);
    return rgb(c[shade]);
  }
  // Bordes y anillos.
  if (shade === 50 || shade === 100) return mix(c[700], DARK.surface, 0.3);
  if (shade === 200) return mix(c[600], DARK.surface, 0.42);
  if (shade === 300) return mix(c[500], DARK.surface, 0.6);
  if (shade === 400) return rgb(c[500]);
  return rgb(c[shade]);
}

function palette(role) {
  const out = {};
  for (const name of NAMES) {
    out[name] = {};
    for (const shade of SHADES) out[name][shade] = `rgb(var(--${role}-${name}-${shade}) / <alpha-value>)`;
  }
  return out;
}

function variables(dark) {
  const vars = {};
  for (const role of ["bg", "tx", "bd"]) {
    for (const name of NAMES) {
      for (const shade of SHADES) vars[`--${role}-${name}-${shade}`] = dark ? darkValue(role, name, shade) : rgb(colors[name][shade]);
    }
  }
  vars["--bg-white"] = dark ? rgb(DARK.surface) : "255 255 255";
  vars["--bg-page"] = dark ? rgb(DARK.page) : rgb("#f8fafc");
  vars["--bd-white"] = dark ? rgb(DARK.surface) : "255 255 255";
  return vars;
}

module.exports = {
  content: ["./src/**/*.{js,jsx}"],
  darkMode: "class",
  theme: {
    extend: {
      backgroundColor: { ...palette("bg"), white: "rgb(var(--bg-white) / <alpha-value>)", page: "rgb(var(--bg-page) / <alpha-value>)" },
      textColor: { ...palette("tx") },
      borderColor: { ...palette("bd"), white: "rgb(var(--bd-white) / <alpha-value>)" },
      divideColor: { ...palette("bd") },
      ringColor: { ...palette("bd"), white: "rgb(var(--bd-white) / <alpha-value>)" },
      ringOffsetColor: { white: "rgb(var(--bg-white) / <alpha-value>)" },
      placeholderColor: { ...palette("tx") },
    },
  },
  plugins: [
    plugin(({ addBase }) => {
      addBase({
        ":root": variables(false),
        "html.dark": { ...variables(true), colorScheme: "dark" },
      });
    }),
  ],
};
