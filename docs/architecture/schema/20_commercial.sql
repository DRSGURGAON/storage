-- =============================================================================
-- 20_commercial.sql — Quotation, Agreement
-- Blueprint refs: §14, §15
-- =============================================================================

create table quotations (
  id             uuid primary key,
  tenant_id      uuid not null references tenants(id),
  number         text not null,             -- QT/26-27/000001
  quotation_date date not null,
  valid_until    date,
  customer_id    uuid not null references customers(id),
  warehouse_id   uuid references warehouses(id),
  -- snapshot of party details at time of issue (documents must not change retroactively)
  customer_snapshot jsonb not null,         -- {legal_name,gstin,pan,billing_address,contact,...}
  payment_terms  text,
  special_conditions text,
  notes          text,
  subtotal       numeric(14,2) not null default 0,
  tax_total      numeric(14,2) not null default 0,
  grand_total    numeric(14,2) not null default 0,
  status         text not null default 'draft' check (status in ('draft','sent','accepted','rejected','expired','cancelled')),
  sent_at timestamptz, accepted_at timestamptz, rejected_at timestamptz,
  rejection_reason text,
  revision_of_id uuid references quotations(id),   -- previous revision (versioning at record level)
  revision_no    smallint not null default 1,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (tenant_id, number)
);

create table quotation_lines (
  id             uuid primary key,
  tenant_id      uuid not null references tenants(id),
  quotation_id   uuid not null references quotations(id) on delete cascade,
  charge_type_id uuid not null references charge_types(id),
  description    text not null,
  basis          text not null,             -- same catalogue as rate_card_lines.basis
  uom_code       text,
  quantity       numeric(14,3),             -- indicative quantity for the quote (optional)
  rate           numeric(14,4) not null,
  minimum_charge numeric(14,2),
  free_days      smallint not null default 0,
  tax_rate_id    uuid references tax_rates(id),
  sac_code       text,
  amount         numeric(14,2),             -- indicative line amount (quantity × rate), optional
  sort_order     smallint not null default 0
);

create table agreement_templates (
  id          uuid primary key,
  tenant_id   uuid references tenants(id),  -- null = system default template (requires legal review)
  name        text not null,
  version     smallint not null default 1,
  -- ordered clauses; each has an id, title, body with {{placeholders}} resolved from
  -- company / customer / warehouse / quotation / rate card, and an editable flag
  clauses     jsonb not null,
  is_active   boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid
);

create table agreements (
  id              uuid primary key,
  tenant_id       uuid not null references tenants(id),
  number          text not null,            -- AG/26-27/000001
  agreement_date  date not null,
  customer_id     uuid not null references customers(id),
  warehouse_id    uuid references warehouses(id),
  quotation_id    uuid references quotations(id),
  rate_card_id    uuid references rate_cards(id),
  template_id     uuid references agreement_templates(id),
  -- wizard payload, one key per step (§15): parties, warehouse, services, goods,
  -- commercial_terms, rates, payment, liability_insurance, term, termination, signatories
  wizard_data     jsonb not null,
  -- rendered clauses after placeholder resolution + user edits (frozen on approval)
  rendered_clauses jsonb,
  start_date      date not null,
  end_date        date,
  auto_renew      boolean not null default false,
  notice_period_days smallint,
  status          text not null default 'draft' check (status in ('draft','pending_approval','approved','active','expired','terminated','cancelled')),
  approved_at timestamptz, approved_by uuid,
  signed_at   timestamptz,
  terminated_at timestamptz, termination_reason text,
  revision_of_id uuid references agreements(id),
  revision_no    smallint not null default 1,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (tenant_id, number)
);
create index on agreements (tenant_id, customer_id, status);
create index on agreements (tenant_id, end_date) where status in ('approved','active');
