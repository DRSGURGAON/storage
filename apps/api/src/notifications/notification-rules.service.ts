import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';

export const NOTIFICATION_CHANNELS = ['in_app', 'email', 'whatsapp', 'sms'] as const;

/**
 * The event codes some service actually emits today. Two of §56's eight
 * are seeded but not yet raised by anything (`payment_due`,
 * `agreement_expiring`), and an operator who switches email on for one of
 * those would be waiting for a message no code sends. Saying so on the
 * screen is the difference between a setting and a promise.
 *
 * Hand-maintained beside the `emit`/`emitWithin` call sites -- and kept
 * honest by notification-rules.spec.ts, which derives the same set from
 * the source tree and fails when the two drift apart.
 */
export const EMITTED_RULE_CODES = [
  'customer_request_pending',
  'grn_pending_approval',
  'pod_pending',
  'payment_overdue',
  'stock_adjustment_pending',
  'stock_discrepancy',
] as const;

interface RuleRow {
  id: string;
  tenant_id: string | null;
  code: string;
  channels: string[];
  audience_role_codes: string[] | null;
  is_active: boolean;
}

/**
 * Blueprint §56's rules, made editable.
 *
 * They were always *data* -- seeded system-wide with `tenant_id is null`,
 * overridable per tenant by inserting a row with the same code -- but
 * nothing in the application could write that row, so "switching a channel
 * on is a row, not a deploy" meant a row someone had to write in psql.
 * Phase 10d then made email, WhatsApp and SMS deliverable, which turned a
 * documentation gap into a real one: the delivery worked and there was no
 * way to ask for it.
 *
 * A tenant's row *replaces* the system default for that code rather than
 * merging with it. Merging would make "remove a role from the audience"
 * impossible to express, and the union of two lists is not a thing an
 * operator can predict from either.
 */
@Injectable()
export class NotificationRulesService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly audit: AuditService,
  ) {}

  /**
   * The rules as they actually apply: the tenant's own row where it has
   * one, the system default otherwise, each saying which it is. That
   * distinction is the useful part -- an operator needs to know whether
   * they are looking at their own choice or at what shipped.
   */
  async list(actor: AuthenticatedUser) {
    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const rows = await tx<RuleRow[]>`
        select distinct on (code) id, tenant_id, code, channels, audience_role_codes, is_active
        from notification_rules
        where tenant_id = ${actor.tenantId} or tenant_id is null
        order by code, tenant_id nulls last
      `;
      return rows.map((row) => ({
        code: row.code,
        channels: row.channels,
        audienceRoleCodes: row.audience_role_codes ?? [],
        isActive: row.is_active,
        /** False when this workspace has never touched it. */
        isCustomised: row.tenant_id !== null,
        /** False for a code that is seeded but that nothing raises yet. */
        isEmitted: (EMITTED_RULE_CODES as readonly string[]).includes(row.code),
      }));
    });
  }

  /**
   * Upsert this tenant's override for one event code.
   *
   * The code must already exist as a system rule: inventing one would
   * produce a rule nothing ever emits, which looks configured and does
   * nothing -- the exact failure mode this whole module is written to
   * avoid.
   */
  async upsert(
    actor: AuthenticatedUser,
    code: string,
    dto: { channels: string[]; audienceRoleCodes?: string[]; isActive?: boolean },
    ipAddress?: string,
  ) {
    const audience = dto.audienceRoleCodes ?? [];
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const [known] = await tx`
        select 1 from notification_rules where code = ${code} and (tenant_id is null or tenant_id = ${actor.tenantId})
      `;
      if (!known) return null;

      // A role code that does not exist -- or `customer`, which
      // NotificationsService.emitWithin excludes because a portal login is
      // not staff -- would save cleanly and then address nobody. Refused
      // here so the mistake is visible at the moment it is made rather than
      // as an event that quietly stops arriving.
      if (audience.length > 0) {
        const staff = await tx<{ code: string }[]>`
          select code from roles
          where code = any(${audience}::text[]) and code <> 'customer'
            and (tenant_id is null or tenant_id = ${actor.tenantId})
        `;
        const knownCodes = new Set(staff.map((r) => r.code));
        const unknown = audience.filter((c) => !knownCodes.has(c));
        if (unknown.length > 0) {
          throw new BadRequestException(`Not a staff role: ${unknown.join(', ')}`);
        }
      }

      const [before] = await tx<RuleRow[]>`
        select id, tenant_id, code, channels, audience_role_codes, is_active
        from notification_rules where tenant_id = ${actor.tenantId} and code = ${code}
      `;
      const [after] = await tx<RuleRow[]>`
        insert into notification_rules (id, tenant_id, code, channels, audience_role_codes, is_active)
        values (gen_random_uuid(), ${actor.tenantId}, ${code}, ${dto.channels}, ${audience}, ${dto.isActive ?? true})
        on conflict (tenant_id, code) do update
          set channels = excluded.channels,
              audience_role_codes = excluded.audience_role_codes,
              is_active = excluded.is_active
        returning id, tenant_id, code, channels, audience_role_codes, is_active
      `;
      return { before, after };
    });
    if (!result) throw new NotFoundException(`No notification rule with code '${code}'`);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: result.before ? 'update' : 'create',
      entityType: 'notification_rule',
      entityId: result.after.id,
      previousValue: result.before
        ? { channels: result.before.channels, audienceRoleCodes: result.before.audience_role_codes }
        : undefined,
      newValue: { channels: result.after.channels, audienceRoleCodes: result.after.audience_role_codes },
      ipAddress,
    });

    return {
      code: result.after.code,
      channels: result.after.channels,
      audienceRoleCodes: result.after.audience_role_codes ?? [],
      isActive: result.after.is_active,
      isCustomised: true,
      isEmitted: (EMITTED_RULE_CODES as readonly string[]).includes(result.after.code),
    };
  }
}
