import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../app.module';

/**
 * Blueprint §37: goods come back through a Return Request, a Return
 * Inward, and a GRN that posts `RETURN` rather than `INWARD` -- the same
 * receipt, check and approval as any arrival, so the inbound controls are
 * not bypassed by the goods having been ours once already.
 */
describe('Returns', () => {
  let app: INestApplication;
  const suffix = randomUUID().slice(0, 8);
  const password = 'correcthorsebattery';
  let owner = '';
  let operator = '';
  let otherOwner = '';
  let customerId = '';
  let otherCustomerId = '';
  let warehouseId = '';
  let productId = '';
  let dispatchId = '';

  const api = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  const signup = async (slug: string, email: string) =>
    (
      await api()
        .post('/auth/signup')
        .send({ companyLegalName: `${slug} Pvt Ltd`, tenantSlug: slug, email, fullName: 'Owner', password })
        .expect(201)
    ).body.accessToken as string;

  const totals = async () =>
    (await api().get(`/stock?productId=${productId}&limit=100`).set(auth(owner)).expect(200)).body.items.reduce(
      (acc: { physical: number; reserved: number }, l: { physicalQty: string; reservedQty: string }) => ({
        physical: acc.physical + Number(l.physicalQty),
        reserved: acc.reserved + Number(l.reservedQty),
      }),
      { physical: 0, reserved: 0 },
    );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    owner = await signup(`rt-a-${suffix}`, `owner-a-${suffix}@test.local`);
    otherOwner = await signup(`rt-b-${suffix}`, `owner-b-${suffix}@test.local`);
    const opEmail = `op-${suffix}@test.local`;
    await api().post('/users').set(auth(owner)).send({ email: opEmail, fullName: 'Op', password, roleCode: 'warehouse_operator' }).expect(201);
    operator = (await api().post('/auth/login').send({ email: opEmail, password }).expect(201)).body.accessToken;

    customerId = (await api().post('/customers').set(auth(owner)).send({ name: 'Acme Co' }).expect(201)).body.id;
    otherCustomerId = (await api().post('/customers').set(auth(owner)).send({ name: 'Bolt Ltd' }).expect(201)).body.id;
    warehouseId = (await api().post('/warehouses').set(auth(owner)).send({ code: 'WH01', name: 'Gurugram' }).expect(201)).body.id;
    productId = (await api().post('/products').set(auth(owner)).send({ sku: 'RICE-25', name: 'Basmati 25kg', uomCode: 'BAG' }).expect(201)).body.id;
    const zone = await api().post(`/warehouses/${warehouseId}/locations`).set(auth(owner)).send({ level: 'zone', segment: 'A' }).expect(201);
    const rack = await api().post(`/warehouses/${warehouseId}/locations`).set(auth(owner)).send({ level: 'rack', segment: 'R01', parentId: zone.body.id }).expect(201);
    const bin = await api().post(`/warehouses/${warehouseId}/locations`).set(auth(owner)).send({ level: 'bin', segment: 'B01', parentId: rack.body.id }).expect(201);

    // 100 in, 40 out through the whole chain, so there is a dispatch to return against.
    const grn = await api()
      .post('/grns')
      .set(auth(owner))
      .send({ warehouseId, customerId, items: [{ productId, expectedQty: 100, receivedQty: 100, acceptedQty: 100 }] })
      .expect(201);
    for (const step of ['submit', 'check', 'approve']) await api().post(`/grns/${grn.body.id}/${step}`).set(auth(owner)).expect(201);
    const putaway = await api()
      .post('/putaways')
      .set(auth(owner))
      .send({ grnId: grn.body.id, lines: [{ grnItemId: grn.body.items[0].id, quantity: 100, toLocationId: bin.body.id }] })
      .expect(201);
    await api().post(`/putaways/${putaway.body.id}/complete`).set(auth(owner)).expect(201);
    const order = (await api().post('/release-orders').set(auth(owner)).send({ customerId, warehouseId, lines: [{ productId, requestedQty: 40 }] }).expect(201)).body;
    await api().post(`/release-orders/${order.id}/approve`).set(auth(owner)).expect(201);
    await api().post(`/release-orders/${order.id}/reserve`).set(auth(owner)).send({}).expect(201);
    const pick = (await api().post('/pick-lists').set(auth(owner)).send({ releaseOrderId: order.id }).expect(201)).body;
    await api().post(`/pick-lists/${pick.id}/confirm`).set(auth(owner)).send({ lines: [{ lineId: pick.lines[0].id, pickQty: 40 }] }).expect(201);
    await api().post(`/pick-lists/${pick.id}/complete`).set(auth(owner)).expect(201);
    dispatchId = (await api().post('/dispatches').set(auth(owner)).send({ releaseOrderId: order.id }).expect(201)).body.id;
    const pass = (await api().post('/gate-passes').set(auth(owner)).send({ dispatchId }).expect(201)).body;
    await api().post(`/gate-passes/${pass.id}/gate-out`).set(auth(owner)).expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('holds a request to what the dispatch carried, and to the customer it went to', async () => {
    expect(await totals()).toEqual({ physical: 60, reserved: 0 });
    const base = { customerId, warehouseId, originalDispatchId: dispatchId, reason: 'Wrong grade' };
    const over = await api().post('/return-requests').set(auth(owner)).send({ ...base, lines: [{ productId, quantity: 41 }] }).expect(400);
    expect(over.body.message).toMatch(/carried 40/);
    await api().post('/return-requests').set(auth(owner)).send({ ...base, customerId: otherCustomerId, lines: [{ productId, quantity: 1 }] }).expect(400);
    // A dispatch still in the yard has nothing to return yet.
    const draftNote = (await api().get('/dispatches?status=draft').set(auth(owner)).expect(200)).body;
    expect(draftNote.total).toBe(0);
    // An Operator does not raise return requests.
    await api().post('/return-requests').set(auth(operator)).send({ ...base, lines: [{ productId, quantity: 1 }] }).expect(403);
  });

  it('brings 10 back as RETURN through a GRN raised from the return inward: 60 → 70', async () => {
    const req = await api()
      .post('/return-requests')
      .set(auth(owner))
      .send({ customerId, warehouseId, originalDispatchId: dispatchId, reason: 'Wrong grade', lines: [{ productId, quantity: 10 }] })
      .expect(201);
    expect(req.body.number).toMatch(/^RR\//);
    expect(req.body.status).toBe('requested');
    // Nothing arrives against an unapproved request.
    await api().post('/return-inwards').set(auth(owner)).send({ returnRequestId: req.body.id }).expect(400);
    // Approval is a receiving decision: the Operator cannot, the Owner can.
    await api().post(`/return-requests/${req.body.id}/approve`).set(auth(operator)).expect(403);
    expect((await api().post(`/return-requests/${req.body.id}/approve`).set(auth(owner)).expect(201)).body.status).toBe('approved');

    // The 10 under this request are spoken for; a second request may only claim the other 30.
    const second = await api()
      .post('/return-requests')
      .set(auth(owner))
      .send({ customerId, warehouseId, originalDispatchId: dispatchId, reason: 'More', lines: [{ productId, quantity: 31 }] })
      .expect(400);
    expect(second.body.message).toMatch(/of which 30 is not already under a return request/);

    const inward = await api().post('/return-inwards').set(auth(operator)).send({ returnRequestId: req.body.id }).expect(201);
    expect(inward.body.number).toMatch(/^RI\//);
    expect(inward.body.status).toBe('draft');
    await api().post('/return-inwards').set(auth(owner)).send({ returnRequestId: req.body.id }).expect(400); // one open per request
    // The request cannot be cancelled out from under an open arrival.
    await api().post(`/return-requests/${req.body.id}/cancel`).set(auth(owner)).expect(400);
    const blank = await api().post(`/return-inwards/${inward.body.id}/document/preview`).set(auth(owner)).expect(201);
    expect(Buffer.from(blank.body).subarray(0, 4).toString()).toBe('%PDF');
    expect((await api().post(`/return-inwards/${inward.body.id}/inspect`).set(auth(operator)).expect(201)).body.status).toBe('inspected');

    // The GRN defaults everything from the return: customer, warehouse, and the request's lines.
    await api().post('/grns').set(auth(owner)).send({ returnInwardId: inward.body.id, inwardId: inward.body.id }).expect(400);
    const grn = await api().post('/grns').set(auth(operator)).send({ returnInwardId: inward.body.id }).expect(201);
    expect(grn.body).toMatchObject({ customerId, warehouseId, returnInwardId: inward.body.id, status: 'draft' });
    expect(grn.body.items[0]).toMatchObject({ productId, expectedQty: 10, acceptedQty: 10 });
    await api().post('/grns').set(auth(owner)).send({ returnInwardId: inward.body.id }).expect(400); // one open GRN per arrival
    expect((await api().get(`/return-inwards/${inward.body.id}`).set(auth(owner)).expect(200)).body.grnNumber).toBe(grn.body.number);

    expect(await totals()).toEqual({ physical: 60, reserved: 0 });
    await api().post(`/grns/${grn.body.id}/submit`).set(auth(operator)).expect(201);
    await api().post(`/grns/${grn.body.id}/check`).set(auth(owner)).expect(201);
    await api().post(`/grns/${grn.body.id}/approve`).set(auth(owner)).expect(201);
    expect(await totals()).toEqual({ physical: 70, reserved: 0 });
    const ledger = await api().get(`/stock/ledger?sourceId=${grn.body.id}`).set(auth(owner)).expect(200);
    expect(ledger.body.items).toHaveLength(1);
    expect(ledger.body.items[0]).toMatchObject({ txnType: 'RETURN', qtyIn: '10.000', locationId: null });
    expect((await api().get(`/return-inwards/${inward.body.id}`).set(auth(owner)).expect(200)).body.status).toBe('grn_posted');
    expect((await api().get(`/return-requests/${req.body.id}`).set(auth(owner)).expect(200)).body.status).toBe('received');
    // Posted, the arrival can no longer be cancelled.
    await api().post(`/return-inwards/${inward.body.id}/cancel`).set(auth(owner)).expect(400);

    // The nineteenth template, now carrying what actually came back.
    const doc = await api().post(`/return-inwards/${inward.body.id}/document`).set(auth(owner)).send({}).expect(201);
    expect(doc.body).toMatchObject({ documentType: 'return_inward', versionNo: 1, documentNumber: inward.body.number });
    expect((await api().get(`/verify/${doc.body.qrToken}`).expect(200)).body.result).toBe('valid');

    // Reversal mirrors RETURN with RETURN, and hands the arrival back to inspected.
    await api().post(`/grns/${grn.body.id}/reverse`).set(auth(owner)).expect(201);
    expect(await totals()).toEqual({ physical: 60, reserved: 0 });
    const after = await api().get(`/stock/ledger?sourceId=${grn.body.id}`).set(auth(owner)).expect(200);
    expect(after.body.items.map((r: { txnType: string; qtyOut: string }) => [r.txnType, r.qtyOut])).toEqual([['RETURN', '0.000'], ['RETURN', '10.000']]);
    expect((await api().get(`/return-inwards/${inward.body.id}`).set(auth(owner)).expect(200)).body).toMatchObject({ status: 'inspected', grnId: null });
    expect((await api().get(`/return-requests/${req.body.id}`).set(auth(owner)).expect(200)).body.status).toBe('approved');
    // And a corrected GRN can be raised from it.
    const again = await api().post('/grns').set(auth(owner)).send({ returnInwardId: inward.body.id, items: [{ productId, expectedQty: 10, receivedQty: 9, acceptedQty: 9 }] }).expect(201);
    expect(again.body.items[0].acceptedQty).toBe(9);
  });

  it('rejects and cancels, filters, and isolates tenants', async () => {
    const req = await api()
      .post('/return-requests')
      .set(auth(owner))
      .send({ customerId, warehouseId, reason: 'Unrelated goods, no dispatch', lines: [{ productId, quantity: 2 }] })
      .expect(201);
    expect(req.body.originalDispatchId).toBeNull();
    const rejected = await api().post(`/return-requests/${req.body.id}/reject`).set(auth(owner)).send({ reason: 'Not ours' }).expect(201);
    expect(rejected.body.status).toBe('rejected');
    await api().post(`/return-requests/${req.body.id}/approve`).set(auth(owner)).expect(400);

    const cancelled = (await api().post('/return-requests').set(auth(owner)).send({ customerId, warehouseId, reason: 'Oops', lines: [{ productId, quantity: 1 }] }).expect(201)).body;
    await api().post(`/return-requests/${cancelled.id}/cancel`).set(auth(owner)).expect(201);

    expect((await api().get('/return-requests?status=received').set(auth(owner)).expect(200)).body.total).toBe(0);
    expect((await api().get('/return-requests?status=approved').set(auth(owner)).expect(200)).body.total).toBe(1);
    expect((await api().get(`/return-inwards?status=inspected`).set(auth(owner)).expect(200)).body.total).toBe(1);
    expect((await api().get('/return-requests?q=Wrong').set(auth(owner)).expect(200)).body.total).toBe(1);

    expect((await api().get('/return-requests').set(auth(otherOwner)).expect(200)).body.total).toBe(0);
    expect((await api().get('/return-inwards').set(auth(otherOwner)).expect(200)).body.total).toBe(0);
    await api().get(`/return-requests/${req.body.id}`).set(auth(otherOwner)).expect(404);
    await api().post('/return-inwards').set(auth(otherOwner)).send({ returnRequestId: req.body.id }).expect(404);
    await api().get('/return-requests').expect(401);
  });
});
