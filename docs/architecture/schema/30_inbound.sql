-- =============================================================================
-- 30_inbound.sql — Gate Entry, Inward, GRN, Discrepancy, Inspection, Put-away,
--                  Warehouse Receipt
-- Blueprint refs: §16–§22
-- =============================================================================

-- ---------- Gate Entry (§16) ------------------------------------------------
create table gate_entries (
  id             uuid primary key,
  tenant_id      uuid not null references tenants(id),
  number         text not null,             -- GE/26-27/000001
  warehouse_id   uuid not null references warehouses(id),
  direction      text not null check (direction in ('in','out')),
  entry_at       timestamptz not null,      -- date + time of gate-in
  exit_at        timestamptz,               -- gate-out time (set when vehicle leaves)
  customer_id    uuid references customers(id),
  vehicle_id     uuid references vehicles(id),
  vehicle_number text,                      -- snapshot / ad-hoc vehicle not in master
  driver_id      uuid references drivers(id),
  driver_name    text, driver_mobile text,  -- snapshot / ad-hoc
  transporter_id uuid references transporters(id),
  transporter_name text,
  purpose        text not null check (purpose in ('inward','dispatch','return','transfer','visitor','other')),
  reference_no   text,                      -- LR / invoice / PO / release order number typed at the gate
  remarks        text,
  status         text not null default 'open' check (status in ('open','linked','closed','cancelled')),
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (tenant_id, number)
);
create index on gate_entries (tenant_id, warehouse_id, entry_at desc);

-- ---------- Inward (§17) ----------------------------------------------------
create table inwards (
  id             uuid primary key,
  tenant_id      uuid not null references tenants(id),
  number         text not null,             -- IN/26-27/000001
  inward_at      timestamptz not null,
  warehouse_id   uuid not null references warehouses(id),
  customer_id    uuid not null references customers(id),
  supplier_id    uuid references suppliers(id),
  supplier_name  text,
  gate_entry_id  uuid references gate_entries(id),
  -- transport (auto-filled from gate entry / vehicle master, editable)
  vehicle_id uuid references vehicles(id), vehicle_number text,
  driver_id  uuid references drivers(id),  driver_name text, driver_mobile text,
  transporter_id uuid references transporters(id), transporter_name text,
  lr_number      text, lr_date date,
  -- commercial
  invoice_number text, invoice_date date, invoice_value numeric(14,2),
  eway_bill_number text, eway_bill_date date,
  po_number      text,
  remarks        text,
  status         text not null default 'draft' check (status in ('draft','received','grn_created','cancelled')),
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (tenant_id, number)
);
create index on inwards (tenant_id, warehouse_id, inward_at desc);
create index on inwards (tenant_id, customer_id);

create table inward_items (
  id            uuid primary key,
  tenant_id     uuid not null references tenants(id),
  inward_id     uuid not null references inwards(id) on delete cascade,
  line_no       smallint not null,
  product_id    uuid not null references products(id),
  product_snapshot jsonb not null,          -- {sku,name,hsn,uom,weight_kg,...} at time of entry
  batch_no      text,
  mfg_date      date, expiry_date date,
  expected_qty  numeric(14,3) not null default 0,
  received_qty  numeric(14,3) not null default 0,
  accepted_qty  numeric(14,3) not null default 0,
  rejected_qty  numeric(14,3) not null default 0,
  packages      integer,
  package_type  text,                       -- 'box','bag','pallet','drum','loose'
  gross_weight_kg numeric(14,3),
  condition     text check (condition in ('good','damaged','partially_damaged','wet','tampered','other')),
  remarks       text,
  unique (inward_id, line_no)
);

