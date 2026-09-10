import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { assertWarehouseInScope, loadWarehouseScope } from '../auth/warehouse-scope';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { NumberingService } from '../numbering/numbering.service';
import { CreateDispatchDto, DispatchLineDto, ListDispatchesQuery, UpdateDispatchDto } from './dto/outbound.dtos';
import { OutboundPostingService, OutwardPostingResult } from './outbound-posting.service';

export interface DispatchRow {
  id: string;
  number: string;
  dispatch_date: string;
  release_order_id: string;
  pick_list_id: string | null;
  packing_list_id: string | null;
  customer_id: string;
  consignee_name: string | null;
  warehouse_id: string;
  lr_number: string | null;
  lr_date: string | null;
  vehicle_id: string | null;
  vehicle_number: string | null;
  driver_id: string | null;
  driver_name: string | null;
  transporter_id: string | null;
  transporter_name: string | null;
  eway_bill_number: string | null;
  eway_bill_date: string | null;
  total_packages: number | null;
  total_weight_kg: string | null;
  remarks: string | null;
  status: string;
  created_at: string;
}

export interface DispatchLineRow {
  id: string;
  release_order_line_id: string | null;
  product_id: string;
  batch_id: string | null;
  quantity: string;
  uom_code: string;
  sku?: string;
  product_name?: string;
  batch_no?: string | null;
}

const SELECT_COLUMNS = `
  id, number, dispatch_date, release_order_id, pick_list_id, packing_list_id, customer_id, consignee_name, warehouse_id,
  lr_number, lr_date, vehicle_id, vehicle_number, driver_id, driver_name, transporter_id, transporter_name,
  eway_bill_number, eway_bill_date, total_packages, total_weight_kg, remarks, status, created_at`;

export function dispatchToApi(row: DispatchRow, lines?: DispatchLineRow[]) {
  return {
    id: row.id,
    number: row.number,
    dispatchDate: row.dispatch_date,
    releaseOrderId: row.release_order_id,
    pickListId: row.pick_list_id,
    packingListId: row.packing_list_id,
    customerId: row.customer_id,
    consigneeName: row.consignee_name,
    warehouseId: row.warehouse_id,
    lrNumber: row.lr_number,
    lrDate: row.lr_date,
    vehicleId: row.vehicle_id,
    vehicleNumber: row.vehicle_number,
    driverId: row.driver_id,
    driverName: row.driver_name,
    transporterId: row.transporter_id,
    transporterName: row.transporter_name,
    ewayBillNumber: row.eway_bill_number,
    ewayBillDate: row.eway_bill_date,
    totalPackages: row.total_packages,
    totalWeightKg: row.total_weight_kg === null ? null : Number(row.total_weight_kg),
    remarks: row.remarks,
    status: row.status,
    createdAt: row.created_at,
    ...(lines && {
      lines: lines.map((l) => ({
        id: l.id,
        releaseOrderLineId: l.release_order_line_id,
        productId: l.product_id,
        sku: l.sku,
        productName: l.product_name,
        batchId: l.batch_id,
        batchNo: l.batch_no ?? null,
        quantity: Number(l.quantity),
        uomCode: l.uom_code,
      })),
    }),
  };
}

interface TransportSnapshot {
  vehicle_number: string | null;
  driver_name: string | null;
  transporter_id: string | null;
  transporter_name: string | null;
}

/**
 * Blueprint §33's Dispatch Note: the consignment that leaves against a
 * release order, with the transport block frozen as text (§3's auto-fill
 * is a snapshot, not a live join -- a re-registered vehicle must not
 * rewrite last month's note). A dispatch line can never exceed what has
 * been picked and not yet dispatched on its order line, counting other
 * open dispatches, which is the first of the two walls behind §79's
 * "prevent dispatch above available"; the ledger's own invariants are the
 * second. Nothing here moves stock: that is `OutboundPostingService`,
 * fired from gate-out or -- when the tenant posts at dispatch -- from
 * `confirm`.
 */
