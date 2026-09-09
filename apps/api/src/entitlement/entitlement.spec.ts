import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { createDbConnection } from '../db/client';
import { withTenant } from '../db/tenant-context';
import { EntitlementService } from './entitlement.service';

/**
 * dev-phases.md Phase 1's remaining exit check: "a scripted feature check
 * against a FREE-plan tenant returns allowed: true twice and allowed:
 * false, reason: 'LIMIT_REACHED' on the third call ... proving the engine
 * before any real feature depends on it." No document-generating module
 * exists yet, so this drives the service directly against a real tenant
 * seeded exactly the way signup creates one (FREE plan, active).
 */
describe('EntitlementService', () => {
  let sql: postgres.Sql;
  let service: EntitlementService;
  let tenantId: string;

  beforeAll(async () => {
    sql = createDbConnection(process.env.DATABASE_URL!).sql;
    service = new EntitlementService(sql);

    const [freePlan] = await sql<{ id: string }[]>`
      select id from plans where code = 'FREE'
    `;
    if (!freePlan) {
      throw new Error("FREE plan not seeded -- run 'npm run seed' first");
    }

    tenantId = randomUUID();
    await sql`
      insert into tenants (id, slug, legal_name)
      values (${tenantId}, ${'entitlement-test-' + randomUUID().slice(0, 8)}, 'Entitlement Test Tenant')
    `;
    await withTenant(sql, tenantId, (tx) => tx`
      insert into tenant_subscriptions (id, tenant_id, plan_id, status)
      values (${randomUUID()}, ${tenantId}, ${freePlan.id}, 'active')
    `);
  });

  afterAll(async () => {
    await sql.end();
  });

  it('reports the free allowance before any usage', async () => {
    const result = await service.checkEntitlement(tenantId, 'GRN_GENERATION');
    expect(result).toMatchObject({
      allowed: true,
      reason: null,
      remaining: 2,
      limit: 2,
      used: 0,
      upgradeRequired: false,
    });
  });

  it('allows the first two consumptions, then blocks the third with LIMIT_REACHED', async () => {
    const first = await service.consumeEntitlement({
      tenantId,
      featureCode: 'GRN_GENERATION',
      idempotencyKey: 'grn:seq-1:generate',
    });
    expect(first).toMatchObject({ allowed: true, used: 1, remaining: 1, wasNewlyConsumed: true });

    const second = await service.consumeEntitlement({
      tenantId,
      featureCode: 'GRN_GENERATION',
      idempotencyKey: 'grn:seq-2:generate',
    });
    expect(second).toMatchObject({ allowed: true, used: 2, remaining: 0, wasNewlyConsumed: true });

    const third = await service.consumeEntitlement({
      tenantId,
      featureCode: 'GRN_GENERATION',
      idempotencyKey: 'grn:seq-3:generate',
    });
    expect(third).toMatchObject({
      allowed: false,
      reason: 'LIMIT_REACHED',
      remaining: 0,
      upgradeRequired: true,
      wasNewlyConsumed: false,
    });

    const check = await service.checkEntitlement(tenantId, 'GRN_GENERATION');
    expect(check).toMatchObject({ allowed: false, reason: 'LIMIT_REACHED', used: 2 });
  });

  it('does not double-consume on a retried idempotency key', async () => {
    const key = 'grn:seq-retry:generate';
    const first = await service.consumeEntitlement({
      tenantId,
      featureCode: 'AGREEMENT_GENERATION',
      idempotencyKey: key,
    });
    expect(first).toMatchObject({ allowed: true, used: 1, wasNewlyConsumed: true });

    const retry1 = await service.consumeEntitlement({
      tenantId,
      featureCode: 'AGREEMENT_GENERATION',
      idempotencyKey: key,
    });
    const retry2 = await service.consumeEntitlement({
      tenantId,
      featureCode: 'AGREEMENT_GENERATION',
      idempotencyKey: key,
    });
    expect(retry1.wasNewlyConsumed).toBe(false);
    expect(retry2.wasNewlyConsumed).toBe(false);

    const check = await service.checkEntitlement(tenantId, 'AGREEMENT_GENERATION');
    expect(check.used).toBe(1); // still 1, not 3
  });

  it('serializes concurrent consumeEntitlement calls so exactly the limit is consumed, never more', async () => {
    const attempts = [1, 2, 3, 4, 5].map((n) =>
      service.consumeEntitlement({
        tenantId,
        featureCode: 'POD',
        idempotencyKey: `pod:concurrent-${n}:generate`,
      }),
    );
    const results = await Promise.all(attempts);

    const succeeded = results.filter((r) => r.wasNewlyConsumed);
    const blocked = results.filter((r) => !r.wasNewlyConsumed);
    expect(succeeded).toHaveLength(2);
    expect(blocked).toHaveLength(3);
    expect(blocked.every((r) => r.reason === 'LIMIT_REACHED')).toBe(true);

    // usage_counters is RLS-protected -- reading it without tenant context
    // would silently return nothing, not an error, so this deliberately
    // goes through withTenant rather than the bare `sql` client.
    const [counter] = await withTenant(sql, tenantId, (tx) => tx<{ used_count: number }[]>`
      select used_count from usage_counters
      where tenant_id = ${tenantId} and feature_code = 'POD' and period_key = 'lifetime'
    `);
    expect(counter.used_count).toBe(2);
  });

  it('keeps different features and different tenants fully independent', async () => {
    const dispatchCheck = await service.checkEntitlement(tenantId, 'DISPATCH_NOTE');
    expect(dispatchCheck).toMatchObject({ allowed: true, used: 0, remaining: 2 });

    const [freePlan] = await sql<{ id: string }[]>`select id from plans where code = 'FREE'`;
    const otherTenantId = randomUUID();
    await sql`
      insert into tenants (id, slug, legal_name)
      values (${otherTenantId}, ${'entitlement-test-b-' + randomUUID().slice(0, 8)}, 'Other Tenant')
    `;
    await withTenant(sql, otherTenantId, (tx) => tx`
      insert into tenant_subscriptions (id, tenant_id, plan_id, status)
      values (${randomUUID()}, ${otherTenantId}, ${freePlan.id}, 'active')
    `);

    const otherCheck = await service.checkEntitlement(otherTenantId, 'GRN_GENERATION');
    expect(otherCheck).toMatchObject({ allowed: true, used: 0, remaining: 2 });
  });

  it('never meters an unmetered feature -- always unlimited', async () => {
    const result = await service.checkEntitlement(tenantId, 'CUSTOMER_KYC');
    expect(result).toMatchObject({ allowed: true, reason: null, remaining: null, limit: null });
  });

  it('fails closed on an unconfigured feature code', async () => {
    const result = await service.checkEntitlement(tenantId, 'SOME_FUTURE_FEATURE_NOT_YET_SEEDED');
    expect(result).toMatchObject({ allowed: false, reason: 'FEATURE_DISABLED' });
  });

  it('records a failed attempt for audit without touching usage or the counter', async () => {
    const before = await service.checkEntitlement(tenantId, 'INVOICE_GENERATION');
    await service.recordFailedAttempt({
      tenantId,
      featureCode: 'INVOICE_GENERATION',
      idempotencyKey: 'invoice:crash-1:generate',
      reason: 'PDF renderer crashed',
    });
    const after = await service.checkEntitlement(tenantId, 'INVOICE_GENERATION');
    expect(after.used).toBe(before.used);

    const [row] = await withTenant(sql, tenantId, (tx) => tx<{ result: string; consumed: boolean }[]>`
      select result, consumed from usage_ledger
      where tenant_id = ${tenantId} and idempotency_key = 'invoice:crash-1:generate'
    `);
    expect(row).toMatchObject({ result: 'failed', consumed: false });
  });
});
