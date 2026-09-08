import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { createDbConnection } from './client';
import { withTenant } from './tenant-context';

/**
 * dev-phases.md's Phase 1 exit check: "two tenants' users cannot see each
 * other's tenant-scoped data via the API, verified by an automated test."
 * No masters module exists yet to exercise this through HTTP (that's
 * Phase 2), so this proves the actual mechanism every future module will
 * rely on -- withTenant() plus RLS (schema/90_row_level_security.sql) --
 * directly, against the real database, using the `customers` table
 * (already in the schema, not yet exposed by any endpoint).
 *
 * Deliberately does NOT add `where tenant_id = ...` to the query below:
 * tenancy-and-security.md §1 requires the service layer to filter
 * explicitly in real code, but the point of this specific test is to
 * prove the *second, independent* layer -- RLS -- holds even when a query
 * forgets to.
 */
describe('Tenant isolation (RLS defense-in-depth)', () => {
  let sql: postgres.Sql;
  const tenantAId = randomUUID();
  const tenantBId = randomUUID();
  const suffix = randomUUID().slice(0, 8);

  beforeAll(async () => {
    sql = createDbConnection(process.env.DATABASE_URL!).sql;

    await sql`
      insert into tenants (id, slug, legal_name) values
        (${tenantAId}, ${'isolation-test-a-' + suffix}, 'Isolation Test A'),
        (${tenantBId}, ${'isolation-test-b-' + suffix}, 'Isolation Test B')
    `;
    await withTenant(sql, tenantAId, (tx) => tx`
      insert into customers (id, tenant_id, code, name)
      values (${randomUUID()}, ${tenantAId}, 'CUST0001', 'Tenant A Customer')
    `);
    await withTenant(sql, tenantBId, (tx) => tx`
      insert into customers (id, tenant_id, code, name)
      values (${randomUUID()}, ${tenantBId}, 'CUST0001', 'Tenant B Customer')
    `);
  });

  afterAll(async () => {
    await sql.end();
  });

  it('tenant A only sees its own customer, never tenant B\'s', async () => {
    const rows = await withTenant(sql, tenantAId, (tx) =>
      tx<{ name: string }[]>`select name from customers`,
    );
    expect(rows.map((r) => r.name)).toEqual(['Tenant A Customer']);
  });

  it('tenant B only sees its own customer, never tenant A\'s', async () => {
    const rows = await withTenant(sql, tenantBId, (tx) =>
      tx<{ name: string }[]>`select name from customers`,
    );
    expect(rows.map((r) => r.name)).toEqual(['Tenant B Customer']);
  });

  it('a request with no tenant context sees nothing, not an error', async () => {
    const rows = await sql<{ name: string }[]>`select name from customers where code = 'CUST0001'`;
    expect(rows).toEqual([]);
  });

  it('cannot write a row claiming another tenant\'s id', async () => {
    await expect(
      withTenant(sql, tenantAId, (tx) => tx`
        insert into customers (id, tenant_id, code, name)
        values (${randomUUID()}, ${tenantBId}, 'CUST9999', 'Sneaky Insert')
      `),
    ).rejects.toThrow(/row-level security/i);
  });

  it('repeated calls on a reused connection stay isolated (DECISIONS.md §18)', async () => {
    for (let i = 0; i < 3; i++) {
      const a = await withTenant(sql, tenantAId, (tx) =>
        tx<{ name: string }[]>`select name from customers`,
      );
      const b = await withTenant(sql, tenantBId, (tx) =>
        tx<{ name: string }[]>`select name from customers`,
      );
      expect(a.map((r) => r.name)).toEqual(['Tenant A Customer']);
      expect(b.map((r) => r.name)).toEqual(['Tenant B Customer']);
    }
  });
});
