// Página de pruebas: la app real con una base de datos falsa en memoria.
// ?member → usuario normal · ?mobile no hace falta (depende del ancho) · ?login → pantalla de acceso real
import "leaflet/dist/leaflet.css";
import "./.tailwind.css";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import NavioDashboard, { supabase, AuthContext, NavioApp } from "../src/NavioDashboard.jsx";

const params = new URLSearchParams(location.search);
const isMember = params.has("member");
const isSuper = params.has("super");
const ME = isMember ? "u2" : "u1";
const COMPANY = 7;

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const now = new Date();
const thisMonth = (day) => iso(new Date(now.getFullYear(), now.getMonth(), day));
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
let nextId = 1000;

const vehicle = (id, unit, plate, driver, extra = {}) => ({
  id, unit, plate, brand: "Kenworth", model: "T680", year: 2022, color: "Blanco", photo: null, healthScore: 88, kmActual: 152400, kmProximoServicio: 155000,
  oilType: "Sintético 15W-40", avgConsumption: 3.8, companyId: COMPANY,
  driver: { mode: "fixed", name: driver, phone: "921 123 4567", photo: "", license: "LIC-88452", licenseExpiry: "2027-09-02" },
  insurance: { company: "GNP", folio: "POL-1", expiry: "2027-03-01", pdfUrl: "#" }, circulationCard: { folio: "TC-1", pdfUrl: "#" },
  verification: { hologram: "0", validity: "2027-01-01" }, warranty: { engine: "Vigente", parts: "Vigente" }, documentHistory: [],
  maintenancePanel: { kmRestante: 2600, coolantType: "Verde", brakesLast: "2026-06-01", oilLast: "2026-07-01" },
  tires: { frontDepth: 8, rearDepth: 6, frontSize: "295/80 R22.5", rearSize: "295/80 R22.5", psi: 110, lastRotation: "2026-05-01" },
  history: [], gps: { status: "resting", address: "Patio", speed: 0, lastUpdate: "", fuelPercent: 80, signalType: "GPS", x: 50, y: 50, mode: "libre", destination: null, eta: null, stops: [] },
  appCapture: {}, ...extra,
});
const invoice = (o) => ({ id: nextId++, origin: "manual", status: "verified", approved: false, uploadedByName: "Johana Viras", createdAt: ago(5), documentUrl: null, companyId: COMPANY, ...o });

