import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { ListStockLedgerQuery } from './dto/list-stock-ledger.query';
import { ListStockQuery } from './dto/list-stock.query';

/** stock-engine.md §2's seven transaction types. */
export type StockTxnType =
  | 'INWARD'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'OUTWARD'
  | 'RETURN'
  | 'ADJUSTMENT'
  | 'RESERVE'
  | 'UNRESERVE';

/**
 * One physical or reservation movement against one lot. `qtyIn`/`qtyOut`
 * are both non-negative magnitudes -- the direction is carried by which
 * one is set, not by a sign, exactly as `stock_ledger` stores them.
 */
export interface StockMovement {
  txnType: StockTxnType;
  customerId: string;
  warehouseId: string;
  locationId: string | null;
  productId: string;
  batchId: string | null;
  serialNo: string | null;
  qtyIn?: number;
  qtyOut?: number;
  reservedDelta?: number;
  uomCode: string;
  sourceLineId?: string | null;
  remarks?: string | null;
  /** Set when this movement offsets an earlier one (stock-engine.md §3.5). */
  reversalOfId?: string | null;
}

export interface PostingRequest {
  sourceType: string;
  sourceId: string;
  /**
   * Deterministic, derived from the triggering event -- e.g.
   * `grn:{id}:approve` (stock-engine.md §4). Each movement's own row gets
   * `{baseKey}#{n}`, since the uniqueness that stops double-posting is per
   * ledger row.
   */
  idempotencyKey: string;
  movements: StockMovement[];
}

export interface PostingResult {
  posted: boolean;
  ledgerIds: string[];
  /** Destination lot per movement, positionally -- put-away needs these. */
  lotIds: string[];
}

interface LotRow {
  id: string;
  physical_qty: string;
  reserved_qty: string;
}

/**
 * stock-engine.md §1: `stock_lots` is a materialised balance maintained
 * **only** by this service reading `stock_ledger`. Nothing else in the
 * codebase writes `physical_qty` or `reserved_qty` -- that is what makes
 * blueprint §23's "no arbitrary editing of current stock" structurally
 * true rather than a rule someone can forget.
 *
 * Every posting goes through `postWithin()`, inside the caller's own
 * transaction, so the ledger rows and the balances they imply commit
 * together or not at all (§70).
 */
@Injectable()
export class StockService {
  constructor(@Inject(PG_CONNECTION) private readonly sql: postgres.Sql) {}

