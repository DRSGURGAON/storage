import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import request from 'supertest';
import { AppModule } from '../app.module';
import { createDbConnection } from '../db/client';
import { withTenant } from '../db/tenant-context';

/**
 * The first real permission-gated endpoints, so this is where two things
 * previously proven only at the service layer get proven through HTTP:
 * tenant isolation (dev-phases.md Phase 1's exit check, "via the API") and
 * RBAC enforcement (PermissionsGuard's first real caller).
 */
describe('Customers', () => {
  let app: INestApplication;
  let sql: postgres.Sql;
  const suffix = randomUUID().slice(0, 8);
  const password = 'correcthorsebattery';
  let ownerA = '';
  let ownerB = '';
  let operatorA = '';
  let tenantAId = '';
  let customerAId = '';

  const signup = async (slug: string, email: string) => {
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ companyLegalName: `${slug} Pvt Ltd`, tenantSlug: slug, email, fullName: 'Owner', password })
      .expect(201);
    return res.body.accessToken as string;
  };
  const tenantIdOf = (token: string) =>
    JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString()).tenantId as string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    sql = createDbConnection(process.env.DATABASE_URL!).sql;

    ownerA = await signup(`cust-a-${suffix}`, `owner-a-${suffix}@test.local`);
    ownerB = await signup(`cust-b-${suffix}`, `owner-b-${suffix}@test.local`);
    tenantAId = tenantIdOf(ownerA);

    // A Warehouse Operator in tenant A: has view_customer but not
    // create_customer (permissions-matrix.md), added through the real
    // membership endpoint.
    const operatorEmail = `operator-a-${suffix}@test.local`;
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${ownerA}`)
      .send({ email: operatorEmail, fullName: 'Operator', password, roleCode: 'warehouse_operator' })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: operatorEmail, password })
      .expect(201);
    operatorA = login.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
  });

  it('creates a customer with an allocated CUST code', async () => {
    const res = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${ownerA}`)
      .send({ name: 'Alpha Traders', gstin: '06AAACA1234A1Z5', mobile: '9876543210', creditDays: 30 })
      .expect(201);
    expect(res.body.code).toBe('CUST0001');
    expect(res.body.kycStatus).toBe('pending');
    customerAId = res.body.id;

    const second = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${ownerA}`)
      .send({ name: 'Beta Foods' })
      .expect(201);
    expect(second.body.code).toBe('CUST0002');
  });

  it('rejects an invalid GSTIN with 400, not a database error', async () => {
    await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${ownerA}`)
      .send({ name: 'Bad Co', gstin: 'not-a-gstin' })
      .expect(400);
  });

  it('searches by name/code/GSTIN/mobile with server-side pagination', async () => {
    const byName = await request(app.getHttpServer())
      .get('/customers?q=alpha')
      .set('Authorization', `Bearer ${ownerA}`)
      .expect(200);
    expect(byName.body.total).toBe(1);
    expect(byName.body.items[0].code).toBe('CUST0001');

    const byMobile = await request(app.getHttpServer())
      .get('/customers?q=98765')
      .set('Authorization', `Bearer ${ownerA}`)
      .expect(200);
    expect(byMobile.body.items.map((c: { code: string }) => c.code)).toEqual(['CUST0001']);

    const paged = await request(app.getHttpServer())
      .get('/customers?limit=1&offset=1')
      .set('Authorization', `Bearer ${ownerA}`)
      .expect(200);
    expect(paged.body.total).toBe(2);
    expect(paged.body.items).toHaveLength(1);
  });

  it('updates a customer and records previous/new values in the audit log', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/customers/${customerAId}`)
      .set('Authorization', `Bearer ${ownerA}`)
      .send({ creditDays: 45, paymentTerms: 'Net 45' })
      .expect(200);
    expect(res.body.creditDays).toBe(45);
    expect(res.body.code).toBe('CUST0001');

    const [audit] = await withTenant(sql, tenantAId, (tx) => tx<
      { previous_value: { credit_days: number }; new_value: { credit_days: number } }[]
    >`select previous_value, new_value from audit_logs
      where tenant_id = ${tenantAId} and action = 'update' and entity_id = ${customerAId}`);
    expect(audit.previous_value.credit_days).toBe(30);
    expect(audit.new_value.credit_days).toBe(45);
  });

  it('tenant B cannot list or fetch tenant A\'s customers -- through the API', async () => {
    const list = await request(app.getHttpServer())
      .get('/customers')
      .set('Authorization', `Bearer ${ownerB}`)
      .expect(200);
    expect(list.body.total).toBe(0);

    await request(app.getHttpServer())
      .get(`/customers/${customerAId}`)
      .set('Authorization', `Bearer ${ownerB}`)
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/customers/${customerAId}`)
      .set('Authorization', `Bearer ${ownerB}`)
      .send({ name: 'Hijacked' })
      .expect(404);
  });

  it('tenant B gets its own independent CUST0001', async () => {
    const res = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${ownerB}`)
      .send({ name: 'Gamma Logistics' })
      .expect(201);
    expect(res.body.code).toBe('CUST0001');
  });

  it('an operator can view but not create customers, and the denial is audited', async () => {
    await request(app.getHttpServer())
      .get('/customers')
      .set('Authorization', `Bearer ${operatorA}`)
      .expect(200);

    const denied = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${operatorA}`)
      .send({ name: 'Should Not Exist' })
      .expect(403);
    expect(denied.body.message).toMatch(/create_customer/);

    const rows = await withTenant(sql, tenantAId, (tx) => tx<{ new_value: { required: string } }[]>`
      select new_value from audit_logs
      where tenant_id = ${tenantAId} and action = 'permission_denied'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].new_value.required).toBe('create_customer');
  });

  it('rejects unauthenticated access', async () => {
    await request(app.getHttpServer()).get('/customers').expect(401);
  });

  describe('addresses and contacts', () => {
    it('enforces only one default address per (customer, kind), independently across kinds', async () => {
      const registered = await request(app.getHttpServer())
        .post(`/customers/${customerAId}/addresses`)
        .set('Authorization', `Bearer ${ownerA}`)
        .send({ kind: 'registered', addressLine1: '123 Main St', city: 'Gurgaon', isDefault: true })
        .expect(201);
      expect(registered.body.isDefault).toBe(true);

      const delivery1 = await request(app.getHttpServer())
        .post(`/customers/${customerAId}/addresses`)
        .set('Authorization', `Bearer ${ownerA}`)
        .send({ kind: 'delivery', label: 'Plant 2', addressLine1: '456 Industrial Rd', isDefault: true })
        .expect(201);
      expect(delivery1.body.isDefault).toBe(true);

      const delivery2 = await request(app.getHttpServer())
        .post(`/customers/${customerAId}/addresses`)
        .set('Authorization', `Bearer ${ownerA}`)
        .send({ kind: 'delivery', label: 'Plant 3', addressLine1: '789 New Rd', isDefault: true })
        .expect(201);
      expect(delivery2.body.isDefault).toBe(true);

      const list = await request(app.getHttpServer())
        .get(`/customers/${customerAId}/addresses`)
        .set('Authorization', `Bearer ${ownerA}`)
        .expect(200);
      const byId = new Map(list.body.map((a: { id: string; isDefault: boolean }) => [a.id, a.isDefault]));
      // The registered default is untouched by the delivery-kind churn; only one delivery default remains.
      expect(byId.get(registered.body.id)).toBe(true);
      expect(byId.get(delivery1.body.id)).toBe(false);
      expect(byId.get(delivery2.body.id)).toBe(true);
    });

    it('enforces only one primary contact per customer, and re-toggling moves it back', async () => {
      const first = await request(app.getHttpServer())
        .post(`/customers/${customerAId}/contacts`)
        .set('Authorization', `Bearer ${ownerA}`)
        .send({ name: 'Rakesh Sharma', mobile: '9876543210', isPrimary: true })
        .expect(201);
      expect(first.body.isPrimary).toBe(true);

      const second = await request(app.getHttpServer())
        .post(`/customers/${customerAId}/contacts`)
        .set('Authorization', `Bearer ${ownerA}`)
        .send({ name: 'Priya Singh', email: 'priya@acme.test', isPrimary: true })
        .expect(201);
      expect(second.body.isPrimary).toBe(true);

      let list = await request(app.getHttpServer())
        .get(`/customers/${customerAId}/contacts`)
        .set('Authorization', `Bearer ${ownerA}`)
        .expect(200);
      expect(list.body.filter((c: { isPrimary: boolean }) => c.isPrimary)).toHaveLength(1);
      expect(list.body.find((c: { id: string }) => c.id === first.body.id).isPrimary).toBe(false);

      await request(app.getHttpServer())
        .patch(`/customers/${customerAId}/contacts/${first.body.id}`)
        .set('Authorization', `Bearer ${ownerA}`)
        .send({ isPrimary: true })
        .expect(200);

      list = await request(app.getHttpServer())
        .get(`/customers/${customerAId}/contacts`)
        .set('Authorization', `Bearer ${ownerA}`)
        .expect(200);
      expect(list.body.filter((c: { isPrimary: boolean }) => c.isPrimary)).toHaveLength(1);
      expect(list.body.find((c: { id: string }) => c.id === first.body.id).isPrimary).toBe(true);
      expect(list.body.find((c: { id: string }) => c.id === second.body.id).isPrimary).toBe(false);
    });

    it('404s addresses/contacts under an unknown or cross-tenant customer', async () => {
      const unknownId = '00000000-0000-0000-0000-000000000000';
      await request(app.getHttpServer())
        .get(`/customers/${unknownId}/addresses`)
        .set('Authorization', `Bearer ${ownerA}`)
        .expect(404);
      await request(app.getHttpServer())
        .post(`/customers/${unknownId}/contacts`)
        .set('Authorization', `Bearer ${ownerA}`)
        .send({ name: 'Ghost' })
        .expect(404);

      // Tenant B cannot see or write into tenant A's customer's addresses/contacts.
      await request(app.getHttpServer())
        .get(`/customers/${customerAId}/addresses`)
        .set('Authorization', `Bearer ${ownerB}`)
        .expect(404);
      await request(app.getHttpServer())
        .post(`/customers/${customerAId}/contacts`)
        .set('Authorization', `Bearer ${ownerB}`)
        .send({ name: 'Hijack' })
        .expect(404);
    });

    it('an operator can view but not create addresses/contacts', async () => {
      await request(app.getHttpServer())
        .get(`/customers/${customerAId}/addresses`)
        .set('Authorization', `Bearer ${operatorA}`)
        .expect(200);

      await request(app.getHttpServer())
        .post(`/customers/${customerAId}/addresses`)
        .set('Authorization', `Bearer ${operatorA}`)
        .send({ kind: 'registered', addressLine1: 'Should Not Exist' })
        .expect(403);
    });
  });
});
