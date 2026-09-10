import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { assertWarehouseInScope, loadWarehouseScope } from '../auth/warehouse-scope';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { NumberingService } from '../numbering/numbering.service';
import { ConfirmPickDto, CreatePickListDto, ListPickListsQuery } from './dto/pick-list.dtos';

interface PickListRow {
  id: string;
  number: string;
  release_order_id: string;
  warehouse_id: string;
  customer_id: string;
  allocation_policy: string;
  picker_user_id: string | null;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

interface PickLineRow {
  id: string;
  release_order_line_id: string;
  product_id: string;
  batch_id: string | null;
  location_id: string;
  required_qty: string;
  pick_qty: string;
  picked_at: string | null;
  picked_by: string | null;
  sku?: string;
  product_name?: string;
  batch_no?: string | null;
  location_code?: string;
}

const SELECT_COLUMNS = `
  id, number, release_order_id, warehouse_id, customer_id, allocation_policy, picker_user_id, status,
  started_at, completed_at, created_at`;

function toApi(row: PickListRow, lines?: PickLineRow[]) {
  return {
    id: row.id,
    number: row.number,
    releaseOrderId: row.release_order_id,
    warehouseId: row.warehouse_id,
    customerId: row.customer_id,
    allocationPolicy: row.allocation_policy,
    pickerUserId: row.picker_user_id,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
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
        locationId: l.location_id,
        locationCode: l.location_code,
        requiredQty: Number(l.required_qty),
        pickQty: Number(l.pick_qty),
        pickedAt: l.picked_at,
        pickedBy: l.picked_by,
      })),
    }),
  };
}

/**
 * Blueprint §31's Pick List. Generated from the release order's `RESERVE`
 * ledger rows, so every line names the exact lot -- location, batch,
 * serial -- that the reservation already chose. It does not re-run the
 * allocation policy; it records which one the reservation used, and sends
 * a picker to those shelves.
 *
 * Picking moves no physical stock (stock-engine.md §2). What it changes is
 * `pick_qty` here and `picked_qty` on the release order line, and the
 * order's own status. A pick may never exceed the reservation it draws on
 * (§79 step 7), which is the invariant that makes "dispatch above
 * available" impossible two steps downstream.
 */
