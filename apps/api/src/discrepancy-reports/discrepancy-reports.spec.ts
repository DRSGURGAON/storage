import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../app.module';

/**
 * Blueprint §19 (Discrepancy / Damage Report) and §20 (Inspection) --
 * the two GRN-adjacent Phase 4 records, tested together because they
 * share the same fixtures and both hang off a GRN.
 */
describe('Discrepancy reports and inspections', () => {
  let app: INestApplication;
  const suffix = randomUUID().slice(0, 8);
  const password = 'correcthorsebattery';
  let owner = '';
  let otherOwner = '';
  let billingExec = '';
  let customerId = '';
  let warehouseId = '';
  let cleanProductId = '';
  let shortProductId = '';

  const api = () => request(app.getHttpServer());
  const signup = async (slug: string, email: string) => {
    const res = await api()
      .post('/auth/signup')
      .send({ companyLegalName: `${slug} Pvt Ltd`, tenantSlug: slug, email, fullName: 'Priya Sharma', password })
      .expect(201);
    return res.body.accessToken as string;
  };

  /** One line that tallies exactly, one short + damaged -- so "only the discrepant lines are copied" is actually testable. */
  const createMixedGrn = async () => {
    const res = await api()
      .post('/grns')
      .set('Authorization', `Bearer ${owner}`)
      .send({
        warehouseId,
        customerId,
        supplierName: 'Acme Distributors',
        items: [
          { productId: cleanProductId, expectedQty: 50, receivedQty: 50, acceptedQty: 50 },
          { productId: shortProductId, expectedQty: 100, receivedQty: 90, acceptedQty: 85, rejectedQty: 5, damagedQty: 5 },
        ],
      })
      .expect(201);
    return res.body.id as string;
  };

  const createCleanGrn = async () => {
    const res = await api()
      .post('/grns')
      .set('Authorization', `Bearer ${owner}`)
      .send({
        warehouseId,
        customerId,
        items: [{ productId: cleanProductId, expectedQty: 10, receivedQty: 10, acceptedQty: 10 }],
      })
      .expect(201);
    return res.body.id as string;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    owner = await signup(`dr-a-${suffix}`, `owner-a-${suffix}@test.local`);
    otherOwner = await signup(`dr-b-${suffix}`, `owner-b-${suffix}@test.local`);

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
    cleanProductId = (
      await api()
        .post('/products')
        .set('Authorization', `Bearer ${owner}`)
        .send({ sku: 'SKU001', name: 'Widget', uomCode: 'NOS' })
        .expect(201)
    ).body.id;
    shortProductId = (
      await api()
        .post('/products')
        .set('Authorization', `Bearer ${owner}`)
        .send({ sku: 'SKU002', name: 'Gizmo', uomCode: 'NOS' })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("copies only a GRN's discrepant lines, with the customer/supplier auto-filled", async () => {
    const grnId = await createMixedGrn();

    const res = await api()
      .post('/discrepancy-reports')
      .set('Authorization', `Bearer ${owner}`)
      .send({ grnId, reason: 'Short delivery with damage' })
      .expect(201);

    expect(res.body.number).toBe('DR/26-27/000001');
    expect(res.body.status).toBe('draft');
    expect(res.body.customerId).toBe(customerId);
    expect(res.body.supplierName).toBe('Acme Distributors');

    // The clean line is left out entirely -- only the short/damaged one is worth reporting.
    expect(res.body.items).toHaveLength(1);
    const item = res.body.items[0];
    expect(item.productSnapshot).toMatchObject({ sku: 'SKU002' });
    expect(item.grnItemId).not.toBeNull();
    expect(item.shortQty).toBe(10);
    expect(item.damagedQty).toBe(5);
  });

  it('refuses a GRN with nothing to report', async () => {
    const grnId = await createCleanGrn();
    const denied = await api()
      .post('/discrepancy-reports')
      .set('Authorization', `Bearer ${owner}`)
      .send({ grnId })
      .expect(400);
    expect(denied.body.message).toMatch(/nothing to report/);
  });

  it('can be raised standalone, without a GRN, when warehouse/customer/items are given directly', async () => {
    const res = await api()
      .post('/discrepancy-reports')
      .set('Authorization', `Bearer ${owner}`)
      .send({
        warehouseId,
        customerId,
        reason: 'Damage found during storage',
        items: [{ productId: cleanProductId, damagedQty: 3, reason: 'Water ingress' }],
      })
      .expect(201);
    expect(res.body.grnId).toBeNull();
    expect(res.body.items[0].damagedQty).toBe(3);

    await api().post('/discrepancy-reports').set('Authorization', `Bearer ${owner}`).send({}).expect(400);
  });

  it('walks draft → submitted → acknowledged → closed, recording both acknowledgements', async () => {
    const grnId = await createMixedGrn();
    const created = await api()
      .post('/discrepancy-reports')
      .set('Authorization', `Bearer ${owner}`)
      .send({ grnId })
      .expect(201);
    const id = created.body.id;

    // Can't acknowledge or close before it is submitted.
    await api().post(`/discrepancy-reports/${id}/acknowledge`).set('Authorization', `Bearer ${owner}`).send({}).expect(400);
    await api().post(`/discrepancy-reports/${id}/close`).set('Authorization', `Bearer ${owner}`).expect(400);

    await api().post(`/discrepancy-reports/${id}/submit`).set('Authorization', `Bearer ${owner}`).expect(201);
    await api().patch(`/discrepancy-reports/${id}`).set('Authorization', `Bearer ${owner}`).send({ remarks: 'no' }).expect(400);

    const acknowledged = await api()
      .post(`/discrepancy-reports/${id}/acknowledge`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ driverAckName: 'Ramesh Kumar' })
      .expect(201);
    expect(acknowledged.body.status).toBe('acknowledged');
    expect(acknowledged.body.driverAckName).toBe('Ramesh Kumar');
    expect(acknowledged.body.driverAckAt).not.toBeNull();
    // The warehouse side is the acting user, recorded server-side rather than accepted from the request.
    expect(acknowledged.body.warehouseAckBy).not.toBeNull();
    expect(acknowledged.body.warehouseAckAt).not.toBeNull();

    const closed = await api().post(`/discrepancy-reports/${id}/close`).set('Authorization', `Bearer ${owner}`).expect(201);
    expect(closed.body.status).toBe('closed');
  });

  it('cancels from draft or submitted, filters by GRN, and isolates tenants', async () => {
    const grnId = await createMixedGrn();
    const created = await api()
      .post('/discrepancy-reports')
      .set('Authorization', `Bearer ${owner}`)
      .send({ grnId })
      .expect(201);
    const cancelled = await api()
      .post(`/discrepancy-reports/${created.body.id}/cancel`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(201);
    expect(cancelled.body.status).toBe('cancelled');

    const byGrn = await api().get(`/discrepancy-reports?grnId=${grnId}`).set('Authorization', `Bearer ${owner}`).expect(200);
    expect(byGrn.body.items.map((r: { id: string }) => r.id)).toEqual([created.body.id]);

    await api().get(`/discrepancy-reports/${created.body.id}`).set('Authorization', `Bearer ${otherOwner}`).expect(404);
  });

  it('generates a Discrepancy Report document (the sixth registered template)', async () => {
    const grnId = await createMixedGrn();
    const created = await api()
      .post('/discrepancy-reports')
      .set('Authorization', `Bearer ${owner}`)
      .send({ grnId })
      .expect(201);

    const preview = await api()
      .post(`/discrepancy-reports/${created.body.id}/document/preview`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(201);
    expect(Buffer.from(preview.body).subarray(0, 4).toString()).toBe('%PDF');

    const committed = await api()
      .post(`/discrepancy-reports/${created.body.id}/document`)
      .set('Authorization', `Bearer ${owner}`)
      .send({})
      .expect(201);
    expect(committed.body.documentType).toBe('discrepancy_report');
    expect(committed.body.documentNumber).toMatch(/^DR\//);
  });

  it('creates an inspection off a GRN, defaulting the inspector to the acting user and deriving overallResult', async () => {
    const grnId = await createMixedGrn();

    const accepted = await api()
      .post('/inspections')
      .set('Authorization', `Bearer ${owner}`)
      .send({
        grnId,
        items: [
          {
            productId: cleanProductId,
            quantity: 50,
            packagingCondition: 'intact',
            sealCondition: 'intact',
            result: 'accepted',
            acceptedQty: 50,
          },
        ],
      })
      .expect(201);
    expect(accepted.body.number).toBe('INS/26-27/000001');
    expect(accepted.body.warehouseId).toBe(warehouseId);
    expect(accepted.body.customerId).toBe(customerId);
    expect(accepted.body.inspectorUserId).not.toBeNull();
    expect(accepted.body.inspectorName).toBe('Priya Sharma');
    expect(accepted.body.overallResult).toBe('accepted');

    const mixed = await api()
      .post('/inspections')
      .set('Authorization', `Bearer ${owner}`)
      .send({
        grnId,
        items: [
          { productId: cleanProductId, quantity: 5, result: 'accepted' },
          { productId: shortProductId, quantity: 5, visibleDamage: true, result: 'rejected' },
        ],
      })
      .expect(201);
    expect(mixed.body.overallResult).toBe('partially_accepted');

    const allRejected = await api()
      .post('/inspections')
      .set('Authorization', `Bearer ${owner}`)
      .send({ grnId, items: [{ productId: shortProductId, quantity: 5, result: 'rejected' }] })
      .expect(201);
    expect(allRejected.body.overallResult).toBe('rejected');
  });

  it('completes an inspection, locking further edits, and cancels another', async () => {
    const grnId = await createMixedGrn();
    const created = await api()
      .post('/inspections')
      .set('Authorization', `Bearer ${owner}`)
      .send({ grnId, items: [{ productId: cleanProductId, quantity: 1, result: 'accepted' }] })
      .expect(201);

    const edited = await api()
      .patch(`/inspections/${created.body.id}`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ remarks: 'Checked seals' })
      .expect(200);
    expect(edited.body.remarks).toBe('Checked seals');

    const completed = await api().post(`/inspections/${created.body.id}/complete`).set('Authorization', `Bearer ${owner}`).expect(201);
    expect(completed.body.status).toBe('completed');
    await api().patch(`/inspections/${created.body.id}`).set('Authorization', `Bearer ${owner}`).send({ remarks: 'no' }).expect(400);
    await api().post(`/inspections/${created.body.id}/cancel`).set('Authorization', `Bearer ${owner}`).expect(400);

    const second = await api()
      .post('/inspections')
      .set('Authorization', `Bearer ${owner}`)
      .send({ grnId, items: [{ productId: cleanProductId, quantity: 1, result: 'accepted' }] })
      .expect(201);
    const cancelled = await api().post(`/inspections/${second.body.id}/cancel`).set('Authorization', `Bearer ${owner}`).expect(201);
    expect(cancelled.body.status).toBe('cancelled');
  });

  it('has no document routes for inspections -- the one Phase 4 record with no document type', async () => {
    const grnId = await createMixedGrn();
    const created = await api()
      .post('/inspections')
      .set('Authorization', `Bearer ${owner}`)
      .send({ grnId, items: [{ productId: cleanProductId, quantity: 1, result: 'accepted' }] })
      .expect(201);
    await api().post(`/inspections/${created.body.id}/document`).set('Authorization', `Bearer ${owner}`).send({}).expect(404);
  });

  it('gates both records on their own seeded permission, and rejects unauthenticated access', async () => {
    const denied = await api()
      .post('/discrepancy-reports')
      .set('Authorization', `Bearer ${billingExec}`)
      .send({ warehouseId, customerId, items: [{ productId: cleanProductId, damagedQty: 1 }] })
      .expect(403);
    expect(denied.body.message).toMatch(/create_discrepancy_report/);
    await api().get('/inspections').set('Authorization', `Bearer ${billingExec}`).expect(403);

    await api().get('/discrepancy-reports').expect(401);
    await api().get('/inspections').expect(401);
  });
});
