// Navio — Telegram webhook (ingesta de facturas/documentos por chat)
//
// Recibe los updates de Telegram, vincula chats a empresas con el
// comando /vincular, y usa Gemini (vision, nivel gratuito) para
// interpretar fotos o documentos de facturas/servicios y
// registrarlos en la tabla correcta (fuel_records /
// maintenance_records / compliance_records) de la empresa dueña de
// ese chat. Corre con la llave de servicio, así que ignora RLS por
// diseño — la empresa correcta se determina SIEMPRE a partir de
// "botChatId", nunca de un dato que mande el propio mensaje.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const GEMINI_MODEL = "gemini-flash-latest";

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
  fuel: ["unit", "plate", "station", "liters", "amount", "odometer", "efficiency", "date", "vendor", "invoiceFolio", "notes"],
  maintenance: ["unit", "plate", "category", "concept", "amount", "date", "vendor", "invoiceFolio", "notes"],
  compliance: ["unit", "plate", "docType", "concept", "amount", "date", "dueDate", "paymentStatus", "vendor", "invoiceFolio", "notes"],
  travel: ["unit", "plate", "driverName", "concept", "amount", "date", "vendor", "invoiceFolio", "notes"],
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function buildRecord(extracted: any, module: string): Record<string, unknown> | null {
  const raw = extracted?.record || {};
  const picked: Record<string, unknown> = {};
  for (const key of FIELD_MAP[module] ?? []) {
    if (raw[key] !== undefined && raw[key] !== null && raw[key] !== "") picked[key] = raw[key];
  }
  // "travel" no está ligado a una unidad — un hospedaje puede no mencionar ninguna.
  if (module !== "travel") picked.unit = picked.unit || "Sin identificar";
  picked.date = picked.date || today();

  if (module === "maintenance" && (!picked.category || !picked.concept)) return null;
  if (module === "compliance" && (!picked.docType || !picked.concept)) return null;
  if (module === "travel" && !picked.concept) return null;
  return picked;
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

const EXTRACTION_PROMPT = `Extrae los datos de este documento/factura relacionado con una flotilla vehicular o el viaje de un conductor. Responde ÚNICAMENTE con JSON válido, sin texto adicional ni explicaciones, exactamente con esta forma:
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
    "paymentStatus": "Pagado" | "Pendiente de Pago" | null
  }
}
Usa "fuel" para tickets/facturas de gasolina o diésel. "maintenance" para servicios, refacciones o mantenimiento del vehículo. "compliance" para tenencias, pólizas, verificaciones, licencias o tarjetas de circulación. Usa "travel" para gastos generales del viaje de un conductor que NO son de la unidad en sí — hospedaje/hotel, alimentos, viáticos, casetas sueltas sin factura de combustible. Si no puedes identificar de qué se trata, usa "unknown". "unit"/"plate" son la unidad o placa del vehículo si el documento lo menciona (en "travel" casi nunca aplica, déjalo en null si no aparece). "driverName" es el nombre del huésped/conductor si el documento lo menciona (común en facturas de hotel).`;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callGeminiOnce(parts: unknown[]): Promise<{ ok: true; data: any } | { ok: false; retryable: boolean }> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { response_mime_type: "application/json" },
      }),
    }
  );

  const data = await res.json();

  if (!res.ok) {
    console.error("Gemini API error", res.status, JSON.stringify(data));
    // 429 (cuota) y 503 (modelo saturado) son errores pasajeros — vale la pena reintentar.
    return { ok: false, retryable: res.status === 429 || res.status === 503 };
  }

  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!raw) {
    console.error("Gemini sin texto en la respuesta", JSON.stringify(data));
    return { ok: false, retryable: false };
  }

  try {
    return { ok: true, data: JSON.parse(raw) };
  } catch (err) {
    console.error("No se pudo parsear el JSON de Gemini", raw, err);
    return { ok: false, retryable: false };
  }
}

// Gemini a veces responde "503 — modelo con demanda alta" de forma pasajera
// (lo confirmamos en producción: el mismo documento fallaba y funcionaba en
// intentos distintos, y a veces la saturación dura varios segundos seguidos).
// Reintenta hasta 5 veces con espera creciente antes de rendirse.
async function extractWithGemini({ base64, mimeType, text }: { base64: string | null; mimeType: string; text: string }) {
  const parts: unknown[] = [];
  if (base64) {
    parts.push({ inline_data: { mime_type: mimeType, data: base64 } });
  }
  const contextLine = text ? `\nTexto que acompaña al documento, úsalo como contexto adicional: "${text.replace(/"/g, "'")}"` : "";
  parts.push({ text: EXTRACTION_PROMPT + contextLine });

  const delaysMs = [0, 2000, 4000, 8000, 8000];
  for (let attempt = 0; attempt < delaysMs.length; attempt++) {
    if (delaysMs[attempt] > 0) {
      console.log(`Reintentando Gemini (intento ${attempt + 1}/${delaysMs.length})`);
      await sleep(delaysMs[attempt]);
    }
    const result = await callGeminiOnce(parts);
    if (result.ok) return result.data;
    if (!result.retryable) return null;
  }
  return null;
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

  const extraction = await extractWithGemini({ base64: file?.base64 ?? null, mimeType: file?.mimeType ?? "image/jpeg", text });
  console.log("Resultado de Gemini", JSON.stringify(extraction));
  const module = extraction?.module;

  if (!module || module === "unknown" || !TABLE_MAP[module]) {
    await supabase.from("bot_ingestions").insert({
      companyId: company.id,
      channel: "telegram",
      summary: "No se pudo interpretar el documento",
      module: null,
      status: "failed",
    });
    await sendMessage(chatId, "No logré interpretar ese documento. Intenta con una foto más clara o descríbelo en texto.");
    return new Response("ok");
  }

  const record = buildRecord(extraction, module);
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

  const { data: inserted, error: insertError } = await supabase
    .from(TABLE_MAP[module])
    .insert({ ...record, companyId: company.id, origin: "telegram", status: "pending", documentUrl })
    .select()
    .single();

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
      : `Registrado en ${MODULE_LABEL[module]} ✅\n${summary}\nQuedó como "pendiente" — confírmalo en Navío cuando lo revises.`
  );

  return new Response("ok");
});
