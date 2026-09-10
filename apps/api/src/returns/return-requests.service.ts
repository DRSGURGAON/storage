import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { assertWarehouseInScope, loadWarehouseScope } from '../auth/warehouse-scope';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { NumberingService } from '../numbering/numbering.service';
import { CreateReturnRequestDto, ListReturnRequestsQuery } from './dto/returns.dtos';

interface RequestRow {
  id: string;
  number: string;
  request_date: string;
  customer_id: string;
  warehouse_id: string;
  original_dispatch_id: string | null;
  original_dispatch_number: string | null;
  reason: string | null;
  status: string;
  created_at: string;
}

interface RequestLineRow {
  id: string;
  product_id: string;
  batch_id: string | null;
  quantity: string;
  sku?: string;
  product_name?: string;
  batch_no?: string | null;
  uom_code?: string;
}

const SELECT = `
  rr.id, rr.number, rr.request_date, rr.customer_id, rr.warehouse_id, rr.original_dispatch_id, d.number as original_dispatch_number,
  rr.reason, rr.status, rr.created_at`;

function toApi(row: RequestRow, lines?: RequestLineRow[]) {
  return {
    id: row.id,
    number: row.number,
    requestDate: row.request_date,
    customerId: row.customer_id,
    warehouseId: row.warehouse_id,
    originalDispatchId: row.original_dispatch_id,
    originalDispatchNumber: row.original_dispatch_number,
    reason: row.reason,
    status: row.status,
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
      })),
    }),
  };
}

/**
 * Blueprint §37's Return Request: the customer (or the desk, on their
 * behalf) asking to send goods back. Tied to the original dispatch when
 * there is one, in which case every line must be something that dispatch
 * actually carried, in no more than the quantity it carried -- less what
 * earlier requests against the same dispatch already claimed. Approval is
 * a receiving decision, so it rides `approve_grn`. Nothing here touches
 * stock: goods re-enter through a Return Inward and its GRN.
 */
