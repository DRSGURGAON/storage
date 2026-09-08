-- =============================================================================
-- 90_row_level_security.sql -- Defense-in-depth tenant isolation
-- (tenancy-and-security.md §1)
--
-- Closes a real gap: RLS was specified in tenancy-and-security.md from the
-- start ("Every tenant-scoped table has ENABLE ROW LEVEL SECURITY...") and
-- dev-phases.md's Phase 1 exit criteria assumes it, but no policy was ever
-- actually written into the schema until this file. Applied here, after
-- every tenant-scoped table exists, rather than folded into 00_core.sql
-- etc., because it discovers those tables from information_schema instead
-- of a hand-maintained list -- the mechanical, unmissable way to cover all
-- ~90 of them without transcription error.
--
-- Policy: tenant_id = current_setting('app.tenant_id', true)::uuid, applied
-- to both USING and WITH CHECK so a request can neither read nor write
-- another tenant's rows. The `true` second argument to current_setting
-- means "return null instead of erroring if unset" -- so a request that
-- never calls set_config('app.tenant_id', ...) sees zero rows everywhere,
-- fail-closed, rather than an error or (worse) every tenant's rows.
--
-- FORCE ROW LEVEL SECURITY is required because the application connects as
-- the same role that owns these tables (see apps/api's migration runner --
-- it runs as the same role the app runs as). RLS does not apply to a
-- table's owner by default, so without FORCE, this entire migration would
-- be a silent no-op for every real application query.
--
-- Five tables have a *nullable* tenant_id for shared/system-seeded rows
-- (the same five identified in 85_integrity_fixes.sql): for those, a NULL
-- tenant_id row must stay visible to every tenant, so the policy is
-- `tenant_id = current_setting(...) OR tenant_id IS NULL` instead of plain
-- equality. Getting this wrong the other way (a plain equality policy on a
-- nullable column) would silently hide every system-seeded role, charge
-- type, tax rate, notification rule, and agreement template from all
-- tenants -- worse than no RLS at all -- so this is generated explicitly
-- per table below, not guessed at or forgotten.
-- =============================================================================

do $$
declare
  r record;
  nullable_shared_tables text[] := array[
    'agreement_templates', 'charge_types', 'notification_rules',
    'roles', 'tax_rates'
  ];
  using_expr text;
begin
  for r in
    select table_name
    from information_schema.columns
    where table_schema = 'public'
      and column_name = 'tenant_id'
  loop
    execute format('alter table %I enable row level security', r.table_name);
    execute format('alter table %I force row level security', r.table_name);
    execute format('drop policy if exists tenant_isolation on %I', r.table_name);

    if r.table_name = any(nullable_shared_tables) then
      using_expr := 'tenant_id = current_setting(''app.tenant_id'', true)::uuid or tenant_id is null';
    else
      using_expr := 'tenant_id = current_setting(''app.tenant_id'', true)::uuid';
    end if;

    execute format(
      'create policy tenant_isolation on %I using (%s) with check (%s)',
      r.table_name, using_expr, using_expr
    );
  end loop;
end $$;

-- role_permissions has no tenant_id column of its own -- it's a pure
-- role<->permission mapping, tenant-scoped only indirectly through the
-- role it references. V1 never creates a tenant-owned custom role (every
-- seeded role has tenant_id is null, per permissions-matrix.md), so this
-- is defense-in-depth for a capability not yet built, not a fix for an
-- active bug -- written now, while every other table's policy is being
-- generated, rather than deferred and forgotten until it becomes one.
alter table role_permissions enable row level security;
alter table role_permissions force row level security;
drop policy if exists tenant_isolation on role_permissions;
create policy tenant_isolation on role_permissions
  using (
    exists (
      select 1 from roles r
      where r.id = role_permissions.role_id
        and (r.tenant_id = current_setting('app.tenant_id', true)::uuid or r.tenant_id is null)
    )
  )
  with check (
    exists (
      select 1 from roles r
      where r.id = role_permissions.role_id
        and (r.tenant_id = current_setting('app.tenant_id', true)::uuid or r.tenant_id is null)
    )
  );
