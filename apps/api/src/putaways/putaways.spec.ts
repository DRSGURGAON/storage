import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../app.module';

/**
 * Blueprint §21 (Put-away) and §22 (Warehouse Receipt) -- the two
 * records that close the inbound chain, tested together because both
 * hang off an approved GRN and share its fixtures.
 */
describe('Put-aways and warehouse receipts', () => {
  let app: INestApplication;
  const suffix = randomUUID().slice(0, 8);
  const password = 'correcthorsebattery';
  let owner = '';
  let otherOwner = '';
  let operator = '';
  let customerId = '';
  let warehouseId = '';
  let productId = '';
  let binId = '';
  let binCode = '';
  let otherWarehouseBinId = '';

  const api = () => request(app.getHttpServer());
  const signup = async (slug: string, email: string) => {
    const res = await api()
      .post('/auth/signup')
      .send({ companyLegalName: `${slug} Pvt Ltd`, tenantSlug: slug, email, fullName: 'Owner', password })
      .expect(201);
    return res.body.accessToken as string;
  };

  const createLocationChain = async (whId: string, zoneSegment: string) => {
    const zone = await api()
      .post(`/warehouses/${whId}/locations`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ level: 'zone', segment: zoneSegment })
      .expect(201);
    const rack = await api()
      .post(`/warehouses/${whId}/locations`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ level: 'rack', segment: 'R04', parentId: zone.body.id })
      .expect(201);
    const bin = await api()
      .post(`/warehouses/${whId}/locations`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ level: 'bin', segment: 'B15', parentId: rack.body.id })
      .expect(201);
    return bin.body as { id: string; fullCode: string };
  };

  /** An approved GRN is the starting point for both records. */
  const approvedGrn = async (overrides: Record<string, unknown> = {}) => {
    const grn = await api()
      .post('/grns')
      .set('Authorization', `Bearer ${owner}`)
      .send({
        warehouseId,
        customerId,
        items: [
          {
            productId,
            batchNo: 'B-77',
            expectedQty: 100,
            receivedQty: 100,
            acceptedQty: 100,
            packages: 10,
            grossWeightKg: 250,
          },
        ],
        ...overrides,
      })
      .expect(201);
    for (const step of ['submit', 'check', 'approve']) {
      await api().post(`/grns/${grn.body.id}/${step}`).set('Authorization', `Bearer ${owner}`).expect(201);
    }
    return grn.body as { id: string; items: { id: string }[] };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    owner = await signup(`pa-a-${suffix}`, `owner-a-${suffix}@test.local`);
    otherOwner = await signup(`pa-b-${suffix}`, `owner-b-${suffix}@test.local`);

    const opEmail = `op-${suffix}@test.local`;
    await api()
      .post('/users')
      .set('Authorization', `Bearer ${owner}`)
      .send({ email: opEmail, fullName: 'Op', password, roleCode: 'warehouse_operator' })
      .expect(201);
    operator = (await api().post('/auth/login').send({ email: opEmail, password }).expect(201)).body.accessToken;

    customerId = (
      await api().post('/customers').set('Authorization', `Bearer ${owner}`).send({ name: 'Acme Co', gstin: '06AAACA1234A1Z5' }).expect(201)
    ).body.id;
    warehouseId = (
      await api()
        .post('/warehouses')
        .set('Authorization', `Bearer ${owner}`)
        .send({ code: 'WH01', name: 'Main Godown', capacityValue: 500, capacityUom: 'pallet' })
        .expect(201)
    ).body.id;
    productId = (
      await api()
        .post('/products')
        .set('Authorization', `Bearer ${owner}`)
        .send({ sku: 'SKU001', name: 'Widget', uomCode: 'NOS' })
        .expect(201)
    ).body.id;

    const bin = await createLocationChain(warehouseId, 'A');
    binId = bin.id;
    binCode = bin.fullCode;

    const secondWarehouse = await api()
      .post('/warehouses')
      .set('Authorization', `Bearer ${owner}`)
      .send({ code: 'WH02', name: 'Overflow', capacityValue: 100, capacityUom: 'pallet' })
      .expect(201);
    otherWarehouseBinId = (await createLocationChain(secondWarehouse.body.id, 'Z')).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('raises a put-away against an approved GRN, defaulting each line to its accepted quantity', async () => {
    const grn = await approvedGrn();

    const res = await api()
      .post('/putaways')
      .set('Authorization', `Bearer ${owner}`)
      .send({ grnId: grn.id, lines: [{ grnItemId: grn.items[0].id, toLocationId: binId }] })
      .expect(201);

    expect(res.body.number).toBe('PA/26-27/000001');
    expect(res.body.status).toBe('pending');
    expect(res.body.customerId).toBe(customerId);
    expect(res.body.lines).toHaveLength(1);
    const line = res.body.lines[0];
    expect(line.quantity).toBe(100);
    expect(line.toLocationCode).toBe(binCode);
    // Product and batch come from the GRN line, never re-typed.
    expect(line.productSku).toBe('SKU001');
    expect(line.batchNo).toBe('B-77');
    // Phase 4 posts no stock: the ledger side of "stock location is updated" is Phase 5's.
    expect(line.stockLotId).toBeNull();
  });

  it('refuses a GRN that is not approved, a location in another warehouse, and a quantity beyond what was accepted', async () => {
    const draftGrn = await api()
      .post('/grns')
      .set('Authorization', `Bearer ${owner}`)
      .send({ warehouseId, customerId, items: [{ productId, receivedQty: 5, acceptedQty: 5 }] })
      .expect(201);
    await api()
      .post('/putaways')
      .set('Authorization', `Bearer ${owner}`)
      .send({ grnId: draftGrn.body.id, lines: [{ grnItemId: draftGrn.body.items[0].id, toLocationId: binId }] })
      .expect(400);

    const grn = await approvedGrn();
    const wrongWarehouse = await api()
      .post('/putaways')
      .set('Authorization', `Bearer ${owner}`)
      .send({ grnId: grn.id, lines: [{ grnItemId: grn.items[0].id, toLocationId: otherWarehouseBinId }] })
      .expect(400);
    expect(wrongWarehouse.body.message).toMatch(/different warehouse/);

    const tooMuch = await api()
      .post('/putaways')
      .set('Authorization', `Bearer ${owner}`)
      .send({ grnId: grn.id, lines: [{ grnItemId: grn.items[0].id, toLocationId: binId, quantity: 500 }] })
      .expect(400);
    expect(tooMuch.body.message).toMatch(/exceeds the GRN line's accepted quantity/);
  });

  it('splits one GRN line across several locations, but only one put-away exists per GRN', async () => {
    const grn = await approvedGrn();
    const secondBin = await createLocationChain(warehouseId, 'C');

    const res = await api()
      .post('/putaways')
      .set('Authorization', `Bearer ${owner}`)
      .send({
        grnId: grn.id,
        lines: [
          { grnItemId: grn.items[0].id, toLocationId: binId, quantity: 60 },
          { grnItemId: grn.items[0].id, toLocationId: secondBin.id, quantity: 40 },
        ],
      })
      .expect(201);
    expect(res.body.lines).toHaveLength(2);
    expect(res.body.lines.reduce((sum: number, l: { quantity: number }) => sum + l.quantity, 0)).toBe(100);

    // putaways.grn_id is unique -- a second slip for the same GRN is a conflict, not a duplicate.
    await api()
      .post('/putaways')
      .set('Authorization', `Bearer ${owner}`)
      .send({ grnId: grn.id, lines: [{ grnItemId: grn.items[0].id, toLocationId: binId }] })
      .expect(409);
  });

  it('walks pending → in_progress → completed, confirming every line, and gates completion on its own permission', async () => {
    const grn = await approvedGrn();
    const created = await api()
      .post('/putaways')
      .set('Authorization', `Bearer ${owner}`)
      .send({ grnId: grn.id, lines: [{ grnItemId: grn.items[0].id, toLocationId: binId }] })
      .expect(201);
    const id = created.body.id;

    const started = await api().post(`/putaways/${id}/start`).set('Authorization', `Bearer ${owner}`).expect(201);
    expect(started.body.status).toBe('in_progress');
    expect(started.body.startedAt).not.toBeNull();

    const completed = await api().post(`/putaways/${id}/complete`).set('Authorization', `Bearer ${owner}`).expect(201);
    expect(completed.body.status).toBe('completed');
    expect(completed.body.completedAt).not.toBeNull();
    expect(completed.body.completedBy).not.toBeNull();
    expect(completed.body.lines[0].confirmedAt).not.toBeNull();

    await api().post(`/putaways/${id}/complete`).set('Authorization', `Bearer ${owner}`).expect(400);
    await api().post(`/putaways/${id}/cancel`).set('Authorization', `Bearer ${owner}`).expect(400);
  });

  it('generates a Put-away Slip document (the seventh registered template)', async () => {
    const grn = await approvedGrn();
    const created = await api()
      .post('/putaways')
      .set('Authorization', `Bearer ${owner}`)
      .send({ grnId: grn.id, lines: [{ grnItemId: grn.items[0].id, toLocationId: binId }] })
      .expect(201);

    const preview = await api()
      .post(`/putaways/${created.body.id}/document/preview`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(201);
    expect(Buffer.from(preview.body).subarray(0, 4).toString()).toBe('%PDF');

    const committed = await api()
      .post(`/putaways/${created.body.id}/document`)
      .set('Authorization', `Bearer ${owner}`)
      .send({})
      .expect(201);
    expect(committed.body.documentType).toBe('putaway');
    expect(committed.body.documentNumber).toMatch(/^PA\//);
  });

  it('issues a warehouse receipt from an approved GRN with frozen customer and line snapshots, folding in the put-away locations', async () => {
    const grn = await approvedGrn();
    const putaway = await api()
      .post('/putaways')
      .set('Authorization', `Bearer ${owner}`)
      .send({ grnId: grn.id, lines: [{ grnItemId: grn.items[0].id, toLocationId: binId }] })
      .expect(201);

    const res = await api()
      .post('/warehouse-receipts')
      .set('Authorization', `Bearer ${owner}`)
      .send({ grnId: grn.id, declaredValue: 125000, remarks: 'Handle with care' })
      .expect(201);

    expect(res.body.number).toBe('WR/26-27/000001');
    expect(res.body.status).toBe('issued');
    expect(res.body.putawayId).toBe(putaway.body.id);
    expect(res.body.declaredValue).toBe(125000);
    expect(res.body.customerSnapshot).toMatchObject({ name: 'Acme Co', gstin: '06AAACA1234A1Z5' });
    expect(res.body.lines).toHaveLength(1);
    expect(res.body.lines[0]).toMatchObject({ sku: 'SKU001', batch: 'B-77', qty: 100, uom: 'NOS', packages: 10 });
    expect(res.body.lines[0].locations).toEqual([{ code: binCode, qty: 100 }]);

    // warehouse_receipts.grn_id is unique.
    await api().post('/warehouse-receipts').set('Authorization', `Bearer ${owner}`).send({ grnId: grn.id }).expect(409);
  });

  it('issues straight off an approved GRN with no put-away at all, and refuses an unapproved one', async () => {
    const grn = await approvedGrn();
    const res = await api().post('/warehouse-receipts').set('Authorization', `Bearer ${owner}`).send({ grnId: grn.id }).expect(201);
    expect(res.body.putawayId).toBeNull();
    expect(res.body.lines[0].locations).toEqual([]);

    const draftGrn = await api()
      .post('/grns')
      .set('Authorization', `Bearer ${owner}`)
      .send({ warehouseId, customerId, items: [{ productId, receivedQty: 5, acceptedQty: 5 }] })
      .expect(201);
    await api()
      .post('/warehouse-receipts')
      .set('Authorization', `Bearer ${owner}`)
      .send({ grnId: draftGrn.body.id })
      .expect(400);
  });

  it("refuses a GRN that accepted nothing -- there is nothing to receipt", async () => {
    const grn = await approvedGrn({
      items: [{ productId, expectedQty: 10, receivedQty: 10, acceptedQty: 0, rejectedQty: 10 }],
    });
    const denied = await api().post('/warehouse-receipts').set('Authorization', `Bearer ${owner}`).send({ grnId: grn.id }).expect(400);
    expect(denied.body.message).toMatch(/nothing to receipt/);
  });

  it('generates a Warehouse Receipt document (the eighth registered template) and cancels a receipt', async () => {
    const grn = await approvedGrn();
    const created = await api().post('/warehouse-receipts').set('Authorization', `Bearer ${owner}`).send({ grnId: grn.id }).expect(201);

    const preview = await api()
      .post(`/warehouse-receipts/${created.body.id}/document/preview`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(201);
    expect(Buffer.from(preview.body).subarray(0, 4).toString()).toBe('%PDF');

    const committed = await api()
      .post(`/warehouse-receipts/${created.body.id}/document`)
      .set('Authorization', `Bearer ${owner}`)
      .send({})
      .expect(201);
    expect(committed.body.documentType).toBe('warehouse_receipt');
    expect(committed.body.documentNumber).toMatch(/^WR\//);

    const cancelled = await api()
      .post(`/warehouse-receipts/${created.body.id}/cancel`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(201);
    expect(cancelled.body.status).toBe('cancelled');
    await api().post(`/warehouse-receipts/${created.body.id}/cancel`).set('Authorization', `Bearer ${owner}`).expect(400);
  });

  it('an Operator can raise and complete a put-away but cannot issue a warehouse receipt', async () => {
    const grn = await approvedGrn();
    const created = await api()
      .post('/putaways')
      .set('Authorization', `Bearer ${operator}`)
      .send({ grnId: grn.id, lines: [{ grnItemId: grn.items[0].id, toLocationId: binId }] })
      .expect(201);
    await api().post(`/putaways/${created.body.id}/complete`).set('Authorization', `Bearer ${operator}`).expect(201);

    const denied = await api()
      .post('/warehouse-receipts')
      .set('Authorization', `Bearer ${operator}`)
      .send({ grnId: grn.id })
      .expect(403);
    expect(denied.body.message).toMatch(/issue_warehouse_receipt/);
  });

  it('isolates tenants and rejects unauthenticated access', async () => {
    const grn = await approvedGrn();
    const putaway = await api()
      .post('/putaways')
      .set('Authorization', `Bearer ${owner}`)
      .send({ grnId: grn.id, lines: [{ grnItemId: grn.items[0].id, toLocationId: binId }] })
      .expect(201);
    const receipt = await api().post('/warehouse-receipts').set('Authorization', `Bearer ${owner}`).send({ grnId: grn.id }).expect(201);

    await api().get(`/putaways/${putaway.body.id}`).set('Authorization', `Bearer ${otherOwner}`).expect(404);
    await api().get(`/warehouse-receipts/${receipt.body.id}`).set('Authorization', `Bearer ${otherOwner}`).expect(404);

    await api().get('/putaways').expect(401);
    await api().get('/warehouse-receipts').expect(401);
  });
});