@Injectable()
export class ReturnRequestsService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
  ) {}

  async create(actor: AuthenticatedUser, dto: CreateReturnRequestDto, ipAddress?: string) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      assertWarehouseInScope(scope, dto.warehouseId);
      const [warehouse] = await tx`select 1 from warehouses where id = ${dto.warehouseId} and tenant_id = ${actor.tenantId}`;
      if (!warehouse) throw new NotFoundException('Warehouse not found');
      const [customer] = await tx`select 1 from customers where id = ${dto.customerId} and tenant_id = ${actor.tenantId}`;
      if (!customer) throw new NotFoundException('Customer not found');

      if (dto.originalDispatchId) {
        const [dispatch] = await tx<{ status: string; customer_id: string }[]>`
          select status, customer_id from dispatches where id = ${dto.originalDispatchId} and tenant_id = ${actor.tenantId}
        `;
        if (!dispatch) throw new NotFoundException('Original dispatch not found');
        if (dispatch.customer_id !== dto.customerId) throw new BadRequestException('That dispatch belongs to a different customer');
        if (!['gate_out', 'completed'].includes(dispatch.status)) {
          throw new BadRequestException(`Goods on a dispatch in '${dispatch.status}' status have not left, so cannot be returned`);
        }
        for (const line of dto.lines) {
          const [carried] = await tx<{ dispatched: string; claimed: string }[]>`
            select coalesce(sum(dl.quantity), 0)::text as dispatched,
                   coalesce((
                     select sum(rrl.quantity) from return_request_lines rrl join return_requests rr on rr.id = rrl.return_request_id
                     where rrl.tenant_id = ${actor.tenantId} and rr.original_dispatch_id = ${dto.originalDispatchId}
                       and rrl.product_id = ${line.productId} and rrl.batch_id is not distinct from ${line.batchId ?? null}
                       and rr.status not in ('rejected', 'cancelled')
                   ), 0)::text as claimed
            from dispatch_lines dl
            where dl.tenant_id = ${actor.tenantId} and dl.dispatch_id = ${dto.originalDispatchId}
              and dl.product_id = ${line.productId} and dl.batch_id is not distinct from ${line.batchId ?? null}
          `;
          const free = Number(carried.dispatched) - Number(carried.claimed);
          if (Number(carried.dispatched) === 0) throw new BadRequestException(`Product ${line.productId} was not on that dispatch`);
          if (line.quantity > free) {
            throw new BadRequestException(`Product ${line.productId}: ${line.quantity} requested but that dispatch carried ${carried.dispatched}, of which ${free} is not already under a return request`);
          }
        }
      }
      for (const line of dto.lines) {
        const [product] = await tx`select 1 from products where id = ${line.productId} and tenant_id = ${actor.tenantId} and (customer_id is null or customer_id = ${dto.customerId})`;
        if (!product) throw new NotFoundException(`Product ${line.productId} not found`);
        if (line.batchId) {
          const [b] = await tx`select 1 from batches where id = ${line.batchId} and tenant_id = ${actor.tenantId} and product_id = ${line.productId}`;
          if (!b) throw new NotFoundException(`Batch ${line.batchId} not found for that product`);
        }
      }

      const number = await this.numbering.allocateNumberIn(tx, actor.tenantId, 'RETURN_REQUEST', dto.warehouseId);
      const id = randomUUID();
      await tx`
        insert into return_requests (id, tenant_id, number, request_date, customer_id, warehouse_id, original_dispatch_id, reason, created_by)
        values (${id}, ${actor.tenantId}, ${number}, ${dto.requestDate ?? new Date().toISOString().slice(0, 10)}, ${dto.customerId}, ${dto.warehouseId},
                ${dto.originalDispatchId ?? null}, ${dto.reason}, ${actor.userId})
      `;
      for (const line of dto.lines) {
        await tx`
          insert into return_request_lines (id, tenant_id, return_request_id, product_id, batch_id, quantity)
          values (${randomUUID()}, ${actor.tenantId}, ${id}, ${line.productId}, ${line.batchId ?? null}, ${line.quantity})
        `;
      }
      return (await this.fetchWithLines(tx, actor.tenantId, id))!;
    });
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, userRoleCode: actor.roleCode, action: 'create',
      entityType: 'return_request', entityId: result.row.id, newValue: result.row, ipAddress,
    });
    return toApi(result.row, result.lines);
  }

  async fetchWithLines(tx: postgres.TransactionSql, tenantId: string, id: string) {
    const [row] = await tx<RequestRow[]>`
      select ${tx.unsafe(SELECT)} from return_requests rr left join dispatches d on d.id = rr.original_dispatch_id
      where rr.id = ${id} and rr.tenant_id = ${tenantId}
    `;
    if (!row) return null;
    const lines = await tx<RequestLineRow[]>`
      select rrl.id, rrl.product_id, rrl.batch_id, rrl.quantity, p.sku, p.name as product_name, p.uom_code, b.batch_no
      from return_request_lines rrl join products p on p.id = rrl.product_id left join batches b on b.id = rrl.batch_id
      where rrl.tenant_id = ${tenantId} and rrl.return_request_id = ${id} order by p.sku, rrl.id
    `;
    return { row, lines };
  }

  async list(actor: AuthenticatedUser, query: ListReturnRequestsQuery) {
    const pattern = query.q ? `%${query.q}%` : null;
    const customerFilter = query.customerId ?? null;
    const warehouseFilter = query.warehouseId ?? null;
    const statusFilter = query.status ?? null;
    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const where = tx`
        where rr.tenant_id = ${actor.tenantId}
          and (${scope}::uuid[] is null or rr.warehouse_id = any(${scope}))
          and (${pattern}::text is null or rr.number ilike ${pattern} or rr.reason ilike ${pattern} or d.number ilike ${pattern})
          and (${customerFilter}::uuid is null or rr.customer_id = ${customerFilter})
          and (${warehouseFilter}::uuid is null or rr.warehouse_id = ${warehouseFilter})
          and (${statusFilter}::text is null or rr.status = ${statusFilter})`;
      const rows = await tx<RequestRow[]>`
        select ${tx.unsafe(SELECT)} from return_requests rr left join dispatches d on d.id = rr.original_dispatch_id ${where}
        order by rr.request_date desc, rr.created_at desc limit ${query.limit} offset ${query.offset}
      `;
      const [{ count }] = await tx<{ count: string }[]>`select count(*)::text as count from return_requests rr left join dispatches d on d.id = rr.original_dispatch_id ${where}`;
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
    if (!fetched) throw new NotFoundException('Return request not found');
    return toApi(fetched.row, fetched.lines);
  }

  private async transition(actor: AuthenticatedUser, id: string, ipAddress: string | undefined, allowedFrom: string[], to: string, extra: Record<string, unknown> = {}) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const [before] = await tx<RequestRow[]>`
        select ${tx.unsafe(SELECT)} from return_requests rr left join dispatches d on d.id = rr.original_dispatch_id
        where rr.id = ${id} and rr.tenant_id = ${actor.tenantId} and (${scope}::uuid[] is null or rr.warehouse_id = any(${scope}))
        for update of rr
      `;
      if (!before) return null;
      if (!allowedFrom.includes(before.status)) {
        throw new BadRequestException(`Cannot transition a return request from '${before.status}' (expected one of: ${allowedFrom.join(', ')})`);
      }
      if (to === 'cancelled') {
        const [open] = await tx<{ number: string }[]>`
          select number from return_inwards where tenant_id = ${actor.tenantId} and return_request_id = ${id} and status <> 'cancelled'
        `;
        if (open) throw new BadRequestException(`Return inward ${open.number} is open against this request -- cancel it first`);
      }
      await tx`update return_requests set status = ${to} where id = ${id} and tenant_id = ${actor.tenantId}`;
      return { before, after: (await this.fetchWithLines(tx, actor.tenantId, id))! };
    });
    if (!result) throw new NotFoundException('Return request not found');
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, userRoleCode: actor.roleCode, action: 'status_change',
      entityType: 'return_request', entityId: id, previousValue: { status: result.before.status }, newValue: { status: to, ...extra }, ipAddress,
    });
    return toApi(result.after.row, result.after.lines);
  }

  approve(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['requested'], 'approved');
  }
  reject(actor: AuthenticatedUser, id: string, reason: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['requested'], 'rejected', { reason });
  }
  cancel(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['requested', 'approved'], 'cancelled');
  }
}
