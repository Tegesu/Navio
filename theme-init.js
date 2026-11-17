// Aplica el tema (claro u oscuro) antes de que cargue la app, para que la
// pantalla no parpadee en blanco. Lo elegido vive en este navegador:
// "light", "dark" o "system" (sigue al teléfono o a la computadora).
(function () {
  var choice = "system";
  try {
    choice = localStorage.getItem("navio.theme") || "system";
  } catch (e) {
    // Sin almacenamiento: se sigue al sistema.
  }
  var dark = choice === "dark" || (choice === "system" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  if (dark) document.documentElement.classList.add("dark");
})();
