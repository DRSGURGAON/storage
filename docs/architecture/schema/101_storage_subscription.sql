-- =============================================================================
-- 101_storage_subscription.sql -- Two products, two price lists
--
-- The engine now carries two products for two different customers, and they
-- cannot share a price list. Contract warehousing is priced per godown: a
-- 3PL with ten godowns is worth ten times one with a single godown, and
-- documents are unlimited above Free. Household storage does not work that
-- way -- an operator runs *one* godown for years and grows by holding more
-- families' goods in it. Their bill has to follow customers stored, not
-- buildings.
--
-- Showing a household-storage operator "₹19,999 for 10 godowns" would
-- price them out of a product built for them, so `plans.product` splits
-- the ladder and `tenants.product` says which one a workspace is on.
-- =============================================================================

-- Which product a plan belongs to. Everything seeded before this file is
-- contract warehousing, which is why the default backfills correctly.
alter table plans add column if not exists product text not null default 'warehouse';
alter table plans drop constraint if exists plans_product_check;
alter table plans add constraint plans_product_check
  check (product in ('warehouse', 'storage'));

-- Which product a workspace signed up for. It decides the plan a new
-- tenant lands on, which price list they are shown, and which app they
-- belong in. Not a hard gate on the API: a workspace that outgrows
-- household storage and starts doing contract warehousing changes this
-- column, and keeps every row it already has.
alter table tenants add column if not exists product text not null default 'warehouse';
alter table tenants drop constraint if exists tenants_product_check;
alter table tenants add constraint tenants_product_check
  check (product in ('warehouse', 'storage'));

create index if not exists plans_product_public_idx on plans (product, sort_order)
  where is_public and is_active;
