// Navio — Telegram webhook (ingesta de facturas/documentos por chat)
//
// Recibe los updates de Telegram, vincula chats a empresas con el
// comando /vincular, y usa Gemini (vision, nivel gratuito) para
// interpretar fotos o documentos de facturas/servicios y
// registrarlos en la tabla correcta (fuel_records / travel_expenses /
// maintenance_records / compliance_records) de la empresa dueña de
// ese chat, con sus datos fiscales en la columna "cfdi". Corre con la
// llave de servicio, así que ignora RLS por
// diseño — la empresa correcta se determina SIEMPRE a partir de
// "botChatId", nunca de un dato que mande el propio mensaje.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;

// Modelos a intentar, en orden, hasta que uno responda. Flash lee mejor
// las fotos difíciles, pero por defecto "piensa" y puede tardar más de un
// minuto, así que se le pide pensar poco. Flash-Lite casi no piensa: es el
// respaldo rápido, y cada modelo tiene su propia cuota gratuita. Los
// tiempos suman 110 s para alcanzar a contestar antes de que Supabase
// corte la función (150 s en el plan gratuito).
const GEMINI_ATTEMPTS = [
  { model: "gemini-flash-latest", timeoutMs: 50_000, extraConfig: { thinkingConfig: { thinkingLevel: "low" } } },
  { model: "gemini-3.5-flash-lite", timeoutMs: 40_000, extraConfig: {} },
  { model: "gemini-3.1-flash-lite", timeoutMs: 20_000, extraConfig: {} },
];

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const TABLE_MAP: Record<string, string> = {
  fuel: "fuel_records",
  maintenance: "maintenance_records",
  compliance: "compliance_records",
  travel: "travel_expenses",
};

const MODULE_LABEL: Record<string, string> = {
  fuel: "Combustible",
  maintenance: "Mantenimiento",
  compliance: "Trámites",
  travel: "Viáticos",
};

const FIELD_MAP: Record<string, string[]> = {
  fuel: ["unit", "plate", "station", "liters", "amount", "odometer", "efficiency", "date", "vendor", "invoiceFolio", "notes", "project", "workOrder"],
  maintenance: ["unit", "plate", "category", "concept", "amount", "date", "vendor", "invoiceFolio", "notes"],
  compliance: ["unit", "plate", "docType", "concept", "amount", "date", "dueDate", "paymentStatus", "vendor", "invoiceFolio", "notes"],
  travel: ["unit", "plate", "driverName", "concept", "amount", "date", "vendor", "invoiceFolio", "notes", "expenseType", "project", "workOrder"],
};

// Las tablas de "Facturas y Gastos" (migración v11) guardan concepto,
// proyecto, orden de trabajo y quién subió la factura. Mantenimiento y
// Trámites no tienen esas columnas.
const INVOICE_MODULES = ["fuel", "travel"];
const TRAVEL_EXPENSE_TYPES = ["viaticos", "hotel", "alimentos", "transporte", "otro"];

function today() {
  return new Date().toISOString().slice(0, 10);
}

const CFDI_NUMERIC_KEYS = new Set([
  "subtotal", "descuento", "iva", "ieps", "ish", "otrosImpuestos", "retencionIVA", "retencionISR", "propina", "total",
  "tipoCambio", "cantidad", "valorUnitario", "importe", "tasa", "base",
]);

