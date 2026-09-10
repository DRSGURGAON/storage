import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_CONNECTION } from '../db/db.module';
import { putOnPlan } from '../testing/subscription';

/** Blueprint §8-§9: warehouse master and the Zone/Rack/Row/Bin/Pallet hierarchy with materialised codes. */
describe('Warehouses & Locations', () => {
  let app: INestApplication;
  let sql: postgres.Sql;
  const suffix = randomUUID().slice(0, 8);
  const password = 'correcthorsebattery';
  let owner = '';
  let otherOwner = '';
  let operator = '';
  let warehouseId = '';
  const ids: Record<string, string> = {};

  const api = () => request(app.getHttpServer());
  const signup = async (slug: string, email: string) => {
    const res = await api()
      .post('/auth/signup')
      .send({ companyLegalName: `${slug} Pvt Ltd`, tenantSlug: slug, email, fullName: 'Owner', password })
      .expect(201);
    // Signed up on Free, then upgraded -- what a real customer does, and
    // what these tests need: plans are priced per godown and Free allows
    // one, so anything involving a second warehouse is a paid feature.
    await putOnPlan(sql, slug);
    return res.body.accessToken as string;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    sql = app.get(PG_CONNECTION);
    owner = await signup(`wh-a-${suffix}`, `owner-a-${suffix}@test.local`);
    otherOwner = await signup(`wh-b-${suffix}`, `owner-b-${suffix}@test.local`);

    const opEmail = `op-${suffix}@test.local`;
    await api().post('/users').set('Authorization', `Bearer ${owner}`)
      .send({ email: opEmail, fullName: 'Op', password, roleCode: 'warehouse_operator' }).expect(201);
    operator = (await api().post('/auth/login').send({ email: opEmail, password }).expect(201)).body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a warehouse and rejects a duplicate code with 409', async () => {
    const res = await api().post('/warehouses').set('Authorization', `Bearer ${owner}`)
      .send({ code: 'WH01', name: 'Main Godown', city: 'Gurgaon', stateCode: '06', capacityValue: 500, capacityUom: 'pallet' })
      .expect(201);
    expect(res.body.code).toBe('WH01');
    expect(res.body.capacityValue).toBe(500);
    warehouseId = res.body.id;

    await api().post('/warehouses').set('Authorization', `Bearer ${owner}`)
      .send({ code: 'WH01', name: 'Duplicate' }).expect(409);
    await api().post('/warehouses').set('Authorization', `Bearer ${owner}`)
      .send({ code: 'wh 1', name: 'Bad code' }).expect(400);
  });

  it('builds the hierarchy with materialised codes, skipping Row like the blueprint example', async () => {
    const zone = await api().post(`/warehouses/${warehouseId}/locations`).set('Authorization', `Bearer ${owner}`)
      .send({ level: 'zone', segment: 'A' }).expect(201);
    expect(zone.body.fullCode).toBe('WH01-A');
    ids.zone = zone.body.id;

    const rack = await api().post(`/warehouses/${warehouseId}/locations`).set('Authorization', `Bearer ${owner}`)
      .send({ level: 'rack', segment: 'R04', parentId: ids.zone }).expect(201);
    expect(rack.body.fullCode).toBe('WH01-A-R04');
    ids.rack = rack.body.id;

    const bin = await api().post(`/warehouses/${warehouseId}/locations`).set('Authorization', `Bearer ${owner}`)
      .send({ level: 'bin', segment: 'B15', parentId: ids.rack }).expect(201);
    expect(bin.body.fullCode).toBe('WH01-A-R04-B15');
    ids.bin = bin.body.id;

    const pallet = await api().post(`/warehouses/${warehouseId}/locations`).set('Authorization', `Bearer ${owner}`)
      .send({ level: 'pallet', segment: 'P003', parentId: ids.bin }).expect(201);
    expect(pallet.body.fullCode).toBe('WH01-A-R04-B15-P003');
    expect(pallet.body.barcodeValue).toBe('WH01-A-R04-B15-P003');
  });

  it('rejects structurally invalid placements', async () => {
    const post = (body: object) =>
      api().post(`/warehouses/${warehouseId}/locations`).set('Authorization', `Bearer ${owner}`).send(body);

    await post({ level: 'zone', segment: 'B', parentId: ids.rack }).expect(400); // zone with a parent
    await post({ level: 'rack', segment: 'R09' }).expect(400); // non-zone without a parent
    await post({ level: 'rack', segment: 'R09', parentId: ids.bin }).expect(400); // rack under a bin
    await post({ level: 'bin', segment: 'B99', parentId: ids.bin }).expect(400); // same level as parent
    await post({ level: 'rack', segment: 'R04', parentId: ids.zone }).expect(409); // duplicate segment under same parent
    await post({ level: 'rack', segment: 'R05', parentId: randomUUID() }).expect(400); // unknown parent
  });

  it('lists and filters locations by level, parent, and text', async () => {
    const all = await api().get(`/warehouses/${warehouseId}/locations`).set('Authorization', `Bearer ${owner}`).expect(200);
    expect(all.body.map((l: { fullCode: string }) => l.fullCode)).toEqual([
      'WH01-A', 'WH01-A-R04', 'WH01-A-R04-B15', 'WH01-A-R04-B15-P003',
    ]);

    const zones = await api().get(`/warehouses/${warehouseId}/locations?parentId=root`).set('Authorization', `Bearer ${owner}`).expect(200);
    expect(zones.body).toHaveLength(1);

    const underRack = await api().get(`/warehouses/${warehouseId}/locations?parentId=${ids.rack}`).set('Authorization', `Bearer ${owner}`).expect(200);
    expect(underRack.body.map((l: { segment: string }) => l.segment)).toEqual(['B15']);

    const pallets = await api().get(`/warehouses/${warehouseId}/locations?level=pallet`).set('Authorization', `Bearer ${owner}`).expect(200);
    expect(pallets.body).toHaveLength(1);

    const search = await api().get(`/warehouses/${warehouseId}/locations?q=B15`).set('Authorization', `Bearer ${owner}`).expect(200);
    expect(search.body).toHaveLength(2); // the bin and the pallet under it
  });

  it('updates non-structural fields and refuses structural ones', async () => {
    const res = await api().patch(`/warehouses/${warehouseId}/locations/${ids.bin}`).set('Authorization', `Bearer ${owner}`)
      .send({ name: 'Fast-moving bin', isPickable: false }).expect(200);
    expect(res.body.name).toBe('Fast-moving bin');
    expect(res.body.isPickable).toBe(false);
    expect(res.body.fullCode).toBe('WH01-A-R04-B15');

    await api().patch(`/warehouses/${warehouseId}/locations/${ids.bin}`).set('Authorization', `Bearer ${owner}`)
      .send({ segment: 'B16' }).expect(400); // forbidNonWhitelisted
    await api().patch(`/warehouses/${warehouseId}`).set('Authorization', `Bearer ${owner}`)
      .send({ code: 'WH02' }).expect(400);
  });

  it('an operator can view but not create or edit', async () => {
    await api().get('/warehouses').set('Authorization', `Bearer ${operator}`).expect(200);
    await api().get(`/warehouses/${warehouseId}/locations`).set('Authorization', `Bearer ${operator}`).expect(200);
    await api().post('/warehouses').set('Authorization', `Bearer ${operator}`)
      .send({ code: 'WH09', name: 'Nope' }).expect(403);
    await api().post(`/warehouses/${warehouseId}/locations`).set('Authorization', `Bearer ${operator}`)
      .send({ level: 'zone', segment: 'Z' }).expect(403);
  });

  it('another tenant sees nothing and gets 404 everywhere', async () => {
    const list = await api().get('/warehouses').set('Authorization', `Bearer ${otherOwner}`).expect(200);
    expect(list.body).toHaveLength(0);
    await api().get(`/warehouses/${warehouseId}`).set('Authorization', `Bearer ${otherOwner}`).expect(404);
    await api().get(`/warehouses/${warehouseId}/locations`).set('Authorization', `Bearer ${otherOwner}`).expect(404);
    await api().post(`/warehouses/${warehouseId}/locations`).set('Authorization', `Bearer ${otherOwner}`)
      .send({ level: 'zone', segment: 'X' }).expect(404);

    // ...and can reuse the same warehouse code independently.
    const own = await api().post('/warehouses').set('Authorization', `Bearer ${otherOwner}`)
      .send({ code: 'WH01', name: 'Their WH01' }).expect(201);
    expect(own.body.code).toBe('WH01');
  });
});
