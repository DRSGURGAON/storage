import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PG_CONNECTION } from '../db/db.module';
import { assertWarehouseInScope, loadWarehouseScope } from '../auth/warehouse-scope';
import { withTenant } from '../db/tenant-context';
import { NumberingService } from '../numbering/numbering.service';
import { StockMovement, StockService } from '../stock/stock.service';
import { CreatePutawayDto } from './dto/create-putaway.dto';
import { ListPutawaysQuery } from './dto/list-putaways.query';

interface PutawayRow {
  id: string;
  number: string;
  grn_id: string;
  /** Joined on the reads: a put-away slip is "for GRN X", and an id is not that. */
  grn_number?: string;
  warehouse_id: string;
  customer_id: string;
  assigned_to: string | null;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  completed_by: string | null;
  created_at: string;
}

interface PutawayLineRow {
  id: string;
  grn_item_id: string;
  product_id: string;
  quantity: string;
  to_location_id: string;
  location_full_code: string;
  product_sku: string | null;
  product_name: string | null;
  batch_no: string | null;
  stock_lot_id: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
}

const SELECT_COLUMNS = `
  id, number, grn_id, warehouse_id, customer_id, assigned_to, status, started_at, completed_at,
  completed_by, created_at`;

function toApi(row: PutawayRow, lines?: PutawayLineRow[]) {
  return {
    id: row.id,
    number: row.number,
    grnId: row.grn_id,
    ...(row.grn_number !== undefined ? { grnNumber: row.grn_number } : {}),
    warehouseId: row.warehouse_id,
    customerId: row.customer_id,
    assignedTo: row.assigned_to,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    completedBy: row.completed_by,
    createdAt: row.created_at,
    ...(lines && {
      lines: lines.map((l) => ({
        id: l.id,
        grnItemId: l.grn_item_id,
        productId: l.product_id,
        productSku: l.product_sku,
        productName: l.product_name,
        batchNo: l.batch_no,
        quantity: Number(l.quantity),
        toLocationId: l.to_location_id,
        toLocationCode: l.location_full_code,
        stockLotId: l.stock_lot_id,
        confirmedAt: l.confirmed_at,
        confirmedBy: l.confirmed_by,
      })),
    }),
  };
}

/**
 * Blueprint §21: "After GRN approval generate PUT-AWAY SLIP... user
 * selects zone, rack, row, bin, pallet. Once completed, stock location
 * is updated."
 *
 * The last clause is Phase 5's: `putaway_lines.stock_lot_id` stays null
 * and no `stock_ledger` row is written, because Phase 4 moves no stock
 * at all (dev-phases.md). `complete()` therefore records *where* each
 * line went and who confirmed it -- the whole input the stock engine
 * will need -- without pretending the ledger has been touched.
 *
 * `putaways.grn_id` is unique in the schema: one put-away per GRN, so a
 * second attempt is a 409 rather than a silent second slip.
 */
