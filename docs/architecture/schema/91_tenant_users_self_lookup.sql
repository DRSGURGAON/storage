-- =============================================================================
-- 91_tenant_users_self_lookup.sql -- Let login discover a user's own
-- memberships before a tenant is known
--
-- Real problem hit implementing login: tenancy-and-security.md §3 says a
-- multi-tenant user picks which tenant to act as at login, which means the
-- app must query `tenant_users where user_id = $1` *before* app.tenant_id
-- is set to anything (there is no tenant yet -- that query is how one gets
-- chosen). Under 90_row_level_security.sql's tenant_isolation policy alone,
-- that query returns zero rows every time: fail-closed is correct for
-- every other query, but it also blocks the one query whose entire purpose
-- is running before a tenant is selected.
--
-- Fix: a second, narrow policy on tenant_users, SELECT only, additional to
-- (not replacing) tenant_isolation -- Postgres OR's permissive policies on
-- the same table together, so a row is visible if EITHER policy allows it.
-- This one allows a row when `user_id` matches `app.actor_user_id`, a
-- session variable set only after the login flow has already verified the
-- password against `users` -- so this never lets an unauthenticated
-- request enumerate anyone's memberships, only a just-authenticated user's
-- own. Scoped to SELECT: a request cannot use this path to INSERT/UPDATE/
-- DELETE a tenant_users row for a tenant it hasn't been given app.tenant_id
-- for -- those still go through tenant_isolation's WITH CHECK only.
-- =============================================================================

create policy self_membership_lookup on tenant_users
  for select
  using (user_id = current_setting('app.actor_user_id', true)::uuid);
