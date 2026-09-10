import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { assertWarehouseInScope, loadWarehouseScope } from '../auth/warehouse-scope';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { NumberingService } from '../numbering/numbering.service';
import { DispatchesService } from './dispatches.service';
import { CreateGatePassDto, ListGatePassesQuery } from './dto/outbound.dtos';
import { OutboundPostingService } from './outbound-posting.service';

interface GatePassRow {
  id: string;
  number: string;
  dispatch_id: string;
  dispatch_number: string;
  gate_entry_id: string | null;
  warehouse_id: string;
  customer_id: string;
  vehicle_id: string | null;
  driver_id: string | null;
  invoice_number: string | null;
  lr_number: string | null;
  eway_bill_number: string | null;
  seal_number: string | null;
  authorized_by: string | null;
  gate_out_at: string | null;
  stock_posted_at: string | null;
  status: string;
  created_at: string;
}

const SELECT = `
  gp.id, gp.number, gp.dispatch_id, d.number as dispatch_number, gp.gate_entry_id, gp.warehouse_id, gp.customer_id, gp.vehicle_id,
  gp.driver_id, gp.invoice_number, gp.lr_number, gp.eway_bill_number, gp.seal_number, gp.authorized_by, gp.gate_out_at,
  gp.stock_posted_at, gp.status, gp.created_at`;

function toApi(row: GatePassRow) {
  return {
    id: row.id,
    number: row.number,
    dispatchId: row.dispatch_id,
    dispatchNumber: row.dispatch_number,
    gateEntryId: row.gate_entry_id,
    warehouseId: row.warehouse_id,
    customerId: row.customer_id,
    vehicleId: row.vehicle_id,
    driverId: row.driver_id,
    invoiceNumber: row.invoice_number,
    lrNumber: row.lr_number,
    ewayBillNumber: row.eway_bill_number,
    sealNumber: row.seal_number,
    authorizedBy: row.authorized_by,
    gateOutAt: row.gate_out_at,
    stockPostedAt: row.stock_posted_at,
    status: row.status,
    createdAt: row.created_at,
  };
}

/**
 * Blueprint §35's Gate Pass: the document the security gate holds, and
 * the transition that completes the outward stock transaction. Gate-out
 * posts `OUTWARD` through `OutboundPostingService` unless the dispatch
 * already posted (a tenant posting at dispatch); `stock_posted_at` says
 * which happened. One pass per dispatch, its transport details copied
 * from the dispatch so the gate reads the same numbers the note carries.
 */
