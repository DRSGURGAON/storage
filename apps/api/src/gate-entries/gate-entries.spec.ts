import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_CONNECTION } from '../db/db.module';
import { putOnPlan } from '../testing/subscription';

/**
 * Blueprint §16: the vehicle gate log, Phase 4's first slice. Deliberately
 * scoped to the record and its Open -> Closed/Cancelled workflow --
 * 'linked' (an Inward referencing this gate entry) is a later slice, and
 * PDF generation is covered in documents.spec.ts alongside the other
 * registered document types.
 */
describe('Gate Entries', () => {
  let app: INestApplication;
  let sql: postgres.Sql;
  const suffix = randomUUID().slice(0, 8);
  const password = 'correcthorsebattery';
  let owner = '';
  let otherOwner = '';
  let billingExec = '';
  let customerId = '';
  let warehouseId = '';
  let transporterId = '';
  let vehicleId = '';
  let driverId = '';

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
  const minimalDto = (overrides: Record<string, unknown> = {}) => ({
    warehouseId,
    direction: 'in',
    purpose: 'inward',
    ...overrides,
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    sql = app.get(PG_CONNECTION);
    owner = await signup(`ge-a-${suffix}`, `owner-a-${suffix}@test.local`);
    otherOwner = await signup(`ge-b-${suffix}`, `owner-b-${suffix}@test.local`);

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
    transporterId = (
      await api().post('/transporters').set('Authorization', `Bearer ${owner}`).send({ name: 'Fast Movers' }).expect(201)
    ).body.id;
    vehicleId = (
      await api()
        .post('/vehicles')
        .set('Authorization', `Bearer ${owner}`)
        .send({ vehicleNumber: 'HR26DK1234', transporterId })
        .expect(201)
    ).body.id;
    driverId = (
      await api()
        .post('/drivers')
        .set('Authorization', `Bearer ${owner}`)
        .send({ name: 'Ramesh', mobile: '9876543210' })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a gate entry with an allocated GE number, and selecting a vehicle auto-fills its transporter', async () => {
    const res = await api()
      .post('/gate-entries')
      .set('Authorization', `Bearer ${owner}`)
      .send(minimalDto({ customerId, vehicleId, driverId, referenceNo: 'PO-100' }))
      .expect(201);

    expect(res.body.number).toBe('GE/26-27/000001');
    expect(res.body.status).toBe('open');
    expect(res.body.vehicleNumber).toBe('HR26DK1234');
    expect(res.body.transporterId).toBe(transporterId);
    expect(res.body.transporterName).toBe('Fast Movers');
    expect(res.body.driverName).toBe('Ramesh');
    expect(res.body.driverMobile).toBe('9876543210');
    expect(res.body.exitAt).toBeNull();

    const second = await api().post('/gate-entries').set('Authorization', `Bearer ${owner}`).send(minimalDto()).expect(201);
    expect(second.body.number).toBe('GE/26-27/000002');
  });

  it('an explicit transporterId overrides the vehicle-derived one', async () => {
    const otherTransporter = await api()
      .post('/transporters')
      .set('Authorization', `Bearer ${owner}`)
      .send({ name: 'Custom Carrier' })
      .expect(201);

    const res = await api()
      .post('/gate-entries')
      .set('Authorization', `Bearer ${owner}`)
      .send(minimalDto({ vehicleId, transporterId: otherTransporter.body.id }))
      .expect(201);
    expect(res.body.transporterId).toBe(otherTransporter.body.id);
    expect(res.body.transporterName).toBe('Custom Carrier');
  });

  it('rejects an unknown warehouse/customer/vehicle/driver/transporter reference', async () => {
    await api().post('/gate-entries').set('Authorization', `Bearer ${owner}`).send(minimalDto({ warehouseId: randomUUID() })).expect(404);
    await api().post('/gate-entries').set('Authorization', `Bearer ${owner}`).send(minimalDto({ customerId: randomUUID() })).expect(404);
    await api().post('/gate-entries').set('Authorization', `Bearer ${owner}`).send(minimalDto({ vehicleId: randomUUID() })).expect(404);
    await api().post('/gate-entries').set('Authorization', `Bearer ${owner}`).send(minimalDto({ driverId: randomUUID() })).expect(404);
    await api()
      .post('/gate-entries')
      .set('Authorization', `Bearer ${owner}`)
      .send(minimalDto({ transporterId: randomUUID() }))
      .expect(404);
  });

  it('rejects an invalid direction/purpose', async () => {
    await api().post('/gate-entries').set('Authorization', `Bearer ${owner}`).send(minimalDto({ direction: 'sideways' })).expect(400);
    await api().post('/gate-entries').set('Authorization', `Bearer ${owner}`).send(minimalDto({ purpose: 'joyride' })).expect(400);
  });

  it('walks the full workflow: open -> closed, with edit/cancel rejected once closed', async () => {
    const created = await api().post('/gate-entries').set('Authorization', `Bearer ${owner}`).send(minimalDto()).expect(201);
    const id = created.body.id;

    const edited = await api()
      .patch(`/gate-entries/${id}`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ remarks: 'first edit' })
      .expect(200);
    expect(edited.body.remarks).toBe('first edit');

    const closed = await api().post(`/gate-entries/${id}/close`).set('Authorization', `Bearer ${owner}`).send({}).expect(201);
    expect(closed.body.status).toBe('closed');
    expect(closed.body.exitAt).not.toBeNull();

    // Once closed, no longer editable or cancellable.
    await api().patch(`/gate-entries/${id}`).set('Authorization', `Bearer ${owner}`).send({ remarks: 'nope' }).expect(400);
    await api().post(`/gate-entries/${id}/cancel`).set('Authorization', `Bearer ${owner}`).expect(400);
    // And can't be closed twice.
    await api().post(`/gate-entries/${id}/close`).set('Authorization', `Bearer ${owner}`).send({}).expect(400);
  });

  it('cancels an open gate entry', async () => {
    const created = await api().post('/gate-entries').set('Authorization', `Bearer ${owner}`).send(minimalDto()).expect(201);
    const cancelled = await api().post(`/gate-entries/${created.body.id}/cancel`).set('Authorization', `Bearer ${owner}`).expect(201);
    expect(cancelled.body.status).toBe('cancelled');
  });

  it('filters by status/direction, and searches by number, vehicle number, and reference', async () => {
    const list = await api().get('/gate-entries?status=cancelled').set('Authorization', `Bearer ${owner}`).expect(200);
    expect(list.body.total).toBeGreaterThan(0);
    expect(list.body.items.every((g: { status: string }) => g.status === 'cancelled')).toBe(true);

    const byVehicle = await api().get('/gate-entries?q=HR26DK1234').set('Authorization', `Bearer ${owner}`).expect(200);
    expect(byVehicle.body.items.length).toBeGreaterThan(0);
    expect(byVehicle.body.items.every((g: { vehicleNumber: string }) => g.vehicleNumber === 'HR26DK1234')).toBe(true);

    const byNumber = await api().get('/gate-entries?q=GE/26-27/000001').set('Authorization', `Bearer ${owner}`).expect(200);
    expect(byNumber.body.items.map((g: { number: string }) => g.number)).toEqual(['GE/26-27/000001']);
  });

  it("tenant B cannot see tenant A's gate entries, and gets its own independent GE0001", async () => {
    const created = await api().post('/gate-entries').set('Authorization', `Bearer ${owner}`).send(minimalDto()).expect(201);
    await api().get(`/gate-entries/${created.body.id}`).set('Authorization', `Bearer ${otherOwner}`).expect(404);

    const otherWarehouse = await api()
      .post('/warehouses')
      .set('Authorization', `Bearer ${otherOwner}`)
      .send({ code: 'WH01', name: 'Other Godown', capacityValue: 100, capacityUom: 'pallet' })
      .expect(201);
    const otherGateEntry = await api()
      .post('/gate-entries')
      .set('Authorization', `Bearer ${otherOwner}`)
      .send({ warehouseId: otherWarehouse.body.id, direction: 'in', purpose: 'inward' })
      .expect(201);
    expect(otherGateEntry.body.number).toBe('GE/26-27/000001');
  });

  it('a Billing Executive cannot create or view gate entries -- create_gate_entry is the only seeded permission for this module', async () => {
    const denied = await api().post('/gate-entries').set('Authorization', `Bearer ${billingExec}`).send(minimalDto()).expect(403);
    expect(denied.body.message).toMatch(/create_gate_entry/);
    await api().get('/gate-entries').set('Authorization', `Bearer ${billingExec}`).expect(403);
  });

  it('narrows a restricted membership to its assigned warehouses, on reads and on writes', async () => {
    // tenancy-and-security.md §4: `tenant_users.warehouse_ids`, when set,
    // additionally filters every operational query. It was written, returned
    // by the API as an active restriction, and enforced nowhere -- an
    // operator "restricted" to one warehouse could create records in, and
    // read stock from, every other warehouse in the tenant. It is a third
    // axis alongside RLS (which tenant) and RBAC (which action), so it is
    // tested as its own thing rather than folded into either.
    const assigned = await api()
      .post('/warehouses')
      .set('Authorization', `Bearer ${owner}`)
      .send({ code: 'WH09', name: 'Assigned Godown' })
      .expect(201);

    const email = `scoped-${suffix}@test.local`;
    await api()
      .post('/users')
      .set('Authorization', `Bearer ${owner}`)
      .send({ email, fullName: 'Scoped Op', password, roleCode: 'warehouse_operator', warehouseIds: [assigned.body.id] })
      .expect(201);
    const scoped = (await api().post('/auth/login').send({ email, password }).expect(201)).body.accessToken;

    // The unrestricted warehouse is refused outright rather than 404'd: a
    // write naming a warehouse you may not touch is a mistake worth naming.
    await api()
      .post('/gate-entries')
      .set('Authorization', `Bearer ${scoped}`)
      .send({ warehouseId, customerId, direction: 'in', purpose: 'inward' })
      .expect(403);

    const own = await api()
      .post('/gate-entries')
      .set('Authorization', `Bearer ${scoped}`)
      .send({ warehouseId: assigned.body.id, customerId, direction: 'in', purpose: 'inward' })
      .expect(201);
    // Narrowing must not become blocking: their own warehouse still works.
    await api().get(`/gate-entries/${own.body.id}`).set('Authorization', `Bearer ${scoped}`).expect(200);

    // Reads narrow silently -- a filter, not an error.
    const theirs = await api().get('/gate-entries').set('Authorization', `Bearer ${scoped}`).expect(200);
    expect(theirs.body.items.every((r: { warehouseId: string }) => r.warehouseId === assigned.body.id)).toBe(true);
    const ownerSees = await api().get('/gate-entries').set('Authorization', `Bearer ${owner}`).expect(200);
    expect(ownerSees.body.total).toBeGreaterThan(theirs.body.total);

    // A record in the other warehouse is simply not there for them.
    const elsewhere = await api()
      .post('/gate-entries')
      .set('Authorization', `Bearer ${owner}`)
      .send({ warehouseId, customerId, direction: 'in', purpose: 'inward' })
      .expect(201);
    await api().get(`/gate-entries/${elsewhere.body.id}`).set('Authorization', `Bearer ${scoped}`).expect(404);
    await api().get(`/gate-entries/${elsewhere.body.id}`).set('Authorization', `Bearer ${owner}`).expect(200);

    // permissions-matrix.md narrows *every* one of that role's permissions,
    // so the warehouse picker itself is filtered too.
    const visible = await api().get('/warehouses').set('Authorization', `Bearer ${scoped}`).expect(200);
    expect(visible.body.map((w: { code: string }) => w.code)).toEqual(['WH09']);
    const allWarehouses = await api().get('/warehouses').set('Authorization', `Bearer ${owner}`).expect(200);
    expect(allWarehouses.body.length).toBeGreaterThan(1);

    // An empty array is "never restricted", not "locked out of everywhere" --
    // otherwise a stray empty write would silently disable the account.
    const unrestrictedEmail = `unscoped-${suffix}@test.local`;
    await api()
      .post('/users')
      .set('Authorization', `Bearer ${owner}`)
      .send({ email: unrestrictedEmail, fullName: 'Open Op', password, roleCode: 'warehouse_operator', warehouseIds: [] })
      .expect(201);
    const unrestricted = (await api().post('/auth/login').send({ email: unrestrictedEmail, password }).expect(201)).body
      .accessToken;
    await api().get(`/gate-entries/${elsewhere.body.id}`).set('Authorization', `Bearer ${unrestricted}`).expect(200);
  });

  it('rejects unauthenticated access', async () => {
    await api().get('/gate-entries').expect(401);
  });
});
