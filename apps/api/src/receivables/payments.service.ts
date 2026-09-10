import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { NumberingService } from '../numbering/numbering.service';
import { AllocatePaymentDto, CreatePaymentDto, ListPaymentsQuery, PaymentAllocationDto } from './dto/receivables.dtos';

interface ReceiptRow {
  id: string;
  number: string;
  customer_id: string;
  customer_name?: string;
  payment_date: string;
  amount: string;
  payment_mode: string;
  reference_number: string | null;
  remarks: string | null;
  status: string;
  created_at: string;
}

interface AllocationRow {
  id: string;
  invoice_id: string;
  invoice_number?: string;
  invoice_grand_total?: string;
  invoice_status?: string;
  amount: string;
}

const SELECT = `
  r.id, r.number, r.customer_id, coalesce(c.legal_name, c.name) as customer_name, r.payment_date, r.amount, r.payment_mode,
  r.reference_number, r.remarks, r.status, r.created_at`;
const FROM = `payment_receipts r join customers c on c.id = r.customer_id`;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function receiptToApi(row: ReceiptRow, allocations?: AllocationRow[]) {
  const allocated = allocations ? round2(allocations.reduce((s, a) => s + Number(a.amount), 0)) : undefined;
  return {
    id: row.id,
    number: row.number,
    customerId: row.customer_id,
    customerName: row.customer_name,
    paymentDate: row.payment_date,
    amount: Number(row.amount),
    paymentMode: row.payment_mode,
    referenceNumber: row.reference_number,
    remarks: row.remarks,
    status: row.status,
    createdAt: row.created_at,
    ...(allocations && {
      allocatedAmount: allocated,
      unallocatedAmount: round2(Number(row.amount) - (allocated ?? 0)),
      allocations: allocations.map((a) => ({
        id: a.id,
        invoiceId: a.invoice_id,
        invoiceNumber: a.invoice_number,
        invoiceStatus: a.invoice_status,
        amount: Number(a.amount),
      })),
    }),
  };
}

/**
 * Blueprint §42's Payment Receipt, and billing-engine.md §7's two rules
 * about it.
 *
 * **One click, one receipt.** The client supplies an idempotency token;
 * `schema/97_payment_idempotency.sql`'s unique index is what actually
 * enforces it, so a retried request loses the race in the database rather
 * than in a check that another request could slip past. The retry gets
 * back the receipt that was recorded, not an error and not a second one.
 *
 * **`invoices.amount_paid` is recomputed, never incremented.** After every
 * allocation or reversal it is set to `sum(payment_allocations)` over that
 * invoice's live receipts, so a duplicate or reversed allocation cannot
 * silently under-reduce outstanding (§79 "invoice payment correctly reduces
 * outstanding"). `balance_due` is a generated column, and the invoice's own
 * status follows the same figure: `issued` → `partially_paid` → `paid`.
 */
