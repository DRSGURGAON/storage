import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { NumberingService } from '../numbering/numbering.service';
import { CreateInspectionDto, CreateInspectionItemDto } from './dto/create-inspection.dto';
import { ListInspectionsQuery } from './dto/list-inspections.query';
import { UpdateInspectionDto } from './dto/update-inspection.dto';

interface InspectionRow {
  id: string;
  number: string;
  inspection_at: string;
  grn_id: string | null;
  warehouse_id: string;
  customer_id: string;
  inspector_user_id: string | null;
  inspector_name: string | null;
  overall_result: string | null;
  remarks: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface InspectionItemRow {
  id: string;
  grn_item_id: string | null;
  product_id: string;
  batch_no: string | null;
  quantity: string;
  packaging_condition: string | null;
  seal_condition: string | null;
  visible_damage: boolean;
  quality_remarks: string | null;
  result: string;
  accepted_qty: string | null;
  rejected_qty: string | null;
}

const SELECT_COLUMNS = `
  id, number, inspection_at, grn_id, warehouse_id, customer_id, inspector_user_id, inspector_name,
  overall_result, remarks, status, created_at, updated_at`;

const ITEM_SELECT_COLUMNS = `
  id, grn_item_id, product_id, batch_no, quantity, packaging_condition, seal_condition,
  visible_damage, quality_remarks, result, accepted_qty, rejected_qty`;

function toApi(row: InspectionRow, items?: InspectionItemRow[]) {
  return {
    id: row.id,
    number: row.number,
    inspectionAt: row.inspection_at,
    grnId: row.grn_id,
    warehouseId: row.warehouse_id,
    customerId: row.customer_id,
    inspectorUserId: row.inspector_user_id,
    inspectorName: row.inspector_name,
    overallResult: row.overall_result,
    remarks: row.remarks,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(items && {
      items: items.map((i) => ({
        id: i.id,
        grnItemId: i.grn_item_id,
        productId: i.product_id,
        batchNo: i.batch_no,
        quantity: Number(i.quantity),
        packagingCondition: i.packaging_condition,
        sealCondition: i.seal_condition,
        visibleDamage: i.visible_damage,
        qualityRemarks: i.quality_remarks,
        result: i.result,
        acceptedQty: i.accepted_qty === null ? null : Number(i.accepted_qty),
        rejectedQty: i.rejected_qty === null ? null : Number(i.rejected_qty),
      })),
    }),
  };
}

/**
 * Blueprint §20: "basic inspection support... do not turn this into a
 * specialized pharma/food QA system in V1" -- so this is deliberately
 * one flat record with per-line condition/result fields and nothing
 * more: no sampling plans, no AQL tables, no re-inspection cycles.
 *
 * The only Phase 4 entity with no document type of its own: `INSPECTION`
 * is absent from `db/seed-data.ts`'s metered feature list and from
 * `document-engine.md` §2's document catalogue, so an inspection is an
 * internal record, not something a customer is handed. It still gets an
 * `INS/{fy}/{seq:6}` number, since numbering keys off its own prefix
 * table rather than the entitlement catalogue.
 */
@Injectable()
export class InspectionsService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
  ) {}

  /** Derived, never client-supplied: all lines accepted -> accepted, none -> rejected, a mix -> partially_accepted. */
  private overallResultFor(items: CreateInspectionItemDto[]): string {
    const accepted = items.filter((i) => i.result === 'accepted').length;
    if (accepted === items.length) return 'accepted';
    if (accepted === 0) return 'rejected';
    return 'partially_accepted';
  }

  private async insertItems(
    tx: postgres.TransactionSql,
    tenantId: string,
    inspectionId: string,
    customerId: string,
    itemDtos: CreateInspectionItemDto[],
  ) {
    for (const dto of itemDtos) {
      const [product] = await tx`
        select 1 from products
        where id = ${dto.productId} and tenant_id = ${tenantId} and (customer_id is null or customer_id = ${customerId})
      `;
      if (!product) throw new NotFoundException('Product not found');

      await tx`
        insert into inspection_items (
          id, tenant_id, inspection_id, grn_item_id, product_id, batch_no, quantity, packaging_condition,
          seal_condition, visible_damage, quality_remarks, result, accepted_qty, rejected_qty
        ) values (
          ${randomUUID()}, ${tenantId}, ${inspectionId}, ${dto.grnItemId ?? null}, ${dto.productId},
          ${dto.batchNo ?? null}, ${dto.quantity}, ${dto.packagingCondition ?? null},
          ${dto.sealCondition ?? null}, ${dto.visibleDamage ?? false}, ${dto.qualityRemarks ?? null},
          ${dto.result}, ${dto.acceptedQty ?? null}, ${dto.rejectedQty ?? null}
        )
      `;
    }
  }

  private async fetchWithItems(tx: postgres.TransactionSql, tenantId: string, id: string) {
    const [row] = await tx<InspectionRow[]>`
      select ${tx.unsafe(SELECT_COLUMNS)} from inspections where id = ${id} and tenant_id = ${tenantId}
    `;
    if (!row) return null;
    const items = await tx<InspectionItemRow[]>`
      select ${tx.unsafe(ITEM_SELECT_COLUMNS)} from inspection_items
      where tenant_id = ${tenantId} and inspection_id = ${id}
      order by id
    `;
    return { row, items };
  }

  async create(actor: AuthenticatedUser, dto: CreateInspectionDto, ipAddress?: string) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      let warehouseId = dto.warehouseId;
      let customerId = dto.customerId;

      if (dto.grnId) {
        const [grn] = await tx<{ warehouse_id: string; customer_id: string }[]>`
          select warehouse_id, customer_id from grns where id = ${dto.grnId} and tenant_id = ${actor.tenantId}
        `;
        if (!grn) throw new NotFoundException('GRN not found');
        warehouseId = warehouseId ?? grn.warehouse_id;
        customerId = customerId ?? grn.customer_id;
      }
      if (!warehouseId || !customerId) {
        throw new BadRequestException('warehouseId and customerId are required (directly, or via a grnId)');
      }
      const [warehouse] = await tx`select 1 from warehouses where id = ${warehouseId} and tenant_id = ${actor.tenantId}`;
      if (!warehouse) throw new NotFoundException('Warehouse not found');
      const [customer] = await tx`select 1 from customers where id = ${customerId} and tenant_id = ${actor.tenantId}`;
      if (!customer) throw new NotFoundException('Customer not found');

      const [inspector] = await tx<{ full_name: string }[]>`select full_name from users where id = ${actor.userId}`;
      const number = await this.numbering.allocateNumberIn(tx, actor.tenantId, 'INSPECTION');

      const id = randomUUID();
      await tx`
        insert into inspections (
          id, tenant_id, number, inspection_at, grn_id, warehouse_id, customer_id, inspector_user_id,
          inspector_name, overall_result, remarks, created_by, updated_by
        ) values (
          ${id}, ${actor.tenantId}, ${number}, ${dto.inspectionAt ?? new Date().toISOString()},
          ${dto.grnId ?? null}, ${warehouseId}, ${customerId}, ${actor.userId},
          ${dto.inspectorName ?? inspector?.full_name ?? null}, ${this.overallResultFor(dto.items)},
          ${dto.remarks ?? null}, ${actor.userId}, ${actor.userId}
        )
      `;
      await this.insertItems(tx, actor.tenantId, id, customerId, dto.items);

      const fetched = await this.fetchWithItems(tx, actor.tenantId, id);
      return fetched!;
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'create',
      entityType: 'inspection',
      entityId: result.row.id,
      newValue: result.row,
      ipAddress,
    });
    return toApi(result.row, result.items);
  }

  async list(actor: AuthenticatedUser, query: ListInspectionsQuery) {
    const pattern = query.q ? `%${query.q}%` : null;
    const grnFilter = query.grnId ?? null;
    const customerFilter = query.customerId ?? null;
    const statusFilter = query.status ?? null;

    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const rows = await tx<InspectionRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)}
        from inspections
        where tenant_id = ${actor.tenantId}
          and (${pattern}::text is null or number ilike ${pattern} or inspector_name ilike ${pattern})
          and (${grnFilter}::uuid is null or grn_id = ${grnFilter})
          and (${customerFilter}::uuid is null or customer_id = ${customerFilter})
          and (${statusFilter}::text is null or status = ${statusFilter})
        order by inspection_at desc
        limit ${query.limit} offset ${query.offset}
      `;
      const [{ count }] = await tx<{ count: string }[]>`
        select count(*)::text as count from inspections
        where tenant_id = ${actor.tenantId}
          and (${pattern}::text is null or number ilike ${pattern} or inspector_name ilike ${pattern})
          and (${grnFilter}::uuid is null or grn_id = ${grnFilter})
          and (${customerFilter}::uuid is null or customer_id = ${customerFilter})
          and (${statusFilter}::text is null or status = ${statusFilter})
      `;
      return { items: rows.map((r) => toApi(r)), total: Number(count), limit: query.limit, offset: query.offset };
    });
  }

  async get(actor: AuthenticatedUser, id: string) {
    const fetched = await withTenant(this.sql, actor.tenantId, (tx) => this.fetchWithItems(tx, actor.tenantId, id));
    if (!fetched) throw new NotFoundException('Inspection not found');
    return toApi(fetched.row, fetched.items);
  }

  async update(actor: AuthenticatedUser, id: string, dto: UpdateInspectionDto, ipAddress?: string) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const [before] = await tx<InspectionRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from inspections where id = ${id} and tenant_id = ${actor.tenantId} for update
      `;
      if (!before) return null;
      if (before.status !== 'draft') {
        throw new BadRequestException(`Cannot edit an inspection in '${before.status}' status`);
      }

      await tx`
        update inspections
        set inspection_at = ${dto.inspectionAt ?? before.inspection_at},
            inspector_name = ${dto.inspectorName !== undefined ? dto.inspectorName : before.inspector_name},
            overall_result = ${dto.items ? this.overallResultFor(dto.items) : before.overall_result},
            remarks = ${dto.remarks !== undefined ? dto.remarks : before.remarks},
            updated_by = ${actor.userId},
            updated_at = now()
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;
      if (dto.items) {
        await tx`delete from inspection_items where tenant_id = ${actor.tenantId} and inspection_id = ${id}`;
        await this.insertItems(tx, actor.tenantId, id, before.customer_id, dto.items);
      }

      const after = await this.fetchWithItems(tx, actor.tenantId, id);
      return { before, after: after! };
    });
    if (!result) throw new NotFoundException('Inspection not found');

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'update',
      entityType: 'inspection',
      entityId: id,
      previousValue: result.before,
      newValue: result.after.row,
      ipAddress,
    });
    return toApi(result.after.row, result.after.items);
  }

  private async transition(
    actor: AuthenticatedUser,
    id: string,
    ipAddress: string | undefined,
    allowedFrom: string[],
    newStatus: string,
  ) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const [before] = await tx<InspectionRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from inspections where id = ${id} and tenant_id = ${actor.tenantId} for update
      `;
      if (!before) return null;
      if (!allowedFrom.includes(before.status)) {
        throw new BadRequestException(
          `Cannot transition an inspection from '${before.status}' (expected one of: ${allowedFrom.join(', ')})`,
        );
      }
      await tx`
        update inspections set status = ${newStatus}, updated_by = ${actor.userId}, updated_at = now()
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;
      const after = await this.fetchWithItems(tx, actor.tenantId, id);
      return { before, after: after! };
    });
    if (!result) throw new NotFoundException('Inspection not found');

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'status_change',
      entityType: 'inspection',
      entityId: id,
      previousValue: { status: result.before.status },
      newValue: { status: result.after.row.status },
      ipAddress,
    });
    return toApi(result.after.row, result.after.items);
  }

  complete(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['draft'], 'completed');
  }

  cancel(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['draft'], 'cancelled');
  }
}
