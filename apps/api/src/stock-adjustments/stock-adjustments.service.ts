import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { assertWarehouseInScope, loadWarehouseScope } from '../auth/warehouse-scope';
import { SETTINGS_BY_KEY } from '../company/tenant-settings.registry';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { NumberingService } from '../numbering/numbering.service';
import { StockMovement, StockService } from '../stock/stock.service';
import { CreateStockAdjustmentDto } from './dto/create-stock-adjustment.dto';
import { ListStockAdjustmentsQuery } from './dto/list-stock-adjustments.query';

/** Declared once in the settings registry, so the switch and this reader share a key. */
const OWNER_REQUIRED = SETTINGS_BY_KEY.get('approvals.stock_adjustment.owner_required')!;

interface AdjustmentRow {
  id: string;
  number: string;
  adjustment_date: string;
  warehouse_id: string;
  customer_id: string;
  source_verification_id: string | null;
  reason: string;
  status: string;
  requested_by: string | null;
  manager_approved_by: string | null;
  manager_approved_at: string | null;
  owner_approved_by: string | null;
  owner_approved_at: string | null;
  posted_at: string | null;
  created_at: string;
}

interface AdjustmentLineRow {
  id: string;
  product_id: string;
  batch_id: string | null;
  location_id: string | null;
  quantity_delta: string;
  remarks: string | null;
  sku?: string;
  product_name?: string;
  uom_code?: string;
  batch_no?: string | null;
  location_code?: string | null;
}

const SELECT_COLUMNS = `
  id, number, adjustment_date, warehouse_id, customer_id, source_verification_id, reason,
  status, requested_by, manager_approved_by, manager_approved_at, owner_approved_by,
  owner_approved_at, posted_at, created_at`;

function toApi(row: AdjustmentRow, lines?: AdjustmentLineRow[]) {
  return {
    id: row.id,
    number: row.number,
    adjustmentDate: row.adjustment_date,
    warehouseId: row.warehouse_id,
    customerId: row.customer_id,
    sourceVerificationId: row.source_verification_id,
    reason: row.reason,
    status: row.status,
    requestedBy: row.requested_by,
    managerApprovedBy: row.manager_approved_by,
    managerApprovedAt: row.manager_approved_at,
    ownerApprovedBy: row.owner_approved_by,
    ownerApprovedAt: row.owner_approved_at,
    postedAt: row.posted_at,
    createdAt: row.created_at,
    ...(lines && {
      lines: lines.map((l) => ({
        id: l.id,
        productId: l.product_id,
        sku: l.sku,
        productName: l.product_name,
        uomCode: l.uom_code,
        batchId: l.batch_id,
        batchNo: l.batch_no ?? null,
        locationId: l.location_id,
        locationCode: l.location_code ?? null,
        quantityDelta: Number(l.quantity_delta),
        remarks: l.remarks,
      })),
    }),
  };
}

/**
 * Blueprint §27's Stock Adjustment: the **only** way a stock figure
 * changes without a receipt or a dispatch behind it, and therefore the
 * one operation in the system that carries a real approval chain (§50).
 *
 * `stock-engine.md` §3.4 is the rule this implements: "there is no manual
 * stock edit transaction type; a correction is always an explicit,
 * approved `ADJUSTMENT` referencing a `stock_adjustments` row." Every
 * ledger row this posts names this record, so any figure that ever moved
 * without a document behind it can be traced to the person who asked and
 * the person who agreed.
 *
 * The chain is `draft → pending_manager → [pending_owner] → approved →
 * posted`, with the owner step present only when the tenant has turned on
 * `approvals.stock_adjustment.owner_required`. `approve_stock_adjustment`
 * is the manager step (Owner/Admin/Warehouse Manager);
 * `approve_stock_adjustment_final` is Owner alone -- not even Admin holds
 * it, which is the only permission in the matrix narrower than Admin
 * besides agreement approval.
 *
 * **Approval and posting are separate acts**, and that is deliberate
 * rather than ceremony. Posting can legitimately fail: a write-off of 50
 * bags against a lot now holding 30 hits the negative-stock invariant. If
 * approval posted in the same breath, that failure would roll back the
 * approval too, silently discarding a decision two people already made.
 * Keeping them apart means the authorisation is durable and the posting
 * is retryable -- and `posted_at` stays the honest answer to "has this
 * actually moved anything yet?".
 */
