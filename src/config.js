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
