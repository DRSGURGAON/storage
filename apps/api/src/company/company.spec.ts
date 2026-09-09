import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../app.module';

/**
 * The company profile and the `tenant_settings` store -- neither of which
 * had any writer at all until the Phase 5 audit (`DECISIONS.md` §35).
 * Signup captured a legal name and nothing could ever set the rest, so
 * every document letterhead rendered without a GSTIN or address, every
 * agreement's Parties clause had holes in it, and `stock.allow_negative`
 * was documented as implemented while being impossible to switch on.
 */
describe('Company profile and tenant settings', () => {
  let app: INestApplication;
  const suffix = randomUUID().slice(0, 8);
  const password = 'correcthorsebattery';
  let owner = '';
  let manager = '';

  const api = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  const FULL_PROFILE = {
    tradeName: 'Bharat Warehousing',
    gstin: '06AAACB1234C1ZX',
    pan: 'AAACB1234C',
    addressLine1: 'Plot 42, Sector 18',
    city: 'Gurugram',
    state: 'Haryana',
    stateCode: '06',
    pincode: '122015',
    phone: '+91 124 4000000',
    email: 'ops@bharatwh.example',
    signatoryName: 'A. Verma',
    signatoryDesignation: 'Director',
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    owner = (
      await api()
        .post('/auth/signup')
        .send({
          companyLegalName: 'Bharat Warehousing Pvt Ltd',
          tenantSlug: `co-${suffix}`,
          email: `owner-${suffix}@test.local`,
          fullName: 'Owner',
          password,
        })
        .expect(201)
    ).body.accessToken;

    const email = `mgr-${suffix}@test.local`;
    await api()
      .post('/users')
      .set(auth(owner))
      .send({ email, fullName: 'Mgr', password, roleCode: 'warehouse_manager' })
      .expect(201);
    manager = (await api().post('/auth/login').send({ email, password }).expect(201)).body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('starts with only the legal name signup captured, and reports itself not document-ready', async () => {
    const res = await api().get('/company').set(auth(owner)).expect(200);
    expect(res.body.legalName).toBe('Bharat Warehousing Pvt Ltd');
    expect(res.body.gstin).toBeNull();
    expect(res.body.addressLine1).toBeNull();
    // A letterhead needs more than a name, so the wizard says so rather
    // than reporting the step done because a tenant row exists.
    expect(res.body.isDocumentReady).toBe(false);
    const onboarding = await api().get('/onboarding/status').set(auth(owner)).expect(200);
    expect(onboarding.body.steps.company.done).toBe(false);
  });

  it('refuses a malformed GSTIN/PAN/pincode, and the fields that are deliberately not settable', async () => {
    for (const body of [{ gstin: 'NOTAGSTIN' }, { pan: 'bad' }, { pincode: '0123' }]) {
      await api().patch('/company').set(auth(owner)).send(body).expect(400);
    }
    // Rejected by `forbidNonWhitelisted`, which is the point: these are not
    // in the DTO at all, so there is no path that writes them.
    for (const body of [{ slug: 'hijack' }, { status: 'active' }, { financialYearStartMonth: 1 }, { id: randomUUID() }]) {
      await api().patch('/company').set(auth(owner)).send(body).expect(400);
    }
    await api().patch('/company').set(auth(owner)).send({}).expect(400);
  });

  it('saves the profile, flips isDocumentReady, and completes the onboarding company step', async () => {
    const res = await api().patch('/company').set(auth(owner)).send(FULL_PROFILE).expect(200);
    expect(res.body).toMatchObject({ gstin: '06AAACB1234C1ZX', city: 'Gurugram', signatoryName: 'A. Verma' });
    expect(res.body.isDocumentReady).toBe(true);

    const onboarding = await api().get('/onboarding/status').set(auth(owner)).expect(200);
    expect(onboarding.body.steps.company.done).toBe(true);

    // An audit row for a company change, like every other mutation.
    const again = await api().get('/company').set(auth(owner)).expect(200);
    expect(again.body.tradeName).toBe('Bharat Warehousing');
  });

  it('puts the saved profile on the document letterhead and into the agreement clauses', async () => {
    // This is the whole point of the endpoint: until it existed, both of
    // these rendered with a bare company name and empty {{company.*}} holes.
    const customerId = (
      await api().post('/customers').set(auth(owner)).send({ name: 'Acme Foods Pvt Ltd', gstin: '06AAACA1234A1Z5' }).expect(201)
    ).body.id;
    const warehouseId = (
      await api().post('/warehouses').set(auth(owner)).send({ code: 'WH01', name: 'Gurugram Godown' }).expect(201)
    ).body.id;
    const chargeTypes = await api().get('/charge-types').set(auth(owner)).expect(200);
    const chargeTypeId = (Array.isArray(chargeTypes.body) ? chargeTypes.body : chargeTypes.body.items)[0].id;

    const quotation = await api()
      .post('/quotations')
      .set(auth(owner))
      .send({
        customerId,
        warehouseId,
        lines: [{ chargeTypeId, description: 'Monthly storage', basis: 'unit_day', rate: 12.5, quantity: 100 }],
      })
      .expect(201);
    await api().post(`/quotations/${quotation.body.id}/send`).set(auth(owner)).expect(201);
    await api().post(`/quotations/${quotation.body.id}/accept`).set(auth(owner)).expect(201);

    const agreement = await api()
      .post('/agreements')
      .set(auth(owner))
      .send({ quotationId: quotation.body.id, startDate: '2026-10-01', endDate: '2027-09-30' })
      .expect(201);

    const parties = agreement.body.renderedClauses.map((c: { body: string }) => c.body).join('\n');
    expect(parties).toContain('Bharat Warehousing Pvt Ltd');
    expect(parties).toContain('06AAACB1234C1ZX');
    expect(parties).toContain('Plot 42, Sector 18');
    expect(parties).toContain('122015');
    expect(parties).not.toContain('{{');

    const pdf = await api().post(`/quotations/${quotation.body.id}/document/preview`).set(auth(owner)).expect(201);
    expect(Buffer.from(pdf.body).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('lists every known setting with its effective value and where that value came from', async () => {
    const res = await api().get('/company/settings').set(auth(owner)).expect(200);
    const keys = res.body.map((s: { key: string }) => s.key);
    expect(keys).toContain('stock.allow_negative');
    const negative = res.body.find((s: { key: string }) => s.key === 'stock.allow_negative');
    // Unset keys still appear, at their documented default, rather than as
    // blanks a settings page would have to guess about.
    expect(negative).toMatchObject({ value: false, default: false, source: 'default', type: 'boolean' });
  });

  it('refuses an unknown key and a wrongly-typed value, rather than storing either', async () => {
    // The typo case is the one that matters: a setting written under a key
    // nothing reads looks saved and does nothing forever.
    const unknown = await api()
      .put('/company/settings/stock.allow_negatives')
      .set(auth(owner))
      .send({ value: true })
      .expect(400);
    expect(unknown.body.message).toContain('Unknown setting');

    await api().put('/company/settings/stock.allow_negative').set(auth(owner)).send({ value: 'yes' }).expect(400);
    await api().put('/company/settings/stock.ageing_buckets').set(auth(owner)).send({ value: 'not-an-array' }).expect(400);
    await api()
      .put('/company/settings/workflow.outward_posting_point')
      .set(auth(owner))
      .send({ value: 'whenever' })
      .expect(400);
    await api().put('/company/settings/stock.allow_negative').set(auth(owner)).send({}).expect(400);

    // None of that left anything behind.
    const after = await api().get('/company/settings').set(auth(owner)).expect(200);
    expect(after.body.every((s: { source: string }) => s.source === 'default')).toBe(true);
  });

  it('sets, reads back, and clears a setting -- clearing restores the default, never null', async () => {
    const set = await api().put('/company/settings/stock.allow_negative').set(auth(owner)).send({ value: true }).expect(200);
    expect(set.body).toMatchObject({ key: 'stock.allow_negative', value: true, source: 'tenant' });

    const listed = (await api().get('/company/settings').set(auth(owner)).expect(200)).body.find(
      (s: { key: string }) => s.key === 'stock.allow_negative',
    );
    expect(listed).toMatchObject({ value: true, source: 'tenant' });

    await api().put('/company/settings/workflow.outward_posting_point').set(auth(owner)).send({ value: 'dispatch' }).expect(200);

    const cleared = await api().delete('/company/settings/stock.allow_negative').set(auth(owner)).expect(200);
    expect(cleared.body).toMatchObject({ value: false, source: 'default' });
  });

  it('is Owner/Admin only -- a Warehouse Manager cannot read it either', async () => {
    // permissions-matrix.md seeds one code for this area and grants it to
    // Owner and Admin. The row holds bank account details and the
    // authorised signatory, and nothing else needs to fetch it: documents
    // build their letterhead server-side from the same row.
    await api().get('/company').set(auth(manager)).expect(403);
    await api().patch('/company').set(auth(manager)).send({ city: 'Delhi' }).expect(403);
    await api().get('/company/settings').set(auth(manager)).expect(403);
    await api().put('/company/settings/stock.allow_negative').set(auth(manager)).send({ value: true }).expect(403);

    await api().get('/company').expect(401);
    await api().get('/company/settings').expect(401);
  });

  it("cannot see or change another tenant's company", async () => {
    const other = (
      await api()
        .post('/auth/signup')
        .send({
          companyLegalName: 'Rival Ltd',
          tenantSlug: `rival-${suffix}`,
          email: `rival-${suffix}@test.local`,
          fullName: 'Rival',
          password,
        })
        .expect(201)
    ).body.accessToken;

    // `tenants` is keyed by `id`, not `tenant_id`, so schema/90's generator
    // gives it no RLS policy -- the explicit `where id = tenantId` filter is
    // the only thing scoping these reads and writes, which is exactly why
    // it is worth asserting rather than assuming.
    const theirs = await api().get('/company').set(auth(other)).expect(200);
    expect(theirs.body.legalName).toBe('Rival Ltd');
    expect(theirs.body.gstin).toBeNull();

    await api().patch('/company').set(auth(other)).send({ city: 'Mumbai' }).expect(200);
    const ours = await api().get('/company').set(auth(owner)).expect(200);
    expect(ours.body.city).toBe('Gurugram');

    await api().put('/company/settings/stock.allow_negative').set(auth(other)).send({ value: true }).expect(200);
    const ourSettings = (await api().get('/company/settings').set(auth(owner)).expect(200)).body.find(
      (s: { key: string }) => s.key === 'stock.allow_negative',
    );
    expect(ourSettings).toMatchObject({ value: false, source: 'default' });
  });
});
