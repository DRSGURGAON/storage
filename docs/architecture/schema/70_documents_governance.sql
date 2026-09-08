-- =============================================================================
-- 70_documents_governance.sql — Document registry/versioning, QR verification,
--                                Approval instances, Audit log, Notifications
-- Blueprint refs: §44–§51, §56, §62, §65
-- =============================================================================

-- ---------- Generated Documents (§44–§49) -----------------------------------
-- Every PDF produced by the Document Engine (see ../document-engine.md) gets
-- exactly one row per version here. This is what powers the Document Centre,
-- Document Timeline, versioning and QR verification.
create table documents (
  id             uuid primary key,
  tenant_id      uuid not null references tenants(id),
  document_type  text not null,             -- 'quotation','agreement','gate_entry','inward','grn',
                                            -- 'discrepancy_report','putaway','warehouse_receipt',
                                            -- 'stock_statement','stock_verification','stock_transfer',
                                            -- 'release_order','pick_list','packing_list','dispatch_note',
                                            -- 'loading_sheet','gate_pass','pod','return_inward','invoice',
                                            -- 'credit_note','debit_note','payment_receipt','customer_statement'
  source_id      uuid not null,             -- id of the row in the owning table (e.g. grns.id)
  document_number text not null,            -- denormalised copy of the source record's `number` for search
  customer_id    uuid references customers(id),
  warehouse_id   uuid references warehouses(id),
  version_no     integer not null default 1,
  is_latest      boolean not null default true,
  file_attachment_id uuid references attachments(id),   -- the rendered PDF
  render_data_snapshot jsonb not null,        -- exact data used to render this version (immutable)
  qr_token       text not null unique,        -- opaque token embedded in the QR; see qr-verification.md
  status_at_generation text,                  -- source record's status when this version was produced
  generated_at   timestamptz not null default now(),
  generated_by   uuid references users(id),
  approved_at    timestamptz,
  approved_by    uuid references users(id),
  superseded_at  timestamptz,
  superseded_by_document_id uuid references documents(id),
  unique (tenant_id, document_type, source_id, version_no)
);
create index on documents (tenant_id, document_type, source_id) where is_latest;
create index on documents (tenant_id, document_number);
create index on documents (tenant_id, customer_id, document_type, generated_at desc);

-- ---------- QR Verification log (§48) ---------------------------------------
-- Public verification endpoint reads `documents` by qr_token; this table only
-- records verification attempts for basic abuse monitoring / analytics.
create table document_verifications (
  id            uuid primary key,
  document_id   uuid not null references documents(id),
  verified_at   timestamptz not null default now(),
  ip_address    inet,
  user_agent    text,
  result        text not null check (result in ('valid','revoked','not_found'))
);

-- ---------- Approval Engine (§50) -------------------------------------------
-- Configurable multi-step approval chains. Concrete per-domain approval
-- columns (grns.status, invoices.status, stock_adjustments.status, ...)
-- remain the fast-path source of truth for workflow gating; this table is the
-- generic audit-grade record of *who approved what, in which step, when* and
-- backs a uniform "Pending Approvals" inbox (§54) across document types.
create table approval_chain_templates (
  id           uuid primary key,
  tenant_id    uuid not null references tenants(id),
  entity_type  text not null,               -- 'grn','stock_adjustment','invoice','credit_debit_note','agreement'
  steps        jsonb not null,              -- ordered [{step_no, role_code, name}], e.g.
                                            -- [{1,'warehouse_operator','Operator'},{2,'warehouse_manager','Manager'}]
  is_active    boolean not null default true,
  unique (tenant_id, entity_type)
);

create table approval_instances (
  id            uuid primary key,
  tenant_id     uuid not null references tenants(id),
  entity_type   text not null,
  entity_id     uuid not null,
  template_id   uuid references approval_chain_templates(id),
  current_step  smallint not null default 1,
  status        text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  created_at timestamptz not null default now()
);

create table approval_steps (
  id            uuid primary key,
  tenant_id     uuid not null references tenants(id),
  instance_id   uuid not null references approval_instances(id) on delete cascade,
  step_no       smallint not null,
  role_code     text not null,
  acted_by      uuid references users(id),
  action        text check (action in ('approved','rejected')),
  acted_at      timestamptz,
  comments      text,
  unique (instance_id, step_no)
);

-- ---------- Audit Log (§51) -------------------------------------------------
-- Append-only, never updated or deleted. Written by a service-layer interceptor,
-- not by triggers, so it can capture the acting user/role/permission context.
create table audit_logs (
  id            uuid primary key,
  tenant_id     uuid not null references tenants(id),
  occurred_at   timestamptz not null default now(),
  user_id       uuid references users(id),
  user_role_code text,
  action        text not null check (action in
                  ('create','update','delete','approve','reject','cancel',
                   'stock_adjustment','status_change','document_generate',
                   'document_regenerate','login','login_failed','permission_denied')),
  entity_type   text not null,
  entity_id     uuid not null,
  previous_value jsonb,
  new_value      jsonb,
  ip_address    inet,
  request_id    text                        -- correlates to API/access logs
);
create index on audit_logs (tenant_id, entity_type, entity_id, occurred_at desc);
create index on audit_logs (tenant_id, user_id, occurred_at desc);

-- ---------- Notifications (§56) ---------------------------------------------
create table notification_rules (
  id           uuid primary key,
  tenant_id    uuid references tenants(id),  -- null = system-seeded default rule
  code         text not null,                -- 'grn_pending_approval','pod_pending','payment_due','payment_overdue',
                                             -- 'agreement_expiring','stock_discrepancy','stock_adjustment_pending','customer_request_pending'
  channels     text[] not null default '{in_app}',  -- subset of {in_app,email,whatsapp,sms}; email/whatsapp/sms are
                                                     -- integration points only in V1 (§56) — delivery adapters land later
  audience_role_codes text[],                 -- which roles receive it, e.g. {warehouse_manager}
  is_active    boolean not null default true,
  unique (tenant_id, code)
);

create table notifications (
  id            uuid primary key,
  tenant_id     uuid not null references tenants(id),
  rule_code     text not null,
  recipient_user_id uuid not null references users(id),
  title         text not null,
  body          text,
  entity_type   text,
  entity_id     uuid,
  severity      text not null default 'info' check (severity in ('info','warning','critical')),
  channel       text not null default 'in_app' check (channel in ('in_app','email','whatsapp','sms')),
  delivery_status text not null default 'pending' check (delivery_status in ('pending','sent','failed','read')),
  read_at       timestamptz,
  created_at    timestamptz not null default now()
);
create index on notifications (tenant_id, recipient_user_id, read_at);