@Injectable()
export class PutawaysService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly stock: StockService,
  ) {}

  private async fetchWithLines(tx: postgres.TransactionSql, tenantId: string, id: string) {
    const [row] = await tx<PutawayRow[]>`
      select ${tx.unsafe(SELECT_COLUMNS.split(',').map((c) => `p.${c.trim()}`).join(', '))}, g.number as grn_number
      from putaways p join grns g on g.id = p.grn_id
      where p.id = ${id} and p.tenant_id = ${tenantId}
    `;
    if (!row) return null;
    const lines = await tx<PutawayLineRow[]>`
      select pl.id, pl.grn_item_id, pl.product_id, pl.quantity, pl.to_location_id, pl.stock_lot_id,
             pl.confirmed_at, pl.confirmed_by, l.full_code as location_full_code,
             gi.product_snapshot->>'sku' as product_sku, gi.product_snapshot->>'name' as product_name,
             gi.batch_no
      from putaway_lines pl
      join locations l on l.id = pl.to_location_id
      join grn_items gi on gi.id = pl.grn_item_id
      where pl.tenant_id = ${tenantId} and pl.putaway_id = ${id}
      order by l.full_code
    `;
    return { row, lines };
  }

  async create(actor: AuthenticatedUser, dto: CreatePutawayDto, ipAddress?: string) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const [grn] = await tx<{ status: string; warehouse_id: string; customer_id: string }[]>`
        select status, warehouse_id, customer_id from grns where id = ${dto.grnId} and tenant_id = ${actor.tenantId}
      `;
      if (!grn) throw new NotFoundException('GRN not found');
      // The warehouse is the GRN's, not the caller's to choose -- so the scope
      // check is against where the goods actually are.
      assertWarehouseInScope(scope, grn.warehouse_id);
      if (grn.status !== 'approved') {
        throw new BadRequestException(
          `Cannot create a put-away for a GRN in '${grn.status}' status (expected 'approved')`,
        );
      }

      if (dto.assignedTo) {
        const [member] = await tx`
          select 1 from tenant_users where user_id = ${dto.assignedTo} and tenant_id = ${actor.tenantId} and status = 'active'
        `;
        if (!member) throw new NotFoundException('Assignee is not an active member of this tenant');
      }

      // Every line's GRN item must belong to this GRN, and the quantities put away must not exceed
      // what the GRN actually accepted -- a line may be split across locations (schema/30_inbound.sql).
      const grnItems = await tx<{ id: string; accepted_qty: string }[]>`
        select id, accepted_qty from grn_items where tenant_id = ${actor.tenantId} and grn_id = ${dto.grnId}
      `;
      const acceptedById = new Map(grnItems.map((i) => [i.id, Number(i.accepted_qty)]));
      const plannedById = new Map<string, number>();
      for (const line of dto.lines) {
        const accepted = acceptedById.get(line.grnItemId);
        if (accepted === undefined) throw new NotFoundException('GRN item not found on this GRN');
        const quantity = line.quantity ?? accepted;
        if (quantity <= 0) throw new BadRequestException('Put-away quantity must be greater than zero');
        plannedById.set(line.grnItemId, (plannedById.get(line.grnItemId) ?? 0) + quantity);

        const [location] = await tx<{ warehouse_id: string; is_active: boolean }[]>`
          select warehouse_id, is_active from locations where id = ${line.toLocationId} and tenant_id = ${actor.tenantId}
        `;
        if (!location) throw new NotFoundException('Location not found');
        if (location.warehouse_id !== grn.warehouse_id) {
          throw new BadRequestException("Location belongs to a different warehouse than the GRN's");
        }
        if (!location.is_active) throw new BadRequestException('Location is not active');
      }
      for (const [grnItemId, planned] of plannedById) {
        const accepted = acceptedById.get(grnItemId)!;
        if (planned > accepted) {
          throw new BadRequestException(
            `Put-away quantity (${planned}) exceeds the GRN line's accepted quantity (${accepted})`,
          );
        }
      }

      const number = await this.numbering.allocateNumberIn(tx, actor.tenantId, 'PUTAWAY');
      const id = randomUUID();
      try {
        await tx`
          insert into putaways (id, tenant_id, number, grn_id, warehouse_id, customer_id, assigned_to, created_by)
          values (${id}, ${actor.tenantId}, ${number}, ${dto.grnId}, ${grn.warehouse_id}, ${grn.customer_id},
                  ${dto.assignedTo ?? null}, ${actor.userId})
        `;
      } catch (err) {
        // putaways.grn_id is unique -- one put-away per GRN.
        if ((err as { code?: string }).code === '23505') {
          throw new ConflictException('A put-away already exists for this GRN');
        }
        throw err;
      }

      for (const line of dto.lines) {
        const [grnItem] = await tx<{ product_id: string }[]>`
          select product_id from grn_items where id = ${line.grnItemId} and tenant_id = ${actor.tenantId}
        `;
        await tx`
          insert into putaway_lines (id, tenant_id, putaway_id, grn_item_id, product_id, quantity, to_location_id)
          values (${randomUUID()}, ${actor.tenantId}, ${id}, ${line.grnItemId}, ${grnItem.product_id},
                  ${line.quantity ?? acceptedById.get(line.grnItemId)!}, ${line.toLocationId})
        `;
      }

      const fetched = await this.fetchWithLines(tx, actor.tenantId, id);
      return fetched!;
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'create',
      entityType: 'putaway',
      entityId: result.row.id,
      newValue: result.row,
      ipAddress,
    });
    return toApi(result.row, result.lines);
  }

  async list(actor: AuthenticatedUser, query: ListPutawaysQuery) {
    const pattern = query.q ? `%${query.q}%` : null;
    const grnFilter = query.grnId ?? null;
    const warehouseFilter = query.warehouseId ?? null;
    const statusFilter = query.status ?? null;

    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const rows = await tx<PutawayRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS.split(',').map((c) => `p.${c.trim()}`).join(', '))}, g.number as grn_number
        from putaways p join grns g on g.id = p.grn_id
        where p.tenant_id = ${actor.tenantId}
          and (${scope}::uuid[] is null or p.warehouse_id = any(${scope}))
          and (${pattern}::text is null or p.number ilike ${pattern})
          and (${grnFilter}::uuid is null or p.grn_id = ${grnFilter})
          and (${warehouseFilter}::uuid is null or p.warehouse_id = ${warehouseFilter})
          and (${statusFilter}::text is null or p.status = ${statusFilter})
        order by p.created_at desc
        limit ${query.limit} offset ${query.offset}
      `;
      const [{ count }] = await tx<{ count: string }[]>`
        select count(*)::text as count from putaways
        where tenant_id = ${actor.tenantId}
          and (${scope}::uuid[] is null or warehouse_id = any(${scope}))
          and (${pattern}::text is null or number ilike ${pattern})
          and (${grnFilter}::uuid is null or grn_id = ${grnFilter})
          and (${warehouseFilter}::uuid is null or warehouse_id = ${warehouseFilter})
          and (${statusFilter}::text is null or status = ${statusFilter})
      `;
      return { items: rows.map((r) => toApi(r)), total: Number(count), limit: query.limit, offset: query.offset };
    });
  }

  async get(actor: AuthenticatedUser, id: string) {
    const fetched = await withTenant(this.sql, actor.tenantId, (tx) => this.fetchWithLines(tx, actor.tenantId, id));
    if (!fetched) throw new NotFoundException('Put-away not found');
    return toApi(fetched.row, fetched.lines);
  }

  private async transition(
    actor: AuthenticatedUser,
    id: string,
    ipAddress: string | undefined,
    allowedFrom: string[],
    apply: (tx: postgres.TransactionSql, before: PutawayRow) => Promise<void>,
  ) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const [before] = await tx<PutawayRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from putaways where id = ${id} and tenant_id = ${actor.tenantId}
          and (${scope}::uuid[] is null or warehouse_id = any(${scope})) for update
      `;
      if (!before) return null;
      if (!allowedFrom.includes(before.status)) {
        throw new BadRequestException(
          `Cannot transition a put-away from '${before.status}' (expected one of: ${allowedFrom.join(', ')})`,
        );
      }
      await apply(tx, before);
      const after = await this.fetchWithLines(tx, actor.tenantId, id);
      return { before, after: after! };
    });
    if (!result) throw new NotFoundException('Put-away not found');

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'status_change',
      entityType: 'putaway',
      entityId: id,
      previousValue: { status: result.before.status },
      newValue: { status: result.after.row.status },
      ipAddress,
    });
    return toApi(result.after.row, result.after.lines);
  }

  start(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['pending'], async (tx) => {
      await tx`
        update putaways set status = 'in_progress', started_at = now()
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;
    });
  }

  /**
   * Confirms every line's placement -- and moves the stock to match, which
   * is what "stock location is updated" (§20) actually means.
   *
   * GRN approval posted the goods unallocated (`location_id` null). Each
   * put-away line is therefore a relocation, and stock-engine.md §7 is
   * explicit that a move is two ledger rows rather than a mutation of one
   * row's location: a `TRANSFER_OUT` from the unallocated lot and a
   * `TRANSFER_IN` at the bin. The destination lot's id is then what
   * `putaway_lines.stock_lot_id` records, so a line points at the balance
   * it created rather than merely naming a location.
   */
  complete(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['pending', 'in_progress'], async (tx, before) => {
      await this.postPlacementStock(tx, actor, before);
      await tx`
        update putaways set status = 'completed', completed_at = now(), completed_by = ${actor.userId}
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;
      await tx`
        update putaway_lines set confirmed_at = now(), confirmed_by = ${actor.userId}
        where putaway_id = ${id} and tenant_id = ${actor.tenantId}
      `;
    });
  }

  private async postPlacementStock(tx: postgres.TransactionSql, actor: AuthenticatedUser, putaway: PutawayRow) {
    const lines = await tx<
      {
        id: string;
        grn_item_id: string;
        product_id: string;
        quantity: string;
        to_location_id: string;
        batch_id: string | null;
        uom_code: string;
        sku: string;
        serial_tracked: boolean;
      }[]
    >`
      select pl.id, pl.grn_item_id, pl.product_id, pl.quantity, pl.to_location_id,
             gi.batch_id, p.uom_code, p.sku, p.serial_tracked
      from putaway_lines pl
      join grn_items gi on gi.id = pl.grn_item_id
      join products p on p.id = pl.product_id
      where pl.tenant_id = ${actor.tenantId} and pl.putaway_id = ${putaway.id}
      order by pl.id
    `;

    const movements: StockMovement[] = [];
    /** Positional back-reference: which line each TRANSFER_IN belongs to. */
    const destinationFor: { lineId: string; movementIndex: number }[] = [];

    for (const line of lines) {
      const quantity = Number(line.quantity);
      const base = {
        customerId: putaway.customer_id,
        warehouseId: putaway.warehouse_id,
        productId: line.product_id,
        batchId: line.batch_id,
        uomCode: line.uom_code,
        sourceLineId: line.id,
      };

      // Serial-tracked stock sits in one lot per serial, but a put-away
      // line carries only a quantity -- `putaway_lines` has no serial
      // column. So the serials to move are chosen here, oldest unallocated
      // first, rather than guessed: taking N specific serial lots is the
      // only way the two halves of the transfer can name the same lots.
      const serialNos: (string | null)[] = [];
      if (line.serial_tracked) {
        const available = await tx<{ serial_no: string }[]>`
          select serial_no from stock_lots
          where tenant_id = ${actor.tenantId} and customer_id = ${putaway.customer_id}
            and warehouse_id = ${putaway.warehouse_id} and location_id is null
            and product_id = ${line.product_id} and serial_no is not null
            and physical_qty > 0
          order by updated_at, serial_no
          limit ${quantity}
        `;
        if (available.length < quantity) {
          throw new BadRequestException(
            `Cannot put away ${quantity} of ${line.sku}: only ${available.length} unallocated serial-tracked ` +
              `unit(s) are on hand for that product`,
          );
        }
        serialNos.push(...available.map((r) => r.serial_no));
      } else {
        serialNos.push(null);
      }

      for (const serialNo of serialNos) {
        const qty = line.serial_tracked ? 1 : quantity;
        movements.push({
          ...base,
          txnType: 'TRANSFER_OUT',
          locationId: null,
          serialNo,
          qtyOut: qty,
        });
        destinationFor.push({ lineId: line.id, movementIndex: movements.length });
        movements.push({
          ...base,
          txnType: 'TRANSFER_IN',
          locationId: line.to_location_id,
          serialNo,
          qtyIn: qty,
        });
      }
    }

    const result = await this.stock.postWithin(tx, actor, {
      sourceType: 'putaway',
      sourceId: putaway.id,
      idempotencyKey: `putaway:${putaway.id}:complete`,
      movements,
    });
    if (!result.posted) return;

    // One line may hold several serial lots; they all belong to the same
    // destination bin, so the first is the one worth recording.
    const recorded = new Set<string>();
    for (const { lineId, movementIndex } of destinationFor) {
      if (recorded.has(lineId)) continue;
      recorded.add(lineId);
      await tx`
        update putaway_lines set stock_lot_id = ${result.lotIds[movementIndex]}
        where id = ${lineId} and tenant_id = ${actor.tenantId}
      `;
    }
  }

  cancel(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['pending', 'in_progress'], async (tx) => {
      await tx`update putaways set status = 'cancelled' where id = ${id} and tenant_id = ${actor.tenantId}`;
    });
  }
}
