-- =============================================================================
-- 50_outbound.sql — Release Order, Pick List, Packing List, Dispatch, Loading
--                   Sheet, Gate Pass, POD, Returns
-- Blueprint refs: §29–§37
-- =============================================================================

-- ---------- Release Order (§29, §30) ----------------------------------------
create table release_orders (
  id             uuid primary key,
  tenant_id      uuid not null references tenants(id),
  number         text not null,             -- RO/26-27/000001
  order_date     date not null,
  requested_date date,
  customer_id    uuid not null references customers(id),
  warehouse_id   uuid not null references warehouses(id),
  consignee_name text,
  consignee_address text,
  delivery_address_id uuid references customer_addresses(id),
  delivery_address_snapshot jsonb,
  transport_mode text,                      -- 'customer_vehicle','company_vehicle','third_party'
  vehicle_id uuid references vehicles(id), driver_id uuid references drivers(id),
  instructions    text,
  status          text not null default 'draft' check (status in
                    ('draft','approved','reserved','partially_picked','picked',
                     'dispatched','completed','cancelled')),
  approved_at timestamptz, approved_by uuid,
  cancelled_at timestamptz, cancelled_by uuid, cancellation_reason text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (tenant_id, number)
);
create index on release_orders (tenant_id, customer_id, status);

create table release_order_lines (
  id             uuid primary key,
  tenant_id      uuid not null references tenants(id),
  release_order_id uuid not null references release_orders(id) on delete cascade,
  line_no        smallint not null,
  product_id     uuid not null references products(id),
  batch_id       uuid references batches(id),           -- optional: customer may ask for a specific batch
  requested_qty  numeric(14,3) not null,
  reserved_qty   numeric(14,3) not null default 0,
  picked_qty     numeric(14,3) not null default 0,
  dispatched_qty numeric(14,3) not null default 0,
  uom_code       text not null,
  unique (release_order_id, line_no)
);

-- Reservation is expressed purely as stock_ledger rows with txn_type
-- RESERVE/UNRESERVE referencing source_type='release_order'. No separate
-- reservation table is needed; stock_lots.reserved_qty is the running balance.

-- ---------- Pick List (§31) -------------------------------------------------
create table pick_lists (
  id             uuid primary key,
  tenant_id      uuid not null references tenants(id),
  number         text not null,             -- PL/26-27/000001
  release_order_id uuid not null references release_orders(id),
  warehouse_id   uuid not null references warehouses(id),
  customer_id    uuid not null references customers(id),
  allocation_policy text not null default 'fifo' check (allocation_policy in ('fifo','lifo','fefo','nearest_location','manual')),
  picker_user_id uuid references users(id),
  status         text not null default 'pending' check (status in ('pending','in_progress','completed','cancelled')),
  started_at timestamptz, completed_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid,
  unique (tenant_id, number)
);

create table pick_list_lines (
  id                uuid primary key,
  tenant_id         uuid not null references tenants(id),
  pick_list_id      uuid not null references pick_lists(id) on delete cascade,
  release_order_line_id uuid not null references release_order_lines(id),
  product_id        uuid not null references products(id),
  batch_id          uuid references batches(id),
  location_id       uuid not null references locations(id),
  required_qty      numeric(14,3) not null,
  pick_qty          numeric(14,3) not null default 0,
  picked_at         timestamptz,
  picked_by         uuid references users(id)
);

-- ---------- Packing List (§32) ----------------------------------------------
create table packing_lists (
  id             uuid primary key,
  tenant_id      uuid not null references tenants(id),
  number         text not null,             -- PK/26-27/000001
  release_order_id uuid not null references release_orders(id),
  customer_id    uuid not null references customers(id),
  consignee_name text,
  total_packages integer,
  total_weight_kg numeric(14,3),
  remarks        text,
  created_at timestamptz not null default now(), created_by uuid,
  unique (tenant_id, number)
);

create table packing_list_lines (
  id              uuid primary key,
  tenant_id       uuid not null references tenants(id),
  packing_list_id uuid not null references packing_lists(id) on delete cascade,
  product_id      uuid not null references products(id),
  quantity        numeric(14,3) not null,
  packages        integer,
  box_number      text,
  weight_kg       numeric(14,3),
  remarks         text
);

-- ---------- Dispatch (§33) --------------------------------------------------
create table dispatches (
  id             uuid primary key,
  tenant_id      uuid not null references tenants(id),
  number         text not null,             -- DN/26-27/000001
  dispatch_date  date not null,
  release_order_id uuid not null references release_orders(id),
  pick_list_id   uuid references pick_lists(id),
  packing_list_id uuid references packing_lists(id),
  customer_id    uuid not null references customers(id),
  consignee_name text,
  warehouse_id   uuid not null references warehouses(id),
  invoice_id     uuid,                      -- -> invoices, when invoice precedes dispatch (bill-then-ship)
  lr_number text, lr_date date,
  vehicle_id uuid references vehicles(id), vehicle_number text,
  driver_id  uuid references drivers(id),  driver_name text,
  transporter_id uuid references transporters(id), transporter_name text,
  eway_bill_number text, eway_bill_date date,
  total_packages integer,
  total_weight_kg numeric(14,3),
  remarks        text,
  status         text not null default 'draft' check (status in ('draft','loaded','gate_out','completed','cancelled')),
  created_at timestamptz not null default now(), created_by uuid,
  unique (tenant_id, number)
);

create table dispatch_lines (
  id             uuid primary key,
  tenant_id      uuid not null references tenants(id),
  dispatch_id    uuid not null references dispatches(id) on delete cascade,
  release_order_line_id uuid references release_order_lines(id),
  product_id     uuid not null references products(id),
  batch_id       uuid references batches(id),
  quantity       numeric(14,3) not null,
  uom_code       text not null
);

