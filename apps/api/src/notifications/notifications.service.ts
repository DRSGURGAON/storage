import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type postgres from 'postgres';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';

export interface EmitNotificationParams {
  ruleCode: string;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
  severity?: 'info' | 'warning' | 'critical';
  /** Warehouse-bound events only reach staff who can see that warehouse. */
  warehouseId?: string | null;
  /** The person who caused the event: they do not need telling about their own action. */
  excludeUserId?: string | null;
}

/**
 * Blueprint §56's in-app notifications. What gets sent is **data**, not
 * code: `notification_rules` says which roles hear about each event code
 * and on which channels, seeded system-wide and overridable per tenant,
 * so switching off "every put-away" for one workspace is a row, not a
 * deploy. An event with no active rule is simply not delivered -- which
 * is also what makes adding an emit call safe before anyone has decided
 * who should receive it.
 *
 * All four of §56's channels are delivered. `in_app` is written `sent`
 * here, inside the caller's transaction, because it *is* the delivery --
 * the row is the notification. Email, WhatsApp and SMS are written
 * `pending` and handed to `NotificationDispatcherService`, which sends
 * them after the commit: an SMTP conversation inside a database
 * transaction holds a connection open for the length of someone else's
 * outage, and a send that succeeded inside a transaction that then rolled
 * back cannot be taken back.
 *
 * Emission never fails its caller. A notification is a courtesy on top of
 * a transaction that has already been decided; a GRN must not fail to
 * submit because nobody could be told about it.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(@Inject(PG_CONNECTION) private readonly sql: postgres.Sql) {}

  /**
   * Runs inside the caller's transaction, so a rolled-back action leaves
   * no notification claiming it happened.
   */
  async emitWithin(tx: postgres.TransactionSql, tenantId: string, params: EmitNotificationParams): Promise<number> {
    try {
      // `is_active` is checked *after* choosing the rule, not inside the
      // where clause. A tenant's row replaces the system default; filtering
      // on is_active here would make a deactivated tenant rule fall through
      // to the still-active default, so switching an event off for one
      // workspace would quietly switch it back on again.
      const [rule] = await tx<{ channels: string[]; audience_role_codes: string[] | null; is_active: boolean }[]>`
        select channels, audience_role_codes, is_active from notification_rules
        where (tenant_id = ${tenantId} or tenant_id is null) and code = ${params.ruleCode}
        order by tenant_id nulls last limit 1
      `;
      if (!rule || !rule.is_active) return 0;
      const channels = rule.channels.filter((c) => ['in_app', 'email', 'whatsapp', 'sms'].includes(c));
      if (channels.length === 0) return 0;

      const roles = rule.audience_role_codes ?? [];
      const recipients = await tx<{ user_id: string }[]>`
        select tu.user_id from tenant_users tu join roles r on r.id = tu.role_id
        where tu.tenant_id = ${tenantId} and tu.status = 'active' and r.code <> 'customer'
          and (${roles}::text[] = '{}' or r.code = any(${roles}))
          and (${params.excludeUserId ?? null}::uuid is null or tu.user_id <> ${params.excludeUserId ?? null})
          -- A warehouse-scoped member only hears about their own warehouses.
          and (${params.warehouseId ?? null}::uuid is null or tu.warehouse_ids is null
               or cardinality(tu.warehouse_ids) = 0 or ${params.warehouseId ?? null} = any(tu.warehouse_ids))
      `;
      for (const recipient of recipients) {
        for (const channel of channels) {
          // One row per (recipient, channel): the schema already keys delivery
          // that way, and it is what lets an operator answer "the email
          // bounced but they saw it in the app" instead of one blurred status.
          await tx`
            insert into notifications (id, tenant_id, rule_code, recipient_user_id, title, body, entity_type, entity_id, severity, channel, delivery_status)
            values (gen_random_uuid(), ${tenantId}, ${params.ruleCode}, ${recipient.user_id}, ${params.title}, ${params.body ?? null},
                    ${params.entityType ?? null}, ${params.entityId ?? null}, ${params.severity ?? 'info'}, ${channel},
                    ${channel === 'in_app' ? 'sent' : 'pending'})
          `;
        }
      }
      return recipients.length;
    } catch (error) {
      // Never fail the operation that triggered it.
      this.logger.error(`Failed to emit ${params.ruleCode}: ${(error as Error).message}`);
      return 0;
    }
  }

  /** Outside a caller's transaction, for events that have already committed (the overdue job). */
  emit(tenantId: string, params: EmitNotificationParams): Promise<number> {
    return withTenant(this.sql, tenantId, (tx) => this.emitWithin(tx, tenantId, params));
  }

  async list(actor: AuthenticatedUser, query: { unreadOnly?: boolean; limit: number; offset: number }) {
    const unreadOnly = query.unreadOnly ?? false;
    return withTenant(this.sql, actor.tenantId, async (tx) => {
      // `in_app` only: a rule that also mails or texts writes one row per
      // channel, and the bell in the corner should show the event once, not
      // once per way it was sent.
      const where = tx`
        where tenant_id = ${actor.tenantId} and recipient_user_id = ${actor.userId}
          and channel = 'in_app'
          and (${!unreadOnly}::boolean or read_at is null)`;
      const rows = await tx<Record<string, any>[]>`
        select id, rule_code, title, body, entity_type, entity_id, severity, read_at, created_at
        from notifications ${where} order by created_at desc limit ${query.limit} offset ${query.offset}
      `;
      const [{ count }] = await tx<{ count: string }[]>`select count(*)::text as count from notifications ${where}`;
      const [{ unread }] = await tx<{ unread: string }[]>`
        select count(*)::text as unread from notifications
        where tenant_id = ${actor.tenantId} and recipient_user_id = ${actor.userId}
          and channel = 'in_app' and read_at is null
      `;
      return {
        items: rows.map((r) => ({
          id: r.id, ruleCode: r.rule_code, title: r.title, body: r.body, entityType: r.entity_type,
          entityId: r.entity_id, severity: r.severity, readAt: r.read_at, createdAt: r.created_at,
        })),
        unreadCount: Number(unread),
        total: Number(count), limit: query.limit, offset: query.offset,
      };
    });
  }

  /** Only ever your own: a notification is addressed to one user, and reading is per person. */
  async markRead(actor: AuthenticatedUser, id: string) {
    const [row] = await withTenant(this.sql, actor.tenantId, (tx) => tx<{ id: string; read_at: string }[]>`
      update notifications set read_at = coalesce(read_at, now()), delivery_status = 'read'
      where id = ${id} and tenant_id = ${actor.tenantId} and recipient_user_id = ${actor.userId}
      returning id, read_at
    `);
    if (!row) throw new NotFoundException('Notification not found');
    return { id: row.id, readAt: row.read_at };
  }

  async markAllRead(actor: AuthenticatedUser) {
    const rows = await withTenant(this.sql, actor.tenantId, (tx) => tx<{ id: string }[]>`
      update notifications set read_at = now(), delivery_status = 'read'
      where tenant_id = ${actor.tenantId} and recipient_user_id = ${actor.userId}
        and channel = 'in_app' and read_at is null
      returning id
    `);
    return { markedRead: rows.length };
  }
}
