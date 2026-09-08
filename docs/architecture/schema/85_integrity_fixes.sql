-- =============================================================================
-- 85_integrity_fixes.sql — Close a real gap found while implementing Phase 1A
--
-- Five tables use `tenant_id uuid references tenants(id)` (nullable) with a
-- comment "null = system-seeded / shared" and a composite
-- `unique (tenant_id, code)` (or similar) constraint intended to also keep
-- the system-seeded rows unique among themselves. That does not work: SQL
-- treats every NULL as distinct from every other NULL for uniqueness
-- purposes, so `unique (tenant_id, code)` silently allows any number of
-- duplicate `(NULL, 'owner')` rows. The composite constraint still correctly
-- enforces uniqueness for actual tenant-scoped rows (tenant_id not null) --
-- only the "system-wide" half of each table's documented intent was
-- unenforced. See ../DECISIONS.md for the entry recording this.
--
-- Fixed with a partial unique index per table, additive only -- no existing
-- column, table shape, or composite constraint changes.
-- =============================================================================

create unique index if not exists roles_system_code_uq
  on roles (code) where tenant_id is null;

create unique index if not exists charge_types_system_code_uq
  on charge_types (code) where tenant_id is null;

create unique index if not exists tax_rates_system_code_uq
  on tax_rates (code) where tenant_id is null;

create unique index if not exists notification_rules_system_code_uq
  on notification_rules (code) where tenant_id is null;

-- products.tenant_id is never null (a shared/generic SKU still belongs to a
-- tenant); it's customer_id that's nullable for "shared across this
-- tenant's customers" (see 10_masters.sql). Same underlying gap, one level
-- down: unique (tenant_id, customer_id, sku) doesn't catch two shared SKUs
-- with the same code in the same tenant.
create unique index if not exists products_shared_sku_uq
  on products (tenant_id, sku) where customer_id is null;
