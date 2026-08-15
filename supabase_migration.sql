-- ============================================================
-- Navio — Migración inicial a Supabase (Postgres)
-- ============================================================
-- Cómo usar:
--   1. Entra a tu proyecto en supabase.com → SQL Editor → New query.
--   2. Pega TODO este archivo y dale "Run".
--   3. Es seguro de correr una sola vez en un proyecto nuevo (usa
--      "if not exists" y "drop ... if exists" antes de recrear).
--
-- Diseño:
--   - Las columnas usan comillas dobles con el mismo nombre camelCase
--     que ya usa el código de React (ej. "kmActual", no km_actual),
--     para que el front-end pueda leer/escribir las filas de Supabase
--     sin necesitar una capa de traducción de nombres.
--   - Los objetos anidados (driver, gps, historial, etc.) se guardan
--     como jsonb — así no se rompe nada de cómo el front-end ya arma
--     esos datos, y evita crear ~10 tablas adicionales para el MVP.
--   - Todas las tablas son de "acceso compartido": cualquier usuario
--     autenticado puede leer/escribir todo (como si fueran todos
--     empleados de la misma flotilla). Si más adelante necesitas que
--     cada cliente/empresa vea solo lo suyo, se le agrega una columna
--     "orgId" a cada tabla y se ajustan las políticas — no hace falta
--     rehacer el esquema.
-- ============================================================

-- ------------------------------------------------------------
-- 1. profiles — perfil público de cada usuario autenticado
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  "fullName" text,
  role text not null default 'admin',
  "createdAt" timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated"
  on public.profiles for select
  to authenticated
  using (true);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id);

-- Crea el perfil automáticamente cada vez que alguien se registra
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, "fullName")
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- 2. vehicles
-- ------------------------------------------------------------
create table if not exists public.vehicles (
  id bigint generated always as identity primary key,
  unit text not null,
  plate text not null,
  brand text,
  model text,
  year int,
  color text,
  photo text,
  "healthScore" int default 100,
  "kmActual" int default 0,
  "kmProximoServicio" int default 0,
  "oilType" text,
  "avgConsumption" numeric default 0,
  driver jsonb default '{}'::jsonb,
  insurance jsonb default '{}'::jsonb,
  "circulationCard" jsonb default '{}'::jsonb,
  verification jsonb default '{}'::jsonb,
  warranty jsonb default '{}'::jsonb,
  "documentHistory" jsonb default '[]'::jsonb,
  "maintenancePanel" jsonb default '{}'::jsonb,
  tires jsonb default '{}'::jsonb,
  history jsonb default '[]'::jsonb,
  gps jsonb default '{}'::jsonb,
  "appCapture" jsonb default '{}'::jsonb,
  "createdAt" timestamptz not null default now()
);

alter table public.vehicles enable row level security;
drop policy if exists "vehicles_shared_access" on public.vehicles;
create policy "vehicles_shared_access" on public.vehicles
  for all to authenticated using (true) with check (true);

-- ------------------------------------------------------------
-- 3. maintenance_records
-- ------------------------------------------------------------
create table if not exists public.maintenance_records (
  id bigint generated always as identity primary key,
  unit text not null,
  plate text,
  category text not null,
  concept text not null,
  amount numeric default 0,
  date date not null,
  vendor text,
  "invoiceFolio" text,
  origin text default 'manual',
  status text default 'pending',
  notes text,
  "createdAt" timestamptz not null default now()
);
alter table public.maintenance_records enable row level security;
drop policy if exists "maintenance_shared_access" on public.maintenance_records;
create policy "maintenance_shared_access" on public.maintenance_records
  for all to authenticated using (true) with check (true);