-- ---------- GRN (§18) -------------------------------------------------------
create table grns (
  id             uuid primary key,
  tenant_id      uuid not null references tenants(id),
  number         text not null,             -- GRN/26-27/000001
  grn_date       date not null,
  warehouse_id   uuid not null references warehouses(id),
  customer_id    uuid not null references customers(id),
  supplier_id    uuid references suppliers(id),
  supplier_name  text,
  inward_id      uuid references inwards(id),
  gate_entry_id  uuid references gate_entries(id),
  return_inward_id uuid,                    -- -> return_inwards (returns post stock via GRN too)
  vehicle_id uuid references vehicles(id), vehicle_number text,
  driver_id  uuid references drivers(id),  driver_name text, driver_mobile text,
  transporter_id uuid references transporters(id), transporter_name text,
  lr_number text, lr_date date,
  invoice_number text, invoice_date date,
  eway_bill_number text,
  po_number      text,
  remarks        text,
  status         text not null default 'draft' check (status in ('draft','submitted','checked','approved','rejected','cancelled','reversed')),
  submitted_at timestamptz, submitted_by uuid,
  checked_at   timestamptz, checked_by   uuid,
  approved_at  timestamptz, approved_by  uuid,
  stock_posted_at timestamptz,              -- set exactly once when ledger entries are written
  reversed_by_grn_id uuid references grns(id),    -- controlled reversal after approval (§50)
  has_discrepancy boolean not null default false, -- derived: any line short/excess/damaged
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (tenant_id, number)
);
create index on grns (tenant_id, status);
create index on grns (tenant_id, customer_id, grn_date desc);

create table grn_items (
  id             uuid primary key,
  tenant_id      uuid not null references tenants(id),
  grn_id         uuid not null references grns(id) on delete cascade,
  line_no        smallint not null,
  inward_item_id uuid references inward_items(id),
  product_id     uuid not null references products(id),
  product_snapshot jsonb not null,
  batch_id       uuid,                      -- -> batches (created/resolved at approval)
  batch_no       text,
  mfg_date date, expiry_date date,
  expected_qty   numeric(14,3) not null default 0,
  received_qty   numeric(14,3) not null default 0,
  accepted_qty   numeric(14,3) not null default 0,   -- this is what posts to stock
  rejected_qty   numeric(14,3) not null default 0,
  damaged_qty    numeric(14,3) not null default 0,
  short_qty      numeric(14,3) generated always as (greatest(expected_qty - received_qty, 0)) stored,
  excess_qty     numeric(14,3) generated always as (greatest(received_qty - expected_qty, 0)) stored,
  packages       integer,
  package_type   text,
  gross_weight_kg numeric(14,3),
  condition      text,
  remarks        text,
  unique (grn_id, line_no),
  check (accepted_qty + rejected_qty <= received_qty)
);

create table grn_item_serials (
  id          uuid primary key,
  tenant_id   uuid not null references tenants(id),
  grn_item_id uuid not null references grn_items(id) on delete cascade,
  serial_no   text not null,
  accepted    boolean not null default true,
  unique (grn_item_id, serial_no)
);

-- ---------- Discrepancy / Damage Report (§19) ---------------------------------
create table discrepancy_reports (
  id            uuid primary key,
  tenant_id     uuid not null references tenants(id),
  number        text not null,              -- DR/26-27/000001
  report_date   date not null,
  grn_id        uuid references grns(id),
  pod_id        uuid,                       -- -> pods (delivery-side shortage/damage)
  return_inward_id uuid,                    -- -> return_inwards
  customer_id   uuid not null references customers(id),
  supplier_id   uuid references suppliers(id),
  supplier_name text,
  warehouse_id  uuid not null references warehouses(id),
  reason        text,
  driver_ack_name text, driver_ack_at timestamptz, driver_ack_signature_attachment_id uuid,
  warehouse_ack_by uuid references users(id), warehouse_ack_at timestamptz,
  remarks       text,
  status        text not null default 'draft' check (status in ('draft','submitted','acknowledged','closed','cancelled')),
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (tenant_id, number)
);

