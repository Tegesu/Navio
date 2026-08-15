// Navio — service worker mínimo: solo habilita la instalación como app
// (icono en pantalla de inicio, modo standalone). A propósito NO cachea
// nada — este proyecto ya se topó una vez con bugs por páginas viejas
// quedándose cacheadas, así que todo pasa directo a la red.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // no-op: deja pasar todo a la red.
});
