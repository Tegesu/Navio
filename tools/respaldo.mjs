// Respaldo de Navio: copia todas las tablas, la lista de cuentas y todos los
// archivos (facturas, fotos, garantías) a una carpeta de tu computadora.
//
// Solo LEE: no cambia ni borra nada en Supabase.
//
// Uso (PowerShell, desde la carpeta de Navio):
//   $env:NAVIO_SERVICE_KEY = "<llave secreta de Supabase>"
//   D:\Nueva\Node\node.exe tools\respaldo.mjs
//   Remove-Item Env:NAVIO_SERVICE_KEY
//
// La llave secreta está en Supabase → Project Settings → API Keys
// ("service_role" o "Secret key"). No la guardes en archivos ni la compartas.
//
// Opcional: NAVIO_BACKUP_DIR para elegir otra carpeta de destino
// (por omisión, D:\Navio-respaldos\<fecha y hora>).

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const SUPABASE_URL = process.env.NAVIO_SUPABASE_URL || "https://bwvetvomcfmolhfrrlcx.supabase.co";
const KEY = (process.env.NAVIO_SERVICE_KEY || "").trim();
const BUCKETS = ["documents"];
const PAGE = 1000;
const STORAGE_PAGE = 100;

if (!KEY) {
  console.error("Falta la llave. En PowerShell escribe primero:");
  console.error('  $env:NAVIO_SERVICE_KEY = "<llave secreta de Supabase>"');
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
const OUT = process.env.NAVIO_BACKUP_DIR || path.join("D:\\Navio-respaldos", stamp);
mkdirSync(path.join(OUT, "tablas"), { recursive: true });
mkdirSync(path.join(OUT, "archivos"), { recursive: true });

// Las llaves nuevas ("sb_secret_…") van solo en "apikey"; las antiguas
// (JWT "eyJ…") también como "Authorization".
const headers = { apikey: KEY, ...(KEY.startsWith("eyJ") ? { Authorization: `Bearer ${KEY}` } : {}) };
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
