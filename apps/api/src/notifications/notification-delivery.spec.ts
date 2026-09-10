import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createServer, Server } from 'node:http';
import { createServer as createSocketServer, Server as SocketServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type postgres from 'postgres';
import { AppModule } from '../app.module';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { NotificationsService } from './notifications.service';

/**
 * Blueprint §56's other three channels, proven against things that
 * actually receive: a real SMTP conversation with a socket server that
 * speaks enough of RFC 5321 to accept a message, and a real HTTP POST to
 * a local endpoint. Nothing here is mocked at the adapter boundary --
 * `nodemailer` opens a socket and `fetch` opens a connection, which is
 * the only way to find out whether the adapter can actually send.
 */
describe('Notification delivery', () => {
  let app: INestApplication;
  let sql: postgres.Sql;
  let smtp: SocketServer;
  let webhook: Server;
  const received: string[] = [];
  const posted: Record<string, unknown>[] = [];
  let webhookStatus = 200;
  const suffix = randomUUID().slice(0, 8);
  const password = 'correcthorsebattery';
  let owner = '';
  let tenantId = '';
  let managerUserId = '';

  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${owner}` });

  /**
   * A four-line SMTP server. It greets, says OK to everything, collects
   * the DATA block, and quits -- enough for nodemailer to complete a real
   * session, and small enough to read.
   */
  const startSmtp = () =>
    new Promise<number>((resolve) => {
      smtp = createSocketServer((socket) => {
        let inData = false;
        let message = '';
        socket.write('220 localhost ESMTP test\r\n');
        socket.on('data', (chunk) => {
          const text = chunk.toString();
          if (inData) {
            message += text;
            if (message.includes('\r\n.\r\n')) {
              inData = false;
              received.push(message);
              message = '';
              socket.write('250 OK queued\r\n');
            }
            return;
          }
          for (const line of text.split('\r\n').filter(Boolean)) {
            const verb = line.split(' ')[0].toUpperCase();
            if (verb === 'EHLO' || verb === 'HELO') socket.write('250-localhost\r\n250 HELP\r\n');
            else if (verb === 'DATA') {
              inData = true;
              socket.write('354 Send data\r\n');
            } else if (verb === 'QUIT') {
              socket.write('221 Bye\r\n');
              socket.end();
            } else socket.write('250 OK\r\n');
          }
        });
        socket.on('error', () => undefined);
      });
      smtp.listen(0, '127.0.0.1', () => resolve((smtp.address() as { port: number }).port));
    });

  const startWebhook = () =>
    new Promise<number>((resolve) => {
      webhook = createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          posted.push({ ...JSON.parse(body), authorization: req.headers.authorization });
          res.writeHead(webhookStatus, { 'content-type': 'text/plain' });
          res.end(webhookStatus === 200 ? 'ok' : 'provider rejected the number');
        });
      });
      webhook.listen(0, '127.0.0.1', () => resolve((webhook.address() as { port: number }).port));
    });

  beforeAll(async () => {
    const smtpPort = await startSmtp();
    const webhookPort = await startWebhook();
    process.env.SMTP_URL = `smtp://127.0.0.1:${smtpPort}`;
    process.env.NOTIFICATION_FROM_EMAIL = 'warehouse@test.local';
    process.env.SMS_WEBHOOK_URL = `http://127.0.0.1:${webhookPort}/sms`;
    process.env.SMS_WEBHOOK_TOKEN = 'sms-token';
    delete process.env.WHATSAPP_WEBHOOK_URL;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    sql = app.get(PG_CONNECTION);

    owner = (
      await api()
        .post('/auth/signup')
        .send({ companyLegalName: 'Notify Ltd', tenantSlug: `nt-${suffix}`, email: `owner-${suffix}@test.local`, fullName: 'Owner', password })
        .expect(201)
    ).body.accessToken;
    tenantId = JSON.parse(Buffer.from(owner.split('.')[1], 'base64url').toString()).tenantId;

    // A manager with a mobile number, so the SMS channel has somewhere to go.
    await api().post('/users').set(auth())
      .send({ email: `mgr-${suffix}@test.local`, fullName: 'Manager', password, roleCode: 'warehouse_manager', mobile: '9811122233' })
      .expect(201);
    const [manager] = await sql<{ id: string }[]>`select id from users where email = ${`mgr-${suffix}@test.local`}`;
    managerUserId = manager.id;
  });

  afterAll(async () => {
    await app.close();
    smtp?.close();
    webhook?.close();
    delete process.env.SMTP_URL;
    delete process.env.SMS_WEBHOOK_URL;
    delete process.env.SMS_WEBHOOK_TOKEN;
  });

  const emit = async (channels: string[], title: string) => {
    await withTenant(sql, tenantId, async (tx) => {
      // The tenant's own override of the seeded rule -- which is exactly how a
      // real workspace turns a channel on: a row, not a deploy.
      await tx`delete from notification_rules where tenant_id = ${tenantId} and code = 'grn_pending_approval'`;
      await tx`
        insert into notification_rules (id, tenant_id, code, channels, audience_role_codes, is_active)
        values (gen_random_uuid(), ${tenantId}, 'grn_pending_approval', ${channels}, ${['warehouse_manager']}, true)
      `;
    });
    await withTenant(sql, tenantId, (tx) =>
      app.get(NotificationsService).emitWithin(tx, tenantId, {
        ruleCode: 'grn_pending_approval',
        title,
        body: 'GRN/26-27/000001 is waiting for approval',
        severity: 'warning',
      }),
    );
  };

  const rows = () =>
    withTenant(sql, tenantId, (tx) => tx<{ channel: string; delivery_status: string; attempt_count: number; last_error: string | null; sent_at: Date | null }[]>`
      select channel, delivery_status, attempt_count, last_error, sent_at from notifications
      where tenant_id = ${tenantId} and recipient_user_id = ${managerUserId} order by channel
    `);

  it('writes one row per channel: in-app delivered in the transaction, the rest pending', async () => {
    await emit(['in_app', 'email', 'sms'], 'GRN waiting for approval');
    const written = await rows();
    expect(written.map((r) => `${r.channel}:${r.delivery_status}`)).toEqual([
      'email:pending', 'in_app:sent', 'sms:pending',
    ]);

    // The bell shows the event once, not once per channel it was sent by.
    const manager = (await api().post('/auth/login').send({ email: `mgr-${suffix}@test.local`, password }).expect(201)).body.accessToken;
    const bell = await api().get('/notifications').set({ Authorization: `Bearer ${manager}` }).expect(200);
    expect(bell.body.items).toHaveLength(1);
    expect(bell.body.unreadCount).toBe(1);
  });

  it('sends the email over a real SMTP session and the SMS over a real HTTP POST', async () => {
    const result = await app.get(NotificationDispatcherService).dispatchTenant(tenantId);
    expect(result).toMatchObject({ sent: 2, failed: 0, skipped: 0 });

    const mail = received.join('\n');
    expect(mail).toContain(`To: mgr-${suffix}@test.local`);
    expect(mail).toContain('From: warehouse@test.local');
    expect(mail).toContain('Subject: GRN waiting for approval');

    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      channel: 'sms',
      to: '9811122233',
      subject: 'GRN waiting for approval',
      severity: 'warning',
      authorization: 'Bearer sms-token',
    });

    const written = await rows();
    for (const row of written.filter((r) => r.channel !== 'in_app')) {
      expect(row.delivery_status).toBe('sent');
      expect(row.attempt_count).toBe(1);
      expect(row.sent_at).not.toBeNull();
    }

    // A second pass has nothing left to do -- delivery is not repeated.
    expect(await app.get(NotificationDispatcherService).dispatchTenant(tenantId)).toMatchObject({ sent: 0, failed: 0 });
  });

  it('records the provider’s own words on failure, retries, and eventually gives up', async () => {
    process.env.NOTIFICATION_MAX_ATTEMPTS = '2';
    webhookStatus = 500;
    await withTenant(sql, tenantId, (tx) => tx`delete from notifications where tenant_id = ${tenantId}`);
    await emit(['sms'], 'Second attempt');

    const dispatcher = app.get(NotificationDispatcherService);
    expect(await dispatcher.dispatchTenant(tenantId)).toMatchObject({ sent: 0, failed: 1 });
    let [row] = await rows();
    // Still pending: one failure is not a verdict.
    expect(row).toMatchObject({ delivery_status: 'pending', attempt_count: 1 });
    expect(row.last_error).toMatch(/returned 500/);
    expect(row.last_error).toMatch(/provider rejected the number/);

    expect(await dispatcher.dispatchTenant(tenantId)).toMatchObject({ sent: 0, failed: 1 });
    [row] = await rows();
    // Second failure hits the cap, so it stops being retried -- with the
    // reason still readable, which is the whole point of keeping it.
    expect(row).toMatchObject({ delivery_status: 'failed', attempt_count: 2 });
    expect(await dispatcher.dispatchTenant(tenantId)).toMatchObject({ sent: 0, failed: 0 });

    webhookStatus = 200;
    delete process.env.NOTIFICATION_MAX_ATTEMPTS;
  });

  it('leaves an unconfigured channel pending rather than claiming it was sent', async () => {
    await withTenant(sql, tenantId, (tx) => tx`delete from notifications where tenant_id = ${tenantId}`);
    await emit(['whatsapp'], 'Nobody configured WhatsApp');

    // WHATSAPP_WEBHOOK_URL is unset, so there is nowhere to send.
    expect(await app.get(NotificationDispatcherService).dispatchTenant(tenantId)).toMatchObject({ sent: 0, failed: 0, skipped: 1 });
    const [row] = await rows();
    expect(row).toMatchObject({ channel: 'whatsapp', delivery_status: 'pending', attempt_count: 0 });

    // Configure it, and the same row goes out -- nothing was lost by waiting.
    process.env.WHATSAPP_WEBHOOK_URL = process.env.SMS_WEBHOOK_URL;
    expect(await app.get(NotificationDispatcherService).dispatchTenant(tenantId)).toMatchObject({ sent: 1 });
    expect(posted[posted.length - 1]).toMatchObject({ channel: 'whatsapp', to: '9811122233' });
    delete process.env.WHATSAPP_WEBHOOK_URL;
  });

  it('delivers per tenant, because a global query under RLS would deliver nothing', async () => {
    const other = (
      await api().post('/auth/signup')
        .send({ companyLegalName: 'Other Ltd', tenantSlug: `nt2-${suffix}`, email: `other-${suffix}@test.local`, fullName: 'Owner', password })
        .expect(201)
    ).body.accessToken;
    const otherTenant = JSON.parse(Buffer.from(other.split('.')[1], 'base64url').toString()).tenantId;

    await withTenant(sql, tenantId, (tx) => tx`delete from notifications where tenant_id = ${tenantId}`);
    await emit(['sms'], 'Tenant A only');
    const before = posted.length;
    // Draining the *other* tenant must not send tenant A's message.
    expect(await app.get(NotificationDispatcherService).dispatchTenant(otherTenant)).toMatchObject({ sent: 0 });
    expect(posted).toHaveLength(before);
    // The all-tenants pass, which is what the cron runs, does send it.
    const all = await app.get(NotificationDispatcherService).dispatchAll();
    expect(all.sent).toBeGreaterThanOrEqual(1);
    expect(posted.length).toBeGreaterThan(before);
  });
});
