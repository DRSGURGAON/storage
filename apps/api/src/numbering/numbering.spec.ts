import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { createDbConnection } from '../db/client';
import { withTenant } from '../db/tenant-context';
import { NumberingService } from './numbering.service';

/**
 * numbering.md's own concern: "two users creating a GRN at the same
 * instant must never receive the same number." No document-generating
 * module exists yet to prove this through a real GRN, so this drives
 * allocateNumber() directly against a real tenant -- same posture as
 * entitlement.spec.ts before Phase 3 exists to call it for real.
 */
describe('NumberingService', () => {
  let sql: postgres.Sql;
  let service: NumberingService;
  let tenantId: string;

  beforeAll(async () => {
    sql = createDbConnection(process.env.DATABASE_URL!).sql;
    service = new NumberingService(sql);

    tenantId = randomUUID();
    await sql`
      insert into tenants (id, slug, legal_name)
      values (${tenantId}, ${'numbering-test-' + randomUUID().slice(0, 8)}, 'Numbering Test Tenant')
    `;
  });

  afterAll(async () => {
    await sql.end();
  });

  it('creates the series lazily and formats prefix/FY/padded sequence', async () => {
    const number = await service.allocateNumber(tenantId, 'GATE_ENTRY');
    expect(number).toMatch(/^GE\/\d{2}-\d{2}\/\d{6}$/);
    expect(number.endsWith('/000001')).toBe(true);
  });

  it('allocates strictly increasing sequence numbers for the same series', async () => {
    const a = await service.allocateNumber(tenantId, 'INVOICE_GENERATION');
    const b = await service.allocateNumber(tenantId, 'INVOICE_GENERATION');
    const c = await service.allocateNumber(tenantId, 'INVOICE_GENERATION');

    const seqOf = (n: string) => Number(n.split('/').pop());
    expect(seqOf(b)).toBe(seqOf(a) + 1);
    expect(seqOf(c)).toBe(seqOf(b) + 1);
    expect(a.startsWith('INV/')).toBe(true);
  });

  it('rejects an unconfigured document type rather than guessing a prefix', async () => {
    await expect(
      service.allocateNumber(tenantId, 'SOME_FUTURE_DOCUMENT_TYPE'),
    ).rejects.toThrow(/No default prefix configured/);
  });

  it('keeps different document types on independent sequences', async () => {
    const grn1 = await service.allocateNumber(tenantId, 'GRN_GENERATION');
    const grn2 = await service.allocateNumber(tenantId, 'GRN_GENERATION');
    expect(grn1.endsWith('/000001')).toBe(true);
    expect(grn2.endsWith('/000002')).toBe(true);
    expect(grn1.startsWith('GRN/')).toBe(true);
  });

  it('keeps per-warehouse series independent of the tenant-wide series and of each other', async () => {
    const warehouseA = randomUUID();
    const warehouseB = randomUUID();
    // warehouses is RLS-protected (unlike tenants) -- this has to go
    // through withTenant, not the bare `sql` client.
    await withTenant(sql, tenantId, (tx) => tx`
      insert into warehouses (id, tenant_id, code, name)
      values (${warehouseA}, ${tenantId}, 'WHA', 'Warehouse A'),
             (${warehouseB}, ${tenantId}, 'WHB', 'Warehouse B')
    `);

    const tenantWide = await service.allocateNumber(tenantId, 'LOADING_SHEET');
    const perA1 = await service.allocateNumber(tenantId, 'LOADING_SHEET', warehouseA);
    const perA2 = await service.allocateNumber(tenantId, 'LOADING_SHEET', warehouseA);
    const perB1 = await service.allocateNumber(tenantId, 'LOADING_SHEET', warehouseB);

    expect(tenantWide.endsWith('/000001')).toBe(true);
    expect(perA1.endsWith('/000001')).toBe(true);
    expect(perA2.endsWith('/000002')).toBe(true);
    expect(perB1.endsWith('/000001')).toBe(true); // independent of warehouse A, not /000002
  });

  it('keeps different tenants on independent sequences', async () => {
    const otherTenantId = randomUUID();
    await sql`
      insert into tenants (id, slug, legal_name)
      values (${otherTenantId}, ${'numbering-test-b-' + randomUUID().slice(0, 8)}, 'Other Tenant')
    `;
    const otherFirst = await service.allocateNumber(otherTenantId, 'GATE_ENTRY');
    expect(otherFirst.endsWith('/000001')).toBe(true); // not /000002 -- unaffected by the first test's tenant
  });

  it('serializes concurrent allocations for the same series -- no duplicates, no gaps', async () => {
    const attempts = Array.from({ length: 10 }, () =>
      service.allocateNumber(tenantId, 'GATE_PASS'),
    );
    const numbers = await Promise.all(attempts);

    expect(new Set(numbers).size).toBe(10); // every number is unique
    const seqs = numbers
      .map((n) => Number(n.split('/').pop()))
      .sort((a, b) => a - b);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]); // contiguous, no gaps or dupes
  });
});