@Injectable()
export class GatePassesService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly posting: OutboundPostingService,
    private readonly dispatches: DispatchesService,
  ) {}

  async create(actor: AuthenticatedUser, dto: CreateGatePassDto, ipAddress?: string) {
    const row = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const [dispatch] = await tx<
        { id: string; status: string; warehouse_id: string; customer_id: string; vehicle_id: string | null; driver_id: string | null; lr_number: string | null; eway_bill_number: string | null }[]
      >`
        select id, status, warehouse_id, customer_id, vehicle_id, driver_id, lr_number, eway_bill_number from dispatches
        where id = ${dto.dispatchId} and tenant_id = ${actor.tenantId} for update
      `;
      if (!dispatch) throw new NotFoundException('Dispatch not found');
      assertWarehouseInScope(scope, dispatch.warehouse_id);
      if (!['draft', 'loaded', 'gate_out'].includes(dispatch.status)) {
        throw new BadRequestException(`Cannot issue a gate pass for a dispatch in '${dispatch.status}' status`);
      }
      const [existing] = await tx<{ number: string }[]>`
        select number from gate_passes where tenant_id = ${actor.tenantId} and dispatch_id = ${dispatch.id} and status <> 'cancelled'
      `;
      if (existing) throw new BadRequestException(`Gate pass ${existing.number} already exists for this dispatch`);
      await tx`delete from gate_passes where tenant_id = ${actor.tenantId} and dispatch_id = ${dispatch.id} and status = 'cancelled'`;
      if (dto.gateEntryId) {
        const [ge] = await tx<{ direction: string }[]>`select direction from gate_entries where id = ${dto.gateEntryId} and tenant_id = ${actor.tenantId}`;
        if (!ge) throw new NotFoundException('Gate entry not found');
        if (ge.direction !== 'out') throw new BadRequestException('A gate pass links to an outward gate entry');
      }
      const [sheet] = await tx<{ seal_number: string | null }[]>`
        select seal_number from loading_sheets where tenant_id = ${actor.tenantId} and dispatch_id = ${dispatch.id} and status = 'loaded'
      `;

      const number = await this.numbering.allocateNumberIn(tx, actor.tenantId, 'GATE_PASS', dispatch.warehouse_id);
      const id = randomUUID();
      await tx`
        insert into gate_passes (id, tenant_id, number, dispatch_id, gate_entry_id, warehouse_id, customer_id, vehicle_id, driver_id,
                                 invoice_number, lr_number, eway_bill_number, seal_number, created_by)
        values (${id}, ${actor.tenantId}, ${number}, ${dispatch.id}, ${dto.gateEntryId ?? null}, ${dispatch.warehouse_id}, ${dispatch.customer_id},
                ${dispatch.vehicle_id}, ${dispatch.driver_id}, ${dto.invoiceNumber ?? null}, ${dispatch.lr_number}, ${dispatch.eway_bill_number},
                ${dto.sealNumber ?? sheet?.seal_number ?? null}, ${actor.userId})
      `;
      return (await this.fetch(tx, actor.tenantId, id))!;
    });
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, userRoleCode: actor.roleCode, action: 'create',
      entityType: 'gate_pass', entityId: row.id, newValue: row, ipAddress,
    });
    return toApi(row);
  }

  private async fetch(tx: postgres.TransactionSql, tenantId: string, id: string) {
    const [row] = await tx<GatePassRow[]>`
      select ${tx.unsafe(SELECT)} from gate_passes gp join dispatches d on d.id = gp.dispatch_id where gp.id = ${id} and gp.tenant_id = ${tenantId}
    `;
    return row ?? null;
  }

  async list(actor: AuthenticatedUser, query: ListGatePassesQuery) {
    const pattern = query.q ? `%${query.q}%` : null;
    const dispatchFilter = query.dispatchId ?? null;
    const warehouseFilter = query.warehouseId ?? null;
    const statusFilter = query.status ?? null;
    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const where = tx`
        where gp.tenant_id = ${actor.tenantId}
          and (${scope}::uuid[] is null or gp.warehouse_id = any(${scope}))
          and (${pattern}::text is null or gp.number ilike ${pattern} or d.number ilike ${pattern} or d.vehicle_number ilike ${pattern})
          and (${dispatchFilter}::uuid is null or gp.dispatch_id = ${dispatchFilter})
          and (${warehouseFilter}::uuid is null or gp.warehouse_id = ${warehouseFilter})
          and (${statusFilter}::text is null or gp.status = ${statusFilter})`;
      const rows = await tx<GatePassRow[]>`
        select ${tx.unsafe(SELECT)} from gate_passes gp join dispatches d on d.id = gp.dispatch_id ${where}
        order by gp.created_at desc limit ${query.limit} offset ${query.offset}
      `;
      const [{ count }] = await tx<{ count: string }[]>`select count(*)::text as count from gate_passes gp join dispatches d on d.id = gp.dispatch_id ${where}`;
      return { items: rows.map(toApi), total: Number(count), limit: query.limit, offset: query.offset };
    });
  }

  async get(actor: AuthenticatedUser, id: string) {
    const row = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const found = await this.fetch(tx, actor.tenantId, id);
      if (!found || (scope && !scope.includes(found.warehouse_id))) return null;
      return found;
    });
    if (!row) throw new NotFoundException('Gate pass not found');
    return toApi(row);
  }

  private async transition(
    actor: AuthenticatedUser,
    id: string,
    ipAddress: string | undefined,
    allowedFrom: string[],
    apply: (tx: postgres.TransactionSql, before: GatePassRow) => Promise<void | Record<string, unknown>>,
  ) {
    let extra: Record<string, unknown> = {};
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const [before] = await tx<GatePassRow[]>`
        select ${tx.unsafe(SELECT)} from gate_passes gp join dispatches d on d.id = gp.dispatch_id
        where gp.id = ${id} and gp.tenant_id = ${actor.tenantId} and (${scope}::uuid[] is null or gp.warehouse_id = any(${scope}))
        for update of gp
      `;
      if (!before) return null;
      if (!allowedFrom.includes(before.status)) {
        throw new BadRequestException(`Cannot transition a gate pass from '${before.status}' (expected one of: ${allowedFrom.join(', ')})`);
      }
      extra = (await apply(tx, before)) ?? {};
      return { before, after: (await this.fetch(tx, actor.tenantId, id))! };
    });
    if (!result) throw new NotFoundException('Gate pass not found');
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, userRoleCode: actor.roleCode, action: 'status_change',
      entityType: 'gate_pass', entityId: id, previousValue: { status: result.before.status }, newValue: { status: result.after.status, ...extra }, ipAddress,
    });
    return toApi(result.after);
  }

  /**
   * The truck leaves. Physical stock leaves with it -- exactly once, whether
   * this is the first posting or the dispatch already posted (§79
   * "dispatch 40 → stock 60").
   */
  gateOut(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['pending'], async (tx, before) => {
      const [dispatch] = await tx<{ status: string }[]>`select status from dispatches where id = ${before.dispatch_id} and tenant_id = ${actor.tenantId}`;
      if (!['draft', 'loaded', 'gate_out'].includes(dispatch.status)) {
        throw new BadRequestException(`The dispatch is '${dispatch.status}'; gate-out is not possible`);
      }
      const posted = await this.posting.postOutward(tx, actor, before.dispatch_id);
      await tx`
        update gate_passes set status = 'gate_out', gate_out_at = now(), authorized_by = ${actor.userId},
          stock_posted_at = ${posted.posted ? tx`now()` : null}
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;
      await tx`update dispatches set status = 'gate_out' where id = ${before.dispatch_id} and tenant_id = ${actor.tenantId} and status in ('draft', 'loaded')`;
      return this.dispatches.releaseOrderAudit(posted);
    });
  }

  cancel(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['pending'], async (tx) => {
      await tx`update gate_passes set status = 'cancelled' where id = ${id} and tenant_id = ${actor.tenantId}`;
    });
  }
}
