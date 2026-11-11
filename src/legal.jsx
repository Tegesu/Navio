import { useEffect, useState } from "react";
import { Cookie, FileText, ShieldCheck } from "lucide-react";
import { supabase, useAuth, Modal } from "./NavioDashboard.jsx";

/* ---------------------------------------------------------------------- */
/*  Avisos legales                                                        */
/* ---------------------------------------------------------------------- */

// Al cambiar el contenido de los documentos, cambia también la versión: a
// cada persona se le pedirá aceptar de nuevo.
export const LEGAL_VERSION = "2026-11-11";

// Datos de quien opera Navio (el "responsable" ante la ley). Mientras falten,
// los documentos lo señalan en lugar de dejar un hueco.
export const LEGAL_ENTITY = {
  name: "", // nombre o razón social
  address: "", // domicilio para oír y recibir notificaciones
  email: "", // correo para privacidad y derechos ARCO
  city: "", // ciudad cuyos tribunales serán competentes
};

const PENDING = "[pendiente de completar]";
const entity = (key) => LEGAL_ENTITY[key] || PENDING;
export const legalEntityComplete = () => Object.values(LEGAL_ENTITY).every(Boolean);

const privacy = () => ({
  title: "Aviso de privacidad",
  intro:
    "Este aviso explica qué datos personales trata Navio, para qué y qué puedes hacer al respecto, conforme a la Ley Federal de Protección de Datos Personales en Posesión de los Particulares vigente en México.",
  sections: [
    {
      title: "1. Quién es responsable de tus datos",
      text: [
        `${entity("name")}, con domicilio en ${entity("address")}, es responsable del tratamiento de los datos de tu cuenta de Navio. Para cualquier tema de privacidad escribe a ${entity("email")}.`,
        "Navio tiene dos papeles distintos. Por los datos de tu cuenta, Navio es el responsable. Por la información que cada empresa cliente carga para operar (sus unidades, choferes, facturas, traslados y mensajes), la responsable es esa empresa y Navio actúa como su encargado: la trata únicamente para prestarle el servicio y conforme a sus instrucciones.",
      ],
    },
    {
      title: "2. Qué datos se tratan",
      list: [
        "De tu cuenta: nombre, correo electrónico y, si los registras, teléfono y puesto. Tu contraseña la resguarda cifrada el proveedor de autenticación; Navio no puede verla.",
        "De la empresa: nombre comercial, razón social, RFC, domicilio y datos de contacto.",
        "De la operación que la empresa registra: unidades, choferes (nombre, teléfono, licencia y su vigencia), traslados, incidencias, garantías, facturas con sus datos fiscales (emisor, receptor, RFC, importes y folio fiscal), los documentos adjuntos, tareas y mensajes internos.",
        "De ubicación: la ubicación del dispositivo de quien maneja, únicamente mientras tiene un viaje activo, es decir, desde que lo inicia hasta que lo finaliza. Fuera de un viaje no se registra ubicación.",
        "Técnicos y de seguridad: fecha y hora de las acciones importantes, quién las hizo y el tipo de navegador al aceptar estos documentos.",
      ],
      text: ["Navio no solicita datos personales sensibles. Te pedimos no cargar documentos que los contengan si no son necesarios para tu operación."],
    },
    {
      title: "3. Para qué se usan",
      list: [
        "Crear y administrar tu cuenta y la de tu empresa.",
        "Prestar el servicio: control de flota, facturas y gastos, traslados, mapa en vivo, mensajes, alertas y tareas.",
        "Leer automáticamente los documentos que se envían para registrarlos.",
        "Proteger la información: control de acceso por empresa, bitácora de actividad y prevención de usos indebidos.",
        "Atender tus solicitudes y dar soporte.",
        "Cumplir obligaciones legales.",
      ],
      text: [
        "De forma secundaria, Navio puede elaborar estadísticas agregadas, que no identifican a nadie, para mejorar el servicio, y avisarte de novedades de la plataforma. Si no quieres que tus datos se usen para estas finalidades secundarias, escribe al correo de contacto; negarte no afecta tu uso del servicio.",
      ],
    },
    {
      title: "4. Lectura automática con inteligencia artificial",
      text: [
        "Los documentos que se envían al bot de Telegram se procesan con un servicio de inteligencia artificial (Google Gemini) para extraer sus datos. El resultado se registra como pendiente y una persona de tu empresa debe verificarlo antes de darlo por bueno. Navio no toma con estos datos decisiones automatizadas que produzcan efectos jurídicos sobre las personas.",
      ],
    },
    {
      title: "5. Con quién se comparten",
      text: ["Navio no vende datos personales. Para funcionar se apoya en proveedores que tratan los datos por su cuenta y bajo sus instrucciones:"],
      list: [
        "Supabase: base de datos, inicio de sesión y almacenamiento de archivos.",
        "Vercel: alojamiento del sitio web.",
        "Google: lectura automática de documentos (Gemini).",
        "Telegram: solo si tu empresa usa el bot para enviar documentos.",
        "OpenStreetMap: imágenes del mapa. Al abrir un mapa, tu navegador les pide las imágenes de la zona que estás viendo, por lo que reciben tu dirección IP.",
      ],
      after: [
        "Algunos de estos proveedores están fuera de México, por lo que tus datos pueden tratarse en otros países con medidas de seguridad equivalentes. Fuera de estos casos, los datos solo se entregan a una autoridad competente cuando la ley lo exige.",
      ],
    },
    {
      title: "6. Tus derechos (ARCO) y cómo ejercerlos",
      text: [
        "Puedes acceder a tus datos, rectificarlos si son inexactos, cancelarlos cuando consideres que no se requieren y oponerte a que se usen para fines específicos. También puedes revocar tu consentimiento.",
        `Para hacerlo, presenta tu solicitud desde Cuenta → Privacidad dentro de Navio, o escribe a ${entity("email")} indicando tu nombre, un medio para responderte, un documento que acredite tu identidad y la descripción clara de lo que solicitas.`,
        "Recibirás respuesta en un máximo de 20 días hábiles y, si procede, se hará efectiva dentro de los 15 días hábiles siguientes. Si tu solicitud se refiere a información que cargó tu empresa (por ejemplo, tu registro como chofer), se le turnará a ella, que es quien decide sobre esos datos.",
        "Si consideras que tu derecho no fue atendido, puedes acudir a la Secretaría Anticorrupción y Buen Gobierno, que es la autoridad en materia de protección de datos personales.",
      ],
    },
    {
      title: "7. Cómo limitar el uso de tus datos",
      list: [
        "La ubicación solo se comparte durante un viaje: no inicies un viaje, o finalízalo, para dejar de compartirla. También puedes retirar el permiso de ubicación en tu navegador.",
        "Puedes pedir que no se te envíen avisos de novedades escribiendo al correo de contacto.",
      ],
    },
    {
      title: "8. Cuánto tiempo se conservan",
      text: [
        "Los datos se conservan mientras la cuenta esté activa y por el tiempo necesario para cumplir obligaciones legales. Después se eliminan o se vuelven anónimos. Las facturas no se borran desde la plataforma, se anulan, para conservar el rastro de lo ocurrido; su eliminación definitiva puede solicitarla el administrador de la empresa.",
      ],
    },
    {
      title: "9. Cómo se protegen",
      text: [
        "La información viaja cifrada, cada empresa solo puede ver sus propios datos, existe verificación en dos pasos opcional y se lleva una bitácora de las acciones importantes. Ningún sistema es infalible: si ocurriera una vulneración que afecte de forma significativa tus derechos, se te informará para que puedas tomar medidas.",
      ],
    },
    {
      title: "10. Cookies y almacenamiento en tu dispositivo",
      text: ["Navio no usa cookies de publicidad ni de seguimiento. El detalle está en la Política de cookies."],
    },
    {
      title: "11. Cambios a este aviso",
      text: ["Los cambios se publican en esta misma página con su fecha. Si son importantes, se te pedirá aceptarlo de nuevo al entrar."],
    },
  ],
});

