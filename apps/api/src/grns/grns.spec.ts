import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../app.module';

/**
 * Blueprint §18: "one of the most important V1 transactions." Covers
 * auto-fill from Inward (header *and* items), the derived
 * `hasDiscrepancy` flag, the Draft → Submitted → Checked → Approved
 * machine with §50's Operator → Manager permission split, and the
 * deliberate absence of stock posting in Phase 4.
 */
describe('GRNs', () => {
  let app: INestApplication;
  const suffix = randomUUID().slice(0, 8);
  const password = 'correcthorsebattery';
  let owner = '';
  let otherOwner = '';
  let operator = '';
  let customerId = '';
  let warehouseId = '';
  let productId = '';

  const api = () => request(app.getHttpServer());
  const signup = async (slug: string, email: string) => {
    const res = await api()
      .post('/auth/signup')
      .send({ companyLegalName: `${slug} Pvt Ltd`, tenantSlug: slug, email, fullName: 'Owner', password })
      .expect(201);
    return res.body.accessToken as string;
  };

  /** A received inward is the normal starting point for a GRN. */
  const createReceivedInward = async (overrides: Record<string, unknown> = {}) => {
    const created = await api()
      .post('/inwards')
      .set('Authorization', `Bearer ${owner}`)
      .send({
        warehouseId,
        customerId,
        supplierName: 'Acme Distributors',
        lrNumber: 'LR100',
        invoiceNumber: 'INV-9',
        items: [{ productId, expectedQty: 100, receivedQty: 95, acceptedQty: 90, rejectedQty: 5, condition: 'good' }],
        ...overrides,
      })
      .expect(201);
    await api().post(`/inwards/${created.body.id}/receive`).set('Authorization', `Bearer ${owner}`).expect(201);
    return created.body.id as string;
  };

  const approvedGrn = async () => {
    const inwardId = await createReceivedInward();
    const grn = await api().post('/grns').set('Authorization', `Bearer ${owner}`).send({ inwardId }).expect(201);
    for (const step of ['submit', 'check', 'approve']) {
      await api().post(`/grns/${grn.body.id}/${step}`).set('Authorization', `Bearer ${owner}`).expect(201);
    }
    return grn.body.id as string;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    owner = await signup(`grn-a-${suffix}`, `owner-a-${suffix}@test.local`);
    otherOwner = await signup(`grn-b-${suffix}`, `owner-b-${suffix}@test.local`);

    const opEmail = `op-${suffix}@test.local`;
    await api()
      .post('/users')
      .set('Authorization', `Bearer ${owner}`)
      .send({ email: opEmail, fullName: 'Op', password, roleCode: 'warehouse_operator' })
      .expect(201);
    operator = (await api().post('/auth/login').send({ email: opEmail, password }).expect(201)).body.accessToken;

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

  it('auto-fills header and items from a received Inward, derives short/excess and hasDiscrepancy, and flips the inward to grn_created', async () => {
    const inwardId = await createReceivedInward();

    const res = await api().post('/grns').set('Authorization', `Bearer ${owner}`).send({ inwardId }).expect(201);

    expect(res.body.number).toBe('GRN/26-27/000001');
    expect(res.body.status).toBe('draft');
    expect(res.body.customerId).toBe(customerId);
    expect(res.body.warehouseId).toBe(warehouseId);
    expect(res.body.supplierName).toBe('Acme Distributors');
    expect(res.body.lrNumber).toBe('LR100');
    expect(res.body.invoiceNumber).toBe('INV-9');

    expect(res.body.items).toHaveLength(1);
    const item = res.body.items[0];
    expect(item.inwardItemId).not.toBeNull();
    expect(item.productSnapshot).toMatchObject({ sku: 'SKU001', name: 'Widget' });
    // short/excess are generated columns -- 100 expected, 95 received.
    expect(item.shortQty).toBe(5);
    expect(item.excessQty).toBe(0);
    expect(res.body.hasDiscrepancy).toBe(true);

    const inward = await api().get(`/inwards/${inwardId}`).set('Authorization', `Bearer ${owner}`).expect(200);
    expect(inward.body.status).toBe('grn_created');
  });

  it('leaves hasDiscrepancy false when received matches expected with nothing damaged', async () => {
    const inwardId = await createReceivedInward({
      items: [{ productId, expectedQty: 50, receivedQty: 50, acceptedQty: 50 }],
    });
    const res = await api().post('/grns').set('Authorization', `Bearer ${owner}`).send({ inwardId }).expect(201);
    expect(res.body.hasDiscrepancy).toBe(false);
    expect(res.body.items[0].shortQty).toBe(0);
  });

  it('refuses an inward that is not yet received, and requires warehouse/customer/items without one', async () => {
    const draft = await api()
      .post('/inwards')
      .set('Authorization', `Bearer ${owner}`)
      .send({ warehouseId, customerId, items: [{ productId }] })
      .expect(201);
    await api().post('/grns').set('Authorization', `Bearer ${owner}`).send({ inwardId: draft.body.id }).expect(400);

    await api().post('/grns').set('Authorization', `Bearer ${owner}`).send({}).expect(400);
    await api()
      .post('/grns')
      .set('Authorization', `Bearer ${owner}`)
      .send({ warehouseId, customerId })
      .expect(400);
  });

  it("rejects a line whose accepted + rejected exceeds what was received, before the table's own check constraint fires", async () => {
    const denied = await api()
      .post('/grns')
      .set('Authorization', `Bearer ${owner}`)
      .send({
        warehouseId,
        customerId,
        items: [{ productId, expectedQty: 10, receivedQty: 10, acceptedQty: 8, rejectedQty: 5 }],
      })
      .expect(400);
    expect(denied.body.message).toMatch(/cannot exceed receivedQty/);
  });

  it('rejects serial numbers on a product that is not serial-tracked', async () => {
    const denied = await api()
      .post('/grns')
      .set('Authorization', `Bearer ${owner}`)
      .send({
        warehouseId,
        customerId,
        items: [{ productId, receivedQty: 2, acceptedQty: 2, serialNos: ['SN-1', 'SN-2'] }],
      })
      .expect(400);
    expect(denied.body.message).toMatch(/not serial-tracked/);
  });

  it('records serial numbers for a serial-tracked product', async () => {
    const serialProduct = await api()
      .post('/products')
      .set('Authorization', `Bearer ${owner}`)
      .send({ sku: 'SKU-SER', name: 'Serial Widget', uomCode: 'NOS', serialTracked: true })
      .expect(201);

    const res = await api()
      .post('/grns')
      .set('Authorization', `Bearer ${owner}`)
      .send({
        warehouseId,
        customerId,
        items: [{ productId: serialProduct.body.id, receivedQty: 2, acceptedQty: 2, serialNos: ['SN-1', 'SN-2'] }],
      })
      .expect(201);
    expect(res.body.items[0].serialNos).toEqual(['SN-1', 'SN-2']);
  });

  it('walks Draft → Submitted → Checked → Approved, rejecting every skip-ahead, and posts no stock in Phase 4', async () => {
    const inwardId = await createReceivedInward();
    const created = await api().post('/grns').set('Authorization', `Bearer ${owner}`).send({ inwardId }).expect(201);
    const id = created.body.id;

    // Can't skip straight to check or approve.
    await api().post(`/grns/${id}/check`).set('Authorization', `Bearer ${owner}`).expect(400);
    await api().post(`/grns/${id}/approve`).set('Authorization', `Bearer ${owner}`).expect(400);

    const submitted = await api().post(`/grns/${id}/submit`).set('Authorization', `Bearer ${owner}`).expect(201);
    expect(submitted.body.status).toBe('submitted');
    expect(submitted.body.submittedAt).not.toBeNull();
    // Editing stops at submission -- §50's "approved transactions must not be freely editable", enforced one step earlier.
    await api().patch(`/grns/${id}`).set('Authorization', `Bearer ${owner}`).send({ remarks: 'nope' }).expect(400);

    const checked = await api().post(`/grns/${id}/check`).set('Authorization', `Bearer ${owner}`).expect(201);
    expect(checked.body.status).toBe('checked');
    expect(checked.body.checkedAt).not.toBeNull();

    const approved = await api().post(`/grns/${id}/approve`).set('Authorization', `Bearer ${owner}`).expect(201);
    expect(approved.body.status).toBe('approved');
    expect(approved.body.approvedAt).not.toBeNull();
    // "Only approved GRNs post stock" (§18) -- and Phase 4 posts none, so this stays null until Phase 5.
    expect(approved.body.stockPostedAt).toBeNull();

    await api().post(`/grns/${id}/approve`).set('Authorization', `Bearer ${owner}`).expect(400);
  });

  it('rejects a submitted GRN, and cancels a draft', async () => {
    const first = await api()
      .post('/grns')
      .set('Authorization', `Bearer ${owner}`)
      .send({ warehouseId, customerId, items: [{ productId, receivedQty: 1, acceptedQty: 1 }] })
      .expect(201);
    await api().post(`/grns/${first.body.id}/submit`).set('Authorization', `Bearer ${owner}`).expect(201);
    const rejected = await api().post(`/grns/${first.body.id}/reject`).set('Authorization', `Bearer ${owner}`).expect(201);
    expect(rejected.body.status).toBe('rejected');

    const second = await api()
      .post('/grns')
      .set('Authorization', `Bearer ${owner}`)
      .send({ warehouseId, customerId, items: [{ productId, receivedQty: 1, acceptedQty: 1 }] })
      .expect(201);
    const cancelled = await api().post(`/grns/${second.body.id}/cancel`).set('Authorization', `Bearer ${owner}`).expect(201);
    expect(cancelled.body.status).toBe('cancelled');
  });

  it('a Warehouse Operator can create and submit but cannot check, approve, or reject -- §50s Operator → Manager split', async () => {
    const created = await api()
      .post('/grns')
      .set('Authorization', `Bearer ${operator}`)
      .send({ warehouseId, customerId, items: [{ productId, receivedQty: 1, acceptedQty: 1 }] })
      .expect(201);
    await api().post(`/grns/${created.body.id}/submit`).set('Authorization', `Bearer ${operator}`).expect(201);

    const denied = await api().post(`/grns/${created.body.id}/check`).set('Authorization', `Bearer ${operator}`).expect(403);
    expect(denied.body.message).toMatch(/approve_grn/);
    await api().post(`/grns/${created.body.id}/reject`).set('Authorization', `Bearer ${operator}`).expect(403);

    await api().post(`/grns/${created.body.id}/check`).set('Authorization', `Bearer ${owner}`).expect(201);
    await api().post(`/grns/${created.body.id}/approve`).set('Authorization', `Bearer ${operator}`).expect(403);
  });

  it('filters by status and searches by number/invoice', async () => {
    const list = await api().get('/grns?status=approved').set('Authorization', `Bearer ${owner}`).expect(200);
    expect(list.body.total).toBeGreaterThan(0);
    expect(list.body.items.every((g: { status: string }) => g.status === 'approved')).toBe(true);
    // List rows omit the (potentially large) item detail.
    expect(list.body.items[0].items).toBeUndefined();

    const byNumber = await api().get('/grns?q=GRN/26-27/000001').set('Authorization', `Bearer ${owner}`).expect(200);
    expect(byNumber.body.items.map((g: { number: string }) => g.number)).toEqual(['GRN/26-27/000001']);
  });

  it("tenant B cannot see tenant A's GRNs, and gets its own independent GRN0001", async () => {
    const id = await approvedGrn();
    await api().get(`/grns/${id}`).set('Authorization', `Bearer ${otherOwner}`).expect(404);

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
    const otherGrn = await api()
      .post('/grns')
      .set('Authorization', `Bearer ${otherOwner}`)
      .send({
        warehouseId: otherWarehouse.body.id,
        customerId: otherCustomer.body.id,
        items: [{ productId: otherProduct.body.id, receivedQty: 1, acceptedQty: 1 }],
      })
      .expect(201);
    expect(otherGrn.body.number).toBe('GRN/26-27/000001');
  });

  it('rejects unauthenticated access', async () => {
    await api().get('/grns').expect(401);
  });
});
