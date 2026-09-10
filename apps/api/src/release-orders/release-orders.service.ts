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
import {
  CreateReleaseOrderDto,
  CreateReleaseOrderLineDto,
  ReserveReleaseOrderDto,
  UpdateReleaseOrderDto,
} from './dto/create-release-order.dto';
import { ListReleaseOrdersQuery } from './dto/list-release-orders.query';

const ALLOCATION_POLICY = SETTINGS_BY_KEY.get('stock.allocation_policy')!;

export interface ReleaseOrderRow {
  id: string;
  number: string;
  order_date: string;
  requested_date: string | null;
  customer_id: string;
  warehouse_id: string;
  consignee_name: string | null;
  consignee_address: string | null;
  delivery_address_id: string | null;
  delivery_address_snapshot: Record<string, unknown> | null;
  transport_mode: string | null;
  vehicle_id: string | null;
  driver_id: string | null;
  instructions: string | null;
  status: string;
  approved_at: string | null;
  approved_by: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
}

interface LineRow {
  id: string;
  line_no: number;
  product_id: string;
  batch_id: string | null;
  requested_qty: string;
  reserved_qty: string;
  picked_qty: string;
  dispatched_qty: string;
  uom_code: string;
  sku?: string;
  product_name?: string;
  batch_no?: string | null;
}

const SELECT_COLUMNS = `
  id, number, order_date, requested_date, customer_id, warehouse_id, consignee_name, consignee_address,
  delivery_address_id, delivery_address_snapshot, transport_mode, vehicle_id, driver_id, instructions,
  status, approved_at, approved_by, cancelled_at, cancellation_reason, created_at`;

export function toApi(row: ReleaseOrderRow, lines?: LineRow[]) {
  return {
    id: row.id,
    number: row.number,
    orderDate: row.order_date,
    requestedDate: row.requested_date,
    customerId: row.customer_id,
    warehouseId: row.warehouse_id,
    consigneeName: row.consignee_name,
    consigneeAddress: row.consignee_address,
    deliveryAddressId: row.delivery_address_id,
    deliveryAddressSnapshot: row.delivery_address_snapshot,
    transportMode: row.transport_mode,
    vehicleId: row.vehicle_id,
    driverId: row.driver_id,
    instructions: row.instructions,
    status: row.status,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
    cancelledAt: row.cancelled_at,
    cancellationReason: row.cancellation_reason,
    createdAt: row.created_at,
    ...(lines && {
      lines: lines.map((l) => ({
        id: l.id,
        lineNo: l.line_no,
        productId: l.product_id,
        sku: l.sku,
        productName: l.product_name,
        batchId: l.batch_id,
        batchNo: l.batch_no ?? null,
        requestedQty: Number(l.requested_qty),
        reservedQty: Number(l.reserved_qty),
        pickedQty: Number(l.picked_qty),
        dispatchedQty: Number(l.dispatched_qty),
        uomCode: l.uom_code,
      })),
    }),
  };
}

/**
 * Blueprint §29-§30's Release Order: the customer's instruction to send
 * goods out, and the record that *reserves* them. Reservation is the
 * first of the outbound stock movements and the only one before gate-out
 * -- stock-engine.md §2 is explicit that picking, packing and dispatch
 * never touch physical stock; only `reserved_qty` moves until the truck
 * leaves.
 *
 * `stock_lots.reserved_qty` is a per-lot balance, so reserving *means
 * choosing lots*, and that is where the allocation policy (§31) actually
 * runs. The pick list that follows is generated from exactly the lots
 * reserved here; it records the policy used, it does not re-choose.
 *
 * Reservation is all-or-nothing per order. Reserving 15 of a requested
 * 20 and calling it reserved would be a silent under-fulfilment the
 * customer discovers at the dock; refusing with "20 requested, 15
 * available" is the honest answer, and it is what §79's "reserve
 * unavailable stock is impossible" case asks for.
 */