-- ------------------------------------------------------------
-- 4. compliance_records
-- ------------------------------------------------------------
create table if not exists public.compliance_records (
  id bigint generated always as identity primary key,
  unit text not null,
  plate text,
  "docType" text not null,
  concept text not null,
  amount numeric default 0,
  date date not null,
  "dueDate" date,
  "paymentStatus" text default 'Pendiente de Pago',
  vendor text,
  "invoiceFolio" text,
  origin text default 'manual',
  status text default 'pending',
  notes text,
  "createdAt" timestamptz not null default now()
);
alter table public.compliance_records enable row level security;
drop policy if exists "compliance_shared_access" on public.compliance_records;
create policy "compliance_shared_access" on public.compliance_records
  for all to authenticated using (true) with check (true);

-- ------------------------------------------------------------
-- 5. fuel_records
-- ------------------------------------------------------------
create table if not exists public.fuel_records (
  id bigint generated always as identity primary key,
  unit text not null,
  plate text,
  station text,
  liters numeric default 0,
  amount numeric default 0,
  odometer int default 0,
  efficiency numeric default 0,
  date date not null,
  vendor text,
  "invoiceFolio" text,
  origin text default 'manual',
  status text default 'pending',
  notes text,
  "createdAt" timestamptz not null default now()
);
alter table public.fuel_records enable row level security;
drop policy if exists "fuel_shared_access" on public.fuel_records;
create policy "fuel_shared_access" on public.fuel_records
  for all to authenticated using (true) with check (true);

-- ------------------------------------------------------------
-- 6. trips
-- ------------------------------------------------------------
create table if not exists public.trips (
  id bigint generated always as identity primary key,
  unit text not null,
  driver text,
  "tripType" text default 'cargo',
  origin text not null,
  destination text not null,
  date date not null,
  cargo text,
  status text default 'scheduled',
  "createdAt" timestamptz not null default now()
);
alter table public.trips enable row level security;
drop policy if exists "trips_shared_access" on public.trips;
create policy "trips_shared_access" on public.trips
  for all to authenticated using (true) with check (true);

-- ------------------------------------------------------------
-- 7. incidents
-- ------------------------------------------------------------
create table if not exists public.incidents (
  id bigint generated always as identity primary key,
  unit text not null,
  severity text not null,
  status text default 'open',
  description text not null,
  "reportedBy" text,
  date date not null,
  "createdAt" timestamptz not null default now()
);
alter table public.incidents enable row level security;
drop policy if exists "incidents_shared_access" on public.incidents;
create policy "incidents_shared_access" on public.incidents
  for all to authenticated using (true) with check (true);

-- ------------------------------------------------------------
-- 8. community_posts
-- ------------------------------------------------------------
create table if not exists public.community_posts (
  id bigint generated always as identity primary key,
  title text not null,
  description text,
  category text default 'feature',
  status text default 'backlog',
  votes int not null default 0,
  author text,
  "authorId" uuid references auth.users (id),
  date date not null default current_date,
  "createdAt" timestamptz not null default now()
);
alter table public.community_posts enable row level security;

drop policy if exists "community_posts_select" on public.community_posts;
create policy "community_posts_select" on public.community_posts
  for select to authenticated using (true);

drop policy if exists "community_posts_insert" on public.community_posts;
create policy "community_posts_insert" on public.community_posts
  for insert to authenticated with check (true);

drop policy if exists "community_posts_update" on public.community_posts;
create policy "community_posts_update" on public.community_posts
  for update to authenticated using (true) with check (true);

-- ------------------------------------------------------------
-- 9. community_votes — un voto por usuario por publicación
-- ------------------------------------------------------------
create table if not exists public.community_votes (
  "postId" bigint not null references public.community_posts (id) on delete cascade,
  "userId" uuid not null references auth.users (id) on delete cascade,
  "createdAt" timestamptz not null default now(),
  primary key ("postId", "userId")
);
alter table public.community_votes enable row level security;

drop policy if exists "votes_select" on public.community_votes;
create policy "votes_select" on public.community_votes
  for select to authenticated using (true);

drop policy if exists "votes_insert_own" on public.community_votes;
create policy "votes_insert_own" on public.community_votes
  for insert to authenticated with check (auth.uid() = "userId");

