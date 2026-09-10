import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';

/** Phase 5's two reports (§25 stock statement, §26 ageing) and the statement document. */
describe('Stock reports', () => {
  let app: INestApplication;
  let sql: postgres.Sql;
  let tenantId = '';
  const suffix = randomUUID().slice(0, 8);
  const password = 'correcthorsebattery';
  let owner = '';
  let billing = '';
  let customerId = '';
  let otherCustomerId = '';
  let warehouseId = '';
  let binId = '';
  let riceId = '';
  let oilId = '';

  const api = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  const grnAndPutaway = async (productId: string, qty: number, batchNo?: string) => {
    const grn = await api()
      .post('/grns')
      .set(auth(owner))
      .send({ warehouseId, customerId, items: [{ productId, batchNo, expectedQty: qty, receivedQty: qty, acceptedQty: qty }] })
      .expect(201);
    for (const step of ['submit', 'check', 'approve']) await api().post(`/grns/${grn.body.id}/${step}`).set(auth(owner)).expect(201);
    const pa = await api()
      .post('/putaways')
      .set(auth(owner))
      .send({ grnId: grn.body.id, lines: [{ grnItemId: grn.body.items[0].id, quantity: qty, toLocationId: binId }] })
      .expect(201);
    await api().post(`/putaways/${pa.body.id}/complete`).set(auth(owner)).expect(201);
    return grn.body;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    sql = app.get(PG_CONNECTION);
    owner = (
      await api()
        .post('/auth/signup')
        .send({ companyLegalName: 'Reports Ltd', tenantSlug: `rep-${suffix}`, email: `o-${suffix}@test.local`, fullName: 'Owner', password })
        .expect(201)
    ).body.accessToken;
    tenantId = JSON.parse(Buffer.from(owner.split('.')[1], 'base64url').toString()).tenantId;
    const be = `be-${suffix}@test.local`;
    await api().post('/users').set(auth(owner)).send({ email: be, fullName: 'Billing', password, roleCode: 'billing_executive' }).expect(201);
    billing = (await api().post('/auth/login').send({ email: be, password }).expect(201)).body.accessToken;

    customerId = (await api().post('/customers').set(auth(owner)).send({ name: 'Acme Co', gstin: '06AAACA1234A1Z5' }).expect(201)).body.id;
    otherCustomerId = (await api().post('/customers').set(auth(owner)).send({ name: 'Other Co' }).expect(201)).body.id;
    warehouseId = (await api().post('/warehouses').set(auth(owner)).send({ code: 'WH01', name: 'Main' }).expect(201)).body.id;
    const z = await api().post(`/warehouses/${warehouseId}/locations`).set(auth(owner)).send({ level: 'zone', segment: 'A' }).expect(201);
    const r = await api().post(`/warehouses/${warehouseId}/locations`).set(auth(owner)).send({ level: 'rack', segment: 'R01', parentId: z.body.id }).expect(201);
    binId = (await api().post(`/warehouses/${warehouseId}/locations`).set(auth(owner)).send({ level: 'bin', segment: 'B01', parentId: r.body.id }).expect(201)).body.id;
    riceId = (await api().post('/products').set(auth(owner)).send({ sku: 'RICE-25', name: 'Basmati', uomCode: 'BAG', batchTracked: true }).expect(201)).body.id;
    oilId = (await api().post('/products').set(auth(owner)).send({ sku: 'OIL-15', name: 'Oil', uomCode: 'BOX' }).expect(201)).body.id;
    await grnAndPutaway(riceId, 100, 'B-OLD');
    await grnAndPutaway(oilId, 40);
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports a customer statement per lot with per-product totals, and only that customer', async () => {
    const res = await api().get(`/reports/stock-statement?customerId=${customerId}`).set(auth(owner)).expect(200);
    expect(res.body.customer.name).toBe('Acme Co');
    expect(res.body.isHistorical).toBe(false);
    expect(res.body.lines).toHaveLength(2);
    const rice = res.body.totals.find((t: { sku: string }) => t.sku === 'RICE-25');
    expect(rice).toMatchObject({ physicalQty: 100, availableQty: 100 });

    const empty = await api().get(`/reports/stock-statement?customerId=${otherCustomerId}`).set(auth(owner)).expect(200);
    expect(empty.body.lines).toEqual([]);
    await api().get(`/reports/stock-statement?customerId=${randomUUID()}`).set(auth(owner)).expect(404);
  });

  it('rebuilds a past date from the ledger using the stored running balances', async () => {
    // Move 30 rice after "yesterday": as-of yesterday must not see the move.
    // The ledger rows carry the balance at each write, so a past date is
    // one distinct-on query, not a replay.
    // Through withTenant, not the bare connection: the ledger is under
    // FORCE ROW LEVEL SECURITY, so a tenant-less update silently touches
    // zero rows -- which is exactly the property the policy exists for.
    await withTenant(sql, tenantId, (tx) => tx`
      update stock_ledger set txn_at = txn_at - interval '3 days' where tenant_id = ${tenantId}
    `);
    const bin2 = await api()
      .post(`/warehouses/${warehouseId}/locations`)
      .set(auth(owner))
      .send({ level: 'zone', segment: 'Z' })
      .expect(201);
    const rack2 = await api()
      .post(`/warehouses/${warehouseId}/locations`)
      .set(auth(owner))
      .send({ level: 'rack', segment: 'R09', parentId: bin2.body.id })
      .expect(201);
    const target = await api()
      .post(`/warehouses/${warehouseId}/locations`)
      .set(auth(owner))
      .send({ level: 'bin', segment: 'B09', parentId: rack2.body.id })
      .expect(201);
    const batchId = (await api().get(`/stock?productId=${riceId}`).set(auth(owner)).expect(200)).body.items[0].batchId;
    const transfer = await api()
      .post('/stock-transfers')
      .set(auth(owner))
      .send({
        transferKind: 'location',
        customerId,
        fromWarehouseId: warehouseId,
        toWarehouseId: warehouseId,
        lines: [{ productId: riceId, batchId, quantity: 30, fromLocationId: binId, toLocationId: target.body.id }],
      })
      .expect(201);
    await api().post(`/stock-transfers/${transfer.body.id}/approve`).set(auth(owner)).expect(201);
    await api().post(`/stock-transfers/${transfer.body.id}/complete`).set(auth(owner)).expect(201);

    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const past = await api()
      .get(`/reports/stock-statement?customerId=${customerId}&asOf=${yesterday}`)
      .set(auth(owner))
      .expect(200);
    expect(past.body.isHistorical).toBe(true);
    const riceThen = past.body.lines.filter((l: { sku: string }) => l.sku === 'RICE-25');
    expect(riceThen).toHaveLength(1);
    expect(riceThen[0].physicalQty).toBe(100);

    const now = await api().get(`/reports/stock-statement?customerId=${customerId}`).set(auth(owner)).expect(200);
    const riceNow = now.body.lines.filter((l: { sku: string }) => l.sku === 'RICE-25');
    expect(riceNow.map((l: { physicalQty: number }) => l.physicalQty).sort((a: number, b: number) => a - b)).toEqual([30, 70]);
  });

  it('buckets ageing from batches.first_received_at, using the tenant setting when one is set', async () => {
    // Push the rice batch's first receipt back 45 days -- that column is
    // kept stable precisely so ageing can read it.
    await withTenant(sql, tenantId, (tx) => tx`
      update batches set first_received_at = now() - interval '45 days'
      where tenant_id = ${tenantId} and customer_id = ${customerId} and batch_no = 'B-OLD'
    `);
    const res = await api().get(`/reports/ageing?customerId=${customerId}`).set(auth(owner)).expect(200);
    expect(res.body.buckets).toEqual(['0-30', '31-60', '61-90', '91-180', '180+']);
    const rice = res.body.lines.filter((l: { sku: string }) => l.sku === 'RICE-25');
    expect(rice.every((l: { bucket: string }) => l.bucket === '31-60')).toBe(true);
    expect(res.body.summary['31-60']).toBe(100);
    // Non-batch stock is aged from its earliest receipt: 3 days back (the
    // ledger shift above), so 0-30.
    expect(res.body.lines.find((l: { sku: string }) => l.sku === 'OIL-15').bucket).toBe('0-30');

    await api()
      .put('/company/settings/stock.ageing_buckets')
      .set(auth(owner))
      .send({ value: ['0-7', '8-60', '60+'] })
      .expect(200);
    const custom = await api().get(`/reports/ageing?customerId=${customerId}`).set(auth(owner)).expect(200);
    expect(custom.body.buckets).toEqual(['0-7', '8-60', '60+']);
    expect(custom.body.summary['8-60']).toBe(100);
    expect(custom.body.summary['0-7']).toBe(40);
    await api().delete('/company/settings/stock.ageing_buckets').set(auth(owner)).expect(200);
  });

  it('issues the Customer Stock Statement document keyed on the customer -- the eleventh template', async () => {
    const preview = await api().post(`/reports/stock-statement/${customerId}/document/preview`).set(auth(owner)).expect(201);
    expect(Buffer.from(preview.body).subarray(0, 4).toString()).toBe('%PDF');

    const first = await api().post(`/reports/stock-statement/${customerId}/document`).set(auth(owner)).send({}).expect(201);
    expect(first.body).toMatchObject({ documentType: 'stock_statement', sourceId: customerId, versionNo: 1 });
    expect(first.body.documentNumber).toMatch(/^SS\/CUST\d+\/\d{4}-\d{2}-\d{2}$/);
    // Reissuing is a new version of "the statement for this customer".
    const again = await api().post(`/reports/stock-statement/${customerId}/document`).set(auth(owner)).send({ regenerate: true }).expect(201);
    expect(again.body.versionNo).toBe(2);
    expect((await api().get(`/verify/${first.body.qrToken}`).expect(200)).body.result).toBe('revoked');
    await api().post(`/reports/stock-statement/${randomUUID()}/document/preview`).set(auth(owner)).expect(404);
  });

  it('gates on view_reports, which a Billing Executive holds and an Operator does not', async () => {
    await api().get(`/reports/stock-statement?customerId=${customerId}`).set(auth(billing)).expect(200);
    await api().get('/reports/ageing').set(auth(billing)).expect(200);
    const opEmail = `op-${suffix}@test.local`;
    await api().post('/users').set(auth(owner)).send({ email: opEmail, fullName: 'Op', password, roleCode: 'warehouse_operator' }).expect(201);
    const op = (await api().post('/auth/login').send({ email: opEmail, password }).expect(201)).body.accessToken;
    await api().get('/reports/ageing').set(auth(op)).expect(403);
    await api().get('/reports/ageing').expect(401);
  });
});
