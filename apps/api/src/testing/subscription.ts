import type postgres from 'postgres';
import { withTenant } from '../db/tenant-context';

/**
 * Put a test workspace on a paid plan.
 *
 * Needed because plans are priced per godown and the Free plan allows one.
 * A spec that exercises stock transfers, warehouse scoping or put-away into
 * a second godown is exercising a **paid** feature, and a fresh signup
 * cannot reach it -- correctly. Signing up and then upgrading is what a real
 * customer does, so it is what these tests do.
 *
 * `tenant_subscriptions` is under FORCE ROW LEVEL SECURITY, so this has to
 * go through `withTenant`; on the bare connection it matches zero rows and
 * the spec goes on quietly asserting against the Free plan.
 */
export async function putOnPlan(sql: postgres.Sql, tenantSlug: string, planCode = 'SCALE'): Promise<void> {
  const [tenant] = await sql<{ id: string }[]>`select id from tenants where slug = ${tenantSlug}`;
  if (!tenant) throw new Error(`No tenant with slug ${tenantSlug}`);
  const [plan] = await sql<{ id: string }[]>`select id from plans where code = ${planCode}`;
  if (!plan) throw new Error(`No plan ${planCode} -- has the seed been run?`);

  await withTenant(sql, tenant.id, (tx) => tx`
    update tenant_subscriptions set plan_id = ${plan.id}, status = 'active'
    where tenant_id = ${tenant.id}
  `);
}