@Injectable()
export class PaymentsService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
  ) {}

  async create(actor: AuthenticatedUser, dto: CreatePaymentDto, ipAddress?: string) {
    const outcome = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const [existing] = await tx<{ id: string }[]>`
        select id from payment_receipts where tenant_id = ${actor.tenantId} and idempotency_key = ${dto.idempotencyKey}
      `;
      if (existing) return { replayed: true, ...(await this.fetchWithAllocations(tx, actor.tenantId, existing.id))! };
      const [customer] = await tx`select 1 from customers where id = ${dto.customerId} and tenant_id = ${actor.tenantId}`;
      if (!customer) throw new NotFoundException('Customer not found');

      const number = await this.numbering.allocateNumberIn(tx, actor.tenantId, 'PAYMENT_RECEIPT');
      const id = randomUUID();
      await tx`
        insert into payment_receipts (id, tenant_id, number, customer_id, payment_date, amount, payment_mode, reference_number, remarks, idempotency_key, created_by)
        values (${id}, ${actor.tenantId}, ${number}, ${dto.customerId}, ${dto.paymentDate ?? new Date().toISOString().slice(0, 10)}, ${dto.amount},
                ${dto.paymentMode}, ${dto.referenceNumber ?? null}, ${dto.remarks ?? null}, ${dto.idempotencyKey}, ${actor.userId})
      `;
      if (dto.allocations?.length) await this.applyAllocations(tx, actor, id, dto.customerId, Number(dto.amount), dto.allocations);
      return { replayed: false, ...(await this.fetchWithAllocations(tx, actor.tenantId, id))! };
    });
    if (!outcome.replayed) {
      await this.audit.record({
        tenantId: actor.tenantId, userId: actor.userId, userRoleCode: actor.roleCode, action: 'create',
        entityType: 'payment_receipt', entityId: outcome.row.id,
        newValue: { number: outcome.row.number, amount: outcome.row.amount, paymentMode: dto.paymentMode, allocations: dto.allocations?.length ?? 0 }, ipAddress,
      });
    }
    return { ...receiptToApi(outcome.row, outcome.allocations), replayed: outcome.replayed };
  }

  /** Allocations are absolute: what is passed replaces what the receipt held, and every touched invoice is recomputed. */
  private async applyAllocations(
    tx: postgres.TransactionSql,
    actor: AuthenticatedUser,
    receiptId: string,
    customerId: string,
    receiptAmount: number,
    allocations: PaymentAllocationDto[],
  ) {
    const previous = await tx<{ invoice_id: string }[]>`select invoice_id from payment_allocations where tenant_id = ${actor.tenantId} and receipt_id = ${receiptId}`;
    const touched = new Set(previous.map((p) => p.invoice_id));

    const total = round2(allocations.reduce((s, a) => s + a.amount, 0));
    if (total > receiptAmount) {
      throw new BadRequestException(`Allocations total ${total} but the receipt is only ${receiptAmount}`);
    }
    const seen = new Set<string>();
    for (const a of allocations) {
      if (seen.has(a.invoiceId)) throw new BadRequestException('An invoice may appear only once in one receipt\'s allocations');
      seen.add(a.invoiceId);
      const [invoice] = await tx<{ id: string; number: string; customer_id: string; status: string; grand_total: string; amount_paid: string }[]>`
        select id, number, customer_id, status, grand_total, amount_paid from invoices where id = ${a.invoiceId} and tenant_id = ${actor.tenantId} for update
      `;
      if (!invoice) throw new NotFoundException(`Invoice ${a.invoiceId} not found`);
      if (invoice.customer_id !== customerId) throw new BadRequestException(`Invoice ${invoice.number} belongs to a different customer`);
      if (!['issued', 'partially_paid', 'overdue', 'paid'].includes(invoice.status)) {
        throw new BadRequestException(`Invoice ${invoice.number} is '${invoice.status}' -- only an issued invoice can be paid`);
      }
      // What everyone *else* has already put against this invoice; this receipt's own share is being replaced.
      const [{ others }] = await tx<{ others: string }[]>`
        select coalesce(sum(pa.amount), 0)::text as others from payment_allocations pa join payment_receipts pr on pr.id = pa.receipt_id
        where pa.tenant_id = ${actor.tenantId} and pa.invoice_id = ${a.invoiceId} and pa.receipt_id <> ${receiptId} and pr.status = 'posted'
      `;
      if (round2(Number(others) + a.amount) > Number(invoice.grand_total)) {
        throw new BadRequestException(
          `Invoice ${invoice.number}: ${a.amount} would over-pay it (${invoice.grand_total} due, ${Number(others)} already allocated)`,
        );
      }
      touched.add(a.invoiceId);
    }

    await tx`delete from payment_allocations where tenant_id = ${actor.tenantId} and receipt_id = ${receiptId}`;
    for (const a of allocations) {
      await tx`
        insert into payment_allocations (id, tenant_id, receipt_id, invoice_id, amount)
        values (${randomUUID()}, ${actor.tenantId}, ${receiptId}, ${a.invoiceId}, ${a.amount})
      `;
    }
    for (const invoiceId of touched) await this.recomputeInvoice(tx, actor.tenantId, invoiceId);
  }

  /** The single place `invoices.amount_paid` is written, and it is always a fresh sum. */
  private async recomputeInvoice(tx: postgres.TransactionSql, tenantId: string, invoiceId: string) {
    const [row] = await tx<{ paid: string; grand_total: string; status: string; due_date: string | null }[]>`
      select coalesce((
        select sum(pa.amount) from payment_allocations pa join payment_receipts pr on pr.id = pa.receipt_id
        where pa.tenant_id = ${tenantId} and pa.invoice_id = ${invoiceId} and pr.status = 'posted'
      ), 0)::text as paid, i.grand_total, i.status, i.due_date
      from invoices i where i.id = ${invoiceId} and i.tenant_id = ${tenantId}
    `;
    const paid = Number(row.paid);
    const total = Number(row.grand_total);
    let status = row.status;
    if (['issued', 'partially_paid', 'paid', 'overdue'].includes(row.status)) {
      if (paid <= 0) status = row.due_date !== null && row.due_date < new Date().toISOString().slice(0, 10) ? 'overdue' : 'issued';
      else if (paid >= total) status = 'paid';
      else status = row.due_date !== null && row.due_date < new Date().toISOString().slice(0, 10) ? 'overdue' : 'partially_paid';
    }
    await tx`update invoices set amount_paid = ${paid}, status = ${status}, updated_at = now() where id = ${invoiceId} and tenant_id = ${tenantId}`;
  }

  async allocate(actor: AuthenticatedUser, id: string, dto: AllocatePaymentDto, ipAddress?: string) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const [receipt] = await tx<{ id: string; customer_id: string; amount: string; status: string }[]>`
        select id, customer_id, amount, status from payment_receipts where id = ${id} and tenant_id = ${actor.tenantId} for update
      `;
      if (!receipt) return null;
      if (receipt.status !== 'posted') throw new BadRequestException('This receipt is cancelled');
      await this.applyAllocations(tx, actor, id, receipt.customer_id, Number(receipt.amount), dto.allocations);
      return (await this.fetchWithAllocations(tx, actor.tenantId, id))!;
    });
    if (!result) throw new NotFoundException('Payment receipt not found');
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, userRoleCode: actor.roleCode, action: 'update',
      entityType: 'payment_receipt', entityId: id, newValue: { allocations: dto.allocations }, ipAddress,
    });
    return receiptToApi(result.row, result.allocations);
  }

  /** Reversing a receipt drops its allocations and recomputes every invoice they touched. */
  async cancel(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const [receipt] = await tx<{ status: string }[]>`select status from payment_receipts where id = ${id} and tenant_id = ${actor.tenantId} for update`;
      if (!receipt) return null;
      if (receipt.status !== 'posted') throw new BadRequestException('This receipt is already cancelled');
      const touched = await tx<{ invoice_id: string }[]>`select invoice_id from payment_allocations where tenant_id = ${actor.tenantId} and receipt_id = ${id}`;
      await tx`update payment_receipts set status = 'cancelled' where id = ${id} and tenant_id = ${actor.tenantId}`;
      await tx`delete from payment_allocations where tenant_id = ${actor.tenantId} and receipt_id = ${id}`;
      for (const t of touched) await this.recomputeInvoice(tx, actor.tenantId, t.invoice_id);
      return (await this.fetchWithAllocations(tx, actor.tenantId, id))!;
    });
    if (!result) throw new NotFoundException('Payment receipt not found');
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, userRoleCode: actor.roleCode, action: 'status_change',
      entityType: 'payment_receipt', entityId: id, previousValue: { status: 'posted' }, newValue: { status: 'cancelled' }, ipAddress,
    });
    return receiptToApi(result.row, result.allocations);
  }

  async fetchWithAllocations(tx: postgres.TransactionSql, tenantId: string, id: string) {
    const [row] = await tx<ReceiptRow[]>`select ${tx.unsafe(SELECT)} from ${tx.unsafe(FROM)} where r.id = ${id} and r.tenant_id = ${tenantId}`;
    if (!row) return null;
    const allocations = await tx<AllocationRow[]>`
      select pa.id, pa.invoice_id, i.number as invoice_number, i.grand_total as invoice_grand_total, i.status as invoice_status, pa.amount
      from payment_allocations pa join invoices i on i.id = pa.invoice_id
      where pa.tenant_id = ${tenantId} and pa.receipt_id = ${id} order by i.invoice_date, i.number
    `;
    return { row, allocations };
  }

  async list(actor: AuthenticatedUser, query: ListPaymentsQuery) {
    const pattern = query.q ? `%${query.q}%` : null;
    const customerFilter = query.customerId ?? null;
    const statusFilter = query.status ?? null;
    const from = query.from ?? null;
    const to = query.to ?? null;
    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const where = tx`
        where r.tenant_id = ${actor.tenantId}
          and (${pattern}::text is null or r.number ilike ${pattern} or r.reference_number ilike ${pattern} or c.name ilike ${pattern})
          and (${customerFilter}::uuid is null or r.customer_id = ${customerFilter})
          and (${statusFilter}::text is null or r.status = ${statusFilter})
          and (${from}::date is null or r.payment_date >= ${from})
          and (${to}::date is null or r.payment_date <= ${to})`;
      const rows = await tx<ReceiptRow[]>`
        select ${tx.unsafe(SELECT)} from ${tx.unsafe(FROM)} ${where} order by r.payment_date desc, r.created_at desc limit ${query.limit} offset ${query.offset}
      `;
      const [{ count }] = await tx<{ count: string }[]>`select count(*)::text as count from ${tx.unsafe(FROM)} ${where}`;
      return { items: rows.map((r) => receiptToApi(r)), total: Number(count), limit: query.limit, offset: query.offset };
    });
  }

  async get(actor: AuthenticatedUser, id: string) {
    const fetched = await withTenant(this.sql, actor.tenantId, (tx) => this.fetchWithAllocations(tx, actor.tenantId, id));
    if (!fetched) throw new NotFoundException('Payment receipt not found');
    return receiptToApi(fetched.row, fetched.allocations);
  }
}
