import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { assertWarehouseInScope, loadWarehouseScope } from '../auth/warehouse-scope';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { NumberingService } from '../numbering/numbering.service';
import { StockMovement, StockService } from '../stock/stock.service';
import { CreateStockTransferDto } from './dto/create-stock-transfer.dto';
import { ListStockTransfersQuery } from './dto/list-stock-transfers.query';

interface TransferRow {
  id: string;
  number: string;
  transfer_date: string;
  transfer_kind: string;
  customer_id: string;
  from_warehouse_id: string;
  to_warehouse_id: string;
  vehicle_id: string | null;
  driver_id: string | null;
  status: string;
  approved_at: string | null;
  approved_by: string | null;
  completed_at: string | null;
  completed_by: string | null;
  remarks: string | null;
  created_at: string;
}

interface TransferLineRow {
  id: string;
  product_id: string;
  batch_id: string | null;
  quantity: string;
  from_location_id: string;
  to_location_id: string | null;
  sku?: string;
  product_name?: string;
  batch_no?: string | null;
  uom_code?: string;
  from_location_code?: string;
  to_location_code?: string | null;
}

const SELECT_COLUMNS = `
  id, number, transfer_date, transfer_kind, customer_id, from_warehouse_id, to_warehouse_id,
  vehicle_id, driver_id, status, approved_at, approved_by, completed_at, completed_by,
  remarks, created_at`;

function toApi(row: TransferRow, lines?: TransferLineRow[]) {
  return {
    id: row.id,
    number: row.number,
    transferDate: row.transfer_date,
    transferKind: row.transfer_kind,
    customerId: row.customer_id,
    fromWarehouseId: row.from_warehouse_id,
    toWarehouseId: row.to_warehouse_id,
    vehicleId: row.vehicle_id,
    driverId: row.driver_id,
    status: row.status,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
    completedAt: row.completed_at,
    completedBy: row.completed_by,
    remarks: row.remarks,
    createdAt: row.created_at,
    ...(lines && {
      lines: lines.map((l) => ({
        id: l.id,
        productId: l.product_id,
        sku: l.sku,
        productName: l.product_name,
        batchId: l.batch_id,
        batchNo: l.batch_no ?? null,
        quantity: Number(l.quantity),
        uomCode: l.uom_code,
        fromLocationId: l.from_location_id,
        fromLocationCode: l.from_location_code,
        toLocationId: l.to_location_id,
        toLocationCode: l.to_location_code ?? null,
      })),
    }),
  };
}

/**
 * Blueprint §28 / stock-engine.md §7: a Stock Transfer Note moves goods
 * between locations, or between warehouses, as **two ledger rows** --
 * `TRANSFER_OUT` where they were and `TRANSFER_IN` where they went --
 * never by mutating one balance row's `warehouse_id` or `location_id`.
 *
 * When those two rows are written is the whole design question here, and
 * the two transfer kinds answer it differently:
 *
 * - **`location`** (bin to bin, one warehouse): both rows at `complete`.
 *   A pallet moved across an aisle is not in transit in any meaningful
 *   sense, and there is no vehicle to track.
 * - **`warehouse`**: the `TRANSFER_OUT` when the truck leaves
 *   (`in_transit`), the `TRANSFER_IN` when it arrives (`complete`).
 *   Between the two, the goods are deliberately in **neither** warehouse's
 *   balance -- because that is where they physically are: in a vehicle, on
 *   a road, in nobody's rack. Posting both at completion would show the
 *   stock at the source for as long as the journey takes, which is a lie
 *   the moment anyone tries to pick from it; posting both at dispatch
 *   would show it arrived before it did. The transfer record and
 *   `GET /stock/ledger?sourceId=` are the trace for the gap.
 *
 * That gap is also why an `in_transit` transfer cannot be cancelled: the
 * stock has already left. Undoing it means a second, deliberate movement,
 * not an edit to this one (§3.5 -- reversal is additive, never
 * destructive).
 *
 * Every route rides `create_stock_transfer`: `permissions-matrix.md` seeds
 * no separate approve code for this module, unlike stock adjustments,
 * where it seeds two.
 */
