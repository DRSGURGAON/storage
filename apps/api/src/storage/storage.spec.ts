import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_CONNECTION } from '../db/db.module';

/**
 * Household goods storage, end to end: a family's things booked in,
 * counted, received, handed back in two trips, and the booking wound up.
 *
 * The tests worth having here are the refusals. Anybody can make the happy
 * path work; what decides whether an operator trusts the software is
 * whether it stops them doing the four things that cannot be undone --
 * taking goods in with no inventory list, handing back more than is there,
 * closing a booking while something is still on the floor, and letting the
 * rent change under a running agreement.
 */
describe('Household storage bookings', () => {
  let app: INestApplication;
  let sql: postgres.Sql;
  const suffix = randomUUID().slice(0, 8);
  const password = 'correcthorsebattery';
  let owner = '';
  let operator = '';
  let otherOwner = '';
  let warehouseId = '';
  let customerId = '';
  let unitId = '';

  const api = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  const newBooking = async (overrides: Record<string, unknown> = {}) => {
    const res = await api()
      .post('/storage/bookings')
      .set(auth(owner))
      .send({
        customerId,
        warehouseId,
        monthlyRent: 4500,
        securityDeposit: 9000,
        noticeDays: 30,
        items: [
          { description: 'Godrej almirah, 3 door', category: 'furniture', conditionNote: 'left door scratched', declaredValue: 18000 },
          { description: 'Double bed with mattress', category: 'furniture', declaredValue: 22000 },
          { description: 'Cartons, kitchen', category: 'carton', quantity: 12, declaredValue: 15000 },
        ],
        ...overrides,
      })
      .expect(201);
    return res.body;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    sql = app.get(PG_CONNECTION);

    owner = (
      await api()
        .post('/auth/signup')
        .send({
          companyLegalName: 'Gurgaon Safe Storage',
          tenantSlug: `hs-a-${suffix}`,
          email: `owner-a-${suffix}@test.local`,
          fullName: 'Owner',
          password,
        })
        .expect(201)
    ).body.accessToken;

    otherOwner = (
      await api()
        .post('/auth/signup')
        .send({
          companyLegalName: 'Other Storage',
          tenantSlug: `hs-b-${suffix}`,
          email: `owner-b-${suffix}@test.local`,
          fullName: 'Owner',
          password,
        })
        .expect(201)
    ).body.accessToken;

    const operatorEmail = `op-${suffix}@test.local`;
    await api()
      .post('/users')
      .set(auth(owner))
      .send({ email: operatorEmail, fullName: 'Field staff', password, roleCode: 'warehouse_operator' })
      .expect(201);
    operator = (await api().post('/auth/login').send({ email: operatorEmail, password }).expect(201))
      .body.accessToken;

    warehouseId = (
      await api()
        .post('/warehouses')
        .set(auth(owner))
        .send({ code: 'WH01', name: 'Sector 37 godown' })
        .expect(201)
    ).body.id;

    // A household customer is an individual, not a company -- the same
    // table, a different customer_type.
    customerId = (
      await api()
        .post('/customers')
        .set(auth(owner))
        .send({ name: 'Ramesh Kumar', customerType: 'individual', mobile: '9811122233' })
        .expect(201)
    ).body.id;

    unitId = (
      await api()
        .post('/storage/units')
        .set(auth(owner))
        .send({ warehouseId, code: 'A-12', unitType: 'room', areaSqft: 120, monthlyRate: 4500 })
        .expect(201)
    ).body.id;
    // Four argon2id hashes at 64 MiB each, plus the module compile: this
    // fixture is slower than Jest's 5-second default hook timeout.
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('books a family\'s goods in, with an item-wise list and its condition notes', async () => {
    const booking = await newBooking({
      storageUnitId: unitId,
      charges: [{ description: 'Pickup and loading', rate: 2500 }],
      idProofType: 'aadhaar',
      idProofLast4: '4417',
    });

    expect(booking.number).toMatch(/^SB\/\d{2}-\d{2}\/\d{6}$/);
    expect(booking.status).toBe('enquiry');
    expect(booking.items).toHaveLength(3);
    expect(booking.items[0]).toMatchObject({
      lineNo: 1,
      description: 'Godrej almirah, 3 door',
      conditionNote: 'left door scratched',
      inStorageQty: 1,
    });
    expect(booking.items[2]).toMatchObject({ quantity: 12, inStorageQty: 12 });
    expect(booking.declaredValueTotal).toBe(55000);
    expect(booking.oneTimeChargesTotal).toBe(2500);
    // Frozen at booking, so the agreement keeps reading the way it read.
    expect(booking.customerSnapshot).toMatchObject({ name: 'Ramesh Kumar', mobile: '9811122233' });
    // The scan belongs in attachments; only the last four digits are stored.
    expect(booking.idProofLast4).toBe('4417');
  });

  it('refuses an intake with no inventory list, because nobody can reconstruct one later', async () => {
    const empty = await api()
      .post('/storage/bookings')
      .set(auth(owner))
      .send({ customerId, warehouseId, monthlyRent: 1500 })
      .expect(201);

    const refused = await api()
      .post(`/storage/bookings/${empty.body.id}/intake`)
      .set(auth(owner))
      .send({})
      .expect(400);
    expect(refused.body.message).toContain('inventory list');
  });

  it('starts the rent from the intake, not from a date somebody typed', async () => {
    const booking = await newBooking({ storageUnitId: unitId });
    const after = await api()
      .post(`/storage/bookings/${booking.id}/intake`)
      .set(auth(owner))
      .send({ vehicleNumber: 'HR26 AB 1234', driverName: 'Suresh', counterpartyName: 'Ramesh Kumar' })
      .expect(201);

    expect(after.body.status).toBe('in_storage');
    expect(after.body.storageStartDate).toBe(new Date().toISOString().slice(0, 10));
    expect(after.body.movements).toHaveLength(1);
    expect(after.body.movements[0]).toMatchObject({ direction: 'in', status: 'completed' });
    expect(after.body.movements[0].number).toMatch(/^SM\//);

    // The unit is marked occupied by the intake, not by hand.
    const units = await api().get('/storage/units').set(auth(owner)).expect(200);
    const unit = units.body.items.find((u: { id: string }) => u.id === unitId);
    expect(unit).toMatchObject({ status: 'occupied', occupiedBy: after.body.number });

    // A second intake on the same booking is refused.
    await api().post(`/storage/bookings/${booking.id}/intake`).set(auth(owner)).send({}).expect(400);
    // And so is cancelling once the goods are actually inside.
    const cancel = await api()
      .post(`/storage/bookings/${booking.id}/cancel`)
      .set(auth(owner))
      .send({ reason: 'changed mind' })
      .expect(400);
    expect(cancel.body.message).toContain('hand them back');
  });

  it('hands goods back in parts, refuses more than is there, and only closes when the floor is empty', async () => {
    const booking = await newBooking();
    await api().post(`/storage/bookings/${booking.id}/intake`).set(auth(owner)).send({}).expect(201);
    const [almirah, bed, cartons] = booking.items;

    // Four of the twelve cartons go back first.
    const partial = await api()
      .post(`/storage/bookings/${booking.id}/release`)
      .set(auth(owner))
      .send({
        counterpartyName: 'Ramesh Kumar',
        authorisationNote: 'collected in person, ID checked',
        lines: [{ itemId: cartons.id, quantity: 4 }],
      })
      .expect(201);
    const cartonLine = partial.body.items.find((i: { id: string }) => i.id === cartons.id);
    expect(cartonLine).toMatchObject({ releasedQty: 4, inStorageQty: 8 });
    expect(partial.body.status).toBe('in_storage');

    // Nine more would be one carton too many.
    const tooMany = await api()
      .post(`/storage/bookings/${booking.id}/release`)
      .set(auth(owner))
      .send({ counterpartyName: 'Ramesh Kumar', lines: [{ itemId: cartons.id, quantity: 9 }] })
      .expect(400);
    expect(tooMany.body.message).toContain('only 8 left in storage');

    // Closing now would leave somebody's almirah in a closed booking.
    const early = await api()
      .post(`/storage/bookings/${booking.id}/close`)
      .set(auth(owner))
      .send({})
      .expect(400);
    expect(early.body.message).toContain('still in storage');

    const rest = await api()
      .post(`/storage/bookings/${booking.id}/release`)
      .set(auth(owner))
      .send({
        counterpartyName: 'Sunita Kumar',
        authorisationNote: 'wife, authorised by customer on call',
        lines: [
          { itemId: almirah.id, quantity: 1, conditionNote: 'scratch as recorded at intake' },
          { itemId: bed.id, quantity: 1 },
          { itemId: cartons.id, quantity: 8 },
        ],
      })
      .expect(201);
    expect(rest.body.items.every((i: { inStorageQty: number }) => i.inStorageQty === 0)).toBe(true);

    const closed = await api()
      .post(`/storage/bookings/${booking.id}/close`)
      .set(auth(owner))
      .send({})
      .expect(201);
    expect(closed.body.status).toBe('closed');
    expect(closed.body.actualEndDate).toBe(new Date().toISOString().slice(0, 10));
    expect(closed.body.movements).toHaveLength(3); // one in, two out

    // Every handover is on the trail, including who took the goods.
    const trail = await api()
      .get(`/audit-logs?entityType=storage_booking&entityId=${booking.id}`)
      .set(auth(owner))
      .expect(200);
    const actions = trail.body.items.map((r: { action: string }) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['create', 'storage_intake', 'storage_release', 'storage_close']));
    const release = trail.body.items.find((r: { action: string }) => r.action === 'storage_release');
    expect(release.newValue.takenBy).toBeTruthy();
  });

  it('will not re-price a booking whose goods are already inside', async () => {
    const booking = await newBooking();
    // Before the goods arrive, the rent is still a negotiation.
    await api()
      .patch(`/storage/bookings/${booking.id}`)
      .set(auth(owner))
      .send({ monthlyRent: 5000 })
      .expect(200);

    await api().post(`/storage/bookings/${booking.id}/intake`).set(auth(owner)).send({}).expect(201);

    const refused = await api()
      .patch(`/storage/bookings/${booking.id}`)
      .set(auth(owner))
      .send({ monthlyRent: 7000 })
      .expect(400);
    expect(refused.body.message).toContain('close this booking and raise a new one');

    // An unrelated edit still works while the goods are in.
    await api()
      .patch(`/storage/bookings/${booking.id}`)
      .set(auth(owner))
      .send({ notes: 'customer asked for a call before delivery' })
      .expect(200);
  });

  it('lets field staff book and receive, but not hand goods back', async () => {
    const booking = await api()
      .post('/storage/bookings')
      .set(auth(operator))
      .send({
        customerId,
        warehouseId,
        monthlyRent: 3000,
        items: [{ description: 'Washing machine', category: 'appliance' }],
      })
      .expect(201);

    await api().post(`/storage/bookings/${booking.body.id}/intake`).set(auth(operator)).send({}).expect(201);

    // Giving goods out is the one action that cannot be undone.
    await api()
      .post(`/storage/bookings/${booking.body.id}/release`)
      .set(auth(operator))
      .send({ counterpartyName: 'Anyone', lines: [{ itemId: booking.body.items[0].id, quantity: 1 }] })
      .expect(403);
    await api().post(`/storage/bookings/${booking.body.id}/close`).set(auth(operator)).send({}).expect(403);
  });

  it('keeps one storage company\'s bookings invisible to another', async () => {
    const booking = await newBooking();
    await api().get(`/storage/bookings/${booking.id}`).set(auth(otherOwner)).expect(404);
    await api()
      .post(`/storage/bookings/${booking.id}/intake`)
      .set(auth(otherOwner))
      .send({})
      .expect(404);

    const theirList = await api().get('/storage/bookings').set(auth(otherOwner)).expect(200);
    expect(theirList.body.items).toHaveLength(0);
  });

  it('finds a booking by the customer\'s phone number, which is how a caller identifies themselves', async () => {
    await newBooking();
    const found = await api().get('/storage/bookings?q=9811122233').set(auth(owner)).expect(200);
    expect(found.body.total).toBeGreaterThan(0);
    expect(found.body.items[0].customerName).toBe('Ramesh Kumar');
  });
});