const terms = () => ({
  title: "Términos y condiciones de uso",
  intro: `Estos términos regulan el uso de Navio, operado por ${entity("name")}. Al crear una cuenta o usar la plataforma los aceptas.`,
  sections: [
    {
      title: "1. Qué es Navio",
      text: [
        "Navio es una plataforma para que las empresas administren su flotilla: unidades, facturas y gastos, traslados con seguimiento en mapa, mantenimiento, trámites, mensajes internos, alertas y tareas.",
      ],
    },
    {
      title: "2. Tu cuenta",
      list: [
        "Debes ser mayor de edad y dar información verdadera.",
        "La cuenta es personal: no la compartas. Eres responsable de lo que se haga con tu contraseña; activa la verificación en dos pasos.",
        "Avisa de inmediato si crees que alguien más entró a tu cuenta.",
      ],
    },
    {
      title: "3. Empresas, administradores y usuarios",
      text: [
        "Cada empresa tiene uno o más administradores, que deciden quién entra, con qué rol y a quién se da de baja. La empresa responde por el uso que sus usuarios hagan de la plataforma.",
        "La empresa es responsable de contar con el derecho o el consentimiento necesarios para cargar los datos de terceros (por ejemplo, de sus choferes o de quienes aparecen en sus facturas) y de informar a su personal cuando use el seguimiento de ubicación durante los viajes.",
      ],
    },
    {
      title: "4. Uso permitido",
      text: ["No está permitido:"],
      list: [
        "Intentar acceder a información de otra empresa o de otra persona.",
        "Vulnerar, sobrecargar o probar la seguridad de la plataforma sin autorización escrita.",
        "Cargar contenido ilícito, engañoso o con programas dañinos.",
        "Extraer información de forma masiva o automatizada fuera de las funciones de exportación.",
        "Usar el seguimiento de ubicación para vigilar a una persona sin su conocimiento.",
      ],
    },
    {
      title: "5. Tu información",
      text: [
        "La información que tu empresa carga es de tu empresa. Navio la usa solo para prestar el servicio. Puedes exportarla en cualquier momento con las funciones de Excel y reportes.",
      ],
    },
    {
      title: "6. Lectura automática e inteligencia artificial",
      list: [
        "Los datos que la plataforma lee de un documento con inteligencia artificial pueden contener errores. Por eso quedan como pendientes: revísalos contra el documento antes de verificarlos o aprobarlos.",
        "Navio no valida los comprobantes ante el SAT ni sustituye a tu contador o asesor fiscal.",
        "Parte de esta plataforma se desarrolló con asistencia de herramientas de inteligencia artificial, bajo revisión y pruebas de personas. Como cualquier programa, puede tener fallas; si encuentras una, repórtala desde Comunidad.",
      ],
    },
    {
      title: "7. Mapa y ubicación",
      text: [
        "La ubicación depende del dispositivo, de sus permisos y de la señal, por lo que puede ser imprecisa o interrumpirse. Navio no es un sistema de seguridad, de emergencias ni de recuperación de vehículos.",
      ],
    },
    {
      title: "8. Disponibilidad",
      text: [
        "Se busca que la plataforma esté disponible de forma continua, pero puede interrumpirse por mantenimiento o por causas ajenas. El servicio se ofrece tal como está. Te recomendamos exportar periódicamente la información que sea crítica para ti.",
      ],
    },
    {
      title: "9. Propiedad intelectual",
      text: ["El programa, su diseño y la marca Navio pertenecen a quien lo opera. Estos términos no te transfieren derechos sobre ellos, solo el permiso de usarlos mientras tu cuenta esté activa."],
    },
    {
      title: "10. Responsabilidad",
      text: [
        "En la medida en que la ley lo permite, quien opera Navio no responde por daños indirectos, pérdida de ganancias ni por decisiones tomadas con información que no fue verificada por el usuario. Nada de lo anterior limita los derechos que la ley te reconoce y que no pueden renunciarse.",
      ],
    },
    {
      title: "11. Suspensión y baja",
      text: [
        "Una cuenta o una empresa puede suspenderse si incumple estos términos o pone en riesgo a otros usuarios. Puedes pedir la baja de tu cuenta, y el administrador de la empresa puede pedir la eliminación de la información de su empresa, escribiendo al correo de contacto.",
      ],
    },
    {
      title: "12. Condiciones comerciales",
      text: ["Los precios, plazos y formas de pago, cuando apliquen, se acuerdan por separado con cada empresa."],
    },
    {
      title: "13. Cambios a estos términos",
      text: ["Pueden actualizarse. La versión vigente siempre está en esta página con su fecha, y si el cambio es importante se te pedirá aceptarla de nuevo."],
    },
    {
      title: "14. Ley aplicable",
      text: [
        `Estos términos se rigen por las leyes de México. Para cualquier controversia, las partes se someten a los tribunales competentes de ${entity("city")}, sin perjuicio de los derechos que la ley otorga a los consumidores, quienes pueden acudir a la Procuraduría Federal del Consumidor.`,
      ],
    },
    {
      title: "15. Contacto",
      text: [`${entity("name")} · ${entity("address")} · ${entity("email")}`],
    },
  ],
});