drop policy if exists "votes_delete_own" on public.community_votes;
create policy "votes_delete_own" on public.community_votes
  for delete to authenticated using (auth.uid() = "userId");

-- Mantiene community_posts.votes sincronizado con la tabla de votos
create or replace function public.sync_post_votes()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    update public.community_posts set votes = votes + 1 where id = new."postId";
    return new;
  elsif (tg_op = 'DELETE') then
    update public.community_posts set votes = greatest(0, votes - 1) where id = old."postId";
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists on_vote_change on public.community_votes;
create trigger on_vote_change
  after insert or delete on public.community_votes
  for each row execute function public.sync_post_votes();

-- ============================================================
-- Datos semilla — los mismos que ya veías en la demo, ahora en
-- una base de datos real y compartida entre todos los usuarios.
-- Si ya corriste este script antes, bórralos primero o quita
-- este bloque para no duplicarlos.
-- ============================================================

insert into public.vehicles
  (unit, plate, brand, model, year, color, photo, "healthScore", "kmActual", "kmProximoServicio", "oilType", "avgConsumption",
   driver, insurance, "circulationCard", verification, warranty, "documentHistory", "maintenancePanel", tires, history, gps, "appCapture")
values
(
  'Unidad 12','YZA-142-B','Kenworth','T680',2022,'Blanco','https://picsum.photos/seed/navio-unidad12/480/280',88,152400,155000,'Sintético 15W-40',3.8,
  '{"name":"Ricardo Pérez","phone":"+52 921 123 4567","photo":"https://api.dicebear.com/7.x/avataaars/svg?seed=RicardoPerez","license":"LIC-8845213","licenseExpiry":"2026-09-02"}',
  '{"company":"Qualitas","folio":"QLT-559012","expiry":"2026-11-15","pdfUrl":"#"}',
  '{"folio":"TC-2026-4471","pdfUrl":"#"}',
  '{"hologram":"00 (Doble Cero)","validity":"2027-02-28"}',
  '{"engine":"Motor Cummins X15 — vigente hasta 2027-06-30","parts":"Piezas de transmisión — vigente hasta 2026-12-31"}',
  '[{"doc":"Póliza de Seguro (anterior)","expired":"2025-11-15","pdfUrl":"#"},{"doc":"Tarjeta de Circulación (anterior)","expired":"2025-04-30","pdfUrl":"#"}]',
  '{"kmRestante":2600,"coolantType":"Refrigerante Verde","brakesLast":"2026-06-18","oilLast":"2026-07-02"}',
  '{"frontDepth":7.2,"rearDepth":5.8,"frontSize":"185/60 R15","rearSize":"190/60 R15","psi":110,"lastRotation":"2026-07-15"}',
  '[{"date":"2026-07-02","concept":"Cambio de aceite y filtro","cost":1850,"workshop":"Taller Central Coatzacoalcos"},{"date":"2026-06-18","concept":"Cambio de balatas delanteras","cost":3200,"workshop":"Frenos y Diesel del Sur"},{"date":"2026-05-10","concept":"Alineación y balanceo","cost":950,"workshop":"Llantas del Golfo"}]',
  '{"status":"moving","address":"Carretera Nanchital–Coatzacoalcos, km 8.4","speed":68,"lastUpdate":"hace 2 min","fuelPercent":62,"signalType":"GPS Hardware","x":30,"y":55,"mode":"directo","destination":"Coatzacoalcos","eta":"1.1 hrs","stops":[]}',
  '{"photoUrl":"https://picsum.photos/seed/navio-capture12/480/280","timestamp":"12/08/2026 09:14","driverName":"Ricardo Pérez"}'
),
(
  'Unidad 07','XKT-880-A','Freightliner','Cascadia',2020,'Gris','https://picsum.photos/seed/navio-unidad07/480/280',62,208900,210000,'Sintético 15W-40',3.4,
  '{"name":"Lucía Gómez","phone":"+52 921 234 5678","photo":"https://api.dicebear.com/7.x/avataaars/svg?seed=LuciaGomez","license":"LIC-7723190","licenseExpiry":"2026-08-25"}',
  '{"company":"GNP Seguros","folio":"GNP-330217","expiry":"2026-08-30","pdfUrl":"#"}',
  '{"folio":"TC-2025-9012","pdfUrl":"#"}',
  '{"hologram":"0 (Cero)","validity":"2026-09-30"}',
  '{"engine":"Motor Detroit DD15 — vigente hasta 2026-10-01","parts":"Piezas de suspensión — vencida 2026-02-15"}',
  '[{"doc":"Póliza de Seguro (anterior)","expired":"2025-08-30","pdfUrl":"#"},{"doc":"Verificación Vehicular (anterior)","expired":"2026-02-28","pdfUrl":"#"}]',
  '{"kmRestante":1100,"coolantType":"Refrigerante Rosa (OAT)","brakesLast":"2026-08-08","oilLast":"2026-06-15"}',
  '{"frontDepth":6.1,"rearDepth":4.1,"frontSize":"185/60 R15","rearSize":"190/60 R15","psi":105,"lastRotation":"2026-05-30"}',
  '[{"date":"2026-08-08","concept":"Cambio de balatas delanteras","cost":3200,"workshop":"Frenos y Diesel del Sur"},{"date":"2026-06-15","concept":"Cambio de aceite y filtro","cost":1780,"workshop":"Taller Central Coatzacoalcos"},{"date":"2026-04-02","concept":"Reparación de suspensión","cost":5400,"workshop":"Suspensiones del Istmo"}]',
  '{"status":"stopped","address":"Bama Solís, Coatzacoalcos","speed":0,"lastUpdate":"hace 8 min","fuelPercent":18,"signalType":"Smartphone App","x":55,"y":40,"mode":"libre","destination":null,"eta":null,"stops":[{"place":"Bama Solís","time":"17:52"}]}',
  '{"photoUrl":"https://picsum.photos/seed/navio-capture07/480/280","timestamp":"11/08/2026 17:52","driverName":"Lucía Gómez"}'
),
(
  'Unidad 09','WPL-215-C','International','LT625',2019,'Azul','https://picsum.photos/seed/navio-unidad09/480/280',41,261300,262000,'Mineral 20W-50',2.9,
  '{"name":"Marco Aguilar","phone":"+52 921 345 6789","photo":"https://api.dicebear.com/7.x/avataaars/svg?seed=MarcoAguilar","license":"LIC-6612044","licenseExpiry":"2027-01-14"}',
  '{"company":"AXA Seguros","folio":"AXA-118845","expiry":"2026-09-05","pdfUrl":"#"}',
  '{"folio":"TC-2025-3387","pdfUrl":"#"}',
  '{"hologram":"1 (Uno)","validity":"2026-08-31"}',
  '{"engine":"Motor Navistar N9 — vencida 2025-12-01","parts":"Piezas de embrague — vencida 2026-01-10"}',
  '[{"doc":"Tarjeta de Circulación (anterior)","expired":"2024-12-31","pdfUrl":"#"},{"doc":"Licencia de Conducir (anterior)","expired":"2025-06-14","pdfUrl":"#"}]',
  '{"kmRestante":700,"coolantType":"Refrigerante Verde","brakesLast":"2026-07-22","oilLast":"2026-05-20"}',
  '{"frontDepth":4.8,"rearDepth":3.6,"frontSize":"185/60 R15","rearSize":"190/60 R15","psi":98,"lastRotation":"2026-03-11"}',
  '[{"date":"2026-07-22","concept":"Servicio completo de frenos","cost":4100,"workshop":"Frenos y Diesel del Sur"},{"date":"2026-05-20","concept":"Cambio de aceite y filtro","cost":1650,"workshop":"Taller Central Coatzacoalcos"},{"date":"2026-02-18","concept":"Cambio de embrague","cost":7200,"workshop":"Transmisiones Golfo"}]',
  '{"status":"resting","address":"Patio Nanchital","speed":0,"lastUpdate":"hace 3 h","fuelPercent":44,"signalType":"GPS Hardware","x":15,"y":75,"mode":"libre","destination":null,"eta":null,"stops":[{"place":"Patio Nanchital","time":"08:30"}]}',
  '{"photoUrl":"https://picsum.photos/seed/navio-capture09/480/280","timestamp":"10/08/2026 08:30","driverName":"Marco Aguilar"}'
),
(
  'Unidad 03','VJH-004-D','Volvo','VNL 760',2023,'Rojo','https://picsum.photos/seed/navio-unidad03/480/280',95,64200,70000,'Sintético 5W-30',4.3,
  '{"name":"Diana Ruiz","phone":"+52 921 456 7890","photo":"https://api.dicebear.com/7.x/avataaars/svg?seed=DianaRuiz","license":"LIC-9910238","licenseExpiry":"2027-05-19"}',
  '{"company":"Qualitas","folio":"QLT-772104","expiry":"2027-01-20","pdfUrl":"#"}',
  '{"folio":"TC-2026-1120","pdfUrl":"#"}',
  '{"hologram":"00 (Doble Cero)","validity":"2027-06-30"}',
  '{"engine":"Motor Volvo D13 — vigente hasta 2028-01-15","parts":"Piezas de frenos — vigente hasta 2027-01-20"}',
  '[{"doc":"Tarjeta de Circulación (anterior)","expired":"2025-01-20","pdfUrl":"#"}]',
  '{"kmRestante":5800,"coolantType":"Refrigerante Azul (IAT)","brakesLast":"2026-05-02","oilLast":"2026-07-28"}',
  '{"frontDepth":8.4,"rearDepth":7.9,"frontSize":"185/60 R15","rearSize":"190/60 R15","psi":112,"lastRotation":"2026-07-01"}',
  '[{"date":"2026-08-01","concept":"Verificación vehicular","cost":850,"workshop":"Verificentro Coatzacoalcos"},{"date":"2026-07-28","concept":"Revisión de niveles","cost":0,"workshop":"Taller Central Coatzacoalcos"},{"date":"2026-05-02","concept":"Cambio de balatas traseras","cost":2900,"workshop":"Frenos y Diesel del Sur"}]',
  '{"status":"moving","address":"Av. Independencia, Coatzacoalcos","speed":42,"lastUpdate":"hace 1 min","fuelPercent":81,"signalType":"GPS Hardware","x":60,"y":65,"mode":"directo","destination":"Coatzacoalcos Centro","eta":"22 min","stops":[]}',
  '{"photoUrl":"https://picsum.photos/seed/navio-capture03/480/280","timestamp":"12/08/2026 07:05","driverName":"Diana Ruiz"}'
),
(
  'Unidad 21','TBN-561-E','Kenworth','T880',2021,'Negro','https://picsum.photos/seed/navio-unidad21/480/280',74,118750,121000,'Sintético 15W-40',3.6,
  '{"name":"José Torres","phone":"+52 921 567 8901","photo":"https://api.dicebear.com/7.x/avataaars/svg?seed=JoseTorres","license":"LIC-5591027","licenseExpiry":"2026-12-11"}',
  '{"company":"GNP Seguros","folio":"GNP-441093","expiry":"2026-10-08","pdfUrl":"#"}',
  '{"folio":"TC-2026-6650","pdfUrl":"#"}',
  '{"hologram":"0 (Cero)","validity":"2026-11-30"}',
  '{"engine":"Motor Cummins X15 — vigente hasta 2026-09-10","parts":"Piezas de transmisión — vencida 2026-03-05"}',
  '[{"doc":"Póliza de Seguro (anterior)","expired":"2025-10-08","pdfUrl":"#"},{"doc":"Tarjeta de Circulación (anterior)","expired":"2025-12-31","pdfUrl":"#"}]',
  '{"kmRestante":2250,"coolantType":"Refrigerante Verde","brakesLast":"2026-04-19","oilLast":"2026-06-30"}',
  '{"frontDepth":6.6,"rearDepth":5.2,"frontSize":"185/60 R15","rearSize":"190/60 R15","psi":108,"lastRotation":"2026-08-05"}',
  '[{"date":"2026-08-05","concept":"Rotación de llantas 4 posiciones","cost":600,"workshop":"Llantas del Golfo"},{"date":"2026-06-30","concept":"Cambio de aceite y filtro","cost":1900,"workshop":"Taller Central Coatzacoalcos"},{"date":"2026-04-19","concept":"Cambio de balatas delanteras","cost":3050,"workshop":"Frenos y Diesel del Sur"}]',
  '{"status":"alert","address":"Puente peatonal, Coatzacoalcos — tráfico intenso","speed":12,"lastUpdate":"hace 30 seg","fuelPercent":37,"signalType":"WhatsApp Share","x":70,"y":28,"mode":"directo","destination":"Coatzacoalcos","eta":"1.2 hrs","stops":[]}',
  '{"photoUrl":"https://picsum.photos/seed/navio-capture21/480/280","timestamp":"12/08/2026 10:47","driverName":"José Torres"}'
);

