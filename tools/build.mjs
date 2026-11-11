// Compila Navio: src/ → index.html + assets/ (JS y CSS con huella en el nombre).
// Todo queda servido desde el propio sitio: en tiempo de ejecución no se
// descarga código de terceros.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const tools = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(tools, "..");
const modules = path.join(tools, "node_modules");
const outdir = path.join(root, "assets");
const extraEntry = process.argv[2] ? path.resolve(process.argv[2]) : null; // página de pruebas opcional

// Los nombres llevan una huella del contenido, así que el navegador puede
// guardarlos para siempre: al cambiar el código cambia el nombre.
mkdirSync(outdir, { recursive: true });
for (const file of readdirSync(outdir)) {
  if (file.startsWith(extraEntry ? "test-" : "app-")) rmSync(path.join(outdir, file), { force: true });
}

// 1. Tailwind
execFileSync(
  process.execPath,
  [path.join(modules, "tailwindcss/lib/cli.js"), "-c", path.join(tools, "tailwind.config.cjs"), "-i", path.join(root, "src/styles.css"), "-o", path.join(tools, ".tailwind.css"), "--minify"],
  { cwd: root, stdio: ["ignore", "ignore", "inherit"] }
);

// 2. JavaScript y CSS
const result = await build({
  entryPoints: { [extraEntry ? "test" : "app"]: extraEntry ?? path.join(root, "src/main.jsx") },
  bundle: true,
  minify: !extraEntry,
  sourcemap: extraEntry ? "inline" : false,
  format: "esm",
  target: ["es2020"],
  outdir,
  entryNames: "[name]-[hash]",
  jsx: "automatic",
  loader: { ".png": "dataurl", ".svg": "dataurl" },
  nodePaths: [modules],
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "none",
  metafile: true,
  logLevel: "warning",
});

const outputs = Object.entries(result.metafile.outputs);
const [jsPath, jsMeta] = outputs.find(([, meta]) => meta.entryPoint);
const jsFile = path.basename(jsPath);
const cssFile = path.basename(jsMeta.cssBundle);

// 3. Visor de PDF: se sirve desde el sitio, no desde un CDN.
const pdfSource = path.join(modules, "pdfjs-dist");
const pdfVersion = JSON.parse(readFileSync(path.join(pdfSource, "package.json"), "utf8")).version;
const pdfTarget = path.join(root, "vendor/pdfjs");
const versionFile = path.join(pdfTarget, "VERSION");
if (!existsSync(versionFile) || readFileSync(versionFile, "utf8").trim() !== pdfVersion) {
  rmSync(pdfTarget, { recursive: true, force: true });
  mkdirSync(pdfTarget, { recursive: true });
  cpSync(path.join(pdfSource, "legacy/build/pdf.min.mjs"), path.join(pdfTarget, "pdf.min.mjs"));
  cpSync(path.join(pdfSource, "legacy/build/pdf.worker.min.mjs"), path.join(pdfTarget, "pdf.worker.min.mjs"));
  for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
    cpSync(path.join(pdfSource, dir), path.join(pdfTarget, dir), { recursive: true });
  }
  writeFileSync(versionFile, `${pdfVersion}\n`);
}

// 4. index.html (o la página de pruebas)
const html = readFileSync(path.join(root, "src/index.template.html"), "utf8")
  .replaceAll("__CSS__", `/assets/${cssFile}`)
  .replaceAll("__JS__", `/assets/${jsFile}`);
writeFileSync(path.join(root, extraEntry ? "_test.html" : "index.html"), html);

const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;
const cssBytes = result.metafile.outputs[jsMeta.cssBundle]?.bytes ?? 0;
console.log(`${extraEntry ? "_test.html" : "index.html"} ← ${jsFile} (${kb(jsMeta.bytes)}), ${cssFile} (${kb(cssBytes)})`);