const db = {
  profiles: [
    { id: "u1", fullName: "Johana Viras", companyId: COMPANY, companyRole: "admin", jobTitle: "Administración", phone: "921 000 0001" },
    { id: "u2", fullName: "Vania Usuario", companyId: COMPANY, companyRole: "member", jobTitle: "Chofer", phone: "921 000 0002" },
    { id: "u3", fullName: "Carlos Ruiz", companyId: COMPANY, companyRole: "member", jobTitle: "Chofer", phone: "" },
  ],
  vehicles: [vehicle(1, "Unidad 12", "YZA-142-B", "Ricardo Pérez"), vehicle(2, "Unidad 07", "XKT-880-A", "Lucía Gómez", { healthScore: 62 }), vehicle(3, "Unidad 09", "WPL-215-C", "", { driver: { mode: "variable", name: "" } })],
  fuel_records: [
    invoice({ unit: "Unidad 12", plate: "YZA-142-B", station: "Pemex Nanchital", vendor: "Pemex Nanchital", liters: 200, amount: 4600, odometer: 10000, efficiency: 3.5, date: thisMonth(1), project: "Tren Maya", workOrder: "OT-100", details: { fuelType: "Diésel" } }),
    invoice({ unit: "Unidad 07", plate: "XKT-880-A", station: "G500", vendor: "G500", liters: 100, amount: 2400, odometer: 5000, efficiency: 4.1, date: thisMonth(2), project: "Cobre", status: "pending", origin: "telegram", uploadedByName: "Ibrahim" }),
  ],
  travel_expenses: [invoice({ concept: "Renta de habitación", expenseType: "hotel", amount: 3000, date: thisMonth(1), vendor: "Hotel Fiesta", driverName: "Ana Pérez", project: "Tren Maya", details: { destination: "Mérida", nights: 3 } })],
  misc_expenses: [invoice({ category: "tolls", expenseType: "casetas", concept: "Caseta", amount: 350, date: thisMonth(1), vendor: "CAPUFE", unit: "Unidad 12", project: "Tren Maya", details: { plaza: "Cosoleacaque", paymentMethod: "TAG" } })],
  work_orders: [{ id: 1, companyId: COMPANY, project: "Tren Maya", code: "OT-100", dueDate: null, createdAt: ago(30) }],
  project_settings: [], concept_deadlines: [], user_reminders: [],
  maintenance_records: [{ id: 1, companyId: COMPANY, unit: "Unidad 12", plate: "YZA-142-B", category: "engine", concept: "Cambio de aceite", amount: 3200, date: thisMonth(1), vendor: "Taller Central", origin: "manual", status: "verified", createdAt: ago(40) }],
  compliance_records: [{ id: 1, companyId: COMPANY, unit: "Unidad 07", plate: "XKT-880-A", docType: "Póliza de Seguro", concept: "Renovación póliza", amount: 18000, date: thisMonth(1), dueDate: iso(new Date(Date.now() + 12 * 864e5)), paymentStatus: "Pendiente de Pago", origin: "manual", status: "pending", createdAt: ago(20) }],
  trips: [
    { id: 1, companyId: COMPANY, unit: "Unidad 12", vehicleId: 1, driver: "Ricardo Pérez", tripType: "cargo", origin: "Coatzacoalcos", destination: "Mérida", date: iso(now), cargo: "Materiales, 8 t", status: "scheduled", assignedTo: ME, assignedToName: isMember ? "Vania Usuario" : "Johana Viras", project: "Tren Maya", createdByName: "Johana Viras", createdAt: ago(3) },
    { id: 2, companyId: COMPANY, unit: "Unidad 07", vehicleId: 2, driver: "Lucía Gómez", tripType: "passengers", origin: "Nanchital", destination: "Villahermosa", date: thisMonth(1), cargo: "4 personas", status: "completed", routeId: 50, startedAt: ago(30), endedAt: ago(27), distanceKm: 168.4, createdByName: "Johana Viras", createdAt: ago(40) },
    { id: 3, companyId: COMPANY, unit: "Unidad 09", vehicleId: 3, driver: "Pedro Sánchez", tripType: "cargo", origin: "Minatitlán", destination: "Acayucan", date: iso(now), cargo: "Equipo", status: "ongoing", routeId: 51, startedAt: ago(1), assignedTo: "u3", assignedToName: "Carlos Ruiz", createdAt: ago(5) },
  ],
  routes: [
    { id: 50, companyId: COMPANY, vehicleId: 2, driverName: "Lucía Gómez", status: "completed", distanceKm: 168.4, startedAt: ago(30), endedAt: ago(27), createdBy: "u9", tripId: 2, pointCount: 4, maxSpeed: 92 },
    { id: 51, companyId: COMPANY, vehicleId: 3, driverName: "Carlos Ruiz", status: "active", distanceKm: 31.2, startedAt: ago(1), endedAt: null, createdBy: "u3", tripId: 3, pointCount: 3, maxSpeed: 78 },
  ],
  route_points: [
    ...[[18.0, -94.55], [17.99, -94.2], [17.98, -93.6], [17.99, -92.95]].map(([lat, lng], i) => ({ id: i + 1, routeId: 50, companyId: COMPANY, lat, lng, speed: 80, recordedAt: ago(30 - i) })),
    ...[[17.98, -94.55], [17.96, -94.7], [17.95, -94.9]].map(([lat, lng], i) => ({ id: i + 10, routeId: 51, companyId: COMPANY, lat, lng, speed: 60, recordedAt: ago(1 - i * 0.3) })),
  ],
  vehicle_positions: [
    { vehicleId: 3, companyId: COMPANY, routeId: 51, lat: 17.95, lng: -94.9, speed: 62, heading: 250, accuracy: 9, source: "phone", recordedAt: new Date(Date.now() - 20000).toISOString() },
    { vehicleId: 2, companyId: COMPANY, routeId: 50, lat: 17.99, lng: -92.95, speed: 0, heading: 0, accuracy: 12, source: "phone", recordedAt: ago(27) },
  ],
  incidents: [{ id: 1, companyId: COMPANY, unit: "Unidad 09", severity: "high", status: "open", description: "Ponchadura", reportedBy: "Carlos Ruiz", date: thisMonth(2), createdAt: ago(2) }],
  community_posts: [], community_votes: [], bot_ingestions: [], invoice_events: [], invoice_marks: [], routes_archive: [],
  notifications: [
    { id: 1, companyId: COMPANY, userId: ME, kind: "trip", title: "Te asignaron un traslado", body: "Unidad 12: Coatzacoalcos → Mérida", link: { tab: "transfers", id: 1 }, createdByName: "Johana Viras", readAt: null, createdAt: ago(3) },
    { id: 2, companyId: COMPANY, userId: ME, kind: "alert", title: "Junta de seguridad el viernes", body: "9:00 en el patio", link: null, createdByName: "Johana Viras", readAt: ago(1), createdAt: ago(26) },
  ],
  tasks: [
    { id: 1, companyId: COMPANY, title: "Revisar facturas de Tren Maya", description: "Faltan dos comprobantes", assignedTo: "u2", assignedToName: "Vania Usuario", createdBy: "u1", createdByName: "Johana Viras", dueDate: iso(new Date(Date.now() + 2 * 864e5)), priority: "high", status: "open", createdAt: ago(4), updatedAt: ago(4) },
    { id: 2, companyId: COMPANY, title: "Renovar póliza de Unidad 07", description: "", assignedTo: "u1", assignedToName: "Johana Viras", createdBy: "u1", createdByName: "Johana Viras", dueDate: iso(new Date(Date.now() - 864e5)), priority: "normal", status: "in_progress", createdAt: ago(50), updatedAt: ago(10) },
  ],
  chat_channels: [
    { id: 1, companyId: COMPANY, kind: "general", name: "General", createdBy: "u1", createdAt: ago(100), lastMessageAt: ago(2) },
    { id: 2, companyId: COMPANY, kind: "direct", name: null, directKey: "7:u1:u2", createdBy: "u1", createdAt: ago(50), lastMessageAt: ago(6) },
  ],
  chat_members: [
    { channelId: 2, userId: "u1", lastReadAt: ago(1) }, { channelId: 2, userId: "u2", lastReadAt: ago(1) }, { channelId: 1, userId: ME, lastReadAt: ago(3) },
  ],
  chat_messages: [
    { id: 1, channelId: 1, companyId: COMPANY, senderId: "u3", senderName: "Carlos Ruiz", body: "Buenos días, ya salí de Minatitlán.", createdAt: ago(2.5), deletedAt: null },
    { id: 2, channelId: 1, companyId: COMPANY, senderId: isMember ? "u1" : "u2", senderName: isMember ? "Johana Viras" : "Vania Usuario", body: "Enterados, buen viaje.", createdAt: ago(2), deletedAt: null },
    { id: 3, channelId: 2, companyId: COMPANY, senderId: "u1", senderName: "Johana Viras", body: "¿Me pasas la factura del hotel?", createdAt: ago(6), deletedAt: null },
  ],
  warranties: [
    { id: 1, companyId: COMPANY, vehicleId: 1, unit: "Unidad 12", item: "Batería LTH", kind: "battery", vendor: "AutoZone", startDate: "2026-01-10", endDate: iso(new Date(Date.now() + 20 * 864e5)), kmStart: 140000, kmLimit: null, status: "active", createdBy: "u1", createdAt: ago(300) },
    { id: 2, companyId: COMPANY, vehicleId: 2, unit: "Unidad 07", item: "Balatas delanteras", kind: "part", vendor: "Refaccionaria Central", startDate: "2025-01-10", endDate: "2026-01-10", kmStart: null, kmLimit: null, status: "active", createdBy: "u2", createdAt: ago(900) },
  ],
  audit_log: [{ id: 1, companyId: COMPANY, actorId: "u1", actorName: "Johana Viras", action: "insert", entity: "vehicles", entityId: "1", summary: "Unidad 12", details: null, createdAt: ago(200) }],
  legal_acceptances: params.has("legal") ? [] : [{ id: 1, userId: isMember ? "u2" : "u1", document: "terms", version: "2026-11-11", acceptedAt: ago(1) }, { id: 2, userId: isMember ? "u2" : "u1", document: "privacy", version: "2026-11-11", acceptedAt: ago(1) }],
  privacy_requests: [],
  company_secrets: [{ companyId: COMPANY, inviteCode: "ABCDEF123456", botLinkCode: "BOT123456789" }],
  companies: [{ id: COMPANY, name: "Empresa de prueba", currency: "MXN", status: "approved", botChannel: null, botChatId: null, contactName: "Johana", contactEmail: "j@x.test", contactPhone: "", legalName: "", rfc: "", address: "", settings: {} }],
};
window.__db = db;
window.__writes = [];
window.__fail = {}; // { tabla o rpc: "mensaje" } para simular errores

