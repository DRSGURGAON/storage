import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { assertWarehouseInScope, loadWarehouseScope } from '../auth/warehouse-scope';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { NumberingService } from '../numbering/numbering.service';
import { AddFoundLineDto, CountLineDto } from './dto/count-line.dto';
import { CreateStockVerificationDto } from './dto/create-stock-verification.dto';
import { ListStockVerificationsQuery } from './dto/list-stock-verifications.query';

export interface VerificationRow {
  id: string;
  number: string;
  verification_date: string;
  warehouse_id: string;
  customer_id: string | null;
  verified_by: string | null;
  status: string;
  completed_at: string | null;
  created_at: string;
}

interface VerificationLineRow {
  id: string;
  stock_lot_id: string | null;
  product_id: string;
  batch_id: string | null;
  location_id: string | null;
  system_qty: string;
  physical_qty: string;
  difference_qty: string;
  reason: string | null;
  remarks: string | null;
  stock_adjustment_id: string | null;
  sku?: string;
  product_name?: string;
  uom_code?: string;
  batch_no?: string | null;
  location_code?: string | null;
}

const SELECT_COLUMNS = `
  id, number, verification_date, warehouse_id, customer_id, verified_by, status,
  completed_at, created_at`;

function toApi(row: VerificationRow, lines?: VerificationLineRow[]) {
  return {
    id: row.id,
    number: row.number,
    verificationDate: row.verification_date,
    warehouseId: row.warehouse_id,
    customerId: row.customer_id,
    verifiedBy: row.verified_by,
    status: row.status,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    ...(lines && {
      lines: lines.map((l) => ({
        id: l.id,
        stockLotId: l.stock_lot_id,
        productId: l.product_id,
        sku: l.sku,
        productName: l.product_name,
        uomCode: l.uom_code,
        batchId: l.batch_id,
        batchNo: l.batch_no ?? null,
        locationId: l.location_id,
        locationCode: l.location_code ?? null,
        systemQty: Number(l.system_qty),
        physicalQty: Number(l.physical_qty),
        differenceQty: Number(l.difference_qty),
        reason: l.reason,
        remarks: l.remarks,
        stockAdjustmentId: l.stock_adjustment_id,
      })),
      // The whole reason a count exists: what does not match.
      discrepancyCount: lines.filter((l) => Number(l.difference_qty) !== 0).length,
    }),
  };
}

/**
 * Blueprint §27's physical stock verification -- a count sheet, and
 * nothing more. It deliberately **posts no stock**, in either direction:
 * finding 8 bags where the system says 10 does not correct the system, it
 * records a disagreement. Correcting it is a Stock Adjustment, which
 * carries an approval chain precisely because changing a stock figure
 * without a receipt or a dispatch behind it is the one operation nobody
 * should be able to do alone (§50, and `stock-engine.md` §3.4: "there is
 * no manual stock edit transaction type").
 *
 * Lines are populated from `stock_lots` at creation rather than supplied
 * by the caller. A count whose subject the counter chooses is not a
 * count -- the whole value is in comparing what is on the shelf against
 * what the system claims independently of who is looking. `system_qty` is
 * frozen at that moment for the same reason a GRN freezes its product
 * snapshot: the sheet has to mean what it meant when it was printed.
 */
