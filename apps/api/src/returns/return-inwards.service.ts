import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { assertWarehouseInScope, loadWarehouseScope } from '../auth/warehouse-scope';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { NumberingService } from '../numbering/numbering.service';
import { CreateReturnInwardDto, ListReturnInwardsQuery } from './dto/returns.dtos';

interface InwardRow {
  id: string;
  number: string;
  return_request_id: string | null;
  return_request_number: string | null;
  warehouse_id: string;
  customer_id: string;
  gate_entry_id: string | null;
  vehicle_id: string | null;
  driver_id: string | null;
  grn_id: string | null;
  grn_number: string | null;
  grn_status: string | null;
  status: string;
  created_at: string;
}

const SELECT = `
  ri.id, ri.number, ri.return_request_id, rr.number as return_request_number, ri.warehouse_id, ri.customer_id, ri.gate_entry_id,
  ri.vehicle_id, ri.driver_id, ri.grn_id, g.number as grn_number, g.status as grn_status, ri.status, ri.created_at`;
const FROM = `return_inwards ri left join return_requests rr on rr.id = ri.return_request_id left join grns g on g.id = ri.grn_id`;

function toApi(row: InwardRow) {
  return {
    id: row.id,
    number: row.number,
    returnRequestId: row.return_request_id,
    returnRequestNumber: row.return_request_number,
    warehouseId: row.warehouse_id,
    customerId: row.customer_id,
    gateEntryId: row.gate_entry_id,
    vehicleId: row.vehicle_id,
    driverId: row.driver_id,
    grnId: row.grn_id,
    grnNumber: row.grn_number,
    grnStatus: row.grn_status,
    status: row.status,
    createdAt: row.created_at,
  };
}

/**
 * Blueprint §37's Return Inward: the returned goods arriving. It carries
 * no lines of its own -- the request says what is coming back, and the
 * GRN raised from it (`POST /grns` with `returnInwardId`) says what
 * actually arrived and posts it as `RETURN` rows. This record is the
 * arrival and the inspection gate in between; `grn_posted` is set by the
 * GRN's approval, not here.
 */
