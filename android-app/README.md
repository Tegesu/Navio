# App Navio para Android

Es el mismo Navio del sitio web, dentro de una app. Lo único que agrega es un
servicio del teléfono que sigue leyendo el GPS durante un viaje aunque la
pantalla esté apagada o haya otra app abierta (un navegador no puede hacerlo).

- La app abre `https://navio-fyj2.vercel.app` (ver `capacitor.config.json`):
  los cambios del sitio llegan solos, sin instalar una app nueva.
- La parte de Navio que habla con el servicio está en `src/tracking.jsx`
  (busca `isNativeApp`).
- Se compila sola en GitHub (`.github/workflows/android-app.yml`) cada vez que
  cambia algo en esta carpeta. El resultado se descarga de
  `https://github.com/Tegesu/Navio/releases/latest/download/navio.apk`.

## Qué hay aquí

- `capacitor.config.json`: nombre de la app, dirección del sitio y ajustes.
- `android/`: el proyecto de Android (ícono, permisos, texto del aviso fijo).
- `www/`: página de relleno; la app carga el sitio real.

## Llave de firma

Para que una versión nueva se instale encima de la anterior, la app debe ir
firmada siempre con la misma llave. Se configura en GitHub → Settings →
Secrets and variables → Actions, con dos secretos:

- `NAVIO_KEYSTORE_BASE64`: el archivo de la llave, convertido a texto.
- `NAVIO_KEYSTORE_PASSWORD`: su contraseña.

Sin esos secretos se compila una versión de prueba que funciona igual, pero
que hay que desinstalar antes de instalar otra.
