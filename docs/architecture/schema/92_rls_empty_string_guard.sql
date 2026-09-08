-- =============================================================================
-- 92_rls_empty_string_guard.sql -- Guard every RLS policy against a real
-- Postgres GUC quirk: a custom setting resets to '' (empty string), not
-- NULL, on later transactions of the same session/connection
--
-- Found running the auth increment through a real pooled connection (not
-- caught by 90_row_level_security.sql's manual psql tests, because each of
-- those was a fresh connection where the setting had never been touched --
-- true NULL). Reproduced directly:
--
--   begin; select set_config('app.test_probe', 'hello', true); commit;
--   begin; select current_setting('app.test_probe', true); commit;
--   -- returns '' , not NULL
--
-- Once a custom/placeholder GUC like app.tenant_id has been set via
-- `set_config(..., true)` (LOCAL) even once on a session, Postgres keeps
-- the placeholder alive for the rest of that session; a later transaction
-- that never re-sets it sees '' from current_setting(..., true), not NULL.
-- postgres.js pools and reuses physical connections across unrelated
-- requests, so this is not a corner case -- it is what happens on the
-- second transaction to ever run on a given pooled connection where the
-- first one authenticated a request. `'' :: uuid` raises a hard error
-- ("invalid input syntax for type uuid"), which is what actually
-- surfaced this while testing GET /auth/me.
--
-- '' is not a valid tenant/actor id either way, so the fix is to treat it
-- the same as NULL: wrap every current_setting(...)::uuid in this schema
-- with nullif(..., ''), converting empty string to NULL before the cast.
-- comparing a column to NULL is simply false/unknown, not an error --
-- restoring the intended fail-*safe* (silently no rows), not fail-loud
-- (500), behavior for "no tenant context set", while remaining exactly as
-- strict for actual cross-tenant access.
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
    execute format('drop policy if exists tenant_isolation on %I', r.table_name);

    if r.table_name = any(nullable_shared_tables) then
      using_expr := 'tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid or tenant_id is null';
    else
      using_expr := 'tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid';
    end if;

    execute format(
      'create policy tenant_isolation on %I using (%s) with check (%s)',
      r.table_name, using_expr, using_expr
    );
  end loop;
end $$;

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
        and (r.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid or r.tenant_id is null)
    )
  );

drop policy if exists self_membership_lookup on tenant_users;
create policy self_membership_lookup on tenant_users
  for select
  using (user_id = nullif(current_setting('app.actor_user_id', true), '')::uuid);