insert into public.maintenance_records (unit, plate, category, concept, amount, date, vendor, "invoiceFolio", origin, status, notes) values
('Unidad 12','YZA-142-B','engine','Cambio de aceite y filtro',1850,'2026-08-10','Taller Central Coatzacoalcos','FA-33210','whatsapp','pending','Reportado por conductor R. Pérez'),
('Unidad 07','XKT-880-A','brakes','Cambio de balatas delanteras',3200,'2026-08-08','Frenos y Diesel del Sur','FA-33198','telegram','pending',''),
('Unidad 21','TBN-561-E','tires','Rotación de llantas 4 posiciones',600,'2026-08-05','Llantas del Golfo','FA-33172','manual','verified','Registrado por taller interno'),
('Unidad 03','VJH-004-D','paperwork','Verificación vehicular',850,'2026-08-01','Verificentro Coatzacoalcos','FA-33140','whatsapp','pending',''),
('Unidad 09','WPL-215-C','brakes','Servicio completo de frenos',4100,'2026-07-22','Frenos y Diesel del Sur','FA-33065','whatsapp','verified','Validado por supervisor'),
('Unidad 12','YZA-142-B','engine','Revisión de niveles',0,'2026-07-28','Taller Central Coatzacoalcos','','manual','verified','');

insert into public.compliance_records (unit, plate, "docType", concept, amount, date, "dueDate", "paymentStatus", vendor, "invoiceFolio", origin, status, notes) values
('Unidad 12','YZA-142-B','Tenencia','Pago de tenencia estatal 2026',1850,'2026-08-09','2026-08-31','Pendiente de Pago','Sec. Finanzas Veracruz','TEN-2026-0912','whatsapp','pending',''),
('Unidad 07','XKT-880-A','Póliza de Seguro','Renovación de póliza anual',18400,'2026-08-02','2026-08-30','Pendiente de Pago','GNP Seguros','GNP-330217','manual','verified','Cotización enviada al cliente'),
('Unidad 03','VJH-004-D','Verificación Vehicular','Verificación semestral',850,'2026-08-01','2027-01-31','Pagado','Verificentro Coatzacoalcos','FA-33140','whatsapp','verified',''),
('Unidad 09','WPL-215-C','Licencia de Conducir','Renovación licencia federal — M. Aguilar',2100,'2026-07-29','2027-01-14','Pagado','SICT','LIC-6612044','telegram','pending',''),
('Unidad 21','TBN-561-E','Tarjeta de Circulación','Refrendo tarjeta de circulación',620,'2026-07-20','2026-12-31','Pagado','Sec. Finanzas Veracruz','TC-2026-6650','manual','verified','');

