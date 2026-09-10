import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../app.module';

/**
 * Blueprint §29-§31: Release Order, reservation, Pick List -- and the §79
 * outbound cases up to the dock: "reserve 20 → physical 60 / available
 * 40", "reserve unavailable stock is impossible", "cancel reservation
 * restores available", and "pick never exceeds the reservation".
 */
describe('Release orders and pick lists', () => {
  let app: INestApplication;
  const suffix = randomUUID().slice(0, 8);
  const password = 'correcthorsebattery';
  let owner = '';
  let operator = '';
  let otherOwner = '';
  let customerId = '';
  let addressId = '';
  let warehouseId = '';
  let productId = '';
  let batchProductId = '';
  let binA = '';
  let binB = '';

  const api = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  const signup = async (slug: string, email: string) =>
    (
      await api()
        .post('/auth/signup')
        .send({ companyLegalName: `${slug} Pvt Ltd`, tenantSlug: slug, email, fullName: 'Owner', password })
        .expect(201)
    ).body.accessToken as string;

  const makeBin = async (zone: string, bin: string) => {
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

  /** Receives and, unless told not to, shelves stock: an approved GRN, then a completed put-away. */
  const stockUp = async (
    product: string,
    quantity: number,
    locationId: string | null,
    batch?: { batchNo: string; expiryDate?: string },
  ) => {
    const grn = await api()
      .post('/grns')
      .set(auth(owner))
      .send({
        warehouseId,
        customerId,
        items: [{ productId: product, expectedQty: quantity, receivedQty: quantity, acceptedQty: quantity, ...batch }],
      })
      .expect(201);
    for (const step of ['submit', 'check', 'approve']) {
      await api().post(`/grns/${grn.body.id}/${step}`).set(auth(owner)).expect(201);
    }
    if (!locationId) return;
    const putaway = await api()
      .post('/putaways')
      .set(auth(owner))
      .send({ grnId: grn.body.id, lines: [{ grnItemId: grn.body.items[0].id, quantity, toLocationId: locationId }] })
      .expect(201);
    await api().post(`/putaways/${putaway.body.id}/complete`).set(auth(owner)).expect(201);
  };

  const lots = async (product = productId) =>
    (await api().get(`/stock?productId=${product}&limit=100`).set(auth(owner)).expect(200)).body.items as {
      id: string;
      locationId: string | null;
      locationFullCode: string | null;
      batchNo: string | null;
      physicalQty: string;
      reservedQty: string;
      availableQty: string;
    }[];
  const totals = async (product = productId) =>
    (await lots(product)).reduce(
      (acc, l) => ({
        physical: acc.physical + Number(l.physicalQty),
        reserved: acc.reserved + Number(l.reservedQty),
        available: acc.available + Number(l.availableQty),
      }),
      { physical: 0, reserved: 0, available: 0 },
    );

  const createOrder = async (lines: { productId: string; requestedQty: number; batchId?: string }[], extra: Record<string, unknown> = {}) =>
    (await api().post('/release-orders').set(auth(owner)).send({ customerId, warehouseId, lines, ...extra }).expect(201)).body;
  const approveAndReserve = async (id: string, body: Record<string, unknown> = {}) => {
    await api().post(`/release-orders/${id}/approve`).set(auth(owner)).expect(201);
    return api().post(`/release-orders/${id}/reserve`).set(auth(owner)).send(body);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    owner = await signup(`ro-a-${suffix}`, `owner-a-${suffix}@test.local`);
    otherOwner = await signup(`ro-b-${suffix}`, `owner-b-${suffix}@test.local`);

    const opEmail = `op-${suffix}@test.local`;
    await api().post('/users').set(auth(owner)).send({ email: opEmail, fullName: 'Op', password, roleCode: 'warehouse_operator' }).expect(201);
    operator = (await api().post('/auth/login').send({ email: opEmail, password }).expect(201)).body.accessToken;

    customerId = (await api().post('/customers').set(auth(owner)).send({ name: 'Acme Co' }).expect(201)).body.id;
    addressId = (
      await api()
        .post(`/customers/${customerId}/addresses`)
        .set(auth(owner))
        .send({ kind: 'delivery', addressLine1: 'Plot 7, Sector 18', city: 'Gurgaon', isDefault: true })
        .expect(201)
    ).body.id;
    warehouseId = (await api().post('/warehouses').set(auth(owner)).send({ code: 'WH01', name: 'Gurugram' }).expect(201)).body.id;
    productId = (
      await api().post('/products').set(auth(owner)).send({ sku: 'RICE-25', name: 'Basmati 25kg', uomCode: 'BAG' }).expect(201)
    ).body.id;
    batchProductId = (
      await api()
        .post('/products')
        .set(auth(owner))
        .send({ sku: 'GHEE-1', name: 'Ghee 1L', uomCode: 'BOX', batchTracked: true })
        .expect(201)
    ).body.id;
    binA = await makeBin('A', 'B01');
    binB = await makeBin('B', 'B02');
    // 60 shelved across two bins (A first), plus 40 received but not yet put away.
    await stockUp(productId, 40, binA);
    await stockUp(productId, 20, binB);
    await stockUp(productId, 40, null);
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates an order that snapshots the delivery address, and only a draft can be edited', async () => {
    const order = await createOrder([{ productId, requestedQty: 5 }], { deliveryAddressId: addressId, consigneeName: 'Acme Depot' });
    expect(order.number).toMatch(/^RO\//);
    expect(order.status).toBe('draft');
    expect(order.deliveryAddressSnapshot).toMatchObject({ address_line1: 'Plot 7, Sector 18', city: 'Gurgaon' });
    expect(order.lines[0]).toMatchObject({ requestedQty: 5, reservedQty: 0, uomCode: 'BAG' });

    // Editing the master must not re-route an order already placed.
    await api().patch(`/customers/${customerId}/addresses/${addressId}`).set(auth(owner)).send({ city: 'Faridabad' }).expect(200);
    const again = await api().get(`/release-orders/${order.id}`).set(auth(owner)).expect(200);
    expect(again.body.deliveryAddressSnapshot.city).toBe('Gurgaon');

    const edited = await api()
      .patch(`/release-orders/${order.id}`)
      .set(auth(owner))
      .send({ instructions: 'Deliver before noon', lines: [{ productId, requestedQty: 7 }] })
      .expect(200);
    expect(edited.body.instructions).toBe('Deliver before noon');
    expect(edited.body.lines[0].requestedQty).toBe(7);

    await api().post(`/release-orders/${order.id}/approve`).set(auth(owner)).expect(201);
    await api().patch(`/release-orders/${order.id}`).set(auth(owner)).send({ instructions: 'too late' }).expect(400);
    // And it cannot be reserved twice, nor approved again.
    await api().post(`/release-orders/${order.id}/approve`).set(auth(owner)).expect(400);
    await api().post(`/release-orders/${order.id}/cancel`).set(auth(owner)).send({ reason: 'Customer withdrew' }).expect(201);
  });

  it('reserves 20 with FIFO from shelved bins only: physical stays 100, available drops to 80', async () => {
    const before = await totals();
    expect(before).toEqual({ physical: 100, reserved: 0, available: 100 });

    const order = await createOrder([{ productId, requestedQty: 20 }]);
    await api().post(`/release-orders/${order.id}/reserve`).set(auth(owner)).send({}).expect(400); // not approved yet
    const reserved = await approveAndReserve(order.id);
    expect(reserved.status).toBe(201);
    expect(reserved.body.status).toBe('reserved');
    expect(reserved.body.lines[0].reservedQty).toBe(20);

    // §79: reservation moves reserved_qty only; the goods are still on the shelf.
    expect(await totals()).toEqual({ physical: 100, reserved: 20, available: 80 });
    const binAState = (await lots()).find((l) => l.locationFullCode === 'WH01-A-R01-B01');
    expect(binAState).toMatchObject({ physicalQty: '40.000', reservedQty: '20.000', availableQty: '20.000' });

    const ledger = await api().get(`/stock/ledger?sourceId=${order.id}`).set(auth(owner)).expect(200);
    expect(ledger.body.items).toHaveLength(1);
    expect(ledger.body.items[0]).toMatchObject({ txnType: 'RESERVE', locationFullCode: 'WH01-A-R01-B01' });

    // The pick list is generated from that reservation, not re-chosen.
    const pick = await api().post('/pick-lists').set(auth(operator)).send({ releaseOrderId: order.id }).expect(201);
    expect(pick.body.number).toMatch(/^PL\//);
    expect(pick.body.allocationPolicy).toBe('fifo');
    expect(pick.body.lines).toHaveLength(1);
    expect(pick.body.lines[0]).toMatchObject({ locationCode: 'WH01-A-R01-B01', requiredQty: 20, pickQty: 0 });
    // Only one open pick list per order.
    await api().post('/pick-lists').set(auth(operator)).send({ releaseOrderId: order.id }).expect(400);

    // Pick above the reservation is refused; a partial pick leaves the order partially picked.
    const lineId = pick.body.lines[0].id;
    const over = await api().post(`/pick-lists/${pick.body.id}/confirm`).set(auth(operator)).send({ lines: [{ lineId, pickQty: 21 }] }).expect(400);
    expect(over.body.message).toMatch(/only 20 is reserved/);
    await api().post(`/pick-lists/${pick.body.id}/complete`).set(auth(operator)).expect(400); // still pending
    await api().post(`/pick-lists/${pick.body.id}/confirm`).set(auth(operator)).send({ lines: [{ lineId, pickQty: 12 }] }).expect(201);
    const done = await api().post(`/pick-lists/${pick.body.id}/complete`).set(auth(operator)).expect(201);
    expect(done.body.status).toBe('completed');
    let ro = await api().get(`/release-orders/${order.id}`).set(auth(owner)).expect(200);
    expect(ro.body.status).toBe('partially_picked');
    expect(ro.body.lines[0].pickedQty).toBe(12);

    // The second pick list carries only what is still outstanding.
    const second = await api().post('/pick-lists').set(auth(operator)).send({ releaseOrderId: order.id }).expect(201);
    expect(second.body.lines[0].requiredQty).toBe(8);
    await api()
      .post(`/pick-lists/${second.body.id}/confirm`)
      .set(auth(operator))
      .send({ lines: [{ lineId: second.body.lines[0].id, pickQty: 8 }] })
      .expect(201);
    await api().post(`/pick-lists/${second.body.id}/complete`).set(auth(operator)).expect(201);
    ro = await api().get(`/release-orders/${order.id}`).set(auth(owner)).expect(200);
    expect(ro.body.status).toBe('picked');
    expect(ro.body.lines[0].pickedQty).toBe(20);
    await api().post('/pick-lists').set(auth(operator)).send({ releaseOrderId: order.id }).expect(400);

    // Picking moved nothing physically; the reservation still stands until gate-out.
    expect(await totals()).toEqual({ physical: 100, reserved: 20, available: 80 });

    // Cancelling a picked order releases the reservation in full (§79 "restores available").
    await api().post(`/release-orders/${order.id}/cancel`).set(auth(owner)).send({ reason: 'Consignee refused' }).expect(201);
    expect(await totals()).toEqual({ physical: 100, reserved: 0, available: 100 });
    const after = await api().get(`/stock/ledger?sourceId=${order.id}`).set(auth(owner)).expect(200);
    expect(after.body.items.map((r: { txnType: string }) => r.txnType)).toEqual(['RESERVE', 'UNRESERVE']);
  });

  it('refuses to reserve more than is shelved, all or nothing, and says how much is still unallocated', async () => {
    // 60 shelved, 40 unallocated: 70 is physically in the building but not pickable.
    const order = await createOrder([{ productId, requestedQty: 70 }]);
    const refused = await approveAndReserve(order.id);
    expect(refused.status).toBe(400);
    expect(refused.body.message).toMatch(/70 requested but only 60 available in shelved locations/);
    expect(refused.body.message).toMatch(/a further 40 is unallocated, awaiting put-away/);

    // Nothing partial leaked: no ledger rows, no reserved quantity, still approved.
    expect(await totals()).toEqual({ physical: 100, reserved: 0, available: 100 });
    expect((await api().get(`/stock/ledger?sourceId=${order.id}`).set(auth(owner)).expect(200)).body.total).toBe(0);
    expect((await api().get(`/release-orders/${order.id}`).set(auth(owner)).expect(200)).body.status).toBe('approved');
    await api().post('/pick-lists').set(auth(operator)).send({ releaseOrderId: order.id }).expect(400);
  });

  it('spans bins in FIFO order, and honours a manual lot choice', async () => {
    const order = await createOrder([{ productId, requestedQty: 50 }]);
    const reserved = await approveAndReserve(order.id);
    expect(reserved.status).toBe(201);
    const ledger = await api().get(`/stock/ledger?sourceId=${order.id}`).set(auth(owner)).expect(200);
    expect(ledger.body.items.map((r: { locationFullCode: string; reservedDelta: string }) => [r.locationFullCode, Number(r.reservedDelta)])).toEqual([
      ['WH01-A-R01-B01', 40],
      ['WH01-B-R01-B02', 10],
    ]);
    const pick = await api().post('/pick-lists').set(auth(owner)).send({ releaseOrderId: order.id }).expect(201);
    expect(pick.body.lines.map((l: { locationCode: string; requiredQty: number }) => [l.locationCode, l.requiredQty])).toEqual([
      ['WH01-A-R01-B01', 40],
      ['WH01-B-R01-B02', 10],
    ]);
    await api().post(`/release-orders/${order.id}/cancel`).set(auth(owner)).send({ reason: 'test' }).expect(201);
    expect((await api().get(`/pick-lists/${pick.body.id}`).set(auth(owner)).expect(200)).body.status).toBe('pending');
    await api().post(`/pick-lists/${pick.body.id}/cancel`).set(auth(owner)).expect(201);

    // Manual: take from bin B explicitly, and the unallocated lot is refused by name.
    const binBLot = (await lots()).find((l) => l.locationFullCode === 'WH01-B-R01-B02')!;
    const unallocated = (await lots()).find((l) => l.locationId === null)!;
    const manual = await createOrder([{ productId, requestedQty: 15 }]);
    const lineId = manual.lines[0].id;
    const bad = await approveAndReserve(manual.id, {
      allocationPolicy: 'manual',
      allocations: [{ releaseOrderLineId: lineId, stockLotId: unallocated.id, quantity: 15 }],
    });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/unallocated/);
    const good = await api()
      .post(`/release-orders/${manual.id}/reserve`)
      .set(auth(owner))
      .send({ allocationPolicy: 'manual', allocations: [{ releaseOrderLineId: lineId, stockLotId: binBLot.id, quantity: 15 }] })
      .expect(201);
    expect(good.body.status).toBe('reserved');
    expect((await lots()).find((l) => l.locationFullCode === 'WH01-B-R01-B02')).toMatchObject({ reservedQty: '15.000', availableQty: '5.000' });
    const manualPick = await api().post('/pick-lists').set(auth(owner)).send({ releaseOrderId: manual.id }).expect(201);
    expect(manualPick.body.allocationPolicy).toBe('manual');
    await api().post(`/release-orders/${manual.id}/cancel`).set(auth(owner)).send({ reason: 'test' }).expect(201);
    expect(await totals()).toEqual({ physical: 100, reserved: 0, available: 100 });
  });

  it('FEFO reserves the batch expiring first, whatever order it arrived in', async () => {
    await stockUp(batchProductId, 10, binA, { batchNo: 'G-LATE', expiryDate: '2028-01-01' });
    await stockUp(batchProductId, 10, binA, { batchNo: 'G-SOON', expiryDate: '2027-01-01' });

    const fifo = await createOrder([{ productId: batchProductId, requestedQty: 4 }]);
    expect((await approveAndReserve(fifo.id)).status).toBe(201);
    const fifoLedger = await api().get(`/stock/ledger?sourceId=${fifo.id}`).set(auth(owner)).expect(200);
    expect(fifoLedger.body.items[0].batchNo).toBe('G-LATE');
    await api().post(`/release-orders/${fifo.id}/cancel`).set(auth(owner)).send({ reason: 'test' }).expect(201);

    const fefo = await createOrder([{ productId: batchProductId, requestedQty: 4 }]);
    expect((await approveAndReserve(fefo.id, { allocationPolicy: 'fefo' })).status).toBe(201);
    const fefoLedger = await api().get(`/stock/ledger?sourceId=${fefo.id}`).set(auth(owner)).expect(200);
    expect(fefoLedger.body.items[0].batchNo).toBe('G-SOON');
    const pick = await api().post('/pick-lists').set(auth(owner)).send({ releaseOrderId: fefo.id }).expect(201);
    expect(pick.body.allocationPolicy).toBe('fefo');
    expect(pick.body.lines[0].batchNo).toBe('G-SOON');

    // The tenant default is a setting, validated against the allowed values.
    await api().put('/company/settings/stock.allocation_policy').set(auth(owner)).send({ value: 'nearest' }).expect(400);
    await api().put('/company/settings/stock.allocation_policy').set(auth(owner)).send({ value: 'fefo' }).expect(200);
    await api().post(`/release-orders/${fefo.id}/cancel`).set(auth(owner)).send({ reason: 'test' }).expect(201);
    const byDefault = await createOrder([{ productId: batchProductId, requestedQty: 4 }]);
    expect((await approveAndReserve(byDefault.id)).status).toBe(201);
    expect((await api().get(`/stock/ledger?sourceId=${byDefault.id}`).set(auth(owner)).expect(200)).body.items[0].batchNo).toBe('G-SOON');
    await api().delete('/company/settings/stock.allocation_policy').set(auth(owner)).expect(200);
  });

  it('renders the Release Order and Pick List -- the twelfth and thirteenth templates', async () => {
    const order = await createOrder([{ productId, requestedQty: 3 }], { consigneeName: 'Acme Depot', instructions: 'Fragile' });
    const preview = await api().post(`/release-orders/${order.id}/document/preview`).set(auth(owner)).expect(201);
    expect(Buffer.from(preview.body).subarray(0, 4).toString()).toBe('%PDF');
    expect((await approveAndReserve(order.id)).status).toBe(201);
    const committed = await api().post(`/release-orders/${order.id}/document`).set(auth(owner)).send({}).expect(201);
    expect(committed.body).toMatchObject({ documentType: 'release_order', versionNo: 1, documentNumber: order.number });
    expect((await api().get(`/verify/${committed.body.qrToken}`).expect(200)).body.result).toBe('valid');

    const pick = await api().post('/pick-lists').set(auth(owner)).send({ releaseOrderId: order.id }).expect(201);
    const pickPreview = await api().post(`/pick-lists/${pick.body.id}/document/preview`).set(auth(operator)).expect(201);
    expect(Buffer.from(pickPreview.body).subarray(0, 4).toString()).toBe('%PDF');
    const pickDoc = await api().post(`/pick-lists/${pick.body.id}/document`).set(auth(operator)).send({}).expect(201);
    expect(pickDoc.body).toMatchObject({ documentType: 'pick_list', documentNumber: pick.body.number });
    await api().post(`/release-orders/${order.id}/cancel`).set(auth(owner)).send({ reason: 'test' }).expect(201);
  });

  it('keeps raising and reserving above the Operator, filters, and isolates tenants', async () => {
    // An Operator picks; they do not raise orders or reserve stock.
    await api().post('/release-orders').set(auth(operator)).send({ customerId, warehouseId, lines: [{ productId, requestedQty: 1 }] }).expect(403);
    const order = await createOrder([{ productId, requestedQty: 1 }]);
    await api().post(`/release-orders/${order.id}/approve`).set(auth(operator)).expect(403);
    await api().post(`/release-orders/${order.id}/reserve`).set(auth(operator)).send({}).expect(403);
    await api().get('/release-orders').set(auth(operator)).expect(403);
    await api().get('/pick-lists').set(auth(operator)).expect(200);

    const cancelled = await api().get('/release-orders?status=cancelled').set(auth(owner)).expect(200);
    expect(cancelled.body.total).toBeGreaterThan(0);
    expect(cancelled.body.items.every((o: { status: string }) => o.status === 'cancelled')).toBe(true);
    expect((await api().get(`/release-orders?customerId=${customerId}`).set(auth(owner)).expect(200)).body.total).toBeGreaterThan(0);

    expect((await api().get('/release-orders').set(auth(otherOwner)).expect(200)).body.total).toBe(0);
    await api().get(`/release-orders/${order.id}`).set(auth(otherOwner)).expect(404);
    await api().post('/pick-lists').set(auth(otherOwner)).send({ releaseOrderId: order.id }).expect(404);
    expect((await api().get('/pick-lists').set(auth(otherOwner)).expect(200)).body.total).toBe(0);
    await api().get('/release-orders').expect(401);
  });
});
