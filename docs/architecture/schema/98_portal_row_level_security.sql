-- =============================================================================
-- 98_portal_row_level_security.sql -- The database-level half of
-- tenancy-and-security.md §2's "belt and braces" customer-portal isolation
--
-- §2 promises two independent layers for a portal login, exactly as §1
-- promises two for a tenant: a service layer that hard-codes the
-- customer_id filter, and a database layer that makes a forgotten filter
-- harmless. Only the first was ever built. apps/api/src/portal/ writes
-- `customer_id = ${customerId}` inline in every query and is tested for
-- it, but nothing underneath enforced it -- a portal query that omitted
-- the filter (or a future staff service reused from a portal handler)
-- would have returned every customer's rows, with 90_row_level_security's
-- tenant policy waving it through, because it is all one tenant.
--
-- Why RESTRICTIVE, not another ordinary policy: multiple permissive
-- policies on a table are OR-ed together, so adding one here would have
-- *widened* access rather than narrowed it -- the exact opposite of the
-- intent, and a mistake that would look like it worked (the portal tests
-- would still pass). A restrictive policy is AND-ed with the permissive
-- tenant_isolation policy, which is the semantics this needs: still that
-- tenant's rows, and additionally that customer's.
--
-- The switch is app.actor_kind. Unset, or anything but 'customer' -- every
-- staff request, every migration, every psql session -- and the added
-- clause is trivially true, so nothing about staff behaviour changes. Set
-- to 'customer' by withPortalTenant(), and every table below is narrowed
-- to app.customer_id. If actor_kind says 'customer' and app.customer_id is
-- unset, the comparison is NULL and the row is refused: fail-closed, the
-- same posture as an unset app.tenant_id.
--
-- Both GUCs are read through nullif(..., '') because a custom GUC comes
-- back as the empty string, not NULL, after its first use on a pooled
-- connection (DECISIONS.md §18, and 92_rls_empty_string_guard.sql, which
-- this file follows).
--
-- Two shapes of table, decided per table rather than by one rule:
--
--   * Shared masters (products, rate_cards, suppliers) carry a NULLABLE
--     customer_id where NULL means "shared across all customers of this
--     tenant" -- a house SKU, a company-scope rate card. Those rows must
--     stay visible to a portal session, or the portal's own stock list
--     could not name the product it is holding. NULL is allowed through
--     for these three, and only these three.
--   * Everything else with a customer_id is a transaction or a
--     customer-owned record. A NULL there means "not this customer's"
--     (an internal stock transfer's document, a gate entry raised before
--     the customer was known), so NULL is refused, not waved through.
--
-- `customers` itself is special-cased: its key is `id`, not `customer_id`,
-- so a portal session sees exactly one row in that table -- its own.
-- =============================================================================

do $$
declare
  r record;
  -- customer_id IS NULL means "shared with every customer" only here.
  shared_null_tables text[] := array['products', 'rate_cards', 'suppliers'];
  actor_is_not_customer constant text :=
    'coalesce(nullif(current_setting(''app.actor_kind'', true), ''''), ''staff'') <> ''customer''';
  own_customer constant text :=
    'customer_id = nullif(current_setting(''app.customer_id'', true), '''')::uuid';
  using_expr text;
begin
  for r in
    select table_name
    from information_schema.columns
    where table_schema = 'public'
      and column_name = 'customer_id'
    order by table_name
  loop
    execute format('drop policy if exists portal_customer_isolation on %I', r.table_name);

    if r.table_name = any(shared_null_tables) then
      using_expr := format('%s or %s or customer_id is null', actor_is_not_customer, own_customer);
    else
      using_expr := format('%s or %s', actor_is_not_customer, own_customer);
    end if;

    execute format(
      'create policy portal_customer_isolation on %I as restrictive using (%s) with check (%s)',
      r.table_name, using_expr, using_expr
    );
  end loop;
end $$;

-- The customer's own master record: keyed on id, so it needs its own policy.
drop policy if exists portal_customer_isolation on customers;
create policy portal_customer_isolation on customers as restrictive
  using (
    coalesce(nullif(current_setting('app.actor_kind', true), ''), 'staff') <> 'customer'
    or id = nullif(current_setting('app.customer_id', true), '')::uuid
  )
  with check (
    coalesce(nullif(current_setting('app.actor_kind', true), ''), 'staff') <> 'customer'
    or id = nullif(current_setting('app.customer_id', true), '')::uuid
  );
