-- =============================================================================
-- 102_storage_rent_billing.sql -- Monthly rent, billed once
--
-- Household storage's bill is a monthly rent against a booking, plus the
-- one-time charges recorded on it. The invoice itself reuses `invoices`
-- wholesale -- same numbering, same GST split, same PDF, same payments and
-- statement -- so what is new here is only the two things the existing
-- tables cannot say: how far a booking's rent has been billed, and which
-- invoice covered which period.
-- =============================================================================

-- The date rent has been charged up to. The guard against the mistake this
-- trade actually makes: raising September's rent twice because two people
-- looked at the same booking on the same day. A new invoice must start
-- after this date, and nothing else decides it.
alter table storage_bookings add column if not exists rent_billed_upto date;

-- Which invoice covered which period, for which booking. A separate table
-- rather than a column on `invoices`, because `invoices` belongs to both
-- products and a household-storage column on it would be null for every
-- 3PL invoice ever raised.
create table if not exists storage_booking_invoices (
  id           uuid primary key,
  tenant_id    uuid not null references tenants(id),
  booking_id   uuid not null references storage_bookings(id) on delete cascade,
  invoice_id   uuid not null references invoices(id),
  period_start date not null,
  period_end   date not null,
  rent_amount  numeric(14,2) not null,
  created_at timestamptz not null default now(), created_by uuid,
  unique (tenant_id, invoice_id)
);
create index if not exists storage_booking_invoices_booking_idx
  on storage_booking_invoices (tenant_id, booking_id, period_start);

alter table storage_booking_invoices enable row level security;
alter table storage_booking_invoices force row level security;
drop policy if exists tenant_isolation on storage_booking_invoices;
create policy tenant_isolation on storage_booking_invoices
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);
