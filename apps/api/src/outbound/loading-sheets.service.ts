import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { assertWarehouseInScope, loadWarehouseScope } from '../auth/warehouse-scope';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { NumberingService } from '../numbering/numbering.service';
import { ConfirmLoadingDto, CreateLoadingSheetDto, ListLoadingSheetsQuery } from './dto/outbound.dtos';

interface SheetRow {
  id: string;
  number: string;
  dispatch_id: string;
  warehouse_id: string;
  dispatch_number: string;
  vehicle_id: string | null;
  driver_id: string | null;
  seal_number: string | null;
  loading_started_at: string | null;
  loading_completed_at: string | null;
  loaded_by: string | null;
  status: string;
  created_at: string;
}

interface SheetLineRow {
  id: string;
  dispatch_line_id: string;
  product_id: string;
  quantity: string;
  weight_kg: string | null;
  loaded: boolean;
  sku?: string;
  product_name?: string;
  batch_no?: string | null;
  uom_code?: string;
}

const SELECT = `
  ls.id, ls.number, ls.dispatch_id, d.warehouse_id, d.number as dispatch_number, ls.vehicle_id, ls.driver_id, ls.seal_number,
  ls.loading_started_at, ls.loading_completed_at, ls.loaded_by, ls.status, ls.created_at`;

function toApi(row: SheetRow, lines?: SheetLineRow[]) {
  return {
    id: row.id,
    number: row.number,
    dispatchId: row.dispatch_id,
    dispatchNumber: row.dispatch_number,
    warehouseId: row.warehouse_id,
    vehicleId: row.vehicle_id,
    driverId: row.driver_id,
    sealNumber: row.seal_number,
    loadingStartedAt: row.loading_started_at,
    loadingCompletedAt: row.loading_completed_at,
    loadedBy: row.loaded_by,
    status: row.status,
    createdAt: row.created_at,
    ...(lines && {
      lines: lines.map((l) => ({
        id: l.id,
        dispatchLineId: l.dispatch_line_id,
        productId: l.product_id,
        sku: l.sku,
        productName: l.product_name,
        batchNo: l.batch_no ?? null,
        quantity: Number(l.quantity),
        uomCode: l.uom_code,
        weightKg: l.weight_kg === null ? null : Number(l.weight_kg),
        loaded: l.loaded,
      })),
    }),
  };
}

/**
 * Blueprint §34's Loading Sheet: the dock's tick-list for one dispatch.
 * One sheet per dispatch (the schema's `unique (dispatch_id)`), its lines
 * copied from the dispatch's, and it moves nothing -- `loaded` on every
 * line is what lets the dispatch be called loaded, and a partly ticked
 * sheet cannot be completed.
 */