@Injectable()
export class StockAdjustmentsService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly stock: StockService,
  ) {}

  async create(actor: AuthenticatedUser, dto: CreateStockAdjustmentDto, ipAddress?: string) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);

      let warehouseId = dto.warehouseId ?? null;
      let customerId = dto.customerId ?? null;
      let lines = dto.lines ?? [];

      if (dto.sourceVerificationId) {
        const loaded = await this.loadFromVerification(tx, actor, dto.sourceVerificationId);
        warehouseId = warehouseId ?? loaded.warehouseId;
        customerId = customerId ?? loaded.customerId;
        if (lines.length === 0) lines = loaded.lines;
      }

      if (!warehouseId || !customerId) {
        throw new BadRequestException(
          'warehouseId and customerId are required (directly, or via a sourceVerificationId that has a customer)',
        );
      }
      if (lines.length === 0) {
        throw new BadRequestException('An adjustment needs at least one line');
      }
      assertWarehouseInScope(scope, warehouseId);

      const [warehouse] = await tx`select 1 from warehouses where id = ${warehouseId} and tenant_id = ${actor.tenantId}`;
      if (!warehouse) throw new NotFoundException('Warehouse not found');
      const [customer] = await tx`select 1 from customers where id = ${customerId} and tenant_id = ${actor.tenantId}`;
      if (!customer) throw new NotFoundException('Customer not found');

      const number = await this.numbering.allocateNumberIn(tx, actor.tenantId, 'STOCK_ADJUSTMENT', warehouseId);
      const id = randomUUID();
      await tx`
        insert into stock_adjustments (
          id, tenant_id, number, adjustment_date, warehouse_id, customer_id,
          source_verification_id, reason, requested_by, created_by
        ) values (
          ${id}, ${actor.tenantId}, ${number},
          ${dto.adjustmentDate ?? new Date().toISOString().slice(0, 10)},
          ${warehouseId}, ${customerId}, ${dto.sourceVerificationId ?? null}, ${dto.reason},
          ${actor.userId}, ${actor.userId}
        )
      `;

      let lineNo = 1;
      for (const line of lines) {
        if (line.quantityDelta === 0) {
          throw new BadRequestException(`Line ${lineNo}: a quantityDelta of zero adjusts nothing`);
        }
        const [product] = await tx`select 1 from products where id = ${line.productId} and tenant_id = ${actor.tenantId}`;
        if (!product) throw new NotFoundException(`Line ${lineNo}: product not found`);
        if (line.locationId) {
          const [location] = await tx<{ warehouse_id: string }[]>`
            select warehouse_id from locations where id = ${line.locationId} and tenant_id = ${actor.tenantId}
          `;
          if (!location) throw new NotFoundException(`Line ${lineNo}: location not found`);
          if (location.warehouse_id !== warehouseId) {
            throw new BadRequestException(`Line ${lineNo}: location belongs to a different warehouse`);
          }
        }
        await tx`
          insert into stock_adjustment_lines (
            id, tenant_id, adjustment_id, product_id, batch_id, location_id, quantity_delta, remarks
          ) values (
            ${randomUUID()}, ${actor.tenantId}, ${id}, ${line.productId}, ${line.batchId ?? null},
            ${line.locationId ?? null}, ${line.quantityDelta}, ${line.remarks ?? null}
          )
        `;
        lineNo += 1;
      }

      return (await this.fetchWithLines(tx, actor.tenantId, id))!;
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'create',
      entityType: 'stock_adjustment',
      entityId: result.row.id,
      newValue: result.row,
      ipAddress,
    });
    return toApi(result.row, result.lines);
  }

  /**
   * Copies only the lines that actually disagree. A completed count of two
   * hundred lots where four were wrong should raise a four-line
   * adjustment, not a two-hundred-line one where 196 rows say "change
   * nothing".
   */
  private async loadFromVerification(tx: postgres.TransactionSql, actor: AuthenticatedUser, verificationId: string) {
    const [verification] = await tx<{ warehouse_id: string; customer_id: string | null; status: string }[]>`
      select warehouse_id, customer_id, status from stock_verifications
      where id = ${verificationId} and tenant_id = ${actor.tenantId}
    `;
    if (!verification) throw new NotFoundException('Stock verification not found');
    if (verification.status !== 'completed') {
      throw new BadRequestException(
        `Cannot adjust from a verification in '${verification.status}' status -- complete the count first`,
      );
    }

    const rows = await tx<
      { product_id: string; batch_id: string | null; location_id: string | null; difference_qty: string; reason: string | null }[]
    >`
      select product_id, batch_id, location_id, difference_qty, reason
      from stock_verification_lines
      where tenant_id = ${actor.tenantId} and verification_id = ${verificationId} and difference_qty <> 0
      order by id
    `;
    if (rows.length === 0) {
      throw new BadRequestException('That verification found no discrepancies -- there is nothing to adjust');
    }

    return {
      warehouseId: verification.warehouse_id,
      customerId: verification.customer_id,
      lines: rows.map((r) => ({
        productId: r.product_id,
        batchId: r.batch_id ?? undefined,
        locationId: r.location_id ?? undefined,
        // The count's own arithmetic, carried across unchanged: physical
        // minus system is exactly the correction needed.
        quantityDelta: Number(r.difference_qty),
        remarks: r.reason ?? undefined,
      })),
    };
  }

  private async fetchWithLines(tx: postgres.TransactionSql, tenantId: string, id: string) {
    const [row] = await tx<AdjustmentRow[]>`
      select ${tx.unsafe(SELECT_COLUMNS)} from stock_adjustments where id = ${id} and tenant_id = ${tenantId}
    `;
    if (!row) return null;
    const lines = await tx<AdjustmentLineRow[]>`
      select sal.id, sal.product_id, sal.batch_id, sal.location_id, sal.quantity_delta, sal.remarks,
             p.sku, p.name as product_name, p.uom_code, b.batch_no, l.full_code as location_code
      from stock_adjustment_lines sal
      join products p on p.id = sal.product_id
      left join batches b on b.id = sal.batch_id
      left join locations l on l.id = sal.location_id
      where sal.tenant_id = ${tenantId} and sal.adjustment_id = ${id}
      order by sal.id
    `;
    return { row, lines };
  }

  private async ownerApprovalRequired(tx: postgres.TransactionSql, tenantId: string): Promise<boolean> {
    const [row] = await tx<{ value: unknown }[]>`
      select value from tenant_settings where tenant_id = ${tenantId} and key = ${OWNER_REQUIRED.key}
    `;
    return row === undefined ? OWNER_REQUIRED.default === true : row.value === true;
  }

  private async transition(
    actor: AuthenticatedUser,
    id: string,
    ipAddress: string | undefined,
    allowedFrom: string[],
    apply: (tx: postgres.TransactionSql, before: AdjustmentRow) => Promise<void>,
  ) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const [before] = await tx<AdjustmentRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from stock_adjustments
        where id = ${id} and tenant_id = ${actor.tenantId}
          and (${scope}::uuid[] is null or warehouse_id = any(${scope}))
        for update
      `;
      if (!before) return null;
      if (!allowedFrom.includes(before.status)) {
        throw new BadRequestException(
          `Cannot transition a stock adjustment from '${before.status}' (expected one of: ${allowedFrom.join(', ')})`,
        );
      }
      await apply(tx, before);
      return { before, after: (await this.fetchWithLines(tx, actor.tenantId, id))! };
    });
    if (!result) throw new NotFoundException('Stock adjustment not found');

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'status_change',
      entityType: 'stock_adjustment',
      entityId: id,
      previousValue: { status: result.before.status },
      newValue: { status: result.after.row.status },
      ipAddress,
    });
    return toApi(result.after.row, result.after.lines);
  }

  submit(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['draft'], async (tx) => {
      await tx`update stock_adjustments set status = 'pending_manager' where id = ${id} and tenant_id = ${actor.tenantId}`;
    });
  }

  /**
   * The manager step. Where the tenant has switched on
   * `approvals.stock_adjustment.owner_required`, this hands over to the
   * Owner rather than approving outright -- the setting is read here, per
   * request, so turning it on takes effect on the next adjustment rather
   * than on a redeploy.
   */
  approveManager(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['pending_manager'], async (tx) => {
      const ownerRequired = await this.ownerApprovalRequired(tx, actor.tenantId);
      await tx`
        update stock_adjustments
        set status = ${ownerRequired ? 'pending_owner' : 'approved'},
            manager_approved_by = ${actor.userId}, manager_approved_at = now()
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;
    });
  }

  /** Owner-only (`approve_stock_adjustment_final`); not even Admin holds this one. */
  approveOwner(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['pending_owner'], async (tx) => {
      await tx`
        update stock_adjustments
        set status = 'approved', owner_approved_by = ${actor.userId}, owner_approved_at = now()
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;
    });
  }

  reject(actor: AuthenticatedUser, id: string, reason: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['pending_manager', 'pending_owner'], async (tx) => {
      await tx`
        update stock_adjustments set status = 'rejected', reason = ${reason}
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;
    });
  }

  cancel(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['draft', 'pending_manager'], async (tx) => {
      await tx`update stock_adjustments set status = 'cancelled' where id = ${id} and tenant_id = ${actor.tenantId}`;
    });
  }

  /**
   * The only place in the system that writes an `ADJUSTMENT` ledger row.
   * A positive `quantity_delta` becomes `qtyIn`, a negative one `qtyOut`
   * -- the sign is the direction, and the engine's own invariant refuses
   * anything that would take a balance below zero, so a write-off larger
   * than what is actually there fails here rather than producing a
   * negative shelf.
   */
  post(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['approved'], async (tx, before) => {
      const lines = await tx<
        { id: string; product_id: string; batch_id: string | null; location_id: string | null; quantity_delta: string; uom_code: string }[]
      >`
        select sal.id, sal.product_id, sal.batch_id, sal.location_id, sal.quantity_delta, p.uom_code
        from stock_adjustment_lines sal
        join products p on p.id = sal.product_id
        where sal.tenant_id = ${actor.tenantId} and sal.adjustment_id = ${id}
        order by sal.id
      `;

      const movements: StockMovement[] = lines.map((line) => {
        const delta = Number(line.quantity_delta);
        return {
          txnType: 'ADJUSTMENT',
          customerId: before.customer_id,
          warehouseId: before.warehouse_id,
          locationId: line.location_id,
          productId: line.product_id,
          batchId: line.batch_id,
          serialNo: null,
          qtyIn: delta > 0 ? delta : 0,
          qtyOut: delta < 0 ? -delta : 0,
          uomCode: line.uom_code,
          sourceLineId: line.id,
          remarks: before.reason,
        };
      });

      await this.stock.postWithin(tx, actor, {
        sourceType: 'stock_adjustment',
        sourceId: id,
        idempotencyKey: `stock_adjustment:${id}:post`,
        movements,
      });

      await tx`
        update stock_adjustments set status = 'posted', posted_at = now()
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;
      // Closes the loop back to the count: each verification line now
      // points at the adjustment that resolved it (§27's own column).
      if (before.source_verification_id) {
        await tx`
          update stock_verification_lines set stock_adjustment_id = ${id}
          where tenant_id = ${actor.tenantId} and verification_id = ${before.source_verification_id}
            and difference_qty <> 0 and stock_adjustment_id is null
        `;
      }
    });
  }

  async list(actor: AuthenticatedUser, query: ListStockAdjustmentsQuery) {
    const pattern = query.q ? `%${query.q}%` : null;
    const warehouseFilter = query.warehouseId ?? null;
    const customerFilter = query.customerId ?? null;
    const statusFilter = query.status ?? null;

    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const rows = await tx<AdjustmentRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from stock_adjustments
        where tenant_id = ${actor.tenantId}
          and (${scope}::uuid[] is null or warehouse_id = any(${scope}))
          and (${pattern}::text is null or number ilike ${pattern} or reason ilike ${pattern})
          and (${warehouseFilter}::uuid is null or warehouse_id = ${warehouseFilter})
          and (${customerFilter}::uuid is null or customer_id = ${customerFilter})
          and (${statusFilter}::text is null or status = ${statusFilter})
        order by adjustment_date desc, created_at desc
        limit ${query.limit} offset ${query.offset}
      `;
      const [{ count }] = await tx<{ count: string }[]>`
        select count(*)::text as count from stock_adjustments
        where tenant_id = ${actor.tenantId}
          and (${scope}::uuid[] is null or warehouse_id = any(${scope}))
          and (${pattern}::text is null or number ilike ${pattern} or reason ilike ${pattern})
          and (${warehouseFilter}::uuid is null or warehouse_id = ${warehouseFilter})
          and (${customerFilter}::uuid is null or customer_id = ${customerFilter})
          and (${statusFilter}::text is null or status = ${statusFilter})
      `;
      return { items: rows.map((r) => toApi(r)), total: Number(count), limit: query.limit, offset: query.offset };
    });
  }

  async get(actor: AuthenticatedUser, id: string) {
    const fetched = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const found = await this.fetchWithLines(tx, actor.tenantId, id);
      if (!found) return null;
      if (scope && !scope.includes(found.row.warehouse_id)) return null;
      return found;
    });
    if (!fetched) throw new NotFoundException('Stock adjustment not found');
    return toApi(fetched.row, fetched.lines);
  }
}
