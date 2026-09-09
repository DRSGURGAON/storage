-- =============================================================================
-- 96_stock_lots_balance_key.sql — Make stock_lots' balance key actually unique
--
-- Found while implementing the Phase 5 stock engine, the same way 85's five
-- were found: by trying to build on the constraint.
--
-- 40_stock.sql declares
--   unique (tenant_id, customer_id, warehouse_id, location_id, product_id,
--           batch_id, serial_no)
-- to make each row *the* balance for one logical lot -- which is the whole
-- premise of stock_lots being a materialised balance (see
-- ../stock-engine.md §1). Three of those seven columns are nullable, and SQL
-- treats every NULL as distinct from every other NULL for uniqueness. So the
-- constraint enforces nothing at all for the most common lot there is:
-- unallocated (location_id null), non-batch-tracked (batch_id null),
-- non-serial-tracked (serial_no null) stock. Verified against the live
-- database before writing this file -- three inserts of the identical lot
-- key all succeeded, leaving three "current stock" rows for one lot.
--
-- That is worse than 85's five. There the unenforced half was the
-- system-seeded rows; here it is the ordinary path, and the damage is
-- silent: an upsert keyed on the constraint would never match, every
-- posting would insert a *new* lot instead of adding to the existing one,
-- and "current stock" would fragment into as many rows as there were
-- receipts, each with a partial quantity. No error, just a wrong number.
--
-- Postgres 15+ can say what was meant. Additive only: a new unique index,
-- no column, table shape, or existing constraint changed. It is also the
-- conflict target the stock engine's upsert infers on, so the invariant and
-- the mechanism that depends on it are the same object.
-- =============================================================================

create unique index if not exists stock_lots_balance_key_uq
  on stock_lots (tenant_id, customer_id, warehouse_id, location_id,
                 product_id, batch_id, serial_no)
  nulls not distinct;