  /**
   * Posts a set of movements as one atomic, idempotent unit.
   *
   * Idempotency is checked up front and backstopped by
   * `stock_ledger`'s `unique (tenant_id, idempotency_key)`: the pre-check
   * makes a retry a clean no-op, and the constraint makes a genuinely
   * concurrent double-post a rolled-back error rather than double stock.
   * Callers hold `for update` on their own source row, so in practice the
   * pre-check is what fires; the constraint is there for the case that
   * reasoning is wrong.
   */
  async postWithin(
    tx: postgres.TransactionSql,
    actor: AuthenticatedUser,
    request: PostingRequest,
  ): Promise<PostingResult> {
    const { sourceType, sourceId, idempotencyKey, movements } = request;
    if (movements.length === 0) return { posted: false, ledgerIds: [], lotIds: [] };

    const keys = movements.map((_, i) => `${idempotencyKey}#${i}`);
    const existing = await tx<{ id: string }[]>`
      select id from stock_ledger
      where tenant_id = ${actor.tenantId} and idempotency_key in ${tx(keys)}
    `;
    if (existing.length > 0) {
      return { posted: false, ledgerIds: existing.map((r) => r.id), lotIds: [] };
    }

    const allowNegative = await this.allowsNegativeStock(tx, actor.tenantId);
    const ledgerIds: string[] = [];
    const lotIds: string[] = [];

    for (const [index, movement] of movements.entries()) {
      const qtyIn = movement.qtyIn ?? 0;
      const qtyOut = movement.qtyOut ?? 0;
      const reservedDelta = movement.reservedDelta ?? 0;
      if (qtyIn < 0 || qtyOut < 0) {
        throw new BadRequestException('qtyIn and qtyOut are magnitudes and cannot be negative');
      }

      // Step 2 of §1 first, so the ledger row can record the resulting
      // balance: the upsert returns the post-transaction figures, which is
      // also what makes several movements against the same lot in one
      // posting accumulate correctly.
      const [lot] = await tx<LotRow[]>`
        insert into stock_lots (
          id, tenant_id, customer_id, warehouse_id, location_id, product_id,
          batch_id, serial_no, physical_qty, reserved_qty, uom_code
        ) values (
          ${randomUUID()}, ${actor.tenantId}, ${movement.customerId}, ${movement.warehouseId},
          ${movement.locationId}, ${movement.productId}, ${movement.batchId},
          ${movement.serialNo}, ${qtyIn - qtyOut}, ${reservedDelta}, ${movement.uomCode}
        )
        on conflict (tenant_id, customer_id, warehouse_id, location_id, product_id, batch_id, serial_no)
        do update set
          physical_qty = stock_lots.physical_qty + excluded.physical_qty,
          reserved_qty = stock_lots.reserved_qty + excluded.reserved_qty,
          updated_at = now()
        returning id, physical_qty, reserved_qty
      `;

      const physical = Number(lot.physical_qty);
      const reserved = Number(lot.reserved_qty);
      this.assertInvariants(movement, physical, reserved, allowNegative);

      // `txn_at` is written with clock_timestamp() rather than left to its
      // now() default: now() is the *transaction's* start time and is
      // therefore identical for every row of one posting, which leaves the
      // ledger with no defined order within a posting -- a transfer's
      // TRANSFER_IN could read back before its own TRANSFER_OUT. A ledger
      // is a sequence; clock_timestamp() advances inside the transaction,
      // so rows read back in the order they were written.
      const [ledger] = await tx<{ id: string }[]>`
        insert into stock_ledger (
          id, tenant_id, txn_at, txn_type, customer_id, warehouse_id, location_id,
          product_id, batch_id, serial_no, qty_in, qty_out, reserved_delta,
          balance_physical_qty, balance_reserved_qty, uom_code,
          source_type, source_id, source_line_id, idempotency_key,
          reversal_of_id, remarks, created_by
        ) values (
          ${randomUUID()}, ${actor.tenantId}, clock_timestamp(), ${movement.txnType}, ${movement.customerId},
          ${movement.warehouseId}, ${movement.locationId}, ${movement.productId},
          ${movement.batchId}, ${movement.serialNo}, ${qtyIn}, ${qtyOut}, ${reservedDelta},
          ${physical}, ${reserved}, ${movement.uomCode},
          ${sourceType}, ${sourceId}, ${movement.sourceLineId ?? null}, ${keys[index]},
          ${movement.reversalOfId ?? null}, ${movement.remarks ?? null}, ${actor.userId}
        )
        returning id
      `;
      ledgerIds.push(ledger.id);
      lotIds.push(lot.id);
    }

    return { posted: true, ledgerIds, lotIds };
  }

  /**
   * stock-engine.md §3.1: physical and reserved balances stay non-negative
   * and reserved never exceeds physical, unless the tenant has explicitly
   * opted into §61's escape hatch. Checked *after* the upsert against the
   * balance the database actually now holds, not against a figure computed
   * in application memory from a possibly-stale read.
   */
  private assertInvariants(
    movement: StockMovement,
    physical: number,
    reserved: number,
    allowNegative: boolean,
  ) {
    if (!allowNegative && physical < 0) {
      throw new BadRequestException(
        `This would take stock negative (${physical}) for that product at that location. ` +
          `Enable the tenant setting 'stock.allow_negative' if your operation genuinely allows it.`,
      );
    }
    if (reserved < 0) {
      throw new BadRequestException(`This would take the reserved quantity negative (${reserved})`);
    }
    if (!allowNegative && reserved > physical) {
      throw new BadRequestException(
        `This would reserve more than is physically present (${reserved} reserved vs ${physical} on hand)`,
      );
    }
    if (movement.txnType === 'RESERVE' && (movement.reservedDelta ?? 0) <= 0) {
      throw new BadRequestException('A RESERVE transaction must carry a positive reservedDelta');
    }
  }

  /** §61's per-company escape hatch, off unless a tenant turns it on. */
  private async allowsNegativeStock(tx: postgres.TransactionSql, tenantId: string): Promise<boolean> {
    const [row] = await tx<{ value: unknown }[]>`
      select value from tenant_settings
      where tenant_id = ${tenantId} and key = 'stock.allow_negative'
    `;
    return row?.value === true;
  }

