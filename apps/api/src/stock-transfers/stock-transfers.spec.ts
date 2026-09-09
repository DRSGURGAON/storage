import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../app.module';

/**
 * Blueprint §28's Stock Transfer Note, and with it the two §79 cases this
 * slice is here to satisfy: "transfer between bins/warehouses" and
 * "prevent negative stock".
 */
describe('Stock transfers', () => {
  let app: INestApplication;
  const suffix = randomUUID().slice(0, 8);
  const password = 'correcthorsebattery';
  let owner = '';
  let otherOwner = '';
  let customerId = '';
  let sourceWarehouseId = '';
  let destWarehouseId = '';
  let productId = '';
  let binA = '';
  let binA2 = '';
  let binDest = '';

  const api = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  const signup = async (slug: string, email: string) =>
    (
      await api()
        .post('/auth/signup')
        .send({ companyLegalName: `${slug} Pvt Ltd`, tenantSlug: slug, email, fullName: 'Owner', password })
        .expect(201)
    ).body.accessToken as string;

  const makeBin = async (warehouseId: string, zone: string, bin: string) => {
    const z = await api().post(`/warehouses/${warehouseId}/locations`).set(auth(owner)).send({ level: 'zone', segment: zone }).expect(201);
    const r = await api()
      .post(`/warehouses/${warehouseId}/locations`)
      .set(auth(owner))
      .send({ level: 'rack', segment: 'R01', parentId: z.body.id })
      .expect(201);
    const b = await api()
      .post(`/warehouses/${warehouseId}/locations`)
      .set(auth(owner))
      .send({ level: 'bin', segment: bin, parentId: r.body.id })
      .expect(201);
    return b.body.id as string;
  };

  /** Puts real, put-away stock into a bin -- there is nothing to transfer otherwise. */
  const stockUp = async (quantity: number, locationId: string) => {
    const grn = await api()
      .post('/grns')
      .set(auth(owner))
      .send({
        warehouseId: sourceWarehouseId,
        customerId,
        items: [{ productId, expectedQty: quantity, receivedQty: quantity, acceptedQty: quantity }],
      })
      .expect(201);
    for (const step of ['submit', 'check', 'approve']) {
      await api().post(`/grns/${grn.body.id}/${step}`).set(auth(owner)).expect(201);
    }
    const putaway = await api()
      .post('/putaways')
      .set(auth(owner))
      .send({ grnId: grn.body.id, lines: [{ grnItemId: grn.body.items[0].id, quantity, toLocationId: locationId }] })
      .expect(201);
    await api().post(`/putaways/${putaway.body.id}/complete`).set(auth(owner)).expect(201);
  };

  const balances = async () => {
    const res = await api().get('/stock?limit=100').set(auth(owner)).expect(200);
    return Object.fromEntries(
      res.body.items.map((i: Record<string, string>) => [i.locationFullCode ?? `${i.warehouseCode}:unallocated`, i.physicalQty]),
    ) as Record<string, string>;
  };
  const totalOnHand = async () =>
    (await api().get('/stock?limit=100').set(auth(owner)).expect(200)).body.items.reduce(
      (sum: number, i: { physicalQty: string }) => sum + Number(i.physicalQty),
      0,
    );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    owner = await signup(`st-a-${suffix}`, `owner-a-${suffix}@test.local`);
    otherOwner = await signup(`st-b-${suffix}`, `owner-b-${suffix}@test.local`);

    customerId = (await api().post('/customers').set(auth(owner)).send({ name: 'Acme Co' }).expect(201)).body.id;
    sourceWarehouseId = (
      await api().post('/warehouses').set(auth(owner)).send({ code: 'WH01', name: 'Gurugram' }).expect(201)
    ).body.id;
    destWarehouseId = (
      await api().post('/warehouses').set(auth(owner)).send({ code: 'WH02', name: 'Bhiwandi' }).expect(201)
    ).body.id;
    productId = (
      await api().post('/products').set(auth(owner)).send({ sku: 'RICE-25', name: 'Basmati 25kg', uomCode: 'BAG' }).expect(201)
    ).body.id;
    binA = await makeBin(sourceWarehouseId, 'A', 'B01');
    binA2 = await makeBin(sourceWarehouseId, 'A2', 'B02');
    binDest = await makeBin(destWarehouseId, 'D', 'B09');
    await stockUp(100, binA);
  });

  afterAll(async () => {
    await app.close();
  });

  it('refuses a kind that contradicts the warehouses, and a location outside its own warehouse', async () => {
    const line = { productId, quantity: 1, fromLocationId: binA, toLocationId: binA2 };
    // 'warehouse' with one warehouse, and 'location' with two, are each a
    // mistake worth naming rather than silently reinterpreting.
    await api()
      .post('/stock-transfers')
      .set(auth(owner))
      .send({ transferKind: 'warehouse', customerId, fromWarehouseId: sourceWarehouseId, toWarehouseId: sourceWarehouseId, lines: [line] })
      .expect(400);
    await api()
      .post('/stock-transfers')
      .set(auth(owner))
      .send({
        transferKind: 'location',
        customerId,
        fromWarehouseId: sourceWarehouseId,
        toWarehouseId: sourceWarehouseId,
        lines: [{ ...line, toLocationId: binDest }],
      })
      .expect(400);
    // Same bin to same bin moves nothing.
    await api()
      .post('/stock-transfers')
      .set(auth(owner))
      .send({
        transferKind: 'location',
        customerId,
        fromWarehouseId: sourceWarehouseId,
        toWarehouseId: sourceWarehouseId,
        lines: [{ ...line, toLocationId: binA }],
      })
      .expect(400);
    await api()
      .post('/stock-transfers')
      .set(auth(owner))
      .send({ transferKind: 'location', customerId, fromWarehouseId: sourceWarehouseId, toWarehouseId: sourceWarehouseId, lines: [] })
      .expect(400);
  });

  it('moves stock bin to bin in one posting -- a pallet across an aisle has no journey', async () => {
    const transfer = await api()
      .post('/stock-transfers')
      .set(auth(owner))
      .send({
        transferKind: 'location',
        customerId,
        fromWarehouseId: sourceWarehouseId,
        toWarehouseId: sourceWarehouseId,
        lines: [{ productId, quantity: 30, fromLocationId: binA, toLocationId: binA2 }],
      })
      .expect(201);
    expect(transfer.body.number).toMatch(/^ST\//);

    // There is no truck, so there is nothing to dispatch.
    await api().post(`/stock-transfers/${transfer.body.id}/dispatch`).set(auth(owner)).expect(400);
    // And nothing moves until it is approved and completed.
    expect((await balances())['WH01-A-R01-B01']).toBe('100.000');
    await api().post(`/stock-transfers/${transfer.body.id}/approve`).set(auth(owner)).expect(201);
    expect((await balances())['WH01-A-R01-B01']).toBe('100.000');

    await api().post(`/stock-transfers/${transfer.body.id}/complete`).set(auth(owner)).expect(201);
    const after = await balances();
    expect(after['WH01-A-R01-B01']).toBe('70.000');
    expect(after['WH01-A2-R01-B02']).toBe('30.000');

    const ledger = await api().get(`/stock/ledger?sourceId=${transfer.body.id}`).set(auth(owner)).expect(200);
    expect(ledger.body.items.map((r: { txnType: string }) => r.txnType)).toEqual(['TRANSFER_OUT', 'TRANSFER_IN']);
  });

  it('leaves warehouse-to-warehouse stock in neither warehouse while it is on the road', async () => {
    const transfer = await api()
      .post('/stock-transfers')
      .set(auth(owner))
      .send({
        transferKind: 'warehouse',
        customerId,
        fromWarehouseId: sourceWarehouseId,
        toWarehouseId: destWarehouseId,
        lines: [{ productId, quantity: 40, fromLocationId: binA, toLocationId: binDest }],
      })
      .expect(201);
    await api().post(`/stock-transfers/${transfer.body.id}/approve`).set(auth(owner)).expect(201);

    // Goods cannot arrive before they leave.
    await api().post(`/stock-transfers/${transfer.body.id}/complete`).set(auth(owner)).expect(400);

    const before = await totalOnHand();
    await api().post(`/stock-transfers/${transfer.body.id}/dispatch`).set(auth(owner)).expect(201);

    // This is the whole point of splitting the posting: while the truck is
    // moving, the 40 bags are in nobody's rack, because that is where they
    // physically are. Showing them at the source would invite a pick that
    // cannot be fulfilled.
    expect(await totalOnHand()).toBe(before - 40);
    const inTransit = await balances();
    expect(inTransit['WH01-A-R01-B01']).toBe('30.000');
    expect(inTransit['WH02-D-R01-B09']).toBeUndefined();

    // And the departure cannot be un-said by cancelling: the TRANSFER_OUT
    // is in the ledger, and reversal is additive (stock-engine.md §3.5).
    await api().post(`/stock-transfers/${transfer.body.id}/cancel`).set(auth(owner)).expect(400);

    await api().post(`/stock-transfers/${transfer.body.id}/complete`).set(auth(owner)).expect(201);
    expect(await totalOnHand()).toBe(before);
    expect((await balances())['WH02-D-R01-B09']).toBe('40.000');

    const ledger = await api().get(`/stock/ledger?sourceId=${transfer.body.id}`).set(auth(owner)).expect(200);
    expect(ledger.body.items).toHaveLength(2);
    expect(ledger.body.items[0]).toMatchObject({ txnType: 'TRANSFER_OUT', warehouseCode: 'WH01' });
    expect(ledger.body.items[1]).toMatchObject({ txnType: 'TRANSFER_IN', warehouseCode: 'WH02' });
  });

  it('lands unallocated at the destination when no bin is named, like a receipt awaiting put-away', async () => {
    const transfer = await api()
      .post('/stock-transfers')
      .set(auth(owner))
      .send({
        transferKind: 'warehouse',
        customerId,
        fromWarehouseId: sourceWarehouseId,
        toWarehouseId: destWarehouseId,
        lines: [{ productId, quantity: 10, fromLocationId: binA2 }],
      })
      .expect(201);
    for (const step of ['approve', 'dispatch', 'complete']) {
      await api().post(`/stock-transfers/${transfer.body.id}/${step}`).set(auth(owner)).expect(201);
    }
    const lots = await api().get(`/stock?warehouseId=${destWarehouseId}&limit=100`).set(auth(owner)).expect(200);
    const unallocated = lots.body.items.find((i: { locationId: string | null }) => i.locationId === null);
    expect(unallocated).toMatchObject({ physicalQty: '10.000' });
  });

  it('refuses to move more than is in the bin, and leaves nothing behind when it does', async () => {
    // §79's "prevent negative stock", reached through a real document
    // rather than against the service directly.
    const before = await totalOnHand();
    const transfer = await api()
      .post('/stock-transfers')
      .set(auth(owner))
      .send({
        transferKind: 'location',
        customerId,
        fromWarehouseId: sourceWarehouseId,
        toWarehouseId: sourceWarehouseId,
        lines: [{ productId, quantity: 9999, fromLocationId: binA, toLocationId: binA2 }],
      })
      .expect(201);
    await api().post(`/stock-transfers/${transfer.body.id}/approve`).set(auth(owner)).expect(201);

    const refused = await api().post(`/stock-transfers/${transfer.body.id}/complete`).set(auth(owner)).expect(400);
    expect(refused.body.message).toMatch(/negative/i);

    // The whole transition rolled back: still approved, no ledger rows, no
    // balance moved.
    expect((await api().get(`/stock-transfers/${transfer.body.id}`).set(auth(owner)).expect(200)).body.status).toBe('approved');
    expect((await api().get(`/stock/ledger?sourceId=${transfer.body.id}`).set(auth(owner)).expect(200)).body.total).toBe(0);
    expect(await totalOnHand()).toBe(before);
  });

  it('renders the Stock Transfer Note -- the ninth registered template', async () => {
    const transfer = await api()
      .post('/stock-transfers')
      .set(auth(owner))
      .send({
        transferKind: 'warehouse',
        customerId,
        fromWarehouseId: sourceWarehouseId,
        toWarehouseId: destWarehouseId,
        remarks: 'Consolidating slow movers',
        lines: [{ productId, quantity: 5, fromLocationId: binA, toLocationId: binDest }],
      })
      .expect(201);

    const preview = await api().post(`/stock-transfers/${transfer.body.id}/document/preview`).set(auth(owner)).expect(201);
    expect(Buffer.from(preview.body).subarray(0, 4).toString()).toBe('%PDF');

    const committed = await api().post(`/stock-transfers/${transfer.body.id}/document`).set(auth(owner)).send({}).expect(201);
    expect(committed.body).toMatchObject({ documentType: 'stock_transfer', versionNo: 1 });
    expect(committed.body.documentNumber).toBe(transfer.body.number);

    const verified = await api().get(`/verify/${committed.body.qrToken}`).expect(200);
    expect(verified.body.result).toBe('valid');
  });

  it('cancels before the goods move, filters, and isolates tenants', async () => {
    const transfer = await api()
      .post('/stock-transfers')
      .set(auth(owner))
      .send({
        transferKind: 'location',
        customerId,
        fromWarehouseId: sourceWarehouseId,
        toWarehouseId: sourceWarehouseId,
        lines: [{ productId, quantity: 1, fromLocationId: binA, toLocationId: binA2 }],
      })
      .expect(201);
    await api().post(`/stock-transfers/${transfer.body.id}/cancel`).set(auth(owner)).expect(201);
    expect((await api().get(`/stock-transfers/${transfer.body.id}`).set(auth(owner)).expect(200)).body.status).toBe('cancelled');
    await api().post(`/stock-transfers/${transfer.body.id}/complete`).set(auth(owner)).expect(400);

    const completed = await api().get('/stock-transfers?status=completed').set(auth(owner)).expect(200);
    expect(completed.body.items.every((t: { status: string }) => t.status === 'completed')).toBe(true);
    expect(completed.body.total).toBeGreaterThan(0);

    expect((await api().get('/stock-transfers').set(auth(otherOwner)).expect(200)).body.total).toBe(0);
    await api().get(`/stock-transfers/${transfer.body.id}`).set(auth(otherOwner)).expect(404);
    await api().get('/stock-transfers').expect(401);
  });
});
