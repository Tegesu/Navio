// Respaldo de Navio: copia todas las tablas, la lista de cuentas y todos los
// archivos (facturas, fotos, garantías) a una carpeta de tu computadora.
//
// Solo LEE: no cambia ni borra nada en Supabase.
//
// Uso (PowerShell, desde la carpeta de Navio):
//   D:\Nueva\Node\node.exe tools\respaldo.mjs
// Cuando lo pida, copia la llave secreta en Supabase (botón de copiar),
// vuelve a PowerShell y presiona Enter: el script la toma del portapapeles,
// no la muestra y después vacía el portapapeles. Tampoco queda en el
// historial de PowerShell.
//
// La llave secreta está en Supabase → Project Settings → API Keys
// ("Secret keys", empieza con sb_secret_; o la "service_role" antigua, que
// empieza con eyJ). No la guardes en archivos ni la compartas.
//
// Opcional: NAVIO_SERVICE_KEY con la llave (si no se quiere escribir),
// NAVIO_BACKUP_DIR para elegir otra carpeta de destino (por omisión,
// D:\Navio-respaldos\<fecha y hora>).

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";

const SUPABASE_URL = process.env.NAVIO_SUPABASE_URL || "https://bwvetvomcfmolhfrrlcx.supabase.co";
const BUCKETS = ["documents"];
const PAGE = 1000;
const STORAGE_PAGE = 100;

// La llave se toma del portapapeles de Windows, para no tener que pegarla
// (la consola clásica de PowerShell no siempre pega bien) ni mostrarla.
function readClipboard() {
  try {
    return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-Clipboard -Raw"], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

function clearClipboard() {
  try {
    execFileSync("cmd.exe", ["/d", "/c", "echo off | clip"], { windowsHide: true, stdio: "ignore" });
  } catch {
    // Si no se puede, no pasa nada grave: se avisa abajo.
  }
}

async function askKey() {
  console.log("1. En Supabase → Project Settings → API Keys → Secret keys, copia la llave con su botón de copiar.");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // Si alguien la pega aquí en lugar de solo presionar Enter, también sirve.
  const typed = (await rl.question("2. Vuelve aquí y presiona Enter: ")).trim();
  rl.close();
  if (typed) {
    // Borra de la pantalla la línea (o líneas) donde quedó la llave.
    const cols = process.stdout.columns || 80;
    const rows = Math.ceil((typed.length + 34) / cols);
    process.stdout.write("\x1b[1A\x1b[2K".repeat(rows) + "2. Llave pegada.\n");
    return typed;
  }
  return readClipboard();
}

let KEY = (process.env.NAVIO_SERVICE_KEY || "").trim();
let fromUser = false;
if (!KEY && process.stdin.isTTY) {
  KEY = await askKey();
  fromUser = true;
}
// Quita espacios, saltos de línea y comillas que a veces se copian de más.
KEY = KEY.replace(/^[\s"'“”]+|[\s"'“”]+$/g, "");
if (fromUser) {
  clearClipboard();
  console.log("   Listo: vacié el portapapeles para que la llave no se quede ahí.");
}

function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}
if (!KEY) fail("No encontré ninguna llave en el portapapeles. Cópiala en Supabase (botón de copiar) y vuelve a correr el comando.");
if (/[•*…?�]/.test(KEY)) fail("Se copió la llave oculta (con puntos). En Supabase da clic en el ojo para mostrarla completa, cópiala y vuelve a correr el comando.");
if (KEY.startsWith("sb_publishable_")) fail("Esa es la llave pública (publishable). Se necesita la secreta: Project Settings → API Keys → Secret keys.");
if (!/^(sb_secret_|eyJ)[A-Za-z0-9._-]{20,}$/.test(KEY)) {
  fail(`Lo que hay en el portapapeles no parece una llave secreta (${KEY.length} caracteres; debe empezar con sb_secret_). Cópiala de nuevo en Supabase y vuelve a correr el comando.`);
}
console.log(`Llave recibida: ${KEY.slice(0, 10)}… (${KEY.length} caracteres)`);

const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
const OUT = process.env.NAVIO_BACKUP_DIR || path.join("D:\\Navio-respaldos", stamp);
mkdirSync(path.join(OUT, "tablas"), { recursive: true });
mkdirSync(path.join(OUT, "archivos"), { recursive: true });

// Igual que la librería oficial de Supabase: la llave va en "apikey" y en
// "Authorization" (el almacén de archivos exige esta última).
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const summary = { fecha: new Date().toISOString(), proyecto: SUPABASE_URL, tablas: {}, cuentas: 0, archivos: { total: 0, bytes: 0 }, errores: [] };

async function getJson(url, extra = {}) {
  const res = await fetch(url, { headers: { ...headers, ...extra } });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  return { body: await res.json(), res };
}

// ---------- 1. Tablas ----------
async function listTables() {
  const { body } = await getJson(`${SUPABASE_URL}/rest/v1/`, { Accept: "application/openapi+json" });
  const defs = body.definitions ?? {};
  return Object.keys(body.paths ?? {})
    .filter((p) => p !== "/" && !p.startsWith("/rpc/"))
    .map((p) => p.slice(1))
    .map((name) => ({ name, hasId: !!defs[name]?.properties?.id }));
}

async function dumpTable({ name, hasId }) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const order = hasId ? "&order=id.asc" : "";
    const { body } = await getJson(`${SUPABASE_URL}/rest/v1/${encodeURIComponent(name)}?select=*${order}`, {
      Range: `${from}-${from + PAGE - 1}`,
      "Range-Unit": "items",
    });
    rows.push(...body);
    if (body.length < PAGE) break;
  }
  writeFileSync(path.join(OUT, "tablas", `${name}.json`), JSON.stringify(rows, null, 2));
  return rows.length;
}

// ---------- 2. Cuentas (sin contraseñas: Supabase no las entrega) ----------
async function dumpUsers() {
  const users = [];
  for (let page = 1; ; page += 1) {
    const { body } = await getJson(`${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=1000`);
    const list = body.users ?? [];
    users.push(...list.map((u) => ({ id: u.id, email: u.email, created_at: u.created_at, email_confirmed_at: u.email_confirmed_at, last_sign_in_at: u.last_sign_in_at, user_metadata: u.user_metadata })));
    if (list.length < 1000) break;
  }
  writeFileSync(path.join(OUT, "cuentas.json"), JSON.stringify(users, null, 2));
  return users.length;
}

// ---------- 3. Archivos ----------
async function listFolder(bucket, prefix) {
  const files = [];
  for (let offset = 0; ; offset += STORAGE_PAGE) {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${bucket}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ prefix, limit: STORAGE_PAGE, offset, sortBy: { column: "name", order: "asc" } }),
    });
    if (!res.ok) throw new Error(`lista ${bucket}/${prefix}: ${res.status} ${(await res.text()).slice(0, 150)}`);
    const entries = await res.json();
    for (const entry of entries) {
      const full = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) files.push(...(await listFolder(bucket, full))); // carpeta
      else files.push(full);
    }
    if (entries.length < STORAGE_PAGE) break;
  }
  return files;
}