@Injectable()
export class DispatchesService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly posting: OutboundPostingService,
  ) {}

  async create(actor: AuthenticatedUser, dto: CreateDispatchDto, ipAddress?: string) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const [order] = await tx<{ id: string; status: string; warehouse_id: string; customer_id: string; consignee_name: string | null; vehicle_id: string | null; driver_id: string | null }[]>`
        select id, status, warehouse_id, customer_id, consignee_name, vehicle_id, driver_id from release_orders
        where id = ${dto.releaseOrderId} and tenant_id = ${actor.tenantId} for update
      `;
      if (!order) throw new NotFoundException('Release order not found');
      assertWarehouseInScope(scope, order.warehouse_id);
      if (!['picked', 'partially_picked'].includes(order.status)) {
        throw new BadRequestException(`Cannot dispatch a release order in '${order.status}' status -- pick it first`);
      }
      if (dto.pickListId) {
        const [pl] = await tx`select 1 from pick_lists where id = ${dto.pickListId} and tenant_id = ${actor.tenantId} and release_order_id = ${order.id}`;
        if (!pl) throw new NotFoundException('Pick list not found for this order');
      }
      if (dto.packingListId) {
        const [pk] = await tx`select 1 from packing_lists where id = ${dto.packingListId} and tenant_id = ${actor.tenantId} and release_order_id = ${order.id}`;
        if (!pk) throw new NotFoundException('Packing list not found for this order');
      }
      const vehicleId = dto.vehicleId ?? order.vehicle_id;
      const driverId = dto.driverId ?? order.driver_id;
      const transport = await this.snapshotTransport(tx, actor.tenantId, vehicleId, driverId, dto.transporterId);
      const lines = await this.resolveLines(tx, actor.tenantId, order.id, null, dto.lines);

      const number = await this.numbering.allocateNumberIn(tx, actor.tenantId, 'DISPATCH_NOTE', order.warehouse_id);
      const id = randomUUID();
      await tx`
        insert into dispatches (
          id, tenant_id, number, dispatch_date, release_order_id, pick_list_id, packing_list_id, customer_id, consignee_name,
          warehouse_id, lr_number, lr_date, vehicle_id, vehicle_number, driver_id, driver_name, transporter_id, transporter_name,
          eway_bill_number, eway_bill_date, total_packages, total_weight_kg, remarks, created_by
        ) values (
          ${id}, ${actor.tenantId}, ${number}, ${dto.dispatchDate ?? new Date().toISOString().slice(0, 10)}, ${order.id},
          ${dto.pickListId ?? null}, ${dto.packingListId ?? null}, ${order.customer_id}, ${dto.consigneeName ?? order.consignee_name},
          ${order.warehouse_id}, ${dto.lrNumber ?? null}, ${dto.lrDate ?? null}, ${vehicleId}, ${transport.vehicle_number},
          ${driverId}, ${transport.driver_name}, ${transport.transporter_id}, ${transport.transporter_name},
          ${dto.ewayBillNumber ?? null}, ${dto.ewayBillDate ?? null}, ${dto.totalPackages ?? null}, ${dto.totalWeightKg ?? null},
          ${dto.remarks ?? null}, ${actor.userId}
        )
      `;
      await this.insertLines(tx, actor.tenantId, id, lines);
      return (await this.fetchWithLines(tx, actor.tenantId, id))!;
    });
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, userRoleCode: actor.roleCode, action: 'create',
      entityType: 'dispatch', entityId: result.row.id, newValue: result.row, ipAddress,
    });
    return dispatchToApi(result.row, result.lines);
  }

  private async snapshotTransport(
    tx: postgres.TransactionSql,
    tenantId: string,
    vehicleId: string | null | undefined,
    driverId: string | null | undefined,
    transporterId: string | undefined,
  ): Promise<TransportSnapshot> {
    const out: TransportSnapshot = { vehicle_number: null, driver_name: null, transporter_id: transporterId ?? null, transporter_name: null };
    if (vehicleId) {
      const [v] = await tx<{ vehicle_number: string; transporter_id: string | null }[]>`
        select vehicle_number, transporter_id from vehicles where id = ${vehicleId} and tenant_id = ${tenantId}
      `;
      if (!v) throw new NotFoundException('Vehicle not found');
      out.vehicle_number = v.vehicle_number;
      out.transporter_id = out.transporter_id ?? v.transporter_id;
    }
    if (driverId) {
      const [d] = await tx<{ name: string }[]>`select name from drivers where id = ${driverId} and tenant_id = ${tenantId}`;
      if (!d) throw new NotFoundException('Driver not found');
      out.driver_name = d.name;
    }
    if (out.transporter_id) {
      const [t] = await tx<{ name: string }[]>`select name from transporters where id = ${out.transporter_id} and tenant_id = ${tenantId}`;
      if (!t) throw new NotFoundException('Transporter not found');
      out.transporter_name = t.name;
    }
    return out;
  }

  /**
   * Picked, less dispatched, less what other open dispatches of this order
   * already claim: that is what one more dispatch may carry. Explicit lines
   * are checked against it; omitted lines take all of it.
   */
  private async resolveLines(
    tx: postgres.TransactionSql,
    tenantId: string,
    orderId: string,
    excludeDispatchId: string | null,
    requested?: DispatchLineDto[],
  ) {
    const available = await tx<{ id: string; line_no: number; product_id: string; batch_id: string | null; uom_code: string; sku: string; free: string }[]>`
      select rol.id, rol.line_no, rol.product_id, rol.batch_id, rol.uom_code, p.sku,
             (rol.picked_qty - rol.dispatched_qty - coalesce((
               select sum(dl.quantity) from dispatch_lines dl join dispatches d on d.id = dl.dispatch_id
               where dl.tenant_id = ${tenantId} and dl.release_order_line_id = rol.id and d.status in ('draft', 'loaded')
                 and (${excludeDispatchId}::uuid is null or d.id <> ${excludeDispatchId})
             ), 0))::text as free
      from release_order_lines rol join products p on p.id = rol.product_id
      where rol.tenant_id = ${tenantId} and rol.release_order_id = ${orderId}
      order by rol.line_no
    `;
    if (!requested) {
      const lines = available.filter((l) => Number(l.free) > 0).map((l) => ({ ...l, quantity: Number(l.free) }));
      if (lines.length === 0) throw new BadRequestException('Nothing picked on this order is left to dispatch');
      return lines;
    }
    return requested.map((r) => {
      const line = available.find((l) => l.id === r.releaseOrderLineId);
      if (!line) throw new NotFoundException(`Release order line ${r.releaseOrderLineId} not found on this order`);
      if (r.quantity > Number(line.free)) {
        throw new BadRequestException(
          `Line ${line.line_no} (${line.sku}): cannot dispatch ${r.quantity} -- only ${Number(line.free)} is picked and not yet on a dispatch`,
        );
      }
      return { ...line, quantity: r.quantity };
    });
  }

  private async insertLines(
    tx: postgres.TransactionSql,
    tenantId: string,
    dispatchId: string,
    lines: { id: string; product_id: string; batch_id: string | null; uom_code: string; quantity: number }[],
  ) {
    for (const l of lines) {
      await tx`
        insert into dispatch_lines (id, tenant_id, dispatch_id, release_order_line_id, product_id, batch_id, quantity, uom_code)
        values (${randomUUID()}, ${tenantId}, ${dispatchId}, ${l.id}, ${l.product_id}, ${l.batch_id}, ${l.quantity}, ${l.uom_code})
      `;
    }
  }

  async fetchWithLines(tx: postgres.TransactionSql, tenantId: string, id: string) {
    const [row] = await tx<DispatchRow[]>`select ${tx.unsafe(SELECT_COLUMNS)} from dispatches where id = ${id} and tenant_id = ${tenantId}`;
    if (!row) return null;
    const lines = await tx<DispatchLineRow[]>`
      select dl.id, dl.release_order_line_id, dl.product_id, dl.batch_id, dl.quantity, dl.uom_code, p.sku, p.name as product_name, b.batch_no
      from dispatch_lines dl join products p on p.id = dl.product_id left join batches b on b.id = dl.batch_id
      where dl.tenant_id = ${tenantId} and dl.dispatch_id = ${id}
      order by p.sku, dl.id
    `;
    return { row, lines };
  }

  async list(actor: AuthenticatedUser, query: ListDispatchesQuery) {
    const pattern = query.q ? `%${query.q}%` : null;
    const roFilter = query.releaseOrderId ?? null;
    const customerFilter = query.customerId ?? null;
    const warehouseFilter = query.warehouseId ?? null;
    const statusFilter = query.status ?? null;
    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const where = tx`
        where tenant_id = ${actor.tenantId}
          and (${scope}::uuid[] is null or warehouse_id = any(${scope}))
          and (${pattern}::text is null or number ilike ${pattern} or consignee_name ilike ${pattern} or vehicle_number ilike ${pattern} or lr_number ilike ${pattern})
          and (${roFilter}::uuid is null or release_order_id = ${roFilter})
          and (${customerFilter}::uuid is null or customer_id = ${customerFilter})
          and (${warehouseFilter}::uuid is null or warehouse_id = ${warehouseFilter})
          and (${statusFilter}::text is null or status = ${statusFilter})`;
      const rows = await tx<DispatchRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from dispatches ${where} order by dispatch_date desc, created_at desc limit ${query.limit} offset ${query.offset}
      `;
      const [{ count }] = await tx<{ count: string }[]>`select count(*)::text as count from dispatches ${where}`;
      return { items: rows.map((r) => dispatchToApi(r)), total: Number(count), limit: query.limit, offset: query.offset };
    });
  }

  async get(actor: AuthenticatedUser, id: string) {
    const fetched = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const found = await this.fetchWithLines(tx, actor.tenantId, id);
      if (!found || (scope && !scope.includes(found.row.warehouse_id))) return null;
      return found;
    });
    if (!fetched) throw new NotFoundException('Dispatch not found');
    return dispatchToApi(fetched.row, fetched.lines);
  }

  async update(actor: AuthenticatedUser, id: string, dto: UpdateDispatchDto, ipAddress?: string) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const [before] = await tx<DispatchRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from dispatches
        where id = ${id} and tenant_id = ${actor.tenantId} and (${scope}::uuid[] is null or warehouse_id = any(${scope})) for update
      `;
      if (!before) return null;
      if (before.status !== 'draft') throw new BadRequestException(`Cannot edit a dispatch in '${before.status}' status`);
      const vehicleId = dto.vehicleId ?? before.vehicle_id;
      const driverId = dto.driverId ?? before.driver_id;
      const transport = await this.snapshotTransport(tx, actor.tenantId, vehicleId, driverId, dto.transporterId ?? before.transporter_id ?? undefined);
      await tx`
        update dispatches set
          dispatch_date = ${dto.dispatchDate ?? before.dispatch_date}, consignee_name = ${dto.consigneeName ?? before.consignee_name},
          lr_number = ${dto.lrNumber ?? before.lr_number}, lr_date = ${dto.lrDate ?? before.lr_date},
          vehicle_id = ${vehicleId}, vehicle_number = ${transport.vehicle_number}, driver_id = ${driverId}, driver_name = ${transport.driver_name},
          transporter_id = ${transport.transporter_id}, transporter_name = ${transport.transporter_name},
          eway_bill_number = ${dto.ewayBillNumber ?? before.eway_bill_number}, eway_bill_date = ${dto.ewayBillDate ?? before.eway_bill_date},
          total_packages = ${dto.totalPackages ?? before.total_packages}, total_weight_kg = ${dto.totalWeightKg ?? before.total_weight_kg},
          remarks = ${dto.remarks ?? before.remarks}
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;
      if (dto.lines) {
        // The sheet's lines are copies of these; changing them under it would leave the dock ticking a list that no longer matches.
        const [sheet] = await tx<{ number: string }[]>`
          select number from loading_sheets where tenant_id = ${actor.tenantId} and dispatch_id = ${id} and status <> 'cancelled'
        `;
        if (sheet) throw new BadRequestException(`Loading sheet ${sheet.number} is open against this dispatch -- cancel it before changing the lines`);
        const lines = await this.resolveLines(tx, actor.tenantId, before.release_order_id, id, dto.lines);
        await tx`delete from dispatch_lines where tenant_id = ${actor.tenantId} and dispatch_id = ${id}`;
        await this.insertLines(tx, actor.tenantId, id, lines);
      }
      return { before, after: (await this.fetchWithLines(tx, actor.tenantId, id))! };
    });
    if (!result) throw new NotFoundException('Dispatch not found');
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, userRoleCode: actor.roleCode, action: 'update',
      entityType: 'dispatch', entityId: id, previousValue: result.before, newValue: result.after.row, ipAddress,
    });
    return dispatchToApi(result.after.row, result.after.lines);
  }

  async transition(
    actor: AuthenticatedUser,
    id: string,
    ipAddress: string | undefined,
    allowedFrom: string[],
    apply: (tx: postgres.TransactionSql, before: DispatchRow) => Promise<void | Record<string, unknown>>,
  ) {
    let extra: Record<string, unknown> = {};
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const [before] = await tx<DispatchRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from dispatches
        where id = ${id} and tenant_id = ${actor.tenantId} and (${scope}::uuid[] is null or warehouse_id = any(${scope})) for update
      `;
      if (!before) return null;
      if (!allowedFrom.includes(before.status)) {
        throw new BadRequestException(`Cannot transition a dispatch from '${before.status}' (expected one of: ${allowedFrom.join(', ')})`);
      }
      extra = (await apply(tx, before)) ?? {};
      return { before, after: (await this.fetchWithLines(tx, actor.tenantId, id))! };
    });
    if (!result) throw new NotFoundException('Dispatch not found');
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, userRoleCode: actor.roleCode, action: 'status_change',
      entityType: 'dispatch', entityId: id, previousValue: { status: result.before.status }, newValue: { status: result.after.row.status, ...extra }, ipAddress,
    });
    return dispatchToApi(result.after.row, result.after.lines);
  }

  /**
   * "The goods have left" for a tenant that posts outward stock at
   * dispatch rather than at the gate. Refused outright when the workspace
   * posts at gate-out: there, the gate pass is the record that the truck
   * left, and this would be a second, unwitnessed way to say the same thing.
   */
  confirm(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['draft', 'loaded'], async (tx, before) => {
      const point = await this.posting.postingPoint(tx, actor.tenantId);
      if (point !== 'dispatch') {
        throw new BadRequestException(
          'This workspace posts outward stock at gate-out (workflow.outward_posting_point) -- issue a gate pass and confirm gate-out instead',
        );
      }
      const posted = await this.posting.postOutward(tx, actor, before.id);
      await tx`update dispatches set status = 'gate_out' where id = ${id} and tenant_id = ${actor.tenantId}`;
      return this.releaseOrderAudit(posted);
    });
  }

  cancel(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['draft', 'loaded'], async (tx) => {
      await tx`update loading_sheets set status = 'cancelled' where tenant_id = ${actor.tenantId} and dispatch_id = ${id} and status <> 'cancelled'`;
      await tx`update gate_passes set status = 'cancelled' where tenant_id = ${actor.tenantId} and dispatch_id = ${id} and status = 'pending'`;
      await tx`update dispatches set status = 'cancelled' where id = ${id} and tenant_id = ${actor.tenantId}`;
    });
  }

  /** Folds the release order's own status change into the dispatch's audit row, so one event reads as one event. */
  releaseOrderAudit(posted: OutwardPostingResult): Record<string, unknown> {
    return {
      stockPosted: posted.posted,
      releaseOrderId: posted.releaseOrderId,
      ...(posted.releaseOrderStatusBefore !== posted.releaseOrderStatusAfter && {
        releaseOrderStatus: { from: posted.releaseOrderStatusBefore, to: posted.releaseOrderStatusAfter },
      }),
    };
  }
}
