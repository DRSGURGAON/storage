import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../app.module';

/**
 * Blueprint §15: the warehousing/storage service agreement, Phase 3's
 * second slice. Covers the record, the quotation pre-fill ("After
 * acceptance provide Create Agreement"), server-side clause placeholder
 * resolution against the seeded system template, and the full
 * Draft -> Pending Approval -> Approved -> Active (signed) workflow with
 * approve_agreement's Owner-only restriction. PDF rendering/QR
 * verification remain a separate, later increment (dev-phases.md).
 */
describe('Agreements', () => {
  let app: INestApplication;
  const suffix = randomUUID().slice(0, 8);
  const password = 'correcthorsebattery';
  let owner = '';
  let admin = '';
  let otherOwner = '';
  let operator = '';
  let customerId = '';
  let warehouseId = '';

  const api = () => request(app.getHttpServer());
  const signup = async (slug: string, email: string) => {
    const res = await api()
      .post('/auth/signup')
      .send({ companyLegalName: `${slug} Pvt Ltd`, tenantSlug: slug, email, fullName: 'Owner', password })
      .expect(201);
    return res.body.accessToken as string;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    owner = await signup(`agr-a-${suffix}`, `owner-a-${suffix}@test.local`);
    otherOwner = await signup(`agr-b-${suffix}`, `owner-b-${suffix}@test.local`);

    const adminEmail = `admin-${suffix}@test.local`;
    await api()
      .post('/users')
      .set('Authorization', `Bearer ${owner}`)
      .send({ email: adminEmail, fullName: 'Admin', password, roleCode: 'admin' })
      .expect(201);
    admin = (await api().post('/auth/login').send({ email: adminEmail, password }).expect(201)).body.accessToken;

    const opEmail = `op-${suffix}@test.local`;
    await api()
      .post('/users')
      .set('Authorization', `Bearer ${owner}`)
      .send({ email: opEmail, fullName: 'Op', password, roleCode: 'warehouse_operator' })
      .expect(201);
    operator = (await api().post('/auth/login').send({ email: opEmail, password }).expect(201)).body.accessToken;

    customerId = (
      await api()
        .post('/customers')
        .set('Authorization', `Bearer ${owner}`)
        .send({ name: 'Acme Co', gstin: '06AAACA1234A1Z5' })
        .expect(201)
    ).body.id;
    warehouseId = (
      await api()
        .post('/warehouses')
        .set('Authorization', `Bearer ${owner}`)
        .send({ code: 'WH01', name: 'Main Godown', capacityValue: 500, capacityUom: 'pallet' })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  const createAndAcceptQuotation = async () => {
    const chargeTypes = await api().get('/charge-types').set('Authorization', `Bearer ${owner}`).expect(200);
    const storageId = chargeTypes.body.find((c: { code: string }) => c.code === 'STORAGE').id;
    const quotation = await api()
      .post('/quotations')
      .set('Authorization', `Bearer ${owner}`)
      .send({ customerId, lines: [{ chargeTypeId: storageId, description: 'Storage', basis: 'lumpsum', rate: 100 }] })
      .expect(201);
    await api().post(`/quotations/${quotation.body.id}/send`).set('Authorization', `Bearer ${owner}`).expect(201);
    await api().post(`/quotations/${quotation.body.id}/accept`).set('Authorization', `Bearer ${owner}`).expect(201);
    return quotation.body.id;
  };

  it('lists the seeded system default agreement template', async () => {
    const res = await api().get('/agreements/templates').set('Authorization', `Bearer ${owner}`).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Standard Warehousing Agreement');
    expect(res.body[0].isSystem).toBe(true);
    expect(res.body[0].clauses.length).toBeGreaterThan(0);
  });

  it('creates an agreement pre-filled from an accepted quotation, with placeholder-resolved clauses', async () => {
    const quotationId = await createAndAcceptQuotation();

    const res = await api()
      .post('/agreements')
      .set('Authorization', `Bearer ${owner}`)
      .send({
        quotationId,
        warehouseId,
        startDate: '2026-01-01',
        endDate: '2027-01-01',
        noticePeriodDays: 30,
        wizardData: { parties: { note: 'ok' } },
      })
      .expect(201);

    expect(res.body.number).toBe('AG/26-27/000001');
    expect(res.body.customerId).toBe(customerId);
    expect(res.body.quotationId).toBe(quotationId);
    expect(res.body.status).toBe('draft');
    expect(Array.isArray(res.body.renderedClauses)).toBe(true);

    const partiesClause = res.body.renderedClauses.find((c: { id: string }) => c.id === 'parties');
    expect(partiesClause.body).toContain('Acme Co');
    expect(partiesClause.body).toContain('06AAACA1234A1Z5');
    const warehouseClause = res.body.renderedClauses.find((c: { id: string }) => c.id === 'warehouse_services');
    expect(warehouseClause.body).toContain('Main Godown');
    expect(warehouseClause.body).toContain('WH01');
    const terminationClause = res.body.renderedClauses.find((c: { id: string }) => c.id === 'termination');
    expect(terminationClause.body).toContain('30 days');
  });

  it('refuses to create an agreement from a quotation that is not accepted', async () => {
    const chargeTypes = await api().get('/charge-types').set('Authorization', `Bearer ${owner}`).expect(200);
    const storageId = chargeTypes.body.find((c: { code: string }) => c.code === 'STORAGE').id;
    const draftQuotation = await api()
      .post('/quotations')
      .set('Authorization', `Bearer ${owner}`)
      .send({ customerId, lines: [{ chargeTypeId: storageId, description: 'Storage', basis: 'lumpsum', rate: 100 }] })
      .expect(201);

    await api()
      .post('/agreements')
      .set('Authorization', `Bearer ${owner}`)
      .send({ quotationId: draftQuotation.body.id, startDate: '2026-01-01' })
      .expect(400);
  });

  it('requires a customerId directly or via an accepted quotation', async () => {
    await api()
      .post('/agreements')
      .set('Authorization', `Bearer ${owner}`)
      .send({ startDate: '2026-01-01' })
      .expect(400);
  });

  it('walks the full workflow: draft -> pending_approval -> approved -> active, with skip-ahead rejected', async () => {
    const created = await api()
      .post('/agreements')
      .set('Authorization', `Bearer ${owner}`)
      .send({ customerId, startDate: '2026-01-01' })
      .expect(201);
    const id = created.body.id;

    await api().post(`/agreements/${id}/sign`).set('Authorization', `Bearer ${owner}`).expect(400);

    const edited = await api()
      .patch(`/agreements/${id}`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ noticePeriodDays: 45 })
      .expect(200);
    expect(edited.body.noticePeriodDays).toBe(45);

    const submitted = await api().post(`/agreements/${id}/submit`).set('Authorization', `Bearer ${owner}`).expect(201);
    expect(submitted.body.status).toBe('pending_approval');

    // Once submitted, no longer editable.
    await api().patch(`/agreements/${id}`).set('Authorization', `Bearer ${owner}`).send({ noticePeriodDays: 1 }).expect(400);

    const approved = await api().post(`/agreements/${id}/approve`).set('Authorization', `Bearer ${owner}`).expect(201);
    expect(approved.body.status).toBe('approved');
    expect(approved.body.approvedAt).not.toBeNull();

    const signed = await api().post(`/agreements/${id}/sign`).set('Authorization', `Bearer ${owner}`).expect(201);
    expect(signed.body.status).toBe('active');
    expect(signed.body.signedAt).not.toBeNull();
  });

  it('approve_agreement is Owner-only -- an Admin gets 403 even though Admin has edit_agreement', async () => {
    const created = await api()
      .post('/agreements')
      .set('Authorization', `Bearer ${owner}`)
      .send({ customerId, startDate: '2026-01-01' })
      .expect(201);
    await api().post(`/agreements/${created.body.id}/submit`).set('Authorization', `Bearer ${owner}`).expect(201);

    const denied = await api()
      .post(`/agreements/${created.body.id}/approve`)
      .set('Authorization', `Bearer ${admin}`)
      .expect(403);
    expect(denied.body.message).toMatch(/approve_agreement/);

    const approved = await api()
      .post(`/agreements/${created.body.id}/approve`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(201);
    expect(approved.body.status).toBe('approved');
  });

  it('terminates a signed agreement with a required reason', async () => {
    const created = await api()
      .post('/agreements')
      .set('Authorization', `Bearer ${owner}`)
      .send({ customerId, startDate: '2026-01-01' })
      .expect(201);
    const id = created.body.id;
    await api().post(`/agreements/${id}/submit`).set('Authorization', `Bearer ${owner}`).expect(201);
    await api().post(`/agreements/${id}/approve`).set('Authorization', `Bearer ${owner}`).expect(201);
    await api().post(`/agreements/${id}/sign`).set('Authorization', `Bearer ${owner}`).expect(201);

    await api().post(`/agreements/${id}/terminate`).set('Authorization', `Bearer ${owner}`).send({}).expect(400);
    const terminated = await api()
      .post(`/agreements/${id}/terminate`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ reason: 'Customer closed account' })
      .expect(201);
    expect(terminated.body.status).toBe('terminated');
    expect(terminated.body.terminationReason).toBe('Customer closed account');
  });

  it("tenant B cannot see tenant A's agreements, and gets its own independent AG number", async () => {
    const created = await api()
      .post('/agreements')
      .set('Authorization', `Bearer ${owner}`)
      .send({ customerId, startDate: '2026-01-01' })
      .expect(201);

    await api().get(`/agreements/${created.body.id}`).set('Authorization', `Bearer ${otherOwner}`).expect(404);

    const otherCustomer = await api()
      .post('/customers')
      .set('Authorization', `Bearer ${otherOwner}`)
      .send({ name: 'Beta Co' })
      .expect(201);
    const otherAgreement = await api()
      .post('/agreements')
      .set('Authorization', `Bearer ${otherOwner}`)
      .send({ customerId: otherCustomer.body.id, startDate: '2026-01-01' })
      .expect(201);
    expect(otherAgreement.body.number).toBe('AG/26-27/000001');
  });

  it('a Warehouse Manager can view but not create agreements; a Warehouse Operator cannot even view', async () => {
    const mgrEmail = `mgr-${suffix}@test.local`;
    await api()
      .post('/users')
      .set('Authorization', `Bearer ${owner}`)
      .send({ email: mgrEmail, fullName: 'Manager', password, roleCode: 'warehouse_manager' })
      .expect(201);
    const mgrToken = (await api().post('/auth/login').send({ email: mgrEmail, password }).expect(201)).body
      .accessToken;

    await api().get('/agreements').set('Authorization', `Bearer ${mgrToken}`).expect(200);
    const denied = await api()
      .post('/agreements')
      .set('Authorization', `Bearer ${mgrToken}`)
      .send({ customerId, startDate: '2026-01-01' })
      .expect(403);
    expect(denied.body.message).toMatch(/create_agreement/);

    await api().get('/agreements').set('Authorization', `Bearer ${operator}`).expect(403);
  });

  it('rejects unauthenticated access', async () => {
    await api().get('/agreements').expect(401);
  });
});
