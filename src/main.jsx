import "leaflet/dist/leaflet.css";
import "../tools/.tailwind.css";
import { createRoot } from "react-dom/client";
import NavioDashboard from "./NavioDashboard.jsx";

createRoot(document.getElementById("root")).render(<NavioDashboard />);

// Permite instalar Navio como app. El service worker no guarda nada en caché.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
