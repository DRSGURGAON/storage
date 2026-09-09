import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { AppModule } from '../app.module';
import { createDbConnection } from '../db/client';
import { withTenant } from '../db/tenant-context';

/** Decodes the JWT payload without verifying it -- fine for a test asserting against a token this same process just issued. */
function decodeJwtTenantId(token: string): string {
  const [, payload] = token.split('.');
  return JSON.parse(Buffer.from(payload, 'base64').toString()).tenantId;
}

/**
 * Integration test against the real database, exercising signup, login,
 * and the protected /me endpoint end to end -- including the two real bugs
 * this increment found and fixed (see DECISIONS.md §17-§18), which manual
 * single-connection testing did not catch. Each run uses a fresh random
 * slug/email so repeated runs never collide; this is a dev database, not
 * production, so the created rows are not cleaned up afterwards.
 */
describe('Auth', () => {
  let app: INestApplication;
  let sql: postgres.Sql;
  let tenantId: string;
  const suffix = randomUUID().slice(0, 8);
  const tenantSlug = `test-tenant-${suffix}`;
  const email = `owner-${suffix}@test.local`;
  const password = 'correcthorsebattery';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    sql = createDbConnection(process.env.DATABASE_URL!).sql;
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
  });

  it('rejects signup with an invalid payload', async () => {
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email: 'not-an-email' })
      .expect(400);
  });

  it('signs up a new tenant and returns a usable token', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        companyLegalName: 'Test Warehousing Pvt Ltd',
        tenantSlug,
        email,
        fullName: 'Test Owner',
        password,
      })
      .expect(201);

    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.role).toBe('owner');
    expect(res.body.tenant.slug).toBe(tenantSlug);
    tenantId = decodeJwtTenantId(res.body.accessToken);
  });

  it('recorded a create audit_logs entry for the signup, with IP captured', async () => {
    const rows = await withTenant(sql, tenantId, (tx) => tx<
      { action: string; entity_type: string; ip_address: string }[]
    >`select action, entity_type, ip_address from audit_logs where tenant_id = ${tenantId}`);

    expect(rows).toEqual([
      expect.objectContaining({ action: 'create', entity_type: 'tenant' }),
    ]);
    expect(rows[0].ip_address).toBeTruthy();
  });

  it('rejects a duplicate signup with the same email', async () => {
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        companyLegalName: 'Someone Else Pvt Ltd',
        tenantSlug: `${tenantSlug}-dup`,
        email,
        fullName: 'Someone Else',
        password,
      })
      .expect(409);
  });

  it('rejects login with the wrong password', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'wrong-password' })
      .expect(401);
  });

  it('recorded a login_failed audit_logs entry for the wrong password', async () => {
    const rows = await withTenant(sql, tenantId, (tx) => tx<
      { action: string }[]
    >`select action from audit_logs where tenant_id = ${tenantId} and action = 'login_failed'`);
    expect(rows).toHaveLength(1);
  });

  it('logs in with the right password and returns a token', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);

    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.tenant.slug).toBe(tenantSlug);
  });

  it('recorded a login audit_logs entry for the successful login', async () => {
    const rows = await withTenant(sql, tenantId, (tx) => tx<
      { action: string }[]
    >`select action from audit_logs where tenant_id = ${tenantId} and action = 'login'`);
    expect(rows).toHaveLength(1);
  });

  it('rejects /me with no token', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
  });

  it('rejects /me with a garbage token', async () => {
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', 'Bearer not-a-real-token')
      .expect(401);
  });

  it('returns the authenticated tenant on /me, repeatedly, across a reused connection pool', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);
    const token = login.body.accessToken;

    // Run several times in a row: this is exactly what exposed the
    // connection-reuse empty-string GUC bug in DECISIONS.md §18 --
    // a single call was not enough to catch it.
    for (let i = 0; i < 3; i++) {
      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.user.email).toBe(email);
      expect(res.body.role.code).toBe('owner');
      expect(res.body.tenant.slug).toBe(tenantSlug);
    }
  });
});
