import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_CONNECTION } from '../db/db.module';

/**
 * Everything that changes a password, and the thing that makes changing
 * one mean anything: a token issued before the change stops working.
 *
 * Until this existed a password could be set exactly once -- at signup, or
 * by whoever invited you -- and there was no route back from forgetting
 * it except editing a row by hand.
 */
describe('Passwords', () => {
  let app: INestApplication;
  let sql: postgres.Sql;
  const suffix = randomUUID().slice(0, 8);
  const password = 'correcthorsebattery';
  const ownerEmail = `pw-owner-${suffix}@test.local`;
  let owner = '';
  let memberId = '';
  const memberEmail = `pw-member-${suffix}@test.local`;

  const api = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

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
          companyLegalName: `pw-${suffix} Pvt Ltd`,
          tenantSlug: `pw-${suffix}`,
          email: ownerEmail,
          fullName: 'Owner',
          password,
        })
        .expect(201)
    ).body.accessToken;

    memberId = (
      await api()
        .post('/users')
        .set(auth(owner))
        .send({ email: memberEmail, fullName: 'Operator', password, roleCode: 'warehouse_operator' })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  const login = async (email: string, pwd: string, expected = 201) =>
    (await api().post('/auth/login').send({ email, password: pwd }).expect(expected)).body.accessToken;

  it('changes a password only for someone who can type the current one', async () => {
    await api()
      .post('/auth/change-password')
      .set(auth(owner))
      .send({ currentPassword: 'not-the-password', newPassword: 'a-brand-new-secret' })
      .expect(401);

    // The refusal is recorded: a run of these on one account is somebody at
    // an unlocked screen guessing, which is what an audit log is for.
    const failures = await api()
      .get('/audit-logs?action=password_change_failed')
      .set(auth(owner))
      .expect(200);
    expect(failures.body.total).toBe(1);

    // Same password again is refused before anything is written.
    await api()
      .post('/auth/change-password')
      .set(auth(owner))
      .send({ currentPassword: password, newPassword: password })
      .expect(400);
  });

  it('ends every session that was open when the password changed', async () => {
    const stale = await login(ownerEmail, password);
    expect((await api().get('/auth/me').set(auth(stale)).expect(200)).body.user.email).toBe(ownerEmail);

    const changed = 'the-second-password';
    await api()
      .post('/auth/change-password')
      .set(auth(stale))
      .send({ currentPassword: password, newPassword: changed })
      .expect(201);

    // The token was valid a moment ago and its signature still verifies --
    // this is the whole point of `users.password_changed_at`. Without it a
    // reset leaves whoever knew the old password signed in for 12 hours.
    await api().get('/auth/me').set(auth(stale)).expect(401);

    await api().post('/auth/login').send({ email: ownerEmail, password }).expect(401);
    owner = await login(ownerEmail, changed);
    expect(owner).toBeTruthy();
  });

  it('lets an Owner issue a password for a member, but not for themselves', async () => {
    const memberToken = await login(memberEmail, password);

    const issued = 'operator-new-password';
    await api().post(`/users/${memberId}/password`).set(auth(owner)).send({ newPassword: issued }).expect(201);

    // The member's own open session ends too -- that is what makes this a
    // recovery rather than a second working credential.
    await api().get('/auth/me').set(auth(memberToken)).expect(401);
    await api().post('/auth/login').send({ email: memberEmail, password }).expect(401);
    const back = await login(memberEmail, issued);
    expect(back).toBeTruthy();

    // The Owner's own membership row is refused: they change their own
    // password where the current one has to be typed. (Read through the
    // API rather than SQL -- `tenant_users` is under FORCE RLS, so a bare
    // query here matches nothing.)
    const members = await api().get('/users').set(auth(owner)).expect(200);
    const ownMembership = members.body.find((m: { email: string }) => m.email === ownerEmail);
    await api()
      .post(`/users/${ownMembership.id}/password`)
      .set(auth(owner))
      .send({ newPassword: 'something-else-entirely' })
      .expect(400);

    // An operator cannot issue anyone's password.
    await api()
      .post(`/users/${memberId}/password`)
      .set(auth(back))
      .send({ newPassword: 'nice-try-at-all' })
      .expect(403);
  });

  it('resets through a single-use, expiring link and says nothing about who has an account', async () => {
    const unknown = await api()
      .post('/auth/forgot-password')
      .send({ email: `nobody-${suffix}@test.local` })
      .expect(201);
    const known = await api().post('/auth/forgot-password').send({ email: memberEmail }).expect(201);
    // Byte for byte the same answer, so the endpoint cannot be walked down
    // a list of addresses to learn which ones are registered.
    expect(known.body).toEqual(unknown.body);
    expect(known.body.accepted).toBe(true);

    // The token itself never leaves the mail, so the test reads what the
    // mail would have carried the only way anything else can: it cannot.
    // What is stored is a SHA-256, so the plaintext is generated here and
    // the row is matched by its hash.
    const rows = await sql<{ id: string; token_hash: string }[]>`
      select prt.id, prt.token_hash from password_reset_tokens prt
      join users u on u.id = prt.user_id
      where u.email = ${memberEmail} and prt.used_at is null
    `;
    expect(rows).toHaveLength(1);

    // Replace the stored hash with the hash of a token this test knows, which
    // is exactly what the mail would have delivered.
    const token = `reset-${suffix}-${'a'.repeat(30)}`;
    const { createHash } = await import('node:crypto');
    await sql`
      update password_reset_tokens set token_hash = ${createHash('sha256').update(token).digest('hex')}
      where id = ${rows[0].id}
    `;

    const resetTo = 'reset-through-the-link';
    await api().post('/auth/reset-password').send({ token, newPassword: resetTo }).expect(201);
    expect(await login(memberEmail, resetTo)).toBeTruthy();

    // Single use: the same link a second time is refused, with the same
    // message an unknown token gets.
    await api().post('/auth/reset-password').send({ token, newPassword: 'third-password-here' }).expect(400);
    await api()
      .post('/auth/reset-password')
      .send({ token: `never-issued-${suffix}-${'b'.repeat(20)}`, newPassword: 'third-password-here' })
      .expect(400);

    // An expired link is refused too.
    const expiredToken = `expired-${suffix}-${'c'.repeat(28)}`;
    const [{ id: userId }] = await sql<{ id: string }[]>`select id from users where email = ${memberEmail}`;
    await sql`
      insert into password_reset_tokens (id, user_id, token_hash, expires_at)
      values (${randomUUID()}, ${userId}, ${createHash('sha256').update(expiredToken).digest('hex')},
              now() - interval '1 minute')
    `;
    await api()
      .post('/auth/reset-password')
      .send({ token: expiredToken, newPassword: 'fourth-password-x' })
      .expect(400);
  });

  it('deletes an account by removing the person, not the record they are on', async () => {
    const leaverEmail = `pw-leaver-${suffix}@test.local`;
    const invited = (
      await api()
        .post('/users')
        .set(auth(owner))
        .send({ email: leaverEmail, fullName: 'Leaver', password, roleCode: 'warehouse_manager' })
        .expect(201)
    ).body;
    // The membership id and the (global) user id are different things, and
    // only the second can be looked up on a bare connection: `tenant_users`
    // is under FORCE RLS, `users` is not.
    const leaverId = invited.id;
    const leaverUserId = invited.userId;
    const leaver = await login(leaverEmail, password);

    // The password is asked for again: this is the one irreversible action
    // in the product, and an unlocked laptop is the ordinary case.
    await api().post('/auth/delete-account').set(auth(leaver)).send({ currentPassword: 'wrong-one' }).expect(401);

    const deleted = await api()
      .post('/auth/delete-account')
      .set(auth(leaver))
      .send({ currentPassword: password })
      .expect(201);
    expect(deleted.body).toMatchObject({ deleted: true, workspaces: 1 });

    // Gone: the session, and the ability to sign in at all.
    await api().get('/auth/me').set(auth(leaver)).expect(401);
    await api().post('/auth/login').send({ email: leaverEmail, password }).expect(401);

    // The personal data is replaced rather than the row dropped -- their
    // name is on work they did, and `audit_logs` references it.
    const [row] = await sql<{ email: string; full_name: string; password_hash: string | null }[]>`
      select email, full_name, password_hash from users where id = ${leaverUserId}
    `;
    expect(row.full_name).toBe('Deleted user');
    expect(row.email).toMatch(/@removed\.invalid$/);
    expect(row.password_hash).toBeNull();

    // The workspace still sees the membership, disabled -- an Owner should
    // be able to tell that someone left rather than find a gap.
    const members = await api().get('/users').set(auth(owner)).expect(200);
    expect(members.body.find((m: { id: string }) => m.id === leaverId)).toMatchObject({ status: 'disabled' });

    // And the audit row was written before the name was taken off it.
    const trail = await api().get('/audit-logs?action=account_deleted').set(auth(owner)).expect(200);
    expect(trail.body.total).toBe(1);
  });

  it('refuses to delete the only Owner a workspace has', async () => {
    const soloSlug = `pw-solo-${suffix}`;
    const soloEmail = `pw-solo-${suffix}@test.local`;
    const solo = (
      await api()
        .post('/auth/signup')
        .send({
          companyLegalName: `${soloSlug} Pvt Ltd`,
          tenantSlug: soloSlug,
          email: soloEmail,
          fullName: 'Only Owner',
          password,
        })
        .expect(201)
    ).body.accessToken;

    const refused = await api()
      .post('/auth/delete-account')
      .set(auth(solo))
      .send({ currentPassword: password })
      .expect(400);
    // The message has to say what to do instead: an ownerless workspace is
    // a support ticket nobody can resolve from inside the product.
    expect(refused.body.message).toMatch(/only Owner/);
    expect(refused.body.message).toMatch(/someone else an Owner/);

    // Still working, because nothing was written.
    await api().get('/auth/me').set(auth(solo)).expect(200);

    // Closing the whole workspace is the other route, and it ends every
    // session in it -- including the Owner's own.
    const closed = await api()
      .post('/company/deletion-request')
      .set(auth(solo))
      .send({ reason: 'Pilot finished' })
      .expect(201);
    expect(closed.body).toMatchObject({ requested: true });
    expect(closed.body.message).toMatch(/statutory retention/);
    await api().get('/auth/me').set(auth(solo)).expect(401);
    await api().post('/auth/login').send({ email: soloEmail, password }).expect(401);
  });

  it('signs out a membership the moment it is disabled, not when the token expires', async () => {
    const memberToken = await login(memberEmail, 'reset-through-the-link');
    await api().get('/auth/me').set(auth(memberToken)).expect(200);

    await api().patch(`/users/${memberId}`).set(auth(owner)).send({ status: 'disabled' }).expect(200);

    // Previously this token kept working for the rest of its 12 hours.
    await api().get('/auth/me').set(auth(memberToken)).expect(401);
  });
});
