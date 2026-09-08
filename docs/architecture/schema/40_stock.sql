-- =============================================================================
-- 40_stock.sql — Batches, Stock Lots, Stock Ledger (transaction log),
--                Reservations, Stock Transfer, Physical Verification, Adjustment
-- Blueprint refs: §23–§28, §61 (negative stock), §67 (traceability)
--
-- DESIGN NOTE: stock_lots is a materialised balance view maintained ONLY by
-- triggers/service code reading stock_ledger. Application code must never
-- write to stock_lots directly (see ../stock-engine.md §1).
-- =============================================================================

create table batches (
  id            uuid primary key,
  tenant_id     uuid not null references tenants(id),
  customer_id   uuid not null references customers(id),
  product_id    uuid not null references products(id),
  batch_no      text not null,
  mfg_date      date,
  expiry_date   date,
  first_received_at timestamptz not null,  -- drives ageing (§26): oldest GRN date for this batch
  created_at    timestamptz not null default now(),
  unique (tenant_id, customer_id, product_id, batch_no)
);

-- ---------- Stock Lot (materialised balance per tenant×customer×warehouse×
--            location×product×batch×serial) ---------------------------------
create table stock_lots (
  id            uuid primary key,
  tenant_id     uuid not null references tenants(id),
  customer_id   uuid not null references customers(id),
  warehouse_id  uuid not null references warehouses(id),
  location_id   uuid references locations(id),         -- null = unallocated / in-transit
  product_id    uuid not null references products(id),
  batch_id      uuid references batches(id),            -- null when product is not batch-tracked
  serial_no     text,                                   -- null when product is not serial-tracked
  physical_qty  numeric(14,3) not null default 0,
  reserved_qty  numeric(14,3) not null default 0,
  available_qty numeric(14,3) generated always as (physical_qty - reserved_qty) stored,
  uom_code      text not null,
  updated_at    timestamptz not null default now(),
  unique (tenant_id, customer_id, warehouse_id, location_id, product_id, batch_id, serial_no)
);
create index on stock_lots (tenant_id, customer_id, product_id);
create index on stock_lots (tenant_id, warehouse_id, location_id);
-- Negative stock is prevented at the service layer by default; a tenant_settings
-- key 'stock.allow_negative' (§61) may relax the check per company.

-- ---------- Stock Ledger (§24) — the append-only source of truth ------------
-- Every physical or reservation movement is one row here. stock_lots is derived.
create table stock_ledger (
  id             uuid primary key,
  tenant_id      uuid not null references tenants(id),
  txn_at         timestamptz not null default now(),
  txn_type       text not null check (txn_type in
                   ('INWARD','TRANSFER_IN','TRANSFER_OUT','OUTWARD','RETURN',
                    'ADJUSTMENT','RESERVE','UNRESERVE')),
  customer_id    uuid not null references customers(id),
  warehouse_id   uuid not null references warehouses(id),
  location_id    uuid references locations(id),
  product_id     uuid not null references products(id),
  batch_id       uuid references batches(id),
  serial_no      text,
  qty_in         numeric(14,3) not null default 0,      -- physical increase (INWARD, TRANSFER_IN, RETURN, +ADJUSTMENT)
  qty_out        numeric(14,3) not null default 0,       -- physical decrease (OUTWARD, TRANSFER_OUT, -ADJUSTMENT)
  reserved_delta numeric(14,3) not null default 0,       -- +qty on RESERVE, -qty on UNRESERVE; 0 otherwise
  balance_physical_qty numeric(14,3) not null,           -- running balance snapshot at this lot, post-txn
  balance_reserved_qty numeric(14,3) not null,
  uom_code       text not null,
  -- source/reference document (§67 — every stock transaction has a reference)
  source_type    text not null,                          -- 'grn','dispatch','stock_transfer','stock_adjustment',
                                                          -- 'return_inward','release_order','pod'
  source_id      uuid not null,
  source_line_id uuid,                                   -- specific line within the source document
  idempotency_key text not null,                          -- see numbering.md / decisions.md for derivation; prevents double-posting (§61,§70)
  reversal_of_id uuid references stock_ledger(id),        -- set when this row reverses another (controlled reversal, never delete)
  remarks        text,
  created_by     uuid references users(id),
  unique (tenant_id, idempotency_key)
);
create index on stock_ledger (tenant_id, customer_id, product_id, txn_at);
create index on stock_ledger (tenant_id, warehouse_id, location_id, txn_at);
create index on stock_ledger (tenant_id, source_type, source_id);

