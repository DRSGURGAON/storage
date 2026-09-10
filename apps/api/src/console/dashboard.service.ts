import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { hasPermission } from '../auth/has-permission';
import { loadWarehouseScope } from '../auth/warehouse-scope';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';

/**
 * `ux-system.md` §3's dashboard: a fixed composition, not a widget grid,
 * and every tile "a single authoritative query against the stock engine /
 * billing engine — never a bespoke recalculation for the dashboard".
 *
 * Read that literally and it constrains what may appear here. Today's
 * inward and outward are counted straight off `stock_ledger` (the same
 * rows `/stock/ledger` serves); current stock is `stock_lots`, the
 * materialised balance `StockService` alone maintains; outstanding is
 * `invoices.balance_due`, the generated column payments recompute. None
 * of these numbers is derived a second way for this screen -- if a tile
 * disagreed with its module's own page, one of them would be lying.
 *
 * Every tile is filtered by the caller's warehouse scope, so a manager
 * restricted to one warehouse sees that warehouse's day rather than the
 * company's. The money tiles are omitted entirely for a role that cannot
 * see money: an Operator gets the operational half and no `outstanding`
 * key at all, rather than a zero that looks like "nothing is owed".
 */
@Injectable()
export class DashboardService {
  constructor(@Inject(PG_CONNECTION) private readonly sql: postgres.Sql) {}

  async summary(actor: AuthenticatedUser) {
    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const canSeeMoney = await hasPermission(tx, actor, 'view_customer_statement');
      const canSeeStock = await hasPermission(tx, actor, 'view_stock');

      const [today] = await tx<{ inward: string; outward: string }[]>`
        select
          coalesce(sum(qty_in) filter (where txn_type in ('INWARD', 'RETURN')), 0)::text as inward,
          coalesce(sum(qty_out) filter (where txn_type = 'OUTWARD'), 0)::text as outward
        from stock_ledger
        where tenant_id = ${actor.tenantId} and txn_at >= current_date
          and (${scope}::uuid[] is null or warehouse_id = any(${scope}))
      `;
      const [stock] = await tx<{ on_hand: string; reserved: string; customers: string }[]>`
        select coalesce(sum(physical_qty), 0)::text as on_hand, coalesce(sum(reserved_qty), 0)::text as reserved,
               count(distinct customer_id)::text as customers
        from stock_lots
        where tenant_id = ${actor.tenantId} and physical_qty > 0
          and (${scope}::uuid[] is null or warehouse_id = any(${scope}))
      `;
      const [pending] = await tx<{ grns: string; putaways: string; pods: string; releases: string; adjustments: string }[]>`
        select
          (select count(*) from grns where tenant_id = ${actor.tenantId} and status in ('submitted', 'checked')
             and (${scope}::uuid[] is null or warehouse_id = any(${scope})))::text as grns,
          (select count(*) from putaways where tenant_id = ${actor.tenantId} and status in ('pending', 'in_progress')
             and (${scope}::uuid[] is null or warehouse_id = any(${scope})))::text as putaways,
          (select count(*) from dispatches d where d.tenant_id = ${actor.tenantId} and d.status = 'gate_out'
             and not exists (select 1 from pods p where p.dispatch_id = d.id)
             and (${scope}::uuid[] is null or d.warehouse_id = any(${scope})))::text as pods,
          (select count(*) from release_orders where tenant_id = ${actor.tenantId} and status in ('approved', 'reserved', 'partially_picked', 'picked')
             and (${scope}::uuid[] is null or warehouse_id = any(${scope})))::text as releases,
          (select count(*) from stock_adjustments where tenant_id = ${actor.tenantId} and status in ('pending_manager', 'pending_owner')
             and (${scope}::uuid[] is null or warehouse_id = any(${scope})))::text as adjustments
      `;

      const activity = await tx<Record<string, any>[]>`
        select d.id, d.document_type, d.document_number, d.generated_at, coalesce(c.legal_name, c.name) as customer_name
        from documents d left join customers c on c.id = d.customer_id
        where d.tenant_id = ${actor.tenantId} and d.is_latest
          and (${scope}::uuid[] is null or d.warehouse_id is null or d.warehouse_id = any(${scope}))
        order by d.generated_at desc limit 10
      `;

      const base = {
        today: { inwardQty: Number(today.inward), outwardQty: Number(today.outward) },
        stock: canSeeStock
          ? { onHandQty: Number(stock.on_hand), reservedQty: Number(stock.reserved), customersWithStock: Number(stock.customers) }
          : undefined,
        pending: {
          grnApprovals: Number(pending.grns),
          putaways: Number(pending.putaways),
          pods: Number(pending.pods),
          openReleaseOrders: Number(pending.releases),
          stockAdjustments: Number(pending.adjustments),
        },
        recentDocuments: activity.map((d) => ({
          id: d.id, documentType: d.document_type, documentNumber: d.document_number,
          customerName: d.customer_name, generatedAt: d.generated_at,
        })),
      };
      if (!canSeeMoney) return base;

      const [billing] = await tx<{ outstanding: string; overdue: string; unbilled_customers: string; invoices_this_month: string }[]>`
        select
          (select coalesce(sum(balance_due), 0) from invoices where tenant_id = ${actor.tenantId}
             and status in ('issued', 'partially_paid', 'overdue'))::text as outstanding,
          (select coalesce(sum(balance_due), 0) from invoices where tenant_id = ${actor.tenantId} and status = 'overdue')::text as overdue,
          (select count(*) from customers c where c.tenant_id = ${actor.tenantId} and c.is_active
             and exists (select 1 from stock_lots sl where sl.customer_id = c.id and sl.physical_qty > 0)
             and not exists (select 1 from billing_runs br where br.customer_id = c.id and br.status = 'invoiced'
                               and br.period_end >= date_trunc('month', current_date)))::text as unbilled_customers,
          (select count(*) from invoices where tenant_id = ${actor.tenantId} and invoice_date >= date_trunc('month', current_date))::text as invoices_this_month
      `;
      return {
        ...base,
        billing: {
          outstanding: Number(billing.outstanding),
          overdue: Number(billing.overdue),
          customersNotYetBilledThisMonth: Number(billing.unbilled_customers),
          invoicesThisMonth: Number(billing.invoices_this_month),
        },
      };
    });
  }
}
