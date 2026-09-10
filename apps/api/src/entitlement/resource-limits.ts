import type postgres from 'postgres';

/**
 * The second kind of limit, and the reason it needs its own code path.
 *
 * A document generation is *consumed*: it happens once, it is counted in
 * `usage_ledger`, and the count only ever goes up within its period. That
 * is what `checkEntitlement`/`consumeEntitlement` were built for.
 *
 * A warehouse is not consumed. "Three godowns" means three *at a time*,
 * not three per month -- close one and the third slot comes back. Counting
 * those in the ledger would be wrong in both directions: a workspace that
 * created and deleted a godown would be charged for a slot it no longer
 * has, and a monthly period would silently hand out three new godowns
 * every month.
 *
 * So a resource limit is answered by counting what exists, right now,
 * against the plan's number. No ledger, no period, no idempotency key --
 * those concepts do not apply to a thing that can be given back.
 */
export interface ResourceLimitDefinition {
  featureCode: string;
  /** What exists now. Runs inside the caller's transaction, so it sees the caller's own writes. */
  count(tx: postgres.TransactionSql, tenantId: string): Promise<number>;
}

/*
 * There is deliberately no noun on this interface. The word a customer
 * reads -- "godown", not "warehouse" -- comes from `feature_keys.name`,
 * which is also what the pricing page and the usage table render, so a
 * second copy here would be a second thing to keep in step.
 */

/**
 * `WAREHOUSE` is the one that carries the pricing: plans are sold per
 * godown per month, so this count is the difference between a Starter and
 * a Growth subscription.
 *
 * Inactive warehouses are excluded deliberately. A godown a workspace has
 * stopped using still holds its history -- stock ledger, receipts,
 * invoices -- and deleting it is not something the product offers. Charging
 * for one nobody operates would make "we closed that godown" an argument
 * with the software rather than a checkbox.
 */
export const RESOURCE_LIMITS: Record<string, ResourceLimitDefinition> = {
  WAREHOUSE: {
    featureCode: 'WAREHOUSE',
    async count(tx, tenantId) {
      const [row] = await tx<{ n: number }[]>`
        select count(*)::int as n from warehouses
        where tenant_id = ${tenantId} and is_active
      `;
      return row?.n ?? 0;
    },
  },
};

export function resourceLimitFor(featureCode: string): ResourceLimitDefinition | undefined {
  return RESOURCE_LIMITS[featureCode];
}

/**
 * The word the API puts on the wire so a client can word its own copy
 * correctly. "You have used your 2 free copies" and "your plan includes 3
 * godowns" are different sentences about different things, and the client
 * should not have to keep its own list of which features are which.
 */
export type LimitKind = 'resource' | 'consumable';

export function limitKindFor(featureCode: string): LimitKind {
  return resourceLimitFor(featureCode) ? 'resource' : 'consumable';
}
