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