-- ---------- Loading Sheet (§34) ---------------------------------------------
create table loading_sheets (
  id            uuid primary key,
  tenant_id     uuid not null references tenants(id),
  number        text not null,              -- LS/26-27/000001
  dispatch_id   uuid not null references dispatches(id),
  vehicle_id    uuid references vehicles(id),
  driver_id     uuid references drivers(id),
  seal_number   text,
  loading_started_at timestamptz,
  loading_completed_at timestamptz,
  loaded_by     uuid references users(id),
  status        text not null default 'pending' check (status in ('pending','in_progress','loaded','cancelled')),
  created_at timestamptz not null default now(), created_by uuid,
  unique (tenant_id, number),
  unique (dispatch_id)
);

create table loading_sheet_lines (
  id              uuid primary key,
  tenant_id       uuid not null references tenants(id),
  loading_sheet_id uuid not null references loading_sheets(id) on delete cascade,
  dispatch_line_id uuid not null references dispatch_lines(id),
  product_id      uuid not null references products(id),
  quantity        numeric(14,3) not null,
  weight_kg       numeric(14,3),
  loaded          boolean not null default false
);

-- ---------- Gate Pass (§35) — completes the outward stock transaction --------
create table gate_passes (
  id             uuid primary key,
  tenant_id      uuid not null references tenants(id),
  number         text not null,             -- GP/26-27/000001
  dispatch_id    uuid not null references dispatches(id),
  gate_entry_id  uuid references gate_entries(id),        -- linked outward gate movement
  warehouse_id   uuid not null references warehouses(id),
  customer_id    uuid not null references customers(id),
  vehicle_id uuid references vehicles(id), driver_id uuid references drivers(id),
  invoice_number text,
  lr_number      text,
  eway_bill_number text,
  seal_number    text,
  authorized_by  uuid references users(id),
  gate_out_at    timestamptz,               -- setting this triggers the OUTWARD stock_ledger posting
  stock_posted_at timestamptz,
  status         text not null default 'pending' check (status in ('pending','gate_out','cancelled')),
  created_at timestamptz not null default now(), created_by uuid,
  unique (tenant_id, number),
  unique (dispatch_id)
);

-- ---------- POD (§36) -------------------------------------------------------
create table pods (
  id              uuid primary key,
  tenant_id       uuid not null references tenants(id),
  number          text not null,            -- POD/26-27/000001
  dispatch_id     uuid not null references dispatches(id),
  delivery_date   date,
  receiver_name   text,
  receiver_mobile text,
  signature_attachment_id uuid,
  stamp_attachment_id     uuid,
  status          text not null default 'pending' check (status in ('pending','delivered','short','damaged','rejected')),
  remarks         text,
  captured_by     uuid references users(id),
  captured_at     timestamptz,
  created_at timestamptz not null default now(), created_by uuid,
  unique (tenant_id, number),
  unique (dispatch_id)
);

create table pod_lines (
  id              uuid primary key,
  tenant_id       uuid not null references tenants(id),
  pod_id          uuid not null references pods(id) on delete cascade,
  dispatch_line_id uuid not null references dispatch_lines(id),
  product_id      uuid not null references products(id),
  dispatched_qty  numeric(14,3) not null,
  received_qty    numeric(14,3) not null,
  shortage_qty    numeric(14,3) generated always as (greatest(dispatched_qty - received_qty, 0)) stored,
  damaged_qty     numeric(14,3) not null default 0,
  remarks         text
);
-- photos/attachments: attachments(owner_type='pod', category='photo'|'signed_pod')

-- ---------- Returns (§37) ---------------------------------------------------
create table return_requests (
  id            uuid primary key,
  tenant_id     uuid not null references tenants(id),
  number        text not null,              -- RR/26-27/000001
  request_date  date not null,
  customer_id   uuid not null references customers(id),
  warehouse_id  uuid not null references warehouses(id),
  original_dispatch_id uuid references dispatches(id),
  reason        text,
  status        text not null default 'requested' check (status in ('requested','approved','rejected','received','cancelled')),
  created_at timestamptz not null default now(), created_by uuid,
  unique (tenant_id, number)
);

create table return_request_lines (
  id                uuid primary key,
  tenant_id         uuid not null references tenants(id),
  return_request_id uuid not null references return_requests(id) on delete cascade,
  product_id        uuid not null references products(id),
  batch_id          uuid references batches(id),
  quantity          numeric(14,3) not null
);

create table return_inwards (
  id                uuid primary key,
  tenant_id         uuid not null references tenants(id),
  number            text not null,          -- RI/26-27/000001
  return_request_id uuid references return_requests(id),
  warehouse_id      uuid not null references warehouses(id),
  customer_id       uuid not null references customers(id),
  gate_entry_id     uuid references gate_entries(id),
  vehicle_id uuid references vehicles(id), driver_id uuid references drivers(id),
  grn_id            uuid references grns(id),         -- stock re-enters via a GRN with source flag
  status            text not null default 'draft' check (status in ('draft','inspected','grn_posted','cancelled')),
  created_at timestamptz not null default now(), created_by uuid,
  unique (tenant_id, number)
);

alter table discrepancy_reports
  add constraint discrepancy_reports_return_inward_fk
  foreign key (return_inward_id) references return_inwards(id);
alter table inspections
  add constraint inspections_return_inward_fk
  foreign key (return_inward_id) references return_inwards(id);
alter table grns
  add constraint grns_return_inward_fk
  foreign key (return_inward_id) references return_inwards(id);
