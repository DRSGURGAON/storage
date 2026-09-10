import { BadRequestException, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { SETTINGS_BY_KEY } from '../company/tenant-settings.registry';
import { StockMovement, StockService } from '../stock/stock.service';

const OUTWARD_POSTING_POINT = SETTINGS_BY_KEY.get('workflow.outward_posting_point')!;

export interface OutwardPostingResult {
  /** False when this dispatch's OUTWARD rows were already in the ledger. */
  posted: boolean;
  releaseOrderId: string;
  releaseOrderStatusBefore: string;
  releaseOrderStatusAfter: string;
}

/**
 * The one place an `OUTWARD` row is written. Blueprint §35 makes gate-out
 * the moment physical stock leaves; `workflow.outward_posting_point` lets a
 * tenant that does not gate-track outbound vehicles post at dispatch
 * confirmation instead. Whichever transition fires first posts, the other
 * finds the rows already there and posts nothing -- the idempotency key is
 * per dispatch, so there is no path to a second `OUTWARD` for the same goods
 * (stock-engine.md §4, §79 "dispatch 40 → stock 60").
 *
 * Each dispatch line is drawn against the release order's own `RESERVE`
 * rows, which is what names the lots -- location, batch, serial -- the
 * goods are leaving from. One `OUTWARD` per lot takes the physical
 * quantity *and* releases the reservation in the same row, so the lot's
 * `reserved_qty` can never outlive the stock it was reserving.
 */
@Injectable()
export class OutboundPostingService {
  constructor(private readonly stock: StockService) {}

  async postingPoint(tx: postgres.TransactionSql, tenantId: string): Promise<'gate_pass' | 'dispatch'> {
    const [row] = await tx<{ value: unknown }[]>`
      select value from tenant_settings where tenant_id = ${tenantId} and key = ${OUTWARD_POSTING_POINT.key}
    `;
    return row?.value === 'dispatch' ? 'dispatch' : 'gate_pass';
  }

  async postOutward(tx: postgres.TransactionSql, actor: AuthenticatedUser, dispatchId: string): Promise<OutwardPostingResult> {
    const [dispatch] = await tx<{ id: string; number: string; release_order_id: string; customer_id: string; warehouse_id: string }[]>`
      select id, number, release_order_id, customer_id, warehouse_id from dispatches
      where id = ${dispatchId} and tenant_id = ${actor.tenantId} for update
    `;
    const [order] = await tx<{ status: string }[]>`
      select status from release_orders where id = ${dispatch.release_order_id} and tenant_id = ${actor.tenantId} for update
    `;
    const [already] = await tx`
      select 1 from stock_ledger where tenant_id = ${actor.tenantId} and source_type = 'dispatch' and source_id = ${dispatchId} and txn_type = 'OUTWARD' limit 1
    `;
    if (already) {
      return { posted: false, releaseOrderId: dispatch.release_order_id, releaseOrderStatusBefore: order.status, releaseOrderStatusAfter: order.status };
    }

    const lines = await tx<{ id: string; release_order_line_id: string; product_id: string; batch_id: string | null; quantity: string; uom_code: string }[]>`
      select id, release_order_line_id, product_id, batch_id, quantity, uom_code from dispatch_lines
      where tenant_id = ${actor.tenantId} and dispatch_id = ${dispatchId} order by id
    `;
    const movements: StockMovement[] = [];
    for (const line of lines) {
      // What the reservation holds on each lot for this order line, less
      // what earlier dispatches of the same line already took from it.
      const lots = await tx<{ location_id: string | null; batch_id: string | null; serial_no: string | null; remaining: string }[]>`
        select r.location_id, r.batch_id, r.serial_no,
               (sum(r.reserved_delta) - coalesce((
                 select sum(o.qty_out) from stock_ledger o join dispatch_lines dl on dl.id = o.source_line_id
                 where o.tenant_id = ${actor.tenantId} and o.txn_type = 'OUTWARD' and dl.release_order_line_id = ${line.release_order_line_id}
                   and o.location_id is not distinct from r.location_id and o.batch_id is not distinct from r.batch_id
                   and o.serial_no is not distinct from r.serial_no
               ), 0))::text as remaining
        from stock_ledger r
        where r.tenant_id = ${actor.tenantId} and r.txn_type = 'RESERVE' and r.source_type = 'release_order'
          and r.source_line_id = ${line.release_order_line_id}
        group by r.location_id, r.batch_id, r.serial_no
        having sum(r.reserved_delta) > 0
        order by min(r.txn_at)
      `;
      let remaining = Number(line.quantity);
      for (const lot of lots) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, Number(lot.remaining));
        if (take <= 0) continue;
        movements.push({
          txnType: 'OUTWARD',
          customerId: dispatch.customer_id,
          warehouseId: dispatch.warehouse_id,
          locationId: lot.location_id,
          productId: line.product_id,
          batchId: lot.batch_id,
          serialNo: lot.serial_no,
          qtyOut: take,
          reservedDelta: -take,
          uomCode: line.uom_code,
          sourceLineId: line.id,
          remarks: `Dispatch ${dispatch.number}`,
        });
        remaining -= take;
      }
      if (remaining > 0) {
        throw new BadRequestException(
          `Dispatch line for product ${line.product_id}: ${line.quantity} to dispatch but only ${Number(line.quantity) - remaining} is reserved and not yet dispatched on this order`,
        );
      }
    }
    if (movements.length === 0) throw new BadRequestException('Nothing to dispatch on this note');

    await this.stock.postWithin(tx, actor, {
      sourceType: 'dispatch',
      sourceId: dispatchId,
      idempotencyKey: `dispatch:${dispatchId}:outward`,
      movements,
    });

    for (const line of lines) {
      await tx`
        update release_order_lines set dispatched_qty = dispatched_qty + ${line.quantity}
        where id = ${line.release_order_line_id} and tenant_id = ${actor.tenantId}
      `;
    }
    const [{ all_dispatched }] = await tx<{ all_dispatched: boolean }[]>`
      select bool_and(dispatched_qty >= reserved_qty and reserved_qty > 0) as all_dispatched from release_order_lines
      where tenant_id = ${actor.tenantId} and release_order_id = ${dispatch.release_order_id}
    `;
    let after = order.status;
    if (all_dispatched) {
      after = 'dispatched';
      await tx`update release_orders set status = 'dispatched', updated_at = now() where id = ${dispatch.release_order_id} and tenant_id = ${actor.tenantId}`;
    }
    return { posted: true, releaseOrderId: dispatch.release_order_id, releaseOrderStatusBefore: order.status, releaseOrderStatusAfter: after };
  }

  /** A release order is done when every dispatch raised against it has its delivery proven. */
  async completeReleaseOrderIfDelivered(tx: postgres.TransactionSql, tenantId: string, releaseOrderId: string) {
    const [order] = await tx<{ status: string }[]>`select status from release_orders where id = ${releaseOrderId} and tenant_id = ${tenantId} for update`;
    if (order.status !== 'dispatched') return { before: order.status, after: order.status };
    const [{ outstanding }] = await tx<{ outstanding: string }[]>`
      select count(*)::text as outstanding from dispatches
      where tenant_id = ${tenantId} and release_order_id = ${releaseOrderId} and status not in ('completed', 'cancelled')
    `;
    if (Number(outstanding) > 0) return { before: order.status, after: order.status };
    await tx`update release_orders set status = 'completed', updated_at = now() where id = ${releaseOrderId} and tenant_id = ${tenantId}`;
    return { before: order.status, after: 'completed' };
  }
}