function tableChain(table) {
  let mode = "select";
  let payload = null;
  let conflict = null;
  let limit = null;
  let sort = null;
  const filters = [];
  const matches = (r) => filters.every((f) => f(r));
  const run = async () => {
    if (window.__fail[table] && mode !== "select") return { data: null, error: { message: window.__fail[table] } };
    const rows = db[table] ?? (db[table] = []);
    if (mode === "select") {
      let out = rows.filter(matches);
      if (sort) out = [...out].sort((a, b) => (a[sort.col] > b[sort.col] ? 1 : a[sort.col] < b[sort.col] ? -1 : 0) * (sort.asc ? 1 : -1));
      if (limit != null) out = out.slice(0, limit);
      return { data: out, error: null };
    }
    window.__writes.push({ table, mode, payload: JSON.parse(JSON.stringify(payload ?? null)) });
    if (mode === "insert") {
      const list = (Array.isArray(payload) ? payload : [payload]).map((row) => ({ id: nextId++, createdAt: new Date().toISOString(), companyId: COMPANY, ...row }));
      rows.unshift(...list);
      for (const row of list) emit(table, "INSERT", row);
      return { data: list, error: null };
    }
    if (mode === "update") {
      const out = [];
      rows.forEach((r, i) => {
        if (matches(r)) {
          rows[i] = { ...r, ...payload };
          out.push(rows[i]);
          emit(table, "UPDATE", rows[i], r);
        }
      });
      return { data: out, error: null };
    }
    if (mode === "upsert") {
      const keys = conflict.split(",");
      const at = rows.findIndex((r) => keys.every((k) => r[k] === payload[k]));
      if (at >= 0) rows[at] = { ...rows[at], ...payload };
      else rows.unshift(payload);
      return { data: [payload], error: null };
    }
    const removed = rows.filter(matches);
    db[table] = rows.filter((r) => !matches(r));
    return { data: removed, error: null };
  };
  const chain = {
    select: () => chain,
    order: (col, opts) => { sort = { col, asc: opts?.ascending !== false }; return chain; },
    limit: (n) => { limit = n; return chain; },
    eq: (k, v) => { filters.push((r) => r[k] === v); return chain; },
    neq: (k, v) => { filters.push((r) => r[k] !== v); return chain; },
    in: (k, list) => { filters.push((r) => list.includes(r[k])); return chain; },
    is: (k, v) => { filters.push((r) => (r[k] ?? null) === v); return chain; },
    gt: (k, v) => { filters.push((r) => r[k] > v); return chain; },
    lt: (k, v) => { filters.push((r) => r[k] < v); return chain; },
    gte: (k, v) => { filters.push((r) => r[k] >= v); return chain; },
    lte: (k, v) => { filters.push((r) => r[k] <= v); return chain; },
    insert: (row) => { mode = "insert"; payload = row; return chain; },
    update: (row) => { mode = "update"; payload = row; return chain; },
    upsert: (row, opts) => { mode = "upsert"; payload = row; conflict = opts?.onConflict ?? "id"; return chain; },
    delete: () => { mode = "delete"; return chain; },
    single: async () => { const r = await run(); return r.error ? r : { data: r.data[0] ?? null, error: r.data[0] ? null : { message: "No rows" } }; },
    maybeSingle: async () => { const r = await run(); return r.error ? r : { data: r.data[0] ?? null, error: null }; },
    then: (res, rej) => run().then(res, rej),
  };
  return chain;
}
supabase.from = tableChain;

