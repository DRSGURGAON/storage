import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type postgres from 'postgres';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { EmailChannel } from './channels/email.channel';
import { NotificationChannel, OutboundMessage } from './channels/notification-channel';
import { SmsChannel, WhatsappChannel } from './channels/webhook.channel';

interface PendingRow {
  id: string;
  channel: 'email' | 'whatsapp' | 'sms';
  title: string;
  body: string | null;
  severity: 'info' | 'warning' | 'critical';
  attempt_count: number;
  email: string | null;
  mobile: string | null;
}

/**
 * Blueprint §56's delivery worker: everything the channels deliberately
 * do not do -- who to send to, when, how often, and what to record.
 *
 * **Why a worker and not a send inside `emitWithin`.** Emission runs in
 * the caller's transaction, which is exactly right for the in-app row (a
 * rolled-back GRN must not leave a notification claiming it was
 * submitted) and exactly wrong for an SMTP conversation. Network I/O
 * inside a database transaction holds a connection open for the length of
 * someone else's outage, and a send that succeeds inside a transaction
 * that then rolls back cannot be taken back. So `emitWithin` writes
 * `delivery_status = 'pending'` and returns; this drains those rows after
 * the commit that created them.
 *
 * It loops over tenants rather than issuing one global query, for the
 * reason `DECISIONS.md` §44 records the hard way: `notifications` is under
 * FORCE ROW LEVEL SECURITY, so a query outside `withTenant` matches zero
 * rows and reports success -- a delivery worker that appears to run
 * perfectly and delivers nothing at all.
 */
@Injectable()
export class NotificationDispatcherService {
  private readonly logger = new Logger(NotificationDispatcherService.name);
  private readonly channels: Map<string, NotificationChannel>;

  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    email: EmailChannel,
    whatsapp: WhatsappChannel,
    sms: SmsChannel,
  ) {
    this.channels = new Map([email, whatsapp, sms].map((c) => [c.channel, c]));
  }

  private get maxAttempts(): number {
    const configured = Number(process.env.NOTIFICATION_MAX_ATTEMPTS);
    return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 5;
  }

  private get batchSize(): number {
    const configured = Number(process.env.NOTIFICATION_BATCH_SIZE);
    return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 100;
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async dispatchAll(): Promise<{ sent: number; failed: number; skipped: number }> {
    const tenants = await this.sql<{ id: string }[]>`select id from tenants where status = 'active'`;
    const total = { sent: 0, failed: 0, skipped: 0 };
    for (const tenant of tenants) {
      const result = await this.dispatchTenant(tenant.id);
      total.sent += result.sent;
      total.failed += result.failed;
      total.skipped += result.skipped;
    }
    if (total.sent || total.failed) {
      this.logger.log(`notifications: ${total.sent} sent, ${total.failed} failed, ${total.skipped} skipped`);
    }
    return total;
  }

  /** Exposed so a test -- or an operator with a REPL -- can drain one workspace deterministically. */
  async dispatchTenant(tenantId: string): Promise<{ sent: number; failed: number; skipped: number }> {
    const pending = await withTenant(this.sql, tenantId, (tx) => tx<PendingRow[]>`
      select n.id, n.channel, n.title, n.body, n.severity, n.attempt_count, u.email, u.mobile
      from notifications n join users u on u.id = n.recipient_user_id
      where n.tenant_id = ${tenantId} and n.delivery_status = 'pending' and n.channel <> 'in_app'
      order by n.created_at
      limit ${this.batchSize}
    `);

    let sent = 0;
    let failed = 0;
    let skipped = 0;
    for (const row of pending) {
      const channel = this.channels.get(row.channel);
      if (!channel?.configured) {
        // Left pending on purpose. An unconfigured channel is a deployment
        // that has not been given an SMTP server yet, not a message that
        // should be given up on -- and marking it 'sent' would be a lie
        // that nothing later could detect.
        skipped += 1;
        continue;
      }
      const to = row.channel === 'email' ? row.email : row.mobile;
      if (!to) {
        // A permanent failure, and distinguishable from a transient one: no
        // number of retries will give this user a mobile number.
        await this.record(tenantId, row.id, 'failed', `no ${row.channel === 'email' ? 'email address' : 'mobile number'} on file`, row.attempt_count + 1, true);
        failed += 1;
        continue;
      }
      const message: OutboundMessage = {
        to,
        subject: row.title,
        body: row.body ?? row.title,
        severity: row.severity,
      };
      try {
        await channel.send(message);
        await this.record(tenantId, row.id, 'sent', null, row.attempt_count + 1, true);
        sent += 1;
      } catch (error) {
        const attempts = row.attempt_count + 1;
        const exhausted = attempts >= this.maxAttempts;
        await this.record(tenantId, row.id, exhausted ? 'failed' : 'pending', String((error as Error).message ?? error).slice(0, 500), attempts, exhausted);
        failed += 1;
      }
    }
    return { sent, failed, skipped };
  }

  private async record(
    tenantId: string,
    id: string,
    status: 'sent' | 'failed' | 'pending',
    error: string | null,
    attempts: number,
    terminal: boolean,
  ) {
    // `sent_at` is set with the database's own `now()`, not a JavaScript
    // Date: this connection is wrapped by Drizzle (`DECISIONS.md` §27),
    // which does not serialise a Date parameter on a raw postgres.js query
    // -- it throws, and the throw lands in the send loop's own catch, so a
    // delivery that actually succeeded gets recorded as a failure. Cost an
    // hour of "why is every send failing after it clearly worked".
    await withTenant(this.sql, tenantId, (tx) => tx`
      update notifications
      set delivery_status = ${status},
          attempt_count = ${attempts},
          last_error = ${error},
          sent_at = ${tx.unsafe(status === 'sent' ? 'now()' : 'null')}
      where id = ${id} and tenant_id = ${tenantId}
    `);
    if (terminal && status === 'failed') {
      this.logger.warn(`notification ${id} gave up after ${attempts} attempts: ${error}`);
    }
  }
}