@Injectable()
export class StockTransfersService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly stock: StockService,
  ) {}

  async create(actor: AuthenticatedUser, dto: CreateStockTransferDto, ipAddress?: string) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      // Both ends, because a transfer touches both -- a membership
      // restricted to one warehouse cannot move goods out of another's rack
      // any more than it can into one.
      assertWarehouseInScope(scope, dto.fromWarehouseId);
      assertWarehouseInScope(scope, dto.toWarehouseId);

      if (dto.transferKind === 'location' && dto.fromWarehouseId !== dto.toWarehouseId) {
        throw new BadRequestException(
          "A 'location' transfer moves goods within one warehouse; use transferKind 'warehouse' to move them between two",
        );
      }
      if (dto.transferKind === 'warehouse' && dto.fromWarehouseId === dto.toWarehouseId) {
        throw new BadRequestException(
          "A 'warehouse' transfer needs two different warehouses; use transferKind 'location' to move goods within one",
        );
      }

      for (const id of new Set([dto.fromWarehouseId, dto.toWarehouseId])) {
        const [warehouse] = await tx`select 1 from warehouses where id = ${id} and tenant_id = ${actor.tenantId}`;
        if (!warehouse) throw new NotFoundException('Warehouse not found');
      }
      const [customer] = await tx`select 1 from customers where id = ${dto.customerId} and tenant_id = ${actor.tenantId}`;
      if (!customer) throw new NotFoundException('Customer not found');
      await this.assertTransportRefs(tx, actor.tenantId, dto);

      const number = await this.numbering.allocateNumberIn(tx, actor.tenantId, 'STOCK_TRANSFER', dto.fromWarehouseId);
      const id = randomUUID();
      await tx`
        insert into stock_transfers (
          id, tenant_id, number, transfer_date, transfer_kind, customer_id,
          from_warehouse_id, to_warehouse_id, vehicle_id, driver_id, remarks, created_by
        ) values (
          ${id}, ${actor.tenantId}, ${number}, ${dto.transferDate ?? new Date().toISOString().slice(0, 10)},
          ${dto.transferKind}, ${dto.customerId}, ${dto.fromWarehouseId}, ${dto.toWarehouseId},
          ${dto.vehicleId ?? null}, ${dto.driverId ?? null}, ${dto.remarks ?? null}, ${actor.userId}
        )
      `;
      await this.insertLines(tx, actor, id, dto);

      const fetched = await this.fetchWithLines(tx, actor.tenantId, id);
      return fetched!;
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'create',
      entityType: 'stock_transfer',
      entityId: result.row.id,
      newValue: result.row,
      ipAddress,
    });
    return toApi(result.row, result.lines);
  }

  private async assertTransportRefs(tx: postgres.TransactionSql, tenantId: string, dto: CreateStockTransferDto) {
    if (dto.vehicleId) {
      const [vehicle] = await tx`select 1 from vehicles where id = ${dto.vehicleId} and tenant_id = ${tenantId}`;
      if (!vehicle) throw new NotFoundException('Vehicle not found');
    }
    if (dto.driverId) {
      const [driver] = await tx`select 1 from drivers where id = ${dto.driverId} and tenant_id = ${tenantId}`;
      if (!driver) throw new NotFoundException('Driver not found');
    }
  }

  private async insertLines(
    tx: postgres.TransactionSql,
    actor: AuthenticatedUser,
    transferId: string,
    dto: CreateStockTransferDto,
  ) {
    let lineNo = 1;
    for (const line of dto.lines) {
      const [product] = await tx<{ id: string }[]>`
        select id from products
        where id = ${line.productId} and tenant_id = ${actor.tenantId}
          and (customer_id is null or customer_id = ${dto.customerId})
      `;
      if (!product) throw new NotFoundException(`Line ${lineNo}: product not found`);

      await this.assertLocation(tx, actor.tenantId, line.fromLocationId, dto.fromWarehouseId, `Line ${lineNo}: source`);
      if (line.toLocationId) {
        await this.assertLocation(tx, actor.tenantId, line.toLocationId, dto.toWarehouseId, `Line ${lineNo}: destination`);
      }
      if (dto.transferKind === 'location' && line.fromLocationId === line.toLocationId) {
        throw new BadRequestException(`Line ${lineNo}: source and destination locations are the same`);
      }
      if (line.batchId) {
        const [batch] = await tx`select 1 from batches where id = ${line.batchId} and tenant_id = ${actor.tenantId}`;
        if (!batch) throw new NotFoundException(`Line ${lineNo}: batch not found`);
      }

      await tx`
        insert into stock_transfer_lines (
          id, tenant_id, transfer_id, product_id, batch_id, quantity, from_location_id, to_location_id
        ) values (
          ${randomUUID()}, ${actor.tenantId}, ${transferId}, ${line.productId}, ${line.batchId ?? null},
          ${line.quantity}, ${line.fromLocationId}, ${line.toLocationId ?? null}
        )
      `;
      lineNo += 1;
    }
  }

  private async assertLocation(
    tx: postgres.TransactionSql,
    tenantId: string,
    locationId: string,
    warehouseId: string,
    label: string,
  ) {
    const [location] = await tx<{ warehouse_id: string; is_active: boolean }[]>`
      select warehouse_id, is_active from locations where id = ${locationId} and tenant_id = ${tenantId}
    `;
    if (!location) throw new NotFoundException(`${label} location not found`);
    if (location.warehouse_id !== warehouseId) {
      throw new BadRequestException(`${label} location belongs to a different warehouse`);
    }
    if (!location.is_active) throw new BadRequestException(`${label} location is not active`);
  }

  private async fetchWithLines(tx: postgres.TransactionSql, tenantId: string, id: string) {
    const [row] = await tx<TransferRow[]>`
      select ${tx.unsafe(SELECT_COLUMNS)} from stock_transfers where id = ${id} and tenant_id = ${tenantId}
    `;
    if (!row) return null;
    const lines = await tx<TransferLineRow[]>`
      select stl.id, stl.product_id, stl.batch_id, stl.quantity, stl.from_location_id, stl.to_location_id,
             p.sku, p.name as product_name, p.uom_code, b.batch_no,
             fl.full_code as from_location_code, tl.full_code as to_location_code
      from stock_transfer_lines stl
      join products p on p.id = stl.product_id
      join locations fl on fl.id = stl.from_location_id
      left join locations tl on tl.id = stl.to_location_id
      left join batches b on b.id = stl.batch_id
      where stl.tenant_id = ${tenantId} and stl.transfer_id = ${id}
      order by stl.id
    `;
    return { row, lines };
  }

  async list(actor: AuthenticatedUser, query: ListStockTransfersQuery) {
    const pattern = query.q ? `%${query.q}%` : null;
    const customerFilter = query.customerId ?? null;
    const fromFilter = query.fromWarehouseId ?? null;
    const toFilter = query.toWarehouseId ?? null;
    const statusFilter = query.status ?? null;

    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const rows = await tx<TransferRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from stock_transfers
        where tenant_id = ${actor.tenantId}
          and (${scope}::uuid[] is null or from_warehouse_id = any(${scope}) or to_warehouse_id = any(${scope}))
          and (${pattern}::text is null or number ilike ${pattern})
          and (${customerFilter}::uuid is null or customer_id = ${customerFilter})
          and (${fromFilter}::uuid is null or from_warehouse_id = ${fromFilter})
          and (${toFilter}::uuid is null or to_warehouse_id = ${toFilter})
          and (${statusFilter}::text is null or status = ${statusFilter})
        order by transfer_date desc, created_at desc
        limit ${query.limit} offset ${query.offset}
      `;
      const [{ count }] = await tx<{ count: string }[]>`
        select count(*)::text as count from stock_transfers
        where tenant_id = ${actor.tenantId}
          and (${scope}::uuid[] is null or from_warehouse_id = any(${scope}) or to_warehouse_id = any(${scope}))
          and (${pattern}::text is null or number ilike ${pattern})
          and (${customerFilter}::uuid is null or customer_id = ${customerFilter})
          and (${fromFilter}::uuid is null or from_warehouse_id = ${fromFilter})
          and (${toFilter}::uuid is null or to_warehouse_id = ${toFilter})
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
      if (scope && !scope.includes(found.row.from_warehouse_id) && !scope.includes(found.row.to_warehouse_id)) {
        return null;
      }
      return found;
    });
    if (!fetched) throw new NotFoundException('Stock transfer not found');
    return toApi(fetched.row, fetched.lines);
  }

  private async transition(
    actor: AuthenticatedUser,
    id: string,
    ipAddress: string | undefined,
    allowedFrom: string[],
    apply: (tx: postgres.TransactionSql, before: TransferRow) => Promise<void>,
  ) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const [before] = await tx<TransferRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from stock_transfers
        where id = ${id} and tenant_id = ${actor.tenantId}
          and (${scope}::uuid[] is null or from_warehouse_id = any(${scope}) or to_warehouse_id = any(${scope}))
        for update
      `;
      if (!before) return null;
      if (!allowedFrom.includes(before.status)) {
        throw new BadRequestException(
          `Cannot transition a stock transfer from '${before.status}' (expected one of: ${allowedFrom.join(', ')})`,
        );
      }
      await apply(tx, before);
      return { before, after: (await this.fetchWithLines(tx, actor.tenantId, id))! };
    });
    if (!result) throw new NotFoundException('Stock transfer not found');

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'status_change',
      entityType: 'stock_transfer',
      entityId: id,
      previousValue: { status: result.before.status },
      newValue: { status: result.after.row.status },
      ipAddress,
    });
    return toApi(result.after.row, result.after.lines);
  }

  approve(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['draft'], async (tx) => {
      await tx`
        update stock_transfers set status = 'approved', approved_at = now(), approved_by = ${actor.userId}
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;
    });
  }

  /**
   * Warehouse transfers only, and this is where the goods leave: the
   * `TRANSFER_OUT` posts here, so from this moment the source warehouse's
   * balance no longer counts stock that is on a truck.
   */
  dispatch(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['approved'], async (tx, before) => {
      if (before.transfer_kind !== 'warehouse') {
        throw new BadRequestException(
          "Only a 'warehouse' transfer is dispatched -- a bin-to-bin move has no journey, so complete it directly",
        );
      }
      await this.postOut(tx, actor, before);
      await tx`update stock_transfers set status = 'in_transit' where id = ${id} and tenant_id = ${actor.tenantId}`;
    });
  }

  /**
   * A location transfer posts both halves here. A warehouse transfer posts
   * only the arrival -- its departure was posted at `dispatch`.
   */
  complete(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['approved', 'in_transit'], async (tx, before) => {
      if (before.transfer_kind === 'warehouse' && before.status !== 'in_transit') {
        throw new BadRequestException(
          "A 'warehouse' transfer must be dispatched before it can be completed -- goods cannot arrive before they leave",
        );
      }
      if (before.status !== 'in_transit') await this.postOut(tx, actor, before);
      await this.postIn(tx, actor, before);
      await tx`
        update stock_transfers set status = 'completed', completed_at = now(), completed_by = ${actor.userId}
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;
    });
  }

  /**
   * Only before the goods move. Once a transfer is `in_transit` the
   * `TRANSFER_OUT` is already in the ledger, and stock-engine.md §3.5 is
   * explicit that reversal is additive: undoing it is a second, deliberate
   * movement, not an edit to this record.
   */
  cancel(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['draft', 'approved'], async (tx) => {
      await tx`update stock_transfers set status = 'cancelled' where id = ${id} and tenant_id = ${actor.tenantId}`;
    });
  }

  private async lineMovements(
    tx: postgres.TransactionSql,
    tenantId: string,
    transfer: TransferRow,
  ): Promise<TransferLineRow[]> {
    return tx<TransferLineRow[]>`
      select stl.id, stl.product_id, stl.batch_id, stl.quantity, stl.from_location_id, stl.to_location_id,
             p.uom_code
      from stock_transfer_lines stl
      join products p on p.id = stl.product_id
      where stl.tenant_id = ${tenantId} and stl.transfer_id = ${transfer.id}
      order by stl.id
    `;
  }

  private async postOut(tx: postgres.TransactionSql, actor: AuthenticatedUser, transfer: TransferRow) {
    const lines = await this.lineMovements(tx, actor.tenantId, transfer);
    const movements: StockMovement[] = lines.map((line) => ({
      txnType: 'TRANSFER_OUT',
      customerId: transfer.customer_id,
      warehouseId: transfer.from_warehouse_id,
      locationId: line.from_location_id,
      productId: line.product_id,
      batchId: line.batch_id,
      serialNo: null,
      qtyOut: Number(line.quantity),
      uomCode: line.uom_code!,
      sourceLineId: line.id,
    }));
    await this.stock.postWithin(tx, actor, {
      sourceType: 'stock_transfer',
      sourceId: transfer.id,
      idempotencyKey: `stock_transfer:${transfer.id}:out`,
      movements,
    });
  }

  private async postIn(tx: postgres.TransactionSql, actor: AuthenticatedUser, transfer: TransferRow) {
    const lines = await this.lineMovements(tx, actor.tenantId, transfer);
    const movements: StockMovement[] = lines.map((line) => ({
      txnType: 'TRANSFER_IN',
      customerId: transfer.customer_id,
      warehouseId: transfer.to_warehouse_id,
      // Null when the line names no destination bin: the goods have
      // arrived but not been shelved, which is the same unallocated state
      // a GRN's receipt sits in until its put-away runs.
      locationId: line.to_location_id,
      productId: line.product_id,
      batchId: line.batch_id,
      serialNo: null,
      qtyIn: Number(line.quantity),
      uomCode: line.uom_code!,
      sourceLineId: line.id,
    }));
    await this.stock.postWithin(tx, actor, {
      sourceType: 'stock_transfer',
      sourceId: transfer.id,
      idempotencyKey: `stock_transfer:${transfer.id}:in`,
      movements,
    });
  }
}
