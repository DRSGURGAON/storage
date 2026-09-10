import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';

/**
 * The godown limit -- the number the plans are actually priced on.
 *
 * It is a different shape of limit from the document counts and this is
 * where that shows: a warehouse can be closed, and closing one has to give
 * the slot back. Counted in `usage_ledger` it would not, which is why
 * `resource-limits.ts` exists at all.
 */
describe('Resource limits (godowns)', () => {
  let app: INestApplication;
  let sql: postgres.Sql;
  const suffix = randomUUID().slice(0, 8);
  const password = 'correcthorsebattery';
  let owner = '';
  let tenantId = '';

  const api = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  const createWarehouse = (code: string) =>
    api()
      .post('/warehouses')
      .set(auth(owner))
      .send({ code, name: `Godown ${code}`, addressLine1: 'Industrial Area', city: 'Gurgaon', state: 'Haryana' });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    sql = app.get(PG_CONNECTION);

    const slug = `godown-${suffix}`;
    const signup = await api()
      .post('/auth/signup')
      .send({
        companyLegalName: `${slug} Pvt Ltd`,
        tenantSlug: slug,
        email: `owner-${slug}@test.local`,
        fullName: 'Owner',
        password,
      })
      .expect(201);
    owner = signup.body.accessToken;
    const [row] = await sql<{ id: string }[]>`select id from tenants where slug = ${slug}`;
    tenantId = row.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('gives the Free plan one godown, and refuses the second with the upgrade prompt', async () => {
    const first = await createWarehouse('WH01').expect(201);
    expect(first.body.code).toBe('WH01');

    const blocked = await createWarehouse('WH02').expect(402);
    expect(blocked.body).toMatchObject({
      paywall: true,
      featureCode: 'WAREHOUSE',
      featureName: 'Godown',
      planName: 'Free',
      reason: 'LIMIT_REACHED',
      limit: 1,
      used: 1,
      remaining: 0,
      upgradeRequired: true,
    });
    // The same 402 the document paywall raises, so the client's existing
    // upgrade prompt renders this with no new code -- but not the same
    // sentence. A godown is held, not spent, so "you have used your 1 free
    // godown copy" is wrong twice over, and `limitKind` is what lets the
    // client word the rest of the prompt the same way.
    expect(blocked.body.message).toBe('The Free plan includes 1 godown, and it is in use.');
    expect(blocked.body.limitKind).toBe('resource');

    // Nothing was half-created: the check runs inside the insert's own
    // transaction, so a refusal leaves no row behind.
    const list = await api().get('/warehouses').set(auth(owner)).expect(200);
    expect(list.body).toHaveLength(1);
  });

  it('gives the slot back when a godown is closed -- which a usage ledger would not', async () => {
    const [existing] = (await api().get('/warehouses').set(auth(owner)).expect(200)).body;

    await api().patch(`/warehouses/${existing.id}`).set(auth(owner)).send({ isActive: false }).expect(200);

    // This is the whole difference between a resource limit and a
    // consumption one. "Three godowns" means three at a time; a workspace
    // that closed one and could not open another would be paying for a
    // slot it gave back.
    const reopened = (await createWarehouse('WH03').expect(201)).body;
    expect(reopened.code).toBe('WH03');

    await api().patch(`/warehouses/${reopened.id}`).set(auth(owner)).send({ isActive: false }).expect(200);
    await api().patch(`/warehouses/${existing.id}`).set(auth(owner)).send({ isActive: true }).expect(200);
  });

  it('follows the plan: moving the workspace to Growth allows three', async () => {
    // What an Owner-side upgrade does today -- change which plan the
    // subscription points at. Everything else follows from the plan's own
    // rows, which is the property that makes a price change a seed re-run
    // rather than a deployment.
    const [growth] = await sql<{ id: string }[]>`select id from plans where code = 'GROWTH'`;
    expect(growth).toBeDefined();
    // Through withTenant: `tenant_subscriptions` is under FORCE RLS, so
    // this update on the bare connection matches zero rows and the test
    // would quietly go on asserting against the Free plan.
    await withTenant(sql, tenantId, (tx) => tx`
      update tenant_subscriptions set plan_id = ${growth.id} where tenant_id = ${tenantId}
    `);

    await createWarehouse('WH04').expect(201);
    await createWarehouse('WH05').expect(201);
    // Three now exist (WH01, WH04, WH05); the fourth is refused, and the
    // message names the plan the workspace is actually on.
    const blocked = await createWarehouse('WH06').expect(402);
    expect(blocked.body).toMatchObject({ planName: 'Growth', limit: 3, used: 3 });
  });

  it('reports godowns on Plan & Usage beside the document counts', async () => {
    const usage = await api().get('/plan/usage').set(auth(owner)).expect(200);
    const godowns = usage.body.features.find((f: { featureCode: string }) => f.featureCode === 'WAREHOUSE');
    // An owner opening this page wants to see "3 of 3 godowns" in the same
    // list as everything else, not in a different place because it is
    // counted differently underneath.
    expect(godowns).toMatchObject({ name: 'Godown', limit: 3, used: 3, remaining: 0, allowed: false });
  });

  it('offers the plans above the current one, priced', async () => {
    const options = await api().get('/plan/upgrade/WAREHOUSE').set(auth(owner)).expect(200);
    expect(options.body.current).toMatchObject({ planCode: 'GROWTH', limit: 3, used: 3 });
    expect(options.body.options.map((o: { code: string }) => o.code)).toEqual(['SCALE']);
    expect(options.body.options[0]).toMatchObject({ name: 'Scale', limit: 10, currency: 'INR', trialDays: 14 });
    expect(options.body.options[0].priceMonthly).toBeGreaterThan(0);
  });
});
