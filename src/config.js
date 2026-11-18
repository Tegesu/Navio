// Ajustes públicos de Navio (nada de aquí es secreto: termina en la página).

// Protección contra bots al iniciar sesión, crear cuenta y recuperar la
// contraseña (Cloudflare Turnstile). Vacío = desactivada.
//
// Para activarla:
//   1. En dash.cloudflare.com → Turnstile, crea un sitio para el dominio de
//      Navio. Te da una "Site Key" (pública) y una "Secret Key" (secreta).
//   2. Pega la Site Key aquí abajo.
//   3. En Supabase → Authentication → Attack Protection, activa "Enable
//      Captcha protection", elige Turnstile y pega la Secret Key.
// Las dos cosas van juntas: con solo una, nadie podrá entrar.
export const CAPTCHA_SITE_KEY = "0x4AAAAAAGBuPt13hXJQVLnz";

// Mapas, rutas y tráfico en vivo (TomTom). Vacío = mapa de OpenStreetMap sin
// rutas ni tráfico.
//
// Para activarlo:
//   1. Crea una cuenta en developer.tomtom.com y, en "Keys", una llave nueva.
//   2. En la llave, limita su uso al dominio de Navio (navio-fyj2.vercel.app)
//      si el portal lo permite, y activa un aviso de consumo.
//   3. Pega la llave aquí abajo. Es pública por naturaleza (la ve el
//      navegador), no es una contraseña.
export const TOMTOM_KEY = "7L2WxUWmAj04PAArzB9kXpZz58cSdxQB";
