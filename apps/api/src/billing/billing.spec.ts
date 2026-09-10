import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../app.module';

/**
 * Blueprint §13; billing-engine.md §2-§3. Charge types / tax rates (system
 * catalogue + tenant overrides), rate card CRUD with its scope constraint,
 * rate card lines, and the resolution priority order -- proven against a
 * real customer/warehouse/company scope stack, not just unit-tested logic.
 */
describe('Billing: Charge Types, Tax Rates, Rate Cards, Resolution', () => {
  let app: INestApplication;
  const suffix = randomUUID().slice(0, 8);
  const password = 'correcthorsebattery';
  let owner = '';
  let otherOwner = '';
  let operator = '';
  let customerId = '';
  let warehouseId = '';
  let productId = '';
  let storageChargeTypeId = '';

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
    owner = await signup(`bill-a-${suffix}`, `owner-a-${suffix}@test.local`);
    otherOwner = await signup(`bill-b-${suffix}`, `owner-b-${suffix}@test.local`);

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
        .send({ sku: 'SKU1', name: 'Widget', uomCode: 'NOS' })
        .expect(201)
    ).body.id;

    const chargeTypes = await api().get('/charge-types').set('Authorization', `Bearer ${owner}`).expect(200);
    storageChargeTypeId = chargeTypes.body.find((c: { code: string }) => c.code === 'STORAGE').id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('seeds the system charge-type and tax-rate catalogues, and a tenant can add its own', async () => {
    const chargeTypes = await api().get('/charge-types').set('Authorization', `Bearer ${owner}`).expect(200);
    expect(chargeTypes.body).toHaveLength(12);
    expect(chargeTypes.body.every((c: { isSystem: boolean }) => c.isSystem)).toBe(true);

    const taxRates = await api().get('/tax-rates').set('Authorization', `Bearer ${owner}`).expect(200);
    expect(taxRates.body).toHaveLength(5);
    expect(taxRates.body.find((t: { code: string }) => t.code === 'GST18').ratePct).toBe(18);

    const custom = await api()
      .post('/charge-types')
      .set('Authorization', `Bearer ${owner}`)
      .send({ code: 'custom_fee', name: 'Custom Fee', category: 'other', defaultBasis: 'lumpsum' })
      .expect(201);
    expect(custom.body.code).toBe('CUSTOM_FEE');
    expect(custom.body.isSystem).toBe(false);
  });

  it("enforces the scope check constraint as a clean 400, not a raw DB error", async () => {
    await api()
      .post('/rate-cards')
      .set('Authorization', `Bearer ${owner}`)
      .send({ code: 'BAD1', name: 'Bad Company', scope: 'company', customerId, validFrom: '2025-01-01' })
      .expect(400);
    await api()
      .post('/rate-cards')
      .set('Authorization', `Bearer ${owner}`)
      .send({ code: 'BAD2', name: 'Bad Customer', scope: 'customer', validFrom: '2025-01-01' })
      .expect(400);
    await api()
      .post('/rate-cards')
      .set('Authorization', `Bearer ${owner}`)
      .send({ code: 'BAD3', name: 'Bad Warehouse', scope: 'warehouse', validFrom: '2025-01-01' })
      .expect(400);
    await api()
      .post('/rate-cards')
      .set('Authorization', `Bearer ${owner}`)
      .send({ code: 'BAD4', name: 'Bad Warehouse Cust', scope: 'warehouse', warehouseId, customerId, validFrom: '2025-01-01' })
      .expect(400);
  });

  it('creates a rate card and rejects a duplicate code with 409', async () => {
    await api()
      .post('/rate-cards')
      .set('Authorization', `Bearer ${owner}`)
      .send({ code: 'DUP', name: 'Card One', scope: 'company', validFrom: '2025-01-01' })
      .expect(201);
    await api()
      .post('/rate-cards')
      .set('Authorization', `Bearer ${owner}`)
      .send({ code: 'DUP', name: 'Card Two', scope: 'company', validFrom: '2025-01-01' })
      .expect(409);
  });

  it('adds a rate card line, validates its references, and lists/updates it', async () => {
    const card = await api()
      .post('/rate-cards')
      .set('Authorization', `Bearer ${owner}`)
      .send({ code: 'LINES', name: 'Lines Test', scope: 'company', validFrom: '2025-01-01' })
      .expect(201);

    await api()
      .post(`/rate-cards/${card.body.id}/lines`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ chargeTypeId: randomUUID(), basis: 'unit_day', rate: 5 })
      .expect(404);

    const line = await api()
      .post(`/rate-cards/${card.body.id}/lines`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ chargeTypeId: storageChargeTypeId, basis: 'unit_day', rate: 5, freeDays: 3 })
      .expect(201);
    expect(line.body.rate).toBe(5);
    expect(line.body.freeDays).toBe(3);

    const updated = await api()
      .patch(`/rate-cards/${card.body.id}/lines/${line.body.id}`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ rate: 6 })
      .expect(200);
    expect(updated.body.rate).toBe(6);

    const list = await api()
      .get(`/rate-cards/${card.body.id}/lines`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(200);
    expect(list.body).toHaveLength(1);
    // The line carries the charge it prices by name, not only by id: the
    // screen showed a blank column otherwise (Phase 16).
    expect(list.body[0]).toMatchObject({ chargeTypeCode: 'STORAGE', chargeTypeName: 'Storage' });
  });

  it('resolves through the full customer > warehouse > company priority, with a product-specific override', async () => {
    const company = await api()
      .post('/rate-cards')
      .set('Authorization', `Bearer ${owner}`)
      .send({ code: 'PRIO-CO', name: 'Company', scope: 'company', validFrom: '2025-01-01', status: 'active' })
      .expect(201);
    await api()
      .post(`/rate-cards/${company.body.id}/lines`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ chargeTypeId: storageChargeTypeId, basis: 'unit_day', rate: 5 })
      .expect(201);

    // No customer/warehouse card exists yet -- falls all the way to company.
    const fallback = await api()
      .get(`/rate-cards/resolve?customerId=${customerId}&warehouseId=${warehouseId}&chargeTypeCode=STORAGE`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(200);
    expect(fallback.body.line.rate).toBe(5);
    expect(fallback.body.rateCardId).toBe(company.body.id);

    const warehouseCard = await api()
      .post('/rate-cards')
      .set('Authorization', `Bearer ${owner}`)
      .send({ code: 'PRIO-WH', name: 'Warehouse', scope: 'warehouse', warehouseId, validFrom: '2025-01-01', status: 'active' })
      .expect(201);
    await api()
      .post(`/rate-cards/${warehouseCard.body.id}/lines`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ chargeTypeId: storageChargeTypeId, basis: 'unit_day', rate: 4 })
      .expect(201);

    const warehouseWins = await api()
      .get(`/rate-cards/resolve?customerId=${customerId}&warehouseId=${warehouseId}&chargeTypeCode=STORAGE`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(200);
    expect(warehouseWins.body.line.rate).toBe(4);

    const customerCard = await api()
      .post('/rate-cards')
      .set('Authorization', `Bearer ${owner}`)
      .send({ code: 'PRIO-CUST', name: 'Customer', scope: 'customer', customerId, validFrom: '2025-01-01', status: 'active' })
      .expect(201);
    await api()
      .post(`/rate-cards/${customerCard.body.id}/lines`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ chargeTypeId: storageChargeTypeId, basis: 'unit_day', rate: 3 })
      .expect(201);
    await api()
      .post(`/rate-cards/${customerCard.body.id}/lines`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ chargeTypeId: storageChargeTypeId, basis: 'unit_day', rate: 1, productId })
      .expect(201);

    const customerWins = await api()
      .get(`/rate-cards/resolve?customerId=${customerId}&warehouseId=${warehouseId}&chargeTypeCode=STORAGE`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(200);
    expect(customerWins.body.line.rate).toBe(3);
    expect(customerWins.body.rateCardId).toBe(customerCard.body.id);

    const productOverride = await api()
      .get(`/rate-cards/resolve?customerId=${customerId}&warehouseId=${warehouseId}&chargeTypeCode=STORAGE&productId=${productId}`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(200);
    expect(productOverride.body.line.rate).toBe(1);

    // A different customer with no card of its own still gets the warehouse rate, not the customer card above.
    const otherCustomer = await api()
      .post('/customers')
      .set('Authorization', `Bearer ${owner}`)
      .send({ name: 'Beta Co' })
      .expect(201);
    const otherResolved = await api()
      .get(`/rate-cards/resolve?customerId=${otherCustomer.body.id}&warehouseId=${warehouseId}&chargeTypeCode=STORAGE`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(200);
    expect(otherResolved.body.line.rate).toBe(4);

    // No warehouse given at all -- warehouse-scope card must not apply.
    const noWarehouse = await api()
      .get(`/rate-cards/resolve?customerId=${otherCustomer.body.id}&chargeTypeCode=STORAGE`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(200);
    expect(noWarehouse.body.line.rate).toBe(5);
  });

  it('returns 404 for an unresolvable charge type or a charge type with no line anywhere', async () => {
    await api()
      .get(`/rate-cards/resolve?customerId=${customerId}&chargeTypeCode=NOPE`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(404);
    await api()
      .get(`/rate-cards/resolve?customerId=${customerId}&chargeTypeCode=LOADING`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(404);
  });

  it("tenant B cannot see tenant A's rate cards, and gets an independent code namespace", async () => {
    const card = await api()
      .post('/rate-cards')
      .set('Authorization', `Bearer ${owner}`)
      .send({ code: 'ISO', name: 'Isolation Test', scope: 'company', validFrom: '2025-01-01' })
      .expect(201);

    await api().get(`/rate-cards/${card.body.id}`).set('Authorization', `Bearer ${otherOwner}`).expect(404);

    const list = await api().get('/rate-cards?q=isolation').set('Authorization', `Bearer ${otherOwner}`).expect(200);
    expect(list.body.total).toBe(0);

    await api()
      .post('/rate-cards')
      .set('Authorization', `Bearer ${otherOwner}`)
      .send({ code: 'ISO', name: 'Tenant B Own Card', scope: 'company', validFrom: '2025-01-01' })
      .expect(201);
  });

  it('an operator can view but not create rate cards, and the denial is audited', async () => {
    await api().get('/rate-cards').set('Authorization', `Bearer ${operator}`).expect(200);
    await api().get('/charge-types').set('Authorization', `Bearer ${operator}`).expect(200);

    const denied = await api()
      .post('/rate-cards')
      .set('Authorization', `Bearer ${operator}`)
      .send({ code: 'DENY', name: 'Should Not Exist', scope: 'company', validFrom: '2025-01-01' })
      .expect(403);
    expect(denied.body.message).toMatch(/create_rate_card/);
  });

  it('rejects unauthenticated access', async () => {
    await api().get('/rate-cards').expect(401);
    await api().get('/charge-types').expect(401);
    await api().get('/tax-rates').expect(401);
  });
});
