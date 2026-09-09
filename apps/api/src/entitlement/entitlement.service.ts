import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import {
  CheckEntitlementResult,
  ConsumeEntitlementParams,
  ConsumeEntitlementResult,
  RecordFailedAttemptParams,
} from './entitlement.types';

interface ResolvedLimit {
  limitType: 'unlimited' | 'counted' | 'disabled';
  limitValue: number | null;
  period: 'lifetime' | 'monthly' | 'yearly';
}

/**
 * The centralized engine every metered feature must call through
 * (entitlement-engine.md §1) -- never a module-local "if count > 2" check.
 *
 * Split of responsibilities, resolved here during implementation (the
 * design doc described both functions but not which one owns writing a
 * *blocked* attempt to usage_ledger): checkEntitlement is a cheap,
 * side-effect-free read for UI/preview use, callable as often as a screen
 * likes without generating audit noise. consumeEntitlement is the single
 * atomic operation that re-checks the limit and, in the same transaction,
 * either records success and increments the counter or records a block --
 * this is what actually enforces the limit and prevents a race between two
 * concurrent requests both "seeing" one remaining unit.
 */
@Injectable()
export class EntitlementService {
  constructor(@Inject(PG_CONNECTION) private readonly sql: postgres.Sql) {}

  async checkEntitlement(
    tenantId: string,
    featureCode: string,
  ): Promise<CheckEntitlementResult> {
    return withTenant(this.sql, tenantId, (tx) =>
      this.evaluate(tx, tenantId, featureCode),
    );
  }

  async consumeEntitlement(
    params: ConsumeEntitlementParams,
  ): Promise<ConsumeEntitlementResult> {
    const { tenantId, featureCode, idempotencyKey } = params;

    return withTenant(this.sql, tenantId, async (tx) => {
      // A prior call with this exact idempotency key already ran to
      // completion (success or blocked) -- return that outcome again
      // without touching the counter a second time (entitlement-engine.md
      // §4: a retry "neither consumes a second unit nor blocks a
      // legitimate first attempt").
      const [existing] = await tx<{ result: string }[]>`
        select result from usage_ledger
        where tenant_id = ${tenantId} and idempotency_key = ${idempotencyKey}
      `;
      if (existing) {
        const evaluation = await this.evaluate(tx, tenantId, featureCode);
        return { ...evaluation, wasNewlyConsumed: false };
      }

      // Resolved once, up front, so every ledger row below -- whether it
      // ends up 'blocked' or 'success' -- gets the real period_key when
      // one is resolvable, rather than a placeholder that would make the
      // audit trail misleading for anything but the truly period-less
      // cases (feature disabled, subscription inactive).
      const limit = await this.resolveLimit(tx, tenantId, featureCode);
      const periodKey = limit ? this.periodKeyFor(limit.period) : 'n/a';

      const blocked = async (reason: NonNullable<CheckEntitlementResult['reason']>, used: number) => {
        await tx`
          insert into usage_ledger
            (id, tenant_id, user_id, feature_code, period_key, document_type,
             source_id, generation_id, result, consumed, reason, idempotency_key)
          values
            (gen_random_uuid(), ${tenantId}, ${params.userId ?? null}, ${featureCode},
             ${periodKey}, ${params.documentType ?? null}, ${params.sourceId ?? null},
             ${params.generationId ?? null}, 'blocked', false, ${reason}, ${idempotencyKey})
          on conflict (tenant_id, idempotency_key) do nothing
        `;
        return {
          allowed: false,
          reason,
          remaining: 0,
          limit: limit?.limitValue ?? null,
          used,
          upgradeRequired: true,
          wasNewlyConsumed: false,
        };
      };

      const subscriptionCheck = await this.checkSubscriptionActive(tx, tenantId);
      if (!subscriptionCheck) return blocked('SUBSCRIPTION_INACTIVE', 0);
      if (!limit || limit.limitType === 'disabled') return blocked('FEATURE_DISABLED', 0);

      if (limit.limitType === 'counted') {
        // Row lock serializes concurrent consumeEntitlement calls for the
        // same (tenant, feature, period) -- the same discipline as
        // numbering.md's allocateNumber() and stock-engine.md's ledger
        // posting, applied to usage counting.
        await tx`
          insert into usage_counters (tenant_id, feature_code, period_key, used_count)
          values (${tenantId}, ${featureCode}, ${periodKey}, 0)
          on conflict (tenant_id, feature_code, period_key) do nothing
        `;
        const [locked] = await tx<{ used_count: number }[]>`
          select used_count from usage_counters
          where tenant_id = ${tenantId} and feature_code = ${featureCode} and period_key = ${periodKey}
          for update
        `;
        if (locked.used_count >= (limit.limitValue ?? 0)) {
          // Lost a race against another concurrent consumeEntitlement call
          // for the same slot -- the row lock above is what makes this
          // check-then-act sequence safe under concurrency.
          return blocked('LIMIT_REACHED', locked.used_count);
        }
        await tx`
          update usage_counters set used_count = used_count + 1, updated_at = now()
          where tenant_id = ${tenantId} and feature_code = ${featureCode} and period_key = ${periodKey}
        `;
      }

      // ON CONFLICT DO NOTHING covers the narrow window where two
      // concurrent calls share the exact same idempotency key and both
      // slipped past the pre-check above before either committed -- rather
      // than one of them throwing a unique-violation, it just discovers it
      // lost, and undoes the counter increment it optimistically made.
      const [inserted] = await tx<{ id: string }[]>`
        insert into usage_ledger
          (id, tenant_id, user_id, feature_code, period_key, document_type,
           source_id, generation_id, result, consumed, idempotency_key)
        values
          (gen_random_uuid(), ${tenantId}, ${params.userId ?? null}, ${featureCode},
           ${periodKey}, ${params.documentType ?? null}, ${params.sourceId ?? null},
           ${params.generationId ?? null}, 'success', true, ${idempotencyKey})
        on conflict (tenant_id, idempotency_key) do nothing
        returning id
      `;

      if (!inserted && limit.limitType === 'counted') {
        await tx`
          update usage_counters set used_count = used_count - 1, updated_at = now()
          where tenant_id = ${tenantId} and feature_code = ${featureCode} and period_key = ${periodKey}
        `;
        // Lost the idempotency race to a concurrent call with the same
        // key -- report their outcome, not a phantom consumption of ours.
        return { ...(await this.evaluate(tx, tenantId, featureCode)), wasNewlyConsumed: false };
      }

      // evaluate() answers "is a *future* call still allowed" -- for a
      // call that just succeeded, `allowed` must stay true regardless of
      // whether that future answer is now false (this consumption used
      // the very last unit). upgradeRequired still surfaces that "no
      // future calls" state so the caller can show it was the last one.
      const after = await this.evaluate(tx, tenantId, featureCode);
      return {
        ...after,
        allowed: true,
        reason: null,
        upgradeRequired: after.remaining !== null && after.remaining <= 0,
        wasNewlyConsumed: true,
      };
    });
  }

