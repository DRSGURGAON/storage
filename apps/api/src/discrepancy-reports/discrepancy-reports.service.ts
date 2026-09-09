import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { NumberingService } from '../numbering/numbering.service';
import { AcknowledgeDiscrepancyDto } from './dto/acknowledge-discrepancy.dto';
import { CreateDiscrepancyItemDto, CreateDiscrepancyReportDto } from './dto/create-discrepancy-report.dto';
import { ListDiscrepancyReportsQuery } from './dto/list-discrepancy-reports.query';
import { UpdateDiscrepancyReportDto } from './dto/update-discrepancy-report.dto';

interface DiscrepancyReportRow {
  id: string;
  number: string;
  report_date: string;
  grn_id: string | null;
  customer_id: string;
  supplier_id: string | null;
  supplier_name: string | null;
  warehouse_id: string;
  reason: string | null;
  driver_ack_name: string | null;
  driver_ack_at: string | null;
  warehouse_ack_by: string | null;
  warehouse_ack_at: string | null;
  remarks: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface DiscrepancyItemRow {
  id: string;
  grn_item_id: string | null;
  product_id: string;
  product_snapshot: Record<string, unknown>;
  batch_no: string | null;
  expected_qty: string;
  received_qty: string;
  short_qty: string;
  excess_qty: string;
  damaged_qty: string;
  reason: string | null;
  remarks: string | null;
}

const SELECT_COLUMNS = `
  id, number, report_date, grn_id, customer_id, supplier_id, supplier_name, warehouse_id, reason,
  driver_ack_name, driver_ack_at, warehouse_ack_by, warehouse_ack_at, remarks, status, created_at, updated_at`;

const ITEM_SELECT_COLUMNS = `
  id, grn_item_id, product_id, product_snapshot, batch_no, expected_qty, received_qty, short_qty,
  excess_qty, damaged_qty, reason, remarks`;

function toApi(row: DiscrepancyReportRow, items?: DiscrepancyItemRow[]) {
  return {
    id: row.id,
    number: row.number,
    reportDate: row.report_date,
    grnId: row.grn_id,
    customerId: row.customer_id,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    warehouseId: row.warehouse_id,
    reason: row.reason,
    driverAckName: row.driver_ack_name,
    driverAckAt: row.driver_ack_at,
    warehouseAckBy: row.warehouse_ack_by,
    warehouseAckAt: row.warehouse_ack_at,
    remarks: row.remarks,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(items && {
      items: items.map((i) => ({
        id: i.id,
        grnItemId: i.grn_item_id,
        productId: i.product_id,
        productSnapshot: i.product_snapshot,
        batchNo: i.batch_no,
        expectedQty: Number(i.expected_qty),
        receivedQty: Number(i.received_qty),
        shortQty: Number(i.short_qty),
        excessQty: Number(i.excess_qty),
        damagedQty: Number(i.damaged_qty),
        reason: i.reason,
        remarks: i.remarks,
      })),
    }),
  };
}

/**
 * Blueprint §19: raised when "expected quantity != received quantity, or
 * damage exists". Creating one off a `grnId` copies exactly the GRN's
 * *discrepant* lines -- a GRN whose lines all tally has nothing to
 * report, and is refused rather than producing an empty report.
 *
 * Photos (`attachments` with `owner_type = 'discrepancy_report'`,
 * `category = 'photo'`, per the schema's own note) are not wired: no
 * user-facing upload endpoint exists anywhere in this codebase yet --
 * `AttachmentsService` currently only stores engine-generated PDFs. The
 * same gap applies to `driver_ack_signature_attachment_id`.
 */
@Injectable()
export class DiscrepancyReportsService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
  ) {}

  private async insertItems(
    tx: postgres.TransactionSql,
    tenantId: string,
    reportId: string,
    customerId: string,
    itemDtos: CreateDiscrepancyItemDto[],
  ) {
    for (const dto of itemDtos) {
      const [product] = await tx<
        { sku: string; name: string; hsn_code: string | null; uom_code: string }[]
      >`
        select sku, name, hsn_code, uom_code from products
        where id = ${dto.productId} and tenant_id = ${tenantId} and (customer_id is null or customer_id = ${customerId})
      `;
      if (!product) throw new NotFoundException('Product not found');
      const snapshot = { sku: product.sku, name: product.name, hsn: product.hsn_code, uom: product.uom_code };

      await tx`
        insert into discrepancy_items (
          id, tenant_id, report_id, grn_item_id, product_id, product_snapshot, batch_no,
          expected_qty, received_qty, short_qty, excess_qty, damaged_qty, reason, remarks
        ) values (
          ${randomUUID()}, ${tenantId}, ${reportId}, ${dto.grnItemId ?? null}, ${dto.productId},
          ${JSON.stringify(snapshot)}::jsonb, ${dto.batchNo ?? null}, ${dto.expectedQty ?? 0},
          ${dto.receivedQty ?? 0}, ${dto.shortQty ?? 0}, ${dto.excessQty ?? 0}, ${dto.damagedQty ?? 0},
          ${dto.reason ?? null}, ${dto.remarks ?? null}
        )
      `;
    }
  }

  private async fetchWithItems(tx: postgres.TransactionSql, tenantId: string, id: string) {
    const [row] = await tx<DiscrepancyReportRow[]>`
      select ${tx.unsafe(SELECT_COLUMNS)} from discrepancy_reports where id = ${id} and tenant_id = ${tenantId}
    `;
    if (!row) return null;
    const items = await tx<DiscrepancyItemRow[]>`
      select ${tx.unsafe(ITEM_SELECT_COLUMNS)} from discrepancy_items
      where tenant_id = ${tenantId} and report_id = ${id}
      order by id
    `;
    return { row, items };
  }

  async create(actor: AuthenticatedUser, dto: CreateDiscrepancyReportDto, ipAddress?: string) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      let warehouseId = dto.warehouseId;
      let customerId = dto.customerId;
      let supplierId = dto.supplierId ?? null;
      let supplierName = dto.supplierName ?? null;
      let items = dto.items;

      if (dto.grnId) {
        const [grn] = await tx<
          {
            warehouse_id: string;
            customer_id: string;
            supplier_id: string | null;
            supplier_name: string | null;
            has_discrepancy: boolean;
          }[]
        >`
          select warehouse_id, customer_id, supplier_id, supplier_name, has_discrepancy
          from grns where id = ${dto.grnId} and tenant_id = ${actor.tenantId}
        `;
        if (!grn) throw new NotFoundException('GRN not found');
        warehouseId = warehouseId ?? grn.warehouse_id;
        customerId = customerId ?? grn.customer_id;
        supplierId = supplierId ?? grn.supplier_id;
        supplierName = supplierName ?? grn.supplier_name;

        if (!items) {
          if (!grn.has_discrepancy) {
            throw new BadRequestException(
              'This GRN has no short, excess, or damaged quantities -- there is nothing to report',
            );
          }
          const grnItems = await tx<
            {
              id: string;
              product_id: string;
              batch_no: string | null;
              expected_qty: string;
              received_qty: string;
              short_qty: string;
              excess_qty: string;
              damaged_qty: string;
              remarks: string | null;
            }[]
          >`
            select id, product_id, batch_no, expected_qty, received_qty, short_qty, excess_qty,
                   damaged_qty, remarks
            from grn_items
            where tenant_id = ${actor.tenantId} and grn_id = ${dto.grnId}
              and (short_qty > 0 or excess_qty > 0 or damaged_qty > 0)
            order by line_no
          `;
          items = grnItems.map((i) => ({
            productId: i.product_id,
            grnItemId: i.id,
            batchNo: i.batch_no ?? undefined,
            expectedQty: Number(i.expected_qty),
            receivedQty: Number(i.received_qty),
            shortQty: Number(i.short_qty),
            excessQty: Number(i.excess_qty),
            damagedQty: Number(i.damaged_qty),
            remarks: i.remarks ?? undefined,
          }));
        }
      }

      if (!warehouseId || !customerId) {
        throw new BadRequestException('warehouseId and customerId are required (directly, or via a grnId)');
      }
      if (!items?.length) {
        throw new BadRequestException('items are required (directly, or via a grnId with discrepant lines)');
      }
      const [warehouse] = await tx`select 1 from warehouses where id = ${warehouseId} and tenant_id = ${actor.tenantId}`;
      if (!warehouse) throw new NotFoundException('Warehouse not found');
      const [customer] = await tx`select 1 from customers where id = ${customerId} and tenant_id = ${actor.tenantId}`;
      if (!customer) throw new NotFoundException('Customer not found');
      if (dto.supplierId) {
        const [supplier] = await tx`select 1 from suppliers where id = ${dto.supplierId} and tenant_id = ${actor.tenantId}`;
        if (!supplier) throw new NotFoundException('Supplier not found');
      }

      const number = await this.numbering.allocateNumberIn(tx, actor.tenantId, 'DISCREPANCY_REPORT');
      const id = randomUUID();
      await tx`
        insert into discrepancy_reports (
          id, tenant_id, number, report_date, grn_id, customer_id, supplier_id, supplier_name,
          warehouse_id, reason, remarks, created_by, updated_by
        ) values (
          ${id}, ${actor.tenantId}, ${number}, ${dto.reportDate ?? new Date().toISOString().slice(0, 10)},
          ${dto.grnId ?? null}, ${customerId}, ${supplierId}, ${supplierName}, ${warehouseId},
          ${dto.reason ?? null}, ${dto.remarks ?? null}, ${actor.userId}, ${actor.userId}
        )
      `;
      await this.insertItems(tx, actor.tenantId, id, customerId, items);

      const fetched = await this.fetchWithItems(tx, actor.tenantId, id);
      return fetched!;
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'create',
      entityType: 'discrepancy_report',
      entityId: result.row.id,
      newValue: result.row,
      ipAddress,
    });
    return toApi(result.row, result.items);
  }

  async list(actor: AuthenticatedUser, query: ListDiscrepancyReportsQuery) {
    const pattern = query.q ? `%${query.q}%` : null;
    const grnFilter = query.grnId ?? null;
    const customerFilter = query.customerId ?? null;
    const statusFilter = query.status ?? null;

    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const rows = await tx<DiscrepancyReportRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)}
        from discrepancy_reports
        where tenant_id = ${actor.tenantId}
          and (${pattern}::text is null or number ilike ${pattern} or supplier_name ilike ${pattern})
          and (${grnFilter}::uuid is null or grn_id = ${grnFilter})
          and (${customerFilter}::uuid is null or customer_id = ${customerFilter})
          and (${statusFilter}::text is null or status = ${statusFilter})
        order by report_date desc, created_at desc
        limit ${query.limit} offset ${query.offset}
      `;
      const [{ count }] = await tx<{ count: string }[]>`
        select count(*)::text as count from discrepancy_reports
        where tenant_id = ${actor.tenantId}
          and (${pattern}::text is null or number ilike ${pattern} or supplier_name ilike ${pattern})
          and (${grnFilter}::uuid is null or grn_id = ${grnFilter})
          and (${customerFilter}::uuid is null or customer_id = ${customerFilter})
          and (${statusFilter}::text is null or status = ${statusFilter})
      `;
      return { items: rows.map((r) => toApi(r)), total: Number(count), limit: query.limit, offset: query.offset };
    });
  }

  async get(actor: AuthenticatedUser, id: string) {
    const fetched = await withTenant(this.sql, actor.tenantId, (tx) => this.fetchWithItems(tx, actor.tenantId, id));
    if (!fetched) throw new NotFoundException('Discrepancy report not found');
    return toApi(fetched.row, fetched.items);
  }

  async update(actor: AuthenticatedUser, id: string, dto: UpdateDiscrepancyReportDto, ipAddress?: string) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const [before] = await tx<DiscrepancyReportRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from discrepancy_reports
        where id = ${id} and tenant_id = ${actor.tenantId} for update
      `;
      if (!before) return null;
      if (before.status !== 'draft') {
        throw new BadRequestException(`Cannot edit a discrepancy report in '${before.status}' status`);
      }
      if (dto.supplierId) {
        const [supplier] = await tx`select 1 from suppliers where id = ${dto.supplierId} and tenant_id = ${actor.tenantId}`;
        if (!supplier) throw new NotFoundException('Supplier not found');
      }

      await tx`
        update discrepancy_reports
        set report_date = ${dto.reportDate ?? before.report_date},
            supplier_id = ${dto.supplierId !== undefined ? dto.supplierId : before.supplier_id},
            supplier_name = ${dto.supplierName !== undefined ? dto.supplierName : before.supplier_name},
            reason = ${dto.reason !== undefined ? dto.reason : before.reason},
            remarks = ${dto.remarks !== undefined ? dto.remarks : before.remarks},
            updated_by = ${actor.userId},
            updated_at = now()
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;
      if (dto.items) {
        await tx`delete from discrepancy_items where tenant_id = ${actor.tenantId} and report_id = ${id}`;
        await this.insertItems(tx, actor.tenantId, id, before.customer_id, dto.items);
      }

      const after = await this.fetchWithItems(tx, actor.tenantId, id);
      return { before, after: after! };
    });
    if (!result) throw new NotFoundException('Discrepancy report not found');

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'update',
      entityType: 'discrepancy_report',
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
    apply: (tx: postgres.TransactionSql) => Promise<void>,
  ) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const [before] = await tx<DiscrepancyReportRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from discrepancy_reports
        where id = ${id} and tenant_id = ${actor.tenantId} for update
      `;
      if (!before) return null;
      if (!allowedFrom.includes(before.status)) {
        throw new BadRequestException(
          `Cannot transition a discrepancy report from '${before.status}' (expected one of: ${allowedFrom.join(', ')})`,
        );
      }
      await apply(tx);
      const after = await this.fetchWithItems(tx, actor.tenantId, id);
      return { before, after: after! };
    });
    if (!result) throw new NotFoundException('Discrepancy report not found');

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'status_change',
      entityType: 'discrepancy_report',
      entityId: id,
      previousValue: { status: result.before.status },
      newValue: { status: result.after.row.status },
      ipAddress,
    });
    return toApi(result.after.row, result.after.items);
  }

  submit(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['draft'], async (tx) => {
      await tx`update discrepancy_reports set status = 'submitted' where id = ${id} and tenant_id = ${actor.tenantId}`;
    });
  }

  /** §19's driver + warehouse acknowledgements: the warehouse side is the acting user, the driver side a typed name. */
  acknowledge(actor: AuthenticatedUser, id: string, dto: AcknowledgeDiscrepancyDto, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['submitted'], async (tx) => {
      await tx`
        update discrepancy_reports
        set status = 'acknowledged',
            warehouse_ack_by = ${actor.userId},
            warehouse_ack_at = now(),
            driver_ack_name = ${dto.driverAckName ?? null},
            driver_ack_at = ${dto.driverAckName ? new Date().toISOString() : null}
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;
    });
  }

  close(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['acknowledged'], async (tx) => {
      await tx`update discrepancy_reports set status = 'closed' where id = ${id} and tenant_id = ${actor.tenantId}`;
    });
  }

  cancel(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['draft', 'submitted'], async (tx) => {
      await tx`update discrepancy_reports set status = 'cancelled' where id = ${id} and tenant_id = ${actor.tenantId}`;
    });
  }
}