const cookies = () => ({
  title: "Política de cookies",
  intro:
    "Navio no usa cookies de publicidad ni de seguimiento, y no comparte tu navegación con redes publicitarias. Para funcionar guarda en tu propio navegador solo lo indispensable:",
  sections: [
    {
      title: "Qué se guarda en tu dispositivo",
      list: [
        "Sesión (necesario): la llave que te mantiene con la sesión iniciada. Sin ella no es posible entrar. Se borra al cerrar sesión.",
        "Preferencias (funcional): formato de fecha, columnas y contadores que elegiste, tu último reporte y los datos que excluyes del Excel. Nunca salen de tu dispositivo.",
        "Dónde te quedaste (funcional): la pantalla abierta, para regresar a ella si la pestaña se recarga. Se borra al cerrar la pestaña.",
        "Viaje en curso (necesario durante un viaje): los puntos de ubicación que todavía no se envían por falta de señal. Se borran al enviarse o al finalizar el viaje.",
        "Este aviso (funcional): que ya lo viste, para no mostrarlo de nuevo.",
      ],
    },
    {
      title: "Servicios de terceros",
      text: [
        "Al abrir un mapa, tu navegador descarga las imágenes de OpenStreetMap, que recibe tu dirección IP. No se cargan herramientas de analítica ni de publicidad de terceros.",
      ],
    },
    {
      title: "Cómo borrarlo",
      text: [
        "Puedes borrar estos datos desde la configuración de tu navegador (datos del sitio). Si bloqueas el almacenamiento del sitio no podrás iniciar sesión, porque la sesión no tendría dónde guardarse.",
      ],
    },
  ],
});

