// Pruebas: con ?native en la dirección, la página cree que corre dentro de la
// app de Android. Simula el puente de la app (servicio de ubicación en segundo
// plano y red del teléfono). Debe cargarse antes que la app.
//
//   window.__native.fix(lat, lng, kmh)  → llega una ubicación del servicio
//   window.__native.denied = true       → el permiso de ubicación fue negado
//   window.__native.calls / .http       → lo que la app pidió al teléfono
if (new URLSearchParams(window.location.search).has("native")) {
  const watchers = new Map();
  let seq = 1;
  const native = {
    watchers,
    calls: [],
    http: [],
    denied: false,
    pushPermission: "prompt",
    pushDeny: false, // el teléfono dice "No permitir"
    channels: [],
    pushListeners: new Map(),
    // Llega un aviso con la app abierta (Android no lo muestra arriba).
    receivePush(data = {}) {
      for (const l of native.pushListeners.values()) if (l.event === "pushNotificationReceived") l.callback({ title: "Navio", body: "", data });
    },
    // Simula tocar una notificación con la app abierta.
    tapPush(url) {
      for (const l of native.pushListeners.values()) if (l.event === "pushNotificationActionPerformed") l.callback({ notification: { data: { url } } });
    },
    fix(lat, lng, kmh = 60) {
      for (const watcher of watchers.values()) watcher.callback({ latitude: lat, longitude: lng, accuracy: 8, bearing: 90, speed: kmh / 3.6, time: Date.now() });
    },
  };
  window.__native = native;
  window.androidBridge = { postMessage() {} };
  window.Capacitor = {
    PluginHeaders: [
      { name: "BackgroundGeolocation", methods: [{ name: "addWatcher", rtype: "callback" }, { name: "removeWatcher", rtype: "promise" }, { name: "openSettings", rtype: "promise" }] },
      { name: "CapacitorHttp", methods: [{ name: "request", rtype: "promise" }] },
      {
        name: "PushNotifications",
        methods: ["checkPermissions", "requestPermissions", "register", "unregister", "removeAllListeners", "createChannel"].map((n) => ({ name: n, rtype: "promise" })).concat([{ name: "addListener", rtype: "callback" }, { name: "removeListener", rtype: "promise" }]),
      },
    ],
    nativeCallback(plugin, method, options, callback) {
      native.calls.push({ plugin, method, options });
      if (plugin === "PushNotifications") {
        const id = String(seq++);
        native.pushListeners.set(id, { event: options.eventName, callback });
        return id;
      }
      const id = String(seq++);
      if (native.denied) window.setTimeout(() => callback(null, { code: "NOT_AUTHORIZED" }), 10);
      else {
        watchers.set(id, { options, callback });
        // Un vigilante sin aviso fijo solo pregunta por el permiso: recibe una ubicación enseguida.
        if (!options.backgroundMessage) window.setTimeout(() => callback({ latitude: 18.14, longitude: -94.45, accuracy: 10, bearing: 0, speed: 0, time: Date.now() }), 20);
      }
      return id;
    },
    nativePromise(plugin, method, options) {
      native.calls.push({ plugin, method, options });
      if (plugin === "PushNotifications") {
        if (method === "checkPermissions") return Promise.resolve({ receive: native.pushPermission });
        if (method === "requestPermissions") {
          native.pushPermission = native.pushDeny ? "denied" : "granted";
          return Promise.resolve({ receive: native.pushPermission });
        }
        if (method === "createChannel") {
          if (!native.channels.some((c) => c.id === options.id)) native.channels.push(options);
          return Promise.resolve();
        }
        if (method === "register") {
          window.setTimeout(() => {
            for (const l of native.pushListeners.values()) if (l.event === "registration") l.callback({ value: "token-fcm-de-prueba-0123456789" });
          }, 30);
          return Promise.resolve();
        }
        if (method === "removeListener") native.pushListeners.delete(options.callbackId);
        return Promise.resolve();
      }
      if (plugin === "BackgroundGeolocation" && method === "removeWatcher") watchers.delete(options.id);
      if (plugin === "CapacitorHttp") {
        native.http.push(options);
        return window.__nativeHttp(options);
      }
      return Promise.resolve();
    },
  };
}