insert into public.fuel_records (unit, plate, station, liters, amount, odometer, efficiency, date, vendor, "invoiceFolio", origin, status, notes) values
('Unidad 07','XKT-880-A','Pemex Nanchital',180,3960,208900,3.4,'2026-08-12','Pemex Nanchital','T-99021','whatsapp','pending','Ticket foto procesado por OCR'),
('Unidad 12','YZA-142-B','Pemex Coatzacoalcos Centro',210,4620,152400,3.8,'2026-08-11','Pemex Coatzacoalcos Centro','T-98884','whatsapp','verified',''),
('Unidad 21','TBN-561-E','G500 Coatzacoalcos',195,4290,118750,3.6,'2026-08-10','G500 Coatzacoalcos','T-98701','telegram','pending',''),
('Unidad 09','WPL-215-C','Pemex Nanchital',165,3630,261300,2.9,'2026-08-09','Pemex Nanchital','T-98530','manual','verified','Capturado por despachador'),
('Unidad 03','VJH-004-D','Pemex Coatzacoalcos Centro',175,3850,64200,4.3,'2026-08-08','Pemex Coatzacoalcos Centro','T-98315','whatsapp','verified','');

insert into public.trips (unit, driver, "tripType", origin, destination, date, cargo, status) values
('Unidad 12','Ricardo Pérez','cargo','Nanchital','Coatzacoalcos','2026-08-12','Carga general — 12 ton','ongoing'),
('Unidad 03','Diana Ruiz','cargo','Coatzacoalcos','Minatitlán','2026-08-12','Materiales de construcción — 8 ton','ongoing'),
('Unidad 21','José Torres','cargo','Nanchital','Coatzacoalcos','2026-08-12','Contenedor refrigerado','ongoing'),
('Unidad 07','Lucía Gómez','cargo','Coatzacoalcos','Acayucan','2026-08-13','Paquetería industrial','scheduled'),
('Unidad 09','Marco Aguilar','cargo','Patio Nanchital','Coatzacoalcos','2026-08-10','Equipo pesado','completed');

