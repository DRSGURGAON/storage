import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type postgres from 'postgres';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { loadWarehouseScope } from '../auth/warehouse-scope';
import { SETTINGS_BY_KEY } from '../company/tenant-settings.registry';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { AgeingQuery, StockStatementQuery } from './dto/report-queries';

const AGEING_BUCKETS = SETTINGS_BY_KEY.get('stock.ageing_buckets')!;

export interface StatementLine {
  warehouseCode: string;
  warehouseName: string;
  locationCode: string | null;
  productId: string;
  sku: string;
  productName: string;
  batchNo: string | null;
  expiryDate: string | null;
  uomCode: string;
  physicalQty: number;
  reservedQty: number;
  availableQty: number;
}

/** "0-30" -> [0, 30]; "180+" -> [180, null]. */
export function parseBucket(label: string): { label: string; from: number; to: number | null } {
  const open = label.match(/^(\d+)\+$/);
  if (open) return { label, from: Number(open[1]), to: null };
  const range = label.match(/^(\d+)\s*-\s*(\d+)$/);
  if (range) return { label, from: Number(range[1]), to: Number(range[2]) };
  throw new Error(`Unparseable ageing bucket '${label}'`);
}

/**
 * The two reports Phase 5 owns (dev-phases.md), both read straight off the
 * stock engine's own tables. ux-system.md §3's rule applies: a report is a
 * query against `stock_lots` / `stock_ledger`, never a bespoke
 * recalculation that could drift from the balance the engine holds.
 */
@Injectable()
export class ReportsService {
  constructor(@Inject(PG_CONNECTION) private readonly sql: postgres.Sql) {}

