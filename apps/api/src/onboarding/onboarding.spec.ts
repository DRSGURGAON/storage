import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../app.module';

/**
 * ux-system.md §1: onboarding progress derived live from each entity
 * type's row count, not a stored flag -- so this proves the status tracks
 * real writes made through the ordinary master endpoints, step by step,
 * ending in a fully-complete tenant.
 */
describe('Onboarding status', () => {
  let app: INestApplication;
  const suffix = randomUUID().slice(0, 8);
  const password = 'correcthorsebattery';

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
  });

  afterAll(async () => {
    await app.close();
  });

  it('walks a fresh tenant from company-only through every step to isComplete, in order', async () => {
    const token = await signup(`onb-${suffix}`, `owner-${suffix}@test.local`);

    const fresh = await api().get('/onboarding/status').set('Authorization', `Bearer ${token}`).expect(200);
    expect(fresh.body).toEqual({
      steps: {
        company: { done: true, count: 1 },
        warehouse: { done: false, count: 0 },
        customer: { done: false, count: 0 },
        products: { done: false, count: 0 },
        rateCard: { done: false, count: 0 },
      },
      isComplete: false,
      nextStep: 'warehouse',
    });

    await api()
      .post('/warehouses')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'WH01', name: 'Main Godown', capacityValue: 500, capacityUom: 'pallet' })
      .expect(201);
    let status = await api().get('/onboarding/status').set('Authorization', `Bearer ${token}`).expect(200);
    expect(status.body.steps.warehouse).toEqual({ done: true, count: 1 });
    expect(status.body.nextStep).toBe('customer');

    await api().post('/customers').set('Authorization', `Bearer ${token}`).send({ name: 'Acme Co' }).expect(201);
    status = await api().get('/onboarding/status').set('Authorization', `Bearer ${token}`).expect(200);
    expect(status.body.steps.customer).toEqual({ done: true, count: 1 });
    expect(status.body.nextStep).toBe('products');

    await api()
      .post('/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ sku: 'SKU1', name: 'Widget', uomCode: 'NOS' })
      .expect(201);
    status = await api().get('/onboarding/status').set('Authorization', `Bearer ${token}`).expect(200);
    expect(status.body.steps.products).toEqual({ done: true, count: 1 });
    expect(status.body.nextStep).toBe('rateCard');

    const card = await api()
      .post('/rate-cards')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'DEFAULT', name: 'Company Default', scope: 'company', validFrom: '2025-01-01' })
      .expect(201);

    // A rate card with no priced line is not enough -- "creates one rate_cards
    // + rate_card_lines set" (ux-system.md §1) means both, not just the card.
    status = await api().get('/onboarding/status').set('Authorization', `Bearer ${token}`).expect(200);
    expect(status.body.steps.rateCard).toEqual({ done: false, count: 0 });
    expect(status.body.isComplete).toBe(false);

    const chargeTypes = await api().get('/charge-types').set('Authorization', `Bearer ${token}`).expect(200);
    const storageId = chargeTypes.body.find((c: { code: string }) => c.code === 'STORAGE').id;
    await api()
      .post(`/rate-cards/${card.body.id}/lines`)
      .set('Authorization', `Bearer ${token}`)
      .send({ chargeTypeId: storageId, basis: 'unit_day', rate: 5 })
      .expect(201);

    const complete = await api().get('/onboarding/status').set('Authorization', `Bearer ${token}`).expect(200);
    expect(complete.body.steps.rateCard).toEqual({ done: true, count: 1 });
    expect(complete.body.isComplete).toBe(true);
    expect(complete.body.nextStep).toBe('ready');
  });

  it("a brand new tenant is unaffected by another tenant's progress", async () => {
    // The first test above already drove tenant A to full completion.
    const freshToken = await signup(`onb-fresh-${suffix}`, `owner-fresh-${suffix}@test.local`);
    const status = await api().get('/onboarding/status').set('Authorization', `Bearer ${freshToken}`).expect(200);
    expect(status.body.isComplete).toBe(false);
    expect(status.body.nextStep).toBe('warehouse');
    expect(status.body.steps.warehouse.count).toBe(0);
  });

  it('rejects unauthenticated access', async () => {
    await api().get('/onboarding/status').expect(401);
  });
});
