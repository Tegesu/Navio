// Reglas para crear o cambiar contraseñas en Navio.
//
// Las cinco primeras coinciden con lo que Supabase exige si en
// Authentication → Sign In / Providers → Email → "Password Requirements" se
// elige "Lowercase, uppercase letters, digits and symbols": por eso solo
// cuentan las letras a-z / A-Z y los símbolos de PASSWORD_SYMBOLS (la ñ, los
// acentos, ¿ y ¡ se permiten, pero no cuentan). Las demás (nombre, correo,
// contraseñas conocidas, repeticiones) solo las revisa la página.
import { Check, Circle, X } from "lucide-react";

export const MIN_PASSWORD = 10;
// Supabase no acepta más de 72 bytes (límite de bcrypt). Una letra con acento
// ocupa 2.
export const MAX_PASSWORD = 72;
export const PASSWORD_SYMBOLS = "!@#$%^&*()_+-=[]{};':\"|<>?,./`~";

// Contraseñas (o su palabra base) que aparecen primero en cualquier lista de
// filtraciones. Se comparan sin acentos, en minúsculas y sin los números y
// símbolos del principio y del final: "Contraseña2026!" → "contrasena".
const COMMON = new Set(
  (
    "password pass contrasena contra clave micontrasena miclave qwerty qwertyuiop asdf asdfgh asdfghjkl zxcvbnm " +
    "admin administrador administracion root user usuario login acceso welcome bienvenido bienvenida hola holamundo " +
    "iloveyou teamo teamomucho amor amorcito familia letmein secret secreto master changeme cambiar cambiame " +
    "default guest invitado test prueba demo abc abcd abcdef monkey dragon sunshine princess princesa superman " +
    "batman football futbol soccer mexico navio flotilla empresa camion trailer chofer america chivas pumas " +
    "cruzazul tigres rayados jesus dios diosmio angel estrella"
  ).split(" ")
);

// Teclas seguidas en el teclado (y los números de la fila de arriba).
const KEYBOARD_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm", "1234567890"];

const LEET = { "@": "a", 4: "a", 3: "e", 1: "i", "!": "i", 0: "o", $: "s", 5: "s", 7: "t" };

