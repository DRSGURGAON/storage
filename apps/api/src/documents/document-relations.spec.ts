import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../app.module';

/**
 * `document-engine.md` §8 / `ux-system.md` §7: "Created From", "Related
 * Documents" and the §68 timeline, computed from the foreign-key graph.
 *
 * The chain built here is the real one -- gate entry → inward → GRN →
 * put-away → warehouse receipt, then release order → pick list → dispatch
 * → loading sheet → gate pass → POD -- so what the endpoint returns is
 * whatever the schema actually joins, not a fixture arranged to agree
 * with a hand-written edge list.
 */
describe('Document relations', () => {
  let app: INestApplication;
  const suffix = randomUUID().slice(0, 8);
  const password = 'correcthorsebattery';
  let owner = '';
  let customerId = '';
  let warehouseId = '';
  let binId = '';
  let productId = '';
  let gateEntryId = '';
  let inwardId = '';
  let grnId = '';
  let putawayId = '';
  let receiptId = '';
  let dispatchId = '';
  let releaseOrderId = '';
  let podId = '';

  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${owner}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    owner = (
      await api()
        .post('/auth/signup')
        .send({ companyLegalName: 'Relations Ltd', tenantSlug: `rel-${suffix}`, email: `rel-${suffix}@test.local`, fullName: 'Owner', password })
        .expect(201)
    ).body.accessToken;

    customerId = (await api().post('/customers').set(auth()).send({ name: 'Acme Co' }).expect(201)).body.id;
    warehouseId = (await api().post('/warehouses').set(auth()).send({ code: 'WH01', name: 'Gurugram' }).expect(201)).body.id;
    const zone = await api().post(`/warehouses/${warehouseId}/locations`).set(auth()).send({ level: 'zone', segment: 'A' }).expect(201);
    const rack = await api().post(`/warehouses/${warehouseId}/locations`).set(auth()).send({ level: 'rack', segment: 'R01', parentId: zone.body.id }).expect(201);
    binId = (await api().post(`/warehouses/${warehouseId}/locations`).set(auth()).send({ level: 'bin', segment: 'B01', parentId: rack.body.id }).expect(201)).body.id;
    productId = (await api().post('/products').set(auth()).send({ sku: 'RICE-25', name: 'Basmati 25kg', uomCode: 'BAG' }).expect(201)).body.id;

    // Inbound, the whole way in.
    gateEntryId = (
      await api().post('/gate-entries').set(auth())
        .send({ warehouseId, direction: 'in', customerId, purpose: 'inward', vehicleNumber: 'HR26DK1234' }).expect(201)
    ).body.id;
    inwardId = (
      await api().post('/inwards').set(auth())
        .send({ warehouseId, customerId, gateEntryId, items: [{ productId, expectedQty: 100, receivedQty: 100, acceptedQty: 100 }] })
        .expect(201)
    ).body.id;
    await api().post(`/inwards/${inwardId}/receive`).set(auth()).expect(201);
    const grn = await api().post('/grns').set(auth()).send({ inwardId }).expect(201);
    grnId = grn.body.id;
    for (const step of ['submit', 'check', 'approve']) await api().post(`/grns/${grnId}/${step}`).set(auth()).expect(201);
    putawayId = (
      await api().post('/putaways').set(auth())
        .send({ grnId, lines: [{ grnItemId: grn.body.items[0].id, quantity: 100, toLocationId: binId }] }).expect(201)
    ).body.id;
    await api().post(`/putaways/${putawayId}/complete`).set(auth()).expect(201);
    receiptId = (await api().post('/warehouse-receipts').set(auth()).send({ grnId }).expect(201)).body.id;

    // Outbound, far enough to have something several hops away from the gate entry.
    releaseOrderId = (
      await api().post('/release-orders').set(auth())
        .send({ customerId, warehouseId, lines: [{ productId, requestedQty: 40 }] }).expect(201)
    ).body.id;
    await api().post(`/release-orders/${releaseOrderId}/approve`).set(auth()).expect(201);
    await api().post(`/release-orders/${releaseOrderId}/reserve`).set(auth()).send({}).expect(201);
    const pick = await api().post('/pick-lists').set(auth()).send({ releaseOrderId }).expect(201);
    await api().post(`/pick-lists/${pick.body.id}/confirm`).set(auth())
      .send({ lines: [{ lineId: pick.body.lines[0].id, pickQty: 40 }] }).expect(201);
    await api().post(`/pick-lists/${pick.body.id}/complete`).set(auth()).expect(201);
    dispatchId = (await api().post('/dispatches').set(auth()).send({ releaseOrderId }).expect(201)).body.id;
    const pass = await api().post('/gate-passes').set(auth()).send({ dispatchId }).expect(201);
    await api().post(`/gate-passes/${pass.body.id}/gate-out`).set(auth()).expect(201);
    const pod = await api().post('/pods').set(auth()).send({ dispatchId }).expect(201);
    podId = pod.body.id;
    await api().post(`/pods/${podId}/capture`).set(auth())
      .send({ receiverName: 'R. Mehta', lines: [{ lineId: pod.body.lines[0].id, receivedQty: 40 }] }).expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('reads Created From and Related Documents off the foreign keys, not off a hand-written list', async () => {
    const grn = await api().get(`/documents/relations/grns/${grnId}`).set(auth()).expect(200);

    expect(grn.body.record).toMatchObject({ type: 'grns', id: grnId, status: 'approved' });
    expect(grn.body.record.number).toMatch(/^GRN\//);

    // Created From: the inward it was raised on, and the gate entry the
    // inward carried through -- both are real columns on `grns`.
    const parents = Object.fromEntries(grn.body.createdFrom.map((r: { type: string; id: string }) => [r.type, r.id]));
    expect(parents).toEqual({ inwards: inwardId, gate_entries: gateEntryId });
    expect(grn.body.createdFrom.every((r: { via: string }) => typeof r.via === 'string')).toBe(true);

    // Related: everything pointing back at this GRN.
    const children = grn.body.related.map((r: { type: string; id: string }) => `${r.type}:${r.id}`);
    expect(children).toEqual(expect.arrayContaining([`putaways:${putawayId}`, `warehouse_receipts:${receiptId}`]));
  });

  it('walks the whole chain in §68 order, from the far end', async () => {
    const pod = await api().get(`/documents/relations/pods/${podId}`).set(auth()).expect(200);
    const chain: { type: string; number: string }[] = pod.body.chain.records;
    const types = chain.map((r) => r.type);

    // The POD's own parent is the dispatch; the gate entry is five hops away
    // and still shows up, which is the whole point of a timeline.
    expect(types).toEqual(expect.arrayContaining([
      'gate_entries', 'inwards', 'grns', 'putaways', 'warehouse_receipts',
      'release_orders', 'pick_lists', 'dispatches', 'gate_passes',
    ]));
    expect(pod.body.chain.truncated).toBe(false);

    // The inbound half is reached over the goods, not over a foreign key --
    // no release order references a GRN, and none should. The hop says so.
    const grnInChain = chain.find((r) => r.type === 'grns') as unknown as { via: string };
    expect(grnInChain.via).toBe('stock_ledger');
    // The outbound half is ordinary foreign keys.
    const dispatchInChain = chain.find((r) => r.type === 'dispatches') as unknown as { via: string };
    expect(dispatchInChain.via).toBe('dispatch_id');

    // Sorted into lifecycle order, so it reads as a story rather than as a
    // graph traversal: inbound first, outbound after.
    expect(types.indexOf('gate_entries')).toBeLessThan(types.indexOf('grns'));
    expect(types.indexOf('grns')).toBeLessThan(types.indexOf('dispatches'));
    expect(types.indexOf('release_orders')).toBeLessThan(types.indexOf('gate_passes'));
  });

  it('lists a record’s own generated documents, and nobody else’s record at all', async () => {
    await api().post(`/grns/${grnId}/document`).set(auth()).send({}).expect(201);
    const grn = await api().get(`/documents/relations/grns/${grnId}`).set(auth()).expect(200);
    expect(grn.body.documents).toHaveLength(1);
    expect(grn.body.documents[0]).toMatchObject({ documentType: 'grn', versionNo: 1, isLatest: true });

    // A record in another tenant is a 404, not an empty graph.
    const otherOwner = (
      await api().post('/auth/signup')
        .send({ companyLegalName: 'Other Ltd', tenantSlug: `rel2-${suffix}`, email: `rel2-${suffix}@test.local`, fullName: 'Owner', password })
        .expect(201)
    ).body.accessToken;
    await api().get(`/documents/relations/grns/${grnId}`).set({ Authorization: `Bearer ${otherOwner}` }).expect(404);

    // A table that is not a document-bearing record says so, with the list.
    const refused = await api().get(`/documents/relations/customers/${customerId}`).set(auth()).expect(400);
    expect(refused.body.message).toMatch(/not a record type with documents/);
    expect(refused.body.message).toMatch(/warehouse_receipts/);

    await api().get(`/documents/relations/grns/${randomUUID()}`).set(auth()).expect(404);
    await api().get(`/documents/relations/grns/${grnId}`).expect(401);
  });
});
