// Respaldo de Navio: copia todas las tablas, la lista de cuentas y todos los
// archivos (facturas, fotos, garantías) a una carpeta de tu computadora.
//
// Solo LEE: no cambia ni borra nada en Supabase.
//
// Uso (PowerShell, desde la carpeta de Navio):
//   D:\Nueva\Node\node.exe tools\respaldo.mjs
// El script pide la llave secreta: pégala con clic derecho y presiona Enter.
// No se ve en pantalla ni queda en el historial de PowerShell.
//
// La llave secreta está en Supabase → Project Settings → API Keys
// ("Secret keys", empieza con sb_secret_; o la "service_role" antigua, que
// empieza con eyJ). No la guardes en archivos ni la compartas.
//
// Opcional: NAVIO_SERVICE_KEY con la llave (si no se quiere escribir),
// NAVIO_BACKUP_DIR para elegir otra carpeta de destino (por omisión,
// D:\Navio-respaldos\<fecha y hora>).

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const SUPABASE_URL = process.env.NAVIO_SUPABASE_URL || "https://bwvetvomcfmolhfrrlcx.supabase.co";
const BUCKETS = ["documents"];
const PAGE = 1000;
const STORAGE_PAGE = 100;

// Pide la llave sin mostrarla (ni asteriscos).
function askHidden(question) {
  if (!process.stdin.isTTY) return Promise.resolve("");
  process.stdout.write(question);
  return new Promise((resolve) => {
    let value = "";
    const finish = () => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      resolve(value);
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return finish();
        if (ch === "\u0003") {
          process.stdout.write("\nCancelado.\n");
          process.exit(1);
        }
        if (ch === "\u0008" || ch === "\u007f") value = value.slice(0, -1);
        else if (ch >= " ") value += ch;
      }
      return undefined;
    };
    process.stdin.setRawMode(true);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", onData);
    process.stdin.resume();
  });
}

let KEY = (process.env.NAVIO_SERVICE_KEY || "").trim();
if (!KEY) KEY = (await askHidden("Pega la llave secreta de Supabase (clic derecho) y presiona Enter. No se verá: ")).trim();

if (!KEY) {
  console.error("No se recibió ninguna llave. Vuelve a correr el comando y pégala cuando la pida.");
  process.exit(1);
}
if (KEY.startsWith("sb_publishable_")) {
  console.error("Esa es la llave pública (publishable). Se necesita la secreta: Project Settings → API Keys → Secret keys.");
  process.exit(1);
}
if (!/^(sb_secret_|eyJ)[A-Za-z0-9._-]{20,}$/.test(KEY)) {
  console.error("Eso no parece una llave secreta de Supabase (debe empezar con sb_secret_ o eyJ y no llevar espacios). Vuelve a copiarla.");
  process.exit(1);
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