  async recordFailedAttempt(params: RecordFailedAttemptParams): Promise<void> {
    await withTenant(this.sql, params.tenantId, (tx) => tx`
      insert into usage_ledger
        (id, tenant_id, user_id, feature_code, period_key, document_type,
         source_id, result, consumed, reason, idempotency_key)
      values
        (gen_random_uuid(), ${params.tenantId}, ${params.userId ?? null}, ${params.featureCode},
         'n/a', ${params.documentType ?? null}, ${params.sourceId ?? null},
         'failed', false, ${params.reason}, ${params.idempotencyKey})
      on conflict (tenant_id, idempotency_key) do nothing
    `);
  }

  private async evaluate(
    tx: postgres.TransactionSql,
    tenantId: string,
    featureCode: string,
  ): Promise<CheckEntitlementResult> {
    if (!(await this.checkSubscriptionActive(tx, tenantId))) {
      return {
        allowed: false,
        reason: 'SUBSCRIPTION_INACTIVE',
        remaining: 0,
        limit: null,
        used: 0,
        upgradeRequired: true,
      };
    }

    const limit = await this.resolveLimit(tx, tenantId, featureCode);

    if (!limit || limit.limitType === 'disabled') {
      return {
        allowed: false,
        reason: 'FEATURE_DISABLED',
        remaining: 0,
        limit: 0,
        used: 0,
        upgradeRequired: false,
      };
    }

    if (limit.limitType === 'unlimited') {
      return {
        allowed: true,
        reason: null,
        remaining: null,
        limit: null,
        used: 0,
        upgradeRequired: false,
      };
    }

    const periodKey = this.periodKeyFor(limit.period);
    const [counter] = await tx<{ used_count: number }[]>`
      select used_count from usage_counters
      where tenant_id = ${tenantId} and feature_code = ${featureCode} and period_key = ${periodKey}
    `;
    const used = counter?.used_count ?? 0;
    const remaining = (limit.limitValue ?? 0) - used;

    return {
      allowed: remaining > 0,
      reason: remaining > 0 ? null : 'LIMIT_REACHED',
      remaining: Math.max(remaining, 0),
      limit: limit.limitValue,
      used,
      upgradeRequired: remaining <= 0,
    };
  }

  /** entitlement-engine.md §3: a lapsed subscription blocks every feature check regardless of remaining counted usage -- except on the FREE plan, which never lapses (V1 has no paid-plan lifecycle transitions yet). */
  private async checkSubscriptionActive(
    tx: postgres.TransactionSql,
    tenantId: string,
  ): Promise<boolean> {
    const [subscription] = await tx<{ status: string; plan_code: string }[]>`
      select ts.status, p.code as plan_code
      from tenant_subscriptions ts
      join plans p on p.id = ts.plan_id
      where ts.tenant_id = ${tenantId}
    `;
    if (!subscription) return false;
    if (subscription.plan_code === 'FREE') return true;
    return !['past_due', 'cancelled', 'expired'].includes(subscription.status);
  }

  private async resolveLimit(
    tx: postgres.TransactionSql,
    tenantId: string,
    featureCode: string,
  ): Promise<ResolvedLimit | null> {
    const [override] = await tx<
      { limit_type: ResolvedLimit['limitType']; limit_value: number | null; period: ResolvedLimit['period'] }[]
    >`
      select limit_type, limit_value, period
      from entitlement_overrides
      where tenant_id = ${tenantId} and feature_code = ${featureCode}
        and (expires_at is null or expires_at > now())
    `;
    if (override) {
      return {
        limitType: override.limit_type,
        limitValue: override.limit_value,
        period: override.period,
      };
    }

    const [planLimit] = await tx<
      { limit_type: ResolvedLimit['limitType']; limit_value: number | null; period: ResolvedLimit['period'] }[]
    >`
      select pfl.limit_type, pfl.limit_value, pfl.period
      from tenant_subscriptions ts
      join plan_feature_limits pfl on pfl.plan_id = ts.plan_id
      where ts.tenant_id = ${tenantId} and pfl.feature_code = ${featureCode}
    `;
    if (planLimit) {
      return {
        limitType: planLimit.limit_type,
        limitValue: planLimit.limit_value,
        period: planLimit.period,
      };
    }

    return null;
  }

  private periodKeyFor(period: ResolvedLimit['period']): string {
    const now = new Date();
    if (period === 'lifetime') return 'lifetime';
    if (period === 'yearly') return String(now.getUTCFullYear());
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  }
}