-- ---------- Stock Transfer Note (§28) ---------------------------------------
create table stock_transfers (
  id             uuid primary key,
  tenant_id      uuid not null references tenants(id),
  number         text not null,             -- ST/26-27/000001
  transfer_date  date not null,
  transfer_kind  text not null check (transfer_kind in ('location','warehouse')),
  customer_id    uuid not null references customers(id),
  from_warehouse_id uuid not null references warehouses(id),
  to_warehouse_id   uuid not null references warehouses(id),
  vehicle_id uuid references vehicles(id), driver_id uuid references drivers(id),
  status         text not null default 'draft' check (status in ('draft','approved','in_transit','completed','cancelled')),
  approved_at timestamptz, approved_by uuid,
  completed_at timestamptz, completed_by uuid,
  remarks        text,
  created_at timestamptz not null default now(), created_by uuid,
  unique (tenant_id, number)
);

create table stock_transfer_lines (
  id               uuid primary key,
  tenant_id        uuid not null references tenants(id),
  transfer_id      uuid not null references stock_transfers(id) on delete cascade,
  product_id       uuid not null references products(id),
  batch_id         uuid references batches(id),
  quantity         numeric(14,3) not null,
  from_location_id uuid references locations(id),
  to_location_id   uuid references locations(id)
);

-- ---------- Physical Stock Verification (§27) --------------------------------
create table stock_verifications (
  id            uuid primary key,
  tenant_id     uuid not null references tenants(id),
  number        text not null,              -- SV/26-27/000001
  verification_date date not null,
  warehouse_id  uuid not null references warehouses(id),
  customer_id   uuid references customers(id),         -- null = whole-warehouse count
  verified_by   uuid references users(id),
  status        text not null default 'draft' check (status in ('draft','completed','cancelled')),
  completed_at  timestamptz,
  created_at timestamptz not null default now(), created_by uuid,
  unique (tenant_id, number)
);

create table stock_verification_lines (
  id              uuid primary key,
  tenant_id       uuid not null references tenants(id),
  verification_id uuid not null references stock_verifications(id) on delete cascade,
  stock_lot_id    uuid references stock_lots(id),
  product_id      uuid not null references products(id),
  batch_id        uuid references batches(id),
  location_id     uuid references locations(id),
  system_qty      numeric(14,3) not null,
  physical_qty    numeric(14,3) not null,
  difference_qty  numeric(14,3) generated always as (physical_qty - system_qty) stored,
  reason          text,
  remarks         text,
  stock_adjustment_id uuid                              -- -> stock_adjustments, set once adjustment is approved & posted
);

-- ---------- Stock Adjustment (§27, approval per §50) -------------------------
create table stock_adjustments (
  id            uuid primary key,
  tenant_id     uuid not null references tenants(id),
  number        text not null,              -- SA/26-27/000001
  adjustment_date date not null,
  warehouse_id  uuid not null references warehouses(id),
  customer_id   uuid not null references customers(id),
  source_verification_id uuid references stock_verifications(id),
  reason        text not null,
  status        text not null default 'draft' check (status in ('draft','pending_manager','pending_owner','approved','rejected','cancelled','posted')),
  requested_by  uuid references users(id),
  manager_approved_by uuid, manager_approved_at timestamptz,
  owner_approved_by   uuid, owner_approved_at   timestamptz,  -- required only when tenant_settings 'approvals.stock_adjustment.owner_required' = true
  posted_at     timestamptz,                -- set when stock_ledger rows are written; posting is final
  created_at timestamptz not null default now(), created_by uuid,
  unique (tenant_id, number)
);

create table stock_adjustment_lines (
  id             uuid primary key,
  tenant_id      uuid not null references tenants(id),
  adjustment_id  uuid not null references stock_adjustments(id) on delete cascade,
  product_id     uuid not null references products(id),
  batch_id       uuid references batches(id),
  location_id    uuid references locations(id),
  quantity_delta numeric(14,3) not null,     -- signed: + increases physical stock, - decreases
  remarks        text
);
