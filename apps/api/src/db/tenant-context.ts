import type postgres from 'postgres';

/**
 * The one function every tenant-scoped query in the app is meant to go
 * through (tenancy-and-security.md §1's "service-layer guard, primary
 * layer"). Runs `fn` inside a transaction with `app.tenant_id` set via
 * `set_config(..., true)` -- `true` means LOCAL, scoped to this
 * transaction only, so it can never leak onto a pooled connection's next,
 * unrelated request.
 *
 * This does not replace explicit `where tenant_id = ...` filters in
 * queries -- RLS (schema/90_row_level_security.sql) is the second,
 * independent layer precisely so a query that forgets that filter still
 * cannot leak another tenant's rows.
 */
export async function withTenant<T>(
  sql: postgres.Sql,
  tenantId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  // postgres.js's own `begin<T>` type declaration doesn't type-check against
  // an arbitrary caller-supplied T (a library typing limitation, not a
  // mistake in this usage -- the runtime behavior is correct). Contained to
  // this one call rather than letting `any` leak into withTenant's own,
  // fully-typed public signature.
  const result = await (sql.begin as (cb: unknown) => Promise<unknown>)(
    async (tx: postgres.TransactionSql) => {
      await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    },
  );
  return result as T;
}

/**
 * The portal's variant, for `tenancy-and-security.md` §2. Sets the same
 * `app.tenant_id` plus two more transaction-local GUCs -- `app.actor_kind`
 * = `'customer'` and `app.customer_id` -- which
 * `schema/98_portal_row_level_security.sql`'s restrictive policies read.
 *
 * The effect is that inside `fn`, a query that forgets its
 * `customer_id = ...` filter returns this customer's rows anyway, instead
 * of every customer's. That is the same bargain `withTenant` strikes for
 * tenants, and for the same reason: the inline filters stay (they are
 * still written in every portal query, and still the primary control), but
 * a mistake in one of them stops being a data breach.
 *
 * Never call this for a staff request. `app.actor_kind` left unset is what
 * tells the database this is ordinary staff access, and every staff query
 * in the app depends on that being the default.
 */
export async function withPortalTenant<T>(
  sql: postgres.Sql,
  tenantId: string,
  customerId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  const result = await (sql.begin as (cb: unknown) => Promise<unknown>)(
    async (tx: postgres.TransactionSql) => {
      await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
      await tx`select set_config('app.actor_kind', 'customer', true)`;
      await tx`select set_config('app.customer_id', ${customerId}, true)`;
      return fn(tx);
    },
  );
  return result as T;
}