  /**
   * Resolves (or creates) the batch a GRN line's goods belong to.
   * `first_received_at` is set once and never updated -- it is what ageing
   * is computed from (stock-engine.md §5), so a later receipt into the same
   * batch must not make the stock look younger.
   */
  async resolveBatch(
    tx: postgres.TransactionSql,
    tenantId: string,
    input: {
      customerId: string;
      productId: string;
      batchNo: string;
      mfgDate?: string | null;
      expiryDate?: string | null;
      firstReceivedAt: string;
    },
  ): Promise<string> {
    const [existing] = await tx<{ id: string }[]>`
      select id from batches
      where tenant_id = ${tenantId} and customer_id = ${input.customerId}
        and product_id = ${input.productId} and batch_no = ${input.batchNo}
    `;
    if (existing) return existing.id;

    const [created] = await tx<{ id: string }[]>`
      insert into batches (id, tenant_id, customer_id, product_id, batch_no, mfg_date, expiry_date, first_received_at)
      values (${randomUUID()}, ${tenantId}, ${input.customerId}, ${input.productId}, ${input.batchNo},
              ${input.mfgDate ?? null}, ${input.expiryDate ?? null}, ${input.firstReceivedAt})
      on conflict (tenant_id, customer_id, product_id, batch_no) do update set batch_no = excluded.batch_no
      returning id
    `;
    return created.id;
  }