  /**
   * Blueprint §25's Customer Stock Statement. Live, it is `stock_lots`
   * for that customer. As-of a past date it is rebuilt from the ledger --
   * the running-balance columns make that a single `distinct on` rather
   * than a replay, which is exactly what they were stored for.
   */
  async stockStatement(actor: AuthenticatedUser, query: StockStatementQuery) {
    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const [customer] = await tx<{ id: string; code: string; name: string; legal_name: string | null }[]>`
        select id, code, name, legal_name from customers where id = ${query.customerId} and tenant_id = ${actor.tenantId}
      `;
      if (!customer) throw new NotFoundException('Customer not found');
      const warehouseFilter = query.warehouseId ?? null;

      const rows = query.asOf
        ? await tx<Record<string, string | null>[]>`
            select w.code as warehouse_code, w.name as warehouse_name, l.full_code as location_code,
                   x.product_id, p.sku, p.name as product_name, b.batch_no, b.expiry_date, x.uom_code,
                   x.balance_physical_qty as physical_qty, x.balance_reserved_qty as reserved_qty
            from (
              select distinct on (warehouse_id, location_id, product_id, batch_id, serial_no)
                     warehouse_id, location_id, product_id, batch_id, serial_no, uom_code,
                     balance_physical_qty, balance_reserved_qty
              from stock_ledger
              where tenant_id = ${actor.tenantId} and customer_id = ${query.customerId}
                and txn_at < (${query.asOf}::date + 1)
              order by warehouse_id, location_id, product_id, batch_id, serial_no, txn_at desc, id desc
            ) x
            join warehouses w on w.id = x.warehouse_id
            join products p on p.id = x.product_id
            left join locations l on l.id = x.location_id
            left join batches b on b.id = x.batch_id
            where (${scope}::uuid[] is null or x.warehouse_id = any(${scope}))
              and (${warehouseFilter}::uuid is null or x.warehouse_id = ${warehouseFilter})
              and (x.balance_physical_qty <> 0 or x.balance_reserved_qty <> 0)
            order by w.code, p.sku, l.full_code nulls first
          `
        : await tx<Record<string, string | null>[]>`
            select w.code as warehouse_code, w.name as warehouse_name, l.full_code as location_code,
                   sl.product_id, p.sku, p.name as product_name, b.batch_no, b.expiry_date, sl.uom_code,
                   sl.physical_qty, sl.reserved_qty
            from stock_lots sl
            join warehouses w on w.id = sl.warehouse_id
            join products p on p.id = sl.product_id
            left join locations l on l.id = sl.location_id
            left join batches b on b.id = sl.batch_id
            where sl.tenant_id = ${actor.tenantId} and sl.customer_id = ${query.customerId}
              and (${scope}::uuid[] is null or sl.warehouse_id = any(${scope}))
              and (${warehouseFilter}::uuid is null or sl.warehouse_id = ${warehouseFilter})
              and (sl.physical_qty <> 0 or sl.reserved_qty <> 0)
            order by w.code, p.sku, l.full_code nulls first
          `;

      const lines: StatementLine[] = rows.map((r) => ({
        warehouseCode: r.warehouse_code!,
        warehouseName: r.warehouse_name!,
        locationCode: r.location_code,
        productId: r.product_id!,
        sku: r.sku!,
        productName: r.product_name!,
        batchNo: r.batch_no,
        expiryDate: r.expiry_date,
        uomCode: r.uom_code!,
        physicalQty: Number(r.physical_qty),
        reservedQty: Number(r.reserved_qty),
        availableQty: Number(r.physical_qty) - Number(r.reserved_qty),
      }));

      // Totals per product, which is what the customer actually asks
      // ("how much rice do I have with you"), on top of the per-lot detail.
      const byProduct = new Map<string, { sku: string; productName: string; uomCode: string; physicalQty: number; reservedQty: number }>();
      for (const l of lines) {
        const t = byProduct.get(l.productId) ?? {
          sku: l.sku,
          productName: l.productName,
          uomCode: l.uomCode,
          physicalQty: 0,
          reservedQty: 0,
        };
        t.physicalQty += l.physicalQty;
        t.reservedQty += l.reservedQty;
        byProduct.set(l.productId, t);
      }

      return {
        customer: { id: customer.id, code: customer.code, name: customer.legal_name || customer.name },
        asOf: query.asOf ?? new Date().toISOString().slice(0, 10),
        isHistorical: Boolean(query.asOf),
        lines,
        totals: [...byProduct.entries()].map(([productId, t]) => ({
          productId,
          ...t,
          availableQty: t.physicalQty - t.reservedQty,
        })),
      };
    });
  }

  /**
   * Blueprint §26's ageing. Buckets come from `stock.ageing_buckets` and
   * are applied at query time, so changing them never needs a backfill
   * (stock-engine.md §5).
   *
   * Age is `now() - batches.first_received_at` for batch-tracked stock,
   * which is the column that was kept stable for exactly this. Stock with
   * no batch has no such anchor, so it is aged from the earliest receipt
   * (`INWARD`/`RETURN`) of that product for that customer in that
   * warehouse -- a FIFO assumption, stated here rather than hidden: it
   * reports the oldest layer's age for the whole quantity, which is the
   * conservative reading a storage-charge dispute would want.
   */
  async ageing(actor: AuthenticatedUser, query: AgeingQuery) {
    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const [setting] = await tx<{ value: unknown }[]>`
        select value from tenant_settings where tenant_id = ${actor.tenantId} and key = ${AGEING_BUCKETS.key}
      `;
      const labels = (setting?.value as string[] | undefined) ?? (AGEING_BUCKETS.default as string[]);
      const buckets = labels.map(parseBucket);
      const customerFilter = query.customerId ?? null;
      const warehouseFilter = query.warehouseId ?? null;

      const rows = await tx<
        {
          customer_id: string;
          customer_name: string;
          warehouse_code: string;
          product_id: string;
          sku: string;
          product_name: string;
          batch_no: string | null;
          uom_code: string;
          physical_qty: string;
          received_at: string | null;
          age_days: string | null;
        }[]
      >`
        select sl.customer_id, coalesce(c.legal_name, c.name) as customer_name, w.code as warehouse_code,
               sl.product_id, p.sku, p.name as product_name, b.batch_no, sl.uom_code, sl.physical_qty,
               coalesce(b.first_received_at, first_in.txn_at) as received_at,
               extract(day from now() - coalesce(b.first_received_at, first_in.txn_at))::text as age_days
        from stock_lots sl
        join customers c on c.id = sl.customer_id
        join warehouses w on w.id = sl.warehouse_id
        join products p on p.id = sl.product_id
        left join batches b on b.id = sl.batch_id
        left join lateral (
          select min(txn_at) as txn_at from stock_ledger le
          where le.tenant_id = sl.tenant_id and le.customer_id = sl.customer_id
            and le.warehouse_id = sl.warehouse_id and le.product_id = sl.product_id
            and le.txn_type in ('INWARD', 'RETURN')
        ) first_in on true
        where sl.tenant_id = ${actor.tenantId} and sl.physical_qty > 0
          and (${scope}::uuid[] is null or sl.warehouse_id = any(${scope}))
          and (${customerFilter}::uuid is null or sl.customer_id = ${customerFilter})
          and (${warehouseFilter}::uuid is null or sl.warehouse_id = ${warehouseFilter})
        order by received_at nulls last
      `;

      const bucketOf = (days: number) =>
        buckets.find((b) => days >= b.from && (b.to === null || days <= b.to))?.label ?? buckets[buckets.length - 1].label;

      const summary = Object.fromEntries(buckets.map((b) => [b.label, 0])) as Record<string, number>;
      const lines = rows.map((r) => {
        const days = r.age_days === null ? 0 : Number(r.age_days);
        const bucket = bucketOf(days);
        summary[bucket] += Number(r.physical_qty);
        return {
          customerId: r.customer_id,
          customerName: r.customer_name,
          warehouseCode: r.warehouse_code,
          productId: r.product_id,
          sku: r.sku,
          productName: r.product_name,
          batchNo: r.batch_no,
          uomCode: r.uom_code,
          physicalQty: Number(r.physical_qty),
          receivedAt: r.received_at,
          ageDays: days,
          bucket,
        };
      });

      return { buckets: labels, summary, lines };
    });
  }
}
