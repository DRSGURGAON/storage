import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../app.module';

/** Phase 1's "invite users, assign roles" deliverable, through HTTP. */
describe('Users (memberships)', () => {
  let app: INestApplication;
  const suffix = randomUUID().slice(0, 8);
  const password = 'correcthorsebattery';
  let owner = '';
  let otherOwner = '';
  let memberId = '';
  const memberEmail = `member-${suffix}@test.local`;

  const signup = async (slug: string, email: string) => {
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ companyLegalName: `${slug} Pvt Ltd`, tenantSlug: slug, email, fullName: 'Owner', password })
      .expect(201);
    return res.body.accessToken as string;
  };
  const login = async (email: string, tenantSlug?: string) => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password, tenantSlug })
      .expect(201);
    return res.body.accessToken as string;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    owner = await signup(`users-a-${suffix}`, `owner-a-${suffix}@test.local`);
    otherOwner = await signup(`users-b-${suffix}`, `owner-b-${suffix}@test.local`);
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists the owner as the only member of a fresh tenant', async () => {
    const res = await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${owner}`)
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].role.code).toBe('owner');
  });

  it('requires a password for an email with no account yet', async () => {
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${owner}`)
      .send({ email: memberEmail, fullName: 'Member', roleCode: 'warehouse_operator' })
      .expect(400);
  });

  it('rejects the customer role here -- that is the portal (V1.1)', async () => {
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${owner}`)
      .send({ email: memberEmail, fullName: 'Member', password, roleCode: 'customer' })
      .expect(400);
  });

  it('adds a member who can then log in with the assigned role', async () => {
    const res = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${owner}`)
      .send({ email: memberEmail, fullName: 'Member', password, roleCode: 'warehouse_operator' })
      .expect(201);
    expect(res.body.role.code).toBe('warehouse_operator');
    expect(res.body.status).toBe('active');
    memberId = res.body.id;

    const token = await login(memberEmail);
    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(me.body.role.code).toBe('warehouse_operator');
  });

  it('rejects adding the same member twice', async () => {
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${owner}`)
      .send({ email: memberEmail, fullName: 'Member', password, roleCode: 'accountant' })
      .expect(409);
  });

  it('an existing account joins a second tenant as a new membership, password untouched', async () => {
    // `password` is required whether or not the address already has an
    // account, and is ignored when it does. It used to be optional, with a
    // 400 saying a password was needed "when the email has no account
    // yet" -- which answered, for any tenant admin and any address they
    // cared to try, whether that address was registered *anywhere on the
    // platform*, other tenants included. The membership is tenant-scoped;
    // that answer was not.
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${otherOwner}`)
      .send({ email: memberEmail, fullName: 'Member', roleCode: 'accountant' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${otherOwner}`)
      .send({ email: `never-seen-${suffix}@test.local`, fullName: 'Nobody', roleCode: 'accountant' })
      .expect(400);

    const res = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${otherOwner}`)
      .send({ email: memberEmail, fullName: 'Member', password: 'a-different-password', roleCode: 'accountant' })
      .expect(201);
    expect(res.body.role.code).toBe('accountant');

    // Now belongs to two tenants: login must ask which, and the *original*
    // password still works for both -- the one supplied just now was
    // discarded, not applied to an account this admin does not own.
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: memberEmail, password })
      .expect(409);
    const token = await login(memberEmail, `users-b-${suffix}`);
    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(me.body.role.code).toBe('accountant');
  });

  it('a role change takes effect on the member\'s existing token, not at expiry', async () => {
    const memberToken = await login(memberEmail, `users-a-${suffix}`);
    await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/users/${memberId}`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ roleCode: 'admin' })
      .expect(200);

    await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/users/${memberId}`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ status: 'disabled' })
      .expect(200);

    await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(403);
  });

  it('refuses to let an owner change their own membership', async () => {
    const list = await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${owner}`)
      .expect(200);
    const self = list.body.find((m: { role: { code: string } }) => m.role.code === 'owner');
    await request(app.getHttpServer())
      .patch(`/users/${self.id}`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ status: 'disabled' })
      .expect(400);
  });

  it('refuses to demote the last active owner', async () => {
    // Add a second admin who then tries to demote the sole owner.
    const adminEmail = `admin-${suffix}@test.local`;
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${owner}`)
      .send({ email: adminEmail, fullName: 'Admin', password, roleCode: 'admin' })
      .expect(201);
    const adminToken = await login(adminEmail);
    const list = await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const soleOwner = list.body.find((m: { role: { code: string } }) => m.role.code === 'owner');

    const res = await request(app.getHttpServer())
      .patch(`/users/${soleOwner.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ roleCode: 'accountant' })
      .expect(400);
    expect(res.body.message).toMatch(/at least one active Owner/);
  });

  it('cannot see or edit another tenant\'s memberships', async () => {
    const list = await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${otherOwner}`)
      .expect(200);
    expect(list.body.map((m: { id: string }) => m.id)).not.toContain(memberId);

    await request(app.getHttpServer())
      .patch(`/users/${memberId}`)
      .set('Authorization', `Bearer ${otherOwner}`)
      .send({ roleCode: 'admin' })
      .expect(404);
  });
});
