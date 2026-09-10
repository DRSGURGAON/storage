import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { assertWarehouseInScope, loadWarehouseScope } from '../auth/warehouse-scope';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { NumberingService } from '../numbering/numbering.service';
import { CapturePodDto, CreatePodDto, ListPodsQuery } from './dto/outbound.dtos';
import { OutboundPostingService } from './outbound-posting.service';

interface PodRow {
  id: string;
  number: string;
  dispatch_id: string;
  dispatch_number: string;
  warehouse_id: string;
  release_order_id: string;
  delivery_date: string | null;
  receiver_name: string | null;
  receiver_mobile: string | null;
  status: string;
  remarks: string | null;
  captured_by: string | null;
  captured_at: string | null;
  created_at: string;
}

interface PodLineRow {
  id: string;
  dispatch_line_id: string;
  product_id: string;
  dispatched_qty: string;
  received_qty: string;
  shortage_qty: string;
  damaged_qty: string;
  remarks: string | null;
  sku?: string;
  product_name?: string;
  batch_no?: string | null;
  uom_code?: string;
}

const SELECT = `
  pod.id, pod.number, pod.dispatch_id, d.number as dispatch_number, d.warehouse_id, d.release_order_id, pod.delivery_date,
  pod.receiver_name, pod.receiver_mobile, pod.status, pod.remarks, pod.captured_by, pod.captured_at, pod.created_at`;

function toApi(row: PodRow, lines?: PodLineRow[]) {
  return {
    id: row.id,
    number: row.number,
    dispatchId: row.dispatch_id,
    dispatchNumber: row.dispatch_number,
    warehouseId: row.warehouse_id,
    releaseOrderId: row.release_order_id,
    deliveryDate: row.delivery_date,
    receiverName: row.receiver_name,
    receiverMobile: row.receiver_mobile,
    status: row.status,
    remarks: row.remarks,
    capturedBy: row.captured_by,
    capturedAt: row.captured_at,
    createdAt: row.created_at,
    ...(lines && {
      lines: lines.map((l) => ({
        id: l.id,
        dispatchLineId: l.dispatch_line_id,
        productId: l.product_id,
        sku: l.sku,
        productName: l.product_name,
        batchNo: l.batch_no ?? null,
        uomCode: l.uom_code,
        dispatchedQty: Number(l.dispatched_qty),
        receivedQty: Number(l.received_qty),
        shortageQty: Number(l.shortage_qty),
        damagedQty: Number(l.damaged_qty),
        remarks: l.remarks,
      })),
    }),
  };
}

/**
 * Blueprint §36's Proof of Delivery. Raised once the goods have gone out
 * (the dispatch is `gate_out`), captured with what the consignee actually
 * signed for, and its status is *derived* from the lines rather than
 * chosen: `delivered` when everything arrived intact, `short` when
 * anything is missing, `damaged` when anything arrived broken, `rejected`
 * when nothing was accepted. A shortage here changes no warehouse stock --
 * the goods left the building; what happens to them is a return (§37) or
 * a claim, both separate records.
 */
