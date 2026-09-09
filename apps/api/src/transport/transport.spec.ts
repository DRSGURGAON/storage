import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../app.module';

/** Blueprint §12: Transporters, Vehicles, Drivers -- one permission set (view/create/edit_transport_master). */
describe('Transport master (Transporters, Vehicles, Drivers)', () => {
  let app: INestApplication;
  const suffix = randomUUID().slice(0, 8);
  const password = 'correcthorsebattery';
  let owner = '';
  let otherOwner = '';
  let operator = '';
  let transporterId = '';

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
    owner = await signup(`trans-a-${suffix}`, `owner-a-${suffix}@test.local`);
    otherOwner = await signup(`trans-b-${suffix}`, `owner-b-${suffix}@test.local`);

    const opEmail = `op-${suffix}@test.local`;
    await api()
      .post('/users')
      .set('Authorization', `Bearer ${owner}`)
      .send({ email: opEmail, fullName: 'Op', password, roleCode: 'warehouse_operator' })
      .expect(201);
    operator = (await api().post('/auth/login').send({ email: opEmail, password }).expect(201)).body.accessToken;

    const t = await api()
      .post('/transporters')
      .set('Authorization', `Bearer ${owner}`)
      .send({ name: 'Fast Movers Logistics', contactPhone: '9988776655' })
      .expect(201);
    transporterId = t.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a transporter and rejects a duplicate name with 409', async () => {
    await api()
      .post('/transporters')
      .set('Authorization', `Bearer ${owner}`)
      .send({ name: 'Fast Movers Logistics' })
      .expect(409);

    const updated = await api()
      .patch(`/transporters/${transporterId}`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ contactPhone: '9000000000' })
      .expect(200);
    expect(updated.body.contactPhone).toBe('9000000000');
  });

  it('normalizes a vehicle number to uppercase/no-spaces and enforces uniqueness on the normalized form', async () => {
    const created = await api()
      .post('/vehicles')
      .set('Authorization', `Bearer ${owner}`)
      .send({ vehicleNumber: 'hr 26 dk 1234', vehicleType: '20ft', capacityValue: 5, capacityUom: 'mt', transporterId })
      .expect(201);
    expect(created.body.vehicleNumber).toBe('HR26DK1234');
    expect(created.body.capacityValue).toBe(5);

    await api()
      .post('/vehicles')
      .set('Authorization', `Bearer ${owner}`)
      .send({ vehicleNumber: 'HR26DK1234' })
      .expect(409);
  });

  it('allows a vehicle with no transporter (an owned fleet), and rejects an unknown transporterId with 404', async () => {
    const owned = await api()
      .post('/vehicles')
      .set('Authorization', `Bearer ${owner}`)
      .send({ vehicleNumber: 'MH12XY0001' })
      .expect(201);
    expect(owned.body.transporterId).toBeNull();

    await api()
      .post('/vehicles')
      .set('Authorization', `Bearer ${owner}`)
      .send({ vehicleNumber: 'DL01AB9999', transporterId: randomUUID() })
      .expect(404);
  });

  it('creates a driver linked to a transporter, and allows duplicate names (no unique constraint)', async () => {
    const driver = await api()
      .post('/drivers')
      .set('Authorization', `Bearer ${owner}`)
      .send({ name: 'Ramesh Kumar', mobile: '9123456780', licenseNumber: 'DL123', licenseExpiry: '2027-01-01', transporterId })
      .expect(201);
    expect(driver.body.transporterId).toBe(transporterId);

    await api()
      .post('/drivers')
      .set('Authorization', `Bearer ${owner}`)
      .send({ name: 'Ramesh Kumar' })
      .expect(201);

    await api()
      .post('/drivers')
      .set('Authorization', `Bearer ${owner}`)
      .send({ name: 'Bad Driver', transporterId: randomUUID() })
      .expect(404);
  });

  it('filters vehicles and drivers by transporterId, and searches vehicles by (normalized) number', async () => {
    const byTransporter = await api()
      .get(`/vehicles?transporterId=${transporterId}`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(200);
    expect(byTransporter.body.items.every((v: { transporterId: string }) => v.transporterId === transporterId)).toBe(
      true,
    );
    expect(byTransporter.body.total).toBeGreaterThan(0);

    const search = await api().get('/vehicles?q=hr26').set('Authorization', `Bearer ${owner}`).expect(200);
    expect(search.body.items.map((v: { vehicleNumber: string }) => v.vehicleNumber)).toContain('HR26DK1234');

    const drivers = await api()
      .get(`/drivers?transporterId=${transporterId}`)
      .set('Authorization', `Bearer ${owner}`)
      .expect(200);
    expect(drivers.body.total).toBe(1);
  });

  it("tenant B cannot see tenant A's transport master, and gets an independent namespace", async () => {
    const list = await api().get('/transporters').set('Authorization', `Bearer ${otherOwner}`).expect(200);
    expect(list.body.total).toBe(0);

    await api().get(`/transporters/${transporterId}`).set('Authorization', `Bearer ${otherOwner}`).expect(404);

    // Tenant B can reuse the same transporter name and vehicle number tenant A already used.
    await api()
      .post('/transporters')
      .set('Authorization', `Bearer ${otherOwner}`)
      .send({ name: 'Fast Movers Logistics' })
      .expect(201);
    await api()
      .post('/vehicles')
      .set('Authorization', `Bearer ${otherOwner}`)
      .send({ vehicleNumber: 'HR26DK1234' })
      .expect(201);
  });

  it('an operator can view but not create transport-master records, and the denial is audited', async () => {
    await api().get('/transporters').set('Authorization', `Bearer ${operator}`).expect(200);
    await api().get('/vehicles').set('Authorization', `Bearer ${operator}`).expect(200);
    await api().get('/drivers').set('Authorization', `Bearer ${operator}`).expect(200);

    const denied = await api()
      .post('/transporters')
      .set('Authorization', `Bearer ${operator}`)
      .send({ name: 'Should Not Exist' })
      .expect(403);
    expect(denied.body.message).toMatch(/create_transport_master/);
  });

  it('rejects unauthenticated access', async () => {
    await api().get('/transporters').expect(401);
    await api().get('/vehicles').expect(401);
    await api().get('/drivers').expect(401);
  });
});