async function dumpBucket(bucket) {
  const files = await listFolder(bucket, "");
  let done = 0;
  for (const name of files) {
    // Defensa: el nombre no puede salirse de la carpeta de respaldo.
    const target = path.join(OUT, "archivos", bucket, ...name.split("/").filter((part) => part && part !== ".." && part !== "."));
    try {
      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${name.split("/").map(encodeURIComponent).join("/")}`, { headers });
      if (!res.ok) throw new Error(`${res.status}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, bytes);
      summary.archivos.total += 1;
      summary.archivos.bytes += bytes.length;
    } catch (err) {
      summary.errores.push(`archivo ${bucket}/${name}: ${err.message}`);
    }
    done += 1;
    if (done % 25 === 0 || done === files.length) process.stdout.write(`\r  ${bucket}: ${done}/${files.length} archivos`);
  }
  if (files.length) process.stdout.write("\n");
}

console.log(`Respaldo de Navio → ${OUT}`);
try {
  const tables = await listTables();
  console.log(`Tablas encontradas: ${tables.length}`);
  for (const table of tables) {
    try {
      summary.tablas[table.name] = await dumpTable(table);
      console.log(`  ${table.name}: ${summary.tablas[table.name]} filas`);
    } catch (err) {
      summary.errores.push(`tabla ${table.name}: ${err.message}`);
      console.log(`  ${table.name}: ERROR`);
    }
  }
} catch (err) {
  summary.errores.push(`lista de tablas: ${err.message}`);
  console.log("No se pudo obtener la lista de tablas. ¿La llave es la secreta (service_role)?");
}

try {
  summary.cuentas = await dumpUsers();
  console.log(`Cuentas: ${summary.cuentas}`);
} catch (err) {
  summary.errores.push(`cuentas: ${err.message}`);
}

for (const bucket of BUCKETS) {
  try {
    await dumpBucket(bucket);
  } catch (err) {
    summary.errores.push(`almacén ${bucket}: ${err.message}`);
  }
}

writeFileSync(path.join(OUT, "resumen.json"), JSON.stringify(summary, null, 2));
const mb = (summary.archivos.bytes / 1024 / 1024).toFixed(1);
console.log(`\nListo: ${Object.keys(summary.tablas).length} tablas, ${summary.cuentas} cuentas, ${summary.archivos.total} archivos (${mb} MB).`);
if (summary.errores.length) {
  console.log(`Con ${summary.errores.length} avisos (detalle en resumen.json):`);
  summary.errores.slice(0, 10).forEach((e) => console.log(`  - ${e}`));
}
console.log("Guarda una copia de esta carpeta fuera de la computadora: contiene datos personales y de facturación.");