function toNumber(value: unknown): unknown {
  if (typeof value === "number") return value;
  const n = Number(String(value).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : value;
}

// Quita lo vacío para no guardar decenas de campos en null, y convierte a
// número los importes aunque el modelo los mande como "1,240.00".
function cleanCfdiValue(value: unknown, key = ""): unknown {
  if (value === null || value === undefined || value === "") return undefined;
  if (Array.isArray(value)) {
    const items = value.map((v) => cleanCfdiValue(v)).filter((v) => v !== undefined);
    return items.length ? items : undefined;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const cleaned = cleanCfdiValue(v, k);
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return CFDI_NUMERIC_KEYS.has(key) ? toNumber(value) : value;
}

function normalizeCfdi(raw: unknown): any {
  const cfdi: any = cleanCfdiValue(raw);
  if (!cfdi || typeof cfdi !== "object" || Array.isArray(cfdi)) return null;
  if (typeof cfdi.uuid === "string") cfdi.uuid = cfdi.uuid.trim().toUpperCase();
  for (const party of [cfdi.emisor, cfdi.receptor]) {
    if (typeof party?.rfc === "string") party.rfc = party.rfc.trim().toUpperCase();
  }
  return cfdi;
}

function buildRecord(extracted: any, module: string, cfdi: any): Record<string, unknown> | null {
  const raw = extracted?.record || {};
  const picked: Record<string, unknown> = {};
  for (const key of FIELD_MAP[module] ?? []) {
    if (raw[key] !== undefined && raw[key] !== null && raw[key] !== "") picked[key] = raw[key];
  }
  // Lo que el modelo no dejó en "record" se toma del CFDI.
  const fromCfdi: Record<string, unknown> = {
    amount: cfdi?.importes?.total,
    date: typeof cfdi?.fechaEmision === "string" ? cfdi.fechaEmision.slice(0, 10) : undefined,
    vendor: cfdi?.emisor?.nombre,
    invoiceFolio: [cfdi?.serie, cfdi?.folio].filter(Boolean).join("-") || undefined,
    concept: cfdi?.conceptos?.[0]?.descripcion,
    liters: cfdi?.conceptos?.[0]?.cantidad,
  };
  for (const [key, value] of Object.entries(fromCfdi)) {
    if (FIELD_MAP[module]?.includes(key) && picked[key] === undefined && value !== undefined) picked[key] = value;
  }
  if (picked.amount !== undefined) picked.amount = toNumber(picked.amount);
  if (picked.liters !== undefined) picked.liters = toNumber(picked.liters);

  // "travel" no está ligado a una unidad — un hospedaje puede no mencionar ninguna.
  if (module !== "travel") picked.unit = picked.unit || "Sin identificar";
  picked.date = picked.date || today();
  if (module === "fuel") picked.expenseType = "gasolina";
  if (module === "travel" && !TRAVEL_EXPENSE_TYPES.includes(picked.expenseType as string)) picked.expenseType = "viaticos";

  if (module === "maintenance" && (!picked.category || !picked.concept)) return null;
  if (module === "compliance" && (!picked.docType || !picked.concept)) return null;
  if (module === "travel" && !picked.concept) return null;
  return picked;
}

// Resumen de lo que se leyó de la factura, para la respuesta en Telegram.
function cfdiSummaryLines(cfdi: any): string[] {
  if (!cfdi) return [];
  const party = (label: string, p: any) => {
    const text = [p?.nombre, p?.rfc ? `(${p.rfc})` : null].filter(Boolean).join(" ");
    return text ? `${label}: ${text}` : null;
  };
  const i = cfdi.importes ?? {};
  const amounts = ([["Subtotal", i.subtotal], ["IVA", i.iva], ["IEPS", i.ieps], ["ISH", i.ish], ["Total", i.total]] as [string, unknown][])
    .filter(([, value]) => value !== undefined)
    .map(([label, value]) => `${label} $${value}`);
  const concepts = (cfdi.conceptos ?? []).map((c: any) => c.descripcion).filter(Boolean);
  return [
    party("Emisor", cfdi.emisor),
    party("Receptor", cfdi.receptor),
    cfdi.uuid ? `UUID: ${cfdi.uuid}` : null,
    amounts.length ? amounts.join(" · ") : null,
    concepts.length ? `Conceptos: ${concepts.slice(0, 3).join(", ")}${concepts.length > 3 ? ` y ${concepts.length - 3} más` : ""}` : null,
  ].filter(Boolean) as string[];
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function uploadDocument(companyId: number, module: string, file: { base64: string; mimeType: string }): Promise<string | null> {
  const ext = file.mimeType === "application/pdf" ? "pdf" : file.mimeType === "image/png" ? "png" : "jpg";
  const path = `${companyId}/${module}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("documents").upload(path, base64ToBytes(file.base64), {
    contentType: file.mimeType,
    upsert: false,
  });
  if (error) {
    console.error("Error al subir documento a Storage", error.message);
    return null;
  }
  return path;
}

async function sendMessage(chatId: string, text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

async function fetchTelegramFileBase64(fileId: string): Promise<{ base64: string; mimeType: string } | null> {
  const infoRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`);
  const info = await infoRes.json();
  const filePath = info?.result?.file_path;
  if (!filePath) {
    console.error("Telegram getFile sin file_path", JSON.stringify(info));
    return null;
  }

  const fileRes = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`);
  const buf = new Uint8Array(await fileRes.arrayBuffer());
  let binary = "";
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
  const base64 = btoa(binary);
  const ext = filePath.split(".").pop()?.toLowerCase();
  const mimeType = ext === "png" ? "image/png" : ext === "pdf" ? "application/pdf" : "image/jpeg";
  return { base64, mimeType };
}

const EXTRACTION_PROMPT = `Lee TODO este documento/factura (normalmente un CFDI mexicano) relacionado con una flotilla vehicular o el viaje de un conductor, y extrae toda la información importante. Responde ÚNICAMENTE con JSON válido, sin texto adicional ni explicaciones, exactamente con esta forma:
{
  "module": "fuel" | "maintenance" | "compliance" | "travel" | "unknown",
  "record": {
    "unit": string | null,
    "plate": string | null,
    "driverName": string | null,
    "amount": number | null,
    "date": "YYYY-MM-DD" | null,
    "vendor": string | null,
    "invoiceFolio": string | null,
    "station": string | null,
    "liters": number | null,
    "category": "engine" | "brakes" | "tires" | "paperwork" | null,
    "concept": string | null,
    "docType": "Tenencia" | "Póliza de Seguro" | "Verificación Vehicular" | "Licencia de Conducir" | "Tarjeta de Circulación" | null,
    "dueDate": "YYYY-MM-DD" | null,
    "paymentStatus": "Pagado" | "Pendiente de Pago" | null,
    "expenseType": "viaticos" | "hotel" | "alimentos" | "transporte" | "otro" | null,
    "project": string | null,
    "workOrder": string | null
  },
  "cfdi": {
    "uuid": string | null,
    "serie": string | null,
    "folio": string | null,
    "tipoComprobante": "I" | "E" | "T" | "P" | "N" | null,
    "fechaEmision": "YYYY-MM-DDTHH:mm:ss" | null,
    "fechaCertificacion": "YYYY-MM-DDTHH:mm:ss" | null,
    "certificadoEmisor": string | null,
    "certificadoSAT": string | null,
    "lugarExpedicion": string | null,
    "exportacion": string | null,
    "metodoPago": string | null,
    "formaPago": string | null,
    "moneda": string | null,
    "tipoCambio": number | null,
    "emisor": { "nombre": string | null, "nombreComercial": string | null, "rfc": string | null, "regimenFiscal": string | null, "domicilio": string | null },
    "receptor": { "nombre": string | null, "rfc": string | null, "usoCFDI": string | null, "regimenFiscal": string | null, "domicilioFiscal": string | null },
    "importes": { "subtotal": number | null, "descuento": number | null, "iva": number | null, "ieps": number | null, "ish": number | null, "otrosImpuestos": number | null, "retencionIVA": number | null, "retencionISR": number | null, "propina": number | null, "total": number | null, "totalConLetra": string | null },
    "conceptos": [
      { "cantidad": number | null, "unidad": string | null, "claveProdServ": string | null, "descripcion": string | null, "valorUnitario": number | null, "descuento": number | null, "importe": number | null, "objetoImpuesto": string | null,
        "impuestos": [ { "tipo": string | null, "tasa": number | null, "base": number | null, "importe": number | null } ] }
    ],
    "otros": [ { "campo": string, "valor": string } ]
  }
}
Clasificación ("module"): usa "fuel" para tickets/facturas de gasolina o diésel. "maintenance" para servicios, refacciones o mantenimiento del vehículo. "compliance" para tenencias, pólizas, verificaciones, licencias o tarjetas de circulación. Usa "travel" para gastos generales del viaje de un conductor que NO son de la unidad en sí — hospedaje/hotel, alimentos, viáticos, casetas sueltas sin factura de combustible. Si no puedes identificar de qué se trata, usa "unknown".
Campos de "record": "amount" es el total a pagar. "date" es la fecha de emisión. "vendor" es el nombre o razón social de quien emite. "invoiceFolio" es la serie y folio interno de la factura (no el UUID). "concept" es la descripción principal de lo que se factura. "unit"/"plate" son la unidad o placa del vehículo si el documento lo menciona (en "travel" casi nunca aplica, déjalo en null si no aparece). "driverName" es el nombre del huésped/conductor si el documento lo menciona (común en facturas de hotel). "liters" son los litros cargados. "expenseType" solo aplica a "travel": "hotel" para hospedaje, "alimentos" para comida, "transporte" para taxis, autobuses, vuelos o casetas, "viaticos" para viáticos generales y "otro" si no encaja en ninguno. "project" y "workOrder" son el proyecto y la orden de trabajo (por ejemplo "OT24053"), solo si el documento o el texto que lo acompaña los menciona; si no, déjalos en null.
Campos de "cfdi": "uuid" es el folio fiscal. El emisor es quien vende y el receptor es a quien se le factura; no los confundas. Copia las claves del SAT tal como aparecen, sin traducirlas (por ejemplo "G03", "601", "PUE", "28", "E48", "90111800"). "ish" es el impuesto sobre hospedaje. Si hay un impuesto que no tenga campo propio, súmalo en "otrosImpuestos". Pon una entrada en "conceptos" por cada partida de la factura. En "otros" pon cualquier otro dato útil que aparezca y no tenga campo propio, con un nombre legible en "campo": huésped, fechas de estancia, habitación, reservación, cajero, referencia, agencia, tipo de combustible, bomba, placas, kilometraje, vigencia, teléfono, etc.
Reglas: nunca inventes datos; si algo no aparece, usa null (o una lista vacía). Los montos van como número, sin comas ni signo de pesos. NO incluyas sellos digitales, cadena original, código QR ni textos legales. Si el documento no es un CFDI (por ejemplo un ticket), llena en "cfdi" lo que sí aparezca.`;

type GeminiAttempt = (typeof GEMINI_ATTEMPTS)[number];
type GeminiFailure = "quota" | "overload" | "timeout" | "other";

async function callGeminiOnce(
  parts: unknown[],
  attempt: GeminiAttempt
): Promise<{ ok: true; data: any } | { ok: false; failure: GeminiFailure; detail: string }> {
  const startedAt = Date.now();
  let res: Response;
  let data: any;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${attempt.model}:generateContent`, {
      method: "POST",
      // La llave va en el encabezado, no en la URL: un error de conexión
      // incluye la URL en su mensaje y la dejaría escrita en los logs.
      headers: { "content-type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { response_mime_type: "application/json", temperature: 0, ...attempt.extraConfig },
      }),
      // Sin tope, una respuesta lenta de Gemini (común con PDFs) dejaba la
      // función colgada hasta que Supabase la mataba sin mandar respuesta.
      signal: AbortSignal.timeout(attempt.timeoutMs),
    });
    data = await res.json();
  } catch (err) {
    const timedOut = (err as Error)?.name === "TimeoutError";
    console.error(`Gemini ${attempt.model}:`, timedOut ? "tiempo agotado" : "falló la conexión", (err as Error)?.name);
    return timedOut
      ? { ok: false, failure: "timeout", detail: `tardó más de ${attempt.timeoutMs / 1000} s` }
      : { ok: false, failure: "overload", detail: "error de conexión" };
  }

  if (!res.ok) {
    console.error(`Gemini ${attempt.model}: HTTP ${res.status}`, JSON.stringify(data));
    const failure: GeminiFailure = res.status === 429 ? "quota" : res.status === 503 ? "overload" : "other";
    return { ok: false, failure, detail: `HTTP ${res.status}` };
  }

  const candidate = data?.candidates?.[0];
  const finishReason = candidate?.finishReason ?? data?.promptFeedback?.blockReason ?? "desconocido";
  console.log("Gemini respondió", {
    model: attempt.model,
    modelVersion: data?.modelVersion,
    ms: Date.now() - startedAt,
    finishReason,
    tokens: data?.usageMetadata,
  });

  const raw = (candidate?.content?.parts ?? [])
    .filter((p: any) => !p.thought)
    .map((p: any) => p.text ?? "")
    .join("")
    .trim()
    .replace(/^```(?:json)?\s*|\s*```$/g, "");
  if (!raw) {
    console.error(`Gemini ${attempt.model}: sin texto en la respuesta`, JSON.stringify(data));
    return { ok: false, failure: "other", detail: `sin texto (${finishReason})` };
  }

  try {
    return { ok: true, data: JSON.parse(raw) };
  } catch (err) {
    console.error(`Gemini ${attempt.model}: JSON inválido`, raw, err);
    return { ok: false, failure: "other", detail: `JSON inválido (${finishReason})` };
  }
}

