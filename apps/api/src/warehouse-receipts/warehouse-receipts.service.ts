import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PG_CONNECTION } from '../db/db.module';
import { assertWarehouseInScope, loadWarehouseScope } from '../auth/warehouse-scope';
import { withTenant } from '../db/tenant-context';
import { NumberingService } from '../numbering/numbering.service';
import { IssueWarehouseReceiptDto } from './dto/issue-warehouse-receipt.dto';
import { ListWarehouseReceiptsQuery } from './dto/list-warehouse-receipts.query';

interface WarehouseReceiptRow {
  id: string;
  number: string;
  receipt_date: string;
  grn_id: string;
  putaway_id: string | null;
  warehouse_id: string;
  customer_id: string;
  customer_snapshot: Record<string, unknown>;
  lines: Record<string, unknown>[];
  declared_value: string | null;
  remarks: string | null;
  status: string;
  created_at: string;
}

const SELECT_COLUMNS = `
  id, number, receipt_date, grn_id, putaway_id, warehouse_id, customer_id, customer_snapshot, lines,
  declared_value, remarks, status, created_at`;

function toApi(row: WarehouseReceiptRow) {
  return {
    id: row.id,
    number: row.number,
    receiptDate: row.receipt_date,
    grnId: row.grn_id,
    putawayId: row.putaway_id,
    warehouseId: row.warehouse_id,
    customerId: row.customer_id,
    customerSnapshot: row.customer_snapshot,
    lines: row.lines,
    declaredValue: row.declared_value === null ? null : Number(row.declared_value),
    remarks: row.remarks,
    status: row.status,
    createdAt: row.created_at,
  };
}

/**
 * Blueprint §22: "Generate from approved GRN / put-away. Auto-fill all
 * available data. Clearly label it as an *operational* warehouse receipt
 * unless a separate legally compliant regulatory implementation exists.
 * Do not call it a negotiable / WDRA warehouse receipt." That labelling
 * is not cosmetic -- a negotiable warehouse receipt is a regulated
 * instrument in India -- so the document template states it in the
 * title *and* in a disclaimer on the page itself.
 *
 * `customer_snapshot` and `lines` are frozen jsonb, built server-side at
 * issue time, exactly like Quotation's own snapshot: a receipt is what
 * the customer was handed on the day, and must not change when the
 * customer master or the GRN's own rows are edited later. Where a
 * put-away exists, its confirmed locations are folded into those frozen
 * lines -- "auto-fill all available data".
 *
 * There is no draft: a receipt is issued or it does not exist. The
 * schema's `unique (grn_id)` makes one receipt per GRN, so a second
 * attempt is a 409.
 */