insert into public.incidents (unit, severity, status, description, "reportedBy", date) values
('Unidad 21','high','attending','Tráfico intenso y posible retención en puente peatonal','José Torres','2026-08-12'),
('Unidad 09','critical','open','Falla mecánica — sobrecalentamiento de motor','Marco Aguilar','2026-08-10'),
('Unidad 07','medium','resolved','Ponchadura de llanta trasera derecha','Lucía Gómez','2026-08-05'),
('Unidad 12','low','resolved','Retraso menor por cierre parcial de vialidad','Ricardo Pérez','2026-08-02');

insert into public.community_posts (title, description, category, status, votes, author, date) values
('Exportar historial de mantenimiento en PDF','Sería útil poder exportar el historial de servicios de una unidad directamente en PDF para compartirlo con el cliente.','feature','next',7,'Johana','2026-08-05'),
('La confirmación de tickets tarda en reflejarse','A veces al confirmar un ticket de combustible el estado no cambia hasta recargar la página.','bug','in-progress',4,'Ricardo Pérez','2026-08-02'),
('Notificaciones push para vencimientos','Agregar notificaciones push (no solo la campanita) cuando una tenencia o póliza esté por vencer.','feature','backlog',5,'Lucía Gómez','2026-07-28'),
('Modo oscuro','El dashboard se usa mucho de noche en la central de monitoreo; un modo oscuro ayudaría bastante a la vista.','feature','backlog',3,'José Torres','2026-07-20'),
('Historial de documentos no carga en móvil','En pantallas pequeñas la sección de Trámites del expediente no muestra el historial de documentos anteriores.','bug','done',6,'Marco Aguilar','2026-07-10');

-- ============================================================
-- Listo. Verifica en Table Editor que las 9 tablas existen y
-- tienen filas. El "votes" de community_posts en los datos
-- semilla es fijo (no viene de community_votes real) — en
-- cuanto alguien vote de verdad desde la app, el trigger toma
-- el control y lo mantiene sincronizado a partir de ahí.
-- ============================================================