function normalize(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

const unLeet = (text) => text.replace(/[@431!0$57]/g, (c) => LEET[c]);

function bytes(text) {
  return new TextEncoder().encode(text).length;
}

// "P@ssw0rd2026!" → "password"
function baseWord(password) {
  const trimmed = normalize(password).replace(/^[^a-z]+/, "").replace(/[^a-z]+$/, "");
  return unLeet(trimmed).replace(/[^a-z]/g, "");
}

function isCommon(password) {
  return COMMON.has(baseWord(password));
}

function isRun(chunk) {
  if (!/^(?:[a-z]{4}|[0-9]{4})$/.test(chunk)) return false;
  const step = chunk.charCodeAt(1) - chunk.charCodeAt(0);
  if (Math.abs(step) !== 1) return false;
  for (let k = 2; k < chunk.length; k += 1) {
    if (chunk.charCodeAt(k) - chunk.charCodeAt(k - 1) !== step) return false;
  }
  return true;
}

// aaaa, 1111, 1234, 4321, abcd, qwer, asdf…
function hasPattern(password) {
  const s = normalize(password);
  if (/(.)\1{3}/.test(s)) return true;
  for (let i = 0; i + 4 <= s.length; i += 1) {
    const w = s.slice(i, i + 4);
    if (isRun(w)) return true;
    const reversed = [...w].reverse().join("");
    if (KEYBOARD_ROWS.some((row) => row.includes(w) || row.includes(reversed))) return true;
  }
  return false;
}

function personalWords(email, name) {
  const local = normalize(String(email ?? "").split("@")[0]);
  const words = [local, ...local.split(/[^a-z0-9]+/), ...normalize(name).split(/[^a-z0-9]+/)];
  return [...new Set(words.filter((w) => w.length >= 4))];
}

function hasPersonal(password, email, name) {
  const s = normalize(password);
  const plain = unLeet(s);
  return personalWords(email, name).some((w) => s.includes(w) || plain.includes(w));
}

// Lista de reglas con su estado. Las que tienen "always" se muestran siempre;
// las demás solo cuando fallan.
export function passwordRules(password, { email = "", name = "" } = {}) {
  const pw = String(password ?? "");
  return [
    { id: "length", always: true, label: `${MIN_PASSWORD} caracteres o más`, error: `Usa al menos ${MIN_PASSWORD} caracteres.`, ok: [...pw].length >= MIN_PASSWORD },
    { id: "lower", always: true, label: "Una minúscula (a-z)", error: "Agrega al menos una letra minúscula (a-z).", ok: /[a-z]/.test(pw) },
    { id: "upper", always: true, label: "Una mayúscula (A-Z)", error: "Agrega al menos una letra mayúscula (A-Z).", ok: /[A-Z]/.test(pw) },
    { id: "digit", always: true, label: "Un número (0-9)", error: "Agrega al menos un número (0-9).", ok: /[0-9]/.test(pw) },
    { id: "symbol", always: true, label: "Un símbolo: ! @ # $ % & * ? -", error: "Agrega al menos un símbolo, como ! @ # $ % & * ? o -.", ok: [...pw].some((c) => PASSWORD_SYMBOLS.includes(c)) },
    { id: "personal", label: "Sin tu nombre ni tu correo", error: "No uses tu nombre ni tu correo dentro de la contraseña.", ok: !hasPersonal(pw, email, name) },
    { id: "common", label: "Que no sea una contraseña conocida", error: "Esa contraseña es de las más usadas y fácil de adivinar. Elige otra.", ok: !isCommon(pw) },
    { id: "pattern", label: "Sin repeticiones ni secuencias (aaaa, 1234, qwer)", error: "Evita repeticiones o secuencias como aaaa, 1234 o qwer.", ok: !hasPattern(pw) },
    { id: "max", label: `Máximo ${MAX_PASSWORD} caracteres`, error: `Usa como máximo ${MAX_PASSWORD} caracteres (las letras con acento cuentan doble).`, ok: bytes(pw) <= MAX_PASSWORD },
  ];
}

// Primer problema encontrado, listo para mostrarse. Vacío = la contraseña sirve.
export function passwordProblem(password, context) {
  return passwordRules(password, context).find((rule) => !rule.ok)?.error ?? "";
}

export function PasswordChecklist({ password, email, name, className = "" }) {
  const typed = !!password;
  const rules = passwordRules(password, { email, name }).filter((r) => r.always || (typed && !r.ok));
  return (
    <ul className={`mt-2 grid grid-cols-1 gap-x-3 gap-y-1 text-[11px] sm:grid-cols-2 ${className}`}>
      {rules.map((rule) => {
        const bad = !rule.ok && !rule.always;
        const Icon = rule.ok ? Check : bad ? X : Circle;
        const tone = rule.ok ? "text-emerald-700" : bad ? "text-rose-600" : "text-slate-400";
        return (
          <li key={rule.id} className={`flex items-start gap-1.5 ${tone}`}>
            <Icon size={rule.ok || bad ? 12 : 9} strokeWidth={rule.ok || bad ? 2.5 : 2} className={`shrink-0 ${rule.ok || bad ? "mt-[1px]" : "mt-[3px]"}`} aria-hidden="true" />
            <span>
              <span className="sr-only">{rule.ok ? "Cumple: " : "Falta: "}</span>
              {rule.label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// Aviso para quien entra con una contraseña anterior a estas reglas: se marca
// al iniciar sesión (solo en esta pestaña) y se quita al cambiarla o al
// elegir "Más tarde".
const WEAK_KEY = "navio.passwordUpgrade";

export function setWeakPasswordFlag(on) {
  try {
    if (on) sessionStorage.setItem(WEAK_KEY, "1");
    else sessionStorage.removeItem(WEAK_KEY);
  } catch {
    // Sin almacenamiento (modo privado estricto): simplemente no se avisa.
  }
}

export function hasWeakPasswordFlag() {
  try {
    return sessionStorage.getItem(WEAK_KEY) === "1";
  } catch {
    return false;
  }
}