@Injectable()
export class ReturnInwardsService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
  ) {}

  async create(actor: AuthenticatedUser, dto: CreateReturnInwardDto, ipAddress?: string) {
    const row = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const [request] = await tx<{ id: string; status: string; warehouse_id: string; customer_id: string }[]>`
        select id, status, warehouse_id, customer_id from return_requests where id = ${dto.returnRequestId} and tenant_id = ${actor.tenantId} for update
      `;
      if (!request) throw new NotFoundException('Return request not found');
      assertWarehouseInScope(scope, request.warehouse_id);
      if (request.status !== 'approved') throw new BadRequestException(`A return inward needs an approved request; this one is '${request.status}'`);
      const [open] = await tx<{ number: string }[]>`
        select number from return_inwards where tenant_id = ${actor.tenantId} and return_request_id = ${request.id} and status <> 'cancelled'
      `;
      if (open) throw new BadRequestException(`Return inward ${open.number} already exists for this request`);
      if (dto.gateEntryId) {
        const [ge] = await tx<{ direction: string }[]>`select direction from gate_entries where id = ${dto.gateEntryId} and tenant_id = ${actor.tenantId}`;
        if (!ge) throw new NotFoundException('Gate entry not found');
        if (ge.direction !== 'in') throw new BadRequestException('A return inward links to an inward gate entry');
      }
      if (dto.vehicleId) {
        const [v] = await tx`select 1 from vehicles where id = ${dto.vehicleId} and tenant_id = ${actor.tenantId}`;
        if (!v) throw new NotFoundException('Vehicle not found');
      }
      if (dto.driverId) {
        const [d] = await tx`select 1 from drivers where id = ${dto.driverId} and tenant_id = ${actor.tenantId}`;
        if (!d) throw new NotFoundException('Driver not found');
      }
      const number = await this.numbering.allocateNumberIn(tx, actor.tenantId, 'RETURN_INWARD', request.warehouse_id);
      const id = randomUUID();
      await tx`
        insert into return_inwards (id, tenant_id, number, return_request_id, warehouse_id, customer_id, gate_entry_id, vehicle_id, driver_id, created_by)
        values (${id}, ${actor.tenantId}, ${number}, ${request.id}, ${request.warehouse_id}, ${request.customer_id}, ${dto.gateEntryId ?? null},
                ${dto.vehicleId ?? null}, ${dto.driverId ?? null}, ${actor.userId})
      `;
      return (await this.fetch(tx, actor.tenantId, id))!;
    });
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, userRoleCode: actor.roleCode, action: 'create',
      entityType: 'return_inward', entityId: row.id, newValue: row, ipAddress,
    });
    return toApi(row);
  }

  private async fetch(tx: postgres.TransactionSql, tenantId: string, id: string) {
    const [row] = await tx<InwardRow[]>`select ${tx.unsafe(SELECT)} from ${tx.unsafe(FROM)} where ri.id = ${id} and ri.tenant_id = ${tenantId}`;
    return row ?? null;
  }

  async list(actor: AuthenticatedUser, query: ListReturnInwardsQuery) {
    const pattern = query.q ? `%${query.q}%` : null;
    const requestFilter = query.returnRequestId ?? null;
    const customerFilter = query.customerId ?? null;
    const warehouseFilter = query.warehouseId ?? null;
    const statusFilter = query.status ?? null;
    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const where = tx`
        where ri.tenant_id = ${actor.tenantId}
          and (${scope}::uuid[] is null or ri.warehouse_id = any(${scope}))
          and (${pattern}::text is null or ri.number ilike ${pattern} or rr.number ilike ${pattern} or g.number ilike ${pattern})
          and (${requestFilter}::uuid is null or ri.return_request_id = ${requestFilter})
          and (${customerFilter}::uuid is null or ri.customer_id = ${customerFilter})
          and (${warehouseFilter}::uuid is null or ri.warehouse_id = ${warehouseFilter})
          and (${statusFilter}::text is null or ri.status = ${statusFilter})`;
      const rows = await tx<InwardRow[]>`
        select ${tx.unsafe(SELECT)} from ${tx.unsafe(FROM)} ${where} order by ri.created_at desc limit ${query.limit} offset ${query.offset}
      `;
      const [{ count }] = await tx<{ count: string }[]>`select count(*)::text as count from ${tx.unsafe(FROM)} ${where}`;
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
    if (!row) throw new NotFoundException('Return inward not found');
    return toApi(row);
  }

  private async transition(actor: AuthenticatedUser, id: string, ipAddress: string | undefined, allowedFrom: string[], to: string) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const [before] = await tx<InwardRow[]>`
        select ${tx.unsafe(SELECT)} from ${tx.unsafe(FROM)}
        where ri.id = ${id} and ri.tenant_id = ${actor.tenantId} and (${scope}::uuid[] is null or ri.warehouse_id = any(${scope}))
        for update of ri
      `;
      if (!before) return null;
      if (!allowedFrom.includes(before.status)) {
        throw new BadRequestException(`Cannot transition a return inward from '${before.status}' (expected one of: ${allowedFrom.join(', ')})`);
      }
      if (to === 'cancelled' && before.grn_id && before.grn_status && !['rejected', 'cancelled', 'reversed'].includes(before.grn_status)) {
        throw new BadRequestException(`GRN ${before.grn_number} is open against this return inward -- reject or cancel it first`);
      }
      await tx`update return_inwards set status = ${to} where id = ${id} and tenant_id = ${actor.tenantId}`;
      return { before, after: (await this.fetch(tx, actor.tenantId, id))! };
    });
    if (!result) throw new NotFoundException('Return inward not found');
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, userRoleCode: actor.roleCode, action: 'status_change',
      entityType: 'return_inward', entityId: id, previousValue: { status: result.before.status }, newValue: { status: to }, ipAddress,
    });
    return toApi(result.after);
  }

  /** The goods have been looked at; the GRN records what was found. */
  inspect(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['draft'], 'inspected');
  }
  cancel(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['draft', 'inspected'], 'cancelled');
  }
}
