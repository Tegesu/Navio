#!/bin/sh
# Regenerates index.html from src/NavioDashboard.jsx.
# Run this after every edit to src/NavioDashboard.jsx.
set -e
cd "$(dirname "$0")"

cat > index.html <<'HEAD'
<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Navio — Panel de gestión logística</title>
    <link rel="manifest" href="/manifest.json" />
    <meta name="theme-color" content="#2563eb" />
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
    <link rel="icon" href="/icons/icon-192.png" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <meta name="apple-mobile-web-app-title" content="Navío" />
    <script src="https://cdn.tailwindcss.com"></script>
    <script type="importmap">
      {
        "imports": {
          "react": "https://esm.sh/react@18.3.1",
          "react/jsx-runtime": "https://esm.sh/react@18.3.1/jsx-runtime",
          "react/jsx-dev-runtime": "https://esm.sh/react@18.3.1/jsx-dev-runtime",
          "react-dom/client": "https://esm.sh/react-dom@18.3.1/client",
          "lucide-react": "https://esm.sh/lucide-react@0.294.0?external=react",
          "@supabase/supabase-js": "https://esm.sh/@supabase/supabase-js@2"
        }
      }
    </script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <style>
      body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="text/babel" data-type="module" data-presets="react">
import { createRoot } from "react-dom/client";
HEAD

cat src/NavioDashboard.jsx >> index.html

cat >> index.html <<'FOOT'

createRoot(document.getElementById("root")).render(<NavioDashboard />);
    </script>
    <script>
      if ("serviceWorker" in navigator) {
        window.addEventListener("load", () => {
          navigator.serviceWorker.register("/sw.js").catch(() => {});
        });
      }
    </script>
  </body>
</html>
FOOT

echo "index.html regenerated ($(wc -l < index.html) lines)."