// Si un modelo falla por lo que sea (lento, saturado, sin cuota, o ya no
// existe), se pasa al siguiente. "detail" dice qué le pasó a cada uno.
async function extractWithGemini(
  { base64, mimeType, text }: { base64: string | null; mimeType: string; text: string }
): Promise<{ data: any; reason: null; detail: null } | { data: null; reason: "capacity" | "unrecognized" | "slow"; detail: string }> {
  const parts: unknown[] = [];
  if (base64) {
    parts.push({ inline_data: { mime_type: mimeType, data: base64 } });
  }
  const contextLine = text ? `\nTexto que acompaña al documento, úsalo como contexto adicional: "${text.replace(/"/g, "'")}"` : "";
  parts.push({ text: EXTRACTION_PROMPT + contextLine });

  const failures: GeminiFailure[] = [];
  const details: string[] = [];
  for (const attempt of GEMINI_ATTEMPTS) {
    const result = await callGeminiOnce(parts, attempt);
    if (result.ok) return { data: result.data, reason: null, detail: null };
    failures.push(result.failure);
    details.push(`${attempt.model}: ${result.detail}`);
  }
  const reason = failures.includes("quota")
    ? "capacity"
    : failures.includes("timeout") || failures.includes("overload")
    ? "slow"
    : "unrecognized";
  return { data: null, reason, detail: details.join(" · ") };
}

