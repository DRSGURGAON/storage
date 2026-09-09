import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../app.module';

/**
 * Blueprint §14: the warehousing/storage quotation, the first Phase 3
 * slice. Deliberately scoped to the quotation record and its Draft ->
 * Sent -> Accepted/Rejected/Cancelled workflow -- PDF generation and QR
 * verification (document-engine.md) are a separate, later increment.
 */
describe('Quotations', () => {
  let app: INestApplication;
  const suffix = randomUUID().slice(0, 8);
  const password = 'correcthorsebattery';
  let owner = '';
  let otherOwner = '';
  let operator = '';
  let customerId = '';
  let storageChargeTypeId = '';
  let gst18Id = '';

  const api = () => request(app.getHttpServer());
  const signup = async (slug: string, email: string) => {
    const res = await api()
      .post('/auth/signup')
      .send({ companyLegalName: `${slug} Pvt Ltd`, tenantSlug: slug, email, fullName: 'Owner', password })
      .expect(201);
    return res.body.accessToken as string;
  };
  const oneLineDto = (overrides: Record<string, unknown> = {}) => ({
    customerId,
    lines: [{ chargeTypeId: storageChargeTypeId, description: 'Storage', basis: 'lumpsum', rate: 100 }],
    ...overrides,
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    owner = await signup(`quo-a-${suffix}`, `owner-a-${suffix}@test.local`);
    otherOwner = await signup(`quo-b-${suffix}`, `owner-b-${suffix}@test.local`);

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
    await api()
      .post(`/customers/${customerId}/addresses`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ kind: 'billing', addressLine1: '123 Main St', city: 'Gurgaon', isDefault: true })
      .expect(201);
    await api()
      .post(`/customers/${customerId}/contacts`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ name: 'Rakesh', mobile: '9876543210', isPrimary: true })
      .expect(201);

    const chargeTypes = await api().get('/charge-types').set('Authorization', `Bearer ${owner}`).expect(200);
    storageChargeTypeId = chargeTypes.body.find((c: { code: string }) => c.code === 'STORAGE').id;
    const taxRates = await api().get('/tax-rates').set('Authorization', `Bearer ${owner}`).expect(200);
    gst18Id = taxRates.body.find((t: { code: string }) => t.code === 'GST18').id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a quotation with an allocated QT number, a frozen customer snapshot, and computed totals', async () => {
    const res = await api()
      .post('/quotations')
      .set('Authorization', `Bearer ${owner}`)
      .send({
        customerId,
        validUntil: '2026-12-31',
        lines: [
          {
            chargeTypeId: storageChargeTypeId,
            description: 'Storage per unit per day',
            basis: 'unit_day',
            quantity: 100,
            rate: 2,
            taxRateId: gst18Id,
          },
          { chargeTypeId: storageChargeTypeId, description: 'Handling flat', basis: 'lumpsum', rate: 500 },
        ],
      })
      .expect(201);

    expect(res.body.number).toBe('QT/26-27/000001');
    expect(res.body.status).toBe('draft');
    expect(res.body.customerSnapshot).toMatchObject({
      name: 'Acme Co',
      billingAddress: { addressLine1: '123 Main St', city: 'Gurgaon' },
      contact: { name: 'Rakesh', mobile: '9876543210' },
    });
    // 100 x 2 = 200 (taxed at 18% -> 36) + a flat 500 lumpsum line (untaxed).
    expect(res.body.subtotal).toBe(700);
    expect(res.body.taxTotal).toBe(36);
    expect(res.body.grandTotal).toBe(736);
    expect(res.body.lines).toHaveLength(2);

    const second = await api()
      .post('/quotations')
      .set('Authorization', `Bearer ${owner}`)
      .send(oneLineDto())
      .expect(201);
    expect(second.body.number).toBe('QT/26-27/000002');
  });

  it('rejects an empty line array, and validates charge-type/customer references', async () => {
    await api()
      .post('/quotations')
      .set('Authorization', `Bearer ${owner}`)
      .send({ customerId, lines: [] })
      .expect(400);
    await api()
      .post('/quotations')
      .set('Authorization', `Bearer ${owner}`)
      .send(oneLineDto({ customerId: randomUUID() }))
      .expect(404);
    await api()
      .post('/quotations')
      .set('Authorization', `Bearer ${owner}`)
      .send({ customerId, lines: [{ chargeTypeId: randomUUID(), description: 'Storage', basis: 'lumpsum', rate: 1 }] })
      .expect(404);
  });

  it('walks the full workflow: draft -> sent -> accepted, with each invalid transition rejected', async () => {
    const created = await api().post('/quotations').set('Authorization', `Bearer ${owner}`).send(oneLineDto()).expect(201);
    const id = created.body.id;

    // Can't skip straight to accept/reject from draft.
    await api().post(`/quotations/${id}/accept`).set('Authorization', `Bearer ${owner}`).expect(400);
    await api().post(`/quotations/${id}/reject`).set('Authorization', `Bearer ${owner}`).send({ reason: 'no' }).expect(400);

    const edited = await api()
      .patch(`/quotations/${id}`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ notes: 'first draft edit' })
      .expect(200);
    expect(edited.body.notes).toBe('first draft edit');

    const sent = await api().post(`/quotations/${id}/send`).set('Authorization', `Bearer ${owner}`).expect(201);
    expect(sent.body.status).toBe('sent');
    expect(sent.body.sentAt).not.toBeNull();

    // Once sent, it's no longer editable, and can't be sent twice.
    await api().patch(`/quotations/${id}`).set('Authorization', `Bearer ${owner}`).send({ notes: 'nope' }).expect(400);
    await api().post(`/quotations/${id}/send`).set('Authorization', `Bearer ${owner}`).expect(400);

    const accepted = await api().post(`/quotations/${id}/accept`).set('Authorization', `Bearer ${owner}`).expect(201);
    expect(accepted.body.status).toBe('accepted');
    expect(accepted.body.acceptedAt).not.toBeNull();

    // A terminal state can't be cancelled.
    await api().post(`/quotations/${id}/cancel`).set('Authorization', `Bearer ${owner}`).expect(400);
  });

  it('rejects a sent quotation with a required reason, and cancels a draft', async () => {
    const created = await api().post('/quotations').set('Authorization', `Bearer ${owner}`).send(oneLineDto()).expect(201);
    await api().post(`/quotations/${created.body.id}/send`).set('Authorization', `Bearer ${owner}`).expect(201);

    await api().post(`/quotations/${created.body.id}/reject`).set('Authorization', `Bearer ${owner}`).send({}).expect(400);
    const rejected = await api()
      .post(`/quotations/${created.body.id}/reject`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ reason: 'Price too high' })
      .expect(201);
    expect(rejected.body.status).toBe('rejected');
    expect(rejected.body.rejectionReason).toBe('Price too high');

    const draft = await api().post('/quotations').set('Authorization', `Bearer ${owner}`).send(oneLineDto()).expect(201);
    const cancelled = await api().post(`/quotations/${draft.body.id}/cancel`).set('Authorization', `Bearer ${owner}`).expect(201);
    expect(cancelled.body.status).toBe('cancelled');
  });

  it('filters by status, and search by number', async () => {
    const list = await api().get('/quotations?status=rejected').set('Authorization', `Bearer ${owner}`).expect(200);
    expect(list.body.total).toBeGreaterThan(0);
    expect(list.body.items.every((q: { status: string }) => q.status === 'rejected')).toBe(true);
    // List items omit the (potentially large) line-item detail.
    expect(list.body.items[0].lines).toBeUndefined();

    const byNumber = await api()
      .get('/quotations?q=QT/26-27/000001')
      .set('Authorization', `Bearer ${owner}`)
      .expect(200);
    expect(byNumber.body.items.map((q: { number: string }) => q.number)).toEqual(['QT/26-27/000001']);
  });

  it("tenant B cannot see tenant A's quotations, and gets its own independent QT0001", async () => {
    const created = await api().post('/quotations').set('Authorization', `Bearer ${owner}`).send(oneLineDto()).expect(201);

    await api().get(`/quotations/${created.body.id}`).set('Authorization', `Bearer ${otherOwner}`).expect(404);

    const otherCustomer = await api()
      .post('/customers')
      .set('Authorization', `Bearer ${otherOwner}`)
      .send({ name: 'Beta Co' })
      .expect(201);
    const otherChargeTypes = await api().get('/charge-types').set('Authorization', `Bearer ${otherOwner}`).expect(200);
    const otherStorage = otherChargeTypes.body.find((c: { code: string }) => c.code === 'STORAGE').id;

    const otherQuotation = await api()
      .post('/quotations')
      .set('Authorization', `Bearer ${otherOwner}`)
      .send({
        customerId: otherCustomer.body.id,
        lines: [{ chargeTypeId: otherStorage, description: 'Storage', basis: 'lumpsum', rate: 1 }],
      })
      .expect(201);
    expect(otherQuotation.body.number).toBe('QT/26-27/000001');
  });

  it('a Warehouse Operator cannot view or create quotations -- Owner/Admin only per permissions-matrix.md', async () => {
    await api().get('/quotations').set('Authorization', `Bearer ${operator}`).expect(403);
    const denied = await api()
      .post('/quotations')
      .set('Authorization', `Bearer ${operator}`)
      .send(oneLineDto())
      .expect(403);
    expect(denied.body.message).toMatch(/create_quotation/);
  });

  it('rejects unauthenticated access', async () => {
    await api().get('/quotations').expect(401);
  });
});