export const LEGAL_DOCS = {
  privacy: { label: "Aviso de privacidad", icon: ShieldCheck, build: privacy },
  terms: { label: "Términos y condiciones", icon: FileText, build: terms },
  cookies: { label: "Política de cookies", icon: Cookie, build: cookies },
};

export function LegalDocument({ doc }) {
  const content = LEGAL_DOCS[doc].build();
  return (
    <article className="space-y-4 text-xs leading-relaxed text-slate-600">
      {!legalEntityComplete() && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-800">
          Borrador: faltan los datos de quien opera Navio (nombre o razón social, domicilio, correo de contacto y ciudad). Debe revisarlo un abogado antes de
          considerarse definitivo.
        </p>
      )}
      <p>{content.intro}</p>
      {content.sections.map((section) => (
        <section key={section.title} className="space-y-1.5">
          <h4 className="text-xs font-bold text-slate-800">{section.title}</h4>
          {section.text?.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          {section.list && (
            <ul className="list-disc space-y-1 pl-4">
              {section.list.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          {section.after?.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </section>
      ))}
      <p className="text-[11px] text-slate-400">Última actualización: {LEGAL_VERSION.split("-").reverse().join("/")}.</p>
    </article>
  );
}

export function LegalModal({ doc, onClose }) {
  return (
    <Modal title={LEGAL_DOCS[doc].build().title} width="max-w-2xl" onClose={onClose}>
      <div className="max-h-[70vh] overflow-y-auto pr-2">
        <LegalDocument doc={doc} />
      </div>
      <button onClick={onClose} className="mt-4 w-full rounded-lg bg-blue-600 py-2 text-xs font-semibold text-white hover:bg-blue-700">
        Cerrar
      </button>
    </Modal>
  );
}

// Enlaces a los tres documentos; abren el texto sin salir de la pantalla.
export function LegalLinks({ className = "" }) {
  const [open, setOpen] = useState(null);
  return (
    <>
      <p className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400 ${className}`}>
        {Object.entries(LEGAL_DOCS).map(([id, doc]) => (
          <button key={id} type="button" onClick={() => setOpen(id)} className="font-medium underline-offset-2 hover:text-blue-600 hover:underline">
            {doc.label}
          </button>
        ))}
      </p>
      {open && <LegalModal doc={open} onClose={() => setOpen(null)} />}
    </>
  );
}

const COOKIE_KEY = "navio.cookieNotice.v1";

// Navio solo guarda lo indispensable, así que basta con informarlo.
export function CookieNotice({ inline = false }) {
  const [visible, setVisible] = useState(() => {
    try {
      return !window.localStorage.getItem(COOKIE_KEY);
    } catch {
      return false;
    }
  });
  const [open, setOpen] = useState(false);
  if (!visible) return null;

  function accept() {
    try {
      window.localStorage.setItem(COOKIE_KEY, new Date().toISOString());
    } catch {
      // Sin almacenamiento: el aviso vuelve a salir la próxima vez.
    }
    setVisible(false);
  }

  return (
    <>
      <div
        role="region"
        aria-label="Aviso de cookies"
        className={
          inline
            ? "mb-3 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3"
            : "fixed inset-x-3 bottom-3 z-[60] mx-auto flex max-w-2xl flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-xl print:hidden sm:flex-nowrap"
        }
      >
        {!inline && <Cookie size={18} className="hidden shrink-0 text-blue-600 sm:block" />}
        <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-slate-600">
          Navio guarda en tu navegador solo lo necesario para mantener tu sesión y tus preferencias. No usa cookies de publicidad ni de seguimiento.{" "}
          <button onClick={() => setOpen(true)} className="font-semibold text-blue-600 hover:underline">
            Ver detalles
          </button>
        </p>
        <button onClick={accept} className="shrink-0 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700">
          Entendido
        </button>
      </div>
      {open && <LegalModal doc="cookies" onClose={() => setOpen(false)} />}
    </>
  );
}

// Ya dentro de la app: si la persona no ha aceptado la versión vigente de los
// términos y del aviso de privacidad, se le pide antes de continuar. Queda
// registrado qué versión aceptó y cuándo.
export function LegalAcceptanceGate() {
  const { user, signOut } = useAuth();
  const [missing, setMissing] = useState(null); // null = revisando; [] = todo aceptado
  const [checked, setChecked] = useState(false);
  const [open, setOpen] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const userId = user?.id;
  const acceptedAtSignUp = user?.user_metadata?.legal_version === LEGAL_VERSION;

  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    supabase
      .from("legal_acceptances")
      .select("document")
      .eq("userId", userId)
      .eq("version", LEGAL_VERSION)
      .then(({ data, error: queryError }) => {
        if (cancelled) return;
        // Si la tabla aún no existe (falta la migración), no se bloquea a nadie.
        if (queryError) return setMissing([]);
        const pending = ["terms", "privacy"].filter((doc) => !data.some((row) => row.document === doc));
        // Quien los aceptó al crear su cuenta no tiene que aceptarlos otra
        // vez: solo se deja el registro.
        if (pending.length > 0 && acceptedAtSignUp) {
          supabase
            .from("legal_acceptances")
            .insert(pending.map((document) => ({ document, version: LEGAL_VERSION, userAgent: navigator.userAgent })))
            .then(({ error: saveError }) => !cancelled && setMissing(saveError ? pending : []));
          return undefined;
        }
        return setMissing(pending);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, acceptedAtSignUp]);

  if (!missing || missing.length === 0) return null;

  async function accept() {
    setSaving(true);
    setError("");
    const { error: saveError } = await supabase
      .from("legal_acceptances")
      .insert(missing.map((document) => ({ document, version: LEGAL_VERSION, userAgent: navigator.userAgent })));
    setSaving(false);
    if (saveError && !/duplicate/i.test(saveError.message)) setError("No se pudo guardar tu aceptación. Revisa tu conexión e inténtalo de nuevo.");
    else setMissing([]);
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 px-4">
      <div role="dialog" aria-modal="true" aria-label="Términos y aviso de privacidad" className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
        <h3 className="text-sm font-bold text-slate-800">Antes de continuar</h3>
        <p className="mt-2 text-xs leading-relaxed text-slate-600">
          Para usar Navio necesitas aceptar los documentos que explican las reglas de uso y cómo se cuidan tus datos, incluida la lectura automática de
          facturas y el registro de ubicación durante los viajes.
        </p>
        <div className="mt-3 space-y-1.5">
          {["terms", "privacy"].map((id) => (
            <button
              key={id}
              onClick={() => setOpen(id)}
              className="flex w-full items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              {LEGAL_DOCS[id].label}
              <span className="text-[11px] font-medium text-blue-600">Leer</span>
            </button>
          ))}
        </div>
        <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600" />
          Leí y acepto los Términos y condiciones y el Aviso de privacidad.
        </label>
        {error && <p className="mt-2 rounded-lg bg-rose-50 px-2.5 py-2 text-[11px] font-medium text-rose-700">{error}</p>}
        <div className="mt-4 flex justify-between gap-2">
          <button onClick={signOut} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100">
            Cerrar sesión
          </button>
          <button onClick={accept} disabled={!checked || saving} className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? "Guardando…" : "Aceptar y continuar"}
          </button>
        </div>
      </div>
      {open && <LegalModal doc={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