Deno.serve(async (req) => {
  const secretHeader = req.headers.get("x-telegram-bot-api-secret-token");
  if (secretHeader !== TELEGRAM_WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  let update: any;
  try {
    update = await req.json();
  } catch {
    return new Response("ok");
  }

  const message = update?.message;
  if (!message) return new Response("ok");

  // Si Gemini tarda en responder, Telegram puede pensar que no
  // contestamos a tiempo y reenviar este mismo update. Sin esto, el
  // reenvío se procesaba de nuevo por completo: registro duplicado y
  // doble llamada a Gemini en paralelo para el mismo documento.
  if (update?.update_id != null) {
    const { error: dedupeError } = await supabase
      .from("telegram_processed_updates")
      .insert({ updateId: update.update_id });
    if (dedupeError) {
      console.log("Update de Telegram duplicado, se ignora", update.update_id);
      return new Response("ok");
    }
  }

  const chatId = String(message.chat.id);
  const text = (message.text || message.caption || "").trim();

  // --- Vincular un chat a una empresa ---
  if (text.toLowerCase().startsWith("/vincular")) {
    const code = text.slice("/vincular".length).trim().toUpperCase();
    if (!code) {
      await sendMessage(chatId, "Usa: /vincular TU-CODIGO (lo encuentras en Navío → Configuración → Bot).");
      return new Response("ok");
    }
    const { data: company } = await supabase
      .from("companies")
      .select("id, name")
      .eq("botLinkCode", code)
      .eq("status", "approved")
      .maybeSingle();

    if (!company) {
      await sendMessage(chatId, "Código no válido. Verifícalo en Navío → Configuración → Bot.");
      return new Response("ok");
    }

    await supabase.from("companies").update({ botChannel: "telegram", botChatId: chatId }).eq("id", company.id);
    await sendMessage(
      chatId,
      `Listo — este chat quedó vinculado a "${company.name}". Ya puedes enviarme fotos, PDFs o texto de facturas y las registro automáticamente como pendientes de revisión.`
    );
    return new Response("ok");
  }

  // --- ¿A qué empresa pertenece este chat? ---
  const { data: company, error: companyLookupError } = await supabase
    .from("companies")
    .select("id, name")
    .eq("botChatId", chatId)
    .eq("botChannel", "telegram")
    .maybeSingle();

  if (companyLookupError) {
    console.error("Error al buscar la empresa del chat", chatId, companyLookupError.message);
  }

  if (!company) {
    console.log("Chat sin empresa vinculada", { chatId, hadError: !!companyLookupError });
    await sendMessage(chatId, "Este chat no está vinculado a ninguna empresa todavía. Envía /vincular TU-CODIGO para empezar.");
    return new Response("ok");
  }

  const fileId = message.photo?.at(-1)?.file_id || message.document?.file_id;
  let file: { base64: string; mimeType: string } | null = null;
  if (fileId) {
    file = await fetchTelegramFileBase64(fileId);
  }

  if (!file && !text) {
    await sendMessage(chatId, "Mándame una foto o PDF de la factura, o descríbela en texto (monto, unidad, fecha, concepto).");
    return new Response("ok");
  }

  console.log("Procesando mensaje", { hasFile: !!file, mimeType: file?.mimeType, textLength: text.length });

  // Leer un PDF puede tardar más de un minuto; avisar enseguida evita que
  // parezca que el bot no recibió nada.
  if (file) await sendMessage(chatId, "Recibí tu documento, lo estoy leyendo… (puede tardar un poco)");

  const { data: extraction, reason: failureReason, detail: failureDetail } = await extractWithGemini({
    base64: file?.base64 ?? null,
    mimeType: file?.mimeType ?? "image/jpeg",
    text,
  });
  console.log("Resultado de Gemini", JSON.stringify(extraction), failureReason);
  const cfdi = normalizeCfdi(extraction?.cfdi);
  let module = extraction?.module;

  // Una factura con folio fiscal o total es un gasto real aunque no encaje en
  // ninguna categoría: se registra como "otro" en lugar de descartarla.
  if ((!module || !TABLE_MAP[module]) && (cfdi?.uuid || cfdi?.importes?.total !== undefined)) {
    module = "travel";
    extraction.record = { ...extraction.record, expenseType: "otro" };
  }

  if (!module || module === "unknown" || !TABLE_MAP[module]) {
    const summary =
      failureReason === "capacity"
        ? "Límite de IA alcanzado temporalmente"
        : failureReason === "slow"
        ? "La IA tardó demasiado en responder"
        : "No se pudo interpretar el documento";
    await supabase.from("bot_ingestions").insert({
      companyId: company.id,
      channel: "telegram",
      summary,
      module: null,
      status: "failed",
    });
    const failureMessage =
      failureReason === "capacity"
        ? "Estoy recibiendo demasiadas solicitudes en este momento (límite del servicio gratuito de IA). Intenta de nuevo en unos minutos — no es un problema con tu documento."
        : failureReason === "slow"
        ? "El servicio de IA está tardando demasiado en responder. Reenvía el documento en unos minutos — no es un problema con tu archivo."
        : "No logré interpretar ese documento. Intenta con una foto más clara o descríbelo en texto.";
    await sendMessage(chatId, failureDetail ? `${failureMessage}\n\nDetalle técnico: ${failureDetail}` : failureMessage);
    return new Response("ok");
  }

  const record = buildRecord(extraction, module, cfdi);
  if (!record) {
    await supabase.from("bot_ingestions").insert({
      companyId: company.id,
      channel: "telegram",
      summary: `Faltan datos para registrarlo en ${MODULE_LABEL[module]}`,
      module,
      status: "failed",
    });
    await sendMessage(chatId, `Reconocí que es de ${MODULE_LABEL[module]}, pero falta información clave (categoría/concepto). Descríbelo con un poco más de detalle.`);
    return new Response("ok");
  }

  const documentUrl = file ? await uploadDocument(company.id, module, file) : null;

  // El chat está ligado a la empresa, no a un usuario de Navío: como
  // "Usuario" se guarda el nombre de quien mandó el mensaje en Telegram.
  const senderName =
    [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") || message.from?.username || null;
  const invoiceFields = INVOICE_MODULES.includes(module) ? { uploadedByName: senderName } : {};

  const { data: inserted, error: insertError } = await supabase
    .from(TABLE_MAP[module])
    .insert({ ...record, ...invoiceFields, ...(cfdi ? { cfdi } : {}), companyId: company.id, origin: "telegram", status: "pending", documentUrl })
    .select()
    .single();

  // Si la factura trae orden de trabajo, se da de alta sin tocar una
  // fecha límite que la orden ya tuviera.
  if (!insertError && INVOICE_MODULES.includes(module) && record.workOrder) {
    await supabase
      .from("work_orders")
      .upsert(
        { companyId: company.id, project: String(record.project ?? "").trim(), code: String(record.workOrder).trim() },
        { onConflict: "companyId,project,code", ignoreDuplicates: true }
      );
  }

  const amountLabel = record.amount != null ? `$${record.amount}` : "sin monto";
  const unitLabel = record.unit || "sin unidad";
  const summary = insertError
    ? `Error al guardar en ${MODULE_LABEL[module]}: ${insertError.message}`
    : `${MODULE_LABEL[module]} — ${unitLabel} — ${amountLabel}`;

  await supabase.from("bot_ingestions").insert({
    companyId: company.id,
    channel: "telegram",
    summary,
    module,
    status: insertError ? "failed" : "success",
    recordId: inserted?.id ?? null,
  });

  await sendMessage(
    chatId,
    insertError
      ? `Recibí el documento pero hubo un error al guardarlo: ${insertError.message}`
      : [
          `Registrado en ${MODULE_LABEL[module]} ✅`,
          summary,
          ...cfdiSummaryLines(cfdi),
          `Quedó como "pendiente" — confírmalo en Navío cuando lo revises.`,
        ].join("\n")
  );

  return new Response("ok");
});
