-- =============================================================================
-- 00_core.sql — Tenancy, identity, roles, numbering, attachments, settings
-- Reference schema (PostgreSQL notation). See ../README.md for conventions.
-- Blueprint refs: §5, §6, §7, §52
-- =============================================================================

-- ---------- Tenants (Company Master, §7) --------------------------------------
create table tenants (
  id                    uuid primary key,
  slug                  text not null unique,             -- url-safe identifier
  legal_name            text not null,
  trade_name            text,
  logo_attachment_id    uuid,                             -- -> attachments
  address_line1         text,
  address_line2         text,
  city                  text,
  state                 text,                             -- Indian state name
  state_code            char(2),                          -- GST state code, e.g. '06'
  pincode               text,
  gstin                 char(15),
  pan                   char(10),
  cin                   text,
  phone                 text,
  email                 text,
  website               text,
  bank_name             text,
  bank_account_no       text,
  bank_ifsc             text,
  bank_branch           text,
  signatory_name        text,
  signatory_designation text,
  signature_attachment_id uuid,
  stamp_attachment_id   uuid,
  terms_and_conditions  text,                             -- default T&C used on documents
  financial_year_start_month smallint not null default 4, -- April (Indian FY)
  timezone              text not null default 'Asia/Kolkata',
  currency              char(3) not null default 'INR',
  status                text not null default 'active' check (status in ('active','suspended','closed')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ---------- Users & membership ----------------------------------------------
-- A user identity is global (one email). Access to a tenant is a membership.
create table users (
  id              uuid primary key,
  email           text not null unique,
  full_name       text not null,
  mobile          text,
  password_hash   text,                    -- null when external IdP is used
  is_platform_admin boolean not null default false,
  last_login_at   timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table roles (
  id          uuid primary key,
  tenant_id   uuid references tenants(id),  -- null = system role available to all tenants
  code        text not null,                -- owner, admin, warehouse_manager, warehouse_operator,
                                            -- billing_executive, accountant, customer
  name        text not null,
  is_system   boolean not null default false,
  unique (tenant_id, code)
);

create table permissions (
  code        text primary key,             -- e.g. 'approve_grn'  (see permissions-matrix.md)
  module      text not null,                -- masters | operations | stock | billing | documents | reports | settings
  description text
);

create table role_permissions (
  role_id         uuid not null references roles(id) on delete cascade,
  permission_code text not null references permissions(code) on delete cascade,
  primary key (role_id, permission_code)
);

create table tenant_users (
  id            uuid primary key,
  tenant_id     uuid not null references tenants(id),
  user_id       uuid not null references users(id),
  role_id       uuid not null references roles(id),
  customer_id   uuid,                       -- REQUIRED when role = customer (portal login) -> customers.id
  warehouse_ids uuid[],                     -- optional restriction to specific warehouses; null = all
  status        text not null default 'active' check (status in ('invited','active','disabled')),
  invited_at    timestamptz,
  created_at    timestamptz not null default now(),
  unique (tenant_id, user_id)
);

-- ---------- Number series (§16 example GE/26-27/000001) ---------------------
create table number_series (
  id            uuid primary key,
  tenant_id     uuid not null references tenants(id),
  document_type text not null,              -- see numbering.md for the canonical list
  warehouse_id  uuid,                       -- optional per-warehouse series
  prefix        text not null,              -- 'GE'
  format        text not null default '{prefix}/{fy}/{seq:6}',
  fy_style      text not null default 'YY-YY' check (fy_style in ('YY-YY','YYYY-YY','YYYY','NONE')),
  reset_policy  text not null default 'yearly' check (reset_policy in ('never','yearly','monthly')),
  padding       smallint not null default 6,
  next_seq      bigint not null default 1,
  period_key    text,                       -- '26-27' — the period next_seq belongs to
  unique (tenant_id, document_type, warehouse_id)
);

-- ---------- Attachments (polymorphic file store) ----------------------------
create table attachments (
  id            uuid primary key,
  tenant_id     uuid not null references tenants(id),
  owner_type    text not null,              -- 'customer','inward','grn','pod','discrepancy_report', ...
  owner_id      uuid not null,
  category      text,                       -- 'invoice','lr','eway_bill','photo','gst_certificate','pan','kyc','agreement','signature','stamp','logo','other'
  file_name     text not null,
  content_type  text not null,
  size_bytes    bigint not null,
  storage_key   text not null,              -- object storage path; never a public URL
  sha256        char(64),
  uploaded_by   uuid references users(id),
  uploaded_at   timestamptz not null default now()
);
create index on attachments (tenant_id, owner_type, owner_id);

-- ---------- Tenant settings (key/value, typed by convention) ----------------
create table tenant_settings (
  tenant_id   uuid not null references tenants(id),
  key         text not null,                -- e.g. 'stock.allocation_policy', 'stock.ageing_buckets',
                                            --      'billing.storage_day_convention', 'workflow.outward_posting_point'
  value       jsonb not null,
  updated_by  uuid references users(id),
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, key)
);