@Injectable()
export class PickListsService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
  ) {}

  async create(actor: AuthenticatedUser, dto: CreatePickListDto, ipAddress?: string) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const [order] = await tx<{ id: string; status: string; warehouse_id: string; customer_id: string }[]>`
        select id, status, warehouse_id, customer_id from release_orders where id = ${dto.releaseOrderId} and tenant_id = ${actor.tenantId} for update
      `;
      if (!order) throw new NotFoundException('Release order not found');
      assertWarehouseInScope(scope, order.warehouse_id);
      if (!['reserved', 'partially_picked'].includes(order.status)) {
        throw new BadRequestException(`Cannot pick a release order in '${order.status}' status -- reserve it first`);
      }
      const [open] = await tx<{ number: string }[]>`
        select number from pick_lists where tenant_id = ${actor.tenantId} and release_order_id = ${order.id} and status in ('pending', 'in_progress')
      `;
      if (open) throw new BadRequestException(`Pick list ${open.number} is still open for this order`);
      if (dto.pickerUserId) {
        const [member] = await tx`select 1 from tenant_users where tenant_id = ${actor.tenantId} and user_id = ${dto.pickerUserId} and status = 'active'`;
        if (!member) throw new NotFoundException('Picker is not an active member of this workspace');
      }

      // Outstanding = reserved on that lot for that line, minus what earlier
      // completed pick lists already took from it.
      const outstanding = await tx<
        { source_line_id: string; product_id: string; batch_id: string | null; location_id: string; reserved: string; picked: string }[]
      >`
        select r.source_line_id, r.product_id, r.batch_id, r.location_id,
               sum(r.reserved_delta)::text as reserved,
               coalesce((
                 select sum(pll.pick_qty) from pick_list_lines pll
                 join pick_lists pl on pl.id = pll.pick_list_id
                 where pll.tenant_id = ${actor.tenantId} and pl.release_order_id = ${order.id} and pl.status = 'completed'
                   and pll.release_order_line_id = r.source_line_id and pll.location_id = r.location_id
                   and pll.batch_id is not distinct from r.batch_id
               ), 0)::text as picked
        from stock_ledger r
        where r.tenant_id = ${actor.tenantId} and r.source_type = 'release_order' and r.source_id = ${order.id}
          and r.txn_type = 'RESERVE' and r.location_id is not null
        group by r.source_line_id, r.product_id, r.batch_id, r.location_id
        order by r.location_id
      `;
      const lines = outstanding.filter((o) => Number(o.reserved) - Number(o.picked) > 0);
      if (lines.length === 0) throw new BadRequestException('Everything reserved on this order has already been picked');

      const policy = await this.policyUsed(tx, actor.tenantId, order.id);
      const number = await this.numbering.allocateNumberIn(tx, actor.tenantId, 'PICK_LIST', order.warehouse_id);
      const id = randomUUID();
      await tx`
        insert into pick_lists (id, tenant_id, number, release_order_id, warehouse_id, customer_id, allocation_policy, picker_user_id, created_by)
        values (${id}, ${actor.tenantId}, ${number}, ${order.id}, ${order.warehouse_id}, ${order.customer_id}, ${policy},
                ${dto.pickerUserId ?? null}, ${actor.userId})
      `;
      for (const l of lines) {
        await tx`
          insert into pick_list_lines (id, tenant_id, pick_list_id, release_order_line_id, product_id, batch_id, location_id, required_qty)
          values (${randomUUID()}, ${actor.tenantId}, ${id}, ${l.source_line_id}, ${l.product_id}, ${l.batch_id}, ${l.location_id},
                  ${Number(l.reserved) - Number(l.picked)})
        `;
      }
      return (await this.fetchWithLines(tx, actor.tenantId, id))!;
    });
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, userRoleCode: actor.roleCode, action: 'create',
      entityType: 'pick_list', entityId: result.row.id, newValue: result.row, ipAddress,
    });
    return toApi(result.row, result.lines);
  }

  /** The reservation recorded which policy it used in its audit row; fall back to the tenant default. */
  private async policyUsed(tx: postgres.TransactionSql, tenantId: string, orderId: string): Promise<string> {
    const [row] = await tx<{ value: unknown }[]>`
      select value from tenant_settings where tenant_id = ${tenantId} and key = 'stock.allocation_policy'
    `;
    const [audit] = await tx<{ new_value: { allocationPolicy?: string } | null }[]>`
      select new_value from audit_logs where tenant_id = ${tenantId} and entity_type = 'release_order' and entity_id = ${orderId}
        and action = 'status_change' and new_value->>'status' = 'reserved' order by occurred_at desc limit 1
    `;
    return audit?.new_value?.allocationPolicy ?? (typeof row?.value === 'string' ? row.value : 'fifo');
  }

  private async fetchWithLines(tx: postgres.TransactionSql, tenantId: string, id: string) {
    const [row] = await tx<PickListRow[]>`select ${tx.unsafe(SELECT_COLUMNS)} from pick_lists where id = ${id} and tenant_id = ${tenantId}`;
    if (!row) return null;
    const lines = await tx<PickLineRow[]>`
      select pll.id, pll.release_order_line_id, pll.product_id, pll.batch_id, pll.location_id, pll.required_qty, pll.pick_qty,
             pll.picked_at, pll.picked_by, p.sku, p.name as product_name, b.batch_no, l.full_code as location_code
      from pick_list_lines pll
      join products p on p.id = pll.product_id
      join locations l on l.id = pll.location_id
      left join batches b on b.id = pll.batch_id
      where pll.tenant_id = ${tenantId} and pll.pick_list_id = ${id}
      order by l.full_code, p.sku
    `;
    return { row, lines };
  }

  async list(actor: AuthenticatedUser, query: ListPickListsQuery) {
    const pattern = query.q ? `%${query.q}%` : null;
    const roFilter = query.releaseOrderId ?? null;
    const whFilter = query.warehouseId ?? null;
    const statusFilter = query.status ?? null;
    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const where = tx`
        where tenant_id = ${actor.tenantId}
          and (${scope}::uuid[] is null or warehouse_id = any(${scope}))
          and (${pattern}::text is null or number ilike ${pattern})
          and (${roFilter}::uuid is null or release_order_id = ${roFilter})
          and (${whFilter}::uuid is null or warehouse_id = ${whFilter})
          and (${statusFilter}::text is null or status = ${statusFilter})`;
      const rows = await tx<PickListRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from pick_lists ${where} order by created_at desc limit ${query.limit} offset ${query.offset}
      `;
      const [{ count }] = await tx<{ count: string }[]>`select count(*)::text as count from pick_lists ${where}`;
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
    if (!fetched) throw new NotFoundException('Pick list not found');
    return toApi(fetched.row, fetched.lines);
  }

  private async transition(
    actor: AuthenticatedUser,
    id: string,
    ipAddress: string | undefined,
    allowedFrom: string[],
    apply: (tx: postgres.TransactionSql, before: PickListRow, lines: PickLineRow[]) => Promise<void>,
  ) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const [before] = await tx<PickListRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from pick_lists
        where id = ${id} and tenant_id = ${actor.tenantId} and (${scope}::uuid[] is null or warehouse_id = any(${scope}))
        for update
      `;
      if (!before) return null;
      if (!allowedFrom.includes(before.status)) {
        throw new BadRequestException(`Cannot transition a pick list from '${before.status}' (expected one of: ${allowedFrom.join(', ')})`);
      }
      const { lines } = (await this.fetchWithLines(tx, actor.tenantId, id))!;
      await apply(tx, before, lines);
      return { before, after: (await this.fetchWithLines(tx, actor.tenantId, id))! };
    });
    if (!result) throw new NotFoundException('Pick list not found');
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, userRoleCode: actor.roleCode, action: 'status_change',
      entityType: 'pick_list', entityId: id, previousValue: { status: result.before.status }, newValue: { status: result.after.row.status }, ipAddress,
    });
    return toApi(result.after.row, result.after.lines);
  }

  /** Records what was taken from each shelf. Never more than the line requires -- that requirement *is* the reservation. */
  confirm(actor: AuthenticatedUser, id: string, dto: ConfirmPickDto, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['pending', 'in_progress'], async (tx, before, lines) => {
      for (const pick of dto.lines) {
        const line = lines.find((l) => l.id === pick.lineId);
        if (!line) throw new NotFoundException(`Pick list line ${pick.lineId} not found on this list`);
        if (pick.pickQty > Number(line.required_qty)) {
          throw new BadRequestException(
            `Line at ${line.location_code}: cannot pick ${pick.pickQty} -- only ${Number(line.required_qty)} is reserved there for this order`,
          );
        }
        await tx`
          update pick_list_lines set pick_qty = ${pick.pickQty}, picked_at = now(), picked_by = ${actor.userId}
          where id = ${pick.lineId} and tenant_id = ${actor.tenantId}
        `;
      }
      await tx`
        update pick_lists set status = 'in_progress', started_at = coalesce(started_at, now())
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;
    });
  }

  /** Rolls the picks up to the release order, which becomes `picked` only when every line is fully picked. */
  complete(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['in_progress'], async (tx, before, lines) => {
      if (lines.every((l) => Number(l.pick_qty) === 0)) {
        throw new BadRequestException('Nothing has been picked on this list -- confirm at least one line, or cancel it');
      }
      await tx`update pick_lists set status = 'completed', completed_at = now() where id = ${id} and tenant_id = ${actor.tenantId}`;
      await tx`
        update release_order_lines rol set picked_qty = rol.picked_qty + s.picked
        from (
          select release_order_line_id, sum(pick_qty) as picked from pick_list_lines
          where tenant_id = ${actor.tenantId} and pick_list_id = ${id} group by release_order_line_id
        ) s
        where rol.id = s.release_order_line_id and rol.tenant_id = ${actor.tenantId}
      `;
      const [{ all_picked }] = await tx<{ all_picked: boolean }[]>`
        select bool_and(picked_qty >= reserved_qty) as all_picked from release_order_lines
        where tenant_id = ${actor.tenantId} and release_order_id = ${before.release_order_id}
      `;
      await tx`
        update release_orders set status = ${all_picked ? 'picked' : 'partially_picked'}, updated_at = now()
        where id = ${before.release_order_id} and tenant_id = ${actor.tenantId}
      `;
    });
  }

  cancel(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['pending', 'in_progress'], async (tx) => {
      await tx`update pick_lists set status = 'cancelled' where id = ${id} and tenant_id = ${actor.tenantId}`;
    });
  }
}