@Injectable()
export class ReleaseOrdersService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly stock: StockService,
  ) {}

  async create(actor: AuthenticatedUser, dto: CreateReleaseOrderDto, ipAddress?: string) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      assertWarehouseInScope(scope, dto.warehouseId);
      const [warehouse] = await tx`select 1 from warehouses where id = ${dto.warehouseId} and tenant_id = ${actor.tenantId}`;
      if (!warehouse) throw new NotFoundException('Warehouse not found');
      const [customer] = await tx`select 1 from customers where id = ${dto.customerId} and tenant_id = ${actor.tenantId}`;
      if (!customer) throw new NotFoundException('Customer not found');
      await this.assertRefs(tx, actor.tenantId, dto);
      const addressSnapshot = await this.snapshotAddress(tx, actor.tenantId, dto.customerId, dto.deliveryAddressId);

      const number = await this.numbering.allocateNumberIn(tx, actor.tenantId, 'RELEASE_ORDER', dto.warehouseId);
      const id = randomUUID();
      await tx`
        insert into release_orders (
          id, tenant_id, number, order_date, requested_date, customer_id, warehouse_id, consignee_name,
          consignee_address, delivery_address_id, delivery_address_snapshot, transport_mode, vehicle_id,
          driver_id, instructions, created_by, updated_by
        ) values (
          ${id}, ${actor.tenantId}, ${number}, ${dto.orderDate ?? new Date().toISOString().slice(0, 10)},
          ${dto.requestedDate ?? null}, ${dto.customerId}, ${dto.warehouseId}, ${dto.consigneeName ?? null},
          ${dto.consigneeAddress ?? null}, ${dto.deliveryAddressId ?? null},
          ${addressSnapshot ? JSON.stringify(addressSnapshot) : null}::jsonb, ${dto.transportMode ?? null},
          ${dto.vehicleId ?? null}, ${dto.driverId ?? null}, ${dto.instructions ?? null}, ${actor.userId}, ${actor.userId}
        )
      `;
      await this.insertLines(tx, actor.tenantId, id, dto.customerId, dto.lines);
      return (await this.fetchWithLines(tx, actor.tenantId, id))!;
    });
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, userRoleCode: actor.roleCode,
      action: 'create', entityType: 'release_order', entityId: result.row.id, newValue: result.row, ipAddress,
    });
    return toApi(result.row, result.lines);
  }

  private async assertRefs(tx: postgres.TransactionSql, tenantId: string, dto: { vehicleId?: string; driverId?: string }) {
    if (dto.vehicleId) {
      const [v] = await tx`select 1 from vehicles where id = ${dto.vehicleId} and tenant_id = ${tenantId}`;
      if (!v) throw new NotFoundException('Vehicle not found');
    }
    if (dto.driverId) {
      const [d] = await tx`select 1 from drivers where id = ${dto.driverId} and tenant_id = ${tenantId}`;
      if (!d) throw new NotFoundException('Driver not found');
    }
  }

  /** The address as it stood when the order was placed -- a later edit to the master must not re-route a dispatch. */
  private async snapshotAddress(tx: postgres.TransactionSql, tenantId: string, customerId: string, addressId?: string) {
    if (!addressId) return null;
    const [a] = await tx<Record<string, unknown>[]>`
      select label, address_line1, address_line2, city, state, state_code, pincode, gstin, contact_name, contact_phone
      from customer_addresses where id = ${addressId} and tenant_id = ${tenantId} and customer_id = ${customerId}
    `;
    if (!a) throw new NotFoundException('Delivery address not found for this customer');
    return a;
  }

  private async insertLines(
    tx: postgres.TransactionSql,
    tenantId: string,
    orderId: string,
    customerId: string,
    lines: CreateReleaseOrderLineDto[],
  ) {
    let lineNo = 1;
    for (const line of lines) {
      const [product] = await tx<{ uom_code: string }[]>`
        select uom_code from products
        where id = ${line.productId} and tenant_id = ${tenantId} and (customer_id is null or customer_id = ${customerId})
      `;
      if (!product) throw new NotFoundException(`Line ${lineNo}: product not found`);
      if (line.batchId) {
        const [b] = await tx`select 1 from batches where id = ${line.batchId} and tenant_id = ${tenantId} and product_id = ${line.productId}`;
        if (!b) throw new NotFoundException(`Line ${lineNo}: batch not found for that product`);
      }
      await tx`
        insert into release_order_lines (id, tenant_id, release_order_id, line_no, product_id, batch_id, requested_qty, uom_code)
        values (${randomUUID()}, ${tenantId}, ${orderId}, ${lineNo}, ${line.productId}, ${line.batchId ?? null},
                ${line.requestedQty}, ${product.uom_code})
      `;
      lineNo += 1;
    }
  }

  async fetchWithLines(tx: postgres.TransactionSql, tenantId: string, id: string) {
    const [row] = await tx<ReleaseOrderRow[]>`
      select ${tx.unsafe(SELECT_COLUMNS)} from release_orders where id = ${id} and tenant_id = ${tenantId}
    `;
    if (!row) return null;
    const lines = await tx<LineRow[]>`
      select rol.id, rol.line_no, rol.product_id, rol.batch_id, rol.requested_qty, rol.reserved_qty, rol.picked_qty,
             rol.dispatched_qty, rol.uom_code, p.sku, p.name as product_name, b.batch_no
      from release_order_lines rol
      join products p on p.id = rol.product_id
      left join batches b on b.id = rol.batch_id
      where rol.tenant_id = ${tenantId} and rol.release_order_id = ${id}
      order by rol.line_no
    `;
    return { row, lines };
  }

  async list(actor: AuthenticatedUser, query: ListReleaseOrdersQuery) {
    const pattern = query.q ? `%${query.q}%` : null;
    const customerFilter = query.customerId ?? null;
    const warehouseFilter = query.warehouseId ?? null;
    const statusFilter = query.status ?? null;
    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const where = tx`
        where tenant_id = ${actor.tenantId}
          and (${scope}::uuid[] is null or warehouse_id = any(${scope}))
          and (${pattern}::text is null or number ilike ${pattern} or consignee_name ilike ${pattern})
          and (${customerFilter}::uuid is null or customer_id = ${customerFilter})
          and (${warehouseFilter}::uuid is null or warehouse_id = ${warehouseFilter})
          and (${statusFilter}::text is null or status = ${statusFilter})`;
      const rows = await tx<ReleaseOrderRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from release_orders ${where}
        order by order_date desc, created_at desc limit ${query.limit} offset ${query.offset}
      `;
      const [{ count }] = await tx<{ count: string }[]>`select count(*)::text as count from release_orders ${where}`;
      return { items: rows.map((r) => toApi(r)), total: Number(count), limit: query.limit, offset: query.offset };
    });
  }

  async get(actor: AuthenticatedUser, id: string) {
    const fetched = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const found = await this.fetchWithLines(tx, actor.tenantId, id);
      if (!found || (scope && !scope.includes(found.row.warehouse_id))) return null;
      return found;
    });
    if (!fetched) throw new NotFoundException('Release order not found');
    return toApi(fetched.row, fetched.lines);
  }

  async update(actor: AuthenticatedUser, id: string, dto: UpdateReleaseOrderDto, ipAddress?: string) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const [before] = await tx<ReleaseOrderRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from release_orders
        where id = ${id} and tenant_id = ${actor.tenantId}
          and (${scope}::uuid[] is null or warehouse_id = any(${scope}))
        for update
      `;
      if (!before) return null;
      if (before.status !== 'draft') throw new BadRequestException(`Cannot edit a release order in '${before.status}' status`);
      await this.assertRefs(tx, actor.tenantId, dto);
      const addressSnapshot =
        dto.deliveryAddressId !== undefined
          ? await this.snapshotAddress(tx, actor.tenantId, before.customer_id, dto.deliveryAddressId)
          : before.delivery_address_snapshot;
      await tx`
        update release_orders set
          requested_date = ${dto.requestedDate ?? before.requested_date},
          consignee_name = ${dto.consigneeName ?? before.consignee_name},
          consignee_address = ${dto.consigneeAddress ?? before.consignee_address},
          delivery_address_id = ${dto.deliveryAddressId ?? before.delivery_address_id},
          delivery_address_snapshot = ${addressSnapshot ? JSON.stringify(addressSnapshot) : null}::jsonb,
          transport_mode = ${dto.transportMode ?? before.transport_mode},
          vehicle_id = ${dto.vehicleId ?? before.vehicle_id},
          driver_id = ${dto.driverId ?? before.driver_id},
          instructions = ${dto.instructions ?? before.instructions},
          updated_by = ${actor.userId}, updated_at = now()
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;
      if (dto.lines) {
        await tx`delete from release_order_lines where tenant_id = ${actor.tenantId} and release_order_id = ${id}`;
        await this.insertLines(tx, actor.tenantId, id, before.customer_id, dto.lines);
      }
      return { before, after: (await this.fetchWithLines(tx, actor.tenantId, id))! };
    });
    if (!result) throw new NotFoundException('Release order not found');
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, userRoleCode: actor.roleCode, action: 'update',
      entityType: 'release_order', entityId: id, previousValue: result.before, newValue: result.after.row, ipAddress,
    });
    return toApi(result.after.row, result.after.lines);
  }

  async transition(
    actor: AuthenticatedUser,
    id: string,
    ipAddress: string | undefined,
    allowedFrom: string[],
    apply: (tx: postgres.TransactionSql, before: ReleaseOrderRow, lines: LineRow[]) => Promise<void | Record<string, unknown>>,
  ) {
    let extra: Record<string, unknown> = {};
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const [before] = await tx<ReleaseOrderRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from release_orders
        where id = ${id} and tenant_id = ${actor.tenantId}
          and (${scope}::uuid[] is null or warehouse_id = any(${scope}))
        for update
      `;
      if (!before) return null;
      if (!allowedFrom.includes(before.status)) {
        throw new BadRequestException(
          `Cannot transition a release order from '${before.status}' (expected one of: ${allowedFrom.join(', ')})`,
        );
      }
      const { lines } = (await this.fetchWithLines(tx, actor.tenantId, id))!;
      extra = (await apply(tx, before, lines)) ?? {};
      return { before, after: (await this.fetchWithLines(tx, actor.tenantId, id))! };
    });
    if (!result) throw new NotFoundException('Release order not found');
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, userRoleCode: actor.roleCode, action: 'status_change',
      entityType: 'release_order', entityId: id,
      previousValue: { status: result.before.status }, newValue: { status: result.after.row.status, ...extra }, ipAddress,
    });
    return toApi(result.after.row, result.after.lines);
  }

  approve(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['draft'], async (tx) => {
      await tx`
        update release_orders set status = 'approved', approved_at = now(), approved_by = ${actor.userId}
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;
    });
  }

  /**
   * Chooses lots and posts `RESERVE` rows against them. Only *shelved*
   * stock is eligible (`location_id` not null): a pick list line needs a
   * location to send someone to, and goods still awaiting put-away are not
   * yet anywhere a picker can go. The refusal message says how much is
   * shelved versus unallocated, so "not enough" is never a mystery.
   */
  reserve(actor: AuthenticatedUser, id: string, dto: ReserveReleaseOrderDto, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['approved'], async (tx, order, lines) => {
      const policy = dto.allocationPolicy ?? (await this.tenantPolicy(tx, actor.tenantId));
      const movements: StockMovement[] = [];
      const reservedPerLine = new Map<string, number>();

      for (const line of lines) {
        const need = Number(line.requested_qty);
        const allocations =
          policy === 'manual'
            ? await this.manualAllocations(tx, actor.tenantId, order, line, dto)
            : await this.policyAllocations(tx, actor.tenantId, order, line, policy);
        const total = allocations.reduce((s, a) => s + a.quantity, 0);
        if (total < need) {
          const { shelved, unallocated } = await this.availability(tx, actor.tenantId, order, line);
          throw new BadRequestException(
            `Line ${line.line_no} (${line.sku}): ${need} requested but only ${shelved} available in shelved locations` +
              (unallocated > 0 ? ` (a further ${unallocated} is unallocated, awaiting put-away)` : ''),
          );
        }
        for (const a of allocations) {
          movements.push({
            txnType: 'RESERVE',
            customerId: order.customer_id,
            warehouseId: order.warehouse_id,
            locationId: a.locationId,
            productId: line.product_id,
            batchId: a.batchId,
            serialNo: a.serialNo,
            reservedDelta: a.quantity,
            uomCode: line.uom_code,
            sourceLineId: line.id,
          });
        }
        reservedPerLine.set(line.id, total);
      }

      await this.stock.postWithin(tx, actor, {
        sourceType: 'release_order',
        sourceId: id,
        idempotencyKey: `release_order:${id}:reserve`,
        movements,
      });
      for (const [lineId, qty] of reservedPerLine) {
        await tx`update release_order_lines set reserved_qty = ${qty} where id = ${lineId} and tenant_id = ${actor.tenantId}`;
      }
      await tx`update release_orders set status = 'reserved' where id = ${id} and tenant_id = ${actor.tenantId}`;
      // The pick list reads this back: it records the policy the reservation used, it never re-chooses.
      return { allocationPolicy: policy };
    });
  }

  private async tenantPolicy(tx: postgres.TransactionSql, tenantId: string): Promise<string> {
    const [row] = await tx<{ value: unknown }[]>`
      select value from tenant_settings where tenant_id = ${tenantId} and key = ${ALLOCATION_POLICY.key}
    `;
    return typeof row?.value === 'string' ? row.value : (ALLOCATION_POLICY.default as string);
  }

  private async availability(tx: postgres.TransactionSql, tenantId: string, order: ReleaseOrderRow, line: LineRow) {
    const [row] = await tx<{ shelved: string; unallocated: string }[]>`
      select coalesce(sum(case when location_id is not null then physical_qty - reserved_qty end), 0)::text as shelved,
             coalesce(sum(case when location_id is null then physical_qty - reserved_qty end), 0)::text as unallocated
      from stock_lots
      where tenant_id = ${tenantId} and customer_id = ${order.customer_id} and warehouse_id = ${order.warehouse_id}
        and product_id = ${line.product_id} and (${line.batch_id}::uuid is null or batch_id = ${line.batch_id})
    `;
    return { shelved: Number(row.shelved), unallocated: Number(row.unallocated) };
  }

  private async policyAllocations(tx: postgres.TransactionSql, tenantId: string, order: ReleaseOrderRow, line: LineRow, policy: string) {
    // The ordering *is* the policy (§31). Age comes from the batch where
    // there is one, and otherwise from the lot's first inward ledger row:
    // `stock_lots.updated_at` would be wrong here, since every reservation
    // and release bumps it and would silently make a churned lot "newest".
    // FEFO falls back to receipt order for lots with no expiry, so mixed
    // batches still allocate sensibly.
    const lots = await tx<{ id: string; location_id: string; batch_id: string | null; serial_no: string | null; available: string }[]>`
      select id, location_id, batch_id, serial_no, available from (
        select sl.id, sl.location_id, sl.batch_id, sl.serial_no, (sl.physical_qty - sl.reserved_qty)::text as available,
               b.expiry_date,
               coalesce(b.first_received_at, (
                 select min(l.txn_at) from stock_ledger l
                 where l.tenant_id = sl.tenant_id and l.customer_id = sl.customer_id and l.warehouse_id = sl.warehouse_id
                   and l.location_id is not distinct from sl.location_id and l.product_id = sl.product_id
                   and l.batch_id is not distinct from sl.batch_id and l.serial_no is not distinct from sl.serial_no
                   and l.qty_in > 0
               )) as received_at
        from stock_lots sl
        left join batches b on b.id = sl.batch_id
        where sl.tenant_id = ${tenantId} and sl.customer_id = ${order.customer_id} and sl.warehouse_id = ${order.warehouse_id}
          and sl.product_id = ${line.product_id} and sl.location_id is not null
          and (${line.batch_id}::uuid is null or sl.batch_id = ${line.batch_id})
          and sl.physical_qty - sl.reserved_qty > 0
      ) q
      order by
        case when ${policy} = 'fefo' then expiry_date end asc nulls last,
        case when ${policy} = 'lifo' then received_at end desc nulls last,
        received_at asc nulls last, id asc
    `;
    let remaining = Number(line.requested_qty);
    const out: { locationId: string; batchId: string | null; serialNo: string | null; quantity: number }[] = [];
    for (const lot of lots) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, Number(lot.available));
      out.push({ locationId: lot.location_id, batchId: lot.batch_id, serialNo: lot.serial_no, quantity: take });
      remaining -= take;
    }
    return out;
  }

  private async manualAllocations(tx: postgres.TransactionSql, tenantId: string, order: ReleaseOrderRow, line: LineRow, dto: ReserveReleaseOrderDto) {
    const mine = (dto.allocations ?? []).filter((a) => a.releaseOrderLineId === line.id);
    if (mine.length === 0) throw new BadRequestException(`Line ${line.line_no}: a manual reservation needs explicit lot allocations for every line`);
    const out: { locationId: string; batchId: string | null; serialNo: string | null; quantity: number }[] = [];
    for (const a of mine) {
      const [lot] = await tx<{ location_id: string | null; batch_id: string | null; serial_no: string | null; available: string }[]>`
        select location_id, batch_id, serial_no, (physical_qty - reserved_qty)::text as available from stock_lots
        where id = ${a.stockLotId} and tenant_id = ${tenantId} and customer_id = ${order.customer_id}
          and warehouse_id = ${order.warehouse_id} and product_id = ${line.product_id}
      `;
      if (!lot) throw new NotFoundException(`Line ${line.line_no}: stock lot not found for this product in this warehouse`);
      if (!lot.location_id) throw new BadRequestException(`Line ${line.line_no}: that lot is unallocated -- put it away before picking from it`);
      if (Number(lot.available) < a.quantity) {
        throw new BadRequestException(`Line ${line.line_no}: lot has only ${lot.available} available, ${a.quantity} requested`);
      }
      out.push({ locationId: lot.location_id, batchId: lot.batch_id, serialNo: lot.serial_no, quantity: a.quantity });
    }
    return out;
  }

  /**
   * Cancellation before dispatch releases every reservation this order
   * holds -- one `UNRESERVE` per `RESERVE` row, mirrored -- which is §79's
   * "cancel reservation restores available". Picked goods release too:
   * picking moved nothing physically (only gate-out does), so there is
   * nothing to put back in the ledger, only in the staging bay.
   */
  cancel(actor: AuthenticatedUser, id: string, reason: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['draft', 'approved', 'reserved', 'partially_picked', 'picked'], async (tx, order) => {
      await this.releaseReservation(tx, actor, order);
      await tx`
        update release_orders set status = 'cancelled', cancelled_at = now(), cancelled_by = ${actor.userId},
          cancellation_reason = ${reason}
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;
    });
  }

  async releaseReservation(tx: postgres.TransactionSql, actor: AuthenticatedUser, order: ReleaseOrderRow) {
    const reserved = await tx<
      { location_id: string | null; product_id: string; batch_id: string | null; serial_no: string | null; reserved_delta: string; uom_code: string; source_line_id: string | null }[]
    >`
      select location_id, product_id, batch_id, serial_no, reserved_delta, uom_code, source_line_id from stock_ledger
      where tenant_id = ${actor.tenantId} and source_type = 'release_order' and source_id = ${order.id} and txn_type = 'RESERVE'
      order by txn_at, id
    `;
    if (reserved.length === 0) return;
    await this.stock.postWithin(tx, actor, {
      sourceType: 'release_order',
      sourceId: order.id,
      idempotencyKey: `release_order:${order.id}:unreserve`,
      movements: reserved.map((r) => ({
        txnType: 'UNRESERVE' as const,
        customerId: order.customer_id,
        warehouseId: order.warehouse_id,
        locationId: r.location_id,
        productId: r.product_id,
        batchId: r.batch_id,
        serialNo: r.serial_no,
        reservedDelta: -Number(r.reserved_delta),
        uomCode: r.uom_code,
        sourceLineId: r.source_line_id,
      })),
    });
    await tx`update release_order_lines set reserved_qty = 0 where tenant_id = ${actor.tenantId} and release_order_id = ${order.id}`;
  }
}
