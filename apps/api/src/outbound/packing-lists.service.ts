import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { assertWarehouseInScope, loadWarehouseScope } from '../auth/warehouse-scope';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { NumberingService } from '../numbering/numbering.service';
import { CreatePackingListDto, ListPackingListsQuery } from './dto/outbound.dtos';

interface PackingListRow {
  id: string;
  number: string;
  release_order_id: string;
  release_order_number: string;
  warehouse_id: string;
  customer_id: string;
  consignee_name: string | null;
  total_packages: number | null;
  total_weight_kg: string | null;
  remarks: string | null;
  created_at: string;
}

interface PackingLineRow {
  id: string;
  product_id: string;
  quantity: string;
  packages: number | null;
  box_number: string | null;
  weight_kg: string | null;
  remarks: string | null;
  sku?: string;
  product_name?: string;
}

const SELECT = `
  pk.id, pk.number, pk.release_order_id, ro.number as release_order_number, ro.warehouse_id, pk.customer_id, pk.consignee_name,
  pk.total_packages, pk.total_weight_kg, pk.remarks, pk.created_at`;

function toApi(row: PackingListRow, lines?: PackingLineRow[]) {
  return {
    id: row.id,
    number: row.number,
    releaseOrderId: row.release_order_id,
    releaseOrderNumber: row.release_order_number,
    warehouseId: row.warehouse_id,
    customerId: row.customer_id,
    consigneeName: row.consignee_name,
    totalPackages: row.total_packages,
    totalWeightKg: row.total_weight_kg === null ? null : Number(row.total_weight_kg),
    remarks: row.remarks,
    createdAt: row.created_at,
    ...(lines && {
      lines: lines.map((l) => ({
        id: l.id,
        productId: l.product_id,
        sku: l.sku,
        productName: l.product_name,
        quantity: Number(l.quantity),
        packages: l.packages,
        boxNumber: l.box_number,
        weightKg: l.weight_kg === null ? null : Number(l.weight_kg),
        remarks: l.remarks,
      })),
    }),
  };
}

/**
 * Blueprint §32's Packing List: how the picked goods were boxed. It has
 * no status and moves nothing; it is a description that travels with the
 * consignment, so it can be raised any number of times against a picked
 * order and a dispatch simply names the one it shipped with. Lines
 * default to the order's picked quantities, and package/weight totals to
 * the sum of the lines when not stated.
 */