@Injectable()
export class StockVerificationsService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
  ) {}

  async create(actor: AuthenticatedUser, dto: CreateStockVerificationDto, ipAddress?: string) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      assertWarehouseInScope(scope, dto.warehouseId);

      const [warehouse] = await tx`select 1 from warehouses where id = ${dto.warehouseId} and tenant_id = ${actor.tenantId}`;
      if (!warehouse) throw new NotFoundException('Warehouse not found');
      if (dto.customerId) {
        const [customer] = await tx`select 1 from customers where id = ${dto.customerId} and tenant_id = ${actor.tenantId}`;
        if (!customer) throw new NotFoundException('Customer not found');
      }

      const number = await this.numbering.allocateNumberIn(tx, actor.tenantId, 'STOCK_VERIFICATION', dto.warehouseId);
      const id = randomUUID();
      await tx`
        insert into stock_verifications (
          id, tenant_id, number, verification_date, warehouse_id, customer_id, verified_by, created_by
        ) values (
          ${id}, ${actor.tenantId}, ${number},
          ${dto.verificationDate ?? new Date().toISOString().slice(0, 10)},
          ${dto.warehouseId}, ${dto.customerId ?? null}, ${actor.userId}, ${actor.userId}
        )
      `;

      // Only lots that actually hold something: a sheet listing every lot
      // ever emptied would bury the twenty rows that matter.
      const lots = await tx<
        { id: string; product_id: string; batch_id: string | null; location_id: string | null; physical_qty: string }[]
      >`
        select id, product_id, batch_id, location_id, physical_qty
        from stock_lots
        where tenant_id = ${actor.tenantId} and warehouse_id = ${dto.warehouseId}
          and (${dto.customerId ?? null}::uuid is null or customer_id = ${dto.customerId ?? null})
          and physical_qty <> 0
        order by location_id nulls first, product_id
      `;
      for (const lot of lots) {
        await tx`
          insert into stock_verification_lines (
            id, tenant_id, verification_id, stock_lot_id, product_id, batch_id, location_id,
            system_qty, physical_qty
          ) values (
            ${randomUUID()}, ${actor.tenantId}, ${id}, ${lot.id}, ${lot.product_id}, ${lot.batch_id},
            ${lot.location_id}, ${lot.physical_qty}, ${lot.physical_qty}
          )
        `;
      }

      return (await this.fetchWithLines(tx, actor.tenantId, id))!;
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'create',
      entityType: 'stock_verification',
      entityId: result.row.id,
      newValue: result.row,
      ipAddress,
    });
    return toApi(result.row, result.lines);
  }

  private async fetchWithLines(tx: postgres.TransactionSql, tenantId: string, id: string) {
    const [row] = await tx<VerificationRow[]>`
      select ${tx.unsafe(SELECT_COLUMNS)} from stock_verifications where id = ${id} and tenant_id = ${tenantId}
    `;
    if (!row) return null;
    const lines = await tx<VerificationLineRow[]>`
      select svl.id, svl.stock_lot_id, svl.product_id, svl.batch_id, svl.location_id,
             svl.system_qty, svl.physical_qty, svl.difference_qty, svl.reason, svl.remarks,
             svl.stock_adjustment_id,
             p.sku, p.name as product_name, p.uom_code, b.batch_no, l.full_code as location_code
      from stock_verification_lines svl
      join products p on p.id = svl.product_id
      left join batches b on b.id = svl.batch_id
      left join locations l on l.id = svl.location_id
      where svl.tenant_id = ${tenantId} and svl.verification_id = ${id}
      order by l.full_code nulls first, p.sku
    `;
    return { row, lines };
  }

  private async loadDraft(tx: postgres.TransactionSql, actor: AuthenticatedUser, id: string) {
    const scope = await loadWarehouseScope(tx, actor);
    const [row] = await tx<VerificationRow[]>`
      select ${tx.unsafe(SELECT_COLUMNS)} from stock_verifications
      where id = ${id} and tenant_id = ${actor.tenantId}
        and (${scope}::uuid[] is null or warehouse_id = any(${scope}))
      for update
    `;
    if (!row) return null;
    if (row.status !== 'draft') {
      throw new BadRequestException(`Cannot change a verification in '${row.status}' status`);
    }
    return row;
  }

  async countLine(actor: AuthenticatedUser, id: string, lineId: string, dto: CountLineDto, ipAddress?: string) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const row = await this.loadDraft(tx, actor, id);
      if (!row) return null;
      const [updated] = await tx`
        update stock_verification_lines
        set physical_qty = ${dto.physicalQty}, reason = ${dto.reason ?? null}, remarks = ${dto.remarks ?? null}
        where id = ${lineId} and tenant_id = ${actor.tenantId} and verification_id = ${id}
        returning id
      `;
      if (!updated) throw new NotFoundException('Verification line not found');
      return (await this.fetchWithLines(tx, actor.tenantId, id))!;
    });
    if (!result) throw new NotFoundException('Stock verification not found');

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'update',
      entityType: 'stock_verification',
      entityId: id,
      newValue: { lineId, physicalQty: dto.physicalQty },
      ipAddress,
    });
    return toApi(result.row, result.lines);
  }

  /** Goods on a shelf that the system has no lot for at all -- a find, not a mismatch. */
  async addFoundLine(actor: AuthenticatedUser, id: string, dto: AddFoundLineDto, ipAddress?: string) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const row = await this.loadDraft(tx, actor, id);
      if (!row) return null;

      const [product] = await tx`select 1 from products where id = ${dto.productId} and tenant_id = ${actor.tenantId}`;
      if (!product) throw new NotFoundException('Product not found');
      const [location] = await tx<{ warehouse_id: string }[]>`
        select warehouse_id from locations where id = ${dto.locationId} and tenant_id = ${actor.tenantId}
      `;
      if (!location) throw new NotFoundException('Location not found');
      if (location.warehouse_id !== row.warehouse_id) {
        throw new BadRequestException('That location belongs to a different warehouse');
      }
      if (dto.batchId) {
        const [batch] = await tx`select 1 from batches where id = ${dto.batchId} and tenant_id = ${actor.tenantId}`;
        if (!batch) throw new NotFoundException('Batch not found');
      }

      await tx`
        insert into stock_verification_lines (
          id, tenant_id, verification_id, stock_lot_id, product_id, batch_id, location_id,
          system_qty, physical_qty, reason, remarks
        ) values (
          ${randomUUID()}, ${actor.tenantId}, ${id}, null, ${dto.productId}, ${dto.batchId ?? null},
          ${dto.locationId}, 0, ${dto.physicalQty}, ${dto.reason ?? 'Found during count'}, ${dto.remarks ?? null}
        )
      `;
      return (await this.fetchWithLines(tx, actor.tenantId, id))!;
    });
    if (!result) throw new NotFoundException('Stock verification not found');
    return toApi(result.row, result.lines);
  }

  private async transition(
    actor: AuthenticatedUser,
    id: string,
    ipAddress: string | undefined,
    allowedFrom: string[],
    apply: (tx: postgres.TransactionSql, before: VerificationRow) => Promise<void>,
  ) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const [before] = await tx<VerificationRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from stock_verifications
        where id = ${id} and tenant_id = ${actor.tenantId}
          and (${scope}::uuid[] is null or warehouse_id = any(${scope}))
        for update
      `;
      if (!before) return null;
      if (!allowedFrom.includes(before.status)) {
        throw new BadRequestException(
          `Cannot transition a verification from '${before.status}' (expected one of: ${allowedFrom.join(', ')})`,
        );
      }
      await apply(tx, before);
      return { before, after: (await this.fetchWithLines(tx, actor.tenantId, id))! };
    });
    if (!result) throw new NotFoundException('Stock verification not found');

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'status_change',
      entityType: 'stock_verification',
      entityId: id,
      previousValue: { status: result.before.status },
      newValue: { status: result.after.row.status },
      ipAddress,
    });
    return toApi(result.after.row, result.after.lines);
  }

  complete(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['draft'], async (tx) => {
      await tx`
        update stock_verifications set status = 'completed', completed_at = now()
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;
    });
  }

  cancel(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['draft'], async (tx) => {
      await tx`update stock_verifications set status = 'cancelled' where id = ${id} and tenant_id = ${actor.tenantId}`;
    });
  }

  async list(actor: AuthenticatedUser, query: ListStockVerificationsQuery) {
    const pattern = query.q ? `%${query.q}%` : null;
    const warehouseFilter = query.warehouseId ?? null;
    const customerFilter = query.customerId ?? null;
    const statusFilter = query.status ?? null;

    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const rows = await tx<VerificationRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from stock_verifications
        where tenant_id = ${actor.tenantId}
          and (${scope}::uuid[] is null or warehouse_id = any(${scope}))
          and (${pattern}::text is null or number ilike ${pattern})
          and (${warehouseFilter}::uuid is null or warehouse_id = ${warehouseFilter})
          and (${customerFilter}::uuid is null or customer_id = ${customerFilter})
          and (${statusFilter}::text is null or status = ${statusFilter})
        order by verification_date desc, created_at desc
        limit ${query.limit} offset ${query.offset}
      `;
      const [{ count }] = await tx<{ count: string }[]>`
        select count(*)::text as count from stock_verifications
        where tenant_id = ${actor.tenantId}
          and (${scope}::uuid[] is null or warehouse_id = any(${scope}))
          and (${pattern}::text is null or number ilike ${pattern})
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
    if (!fetched) throw new NotFoundException('Stock verification not found');
    return toApi(fetched.row, fetched.lines);
  }
}
