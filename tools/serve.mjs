// Servidor local para probar lo compilado con las mismas cabeceras de
// seguridad que tendrá en Vercel (las lee de vercel.json).
import http from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.argv[2]) || 5175;
const rules = JSON.parse(readFileSync(path.join(root, "vercel.json"), "utf8")).headers;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".ttf": "font/ttf",
};

http
  .createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file = path.join(root, pathname);
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!existsSync(file)) {
      res.writeHead(404).end("No encontrado");
      return;
    }
    for (const rule of rules) {
      if (new RegExp(`^${rule.source}$`).test(pathname)) {
        for (const h of rule.headers) {
          // En local no hay HTTPS: "upgrade-insecure-requests" rompería las pruebas.
          res.setHeader(h.key, h.value.replace("; upgrade-insecure-requests", ""));
        }
      }
    }
    res.setHeader("Content-Type", TYPES[path.extname(file)] ?? "application/octet-stream");
    res.end(readFileSync(file));
  })
  .listen(port, () => console.log(`Navio compilado en http://localhost:${port}`));