@Injectable()
export class PackingListsService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
  ) {}

  async create(actor: AuthenticatedUser, dto: CreatePackingListDto, ipAddress?: string) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const [order] = await tx<{ id: string; status: string; warehouse_id: string; customer_id: string; consignee_name: string | null }[]>`
        select id, status, warehouse_id, customer_id, consignee_name from release_orders where id = ${dto.releaseOrderId} and tenant_id = ${actor.tenantId}
      `;
      if (!order) throw new NotFoundException('Release order not found');
      assertWarehouseInScope(scope, order.warehouse_id);
      if (!['picked', 'partially_picked', 'dispatched'].includes(order.status)) {
        throw new BadRequestException(`Cannot pack a release order in '${order.status}' status -- pick it first`);
      }
      let lines: { product_id: string; quantity: number; packages: number | null; box_number: string | null; weight_kg: number | null; remarks: string | null }[];
      if (dto.lines) {
        for (const l of dto.lines) {
          const [p] = await tx`select 1 from products where id = ${l.productId} and tenant_id = ${actor.tenantId}`;
          if (!p) throw new NotFoundException(`Product ${l.productId} not found`);
        }
        lines = dto.lines.map((l) => ({
          product_id: l.productId, quantity: l.quantity, packages: l.packages ?? null, box_number: l.boxNumber ?? null,
          weight_kg: l.weightKg ?? null, remarks: l.remarks ?? null,
        }));
      } else {
        const picked = await tx<{ product_id: string; picked_qty: string; weight_kg: string | null }[]>`
          select rol.product_id, rol.picked_qty, p.weight_kg from release_order_lines rol join products p on p.id = rol.product_id
          where rol.tenant_id = ${actor.tenantId} and rol.release_order_id = ${order.id} and rol.picked_qty > 0 order by rol.line_no
        `;
        if (picked.length === 0) throw new BadRequestException('Nothing has been picked on this order yet');
        lines = picked.map((l) => ({
          product_id: l.product_id, quantity: Number(l.picked_qty), packages: null, box_number: null,
          weight_kg: l.weight_kg === null ? null : Number(l.weight_kg) * Number(l.picked_qty), remarks: null,
        }));
      }
      const totalPackages = dto.totalPackages ?? (lines.some((l) => l.packages !== null) ? lines.reduce((s, l) => s + (l.packages ?? 0), 0) : null);
      const totalWeight = dto.totalWeightKg ?? (lines.some((l) => l.weight_kg !== null) ? lines.reduce((s, l) => s + (l.weight_kg ?? 0), 0) : null);

      const number = await this.numbering.allocateNumberIn(tx, actor.tenantId, 'PACKING_LIST', order.warehouse_id);
      const id = randomUUID();
      await tx`
        insert into packing_lists (id, tenant_id, number, release_order_id, customer_id, consignee_name, total_packages, total_weight_kg, remarks, created_by)
        values (${id}, ${actor.tenantId}, ${number}, ${order.id}, ${order.customer_id}, ${dto.consigneeName ?? order.consignee_name},
                ${totalPackages}, ${totalWeight}, ${dto.remarks ?? null}, ${actor.userId})
      `;
      for (const l of lines) {
        await tx`
          insert into packing_list_lines (id, tenant_id, packing_list_id, product_id, quantity, packages, box_number, weight_kg, remarks)
          values (${randomUUID()}, ${actor.tenantId}, ${id}, ${l.product_id}, ${l.quantity}, ${l.packages}, ${l.box_number}, ${l.weight_kg}, ${l.remarks})
        `;
      }
      return (await this.fetchWithLines(tx, actor.tenantId, id))!;
    });
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, userRoleCode: actor.roleCode, action: 'create',
      entityType: 'packing_list', entityId: result.row.id, newValue: result.row, ipAddress,
    });
    return toApi(result.row, result.lines);
  }

  private async fetchWithLines(tx: postgres.TransactionSql, tenantId: string, id: string) {
    const [row] = await tx<PackingListRow[]>`
      select ${tx.unsafe(SELECT)} from packing_lists pk join release_orders ro on ro.id = pk.release_order_id where pk.id = ${id} and pk.tenant_id = ${tenantId}
    `;
    if (!row) return null;
    const lines = await tx<PackingLineRow[]>`
      select pkl.id, pkl.product_id, pkl.quantity, pkl.packages, pkl.box_number, pkl.weight_kg, pkl.remarks, p.sku, p.name as product_name
      from packing_list_lines pkl join products p on p.id = pkl.product_id
      where pkl.tenant_id = ${tenantId} and pkl.packing_list_id = ${id} order by pkl.box_number nulls last, p.sku
    `;
    return { row, lines };
  }

  async list(actor: AuthenticatedUser, query: ListPackingListsQuery) {
    const pattern = query.q ? `%${query.q}%` : null;
    const roFilter = query.releaseOrderId ?? null;
    const customerFilter = query.customerId ?? null;
    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const where = tx`
        where pk.tenant_id = ${actor.tenantId}
          and (${scope}::uuid[] is null or ro.warehouse_id = any(${scope}))
          and (${pattern}::text is null or pk.number ilike ${pattern} or ro.number ilike ${pattern} or pk.consignee_name ilike ${pattern})
          and (${roFilter}::uuid is null or pk.release_order_id = ${roFilter})
          and (${customerFilter}::uuid is null or pk.customer_id = ${customerFilter})`;
      const rows = await tx<PackingListRow[]>`
        select ${tx.unsafe(SELECT)} from packing_lists pk join release_orders ro on ro.id = pk.release_order_id ${where}
        order by pk.created_at desc limit ${query.limit} offset ${query.offset}
      `;
      const [{ count }] = await tx<{ count: string }[]>`select count(*)::text as count from packing_lists pk join release_orders ro on ro.id = pk.release_order_id ${where}`;
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
    if (!fetched) throw new NotFoundException('Packing list not found');
    return toApi(fetched.row, fetched.lines);
  }
}