@Injectable()
export class WarehouseReceiptsService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
  ) {}

  async issue(actor: AuthenticatedUser, dto: IssueWarehouseReceiptDto, ipAddress?: string) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const [grn] = await tx<{ status: string; warehouse_id: string; customer_id: string; number: string }[]>`
        select status, warehouse_id, customer_id, number from grns
        where id = ${dto.grnId} and tenant_id = ${actor.tenantId}
      `;
      if (!grn) throw new NotFoundException('GRN not found');
      assertWarehouseInScope(scope, grn.warehouse_id);
      if (grn.status !== 'approved') {
        throw new BadRequestException(
          `Cannot issue a warehouse receipt for a GRN in '${grn.status}' status (expected 'approved')`,
        );
      }

      const [customer] = await tx<
        {
          name: string;
          legal_name: string | null;
          gstin: string | null;
          contact_person: string | null;
          mobile: string | null;
          email: string | null;
        }[]
      >`
        select name, legal_name, gstin, contact_person, mobile, email from customers
        where id = ${grn.customer_id} and tenant_id = ${actor.tenantId}
      `;
      if (!customer) throw new NotFoundException('Customer not found');

      // A put-away is optional -- the receipt can be issued straight off the approved GRN -- but when
      // one exists its confirmed locations belong on the receipt.
      const [putaway] = await tx<{ id: string }[]>`
        select id from putaways where grn_id = ${dto.grnId} and tenant_id = ${actor.tenantId} and status <> 'cancelled'
      `;

      const grnItems = await tx<
        {
          id: string;
          product_snapshot: Record<string, string | null>;
          batch_no: string | null;
          accepted_qty: string;
          packages: number | null;
          gross_weight_kg: string | null;
        }[]
      >`
        select id, product_snapshot, batch_no, accepted_qty, packages, gross_weight_kg
        from grn_items where tenant_id = ${actor.tenantId} and grn_id = ${dto.grnId} and accepted_qty > 0
        order by line_no
      `;
      if (!grnItems.length) {
        throw new BadRequestException('This GRN accepted no quantity -- there is nothing to receipt');
      }

      const placements = putaway
        ? await tx<{ grn_item_id: string; full_code: string; quantity: string }[]>`
            select pl.grn_item_id, l.full_code, pl.quantity
            from putaway_lines pl join locations l on l.id = pl.to_location_id
            where pl.tenant_id = ${actor.tenantId} and pl.putaway_id = ${putaway.id}
          `
        : [];

      const lines = grnItems.map((item) => ({
        sku: item.product_snapshot.sku ?? null,
        name: item.product_snapshot.name ?? null,
        uom: item.product_snapshot.uom ?? null,
        batch: item.batch_no,
        qty: Number(item.accepted_qty),
        packages: item.packages,
        weightKg: item.gross_weight_kg === null ? null : Number(item.gross_weight_kg),
        locations: placements
          .filter((p) => p.grn_item_id === item.id)
          .map((p) => ({ code: p.full_code, qty: Number(p.quantity) })),
      }));

      const customerSnapshot = {
        name: customer.name,
        legalName: customer.legal_name ?? customer.name,
        gstin: customer.gstin,
        contact: customer.contact_person,
        mobile: customer.mobile,
        email: customer.email,
      };

      const number = await this.numbering.allocateNumberIn(tx, actor.tenantId, 'WAREHOUSE_RECEIPT');
      const id = randomUUID();
      try {
        await tx`
          insert into warehouse_receipts (
            id, tenant_id, number, receipt_date, grn_id, putaway_id, warehouse_id, customer_id,
            customer_snapshot, lines, declared_value, remarks, created_by
          ) values (
            ${id}, ${actor.tenantId}, ${number}, ${dto.receiptDate ?? new Date().toISOString().slice(0, 10)},
            ${dto.grnId}, ${putaway?.id ?? null}, ${grn.warehouse_id}, ${grn.customer_id},
            ${JSON.stringify(customerSnapshot)}::jsonb, ${JSON.stringify(lines)}::jsonb,
            ${dto.declaredValue ?? null}, ${dto.remarks ?? null}, ${actor.userId}
          )
        `;
      } catch (err) {
        // warehouse_receipts.grn_id is unique -- one receipt per GRN.
        if ((err as { code?: string }).code === '23505') {
          throw new ConflictException('A warehouse receipt has already been issued for this GRN');
        }
        throw err;
      }

      const [row] = await tx<WarehouseReceiptRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from warehouse_receipts where id = ${id}
      `;
      return row;
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'create',
      entityType: 'warehouse_receipt',
      entityId: result.id,
      newValue: result,
      ipAddress,
    });
    return toApi(result);
  }

  async list(actor: AuthenticatedUser, query: ListWarehouseReceiptsQuery) {
    const pattern = query.q ? `%${query.q}%` : null;
    const grnFilter = query.grnId ?? null;
    const customerFilter = query.customerId ?? null;
    const statusFilter = query.status ?? null;

    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const rows = await tx<WarehouseReceiptRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)}
        from warehouse_receipts
        where tenant_id = ${actor.tenantId}
          and (${scope}::uuid[] is null or warehouse_id = any(${scope}))
          and (${pattern}::text is null or number ilike ${pattern})
          and (${grnFilter}::uuid is null or grn_id = ${grnFilter})
          and (${customerFilter}::uuid is null or customer_id = ${customerFilter})
          and (${statusFilter}::text is null or status = ${statusFilter})
        order by receipt_date desc, created_at desc
        limit ${query.limit} offset ${query.offset}
      `;
      const [{ count }] = await tx<{ count: string }[]>`
        select count(*)::text as count from warehouse_receipts
        where tenant_id = ${actor.tenantId}
          and (${scope}::uuid[] is null or warehouse_id = any(${scope}))
          and (${pattern}::text is null or number ilike ${pattern})
          and (${grnFilter}::uuid is null or grn_id = ${grnFilter})
          and (${customerFilter}::uuid is null or customer_id = ${customerFilter})
          and (${statusFilter}::text is null or status = ${statusFilter})
      `;
      return { items: rows.map(toApi), total: Number(count), limit: query.limit, offset: query.offset };
    });
  }

  async get(actor: AuthenticatedUser, id: string) {
    const [row] = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      return tx<WarehouseReceiptRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from warehouse_receipts where id = ${id} and tenant_id = ${actor.tenantId}
          and (${scope}::uuid[] is null or warehouse_id = any(${scope}))
      `;
    });
    if (!row) throw new NotFoundException('Warehouse receipt not found');
    return toApi(row);
  }

  async cancel(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const [before] = await tx<WarehouseReceiptRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from warehouse_receipts
        where id = ${id} and tenant_id = ${actor.tenantId}
          and (${scope}::uuid[] is null or warehouse_id = any(${scope})) for update
      `;
      if (!before) return null;
      if (before.status !== 'issued') {
        throw new BadRequestException(`Cannot cancel a warehouse receipt in '${before.status}' status`);
      }
      await tx`update warehouse_receipts set status = 'cancelled' where id = ${id} and tenant_id = ${actor.tenantId}`;
      const [after] = await tx<WarehouseReceiptRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from warehouse_receipts where id = ${id}
      `;
      return { before, after };
    });
    if (!result) throw new NotFoundException('Warehouse receipt not found');

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'status_change',
      entityType: 'warehouse_receipt',
      entityId: id,
      previousValue: { status: result.before.status },
      newValue: { status: result.after.status },
      ipAddress,
    });
    return toApi(result.after);
  }
}
