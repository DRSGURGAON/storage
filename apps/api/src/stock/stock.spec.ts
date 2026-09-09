import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import request from 'supertest';
import { AppModule } from '../app.module';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { StockService } from './stock.service';

/**
 * The stock engine (stock-engine.md), tested where it actually lives:
 * through the operational documents that move stock, since there is no
 * endpoint that writes a balance directly. The two exceptions are the
 * invariants and the idempotency guard -- both are defence-in-depth
 * behind transitions that already refuse a second attempt, so they are
 * exercised against `StockService` itself rather than pretended to be
 * reachable over HTTP.
 */
describe('Stock engine', () => {
  let app: INestApplication;
  let stock: StockService;
  let sql: postgres.Sql;
  const suffix = randomUUID().slice(0, 8);
  const password = 'correcthorsebattery';
  let owner = '';
  let ownerActor: AuthenticatedUser;
  let otherOwner = '';
  let billingExec = '';
  let customerId = '';
  let warehouseId = '';
  let productId = '';
  let batchProductId = '';
  let serialProductId = '';
  let binId = '';
  let binCode = '';
  let bin2Id = '';

  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const signup = async (slug: string, email: string) => {
    const res = await api()
      .post('/auth/signup')
      .send({ companyLegalName: `${slug} Pvt Ltd`, tenantSlug: slug, email, fullName: 'Owner', password })
      .expect(201);
    return res.body.accessToken as string;
  };

  /**
   * The two service-level tests need a real `AuthenticatedUser`, and the
   * token the API just issued is exactly that -- read it from the JWT
   * rather than re-deriving the ids from the database, so the actor these
   * tests post as is the same one an HTTP request would carry.
   */
  const actorFrom = (token: string): AuthenticatedUser => {
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    return {
      userId: claims.sub,
      tenantId: claims.tenantId,
      tenantUserId: claims.tenantUserId,
      roleCode: claims.roleCode,
    } as AuthenticatedUser;
  };

  const location = async (level: string, segment: string, parentId?: string) =>
    (
      await api()
        .post(`/warehouses/${warehouseId}/locations`)
        .set(auth(owner))
        .send({ level, segment, ...(parentId ? { parentId } : {}) })
        .expect(201)
    ).body as { id: string; fullCode: string };

  /** Drives a GRN all the way to approved -- the moment stock exists. */
  const approvedGrn = async (items: Record<string, unknown>[], overrides: Record<string, unknown> = {}) => {
    const grn = await api()
      .post('/grns')
      .set(auth(owner))
      .send({ warehouseId, customerId, items, ...overrides })
      .expect(201);
    for (const step of ['submit', 'check', 'approve']) {
      await api().post(`/grns/${grn.body.id}/${step}`).set(auth(owner)).expect(201);
    }
    return (await api().get(`/grns/${grn.body.id}`).set(auth(owner)).expect(200)).body as {
      id: string;
      stockPostedAt: string | null;
      items: { id: string; batchId: string | null }[];
    };
  };

  const stockRows = async (token = owner, query = '') =>
    (await api().get(`/stock${query}`).set(auth(token)).expect(200)).body.items as Record<string, string | null>[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    stock = app.get(StockService);
    sql = app.get(PG_CONNECTION);

    owner = await signup(`stk-a-${suffix}`, `owner-a-${suffix}@test.local`);
    ownerActor = actorFrom(owner);
    otherOwner = await signup(`stk-b-${suffix}`, `owner-b-${suffix}@test.local`);

    const beEmail = `be-${suffix}@test.local`;
    await api()
      .post('/users')
      .set(auth(owner))
      .send({ email: beEmail, fullName: 'Billing', password, roleCode: 'billing_executive' })
      .expect(201);
    billingExec = (await api().post('/auth/login').send({ email: beEmail, password }).expect(201)).body.accessToken;

    customerId = (await api().post('/customers').set(auth(owner)).send({ name: 'Acme Co' }).expect(201)).body.id;
    warehouseId = (
      await api().post('/warehouses').set(auth(owner)).send({ code: 'WH01', name: 'Main Godown' }).expect(201)
    ).body.id;
    productId = (
      await api().post('/products').set(auth(owner)).send({ sku: 'SKU001', name: 'Widget', uomCode: 'NOS' }).expect(201)
    ).body.id;
    batchProductId = (
      await api()
        .post('/products')
        .set(auth(owner))
        .send({ sku: 'RICE-25', name: 'Basmati 25kg', uomCode: 'BAG', batchTracked: true })
        .expect(201)
    ).body.id;
    serialProductId = (
      await api()
        .post('/products')
        .set(auth(owner))
        .send({ sku: 'TV-55', name: '55in TV', uomCode: 'NOS', serialTracked: true })
        .expect(201)
    ).body.id;

    const zone = await location('zone', 'A');
    const rack = await location('rack', 'R04', zone.id);
    const bin = await location('bin', 'B15', rack.id);
    binId = bin.id;
    binCode = bin.fullCode;
    bin2Id = (await location('bin', 'B16', rack.id)).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('posts accepted stock at GRN approval -- unallocated, and only what was accepted', async () => {
    const grn = await approvedGrn([{ productId, expectedQty: 100, receivedQty: 100, acceptedQty: 90, rejectedQty: 10 }]);
    expect(grn.stockPostedAt).not.toBeNull();

    const lots = await stockRows(owner, `?productId=${productId}`);
    expect(lots).toHaveLength(1);
    // Rejected goods are not stock. 90 accepted, not the 100 received.
    expect(lots[0]).toMatchObject({
      physicalQty: '90.000',
      reservedQty: '0.000',
      availableQty: '90.000',
      locationId: null,
      locationFullCode: null,
      uomCode: 'NOS',
    });

    const ledger = (await api().get(`/stock/ledger?sourceId=${grn.id}`).set(auth(owner)).expect(200)).body;
    expect(ledger.items).toHaveLength(1);
    expect(ledger.items[0]).toMatchObject({
      txnType: 'INWARD',
      qtyIn: '90.000',
      qtyOut: '0.000',
      balancePhysicalQty: '90.000',
      sourceType: 'grn',
      sourceId: grn.id,
    });
  });

  it('resolves a batch once and stamps first_received_at from the first GRN only', async () => {
    const first = await approvedGrn([
      { productId: batchProductId, batchNo: 'B-2609', expiryDate: '2027-01-31', receivedQty: 40, acceptedQty: 40 },
    ]);
    // Received again, months later, into the same batch.
    const second = await approvedGrn(
      [{ productId: batchProductId, batchNo: 'B-2609', receivedQty: 10, acceptedQty: 10 }],
      { grnDate: '2027-03-01' },
    );
    // The same batch number for the same customer/product is one batch.
    expect(second.items[0].batchId).toBe(first.items[0].batchId);

    const lots = await stockRows(owner, `?productId=${batchProductId}`);
    expect(lots).toHaveLength(1);
    expect(lots[0]).toMatchObject({ batchNo: 'B-2609', physicalQty: '50.000', expiryDate: '2027-01-31' });

    // Ageing is computed from first_received_at (stock-engine.md §5), so a
    // later receipt into the batch must not make the stock look younger.
    const [batch] = await withTenant(sql, ownerActor.tenantId, (tx) =>
      tx<{ first_received_at: string }[]>`
        select first_received_at from batches where id = ${first.items[0].batchId!}
      `,
    );
    expect(batch.first_received_at.slice(0, 10)).not.toBe('2027-03-01');
  });

  it('gives a serial-tracked product one lot per serial, of one unit each', async () => {
    const grn = await approvedGrn([
      { productId: serialProductId, receivedQty: 3, acceptedQty: 3, serialNos: ['SN-001', 'SN-002', 'SN-003'] },
    ]);
    expect(grn.stockPostedAt).not.toBeNull();

    const lots = await stockRows(owner, `?productId=${serialProductId}`);
    expect(lots).toHaveLength(3);
    expect(lots.map((l) => l.serialNo).sort()).toEqual(['SN-001', 'SN-002', 'SN-003']);
    expect(lots.every((l) => l.physicalQty === '1.000')).toBe(true);
  });

  it('refuses to post a serial-tracked line whose serials do not account for every accepted unit', async () => {
    const grn = await api()
      .post('/grns')
      .set(auth(owner))
      .send({
        warehouseId,
        customerId,
        items: [{ productId: serialProductId, receivedQty: 2, acceptedQty: 2, serialNos: ['SN-ONLY-ONE'] }],
      })
      .expect(201);
    await api().post(`/grns/${grn.body.id}/submit`).set(auth(owner)).expect(201);
    await api().post(`/grns/${grn.body.id}/check`).set(auth(owner)).expect(201);

    const res = await api().post(`/grns/${grn.body.id}/approve`).set(auth(owner)).expect(400);
    expect(res.body.message).toContain('one accepted serial number');

    // The whole approval rolled back: still checked, still nothing posted.
    const after = await api().get(`/grns/${grn.body.id}`).set(auth(owner)).expect(200);
    expect(after.body.status).toBe('checked');
    expect(after.body.stockPostedAt).toBeNull();
    const ledger = await api().get(`/stock/ledger?sourceId=${grn.body.id}`).set(auth(owner)).expect(200);
    expect(ledger.body.total).toBe(0);
  });

  it('moves stock from unallocated to the bin when a put-away completes, as a transfer pair', async () => {
    // Its own SKU: lots are keyed per product, so a shared one would carry
    // other tests' quantities into these assertions.
    const sku = (
      await api().post('/products').set(auth(owner)).send({ sku: 'PA-SKU', name: 'Pallet Goods', uomCode: 'NOS' }).expect(201)
    ).body.id;
    const grn = await approvedGrn([{ productId: sku, receivedQty: 90, acceptedQty: 90 }]);
    const putaway = await api()
      .post('/putaways')
      .set(auth(owner))
      .send({
        grnId: grn.id,
        lines: [
          { grnItemId: grn.items[0].id, quantity: 60, toLocationId: binId },
          { grnItemId: grn.items[0].id, quantity: 30, toLocationId: bin2Id },
        ],
      })
      .expect(201);

    const completed = await api().post(`/putaways/${putaway.body.id}/complete`).set(auth(owner)).expect(201);
    // Each line now points at the balance row it created, not just a location.
    expect(completed.body.lines.every((l: { stockLotId: string | null }) => l.stockLotId !== null)).toBe(true);

    const ledger = (await api().get(`/stock/ledger?sourceId=${putaway.body.id}`).set(auth(owner)).expect(200)).body;
    expect(ledger.items.map((r: { txnType: string }) => r.txnType)).toEqual([
      'TRANSFER_OUT',
      'TRANSFER_IN',
      'TRANSFER_OUT',
      'TRANSFER_IN',
    ]);

    // The unallocated lot is emptied rather than deleted, so it drops out of
    // "current stock" but is still there with includeEmpty.
    const placed = await stockRows(owner, `?productId=${sku}&limit=100`);
    expect(placed.map((l) => [l.locationFullCode, l.physicalQty]).sort()).toEqual([
      [binCode, '60.000'],
      [binCode.replace('B15', 'B16'), '30.000'],
    ]);
    const withEmpty = await stockRows(owner, `?productId=${sku}&includeEmpty=true&limit=100`);
    expect(withEmpty.some((l) => l.locationId === null && l.physicalQty === '0.000')).toBe(true);
  });

  it('picks specific serials for a serial-tracked put-away, leaving the rest unallocated', async () => {
    const grn = await approvedGrn([
      { productId: serialProductId, receivedQty: 3, acceptedQty: 3, serialNos: ['PA-001', 'PA-002', 'PA-003'] },
    ]);
    const putaway = await api()
      .post('/putaways')
      .set(auth(owner))
      .send({ grnId: grn.id, lines: [{ grnItemId: grn.items[0].id, quantity: 2, toLocationId: binId }] })
      .expect(201);
    await api().post(`/putaways/${putaway.body.id}/complete`).set(auth(owner)).expect(201);

    const ledger = (await api().get(`/stock/ledger?sourceId=${putaway.body.id}`).set(auth(owner)).expect(200)).body;
    // Two units means two transfer *pairs*, each naming one serial -- both
    // halves of a pair move the same lot, which is the point of choosing the
    // serials server-side rather than guessing.
    expect(ledger.items).toHaveLength(4);
    const moved = new Set(ledger.items.map((r: { serialNo: string }) => r.serialNo));
    expect(moved.size).toBe(2);
    for (const row of ledger.items) {
      expect(row.qtyIn === '1.000' || row.qtyOut === '1.000').toBe(true);
    }

    const lots = await stockRows(owner, `?productId=${serialProductId}&limit=100`);
    const placed = lots.filter((l) => l.locationId === binId).map((l) => l.serialNo);
    expect(placed).toHaveLength(2);
    expect(placed.every((s) => moved.has(s))).toBe(true);
    // The third is still where the GRN put it.
    expect(lots.some((l) => l.locationId === null && !moved.has(l.serialNo))).toBe(true);
  });

  it('is idempotent: re-posting the same key writes nothing a second time', async () => {
    const key = `test:${randomUUID()}:post`;
    const movement = {
      txnType: 'INWARD' as const,
      customerId,
      warehouseId,
      locationId: null,
      productId,
      batchId: null,
      serialNo: null,
      qtyIn: 5,
      uomCode: 'NOS',
    };
    const sourceId = randomUUID();

    const first = await withTenant(sql, ownerActor.tenantId, (tx) =>
      stock.postWithin(tx, ownerActor, { sourceType: 'test', sourceId, idempotencyKey: key, movements: [movement] }),
    );
    expect(first.posted).toBe(true);

    const retry = await withTenant(sql, ownerActor.tenantId, (tx) =>
      stock.postWithin(tx, ownerActor, { sourceType: 'test', sourceId, idempotencyKey: key, movements: [movement] }),
    );
    // A retry is a no-op that reports the rows already there, not an error
    // and not a second five units (stock-engine.md §4).
    expect(retry.posted).toBe(false);
    expect(retry.ledgerIds).toEqual(first.ledgerIds);

    const ledger = await api().get(`/stock/ledger?sourceId=${sourceId}`).set(auth(owner)).expect(200);
    expect(ledger.body.total).toBe(1);
  });

  it('refuses to take a balance negative, and says so', async () => {
    const sourceId = randomUUID();
    await expect(
      withTenant(sql, ownerActor.tenantId, (tx) =>
        stock.postWithin(tx, ownerActor, {
          sourceType: 'test',
          sourceId,
          idempotencyKey: `test:${randomUUID()}:negative`,
          movements: [
            {
              txnType: 'OUTWARD',
              customerId,
              warehouseId,
              locationId: bin2Id,
              productId: batchProductId,
              batchId: null,
              serialNo: null,
              qtyOut: 1,
              uomCode: 'BAG',
            },
          ],
        }),
      ),
    ).rejects.toThrow(/negative/i);

    // The failed posting left nothing behind -- no ledger row, no lot.
    const ledger = await api().get(`/stock/ledger?sourceId=${sourceId}`).set(auth(owner)).expect(200);
    expect(ledger.body.total).toBe(0);
  });

  it("keeps one tenant's stock and ledger entirely out of another's", async () => {
    await approvedGrn([{ productId, receivedQty: 7, acceptedQty: 7 }]);

    const mine = await stockRows(owner, '?limit=100');
    expect(mine.length).toBeGreaterThan(0);
    const theirs = await stockRows(otherOwner, '?limit=100');
    expect(theirs).toEqual([]);
    const theirLedger = await api().get('/stock/ledger').set(auth(otherOwner)).expect(200);
    expect(theirLedger.body.total).toBe(0);
  });

  it('lets every internal role read stock, including one with no operations access at all', async () => {
    // permissions-matrix.md's stock module is the broadest row in the file:
    // a Billing Executive cannot touch a GRN but must still see stock.
    await api().get('/stock').set(auth(billingExec)).expect(200);
    await api().get('/stock/ledger').set(auth(billingExec)).expect(200);
    await api().post('/grns').set(auth(billingExec)).send({ warehouseId, customerId, items: [] }).expect(403);

    await api().get('/stock').expect(401);
    await api().get('/stock/ledger').expect(401);
  });
});
