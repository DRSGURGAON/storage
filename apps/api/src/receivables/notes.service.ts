import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { NumberingService } from '../numbering/numbering.service';
import { CreateNoteDto, ListNotesQuery } from './dto/receivables.dtos';

interface NoteRow {
  id: string;
  number: string;
  note_type: string;
  note_date: string;
  customer_id: string;
  customer_name?: string;
  invoice_id: string | null;
  invoice_number?: string | null;
  reason: string;
  subtotal: string;
  tax_total: string;
  grand_total: string;
  status: string;
  approved_at: string | null;
  created_at: string;
}

interface NoteLineRow {
  id: string;
  description: string;
  hsn_sac_code: string | null;
  quantity: string;
  rate: string;
  amount: string;
  tax_rate_id: string | null;
  tax_rate_pct?: string | null;
  tax_amount: string;
  line_total: string;
}

const SELECT = `
  n.id, n.number, n.note_type, n.note_date, n.customer_id, coalesce(c.legal_name, c.name) as customer_name, n.invoice_id,
  i.number as invoice_number, n.reason, n.subtotal, n.tax_total, n.grand_total, n.status, n.approved_at, n.created_at`;
const FROM = `credit_debit_notes n join customers c on c.id = n.customer_id left join invoices i on i.id = n.invoice_id`;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function noteToApi(row: NoteRow, lines?: NoteLineRow[]) {
  return {
    id: row.id,
    number: row.number,
    noteType: row.note_type,
    noteDate: row.note_date,
    customerId: row.customer_id,
    customerName: row.customer_name,
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_number ?? null,
    reason: row.reason,
    subtotal: Number(row.subtotal),
    taxTotal: Number(row.tax_total),
    grandTotal: Number(row.grand_total),
    status: row.status,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
    ...(lines && {
      lines: lines.map((l) => ({
        id: l.id,
        description: l.description,
        hsnSacCode: l.hsn_sac_code,
        quantity: Number(l.quantity),
        rate: Number(l.rate),
        amount: Number(l.amount),
        taxRateId: l.tax_rate_id,
        taxRatePct: l.tax_rate_pct === undefined || l.tax_rate_pct === null ? null : Number(l.tax_rate_pct),
        taxAmount: Number(l.tax_amount),
        lineTotal: Number(l.line_total),
      })),
    }),
  };
}

/**
 * Blueprint §41's Credit and Debit Notes: the *only* way to correct an
 * issued invoice. An invoice past `issued` is never edited and its billing
 * run is never re-run (billing-engine.md §5), so an over-charge becomes a
 * credit note and an under-charge a debit note, each its own numbered,
 * approved, auditable document referencing the original.
 *
 * A note does not touch `invoices.amount_paid` or `balance_due`. Those two
 * columns mean "how much cash has arrived against this invoice", and a
 * credit note is not cash. The customer's true outstanding is
 * invoices − credits + debits − payments, and that is what the statement
 * (§43) computes; putting the credit into `amount_paid` would make the
 * invoice claim it was paid when nobody paid it (`DECISIONS.md` §44).
 */
