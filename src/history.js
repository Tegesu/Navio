import { useEffect, useRef } from "react";

/* ---------------------------------------------------------------------- */
/*  Botón de regreso del teléfono (y del navegador)                       */
/* ---------------------------------------------------------------------- */
//
// Navio es una sola página: sin esto, "atrás" saca de la app. Cada cambio de
// pantalla deja una entrada en el historial del navegador y cada ventana o
// panel abierto (un formulario, una conversación) deja otra; "atrás" cierra
// lo último que se abrió o vuelve a la pantalla anterior. En la app de
// Android, el botón de regreso usa este mismo historial.

const layers = []; // ventanas abiertas, la última arriba
let onDeadEntry = false; // la entrada actual quedó de una ventana ya cerrada
let depth = 0; // entradas que agregó Navio en esta visita

const sameKey = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Mantiene el historial al día con la pantalla actual y la restaura al
// regresar. snapshot debe ser un objeto simple (se compara como texto).
export function useHistorySync(snapshot, restore) {
  const key = JSON.stringify(snapshot);
  const expected = useRef(null); // pantalla que se está restaurando
  const first = useRef(true);
  const current = useRef(snapshot);
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  current.current = snapshot;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (first.current) {
      first.current = false;
      window.history.replaceState({ ...(window.history.state ?? {}), navio: snapshot }, "");
      return;
    }
    if (expected.current === key) {
      expected.current = null;
      return;
    }
    window.history.pushState({ navio: snapshot }, "");
    depth += 1;
    onDeadEntry = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    const onPop = (event) => {
      depth = Math.max(0, depth - 1);
      const leavingDead = onDeadEntry;
      onDeadEntry = !!event.state?.navioDead;
      const target = event.state?.navio;
      if (!target) return;
      if (sameKey(target, current.current)) {
        // Se salió de una entrada que dejó una ventana cerrada con su botón:
        // ese "atrás" no cambió nada en pantalla, así que se da uno más.
        if (leavingDead && layers.length === 0) window.history.back();
        return;
      }
      expected.current = JSON.stringify(target);
      restoreRef.current(target);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
}

// Mientras `active` sea verdadero, "atrás" llama a onBack (cierra la ventana o
// el panel) en lugar de cambiar de pantalla.
export function useBackLayer(active, onBack) {
  const ref = useRef(onBack);
  ref.current = onBack;
  useEffect(() => {
    if (!active || typeof window === "undefined") return undefined;
    const token = {};
    layers.push(token);
    window.history.pushState({ ...(window.history.state ?? {}), navioLayer: true, navioDead: false }, "");
    depth += 1;
    onDeadEntry = false;
    let popped = false;
    const onPop = () => {
      if (layers[layers.length - 1] !== token) return;
      popped = true;
      layers.pop();
      ref.current?.();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      const index = layers.indexOf(token);
      if (index >= 0) layers.splice(index, 1);
      if (!popped && window.history.state?.navioLayer) {
        // Se cerró con su botón: la entrada se queda, marcada para saltarla.
        window.history.replaceState({ ...window.history.state, navioLayer: false, navioDead: true }, "");
        onDeadEntry = true;
      }
    };
  }, [active]);
}

// Flecha de regreso dentro de la app: igual que el botón del teléfono, salvo
// que no haya a dónde volver (por ejemplo, tras recargar la página).
export function goBack(fallback) {
  if (depth > 0) window.history.back();
  else fallback?.();
}
