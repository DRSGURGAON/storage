import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type postgres from 'postgres';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { EntitlementService } from '../entitlement/entitlement.service';

/**
 * `ux-system.md` §13's Plan & Usage page and §14's public Pricing page.
 *
 * Both are rendered from the same rows the entitlement engine actually
 * checks against -- `plan_feature_limits` for what is allowed and
 * `EntitlementService.checkEntitlement` for what is left -- rather than
 * from a parallel description of the plans. §14 is explicit about why:
 * "so the pricing page can never drift out of sync with what is actually
 * enforced". A hard-coded feature table would be a second source of truth
 * for the one question a customer will hold you to.
 *
 * The usage figures come from `checkEntitlement`, the side-effect-free
 * read, one call per metered feature. That is deliberately the same code
 * path a paywall uses, so the number on the settings page and the number
 * that blocks a click cannot disagree.
 */
@Injectable()
export class PlanService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly entitlements: EntitlementService,
  ) {}

  async usage(actor: AuthenticatedUser) {
    // Through `withTenant`: `tenant_subscriptions` is tenant-scoped and under
    // FORCE ROW LEVEL SECURITY, so this read on the bare connection returns
    // nothing at all -- which presented as "this workspace has no
    // subscription" for a workspace that plainly had one (`DECISIONS.md` §44).
    const { subscription, limits } = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const [row] = await tx<Record<string, any>[]>`
        select ts.status, ts.trial_ends_at, ts.current_period_start, ts.current_period_end, ts.cancel_at_period_end,
               p.id as plan_id, p.code as plan_code, p.name as plan_name, p.description, p.price_monthly, p.price_yearly, p.currency
        from tenant_subscriptions ts join plans p on p.id = ts.plan_id
        where ts.tenant_id = ${actor.tenantId}
      `;
      if (!row) return { subscription: null, limits: [] };
      const planLimits = await tx<{ feature_code: string; limit_type: string; limit_value: number | null; name: string; module: string }[]>`
        select pfl.feature_code, pfl.limit_type, pfl.limit_value, fk.name, fk.module
        from plan_feature_limits pfl join feature_keys fk on fk.code = pfl.feature_code
        where pfl.plan_id = ${row.plan_id} and fk.is_meterable
        order by fk.module, fk.name
      `;
      return { subscription: row, limits: planLimits };
    });
    if (!subscription) throw new NotFoundException('This workspace has no subscription');
    const features = [];
    for (const limit of limits) {
      const check = await this.entitlements.checkEntitlement(actor.tenantId, limit.feature_code);
      features.push({
        featureCode: limit.feature_code,
        name: limit.name,
        module: limit.module,
        limitType: limit.limit_type,
        limit: check.limit,
        used: check.used,
        remaining: check.remaining,
        allowed: check.allowed,
        upgradeRequired: check.upgradeRequired,
      });
    }

    return {
      plan: {
        code: subscription.plan_code,
        name: subscription.plan_name,
        description: subscription.description,
        priceMonthly: subscription.price_monthly === null ? null : Number(subscription.price_monthly),
        priceYearly: subscription.price_yearly === null ? null : Number(subscription.price_yearly),
        currency: subscription.currency,
      },
      subscription: {
        status: subscription.status,
        trialEndsAt: subscription.trial_ends_at,
        currentPeriodStart: subscription.current_period_start,
        currentPeriodEnd: subscription.current_period_end,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      },
      features,
    };
  }

  /**
   * Public: no tenant, no auth. The comparison table is built by pivoting
   * `plan_feature_limits` across the public plans, so adding a plan or
   * changing a limit changes this page with no code edit -- §14's "final
   * price points are configured data, not hard-coded in the page".
   */
  async publicPricing() {
    const plans = await this.sql<Record<string, any>[]>`
      select id, code, name, description, trial_days, price_monthly, price_yearly, currency, sort_order
      from plans where is_public and is_active order by sort_order, price_monthly nulls first
    `;
    const limits = await this.sql<{ plan_id: string; feature_code: string; limit_type: string; limit_value: number | null; name: string; module: string }[]>`
      select pfl.plan_id, pfl.feature_code, pfl.limit_type, pfl.limit_value, fk.name, fk.module
      from plan_feature_limits pfl join feature_keys fk on fk.code = pfl.feature_code
      where pfl.plan_id = any(${plans.map((p) => p.id)}::uuid[])
      order by fk.module, fk.name
    `;
    const featureOrder: { code: string; name: string; module: string }[] = [];
    for (const l of limits) {
      if (!featureOrder.some((f) => f.code === l.feature_code)) {
        featureOrder.push({ code: l.feature_code, name: l.name, module: l.module });
      }
    }
    return {
      plans: plans.map((p) => ({
        code: p.code, name: p.name, description: p.description, trialDays: p.trial_days,
        priceMonthly: p.price_monthly === null ? null : Number(p.price_monthly),
        priceYearly: p.price_yearly === null ? null : Number(p.price_yearly),
        currency: p.currency,
      })),
      features: featureOrder.map((f) => ({
        featureCode: f.code,
        name: f.name,
        module: f.module,
        byPlan: plans.map((p) => {
          const row = limits.find((l) => l.plan_id === p.id && l.feature_code === f.code);
          // entitlement-engine.md §3: an absent row is disabled, fail-closed, not unlimited.
          return { planCode: p.code, limitType: row?.limit_type ?? 'disabled', limit: row?.limit_value ?? null };
        }),
      })),
    };
  }

  /** ux-system.md §12's nudge data, and the one query the audit viewer's sibling screens need. */
  async auditLog(actor: AuthenticatedUser, query: { entityType?: string; entityId?: string; action?: string; userId?: string; from?: string; to?: string; limit: number; offset: number }) {
    const entityType = query.entityType ?? null;
    const entityId = query.entityId ?? null;
    const action = query.action ?? null;
    const userId = query.userId ?? null;
    const from = query.from ?? null;
    const to = query.to ?? null;
    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const where = tx`
        where al.tenant_id = ${actor.tenantId}
          and (${entityType}::text is null or al.entity_type = ${entityType})
          and (${entityId}::uuid is null or al.entity_id = ${entityId})
          and (${action}::text is null or al.action = ${action})
          and (${userId}::uuid is null or al.user_id = ${userId})
          and (${from}::date is null or al.occurred_at >= ${from}::date)
          and (${to}::date is null or al.occurred_at < (${to}::date + 1))`;
      const rows = await tx<Record<string, any>[]>`
        select al.id, al.occurred_at, al.action, al.entity_type, al.entity_id, al.user_id, u.full_name as user_name,
               al.user_role_code, al.ip_address, al.previous_value, al.new_value
        from audit_logs al left join users u on u.id = al.user_id
        ${where} order by al.occurred_at desc limit ${query.limit} offset ${query.offset}
      `;
      const [{ count }] = await tx<{ count: string }[]>`select count(*)::text as count from audit_logs al ${where}`;
      return {
        items: rows.map((r) => ({
          id: r.id, occurredAt: r.occurred_at, action: r.action, entityType: r.entity_type, entityId: r.entity_id,
          userId: r.user_id, userName: r.user_name, userRoleCode: r.user_role_code, ipAddress: r.ip_address,
          previousValue: r.previous_value, newValue: r.new_value,
        })),
        total: Number(count), limit: query.limit, offset: query.offset,
      };
    });
  }
}