  /** Current stock -- the balance side. `view_stock`. */
  async listLots(actor: AuthenticatedUser, query: ListStockQuery) {
    const customerFilter = query.customerId ?? null;
    const warehouseFilter = query.warehouseId ?? null;
    const productFilter = query.productId ?? null;
    const locationFilter = query.locationId ?? null;
    // Zero-quantity rows are real history (a lot emptied by a transfer), but
    // "current stock" means what is there now, so they are hidden by default.
    const includeEmpty = query.includeEmpty ?? false;

    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const rows = await tx<Record<string, string | null>[]>`
        select sl.id, sl.customer_id, c.name as customer_name,
               sl.warehouse_id, w.code as warehouse_code,
               sl.location_id, l.full_code as location_full_code,
               sl.product_id, p.sku, p.name as product_name,
               sl.batch_id, b.batch_no, b.expiry_date, b.first_received_at,
               sl.serial_no, sl.physical_qty, sl.reserved_qty, sl.available_qty,
               sl.uom_code, sl.updated_at
        from stock_lots sl
        join customers c on c.id = sl.customer_id
        join warehouses w on w.id = sl.warehouse_id
        join products p on p.id = sl.product_id
        left join locations l on l.id = sl.location_id
        left join batches b on b.id = sl.batch_id
        where sl.tenant_id = ${actor.tenantId}
          and (${customerFilter}::uuid is null or sl.customer_id = ${customerFilter})
          and (${warehouseFilter}::uuid is null or sl.warehouse_id = ${warehouseFilter})
          and (${productFilter}::uuid is null or sl.product_id = ${productFilter})
          and (${locationFilter}::uuid is null or sl.location_id = ${locationFilter})
          and (${includeEmpty} or sl.physical_qty <> 0 or sl.reserved_qty <> 0)
        order by w.code, p.sku, l.full_code nulls first
        limit ${query.limit} offset ${query.offset}
      `;
      const [{ count }] = await tx<{ count: string }[]>`
        select count(*)::text as count from stock_lots sl
        where sl.tenant_id = ${actor.tenantId}
          and (${customerFilter}::uuid is null or sl.customer_id = ${customerFilter})
          and (${warehouseFilter}::uuid is null or sl.warehouse_id = ${warehouseFilter})
          and (${productFilter}::uuid is null or sl.product_id = ${productFilter})
          and (${locationFilter}::uuid is null or sl.location_id = ${locationFilter})
          and (${includeEmpty} or sl.physical_qty <> 0 or sl.reserved_qty <> 0)
      `;
      return {
        items: rows.map((r) => ({
          id: r.id,
          customerId: r.customer_id,
          customerName: r.customer_name,
          warehouseId: r.warehouse_id,
          warehouseCode: r.warehouse_code,
          locationId: r.location_id,
          locationFullCode: r.location_full_code,
          productId: r.product_id,
          sku: r.sku,
          productName: r.product_name,
          batchId: r.batch_id,
          batchNo: r.batch_no,
          expiryDate: r.expiry_date,
          firstReceivedAt: r.first_received_at,
          serialNo: r.serial_no,
          physicalQty: r.physical_qty,
          reservedQty: r.reserved_qty,
          availableQty: r.available_qty,
          uomCode: r.uom_code,
          updatedAt: r.updated_at,
        })),
        total: Number(count),
        limit: query.limit,
        offset: query.offset,
      };
    });
  }

  /** The append-only movement log behind those balances. `view_stock_ledger`. */
  async listLedger(actor: AuthenticatedUser, query: ListStockLedgerQuery) {
    const customerFilter = query.customerId ?? null;
    const warehouseFilter = query.warehouseId ?? null;
    const productFilter = query.productId ?? null;
    const txnTypeFilter = query.txnType ?? null;
    const sourceTypeFilter = query.sourceType ?? null;
    const sourceIdFilter = query.sourceId ?? null;

    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const rows = await tx<Record<string, string | null>[]>`
        select sle.id, sle.txn_at, sle.txn_type, sle.customer_id,
               sle.warehouse_id, w.code as warehouse_code,
               sle.location_id, l.full_code as location_full_code,
               sle.product_id, p.sku, p.name as product_name,
               sle.batch_id, b.batch_no, sle.serial_no,
               sle.qty_in, sle.qty_out, sle.reserved_delta,
               sle.balance_physical_qty, sle.balance_reserved_qty, sle.uom_code,
               sle.source_type, sle.source_id, sle.source_line_id,
               sle.reversal_of_id, sle.remarks, sle.created_by
        from stock_ledger sle
        join warehouses w on w.id = sle.warehouse_id
        join products p on p.id = sle.product_id
        left join locations l on l.id = sle.location_id
        left join batches b on b.id = sle.batch_id
        where sle.tenant_id = ${actor.tenantId}
          and (${customerFilter}::uuid is null or sle.customer_id = ${customerFilter})
          and (${warehouseFilter}::uuid is null or sle.warehouse_id = ${warehouseFilter})
          and (${productFilter}::uuid is null or sle.product_id = ${productFilter})
          and (${txnTypeFilter}::text is null or sle.txn_type = ${txnTypeFilter})
          and (${sourceTypeFilter}::text is null or sle.source_type = ${sourceTypeFilter})
          and (${sourceIdFilter}::uuid is null or sle.source_id = ${sourceIdFilter})
        order by sle.txn_at asc, sle.id asc
        limit ${query.limit} offset ${query.offset}
      `;
      const [{ count }] = await tx<{ count: string }[]>`
        select count(*)::text as count from stock_ledger sle
        where sle.tenant_id = ${actor.tenantId}
          and (${customerFilter}::uuid is null or sle.customer_id = ${customerFilter})
          and (${warehouseFilter}::uuid is null or sle.warehouse_id = ${warehouseFilter})
          and (${productFilter}::uuid is null or sle.product_id = ${productFilter})
          and (${txnTypeFilter}::text is null or sle.txn_type = ${txnTypeFilter})
          and (${sourceTypeFilter}::text is null or sle.source_type = ${sourceTypeFilter})
          and (${sourceIdFilter}::uuid is null or sle.source_id = ${sourceIdFilter})
      `;
      return {
        items: rows.map((r) => ({
          id: r.id,
          txnAt: r.txn_at,
          txnType: r.txn_type,
          customerId: r.customer_id,
          warehouseId: r.warehouse_id,
          warehouseCode: r.warehouse_code,
          locationId: r.location_id,
          locationFullCode: r.location_full_code,
          productId: r.product_id,
          sku: r.sku,
          productName: r.product_name,
          batchId: r.batch_id,
          batchNo: r.batch_no,
          serialNo: r.serial_no,
          qtyIn: r.qty_in,
          qtyOut: r.qty_out,
          reservedDelta: r.reserved_delta,
          balancePhysicalQty: r.balance_physical_qty,
          balanceReservedQty: r.balance_reserved_qty,
          uomCode: r.uom_code,
          sourceType: r.source_type,
          sourceId: r.source_id,
          sourceLineId: r.source_line_id,
          reversalOfId: r.reversal_of_id,
          remarks: r.remarks,
          createdBy: r.created_by,
        })),
        total: Number(count),
        limit: query.limit,
        offset: query.offset,
      };
    });
  }
}
