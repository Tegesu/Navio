// Navio — service worker: permite instalar Navio como app y recibe las
// notificaciones (mensajes y tareas nuevas) aunque Navio esté cerrado.
// A propósito NO cachea nada — este proyecto ya se topó una vez con bugs por
// páginas viejas quedándose cacheadas, así que todo pasa directo a la red.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // no-op: deja pasar todo a la red.
});

// Llega un aviso. Si Navio está abierto y a la vista, no se repite como
// notificación del sistema (la persona ya lo ve en pantalla).
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "Navio", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const visible = clients.some((c) => c.visibilityState === "visible" && c.focused);
      if (visible && data.skipIfVisible !== false) return undefined;
      const actions = [];
      if ((data.actions || []).includes("read")) actions.push({ action: "read", title: "Marcar como leído" });
      if ((data.actions || []).includes("open")) actions.push({ action: "open", title: "Responder" });
      return self.registration.showNotification(data.title || "Navio", {
        // Los mensajes seguidos del mismo chat se juntan (mismo "tag").
        body: data.body || "",
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        image: data.image || undefined, // sticker o GIF pequeño
        tag: data.tag || undefined,
        renotify: !!data.tag,
        actions,
        // Las llamadas se quedan en pantalla hasta que se tocan.
        requireInteraction: !!data.requireInteraction,
        vibrate: data.requireInteraction ? [400, 200, 400, 200, 400] : undefined,
        data: { url: data.url || "/", channelId: data.channelId || null },
      });
    })
  );
});

// "Marcar como leído" sin abrir Navio: con la clave de este navegador, que la
// página guarda aquí al activar los avisos.
async function markRead(channelId) {
  const cache = await caches.open("navio-push");
  const saved = await cache.match("/__navio-push-key");
  if (!saved || !channelId) return false;
  const key = await saved.json();
  const res = await fetch(`${key.url}/rest/v1/rpc/push_action`, {
    method: "POST",
    headers: { apikey: key.anon, authorization: `Bearer ${key.anon}`, "content-type": "application/json" },
    body: JSON.stringify({ device_kind: "web", device_ident: key.endpoint, device_secret: key.secret, target_channel: channelId, act: "read" }),
  });
  return res.ok;
}

// Tocar la notificación abre Navio en la conversación o la sección del aviso.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "read") {
    event.waitUntil(markRead(event.notification.data?.channelId).catch(() => false));
    return;
  }
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const open = clients.find((c) => new URL(c.url).origin === self.location.origin);
      if (open) {
        open.postMessage({ type: "navio:open", url });
        return open.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
