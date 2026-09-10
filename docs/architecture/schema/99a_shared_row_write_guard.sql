-- =============================================================================
-- 99a_shared_row_write_guard.sql -- A tenant may READ the system-seeded rows
-- it shares with every other tenant, but may not WRITE one
--
-- Found adding the first application code that writes `notification_rules`
-- (Phase 11g's rule editor). Five tables have a nullable `tenant_id` where
-- NULL means "system-seeded, visible to everyone": agreement_templates,
-- charge_types, notification_rules, roles, tax_rates. 90/92 give each of
-- them the policy `tenant_id = <current tenant> or tenant_id is null` -- and
-- use the same expression for USING *and* WITH CHECK.
--
-- That is right for USING and wrong for WITH CHECK. It says any tenant may
-- insert a row with `tenant_id = null` -- a rule, role, charge type or tax
-- rate that then applies to every other tenant on the platform. Nothing in
-- the application does that today; the point of RLS is that it stays true
-- when something one day gets it wrong, and a policy that permits a
-- cross-tenant write is not defense in depth.
--
-- So: USING keeps the shared rows readable, WITH CHECK requires the row
-- being written to carry the caller's own tenant_id. The one writer that
-- legitimately creates shared rows is `npm run seed`, which connects with
-- no `app.tenant_id` set at all -- an unscoped connection that already sees
-- nothing anywhere else -- so that case is allowed explicitly rather than
-- by leaving the hole open for everybody.
--
-- Naming: `99a` rather than `100`, because migrate.ts sorts filenames as
-- strings and '100_' sorts *before* '10_masters.sql'.
-- =============================================================================

do $$
declare
  r record;
  tenant_expr text := 'nullif(current_setting(''app.tenant_id'', true), '''')::uuid';
  using_expr text;
  check_expr text;
begin
  for r in
    select table_name
    from information_schema.columns
    where table_schema = 'public'
      and column_name = 'tenant_id'
      and table_name in (
        'agreement_templates', 'charge_types', 'notification_rules',
        'roles', 'tax_rates'
      )
  loop
    execute format('drop policy if exists tenant_isolation on %I', r.table_name);

    using_expr := format('tenant_id = %s or tenant_id is null', tenant_expr);
    -- Own-tenant rows always; a shared row only from a connection that has
    -- no tenant context at all (the seeder and the migration runner).
    check_expr := format(
      'tenant_id = %s or (tenant_id is null and %s is null)',
      tenant_expr, tenant_expr
    );

    execute format(
      'create policy tenant_isolation on %I using (%s) with check (%s)',
      r.table_name, using_expr, check_expr
    );
  end loop;
end $$;

-- Same hole, one join away. `role_permissions` has no tenant_id of its own,
-- so 92's policy scopes it through the role it points at -- including, on
-- WITH CHECK, the system roles every tenant shares. Granting a permission to
-- the shared `owner` role grants it in every workspace on the platform.
drop policy if exists tenant_isolation on role_permissions;
create policy tenant_isolation on role_permissions
  using (
    exists (
      select 1 from roles r
      where r.id = role_permissions.role_id
        and (r.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid or r.tenant_id is null)
    )
  )
  with check (
    exists (
      select 1 from roles r
      where r.id = role_permissions.role_id
        and (
          r.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
          or (r.tenant_id is null and nullif(current_setting('app.tenant_id', true), '') is null)
        )
    )
  );
