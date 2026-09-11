-- =============================================================================
-- 100_household_storage.sql -- Household goods storage, as its own domain
--
-- A second product on the same engine, for a different customer: the
-- operator who stores a *family's belongings* -- an almirah, a fridge,
-- forty cartons -- for a monthly rent, and gives it all back when they
-- ask for it.
--
-- Why new tables rather than reusing the 3PL chain: the two businesses
-- disagree about what a "thing in the warehouse" is. Contract warehousing
-- counts fungible SKUs in batches -- 200 bags of RICE-25 are
-- interchangeable, and the customer wants a *quantity* back. Household
-- storage holds one specific almirah with a scratch on its left door, and
-- the customer wants *that* almirah back, with the scratch documented so
-- it is not blamed on the warehouse. A products/batches model cannot say
-- that, and bending it to would corrupt the model the 3PL side depends on.
--
-- What is deliberately NOT rebuilt here, because it already exists and is
-- tested: tenants and row-level security, users and roles, the numbering
-- engine, the document/PDF engine, attachments (the condition photos and
-- the receiver's signature), invoices with GST, payments and receipts,
-- and the audit trail. This file adds the five tables that are genuinely
-- new, and nothing else.
--
-- `customers` is reused as-is: it already carries `customer_type =
-- 'individual'`, `mobile`, and `kyc_status`, which is exactly a household
-- customer.
-- =============================================================================

-- ---------- The space itself ------------------------------------------------
-- A storage unit is a room, a locker, a marked floor area, or a container
-- inside one of the tenant's warehouses. Optional on a booking: plenty of
-- small operators stack goods in a shared hall and never allot a unit, and
-- forcing them to invent unit codes before they can take a booking is the
-- kind of setup step that loses a customer on day one.
create table storage_units (
  id            uuid primary key,
  tenant_id     uuid not null references tenants(id),
  warehouse_id  uuid not null references warehouses(id),
  code          text not null,                    -- 'A-12', 'LOCKER-07'
  name          text,
  unit_type     text not null default 'room'
                  check (unit_type in ('room', 'locker', 'pallet', 'open_area', 'container')),
  area_sqft     numeric(10,2),
  volume_cbm    numeric(10,3),
  -- The list rate. A booking freezes its own agreed rent, because a rent
  -- rise must never re-price a booking that is already running.
  monthly_rate  numeric(14,2),
  status        text not null default 'vacant'
                  check (status in ('vacant', 'occupied', 'maintenance')),
  is_active     boolean not null default true,
  notes         text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (tenant_id, warehouse_id, code)
);
create index on storage_units (tenant_id, warehouse_id, status);

-- ---------- The booking -----------------------------------------------------
-- One family's goods, stored under one agreement, at one rent. Everything
-- else in this file hangs off it.
create table storage_bookings (
  id              uuid primary key,
  tenant_id       uuid not null references tenants(id),
  number          text not null,                  -- SB/26-27/000001, from the numbering engine
  customer_id     uuid not null references customers(id),
  warehouse_id    uuid not null references warehouses(id),
  storage_unit_id uuid references storage_units(id),

  booking_date       date not null,
  storage_start_date date,                        -- set when the goods actually arrive
  expected_end_date  date,
  actual_end_date    date,

  -- ----- money -----
  -- `flat` is the default because it is how most of this trade is quoted:
  -- "aapka saaman, mahine ka 4,500". The measured bases exist for
  -- operators who price by space, and `billable_quantity` is what they
  -- multiply.
  rent_basis        text not null default 'flat'
                      check (rent_basis in ('flat', 'per_sqft', 'per_cbm', 'per_unit')),
  billable_quantity numeric(14,3),
  monthly_rent      numeric(14,2) not null check (monthly_rent >= 0),
  security_deposit  numeric(14,2) not null default 0 check (security_deposit >= 0),
  minimum_months    smallint not null default 1 check (minimum_months >= 0),
  notice_days       smallint not null default 30 check (notice_days >= 0),
  -- Which day of the month the rent invoice is raised. Null means the
  -- anniversary of storage_start_date, which is what an operator means by
  -- "mahine ka hisaab" when they have not thought about it.
  billing_day       smallint check (billing_day between 1 and 28),

  -- ----- the party, frozen -----
  -- Same rule as every other document in this system: an agreement
  -- printed in June must still print in June's words in December, so the
  -- customer's details are snapshotted at booking rather than joined live.
  customer_snapshot jsonb not null,

  pickup_address    text,
  delivery_address  text,

  -- ----- KYC -----
  -- The *type* of ID and its last four digits only. The scan itself lives
  -- in `attachments` (owner_type = 'storage_booking', category = 'kyc').
  -- Storing a full Aadhaar number in an application database is a
  -- liability with no operational benefit: the operator needs to prove
  -- they checked an ID, not to hold a copy of the number. Last four is
  -- enough to match the document to the scan.
  id_proof_type     text check (id_proof_type in ('aadhaar', 'driving_licence', 'voter_id', 'passport', 'other')),
  id_proof_last4    char(4),

  -- ----- state -----
  -- enquiry -> quoted -> confirmed -> in_storage -> closed, with cancel
  -- available until the goods arrive. `in_storage` is the only status that
  -- bills, and it is set by the intake, not by hand.
  status          text not null default 'enquiry'
                    check (status in ('enquiry', 'quoted', 'confirmed', 'in_storage', 'closed', 'cancelled')),
  cancelled_at    timestamptz,
  cancel_reason   text,
  closed_at       timestamptz,

  notes           text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (tenant_id, number)
);
create index on storage_bookings (tenant_id, customer_id);
create index on storage_bookings (tenant_id, status);
create index on storage_bookings (tenant_id, warehouse_id, status);

-- ---------- The inventory list ----------------------------------------------
-- The most important paper in this business. It is what the customer
-- signs, what an insurance claim is settled against, and what the operator
-- is measured by when the goods go back. Hence `condition_note` sitting
-- beside the description rather than buried in remarks: "left door
-- scratched", written *before* storage, is the line that decides an
-- argument six months later.
create table storage_booking_items (
  id             uuid primary key,
  tenant_id      uuid not null references tenants(id),
  booking_id     uuid not null references storage_bookings(id) on delete cascade,
  line_no        smallint not null,
  description    text not null,                   -- 'Godrej almirah, 3 door'
  category       text check (category in ('furniture', 'appliance', 'carton', 'vehicle', 'other')),
  quantity       numeric(14,3) not null default 1 check (quantity > 0),
  uom_code       text not null default 'NOS',
  packing        text,                            -- 'bubble wrap + carton'
  condition_note text,
  declared_value numeric(14,2) check (declared_value >= 0),
  is_fragile     boolean not null default false,
  -- Partial releases are normal -- a family takes the fridge back in
  -- March and the rest in July -- so an item carries its own state rather
  -- than the booking carrying one for all of them.
  released_qty   numeric(14,3) not null default 0 check (released_qty >= 0),
  remarks        text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (tenant_id, booking_id, line_no),
  constraint storage_booking_items_released_within_qty check (released_qty <= quantity)
);
create index on storage_booking_items (tenant_id, booking_id);

-- ---------- One-time charges ------------------------------------------------
-- Pickup, packing material, labour, a lift charge, transport. Separate
-- from rent because they are billed once and rent is billed every month,
-- and mixing the two is how an operator ends up charging packing twice.
create table storage_booking_charges (
  id             uuid primary key,
  tenant_id      uuid not null references tenants(id),
  booking_id     uuid not null references storage_bookings(id) on delete cascade,
  charge_type_id uuid references charge_types(id),
  description    text not null,
  quantity       numeric(14,3) not null default 1 check (quantity > 0),
  rate           numeric(14,4) not null check (rate >= 0),
  amount         numeric(14,2) not null check (amount >= 0),
  charged_on     date not null,
  -- Set when the charge lands on an invoice, so it cannot be billed twice.
  invoiced_at    timestamptz,
  invoice_id     uuid references invoices(id),
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create index on storage_booking_charges (tenant_id, booking_id);
create index on storage_booking_charges (tenant_id, booking_id) where invoiced_at is null;

-- ---------- Goods in, goods out ---------------------------------------------
-- Every physical movement of the family's things, in or out, with who
-- handed them over and who took them. The signature is an attachment id,
-- because a signature captured on a phone is a file like any other -- and
-- the delivery document prints it.
create table storage_movements (
  id             uuid primary key,
  tenant_id      uuid not null references tenants(id),
  number         text not null,                   -- SM/26-27/000001
  booking_id     uuid not null references storage_bookings(id),
  direction      text not null check (direction in ('in', 'out')),
  movement_date  date not null,
  vehicle_number text,
  driver_name    text,
  transporter_name text,
  -- The person on the other side of the handover: who delivered the goods
  -- to the godown, or who collected them. On the way out this is the line
  -- that matters, because "someone else came and took it" is the worst
  -- thing that can happen to a storage operator.
  counterparty_name  text,
  counterparty_phone text,
  authorisation_note text,                        -- 'customer's brother, authorised on call 12-Jun'
  signature_attachment_id uuid references attachments(id),
  remarks        text,
  status         text not null default 'draft'
                   check (status in ('draft', 'completed', 'cancelled')),
  completed_at   timestamptz,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (tenant_id, number)
);
create index on storage_movements (tenant_id, booking_id, direction);

create table storage_movement_items (
  id              uuid primary key,
  tenant_id       uuid not null references tenants(id),
  movement_id     uuid not null references storage_movements(id) on delete cascade,
  booking_item_id uuid not null references storage_booking_items(id),
  quantity        numeric(14,3) not null check (quantity > 0),
  condition_note  text,                           -- condition at handover, which may differ from intake
  created_at timestamptz not null default now()
);
create index on storage_movement_items (tenant_id, movement_id);

-- ---------- Row-level security ----------------------------------------------
-- 90_row_level_security.sql discovers tables from information_schema, but
-- it has already been applied -- a migration runs once. So these six
-- tables carry their policies here, written the same way: FORCE (the
-- application connects as the owning role, and without FORCE the policy is
-- a silent no-op), and the same expression on USING and WITH CHECK so a
-- request can neither read nor write another tenant's rows.
do $$
declare
  t text;
begin
  foreach t in array array[
    'storage_units', 'storage_bookings', 'storage_booking_items',
    'storage_booking_charges', 'storage_movements', 'storage_movement_items'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format(
      'create policy tenant_isolation on %I using (%s) with check (%s)',
      t,
      'tenant_id = current_setting(''app.tenant_id'', true)::uuid',
      'tenant_id = current_setting(''app.tenant_id'', true)::uuid'
    );
  end loop;
end $$;

-- ---------- Audit actions ---------------------------------------------------
-- `audit_logs.action` is constrained by a CHECK listing every allowed
-- action, so a new one has to be added here as well as to the TypeScript
-- union -- three times this session an endpoint returned 500 because only
-- the TypeScript half was done.
alter table audit_logs drop constraint if exists audit_logs_action_check;
alter table audit_logs add constraint audit_logs_action_check check (
  action in (
    'create', 'update', 'delete', 'approve', 'reject', 'cancel',
    'stock_adjustment', 'status_change', 'document_generate', 'document_regenerate',
    'login', 'login_failed', 'permission_denied',
    'password_changed', 'password_change_failed', 'password_reset', 'password_set_for_member',
    'account_deleted', 'workspace_deletion_requested',
    'upgrade_requested',
    'storage_intake', 'storage_release', 'storage_close'
  )
);
