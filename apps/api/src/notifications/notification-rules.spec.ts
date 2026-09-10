import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import type postgres from 'postgres';
import { AppModule } from '../app.module';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { EMITTED_RULE_CODES } from './notification-rules.service';
import { NotificationsService } from './notifications.service';

/**
 * The rules were always data (blueprint §56) and the delivery adapters
 * made them consequential -- these prove that an operator can now change
 * one through the API, that the change is what actually decides delivery,
 * and that the two ways of getting it wrong (an event code nothing emits,
 * a role nobody holds) are refused rather than silently saved.
 */
describe('Notification rules', () => {
  let app: INestApplication;
  let sql: postgres.Sql;
  const suffix = randomUUID().slice(0, 8);
  const password = 'correcthorsebattery';
  let owner = '';
  let operator = '';
  let tenantId = '';
  let managerUserId = '';

  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${owner}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    sql = app.get(PG_CONNECTION);

    owner = (
      await api().post('/auth/signup')
        .send({ companyLegalName: 'Rules Ltd', tenantSlug: `nr-${suffix}`, email: `owner-${suffix}@test.local`, fullName: 'Owner', password })
        .expect(201)
    ).body.accessToken;
    tenantId = JSON.parse(Buffer.from(owner.split('.')[1], 'base64url').toString()).tenantId;

    await api().post('/users').set(auth())
      .send({ email: `mgr-${suffix}@test.local`, fullName: 'Manager', password, roleCode: 'warehouse_manager' })
      .expect(201);
    await api().post('/users').set(auth())
      .send({ email: `op-${suffix}@test.local`, fullName: 'Operator', password, roleCode: 'warehouse_operator' })
      .expect(201);
    const [manager] = await sql<{ id: string }[]>`select id from users where email = ${`mgr-${suffix}@test.local`}`;
    managerUserId = manager.id;
    operator = (await api().post('/auth/login').send({ email: `op-${suffix}@test.local`, password }).expect(201)).body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  const rule = async (code: string) =>
    (await api().get('/notification-rules').set(auth()).expect(200)).body.find((r: { code: string }) => r.code === code);

  it('lists the seeded system rules, none of them customised yet', async () => {
    const items = (await api().get('/notification-rules').set(auth()).expect(200)).body;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((r: { isCustomised: boolean }) => r.isCustomised === false)).toBe(true);
    expect(await rule('grn_pending_approval')).toMatchObject({ channels: ['in_app'], isActive: true });
  });

  it('is refused to a role without manage_company_settings', async () => {
    await api().get('/notification-rules').set({ Authorization: `Bearer ${operator}` }).expect(403);
    await api().put('/notification-rules/grn_pending_approval')
      .set({ Authorization: `Bearer ${operator}` })
      .send({ channels: ['in_app'] })
      .expect(403);
  });

  it("replaces the system default with the tenant's own row, and audits it", async () => {
    const saved = await api().put('/notification-rules/grn_pending_approval').set(auth())
      .send({ channels: ['in_app', 'email'], audienceRoleCodes: ['warehouse_manager'] })
      .expect(200);
    expect(saved.body).toMatchObject({
      code: 'grn_pending_approval',
      channels: ['in_app', 'email'],
      audienceRoleCodes: ['warehouse_manager'],
      isCustomised: true,
    });

    // Replaced, not merged, and reported as this workspace's own choice.
    expect(await rule('grn_pending_approval')).toMatchObject({ channels: ['in_app', 'email'], isCustomised: true });

    const [audited] = await withTenant(sql, tenantId, (tx) => tx<{ action: string; new_value: Record<string, unknown> }[]>`
      select action, new_value from audit_logs
      where tenant_id = ${tenantId} and entity_type = 'notification_rule' order by occurred_at desc limit 1
    `);
    expect(audited).toMatchObject({ action: 'create' });
    expect(audited.new_value).toMatchObject({ channels: ['in_app', 'email'] });
  });

  it('is what the emitter then obeys: two channels for the audience, nothing for anyone else', async () => {
    const before = await withTenant(sql, tenantId, (tx) => tx<{ count: string }[]>`
      select count(*)::text as count from notifications where tenant_id = ${tenantId}
    `);
    await app.get(NotificationsService).emit(tenantId, {
      ruleCode: 'grn_pending_approval',
      title: 'GRN waiting for approval',
    });
    const rows = await withTenant(sql, tenantId, (tx) => tx<{ channel: string; recipient_user_id: string }[]>`
      select channel, recipient_user_id from notifications where tenant_id = ${tenantId} order by channel
    `);
    expect(Number(before[0].count)).toBe(0);
    // The manager holds the audience role; the owner and the operator do not.
    expect(rows.map((r) => r.channel)).toEqual(['email', 'in_app']);
    expect(new Set(rows.map((r) => r.recipient_user_id))).toEqual(new Set([managerUserId]));
  });

  it('switches an event off without deleting the override', async () => {
    await api().put('/notification-rules/grn_pending_approval').set(auth())
      .send({ channels: ['in_app'], audienceRoleCodes: ['warehouse_manager'], isActive: false })
      .expect(200);
    expect(await app.get(NotificationsService).emit(tenantId, { ruleCode: 'grn_pending_approval', title: 'Ignored' })).toBe(0);
    expect(await rule('grn_pending_approval')).toMatchObject({ isActive: false, isCustomised: true });
  });

  it('refuses an event code nothing emits, and a role nobody can hold', async () => {
    await api().put('/notification-rules/vehicle_is_late').set(auth())
      .send({ channels: ['in_app'] })
      .expect(404);
    await api().put('/notification-rules/pod_pending').set(auth())
      .send({ channels: ['in_app'], audienceRoleCodes: ['warehouse_manger'] })
      .expect(400);
    // `customer` is a real role, but a portal login is not staff and the
    // emitter excludes it -- so it would address nobody.
    await api().put('/notification-rules/pod_pending').set(auth())
      .send({ channels: ['in_app'], audienceRoleCodes: ['customer'] })
      .expect(400);
    await api().put('/notification-rules/pod_pending').set(auth())
      .send({ channels: ['carrier_pigeon'] })
      .expect(400);
    await api().put('/notification-rules/pod_pending').set(auth())
      .send({ channels: [] })
      .expect(400);
    expect(await rule('pod_pending')).toMatchObject({ isCustomised: false });
  });

  /**
   * `EMITTED_RULE_CODES` is what tells the screen "nothing raises this
   * yet". It is a hand-written list, so it is checked against the source
   * tree rather than trusted: add an emit call without adding the code
   * here and this fails, which is the only way the badge stays true.
   */
  it('knows exactly which event codes something actually emits', () => {
    const src = join(__dirname, '..');
    const emitted = new Set<string>();
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
          for (const [, code] of readFileSync(full, 'utf8').matchAll(/ruleCode: '([a-z_]+)'/g)) {
            emitted.add(code);
          }
        }
      }
    };
    walk(src);
    expect([...emitted].sort()).toEqual([...EMITTED_RULE_CODES].sort());
  });

  it('cannot write a system-wide rule that would apply to every other tenant', async () => {
    await expect(
      withTenant(sql, tenantId, (tx) => tx`
        insert into notification_rules (id, tenant_id, code, channels, is_active)
        values (gen_random_uuid(), null, 'grn_pending_approval', ${['sms']}, true)
      `),
    ).rejects.toThrow(/row-level security/i);
  });
});
