import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type postgres from 'postgres';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PG_CONNECTION } from '../db/db.module';
import { withPortalTenant } from '../db/tenant-context';
import { AuditService } from '../audit/audit.service';
import { DocumentEngineService } from '../documents/documents.service';
import { DownloadLinkService } from '../documents/download-link.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NumberingService } from '../numbering/numbering.service';
import { buildCustomerStatement } from '../receivables/statements.service';
import { PortalListQuery } from './dto/portal.dtos';

/**
 * `tenancy-and-security.md` §2's service layer: "portal API controllers
 * use a distinct base repository that hard-codes the `customer_id`
 * filter; it is structurally impossible to call the 'all customers' query
 * path from a portal request handler."
 *
 * That is what this class is. Every query below is written here, in one
 * file, with `customer_id = ${customerId}` inline -- none of them takes a
 * customer parameter from the request, and none of them calls a staff
 * service that could be handed a different one. `customerId` arrives from
 * `PortalGuard`, which reads it from the membership row on every request.
 *
 * The staff API is not reachable from a portal session either, and not
 * because these routes are separate: the `customer` role is seeded with
 * **no permissions at all**, so `PermissionsGuard` refuses every staff
 * endpoint before its handler runs. The two halves are independent, which
 * is the point of "belt and braces".
 */