@Injectable()
export class PodsService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly posting: OutboundPostingService,
  ) {}

  async create(actor: AuthenticatedUser, dto: CreatePodDto, ipAddress?: string) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const [dispatch] = await tx<{ id: string; status: string; warehouse_id: string }[]>`
        select id, status, warehouse_id from dispatches where id = ${dto.dispatchId} and tenant_id = ${actor.tenantId} for update
      `;
      if (!dispatch) throw new NotFoundException('Dispatch not found');
      assertWarehouseInScope(scope, dispatch.warehouse_id);
      if (dispatch.status !== 'gate_out') {
        throw new BadRequestException(`A POD needs a dispatch that has gone out; this one is '${dispatch.status}'`);
      }
      const [existing] = await tx<{ number: string }[]>`select number from pods where tenant_id = ${actor.tenantId} and dispatch_id = ${dispatch.id}`;
      if (existing) throw new BadRequestException(`POD ${existing.number} already exists for this dispatch`);

      const number = await this.numbering.allocateNumberIn(tx, actor.tenantId, 'POD', dispatch.warehouse_id);
      const id = randomUUID();
      await tx`insert into pods (id, tenant_id, number, dispatch_id, created_by) values (${id}, ${actor.tenantId}, ${number}, ${dispatch.id}, ${actor.userId})`;
      await tx`
        insert into pod_lines (id, tenant_id, pod_id, dispatch_line_id, product_id, dispatched_qty, received_qty)
        select gen_random_uuid(), ${actor.tenantId}, ${id}, dl.id, dl.product_id, dl.quantity, dl.quantity
        from dispatch_lines dl where dl.tenant_id = ${actor.tenantId} and dl.dispatch_id = ${dispatch.id}
      `;
      return (await this.fetchWithLines(tx, actor.tenantId, id))!;
    });
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, userRoleCode: actor.roleCode, action: 'create',
      entityType: 'pod', entityId: result.row.id, newValue: result.row, ipAddress,
    });
    return toApi(result.row, result.lines);
  }

  private async fetchWithLines(tx: postgres.TransactionSql, tenantId: string, id: string) {
    const [row] = await tx<PodRow[]>`select ${tx.unsafe(SELECT)} from pods pod join dispatches d on d.id = pod.dispatch_id where pod.id = ${id} and pod.tenant_id = ${tenantId}`;
    if (!row) return null;
    const lines = await tx<PodLineRow[]>`
      select pl.id, pl.dispatch_line_id, pl.product_id, pl.dispatched_qty, pl.received_qty, pl.shortage_qty, pl.damaged_qty, pl.remarks,
             p.sku, p.name as product_name, b.batch_no, dl.uom_code
      from pod_lines pl join dispatch_lines dl on dl.id = pl.dispatch_line_id
      join products p on p.id = pl.product_id left join batches b on b.id = dl.batch_id
      where pl.tenant_id = ${tenantId} and pl.pod_id = ${id} order by p.sku, pl.id
    `;
    return { row, lines };
  }

  async list(actor: AuthenticatedUser, query: ListPodsQuery) {
    const pattern = query.q ? `%${query.q}%` : null;
    const dispatchFilter = query.dispatchId ?? null;
    const statusFilter = query.status ?? null;
    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const where = tx`
        where pod.tenant_id = ${actor.tenantId}
          and (${scope}::uuid[] is null or d.warehouse_id = any(${scope}))
          and (${pattern}::text is null or pod.number ilike ${pattern} or d.number ilike ${pattern} or pod.receiver_name ilike ${pattern})
          and (${dispatchFilter}::uuid is null or pod.dispatch_id = ${dispatchFilter})
          and (${statusFilter}::text is null or pod.status = ${statusFilter})`;
      const rows = await tx<PodRow[]>`
        select ${tx.unsafe(SELECT)} from pods pod join dispatches d on d.id = pod.dispatch_id ${where}
        order by pod.created_at desc limit ${query.limit} offset ${query.offset}
      `;
      const [{ count }] = await tx<{ count: string }[]>`select count(*)::text as count from pods pod join dispatches d on d.id = pod.dispatch_id ${where}`;
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
    if (!fetched) throw new NotFoundException('POD not found');
    return toApi(fetched.row, fetched.lines);
  }

  async capture(actor: AuthenticatedUser, id: string, dto: CapturePodDto, ipAddress?: string) {
    let extra: Record<string, unknown> = {};
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const [before] = await tx<PodRow[]>`
        select ${tx.unsafe(SELECT)} from pods pod join dispatches d on d.id = pod.dispatch_id
        where pod.id = ${id} and pod.tenant_id = ${actor.tenantId} and (${scope}::uuid[] is null or d.warehouse_id = any(${scope}))
        for update of pod
      `;
      if (!before) return null;
      if (before.status !== 'pending') throw new BadRequestException(`This POD was already captured as '${before.status}'`);
      const { lines } = (await this.fetchWithLines(tx, actor.tenantId, id))!;
      for (const l of dto.lines ?? []) {
        const line = lines.find((x) => x.id === l.lineId);
        if (!line) throw new NotFoundException(`POD line ${l.lineId} not found on this POD`);
        const damaged = l.damagedQty ?? 0;
        if (l.receivedQty > Number(line.dispatched_qty)) {
          throw new BadRequestException(`${line.sku}: received ${l.receivedQty} cannot exceed the ${Number(line.dispatched_qty)} dispatched`);
        }
        if (damaged > l.receivedQty) throw new BadRequestException(`${line.sku}: damaged ${damaged} cannot exceed the ${l.receivedQty} received`);
        await tx`
          update pod_lines set received_qty = ${l.receivedQty}, damaged_qty = ${damaged}, remarks = ${l.remarks ?? null}
          where id = ${l.lineId} and tenant_id = ${actor.tenantId}
        `;
      }
      const [agg] = await tx<{ received: string; dispatched: string; shortage: string; damaged: string }[]>`
        select coalesce(sum(received_qty), 0)::text as received, coalesce(sum(dispatched_qty), 0)::text as dispatched,
               coalesce(sum(shortage_qty), 0)::text as shortage, coalesce(sum(damaged_qty), 0)::text as damaged
        from pod_lines where tenant_id = ${actor.tenantId} and pod_id = ${id}
      `;
      const status =
        Number(agg.received) === 0 ? 'rejected' : Number(agg.damaged) > 0 ? 'damaged' : Number(agg.shortage) > 0 ? 'short' : 'delivered';
      await tx`
        update pods set status = ${status}, delivery_date = ${dto.deliveryDate ?? new Date().toISOString().slice(0, 10)},
          receiver_name = ${dto.receiverName ?? null}, receiver_mobile = ${dto.receiverMobile ?? null}, remarks = ${dto.remarks ?? null},
          captured_by = ${actor.userId}, captured_at = now()
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;
      await tx`update dispatches set status = 'completed' where id = ${before.dispatch_id} and tenant_id = ${actor.tenantId}`;
      const order = await this.posting.completeReleaseOrderIfDelivered(tx, actor.tenantId, before.release_order_id);
      extra = {
        shortageQty: Number(agg.shortage), damagedQty: Number(agg.damaged),
        ...(order.before !== order.after && { releaseOrderStatus: { from: order.before, to: order.after } }),
      };
      return { before, after: (await this.fetchWithLines(tx, actor.tenantId, id))! };
    });
    if (!result) throw new NotFoundException('POD not found');
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, userRoleCode: actor.roleCode, action: 'status_change',
      entityType: 'pod', entityId: id, previousValue: { status: result.before.status }, newValue: { status: result.after.row.status, ...extra }, ipAddress,
    });
    return toApi(result.after.row, result.after.lines);
  }
}
