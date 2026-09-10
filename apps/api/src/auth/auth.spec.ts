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
      expect(res.body.tenant.isDemo).toBe(false);
      // The caller's live grants, so a client can draw the right screen
      // instead of offering actions that will come back 403. Resolved per
      // request from `role_permissions`, not carried in the token: a role
      // change has to bite now, not at expiry.
      expect(res.body.permissions).toEqual(expect.arrayContaining(['approve_grn', 'create_customer', 'view_documents']));
      expect(res.body.permissions).toEqual([...res.body.permissions].sort());
    }
  });

  it('gives a Warehouse Operator only the operator grants on /me', async () => {
    const operatorEmail = `op-${suffix}@test.local`;
    const owner = (await request(app.getHttpServer()).post('/auth/login').send({ email, password }).expect(201)).body.accessToken;
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${owner}`)
      .send({ email: operatorEmail, fullName: 'Operator', password, roleCode: 'warehouse_operator' })
      .expect(201);
    const operator = (await request(app.getHttpServer()).post('/auth/login').send({ email: operatorEmail, password }).expect(201)).body.accessToken;

    const me = await request(app.getHttpServer()).get('/auth/me').set('Authorization', `Bearer ${operator}`).expect(200);
    expect(me.body.permissions).toContain('create_grn');
    // §50's Operator → Manager split, visible to the client before it clicks.
    expect(me.body.permissions).not.toContain('approve_grn');
    expect(me.body.permissions).not.toContain('create_customer');
  });

  it('throttles repeated login attempts against one account, without penalising the rest of the office', async () => {
    // Passwords are argon2id at 64 MiB a hash, so unlimited attempts are
    // both a guessing oracle and a cheap way to make the server do 64 MiB
    // of work per anonymous request. The limit is keyed on (IP, email)
    // rather than IP alone: a warehouse office behind one NAT address must
    // not throttle itself, while guessing one password has to stop.
    const victim = `victim-${suffix}@test.local`;
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ companyLegalName: 'Victim Ltd', tenantSlug: `victim-${suffix}`, email: victim, fullName: 'Vic', password })
      .expect(201);

    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const res = await request(app.getHttpServer()).post('/auth/login').send({ email: victim, password: 'wrong-guess' });
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
    // The first few are answered normally; the limit bites part way in
    // rather than at the first attempt (a real person mistypes a password).
    expect(statuses[0]).toBe(401);
    expect(statuses[statuses.length - 1]).toBe(429);

    // Locked out for that account -- even with the correct password, which
    // is the point: guessing cannot be distinguished from succeeding.
    await request(app.getHttpServer()).post('/auth/login').send({ email: victim, password }).expect(429);

    // A different account from the same address is unaffected. This is the
    // whole reason the key includes the email.
    const colleague = `colleague-${suffix}@test.local`;
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        companyLegalName: 'Colleague Ltd',
        tenantSlug: `colleague-${suffix}`,
        email: colleague,
        fullName: 'Colleague',
        password,
      })
      .expect(201);
    await request(app.getHttpServer()).post('/auth/login').send({ email: colleague, password }).expect(201);
  });

  it('takes the same work on a login for an unknown email as for a real one', async () => {
    // Returning early for an unknown address answered in a millisecond
    // while a real account spent ~100ms in argon2 -- a timing oracle for
    // "does this email have an account?", readable without even looking at
    // the response body. A fixed dummy hash is verified instead, so both
    // paths do the same work.
    const known = `timing-known-${suffix}@test.local`;
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ companyLegalName: 'Timing Ltd', tenantSlug: `timing-${suffix}`, email: known, fullName: 'Tim', password })
      .expect(201);

    const time = async (email: string) => {
      const started = process.hrtime.bigint();
      await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'definitely-wrong' }).expect(401);
      return Number(process.hrtime.bigint() - started) / 1e6;
    };
    const knownMs = await time(known);
    const unknownMs = await time(`timing-nobody-${suffix}@test.local`);

    // Both should sit in the same order of magnitude -- an argon2 verify.
    // Asserted as a ratio rather than an absolute, since CI machines vary,
    // and loosely enough not to flake: before the fix the unknown path was
    // ~100x faster, so anything under 5x proves the early return is gone.
    expect(unknownMs).toBeGreaterThan(knownMs / 5);
    expect(unknownMs).toBeLessThan(knownMs * 5);
  });
});
