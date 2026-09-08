-- =============================================================================
-- 60_billing.sql — Billing Runs, Invoices, Debit/Credit Notes, Payments,
--                  Customer Outstanding
-- Blueprint refs: §38–§43, §66
-- =============================================================================

-- ---------- Billing Run (§39 "Generate Monthly Billing" preview) ------------
create table billing_runs (
  id            uuid primary key,
  tenant_id     uuid not null references tenants(id),
  customer_id   uuid not null references customers(id),
  warehouse_id  uuid references warehouses(id),        -- null = all warehouses for this customer
  period_start  date not null,
  period_end    date not null,
  rate_card_id  uuid references rate_cards(id),         -- resolved rate card used (§13 priority)
  status        text not null default 'previewed' check (status in ('previewed','invoiced','discarded')),
  -- full computation trace (§66): every charge line with its formula inputs, so the
  -- user can inspect quantity × days × rate before an invoice is created
  calculation   jsonb not null,
  subtotal      numeric(14,2) not null default 0,
  invoice_id    uuid,                                   -- -> invoices, set once accepted
  generated_at  timestamptz not null default now(),
  generated_by  uuid references users(id),
  unique (tenant_id, customer_id, warehouse_id, period_start, period_end)
    -- one active preview per customer/warehouse/period; re-running replaces the 'previewed' row
    -- until it is invoiced (service-layer enforced: only one non-discarded row per key)
);

create table billing_run_lines (
  id             uuid primary key,
  tenant_id      uuid not null references tenants(id),
  billing_run_id uuid not null references billing_runs(id) on delete cascade,
  charge_type_id uuid not null references charge_types(id),
  description    text not null,
  basis          text not null,
  -- formula inputs, kept explicit for transparency (§66)
  quantity       numeric(14,3),
  days           integer,
  rate           numeric(14,4) not null,
  minimum_charge numeric(14,2),
  computed_amount numeric(14,2) not null,   -- max(quantity × days_or_1 × rate, minimum_charge)
  source_type    text,                      -- 'grn','dispatch','loading_sheet','stock_lot' (for storage accrual), 'manual'
  source_id      uuid,
  tax_rate_id    uuid references tax_rates(id),
  sac_code       text
);

-- ---------- Invoice (§40) ---------------------------------------------------
create table invoices (
  id             uuid primary key,
  tenant_id      uuid not null references tenants(id),
  number         text not null,             -- INV/26-27/000001
  invoice_date   date not null,
  customer_id    uuid not null references customers(id),
  billing_run_id uuid references billing_runs(id),
  customer_snapshot jsonb not null,         -- {legal_name,gstin,pan,billing_address,place_of_supply,...}
  company_snapshot  jsonb not null,         -- {legal_name,gstin,address,bank_details,...}
  place_of_supply char(2),
  tax_treatment  text not null check (tax_treatment in ('intra_state','inter_state','export','exempt','nil_rated')),
  subtotal       numeric(14,2) not null default 0,
  cgst_amount    numeric(14,2) not null default 0,
  sgst_amount    numeric(14,2) not null default 0,
  igst_amount    numeric(14,2) not null default 0,
  round_off      numeric(14,2) not null default 0,
  grand_total    numeric(14,2) not null default 0,
  amount_paid    numeric(14,2) not null default 0,
  balance_due    numeric(14,2) generated always as (grand_total - amount_paid) stored,
  payment_terms  text,
  due_date       date,
  status         text not null default 'draft' check (status in
                   ('draft','pending_approval','approved','issued','partially_paid','paid','overdue','cancelled')),
  approved_at timestamptz, approved_by uuid,
  issued_at   timestamptz,
  cancelled_at timestamptz, cancelled_by uuid, cancellation_reason text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (tenant_id, number)
);
create index on invoices (tenant_id, customer_id, status);
create index on invoices (tenant_id, due_date) where status in ('issued','partially_paid','overdue');

create table invoice_lines (
  id             uuid primary key,
  tenant_id      uuid not null references tenants(id),
  invoice_id     uuid not null references invoices(id) on delete cascade,
  line_no        smallint not null,
  billing_run_line_id uuid references billing_run_lines(id),
  charge_type_id uuid not null references charge_types(id),
  description    text not null,
  hsn_sac_code   text,
  quantity       numeric(14,3) not null default 1,
  uom_code       text,
  rate           numeric(14,4) not null,
  amount         numeric(14,2) not null,
  tax_rate_id    uuid references tax_rates(id),
  tax_rate_pct   numeric(5,2) not null default 0,
  cgst_amount    numeric(14,2) not null default 0,
  sgst_amount    numeric(14,2) not null default 0,
  igst_amount    numeric(14,2) not null default 0,
  line_total     numeric(14,2) not null,
  unique (invoice_id, line_no)
);

-- ---------- Debit / Credit Note (§41) ---------------------------------------
create table credit_debit_notes (
  id             uuid primary key,
  tenant_id      uuid not null references tenants(id),
  number         text not null,             -- CN/26-27/000001 or DN2/26-27/000001 (numbering.md keeps DN distinct from Dispatch Note)
  note_type      text not null check (note_type in ('credit','debit')),
  note_date      date not null,
  customer_id    uuid not null references customers(id),
  invoice_id     uuid references invoices(id),          -- reference to original invoice where applicable
  reason         text not null,
  subtotal       numeric(14,2) not null default 0,
  tax_total      numeric(14,2) not null default 0,
  grand_total    numeric(14,2) not null default 0,
  status         text not null default 'draft' check (status in ('draft','pending_approval','approved','issued','cancelled')),
  approved_at timestamptz, approved_by uuid,
  created_at timestamptz not null default now(), created_by uuid,
  unique (tenant_id, number)
);

create table credit_debit_note_lines (
  id           uuid primary key,
  tenant_id    uuid not null references tenants(id),
  note_id      uuid not null references credit_debit_notes(id) on delete cascade,
  description  text not null,
  hsn_sac_code text,
  quantity     numeric(14,3) not null default 1,
  rate         numeric(14,4) not null,
  amount       numeric(14,2) not null,
  tax_rate_id  uuid references tax_rates(id),
  tax_amount   numeric(14,2) not null default 0,
  line_total   numeric(14,2) not null
);

-- ---------- Payment Receipt (§42) -------------------------------------------
create table payment_receipts (
  id             uuid primary key,
  tenant_id      uuid not null references tenants(id),
  number         text not null,             -- RCPT/26-27/000001
  customer_id    uuid not null references customers(id),
  payment_date   date not null,
  amount         numeric(14,2) not null,
  payment_mode   text not null check (payment_mode in ('cash','cheque','neft','rtgs','imps','upi','card','other')),
  reference_number text,                    -- cheque no / UTR / transaction id
  remarks        text,
  status         text not null default 'posted' check (status in ('posted','cancelled')),
  created_at timestamptz not null default now(), created_by uuid,
  unique (tenant_id, number)
);

-- A receipt may be allocated across multiple invoices (or left unallocated / on-account).
create table payment_allocations (
  id           uuid primary key,
  tenant_id    uuid not null references tenants(id),
  receipt_id   uuid not null references payment_receipts(id) on delete cascade,
  invoice_id   uuid not null references invoices(id),
  amount       numeric(14,2) not null,
  unique (receipt_id, invoice_id)
);

-- ---------- Customer Statement (§43) ----------------------------------------
-- No physical table: the statement is a computed view over invoices,
-- credit_debit_notes and payment_receipts filtered by customer_id and date
-- range. See ../reporting.md §4 for the exact projection/query shape.
