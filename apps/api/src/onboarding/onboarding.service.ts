import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';

const STEP_ORDER = ['company', 'warehouse', 'customer', 'products', 'rateCard'] as const;
type StepKey = (typeof STEP_ORDER)[number];

export interface StepStatus {
  done: boolean;
  count: number;
}

/**
 * ux-system.md §1: "Progress persists server-side (a small onboarding_state
 * field on the tenant, or derived live by checking whether each entity type
 * has at least one row)". This takes the derived-live option: no
 * onboarding-only API or extra column, so a tenant that creates records via
 * the ordinary endpoints -- in any order, or by skipping the wizard
 * entirely per §1's "this is guidance, not a hard gate" -- always sees an
 * accurate status, never a stale flag that drifted from what's actually in
 * the tables.
 */
@Injectable()
export class OnboardingService {
  constructor(@Inject(PG_CONNECTION) private readonly sql: postgres.Sql) {}

  async getStatus(tenantId: string) {
    const counts = await withTenant(this.sql, tenantId, async (tx) => {
      const [row] = await tx<
        { warehouse_count: string; customer_count: string; product_count: string; rate_card_line_count: string }[]
      >`
        select
          (select count(*) from warehouses where tenant_id = ${tenantId}) as warehouse_count,
          (select count(*) from customers where tenant_id = ${tenantId}) as customer_count,
          (select count(*) from products where tenant_id = ${tenantId}) as product_count,
          (select count(*) from rate_card_lines where tenant_id = ${tenantId}) as rate_card_line_count
      `;
      return row;
    });

    const steps: Record<StepKey, StepStatus> = {
      // The tenant row itself is created at signup -- always done for an authenticated caller.
      company: { done: true, count: 1 },
      warehouse: { done: Number(counts.warehouse_count) > 0, count: Number(counts.warehouse_count) },
      customer: { done: Number(counts.customer_count) > 0, count: Number(counts.customer_count) },
      products: { done: Number(counts.product_count) > 0, count: Number(counts.product_count) },
      // "Rate card -> creates one rate_cards + rate_card_lines set" (§1): a card with no
      // priced line isn't usable yet, so this checks lines, not just the card row.
      rateCard: { done: Number(counts.rate_card_line_count) > 0, count: Number(counts.rate_card_line_count) },
    };

    const nextStep = STEP_ORDER.find((key) => !steps[key].done);
    return {
      steps,
      isComplete: nextStep === undefined,
      nextStep: nextStep ?? 'ready',
    };
  }
}