@Injectable()
export class PortalService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly documents: DocumentEngineService,
    private readonly links: DownloadLinkService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private customerOf(actor: AuthenticatedUser): string {
    if (!actor.customerId) throw new ForbiddenException('This endpoint is for customer-portal logins');
    return actor.customerId;
  }

  async profile(actor: AuthenticatedUser) {
    const customerId = this.customerOf(actor);
    return withPortalTenant(this.sql, actor.tenantId, customerId, async (tx) => {
      const [customer] = await tx<Record<string, any>[]>`
        select c.id, c.code, c.name, c.legal_name, c.gstin, c.pan, c.place_of_supply, c.credit_days, c.payment_terms,
               t.legal_name as tenant_name, t.trade_name as tenant_trade_name
        from customers c join tenants t on t.id = c.tenant_id
        where c.id = ${customerId} and c.tenant_id = ${actor.tenantId}
      `;
      if (!customer) throw new NotFoundException('Customer not found');
      const [counts] = await tx<Record<string, any>[]>`
        select
          (select count(*) from grns where tenant_id = ${actor.tenantId} and customer_id = ${customerId} and status = 'approved')::int as approved_grns,
          (select count(*) from dispatches where tenant_id = ${actor.tenantId} and customer_id = ${customerId} and status in ('gate_out', 'completed'))::int as dispatches,
          (select coalesce(sum(physical_qty), 0) from stock_lots where tenant_id = ${actor.tenantId} and customer_id = ${customerId})::text as stock_on_hand,
          (select coalesce(sum(balance_due), 0) from invoices where tenant_id = ${actor.tenantId} and customer_id = ${customerId}
             and status in ('issued', 'partially_paid', 'overdue'))::text as outstanding,
          (select count(*) from release_orders where tenant_id = ${actor.tenantId} and customer_id = ${customerId}
             and status not in ('completed', 'cancelled'))::int as open_releases
      `;
      return {
        customer: {
          id: customer.id, code: customer.code, name: customer.name, legalName: customer.legal_name,
          gstin: customer.gstin, pan: customer.pan, placeOfSupply: customer.place_of_supply,
          creditDays: customer.credit_days, paymentTerms: customer.payment_terms,
        },
        warehouseOperator: customer.tenant_trade_name ?? customer.tenant_name,
        summary: {
          approvedGrns: counts.approved_grns,
          dispatches: counts.dispatches,
          stockOnHand: Number(counts.stock_on_hand),
          outstanding: Number(counts.outstanding),
          openReleaseOrders: counts.open_releases,
        },
      };
    });
  }

  /** §53's "my stock": the customer's own lots, never anyone else's, with no warehouse-wide totals. */
  async stock(actor: AuthenticatedUser, query: PortalListQuery) {
    const customerId = this.customerOf(actor);
    return withPortalTenant(this.sql, actor.tenantId, customerId, async (tx) => {
      const rows = await tx<Record<string, any>[]>`
        select p.sku, p.name as product_name, w.code as warehouse_code, w.name as warehouse_name, b.batch_no, b.expiry_date,
               sum(sl.physical_qty)::text as physical_qty, sum(sl.reserved_qty)::text as reserved_qty,
               sum(sl.physical_qty - sl.reserved_qty)::text as available_qty, sl.uom_code
        from stock_lots sl join products p on p.id = sl.product_id join warehouses w on w.id = sl.warehouse_id
        left join batches b on b.id = sl.batch_id
        where sl.tenant_id = ${actor.tenantId} and sl.customer_id = ${customerId} and sl.physical_qty > 0
        group by p.sku, p.name, w.code, w.name, b.batch_no, b.expiry_date, sl.uom_code
        order by p.sku, w.code, b.batch_no nulls first
        limit ${query.limit} offset ${query.offset}
      `;
      const [{ count }] = await tx<{ count: string }[]>`
        select count(distinct (sl.product_id, sl.warehouse_id, sl.batch_id))::text as count from stock_lots sl
        where sl.tenant_id = ${actor.tenantId} and sl.customer_id = ${customerId} and sl.physical_qty > 0
      `;
      return {
        items: rows.map((r) => ({
          sku: r.sku, productName: r.product_name, warehouseCode: r.warehouse_code, warehouseName: r.warehouse_name,
          batchNo: r.batch_no, expiryDate: r.expiry_date, physicalQty: Number(r.physical_qty),
          reservedQty: Number(r.reserved_qty), availableQty: Number(r.available_qty), uomCode: r.uom_code,
        })),
        total: Number(count), limit: query.limit, offset: query.offset,
      };
    });
  }

  /** Every document issued *to this customer*, which is what `documents.customer_id` already records. */
  async documentsList(actor: AuthenticatedUser, query: PortalListQuery & { documentType?: string }) {
    const customerId = this.customerOf(actor);
    const typeFilter = query.documentType ?? null;
    return withPortalTenant(this.sql, actor.tenantId, customerId, async (tx) => {
      const where = tx`
        where tenant_id = ${actor.tenantId} and customer_id = ${customerId} and is_latest
          and (${typeFilter}::text is null or document_type = ${typeFilter})`;
      const rows = await tx<Record<string, any>[]>`
        select id, document_type, document_number, version_no, status_at_generation, generated_at, qr_token
        from documents ${where} order by generated_at desc limit ${query.limit} offset ${query.offset}
      `;
      const [{ count }] = await tx<{ count: string }[]>`select count(*)::text as count from documents ${where}`;
      return {
        items: rows.map((r) => ({
          id: r.id, documentType: r.document_type, documentNumber: r.document_number, versionNo: r.version_no,
          statusAtGeneration: r.status_at_generation, generatedAt: r.generated_at, qrToken: r.qr_token,
        })),
        total: Number(count), limit: query.limit, offset: query.offset,
      };
    });
  }

  /**
   * The download re-checks ownership at the moment of issue rather than
   * trusting that the id came from the list above (§2's closing paragraph
   * on signed URLs makes the same point about the sign step). An id from
   * another customer's document is a 404 here, not a file.
   */
  async downloadDocument(actor: AuthenticatedUser, documentId: string) {
    const customerId = this.customerOf(actor);
    const [owned] = await withPortalTenant(this.sql, actor.tenantId, customerId, (tx) => tx`
      select 1 from documents where id = ${documentId} and tenant_id = ${actor.tenantId} and customer_id = ${customerId}
    `);
    if (!owned) throw new NotFoundException('Document not found');
    return this.documents.downloadBytes(actor, documentId);
  }

  /**
   * The same document, as a short-lived signed link
   * (`tenancy-and-security.md` §5). A customer forwarding a delivery note
   * to their own accountant, or a page embedding the PDF in an iframe,
   * cannot carry the portal's bearer token; this gives them something
   * that expires instead of asking them to share a session.
   *
   * The claims carry `customerId`, so even if the link leaks it can only
   * ever release a document that still belongs to this customer -- the
   * consumer re-checks, rather than trusting the claim.
   */
  async documentDownloadLink(actor: AuthenticatedUser, documentId: string) {
    const customerId = this.customerOf(actor);
    const [owned] = await withPortalTenant(this.sql, actor.tenantId, customerId, (tx) => tx`
      select 1 from documents where id = ${documentId} and tenant_id = ${actor.tenantId} and customer_id = ${customerId}
    `);
    if (!owned) throw new NotFoundException('Document not found');
    const { token, path, expiresAt } = this.links.sign({ documentId, tenantId: actor.tenantId, customerId });
    return { url: path, token, expiresAt, expiresInSeconds: this.links.ttlSeconds };
  }

  async goodsReceipts(actor: AuthenticatedUser, query: PortalListQuery) {
    const customerId = this.customerOf(actor);
    return withPortalTenant(this.sql, actor.tenantId, customerId, async (tx) => {
      const where = tx`
        where g.tenant_id = ${actor.tenantId} and g.customer_id = ${customerId} and g.status in ('approved', 'reversed')`;
      const rows = await tx<Record<string, any>[]>`
        select g.id, g.number, g.grn_date, g.status, w.code as warehouse_code, wr.number as warehouse_receipt_number,
               (select coalesce(sum(accepted_qty), 0) from grn_items gi where gi.grn_id = g.id)::text as accepted_qty
        from grns g join warehouses w on w.id = g.warehouse_id
        left join warehouse_receipts wr on wr.grn_id = g.id and wr.status = 'issued'
        ${where} order by g.grn_date desc, g.number desc limit ${query.limit} offset ${query.offset}
      `;
      const [{ count }] = await tx<{ count: string }[]>`select count(*)::text as count from grns g ${where}`;
      return {
        items: rows.map((r) => ({
          id: r.id, number: r.number, grnDate: r.grn_date, status: r.status, warehouseCode: r.warehouse_code,
          warehouseReceiptNumber: r.warehouse_receipt_number, acceptedQty: Number(r.accepted_qty),
        })),
        total: Number(count), limit: query.limit, offset: query.offset,
      };
    });
  }

  async dispatches(actor: AuthenticatedUser, query: PortalListQuery) {
    const customerId = this.customerOf(actor);
    return withPortalTenant(this.sql, actor.tenantId, customerId, async (tx) => {
      const where = tx`
        where d.tenant_id = ${actor.tenantId} and d.customer_id = ${customerId} and d.status in ('gate_out', 'completed')`;
      const rows = await tx<Record<string, any>[]>`
        select d.id, d.number, d.dispatch_date, d.status, d.consignee_name, d.vehicle_number, d.lr_number,
               pod.status as pod_status, pod.delivery_date, pod.receiver_name
        from dispatches d left join pods pod on pod.dispatch_id = d.id
        ${where} order by d.dispatch_date desc, d.number desc limit ${query.limit} offset ${query.offset}
      `;
      const [{ count }] = await tx<{ count: string }[]>`select count(*)::text as count from dispatches d ${where}`;
      return {
        items: rows.map((r) => ({
          id: r.id, number: r.number, dispatchDate: r.dispatch_date, status: r.status, consigneeName: r.consignee_name,
          vehicleNumber: r.vehicle_number, lrNumber: r.lr_number,
          delivery: r.pod_status ? { status: r.pod_status, deliveredOn: r.delivery_date, receivedBy: r.receiver_name } : null,
        })),
        total: Number(count), limit: query.limit, offset: query.offset,
      };
    });
  }

  /** §53's "pending releases": what the customer has asked for and where it has got to. */
  async releaseOrders(actor: AuthenticatedUser, query: PortalListQuery) {
    const customerId = this.customerOf(actor);
    return withPortalTenant(this.sql, actor.tenantId, customerId, async (tx) => {
      const where = tx`where ro.tenant_id = ${actor.tenantId} and ro.customer_id = ${customerId}`;
      const rows = await tx<Record<string, any>[]>`
        select ro.id, ro.number, ro.order_date, ro.requested_date, ro.status, ro.consignee_name, w.code as warehouse_code,
               (select coalesce(sum(requested_qty), 0) from release_order_lines l where l.release_order_id = ro.id)::text as requested_qty,
               (select coalesce(sum(dispatched_qty), 0) from release_order_lines l where l.release_order_id = ro.id)::text as dispatched_qty
        from release_orders ro join warehouses w on w.id = ro.warehouse_id
        ${where} order by ro.order_date desc, ro.number desc limit ${query.limit} offset ${query.offset}
      `;
      const [{ count }] = await tx<{ count: string }[]>`select count(*)::text as count from release_orders ro ${where}`;
      return {
        items: rows.map((r) => ({
          id: r.id, number: r.number, orderDate: r.order_date, requestedDate: r.requested_date, status: r.status,
          consigneeName: r.consignee_name, warehouseCode: r.warehouse_code,
          requestedQty: Number(r.requested_qty), dispatchedQty: Number(r.dispatched_qty),
        })),
        total: Number(count), limit: query.limit, offset: query.offset,
      };
    });
  }

  async invoices(actor: AuthenticatedUser, query: PortalListQuery) {
    const customerId = this.customerOf(actor);
    return withPortalTenant(this.sql, actor.tenantId, customerId, async (tx) => {
      // A draft or cancelled invoice is not the customer's business; only what was issued to them.
      const where = tx`
        where tenant_id = ${actor.tenantId} and customer_id = ${customerId}
          and status in ('issued', 'partially_paid', 'paid', 'overdue')`;
      const rows = await tx<Record<string, any>[]>`
        select id, number, invoice_date, due_date, status, subtotal, cgst_amount, sgst_amount, igst_amount,
               grand_total, amount_paid, balance_due
        from invoices ${where} order by invoice_date desc, number desc limit ${query.limit} offset ${query.offset}
      `;
      const [{ count }] = await tx<{ count: string }[]>`select count(*)::text as count from invoices ${where}`;
      return {
        items: rows.map((r) => ({
          id: r.id, number: r.number, invoiceDate: r.invoice_date, dueDate: r.due_date, status: r.status,
          subtotal: Number(r.subtotal), taxTotal: Number(r.cgst_amount) + Number(r.sgst_amount) + Number(r.igst_amount),
          grandTotal: Number(r.grand_total), amountPaid: Number(r.amount_paid), balanceDue: Number(r.balance_due),
        })),
        total: Number(count), limit: query.limit, offset: query.offset,
      };
    });
  }

  /** The same projection the staff endpoint serves, for this customer and no other. */
  statement(actor: AuthenticatedUser, query: { from?: string; to?: string }) {
    const customerId = this.customerOf(actor);
    return withPortalTenant(this.sql, actor.tenantId, customerId, (tx) => buildCustomerStatement(tx, actor.tenantId, customerId, query));
  }

  /**
   * The portal's one write (`permissions-matrix.md`: a Customer may
   * `create_return_request` "their own goods"). It is deliberately not a
   * call into `ReturnRequestsService`: that service takes a `customerId`
   * from its DTO, and a portal handler must not be able to pass one.
   */
  async requestReturn(actor: AuthenticatedUser, dto: { originalDispatchId: string; reason: string; lines: { productId: string; quantity: number }[] }, ipAddress?: string) {
    const customerId = this.customerOf(actor);
    const created = await withPortalTenant(this.sql, actor.tenantId, customerId, async (tx) => {
      const [dispatch] = await tx<{ id: string; warehouse_id: string; status: string }[]>`
        select id, warehouse_id, status from dispatches
        where id = ${dto.originalDispatchId} and tenant_id = ${actor.tenantId} and customer_id = ${customerId}
      `;
      if (!dispatch) throw new NotFoundException('Dispatch not found');
      if (!['gate_out', 'completed'].includes(dispatch.status)) {
        throw new BadRequestException('Those goods have not left the warehouse yet');
      }
      for (const line of dto.lines) {
        const [carried] = await tx<{ dispatched: string; claimed: string }[]>`
          select coalesce(sum(dl.quantity), 0)::text as dispatched,
                 coalesce((
                   select sum(rrl.quantity) from return_request_lines rrl join return_requests rr on rr.id = rrl.return_request_id
                   where rrl.tenant_id = ${actor.tenantId} and rr.original_dispatch_id = ${dispatch.id}
                     and rrl.product_id = ${line.productId} and rr.status not in ('rejected', 'cancelled')
                 ), 0)::text as claimed
          from dispatch_lines dl where dl.tenant_id = ${actor.tenantId} and dl.dispatch_id = ${dispatch.id} and dl.product_id = ${line.productId}
        `;
        const free = Number(carried.dispatched) - Number(carried.claimed);
        if (Number(carried.dispatched) === 0) throw new BadRequestException('That product was not on that dispatch');
        if (line.quantity > free) throw new BadRequestException(`Only ${free} of that product is available to return on this dispatch`);
      }
      // One series with the staff-raised requests, through the same row-locked
      // allocator (numbering.md §4) -- a portal request is the same document,
      // raised by a different person.
      const number = await this.numbering.allocateNumberIn(tx, actor.tenantId, 'RETURN_REQUEST', dispatch.warehouse_id);
      const [row] = await tx<{ id: string; number: string; status: string; request_date: string }[]>`
        insert into return_requests (id, tenant_id, number, request_date, customer_id, warehouse_id, original_dispatch_id, reason, created_by)
        values (gen_random_uuid(), ${actor.tenantId}, ${number}, current_date, ${customerId}, ${dispatch.warehouse_id},
                ${dispatch.id}, ${dto.reason}, ${actor.userId})
        returning id, number, status, request_date
      `;
      for (const line of dto.lines) {
        await tx`
          insert into return_request_lines (id, tenant_id, return_request_id, product_id, quantity)
          values (gen_random_uuid(), ${actor.tenantId}, ${row.id}, ${line.productId}, ${line.quantity})
        `;
      }
      // §56: a customer asking for something is the one event staff must not miss.
      const [customer] = await tx<{ name: string }[]>`select coalesce(legal_name, name) as name from customers where id = ${customerId}`;
      await this.notifications.emitWithin(tx, actor.tenantId, {
        ruleCode: 'customer_request_pending',
        title: `${customer.name} has requested a return (${row.number})`,
        body: dto.reason,
        entityType: 'return_request', entityId: row.id, severity: 'warning', warehouseId: dispatch.warehouse_id,
      });
      return row;
    });
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, userRoleCode: actor.roleCode, action: 'create',
      entityType: 'return_request', entityId: created.id,
      newValue: { number: created.number, raisedBy: 'customer_portal', customerId, originalDispatchId: dto.originalDispatchId, reason: dto.reason }, ipAddress,
    });
    return { id: created.id, number: created.number, status: created.status, requestDate: created.request_date };
  }
}