create table discrepancy_items (
  id            uuid primary key,
  tenant_id     uuid not null references tenants(id),
  report_id     uuid not null references discrepancy_reports(id) on delete cascade,
  grn_item_id   uuid references grn_items(id),
  product_id    uuid not null references products(id),
  product_snapshot jsonb not null,
  batch_no      text,
  expected_qty  numeric(14,3) not null default 0,
  received_qty  numeric(14,3) not null default 0,
  short_qty     numeric(14,3) not null default 0,
  excess_qty    numeric(14,3) not null default 0,
  damaged_qty   numeric(14,3) not null default 0,
  reason        text,
  remarks       text
);
-- photos: attachments(owner_type='discrepancy_report', category='photo')

-- ---------- Inspection (§20) ------------------------------------------------
create table inspections (
  id            uuid primary key,
  tenant_id     uuid not null references tenants(id),
  number        text not null,              -- INS/26-27/000001
  inspection_at timestamptz not null,
  grn_id        uuid references grns(id),
  return_inward_id uuid,                    -- -> return_inwards
  warehouse_id  uuid not null references warehouses(id),
  customer_id   uuid not null references customers(id),
  inspector_user_id uuid references users(id),
  inspector_name text,
  overall_result text check (overall_result in ('accepted','partially_accepted','rejected')),
  remarks       text,
  status        text not null default 'draft' check (status in ('draft','completed','cancelled')),
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (tenant_id, number)
);

create table inspection_items (
  id            uuid primary key,
  tenant_id     uuid not null references tenants(id),
  inspection_id uuid not null references inspections(id) on delete cascade,
  grn_item_id   uuid references grn_items(id),
  product_id    uuid not null references products(id),
  batch_no      text,
  quantity      numeric(14,3) not null,
  packaging_condition text check (packaging_condition in ('intact','damaged','wet','opened','other')),
  seal_condition text check (seal_condition in ('intact','broken','not_applicable')),
  visible_damage boolean not null default false,
  quality_remarks text,
  result        text not null check (result in ('accepted','rejected')),
  accepted_qty  numeric(14,3),
  rejected_qty  numeric(14,3)
);

-- ---------- Put-away (§21) --------------------------------------------------
create table putaways (
  id            uuid primary key,
  tenant_id     uuid not null references tenants(id),
  number        text not null,              -- PA/26-27/000001
  grn_id        uuid not null references grns(id),
  warehouse_id  uuid not null references warehouses(id),
  customer_id   uuid not null references customers(id),
  assigned_to   uuid references users(id),
  status        text not null default 'pending' check (status in ('pending','in_progress','completed','cancelled')),
  started_at timestamptz, completed_at timestamptz, completed_by uuid,
  created_at timestamptz not null default now(), created_by uuid,
  unique (tenant_id, number),
  unique (grn_id)
);

create table putaway_lines (
  id            uuid primary key,
  tenant_id     uuid not null references tenants(id),
  putaway_id    uuid not null references putaways(id) on delete cascade,
  grn_item_id   uuid not null references grn_items(id),
  product_id    uuid not null references products(id),
  batch_id      uuid,
  quantity      numeric(14,3) not null,     -- may split one GRN item over several locations
  to_location_id uuid not null references locations(id),
  stock_lot_id  uuid,                       -- -> stock_lots (set when line is confirmed)
  confirmed_at  timestamptz, confirmed_by uuid
);

-- ---------- Warehouse Receipt (§22) -----------------------------------------
-- Operational (non-negotiable) receipt issued to the customer for accepted stock.
create table warehouse_receipts (
  id            uuid primary key,
  tenant_id     uuid not null references tenants(id),
  number        text not null,              -- WR/26-27/000001
  receipt_date  date not null,
  grn_id        uuid not null references grns(id),
  putaway_id    uuid references putaways(id),
  warehouse_id  uuid not null references warehouses(id),
  customer_id   uuid not null references customers(id),
  customer_snapshot jsonb not null,
  lines         jsonb not null,             -- frozen: [{sku,name,batch,qty,uom,location,packages,weight}]
  declared_value numeric(14,2),             -- customer-declared value of goods, optional
  remarks       text,
  status        text not null default 'issued' check (status in ('issued','cancelled')),
  created_at timestamptz not null default now(), created_by uuid,
  unique (tenant_id, number),
  unique (grn_id)
);