@Injectable()
export class NotesService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
  ) {}

  async create(actor: AuthenticatedUser, dto: CreateNoteDto, ipAddress?: string) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const [customer] = await tx`select 1 from customers where id = ${dto.customerId} and tenant_id = ${actor.tenantId}`;
      if (!customer) throw new NotFoundException('Customer not found');
      if (dto.invoiceId) {
        const [invoice] = await tx<{ customer_id: string; status: string; number: string }[]>`
          select customer_id, status, number from invoices where id = ${dto.invoiceId} and tenant_id = ${actor.tenantId}
        `;
        if (!invoice) throw new NotFoundException('Invoice not found');
        if (invoice.customer_id !== dto.customerId) throw new BadRequestException('That invoice belongs to a different customer');
        if (!['issued', 'partially_paid', 'paid', 'overdue'].includes(invoice.status)) {
          throw new BadRequestException(`Invoice ${invoice.number} is '${invoice.status}' -- correct it directly instead of raising a note against it`);
        }
      }
      const lines: { description: string; hsn: string | null; quantity: number; rate: number; amount: number; taxRateId: string | null; pct: number; tax: number; total: number }[] = [];
      for (const l of dto.lines) {
        let pct = 0;
        if (l.taxRateId) {
          const [t] = await tx<{ rate_pct: string }[]>`select rate_pct from tax_rates where id = ${l.taxRateId} and (tenant_id = ${actor.tenantId} or tenant_id is null)`;
          if (!t) throw new NotFoundException('Tax rate not found');
          pct = Number(t.rate_pct);
        }
        const amount = round2(l.quantity * l.rate);
        const tax = round2((amount * pct) / 100);
        lines.push({ description: l.description, hsn: l.hsnSacCode ?? null, quantity: l.quantity, rate: l.rate, amount, taxRateId: l.taxRateId ?? null, pct, tax, total: round2(amount + tax) });
      }
      const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
      const taxTotal = round2(lines.reduce((s, l) => s + l.tax, 0));

      // numbering.md keeps the debit note's prefix distinct from the dispatch note's.
      const number = await this.numbering.allocateNumberIn(tx, actor.tenantId, dto.noteType === 'credit' ? 'CREDIT_NOTE' : 'DEBIT_NOTE');
      const id = randomUUID();
      await tx`
        insert into credit_debit_notes (id, tenant_id, number, note_type, note_date, customer_id, invoice_id, reason, subtotal, tax_total, grand_total, created_by)
        values (${id}, ${actor.tenantId}, ${number}, ${dto.noteType}, ${dto.noteDate ?? new Date().toISOString().slice(0, 10)}, ${dto.customerId},
                ${dto.invoiceId ?? null}, ${dto.reason}, ${subtotal}, ${taxTotal}, ${round2(subtotal + taxTotal)}, ${actor.userId})
      `;
      for (const l of lines) {
        await tx`
          insert into credit_debit_note_lines (id, tenant_id, note_id, description, hsn_sac_code, quantity, rate, amount, tax_rate_id, tax_amount, line_total)
          values (${randomUUID()}, ${actor.tenantId}, ${id}, ${l.description}, ${l.hsn}, ${l.quantity}, ${l.rate}, ${l.amount}, ${l.taxRateId}, ${l.tax}, ${l.total})
        `;
      }
      return (await this.fetchWithLines(tx, actor.tenantId, id))!;
    });
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, userRoleCode: actor.roleCode, action: 'create',
      entityType: 'credit_debit_note', entityId: result.row.id,
      newValue: { number: result.row.number, noteType: result.row.note_type, invoiceId: dto.invoiceId ?? null, grandTotal: result.row.grand_total, reason: dto.reason }, ipAddress,
    });
    return noteToApi(result.row, result.lines);
  }

  async fetchWithLines(tx: postgres.TransactionSql, tenantId: string, id: string) {
    const [row] = await tx<NoteRow[]>`select ${tx.unsafe(SELECT)} from ${tx.unsafe(FROM)} where n.id = ${id} and n.tenant_id = ${tenantId}`;
    if (!row) return null;
    const lines = await tx<NoteLineRow[]>`
      select l.id, l.description, l.hsn_sac_code, l.quantity, l.rate, l.amount, l.tax_rate_id, tr.rate_pct as tax_rate_pct, l.tax_amount, l.line_total
      from credit_debit_note_lines l left join tax_rates tr on tr.id = l.tax_rate_id
      where l.tenant_id = ${tenantId} and l.note_id = ${id} order by l.id
    `;
    return { row, lines };
  }

  async list(actor: AuthenticatedUser, query: ListNotesQuery) {
    const pattern = query.q ? `%${query.q}%` : null;
    const customerFilter = query.customerId ?? null;
    const invoiceFilter = query.invoiceId ?? null;
    const typeFilter = query.noteType ?? null;
    const statusFilter = query.status ?? null;
    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const where = tx`
        where n.tenant_id = ${actor.tenantId}
          and (${pattern}::text is null or n.number ilike ${pattern} or n.reason ilike ${pattern} or i.number ilike ${pattern})
          and (${customerFilter}::uuid is null or n.customer_id = ${customerFilter})
          and (${invoiceFilter}::uuid is null or n.invoice_id = ${invoiceFilter})
          and (${typeFilter}::text is null or n.note_type = ${typeFilter})
          and (${statusFilter}::text is null or n.status = ${statusFilter})`;
      const rows = await tx<NoteRow[]>`
        select ${tx.unsafe(SELECT)} from ${tx.unsafe(FROM)} ${where} order by n.note_date desc, n.created_at desc limit ${query.limit} offset ${query.offset}
      `;
      const [{ count }] = await tx<{ count: string }[]>`select count(*)::text as count from ${tx.unsafe(FROM)} ${where}`;
      return { items: rows.map((r) => noteToApi(r)), total: Number(count), limit: query.limit, offset: query.offset };
    });
  }

  async get(actor: AuthenticatedUser, id: string) {
    const fetched = await withTenant(this.sql, actor.tenantId, (tx) => this.fetchWithLines(tx, actor.tenantId, id));
    if (!fetched) throw new NotFoundException('Note not found');
    return noteToApi(fetched.row, fetched.lines);
  }

  private async transition(actor: AuthenticatedUser, id: string, ipAddress: string | undefined, allowedFrom: string[], to: string) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const [before] = await tx<NoteRow[]>`select ${tx.unsafe(SELECT)} from ${tx.unsafe(FROM)} where n.id = ${id} and n.tenant_id = ${actor.tenantId} for update of n`;
      if (!before) return null;
      if (!allowedFrom.includes(before.status)) {
        throw new BadRequestException(`Cannot transition a ${before.note_type} note from '${before.status}' (expected one of: ${allowedFrom.join(', ')})`);
      }
      if (to === 'approved') {
        await tx`update credit_debit_notes set status = 'approved', approved_at = now(), approved_by = ${actor.userId} where id = ${id} and tenant_id = ${actor.tenantId}`;
      } else {
        await tx`update credit_debit_notes set status = ${to} where id = ${id} and tenant_id = ${actor.tenantId}`;
      }
      return { before, after: (await this.fetchWithLines(tx, actor.tenantId, id))! };
    });
    if (!result) throw new NotFoundException('Note not found');
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, userRoleCode: actor.roleCode, action: 'status_change',
      entityType: 'credit_debit_note', entityId: id, previousValue: { status: result.before.status }, newValue: { status: to }, ipAddress,
    });
    return noteToApi(result.after.row, result.after.lines);
  }

  submit(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['draft'], 'pending_approval');
  }
  approve(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['pending_approval'], 'approved');
  }
  /** Issued is when it reaches the customer's account: the statement counts it from here. */
  issue(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['approved'], 'issued');
  }
  cancel(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['draft', 'pending_approval', 'approved'], 'cancelled');
  }
}