@Injectable()
export class LoadingSheetsService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
  ) {}

  async create(actor: AuthenticatedUser, dto: CreateLoadingSheetDto, ipAddress?: string) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const [dispatch] = await tx<{ id: string; status: string; warehouse_id: string; vehicle_id: string | null; driver_id: string | null }[]>`
        select id, status, warehouse_id, vehicle_id, driver_id from dispatches where id = ${dto.dispatchId} and tenant_id = ${actor.tenantId} for update
      `;
      if (!dispatch) throw new NotFoundException('Dispatch not found');
      assertWarehouseInScope(scope, dispatch.warehouse_id);
      if (dispatch.status !== 'draft') throw new BadRequestException(`Cannot raise a loading sheet for a dispatch in '${dispatch.status}' status`);
      const [existing] = await tx<{ number: string }[]>`
        select number from loading_sheets where tenant_id = ${actor.tenantId} and dispatch_id = ${dispatch.id} and status <> 'cancelled'
      `;
      if (existing) throw new BadRequestException(`Loading sheet ${existing.number} already exists for this dispatch`);
      // A cancelled sheet still occupies the schema's one-per-dispatch key; clear it so the dock can start over.
      await tx`delete from loading_sheets where tenant_id = ${actor.tenantId} and dispatch_id = ${dispatch.id} and status = 'cancelled'`;

      const number = await this.numbering.allocateNumberIn(tx, actor.tenantId, 'LOADING_SHEET', dispatch.warehouse_id);
      const id = randomUUID();
      await tx`
        insert into loading_sheets (id, tenant_id, number, dispatch_id, vehicle_id, driver_id, seal_number, created_by)
        values (${id}, ${actor.tenantId}, ${number}, ${dispatch.id}, ${dto.vehicleId ?? dispatch.vehicle_id}, ${dto.driverId ?? dispatch.driver_id},
                ${dto.sealNumber ?? null}, ${actor.userId})
      `;
      await tx`
        insert into loading_sheet_lines (id, tenant_id, loading_sheet_id, dispatch_line_id, product_id, quantity)
        select gen_random_uuid(), ${actor.tenantId}, ${id}, dl.id, dl.product_id, dl.quantity
        from dispatch_lines dl where dl.tenant_id = ${actor.tenantId} and dl.dispatch_id = ${dispatch.id}
      `;
      return (await this.fetchWithLines(tx, actor.tenantId, id))!;
    });
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, userRoleCode: actor.roleCode, action: 'create',
      entityType: 'loading_sheet', entityId: result.row.id, newValue: result.row, ipAddress,
    });
    return toApi(result.row, result.lines);
  }

  private async fetchWithLines(tx: postgres.TransactionSql, tenantId: string, id: string) {
    const [row] = await tx<SheetRow[]>`
      select ${tx.unsafe(SELECT)} from loading_sheets ls join dispatches d on d.id = ls.dispatch_id where ls.id = ${id} and ls.tenant_id = ${tenantId}
    `;
    if (!row) return null;
    const lines = await tx<SheetLineRow[]>`
      select lsl.id, lsl.dispatch_line_id, lsl.product_id, lsl.quantity, lsl.weight_kg, lsl.loaded, p.sku, p.name as product_name, b.batch_no, dl.uom_code
      from loading_sheet_lines lsl join dispatch_lines dl on dl.id = lsl.dispatch_line_id
      join products p on p.id = lsl.product_id left join batches b on b.id = dl.batch_id
      where lsl.tenant_id = ${tenantId} and lsl.loading_sheet_id = ${id} order by p.sku, lsl.id
    `;
    return { row, lines };
  }

  async list(actor: AuthenticatedUser, query: ListLoadingSheetsQuery) {
    const pattern = query.q ? `%${query.q}%` : null;
    const dispatchFilter = query.dispatchId ?? null;
    const statusFilter = query.status ?? null;
    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const where = tx`
        where ls.tenant_id = ${actor.tenantId}
          and (${scope}::uuid[] is null or d.warehouse_id = any(${scope}))
          and (${pattern}::text is null or ls.number ilike ${pattern} or d.number ilike ${pattern})
          and (${dispatchFilter}::uuid is null or ls.dispatch_id = ${dispatchFilter})
          and (${statusFilter}::text is null or ls.status = ${statusFilter})`;
      const rows = await tx<SheetRow[]>`
        select ${tx.unsafe(SELECT)} from loading_sheets ls join dispatches d on d.id = ls.dispatch_id ${where}
        order by ls.created_at desc limit ${query.limit} offset ${query.offset}
      `;
      const [{ count }] = await tx<{ count: string }[]>`select count(*)::text as count from loading_sheets ls join dispatches d on d.id = ls.dispatch_id ${where}`;
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
    if (!fetched) throw new NotFoundException('Loading sheet not found');
    return toApi(fetched.row, fetched.lines);
  }

  private async transition(
    actor: AuthenticatedUser,
    id: string,
    ipAddress: string | undefined,
    allowedFrom: string[],
    apply: (tx: postgres.TransactionSql, before: SheetRow, lines: SheetLineRow[]) => Promise<void>,
  ) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const [before] = await tx<SheetRow[]>`
        select ${tx.unsafe(SELECT)} from loading_sheets ls join dispatches d on d.id = ls.dispatch_id
        where ls.id = ${id} and ls.tenant_id = ${actor.tenantId} and (${scope}::uuid[] is null or d.warehouse_id = any(${scope}))
        for update of ls
      `;
      if (!before) return null;
      if (!allowedFrom.includes(before.status)) {
        throw new BadRequestException(`Cannot transition a loading sheet from '${before.status}' (expected one of: ${allowedFrom.join(', ')})`);
      }
      const { lines } = (await this.fetchWithLines(tx, actor.tenantId, id))!;
      await apply(tx, before, lines);
      return { before, after: (await this.fetchWithLines(tx, actor.tenantId, id))! };
    });
    if (!result) throw new NotFoundException('Loading sheet not found');
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, userRoleCode: actor.roleCode, action: 'status_change',
      entityType: 'loading_sheet', entityId: id, previousValue: { status: result.before.status }, newValue: { status: result.after.row.status }, ipAddress,
    });
    return toApi(result.after.row, result.after.lines);
  }

  confirm(actor: AuthenticatedUser, id: string, dto: ConfirmLoadingDto, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['pending', 'in_progress'], async (tx, before, lines) => {
      for (const l of dto.lines) {
        if (!lines.some((x) => x.id === l.lineId)) throw new NotFoundException(`Loading sheet line ${l.lineId} not found on this sheet`);
        await tx`
          update loading_sheet_lines set loaded = ${l.loaded}, weight_kg = ${l.weightKg ?? null}
          where id = ${l.lineId} and tenant_id = ${actor.tenantId}
        `;
      }
      await tx`
        update loading_sheets set status = 'in_progress', loading_started_at = coalesce(loading_started_at, now()),
          seal_number = ${dto.sealNumber ?? before.seal_number}
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;
    });
  }

  /** Every line ticked, or it is not loaded. The dispatch becomes `loaded` with it. */
  complete(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['in_progress'], async (tx, before, lines) => {
      const missing = lines.filter((l) => !l.loaded);
      if (missing.length > 0) {
        throw new BadRequestException(`${missing.length} line(s) not yet loaded: ${missing.map((l) => l.sku).join(', ')}`);
      }
      await tx`
        update loading_sheets set status = 'loaded', loading_completed_at = now(), loaded_by = ${actor.userId}
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;
      await tx`update dispatches set status = 'loaded' where id = ${before.dispatch_id} and tenant_id = ${actor.tenantId} and status = 'draft'`;
    });
  }

  cancel(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['pending', 'in_progress'], async (tx) => {
      await tx`update loading_sheets set status = 'cancelled' where id = ${id} and tenant_id = ${actor.tenantId}`;
    });
  }
}