// ---- Tiempo real simulado ----
const listeners = [];
function emit(table, eventType, row, old = {}) {
  for (const l of listeners) if (l.table === table && (l.event === "*" || l.event === eventType)) setTimeout(() => l.cb({ eventType, new: row, old }), 0);
}
window.__emit = emit;
supabase.channel = () => {
  const mine = [];
  const c = {
    on: (_type, filter, cb) => { const l = { table: filter.table, event: filter.event, cb }; mine.push(l); listeners.push(l); return c; },
    subscribe: () => c,
    _off: () => mine.forEach((l) => listeners.splice(listeners.indexOf(l), 1)),
  };
  return c;
};
supabase.removeChannel = (c) => c?._off?.();

// ---- Funciones de la base (versión de juguete) ----
const km = (a, b) => {
  const R = 6371, rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const myName = () => db.profiles.find((p) => p.id === ME).fullName;
const rpcs = {
  start_route({ target_vehicle, target_trip }) {
    const route = { id: nextId++, companyId: COMPANY, vehicleId: target_vehicle, driverName: myName(), status: "active", distanceKm: 0, startedAt: new Date().toISOString(), endedAt: null, createdBy: ME, tripId: target_trip, pointCount: 0, maxSpeed: 0 };
    db.routes.unshift(route);
    const trip = db.trips.find((t) => t.id === target_trip);
    if (trip) Object.assign(trip, { status: "ongoing", startedAt: trip.startedAt ?? route.startedAt, routeId: route.id });
    emit("routes", "INSERT", route);
    return route;
  },
  track_route_points({ target_route, points }) {
    const route = db.routes.find((r) => r.id === target_route);
    if (!route || route.status !== "active") throw new Error("Esa ruta ya terminó.");
    const existing = db.route_points.filter((p) => p.routeId === route.id);
    let last = existing[existing.length - 1];
    for (const p of points) {
      const row = { id: nextId++, routeId: route.id, companyId: COMPANY, lat: p.lat, lng: p.lng, speed: p.speed, recordedAt: p.t };
      if (last) route.distanceKm += km(last, row);
      db.route_points.push(row);
      last = row;
      route.maxSpeed = Math.max(route.maxSpeed ?? 0, p.speed ?? 0);
    }
    route.pointCount += points.length;
    const position = { vehicleId: route.vehicleId, companyId: COMPANY, routeId: route.id, lat: last.lat, lng: last.lng, speed: points.at(-1).speed, source: "phone", recordedAt: last.recordedAt };
    const at = db.vehicle_positions.findIndex((v) => v.vehicleId === route.vehicleId);
    if (at >= 0) db.vehicle_positions[at] = position; else db.vehicle_positions.push(position);
    emit("vehicle_positions", "UPDATE", position);
    return { distanceKm: Math.round(route.distanceKm * 1000) / 1000, pointCount: route.pointCount, maxSpeed: route.maxSpeed };
  },
  finish_route({ target_route, complete_trip }) {
    const route = db.routes.find((r) => r.id === target_route);
    if (route.status === "active") {
      Object.assign(route, { status: "completed", endedAt: new Date().toISOString() });
      const trip = db.trips.find((t) => t.id === route.tripId);
      if (trip) Object.assign(trip, { distanceKm: (trip.distanceKm ?? 0) + route.distanceKm, ...(complete_trip ? { status: "completed", endedAt: route.endedAt } : {}) });
      const v = db.vehicles.find((x) => x.id === route.vehicleId);
      if (v) v.kmActual += Math.round(route.distanceKm);
      emit("routes", "UPDATE", route);
    }
    return route;
  },
  chat_overview() {
    return db.chat_channels
      .filter((c) => c.kind === "general" || db.chat_members.some((m) => m.channelId === c.id && m.userId === ME))
      .map((c) => {
        const mine = db.chat_members.find((m) => m.channelId === c.id && m.userId === ME);
        const msgs = db.chat_messages.filter((m) => m.channelId === c.id && !m.deletedAt);
        const last = msgs[msgs.length - 1];
        const otherId = c.kind === "direct" ? db.chat_members.find((m) => m.channelId === c.id && m.userId !== ME)?.userId : null;
        return {
          id: c.id, kind: c.kind, name: c.name, createdBy: c.createdBy, otherUserId: otherId ?? null, otherUserName: db.profiles.find((p) => p.id === otherId)?.fullName ?? null,
          lastMessageAt: c.lastMessageAt, lastMessage: last?.body ?? null, lastSender: last?.senderName ?? null,
          unread: msgs.filter((m) => m.senderId !== ME && m.createdAt > (mine?.lastReadAt ?? "")).length,
          members: c.kind === "general" ? db.profiles.length : db.chat_members.filter((m) => m.channelId === c.id).length,
        };
      })
      .sort((a, b) => String(b.lastMessageAt ?? "").localeCompare(String(a.lastMessageAt ?? "")));
  },
  ensure_general_channel: () => 1,
  mark_channel_read({ target_channel }) {
    const mine = db.chat_members.find((m) => m.channelId === target_channel && m.userId === ME);
    if (mine) mine.lastReadAt = new Date().toISOString();
    else db.chat_members.push({ channelId: target_channel, userId: ME, lastReadAt: new Date().toISOString() });
    return null;
  },
  open_direct_channel({ other_user }) {
    const key = `7:${[ME, other_user].sort().join(":")}`;
    let c = db.chat_channels.find((x) => x.directKey === key);
    if (!c) {
      c = { id: nextId++, companyId: COMPANY, kind: "direct", name: null, directKey: key, createdBy: ME, createdAt: new Date().toISOString(), lastMessageAt: null };
      db.chat_channels.push(c);
      db.chat_members.push({ channelId: c.id, userId: ME, lastReadAt: c.createdAt }, { channelId: c.id, userId: other_user, lastReadAt: c.createdAt });
    }
    return c.id;
  },
  save_group_channel({ target_channel, channel_name, member_ids }) {
    let c = db.chat_channels.find((x) => x.id === target_channel);
    if (!c) {
      c = { id: nextId++, companyId: COMPANY, kind: "group", name: channel_name, createdBy: ME, createdAt: new Date().toISOString(), lastMessageAt: null };
      db.chat_channels.push(c);
    } else c.name = channel_name;
    db.chat_members = db.chat_members.filter((m) => m.channelId !== c.id);
    for (const id of new Set([ME, ...member_ids])) db.chat_members.push({ channelId: c.id, userId: id, lastReadAt: new Date().toISOString() });
    return c.id;
  },
  leave_channel({ target_channel }) {
    db.chat_members = db.chat_members.filter((m) => !(m.channelId === target_channel && m.userId === ME));
    return null;
  },
  delete_chat_message({ target_message }) {
    const m = db.chat_messages.find((x) => x.id === target_message);
    Object.assign(m, { body: "", deletedAt: new Date().toISOString() });
    emit("chat_messages", "UPDATE", m);
    return null;
  },
  send_alert({ recipients, alert_title, alert_body }) {
    const targets = db.profiles.filter((p) => p.id !== ME && (!recipients?.length || recipients.includes(p.id)));
    for (const p of targets) db.notifications.unshift({ id: nextId++, companyId: COMPANY, userId: p.id, kind: "alert", title: alert_title, body: alert_body, createdByName: myName(), readAt: null, createdAt: new Date().toISOString() });
    return targets.length;
  },
  list_company_members: () => db.profiles.map((p) => ({ ...p, email: `${p.id}@x.test` })),
  get_company_codes: () => db.company_secrets,
  rotate_company_code({ which }) {
    const code = Math.random().toString(16).slice(2, 14).toUpperCase();
    db.company_secrets[0][which === "invite" ? "inviteCode" : "botLinkCode"] = code;
    return code;
  },
  admin_list_companies: () => db.companies.map((c) => ({ ...c, inviteCode: db.company_secrets.find((x) => x.companyId === c.id)?.inviteCode ?? null, members: db.profiles.filter((p) => p.companyId === c.id).length })),
  approve_company({ target_company_id }) { db.companies.find((c) => c.id === target_company_id).status = "approved"; return "NEWCODE12345"; },
  set_company_status({ target_company_id, new_status }) { db.companies.find((c) => c.id === target_company_id).status = new_status; return null; },
  set_member_role({ target_user, new_role }) { db.profiles.find((p) => p.id === target_user).companyRole = new_role; return null; },
  remove_company_member({ target_user }) { db.profiles = db.profiles.filter((p) => p.id !== target_user); return null; },
};
window.__rpcCalls = [];
supabase.rpc = async (name, args = {}) => {
  window.__rpcCalls.push({ name, args: JSON.parse(JSON.stringify(args)) });
  if (window.__fail[name]) return { data: null, error: { message: window.__fail[name] } };
  if (!rpcs[name]) return { data: null, error: { message: `rpc sin simular: ${name}` } };
  try {
    return { data: await rpcs[name](args), error: null };
  } catch (err) {
    return { data: null, error: { message: err.message } };
  }
};

// Los mensajes nuevos llevan remitente, como lo haría la base.
const realInsert = tableChain;
supabase.from = (table) => {
  const chain = realInsert(table);
  if (table === "chat_messages") {
    const insert = chain.insert;
    chain.insert = (row) => insert({ ...row, senderId: ME, senderName: myName(), deletedAt: null });
  }
  if (table === "legal_acceptances" || table === "privacy_requests") {
    const insert = chain.insert;
    const stamp = (row) => ({ userId: ME, status: table === "privacy_requests" ? "open" : undefined, acceptedAt: new Date().toISOString(), ...row });
    chain.insert = (row) => insert(Array.isArray(row) ? row.map(stamp) : stamp(row));
  }
  if (table === "warranties") {
    const insert = chain.insert;
    chain.insert = (row) => insert({ status: "active", createdBy: ME, ...row });
  }
  if (table === "tasks") {
    const insert = chain.insert;
    chain.insert = (row) => insert({ status: "open", priority: "normal", createdBy: ME, createdByName: myName(), updatedAt: new Date().toISOString(), ...row, assignedTo: row.assignedTo ?? ME, assignedToName: db.profiles.find((p) => p.id === (row.assignedTo ?? ME))?.fullName });
  }
  return chain;
};

// ---- Archivos ----
window.__files = {};
window.__removed = [];
const storageApi = {
  from: () => ({
    upload: async (path, file, opts) => { window.__files[path] = { file, contentType: opts?.contentType }; return { error: null }; },
    download: async (path) => (window.__files[path] ? { data: window.__files[path].file, error: null } : { data: null, error: { message: "Object not found" } }),
    remove: async (paths) => { paths.forEach((p) => delete window.__files[p]); window.__removed.push(...paths); return { error: null }; },
  }),
};
Object.defineProperty(supabase, "storage", { get: () => storageApi, configurable: true });

// ---- GPS simulado: window.__geo.fix(lat, lng, kmh) ----
const geo = { watchers: new Map(), seq: 1, denied: false, last: { lat: 18.14, lng: -94.45 } };
const position = (lat, lng, kmh = 0) => ({ coords: { latitude: lat, longitude: lng, speed: kmh / 3.6, heading: 90, accuracy: 8 }, timestamp: Date.now() });
Object.defineProperty(navigator, "geolocation", {
  configurable: true,
  value: {
    getCurrentPosition: (ok, fail) => (geo.denied ? fail({ code: 1, message: "denied" }) : ok(position(geo.last.lat, geo.last.lng))),
    watchPosition: (ok) => { const id = geo.seq++; geo.watchers.set(id, ok); return id; },
    clearWatch: (id) => geo.watchers.delete(id),
  },
});
geo.fix = (lat, lng, kmh = 60) => { geo.last = { lat, lng }; geo.watchers.forEach((cb) => cb(position(lat, lng, kmh))); };
window.__geo = geo;

// ---- Ayudas para manejar la página desde las pruebas ----
window.__clickText = (t, root = document) => { const el = [...root.querySelectorAll("button")].find((b) => b.textContent.trim() === t); if (!el) return false; el.click(); return true; };
window.__wait = (ms = 300) => new Promise((r) => setTimeout(r, ms));
window.__setVal = (el, v) => {
  const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
  el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
};
// Sin transiciones: el panel de pruebas casi no dibuja cuadros. (Se agrega la
// regla a la hoja propia porque la política de seguridad no deja crear <style>.)
window.addEventListener("load", () => {
  try {
    [...document.styleSheets].find((s) => s.href?.includes("/assets/"))?.insertRule("*{transition:none!important}", 0);
  } catch {
    // Solo afecta a las pruebas.
  }
});

// ---- Sesión simulada ----
window.__auth = { factors: [], signedOut: 0, userUpdates: [] };
supabase.auth.mfa.listFactors = async () => ({ data: { all: window.__auth.factors, totp: window.__auth.factors.filter((f) => f.status === "verified") }, error: null });
supabase.auth.mfa.enroll = async () => {
  const f = { id: `f${nextId++}`, factor_type: "totp", status: "unverified", friendly_name: "Navio" };
  window.__auth.factors.push(f);
  return { data: { id: f.id, totp: { qr_code: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#000"/><rect x="2" y="2" width="6" height="6" fill="#fff"/></svg>', secret: "JBSWY3DPEHPK3PXP" } }, error: null };
};
supabase.auth.mfa.unenroll = async ({ factorId }) => { window.__auth.factors = window.__auth.factors.filter((f) => f.id !== factorId); return { data: {}, error: null }; };
supabase.auth.updateUser = async (patch) => { window.__auth.userUpdates.push(patch); return { data: {}, error: null }; };
supabase.auth.signOut = async () => { window.__auth.signedOut += 1; return { error: null }; };

db.companies.push({ id: 8, name: "Transportes Nuevos", status: "pending", industry: "Transporte de carga", fleetSize: "6-20 unidades", contactName: "Luis", contactEmail: "luis@x.test", contactPhone: "", needs: "Controlar combustible", createdAt: ago(10) });
const readProfile = () => ({ ...db.profiles.find((p) => p.id === ME), isSuperAdmin: isSuper, company: { ...db.companies[0] } });

function Root() {
  const [profile, setProfile] = useState(readProfile);
  const value = {
    user: { id: ME, email: "demo@example.test", user_metadata: { full_name: profile.fullName } },
    session: { user: { id: ME } },
    profile,
    profileLoading: false,
    loading: false,
    refreshProfile: async () => setProfile(readProfile()),
    signOut: async () => { window.__auth.signedOut += 1; },
    signIn: async () => {},
    signUp: async () => {},
    resetPassword: async () => {},
    updatePassword: async (p) => { if (window.__fail.password) throw new Error(window.__fail.password); window.__auth.userUpdates.push({ password: p.length }); },
    listMFAFactors: async () => ({ totp: window.__auth.factors.filter((f) => f.status === "verified") }),
    verifyFactor: async (factorId, code) => { if (code !== "123456") throw new Error("Invalid TOTP code entered"); window.__auth.factors.find((f) => f.id === factorId).status = "verified"; },
    unenrollMFA: async (factorId) => { window.__auth.factors = window.__auth.factors.filter((f) => f.id !== factorId); },
    unlinkCompanyBot: async () => { db.companies[0].botChannel = null; setProfile(readProfile()); },
    joinCompanyWithCode: async () => {},
    requestCompany: async () => {},
  };
  return (
    <AuthContext.Provider value={value}>
      <NavioApp />
    </AuthContext.Provider>
  );
}

if (!params.has("login")) document.getElementById("splash")?.classList.add("splash-done");
createRoot(document.getElementById("root")).render(params.has("login") ? <NavioDashboard /> : <Root />);
