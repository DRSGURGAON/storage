-- =============================================================================
-- 10_masters.sql — Warehouse, Location, Customer, Supplier, Product, Transport,
--                  Charge types, Tax, Rate cards
-- Blueprint refs: §8–§13
-- =============================================================================

-- ---------- Warehouses (§8) --------------------------------------------------
create table warehouses (
  id            uuid primary key,
  tenant_id     uuid not null references tenants(id),
  code          text not null,              -- 'WH01' — first segment of location codes
  name          text not null,
  address_line1 text, address_line2 text,
  city text, state text, state_code char(2), pincode text,
  contact_phone text,
  contact_email text,
  gstin         char(15),                   -- warehouse may be a separate GST registration
  capacity_value numeric(14,3),
  capacity_uom  text,                       -- 'pallet','sqft','cbm','mt'
  area_sqft     numeric(14,2),
  manager_user_id uuid references users(id),
  manager_name  text,
  working_hours text,
  is_active     boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (tenant_id, code)
);

-- ---------- Locations (§9) : Warehouse → Zone → Rack → Row → Bin → Pallet ------
create table locations (
  id            uuid primary key,
  tenant_id     uuid not null references tenants(id),
  warehouse_id  uuid not null references warehouses(id),
  parent_id     uuid references locations(id),
  level         text not null check (level in ('zone','rack','row','bin','pallet')),
  segment       text not null,              -- 'A', 'R04', 'B15', 'P003'
  full_code     text not null,              -- 'WH01-A-R04-B15-P003' (materialised, unique)
  name          text,
  capacity_value numeric(14,3),
  capacity_uom  text,
  is_pickable   boolean not null default true,
  is_active     boolean not null default true,
  barcode_value text,                       -- value encoded in the printed QR/barcode (defaults to full_code)
  created_at timestamptz not null default now(),
  unique (tenant_id, full_code),
  unique (parent_id, segment)
);
create index on locations (tenant_id, warehouse_id, level);

-- ---------- Customers (§10) -------------------------------------------------
create table customers (
  id              uuid primary key,
  tenant_id       uuid not null references tenants(id),
  code            text not null,            -- 'CUST0001'
  name            text not null,            -- display / trade name
  legal_name      text,
  customer_type   text,                     -- 'company','proprietor','partnership','individual','government', ...
  contact_person  text,
  mobile          text,
  email           text,
  gstin           char(15),
  pan             char(10),
  state           text,
  state_code      char(2),
  place_of_supply char(2),                  -- GST state code used on invoices
  default_warehouse_id uuid references warehouses(id),
  default_rate_card_id uuid,                -- -> rate_cards (FK added after rate_cards)
  billing_cycle   text not null default 'monthly' check (billing_cycle in ('monthly','fortnightly','weekly','on_dispatch')),
  credit_days     smallint not null default 0,
  payment_terms   text,
  minimum_billing_amount numeric(14,2),
  kyc_status      text not null default 'pending' check (kyc_status in ('pending','submitted','verified','rejected')),
  kyc_verified_at timestamptz,
  kyc_verified_by uuid references users(id),
  is_active       boolean not null default true,
  notes           text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (tenant_id, code)
);

create table customer_addresses (
  id           uuid primary key,
  tenant_id    uuid not null references tenants(id),
  customer_id  uuid not null references customers(id) on delete cascade,
  kind         text not null check (kind in ('registered','billing','delivery')),
  label        text,                        -- 'Head office', 'Plant 2' — multiple delivery addresses allowed
  address_line1 text not null, address_line2 text,
  city text, state text, state_code char(2), pincode text,
  gstin        char(15),                    -- delivery address may belong to another GST registration
  contact_name text, contact_phone text,
  is_default   boolean not null default false,
  is_active    boolean not null default true
);
create index on customer_addresses (tenant_id, customer_id, kind);

create table customer_contacts (
  id          uuid primary key,
  tenant_id   uuid not null references tenants(id),
  customer_id uuid not null references customers(id) on delete cascade,
  name        text not null,
  designation text,
  mobile      text,
  email       text,
  is_primary  boolean not null default false,
  receives_documents boolean not null default true  -- notification recipient
);
-- Customer documents (GST cert, PAN, agreement, KYC…) live in attachments
-- with owner_type='customer' and category set accordingly.

-- ---------- Suppliers (§17 "Supplier") ----------------------------------------
-- Optional master; transactions may also carry a free-text supplier_name.
create table suppliers (
  id          uuid primary key,
  tenant_id   uuid not null references tenants(id),
  customer_id uuid references customers(id),  -- optional: supplier belongs to a customer's supply chain
  name        text not null,
  gstin       char(15),
  address     text,
  contact_name text, contact_phone text,
  is_active   boolean not null default true,
  unique (tenant_id, name, customer_id)
);

-- ---------- Products / SKUs (§11) -------------------------------------------
create table uoms (
  tenant_id   uuid not null references tenants(id),
  code        text not null,                -- 'NOS','BOX','BAG','KG','MT','PLT','CBM','SQFT'
  name        text not null,
  primary key (tenant_id, code)
);

create table product_categories (
  id        uuid primary key,
  tenant_id uuid not null references tenants(id),
  name      text not null,
  parent_id uuid references product_categories(id),
  unique (tenant_id, name, parent_id)
);

