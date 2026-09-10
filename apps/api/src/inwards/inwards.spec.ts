import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../app.module';

/**
 * Blueprint §17: Goods Inward, Phase 4's second slice. Covers the record,
 * server-side auto-fill from a linked Gate Entry (customer, vehicle,
 * transporter), the draft -> received/cancelled workflow, and the
 * Gate Entry -> 'linked' side effect. PDF generation is covered in
 * documents.spec.ts alongside the other registered document types.
 */
describe('Inwards', () => {
  let app: INestApplication;
  const suffix = randomUUID().slice(0, 8);
  const password = 'correcthorsebattery';
  let owner = '';
  let otherOwner = '';
  let billingExec = '';
  let customerId = '';
  let warehouseId = '';
  let transporterId = '';
  let vehicleId = '';
  let productId = '';

  const api = () => request(app.getHttpServer());
  const signup = async (slug: string, email: string) => {
    const res = await api()
      .post('/auth/signup')
      .send({ companyLegalName: `${slug} Pvt Ltd`, tenantSlug: slug, email, fullName: 'Owner', password })
      .expect(201);
    return res.body.accessToken as string;
  };
  const minimalDto = (overrides: Record<string, unknown> = {}) => ({
    warehouseId,
    customerId,
    items: [{ productId, expectedQty: 100, receivedQty: 100, acceptedQty: 100 }],
    ...overrides,
  });
  const createGateEntry = async (token: string, whId: string, overrides: Record<string, unknown> = {}) => {
    const res = await api()
      .post('/gate-entries')
      .set('Authorization', `Bearer ${token}`)
      .send({ warehouseId: whId, direction: 'in', purpose: 'inward', ...overrides })
      .expect(201);
    return res.body.id as string;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    owner = await signup(`in-a-${suffix}`, `owner-a-${suffix}@test.local`);
    otherOwner = await signup(`in-b-${suffix}`, `owner-b-${suffix}@test.local`);

    const billingEmail = `billing-${suffix}@test.local`;
    await api()
      .post('/users')
      .set('Authorization', `Bearer ${owner}`)
      .send({ email: billingEmail, fullName: 'Billing', password, roleCode: 'billing_executive' })
      .expect(201);
    billingExec = (await api().post('/auth/login').send({ email: billingEmail, password }).expect(201)).body.accessToken;

    customerId = (
      await api().post('/customers').set('Authorization', `Bearer ${owner}`).send({ name: 'Acme Co' }).expect(201)
    ).body.id;
    warehouseId = (
      await api()
        .post('/warehouses')
        .set('Authorization', `Bearer ${owner}`)
        .send({ code: 'WH01', name: 'Main Godown', capacityValue: 500, capacityUom: 'pallet' })
        .expect(201)
    ).body.id;
    transporterId = (
      await api().post('/transporters').set('Authorization', `Bearer ${owner}`).send({ name: 'Fast Movers' }).expect(201)
    ).body.id;
    vehicleId = (
      await api()
        .post('/vehicles')
        .set('Authorization', `Bearer ${owner}`)
        .send({ vehicleNumber: 'HR26DK1234', transporterId })
        .expect(201)
    ).body.id;
    productId = (
      await api()
        .post('/products')
        .set('Authorization', `Bearer ${owner}`)
        .send({ sku: 'SKU001', name: 'Widget', uomCode: 'NOS' })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates an inward with an allocated IN number, product snapshot, and server-computed quantities', async () => {
    const res = await api().post('/inwards').set('Authorization', `Bearer ${owner}`).send(minimalDto()).expect(201);

    expect(res.body.number).toBe('IN/26-27/000001');
    expect(res.body.status).toBe('draft');
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].productSnapshot).toMatchObject({ sku: 'SKU001', name: 'Widget', uom: 'NOS' });
    expect(res.body.items[0].acceptedQty).toBe(100);

    const second = await api().post('/inwards').set('Authorization', `Bearer ${owner}`).send(minimalDto()).expect(201);
    expect(second.body.number).toBe('IN/26-27/000002');
  });

  it('rejects an empty item array, and validates warehouse/customer/product references', async () => {
    await api().post('/inwards').set('Authorization', `Bearer ${owner}`).send(minimalDto({ items: [] })).expect(400);
    await api().post('/inwards').set('Authorization', `Bearer ${owner}`).send(minimalDto({ warehouseId: randomUUID() })).expect(404);
    await api().post('/inwards').set('Authorization', `Bearer ${owner}`).send(minimalDto({ customerId: randomUUID() })).expect(404);
    await api()
      .post('/inwards')
      .set('Authorization', `Bearer ${owner}`)
      .send(minimalDto({ items: [{ productId: randomUUID() }] }))
      .expect(404);
  });

  it('takes the warehouse from the gate entry, and refuses one that disagrees with it', async () => {
    const gateEntry = await api()
      .post('/gate-entries')
      .set('Authorization', `Bearer ${owner}`)
      .send({ warehouseId, direction: 'in', customerId, purpose: 'inward', vehicleNumber: 'HR26DK4321' })
      .expect(201);

    // A second warehouse, which this gate entry has nothing to do with.
    const otherWarehouse = (
      await api().post('/warehouses').set('Authorization', `Bearer ${owner}`).send({ code: 'WH02', name: 'Elsewhere' }).expect(201)
    ).body.id;
    const refused = await api()
      .post('/inwards')
      .set('Authorization', `Bearer ${owner}`)
      .send({ gateEntryId: gateEntry.body.id, warehouseId: otherWarehouse, items: [{ productId, expectedQty: 5 }] })
      .expect(400);
    expect(refused.body.message).toMatch(/different warehouse/);

    // With no warehouse given at all, the gate entry's own is used -- the
    // vehicle was let into exactly one place, and saying so twice only
    // creates a way for the two to disagree.
    const inward = await api()
      .post('/inwards')
      .set('Authorization', `Bearer ${owner}`)
      .send({ gateEntryId: gateEntry.body.id, items: [{ productId, expectedQty: 5, receivedQty: 5 }] })
      .expect(201);
    expect(inward.body.warehouseId).toBe(warehouseId);
    expect(inward.body.customerId).toBe(customerId);
  });

  it('requires a customerId directly or via a gate entry', async () => {
    await api()
      .post('/inwards')
      .set('Authorization', `Bearer ${owner}`)
      .send({ warehouseId, items: [{ productId }] })
      .expect(400);
  });

  it('linking a Gate Entry auto-fills customer/vehicle/transporter, and flips the gate entry to linked', async () => {
    const gateEntryId = await createGateEntry(owner, warehouseId, { customerId, vehicleId });

    const res = await api()
      .post('/inwards')
      .set('Authorization', `Bearer ${owner}`)
      .send({ warehouseId, gateEntryId, items: [{ productId }] })
      .expect(201);
    expect(res.body.customerId).toBe(customerId);
    expect(res.body.vehicleId).toBe(vehicleId);
    expect(res.body.vehicleNumber).toBe('HR26DK1234');
    expect(res.body.transporterId).toBe(transporterId);
    expect(res.body.transporterName).toBe('Fast Movers');

    const gateEntry = await api().get(`/gate-entries/${gateEntryId}`).set('Authorization', `Bearer ${owner}`).expect(200);
    expect(gateEntry.body.status).toBe('linked');
  });

  it('an explicit vehicleId overrides the gate entry-derived one', async () => {
    const otherTransporter = await api()
      .post('/transporters')
      .set('Authorization', `Bearer ${owner}`)
      .send({ name: 'Other Carrier' })
      .expect(201);
    const otherVehicle = await api()
      .post('/vehicles')
      .set('Authorization', `Bearer ${owner}`)
      .send({ vehicleNumber: 'DL01AB9999', transporterId: otherTransporter.body.id })
      .expect(201);
    const gateEntryId = await createGateEntry(owner, warehouseId, { customerId, vehicleId });

    const res = await api()
      .post('/inwards')
      .set('Authorization', `Bearer ${owner}`)
      .send({ warehouseId, customerId, gateEntryId, vehicleId: otherVehicle.body.id, items: [{ productId }] })
      .expect(201);
    expect(res.body.vehicleId).toBe(otherVehicle.body.id);
    expect(res.body.vehicleNumber).toBe('DL01AB9999');
    expect(res.body.transporterId).toBe(otherTransporter.body.id);
  });

  it('refuses to link a gate entry that is not open', async () => {
    const gateEntryId = await createGateEntry(owner, warehouseId);
    await api().post(`/gate-entries/${gateEntryId}/cancel`).set('Authorization', `Bearer ${owner}`).expect(201);

    await api()
      .post('/inwards')
      .set('Authorization', `Bearer ${owner}`)
      .send({ warehouseId, customerId, gateEntryId, items: [{ productId }] })
      .expect(400);
  });

  it('walks the full workflow: draft -> received, with edit rejected once received; cancel allowed from either', async () => {
    const created = await api().post('/inwards').set('Authorization', `Bearer ${owner}`).send(minimalDto()).expect(201);
    const id = created.body.id;

    const edited = await api()
      .patch(`/inwards/${id}`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ remarks: 'first edit' })
      .expect(200);
    expect(edited.body.remarks).toBe('first edit');

    const received = await api().post(`/inwards/${id}/receive`).set('Authorization', `Bearer ${owner}`).expect(201);
    expect(received.body.status).toBe('received');

    await api().patch(`/inwards/${id}`).set('Authorization', `Bearer ${owner}`).send({ remarks: 'nope' }).expect(400);
    await api().post(`/inwards/${id}/receive`).set('Authorization', `Bearer ${owner}`).expect(400);

    const cancelled = await api().post(`/inwards/${id}/cancel`).set('Authorization', `Bearer ${owner}`).expect(201);
    expect(cancelled.body.status).toBe('cancelled');
  });

  it('cancels a draft inward directly', async () => {
    const created = await api().post('/inwards').set('Authorization', `Bearer ${owner}`).send(minimalDto()).expect(201);
    const cancelled = await api().post(`/inwards/${created.body.id}/cancel`).set('Authorization', `Bearer ${owner}`).expect(201);
    expect(cancelled.body.status).toBe('cancelled');
  });

  it('filters by status/customer, and searches by number and LR number', async () => {
    const list = await api().get('/inwards?status=cancelled').set('Authorization', `Bearer ${owner}`).expect(200);
    expect(list.body.total).toBeGreaterThan(0);
    expect(list.body.items.every((i: { status: string }) => i.status === 'cancelled')).toBe(true);

    const withLr = await api()
      .post('/inwards')
      .set('Authorization', `Bearer ${owner}`)
      .send(minimalDto({ lrNumber: 'LR-UNIQUE-1' }))
      .expect(201);
    const byLr = await api().get('/inwards?q=LR-UNIQUE-1').set('Authorization', `Bearer ${owner}`).expect(200);
    expect(byLr.body.items.map((i: { id: string }) => i.id)).toEqual([withLr.body.id]);

    const byNumber = await api().get('/inwards?q=IN/26-27/000001').set('Authorization', `Bearer ${owner}`).expect(200);
    expect(byNumber.body.items.map((i: { number: string }) => i.number)).toEqual(['IN/26-27/000001']);
  });

  it("tenant B cannot see tenant A's inwards, and gets its own independent IN0001", async () => {
    const created = await api().post('/inwards').set('Authorization', `Bearer ${owner}`).send(minimalDto()).expect(201);
    await api().get(`/inwards/${created.body.id}`).set('Authorization', `Bearer ${otherOwner}`).expect(404);

    const otherWarehouse = await api()
      .post('/warehouses')
      .set('Authorization', `Bearer ${otherOwner}`)
      .send({ code: 'WH01', name: 'Other Godown', capacityValue: 100, capacityUom: 'pallet' })
      .expect(201);
    const otherCustomer = await api()
      .post('/customers')
      .set('Authorization', `Bearer ${otherOwner}`)
      .send({ name: 'Beta Co' })
      .expect(201);
    const otherProduct = await api()
      .post('/products')
      .set('Authorization', `Bearer ${otherOwner}`)
      .send({ sku: 'SKU001', name: 'Gadget', uomCode: 'NOS' })
      .expect(201);
    const otherInward = await api()
      .post('/inwards')
      .set('Authorization', `Bearer ${otherOwner}`)
      .send({
        warehouseId: otherWarehouse.body.id,
        customerId: otherCustomer.body.id,
        items: [{ productId: otherProduct.body.id }],
      })
      .expect(201);
    expect(otherInward.body.number).toBe('IN/26-27/000001');
  });

  it('a Billing Executive cannot create or view inwards -- create_inward is the only seeded permission for this module', async () => {
    const denied = await api().post('/inwards').set('Authorization', `Bearer ${billingExec}`).send(minimalDto()).expect(403);
    expect(denied.body.message).toMatch(/create_inward/);
    await api().get('/inwards').set('Authorization', `Bearer ${billingExec}`).expect(403);
  });

  it('rejects unauthenticated access', async () => {
    await api().get('/inwards').expect(401);
  });
});
