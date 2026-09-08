-- =============================================================================
-- 80_subscription.sql — Plans, Feature Catalog, Tenant Subscriptions,
--                        Entitlement Overrides, Usage Ledger & Counters
-- Blueprint refs: saas-layer §6–17, §41–45
--
-- DESIGN NOTE: this mirrors the ledger-first pattern used for stock in
-- 40_stock.sql. usage_ledger is the append-only source of truth for every
-- metered attempt; usage_counters is a materialised, service-maintained
-- balance kept in sync with it, used for fast entitlement checks. No code
-- path writes to usage_counters directly — see ../entitlement-engine.md §2.
-- =============================================================================

-- Demo tenants are ordinary tenants flagged so their data can be excluded
-- from real usage accounting, billing, and cross-tenant reporting (§46).
alter table tenants add column is_demo boolean not null default false;

-- ---------- Feature catalog (§15) -------------------------------------------
-- System-managed list of stable feature keys. Application code refers to
-- features only by `code`; this table is what makes that a managed catalog
-- instead of string literals scattered through the codebase.
create table feature_keys (
  code          text primary key,          -- 'GRN_GENERATION', 'INVOICE_GENERATION', ...
  module        text not null,             -- 'commercial','operations','stock','billing','portal' (§17 module grouping)
  name          text not null,
  description   text,
  is_meterable  boolean not null default true,   -- false for a plain on/off feature (e.g. CUSTOMER_PORTAL access)
  is_active     boolean not null default true
);

-- ---------- Plans (§13, §44) ------------------------------------------------
create table plans (
  id             uuid primary key,
  code           text not null unique,     -- 'FREE','TRIAL','STARTER','BUSINESS','PROFESSIONAL','ENTERPRISE' —
                                           -- seed data, never an application-code constant (§13)
  name           text not null,
  description    text,
  is_public      boolean not null default true,   -- shown on the pricing page (§44)
  is_active      boolean not null default true,
  trial_days     smallint not null default 0,
  price_monthly  numeric(10,2),
  price_yearly   numeric(10,2),
  currency       char(3) not null default 'INR',
  sort_order     smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Plan × Feature limits (§13, §16, §17) ---------------------------
create table plan_feature_limits (
  id             uuid primary key,
  plan_id        uuid not null references plans(id) on delete cascade,
  feature_code   text not null references feature_keys(code),
  limit_type     text not null check (limit_type in ('unlimited','counted','disabled')),
  limit_value    integer,                  -- required when limit_type='counted' (e.g. 2 for the free-copies rule); null otherwise
  period         text not null default 'lifetime' check (period in ('lifetime','monthly','yearly')),
  unique (plan_id, feature_code),
  check ((limit_type = 'counted' and limit_value is not null and limit_value >= 0)
      or (limit_type <> 'counted' and limit_value is null))
);

-- ---------- Tenant subscription (current state) -----------------------------
create table tenant_subscriptions (
  id             uuid primary key,
  tenant_id      uuid not null references tenants(id) unique,   -- one current subscription per tenant
  plan_id        uuid not null references plans(id),
  status         text not null default 'trial' check (status in
                   ('trial','active','past_due','cancelled','expired','paused')),
  trial_ends_at  timestamptz,
  current_period_start timestamptz,
  current_period_end   timestamptz,
  cancel_at_period_end boolean not null default false,
  payment_gateway text,               -- e.g. 'razorpay' — null until a gateway is actually connected
  payment_gateway_customer_id text,
  payment_gateway_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on tenant_subscriptions (status, current_period_end);

-- ---------- Subscription history / gateway webhook log ----------------------
create table subscription_events (
  id             uuid primary key,
  tenant_id      uuid not null references tenants(id),
  subscription_id uuid references tenant_subscriptions(id),
  event_type     text not null check (event_type in
                   ('created','trial_started','activated','payment_failed','past_due',
                    'cancelled','expired','paused','resumed','plan_changed')),
  from_plan_id   uuid references plans(id),
  to_plan_id     uuid references plans(id),
  source         text not null default 'system' check (source in ('gateway_webhook','admin','system')),
  raw_payload    jsonb,               -- verbatim gateway webhook body, for replay/debugging
  occurred_at    timestamptz not null default now(),
  created_by     uuid references users(id)
);
create index on subscription_events (tenant_id, occurred_at desc);

-- ---------- Per-tenant manual override (§6 "admin-configurable limits") -----
create table entitlement_overrides (
  id            uuid primary key,
  tenant_id     uuid not null references tenants(id),
  feature_code  text not null references feature_keys(code),
  limit_type    text not null check (limit_type in ('unlimited','counted','disabled')),
  limit_value   integer,
  period        text not null default 'lifetime' check (period in ('lifetime','monthly','yearly')),
  reason        text not null,        -- required: an override must be justified, it is audit-visible
  granted_by    uuid references users(id),
  expires_at    timestamptz,          -- null = indefinite
  created_at    timestamptz not null default now(),
  unique (tenant_id, feature_code)
);

-- ---------- Usage Ledger (§9, §10) — append-only source of truth -----------
create table usage_ledger (
  id             uuid primary key,
  tenant_id      uuid not null references tenants(id),
  user_id        uuid references users(id),
  feature_code   text not null references feature_keys(code),
  period_key     text not null,        -- 'lifetime', or '2026-09' (monthly) / '2026' (yearly)
  document_type  text,
  source_id      uuid,                 -- the record the action was performed on, e.g. grns.id
  generation_id  uuid,                 -- -> documents.id (schema/70_documents_governance.sql), when applicable
  result         text not null check (result in ('success','failed','blocked')),
  consumed       boolean not null default false,  -- true only on a 'success' row that counted against the limit
  reason         text,                 -- e.g. 'LIMIT_REACHED' when blocked, error summary when failed
  idempotency_key text not null,       -- see ../entitlement-engine.md §4
  occurred_at    timestamptz not null default now(),
  unique (tenant_id, idempotency_key)
);
create index on usage_ledger (tenant_id, feature_code, period_key) where consumed;
create index on usage_ledger (tenant_id, user_id, occurred_at desc);

-- ---------- Usage Counters — materialised balance, maintained by the ledger -
create table usage_counters (
  tenant_id     uuid not null references tenants(id),
  feature_code  text not null references feature_keys(code),
  period_key    text not null,
  used_count    integer not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (tenant_id, feature_code, period_key)
);