create table products (
  id              uuid primary key,
  tenant_id       uuid not null references tenants(id),
  customer_id     uuid references customers(id),   -- SKU catalogues are usually customer-owned in 3PL;
                                                   -- null = shared/generic SKU
  sku             text not null,
  name            text not null,
  description     text,
  category_id     uuid references product_categories(id),
  brand           text,
  hsn_code        text,
  uom_code        text not null,
  weight_kg       numeric(12,3),
  length_cm numeric(10,2), width_cm numeric(10,2), height_cm numeric(10,2),
  volume_cbm      numeric(12,6),            -- derived, stored for billing
  barcode         text,
  units_per_package integer,                -- e.g. 24 nos per box, for package counts
  batch_tracked   boolean not null default false,
  serial_tracked  boolean not null default false,
  expiry_tracked  boolean not null default false,
  storage_basis   text,                     -- override of rate basis for this SKU: 'unit','pallet','box','cbm','sqft'
  is_active       boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (tenant_id, customer_id, sku)
);
create index on products (tenant_id, barcode);

-- ---------- Transport (§12) -------------------------------------------------
create table transporters (
  id         uuid primary key,
  tenant_id  uuid not null references tenants(id),
  name       text not null,
  gstin      char(15),
  contact_name text, contact_phone text, email text,
  address    text,
  is_active  boolean not null default true,
  unique (tenant_id, name)
);

create table vehicles (
  id             uuid primary key,
  tenant_id      uuid not null references tenants(id),
  vehicle_number text not null,             -- normalised uppercase, no spaces: 'HR26DK1234'
  vehicle_type   text,                      -- 'tata_ace','14ft','20ft','32ft_sxl','32ft_mxl','container','tempo','other'
  capacity_value numeric(12,3),
  capacity_uom   text,                      -- 'mt','cbm'
  transporter_id uuid references transporters(id),
  is_active      boolean not null default true,
  unique (tenant_id, vehicle_number)
);

create table drivers (
  id             uuid primary key,
  tenant_id      uuid not null references tenants(id),
  name           text not null,
  mobile         text,
  license_number text,
  license_expiry date,
  transporter_id uuid references transporters(id),
  is_active      boolean not null default true
);
create index on drivers (tenant_id, mobile);

-- ---------- Charge types & tax (§13, §38, §40) --------------------------------
create table charge_types (
  id          uuid primary key,
  tenant_id   uuid references tenants(id),  -- null = system-seeded default
  code        text not null,                -- see billing-engine.md §2 for seeded codes
  name        text not null,
  category    text not null check (category in ('storage','handling','other')),
  default_basis text not null,              -- see billing-engine.md §3 (basis catalogue)
  sac_code    text,                         -- e.g. '996729' storage & warehousing, '996719' cargo handling
  is_billable_event boolean not null default true,  -- generated automatically from operations?
  trigger_event text,                       -- 'grn_approved','gate_out','loading_confirmed','pick_confirmed', null = manual/period
  is_active   boolean not null default true,
  unique (tenant_id, code)
);

create table tax_rates (
  id          uuid primary key,
  tenant_id   uuid references tenants(id),  -- null = system-seeded
  code        text not null,                -- 'GST18','GST12','GST5','EXEMPT','NIL'
  name        text not null,
  rate_pct    numeric(5,2) not null,        -- total rate; split CGST/SGST vs IGST decided at invoice time
  is_active   boolean not null default true,
  unique (tenant_id, code)
);

-- ---------- Rate cards (§13) ------------------------------------------------
-- Resolution priority: customer-specific → warehouse-specific → company default.
create table rate_cards (
  id           uuid primary key,
  tenant_id    uuid not null references tenants(id),
  code         text not null,
  name         text not null,
  scope        text not null check (scope in ('customer','warehouse','company')),
  customer_id  uuid references customers(id),     -- required when scope='customer'
  warehouse_id uuid references warehouses(id),    -- required when scope='warehouse'; optional for customer scope
  currency     char(3) not null default 'INR',
  valid_from   date not null,
  valid_to     date,
  status       text not null default 'draft' check (status in ('draft','active','expired','archived')),
  source_quotation_id uuid,                        -- -> quotations
  source_agreement_id uuid,                        -- -> agreements
  notes        text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (tenant_id, code),
  check ((scope='customer' and customer_id is not null) or (scope='warehouse' and warehouse_id is not null) or scope='company')
);

create table rate_card_lines (
  id             uuid primary key,
  tenant_id      uuid not null references tenants(id),
  rate_card_id   uuid not null references rate_cards(id) on delete cascade,
  charge_type_id uuid not null references charge_types(id),
  basis          text not null,             -- 'unit_day','pallet_day','box_day','sqft_month','cbm_day','flat_month',
                                            -- 'per_unit','per_package','per_pallet','per_vehicle','per_hour','per_document','per_kg','lumpsum'
  uom_code       text,                      -- unit that "unit" refers to, when basis uses units
  rate           numeric(14,4) not null,
  minimum_charge numeric(14,2),             -- floor per billing period / per event
  free_days      smallint not null default 0, -- storage grace days (inward day handling in billing-engine.md)
  slab_from      numeric(14,3),             -- optional quantity slabs
  slab_to        numeric(14,3),
  product_id     uuid references products(id),        -- optional SKU-specific rate
  category_id    uuid references product_categories(id),
  tax_rate_id    uuid references tax_rates(id),
  sac_code       text,                      -- override of charge_types.sac_code
  description    text,
  sort_order     smallint not null default 0
);
create index on rate_card_lines (tenant_id, rate_card_id, charge_type_id);

alter table customers add constraint customers_default_rate_card_fk
  foreign key (default_rate_card_id) references rate_cards(id);
