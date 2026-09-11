import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';

/**
 * The household storage subscription: priced per *customer in storage*,
 * which is the opposite dimension to the 3PL product's per-godown pricing
 * and the reason the two ladders had to be separated.
 *
 * What matters here is that the number falls again. A price that only ever
 * ratchets up would make an operator afraid to take a booking; "a month
 * with fewer customers is a cheaper month" is the whole promise, and the
 * test for it is closing a booking and finding the slot back.
 */
describe('Household storage subscription', () => {
  let app: INestApplication;
  let sql: postgres.Sql;
  const suffix = randomUUID().slice(0, 8);
  const password = 'correcthorsebattery';
  let owner = '';
  let warehouseOwner = '';
  let warehouseId = '';
  let customerId = '';
  let tenantId = '';

  const api = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  /** A booking with one item, ready to receive goods. */
  const newBooking = async () =>
    (
      await api()
        .post('/storage/bookings')
        .set(auth(owner))
        .send({
          customerId,
          warehouseId,
          monthlyRent: 3000,
          items: [{ description: 'Household goods, 20 cartons', category: 'carton', quantity: 20 }],
        })
        .expect(201)
    ).body;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    sql = app.get(PG_CONNECTION);

    // A storage workspace: signed up from the storage app, so it lands on
    // the storage ladder rather than the warehouse one.
    owner = (
      await api()
        .post('/auth/signup')
        .send({
          companyLegalName: 'Safe Hands Storage',
          tenantSlug: `st-a-${suffix}`,
          email: `owner-a-${suffix}@test.local`,
          fullName: 'Owner',
          password,
          product: 'storage',
        })
        .expect(201)
    ).body.accessToken;
    tenantId = JSON.parse(Buffer.from(owner.split('.')[1], 'base64url').toString()).tenantId;

    warehouseOwner = (
      await api()
        .post('/auth/signup')
        .send({
          companyLegalName: 'Contract Warehousing Ltd',
          tenantSlug: `st-b-${suffix}`,
          email: `owner-b-${suffix}@test.local`,
          fullName: 'Owner',
          password,
        })
        .expect(201)
    ).body.accessToken;

    warehouseId = (
      await api().post('/warehouses').set(auth(owner)).send({ code: 'WH01', name: 'Main godown' }).expect(201)
    ).body.id;
    customerId = (
      await api()
        .post('/customers')
        .set(auth(owner))
        .send({ name: 'Ramesh Kumar', customerType: 'individual', mobile: '9811100011' })
        .expect(201)
    ).body.id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('starts a storage workspace on the storage plan, not the warehouse one', async () => {
    const me = await api().get('/auth/me').set(auth(owner)).expect(200);
    expect(me.body.tenant.product).toBe('storage');

    const usage = await api().get('/plan/usage').set(auth(owner)).expect(200);
    expect(usage.body.plan).toMatchObject({ code: 'STORAGE_FREE', name: 'Free' });

    const theirs = await api().get('/auth/me').set(auth(warehouseOwner)).expect(200);
    expect(theirs.body.tenant.product).toBe('warehouse');
  });

  it('shows each product its own price list, and nobody the other one', async () => {
    const storage = await api().get('/pricing?product=storage').expect(200);
    const codes = storage.body.plans.map((p: { code: string }) => p.code);
    expect(codes).toEqual(['STORAGE_FREE', 'STORAGE_SOLO', 'STORAGE_GODOWN', 'STORAGE_NETWORK']);
    expect(codes.some((c: string) => ['STARTER', 'GROWTH', 'SCALE'].includes(c))).toBe(false);

    const solo = storage.body.plans.find((p: { code: string }) => p.code === 'STORAGE_SOLO');
    expect(solo.priceMonthly).toBe(799);
    // Ten months for twelve -- an annual price at 12x is not a discount.
    expect(solo.priceYearly).toBeLessThan(solo.priceMonthly * 12);

    // The default is still the warehouse ladder, so the existing pricing
    // page keeps working untouched.
    const warehouse = await api().get('/pricing').expect(200);
    expect(warehouse.body.plans.map((p: { code: string }) => p.code)).toEqual([
      'FREE', 'STARTER', 'GROWTH', 'SCALE',
    ]);
  });

  it('counts the third customer in, and refuses the fourth with the upgrade prompt', async () => {
    for (let i = 0; i < 3; i += 1) {
      const booking = await newBooking();
      await api().post(`/storage/bookings/${booking.id}/intake`).set(auth(owner)).send({}).expect(201);
    }

    const fourth = await newBooking();
    const blocked = await api()
      .post(`/storage/bookings/${fourth.id}/intake`)
      .set(auth(owner))
      .send({})
      .expect(402);

    expect(blocked.body).toMatchObject({
      paywall: true,
      featureCode: 'STORAGE_ACTIVE_BOOKING',
      featureName: 'Customer in storage',
      limitKind: 'resource',
      planName: 'Free',
      limit: 3,
      used: 3,
      remaining: 0,
      upgradeRequired: true,
    });
    expect(blocked.body.message).toBe('The Free plan includes 3 customers in storage, and all 3 are in use.');

    // The booking itself is untouched -- the goods simply have not been
    // taken in yet, which is the honest state.
    const after = await api().get(`/storage/bookings/${fourth.id}`).set(auth(owner)).expect(200);
    expect(after.body.status).toBe('enquiry');
    expect(after.body.movements).toHaveLength(0);
  });

  it('gives the slot back when a family takes their things home', async () => {
    const inStorage = await api().get('/storage/bookings?status=in_storage').set(auth(owner)).expect(200);
    const [first] = inStorage.body.items;
    const full = await api().get(`/storage/bookings/${first.id}`).set(auth(owner)).expect(200);

    await api()
      .post(`/storage/bookings/${first.id}/release`)
      .set(auth(owner))
      .send({
        counterpartyName: 'Ramesh Kumar',
        lines: full.body.items.map((i: { id: string; inStorageQty: number }) => ({
          itemId: i.id,
          quantity: i.inStorageQty,
        })),
      })
      .expect(201);
    await api().post(`/storage/bookings/${first.id}/close`).set(auth(owner)).send({}).expect(201);

    // This is the promise the pricing makes: fewer customers, cheaper month.
    const usage = await api().get('/plan/usage').set(auth(owner)).expect(200);
    const row = usage.body.features.find((f: { featureCode: string }) => f.featureCode === 'STORAGE_ACTIVE_BOOKING');
    expect(row).toMatchObject({ used: 2, limit: 3, remaining: 1 });

    // And the fourth family can now come in.
    const waiting = await api().get('/storage/bookings?status=enquiry').set(auth(owner)).expect(200);
    await api()
      .post(`/storage/bookings/${waiting.body.items[0].id}/intake`)
      .set(auth(owner))
      .send({})
      .expect(201);
  });

  it('offers only the storage ladder as an upgrade, cheapest first', async () => {
    const options = await api().get('/plan/upgrade/STORAGE_ACTIVE_BOOKING').set(auth(owner)).expect(200);
    expect(options.body.feature).toMatchObject({
      code: 'STORAGE_ACTIVE_BOOKING',
      name: 'Customer in storage',
      limitKind: 'resource',
    });
    expect(options.body.options.map((o: { code: string; limit: number | null }) => [o.code, o.limit])).toEqual([
      ['STORAGE_SOLO', 25],
      ['STORAGE_GODOWN', 100],
      ['STORAGE_NETWORK', null],
    ]);
    for (const option of options.body.options) {
      expect(option.priceMonthly).toBeGreaterThan(0);
    }
  });

  it('lets a workspace that has paid take the fourth customer', async () => {
    await withTenant(sql, tenantId, async (tx) => {
      const [plan] = await tx<{ id: string }[]>`select id from plans where code = 'STORAGE_SOLO'`;
      await tx`
        update tenant_subscriptions set plan_id = ${plan.id}, status = 'active'
        where tenant_id = ${tenantId}
      `;
    });

    const booking = await newBooking();
    await api().post(`/storage/bookings/${booking.id}/intake`).set(auth(owner)).send({}).expect(201);

    const usage = await api().get('/plan/usage').set(auth(owner)).expect(200);
    expect(usage.body.plan.code).toBe('STORAGE_SOLO');
    const row = usage.body.features.find((f: { featureCode: string }) => f.featureCode === 'STORAGE_ACTIVE_BOOKING');
    expect(row).toMatchObject({ limit: 25, used: 4 });
  });
});
