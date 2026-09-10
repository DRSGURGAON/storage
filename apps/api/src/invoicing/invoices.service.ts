import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { NumberingService } from '../numbering/numbering.service';
import { CreateInvoiceDto, ListInvoicesQuery } from './dto/invoicing.dtos';

export interface InvoiceRow {
  id: string;
  number: string;
  invoice_date: string;
  customer_id: string;
  billing_run_id: string | null;
  customer_snapshot: Record<string, unknown>;
  company_snapshot: Record<string, unknown>;
  place_of_supply: string | null;
  tax_treatment: string;
  subtotal: string;
  cgst_amount: string;
  sgst_amount: string;
  igst_amount: string;
  round_off: string;
  grand_total: string;
  amount_paid: string;
  balance_due: string;
  payment_terms: string | null;
  due_date: string | null;
  status: string;
  approved_at: string | null;
  issued_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
}

export interface InvoiceLineRow {
  id: string;
  line_no: number;
  billing_run_line_id: string | null;
  charge_type_id: string;
  charge_type_code?: string;
  description: string;
  hsn_sac_code: string | null;
  quantity: string;
  uom_code: string | null;
  rate: string;
  amount: string;
  tax_rate_id: string | null;
  tax_rate_pct: string;
  cgst_amount: string;
  sgst_amount: string;
  igst_amount: string;
  line_total: string;
}

const SELECT = `
  id, number, invoice_date, customer_id, billing_run_id, customer_snapshot, company_snapshot, place_of_supply, tax_treatment, subtotal,
  cgst_amount, sgst_amount, igst_amount, round_off, grand_total, amount_paid, balance_due, payment_terms, due_date, status,
  approved_at, issued_at, cancelled_at, cancellation_reason, created_at`;

const money = (v: string) => Number(v);
const round2 = (n: number) => Math.round(n * 100) / 100;

export function invoiceToApi(row: InvoiceRow, lines?: InvoiceLineRow[]) {
  return {
    id: row.id,
    number: row.number,
    invoiceDate: row.invoice_date,
    customerId: row.customer_id,
    billingRunId: row.billing_run_id,
    customerSnapshot: row.customer_snapshot,
    companySnapshot: row.company_snapshot,
    placeOfSupply: row.place_of_supply,
    taxTreatment: row.tax_treatment,
    subtotal: money(row.subtotal),
    cgstAmount: money(row.cgst_amount),
    sgstAmount: money(row.sgst_amount),
    igstAmount: money(row.igst_amount),
    roundOff: money(row.round_off),
    grandTotal: money(row.grand_total),
    amountPaid: money(row.amount_paid),
    balanceDue: money(row.balance_due),
    paymentTerms: row.payment_terms,
    dueDate: row.due_date,
    status: row.status,
    approvedAt: row.approved_at,
    issuedAt: row.issued_at,
    cancelledAt: row.cancelled_at,
    cancellationReason: row.cancellation_reason,
    createdAt: row.created_at,
    ...(lines && {
      lines: lines.map((l) => ({
        id: l.id,
        lineNo: l.line_no,
        billingRunLineId: l.billing_run_line_id,
        chargeTypeId: l.charge_type_id,
        chargeTypeCode: l.charge_type_code,
        description: l.description,
        hsnSacCode: l.hsn_sac_code,
        quantity: Number(l.quantity),
        uomCode: l.uom_code,
        rate: Number(l.rate),
        amount: money(l.amount),
        taxRateId: l.tax_rate_id,
        taxRatePct: Number(l.tax_rate_pct),
        cgstAmount: money(l.cgst_amount),
        sgstAmount: money(l.sgst_amount),
        igstAmount: money(l.igst_amount),
        lineTotal: money(l.line_total),
      })),
    }),
  };
}

/**
 * Blueprint §40's Invoice, created only from a billing run (billing-engine.md
 * §1: every line traces to one). Party details are frozen into
 * `customer_snapshot` / `company_snapshot` at creation, and the GST
 * treatment is decided once, here, from the company's state code against
 * the customer's place of supply (§6): the same state splits the tax into
 * CGST + SGST, a different one charges IGST. Both are stored per line, so a
 * later change to either master cannot re-tax an invoice.
 *
 * "Prevent duplicate invoice posting" (§79): a billing run is invoiced at
 * most once -- the row lock on the run plus its `invoiced` status make a
 * second create for the same run fail rather than double-bill.
 */
@Injectable()
export class InvoicesService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
  ) {}

  async createFromRun(actor: AuthenticatedUser, dto: CreateInvoiceDto, ipAddress?: string) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const [run] = await tx<{ id: string; customer_id: string; status: string; invoice_id: string | null; calculation: { errors: string[] }; period_start: string; period_end: string }[]>`
        select id, customer_id, status, invoice_id, calculation, period_start, period_end from billing_runs where id = ${dto.billingRunId} and tenant_id = ${actor.tenantId} for update
      `;
      if (!run) throw new NotFoundException('Billing run not found');
      if (run.status !== 'previewed') {
        const [existing] = run.invoice_id ? await tx<{ number: string }[]>`select number from invoices where id = ${run.invoice_id}` : [undefined];
        throw new BadRequestException(`This billing run is '${run.status}'${existing ? ` (invoice ${existing.number})` : ''} -- it cannot be invoiced again`);
      }
      if (run.calculation.errors.length > 0) {
        throw new BadRequestException(`The billing run has ${run.calculation.errors.length} unresolved rate error(s); fix the rate cards and re-run it before invoicing`);
      }
      const runLines = await tx<{ id: string; charge_type_id: string; description: string; basis: string; quantity: string | null; rate: string; computed_amount: string; tax_rate_id: string | null; tax_rate_pct: string | null; sac_code: string | null }[]>`
        select brl.id, brl.charge_type_id, brl.description, brl.basis, brl.quantity, brl.rate, brl.computed_amount, brl.tax_rate_id, tr.rate_pct as tax_rate_pct, brl.sac_code
        from billing_run_lines brl left join tax_rates tr on tr.id = brl.tax_rate_id
        where brl.tenant_id = ${actor.tenantId} and brl.billing_run_id = ${run.id}
        order by case brl.source_type when 'stock_lot' then 0 when 'manual' then 2 else 1 end, brl.description
      `;
      if (runLines.length === 0) throw new BadRequestException('The billing run has no chargeable lines');

      const [company] = await tx<Record<string, any>[]>`
        select legal_name, trade_name, address_line1, address_line2, city, state, state_code, pincode, gstin, pan, cin, phone, email,
               bank_name, bank_account_no, bank_ifsc, bank_branch, signatory_name, signatory_designation, terms_and_conditions
        from tenants where id = ${actor.tenantId}
      `;
      if (!company.state_code) throw new BadRequestException('Set the company state code (PATCH /company) before invoicing -- GST treatment depends on it');
      const [customer] = await tx<Record<string, any>[]>`
        select c.code, c.name, c.legal_name, c.gstin, c.pan, c.state_code, c.place_of_supply, c.credit_days, c.payment_terms,
               (select row_to_json(a) from (
                  select address_line1, address_line2, city, state, state_code, pincode, gstin from customer_addresses
                  where tenant_id = ${actor.tenantId} and customer_id = c.id and kind = 'billing' order by is_default desc limit 1
                ) a) as billing_address
        from customers c where c.id = ${run.customer_id} and c.tenant_id = ${actor.tenantId}
      `;
      const placeOfSupply: string | null = customer.place_of_supply ?? customer.state_code ?? customer.billing_address?.state_code ?? null;
      if (!placeOfSupply) throw new BadRequestException('The customer has no place of supply or state code -- set one before invoicing');
      const taxTreatment = placeOfSupply === company.state_code ? 'intra_state' : 'inter_state';

      const invoiceDate = dto.invoiceDate ?? new Date().toISOString().slice(0, 10);
      const due = new Date(`${invoiceDate}T00:00:00Z`);
      due.setUTCDate(due.getUTCDate() + Number(customer.credit_days ?? 0));
      const dueDate = dto.dueDate ?? due.toISOString().slice(0, 10);

      const number = await this.numbering.allocateNumberIn(tx, actor.tenantId, 'INVOICE_GENERATION');
      const id = randomUUID();
      let subtotal = 0, cgst = 0, sgst = 0, igst = 0;
      const lineRows = runLines.map((l, i) => {
        const amount = round2(Number(l.computed_amount));
        const pct = Number(l.tax_rate_pct ?? 0);
        const tax = round2((amount * pct) / 100);
        const half = round2(tax / 2);
        const lineCgst = taxTreatment === 'intra_state' ? half : 0;
        const lineSgst = taxTreatment === 'intra_state' ? round2(tax - half) : 0;
        const lineIgst = taxTreatment === 'inter_state' ? tax : 0;
        subtotal += amount; cgst += lineCgst; sgst += lineSgst; igst += lineIgst;
        return { ...l, lineNo: i + 1, amount, pct, lineCgst, lineSgst, lineIgst, lineTotal: round2(amount + lineCgst + lineSgst + lineIgst) };
      });
      subtotal = round2(subtotal); cgst = round2(cgst); sgst = round2(sgst); igst = round2(igst);
      const exact = round2(subtotal + cgst + sgst + igst);
      const grandTotal = Math.round(exact);
      const roundOff = round2(grandTotal - exact);

      await tx`
        insert into invoices (id, tenant_id, number, invoice_date, customer_id, billing_run_id, customer_snapshot, company_snapshot, place_of_supply,
                              tax_treatment, subtotal, cgst_amount, sgst_amount, igst_amount, round_off, grand_total, payment_terms, due_date, created_by, updated_by)
        values (${id}, ${actor.tenantId}, ${number}, ${invoiceDate}, ${run.customer_id}, ${run.id},
                ${JSON.stringify({ ...customer, period_start: run.period_start, period_end: run.period_end })}::jsonb, ${JSON.stringify(company)}::jsonb,
                ${placeOfSupply}, ${taxTreatment}, ${subtotal}, ${cgst}, ${sgst}, ${igst}, ${roundOff}, ${grandTotal},
                ${dto.paymentTerms ?? customer.payment_terms ?? null}, ${dueDate}, ${actor.userId}, ${actor.userId})
      `;
      for (const l of lineRows) {
        await tx`
          insert into invoice_lines (id, tenant_id, invoice_id, line_no, billing_run_line_id, charge_type_id, description, hsn_sac_code, quantity, uom_code,
                                     rate, amount, tax_rate_id, tax_rate_pct, cgst_amount, sgst_amount, igst_amount, line_total)
          values (${randomUUID()}, ${actor.tenantId}, ${id}, ${l.lineNo}, ${l.id}, ${l.charge_type_id}, ${l.description}, ${l.sac_code},
                  ${l.quantity ?? 1}, ${l.basis}, ${l.rate}, ${l.amount}, ${l.tax_rate_id}, ${l.pct}, ${l.lineCgst}, ${l.lineSgst}, ${l.lineIgst}, ${l.lineTotal})
        `;
      }
      await tx`update billing_runs set status = 'invoiced', invoice_id = ${id} where id = ${run.id} and tenant_id = ${actor.tenantId}`;
      return (await this.fetchWithLines(tx, actor.tenantId, id))!;
    });
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, userRoleCode: actor.roleCode, action: 'create',
      entityType: 'invoice', entityId: result.row.id,
      newValue: { number: result.row.number, billingRunId: dto.billingRunId, grandTotal: result.row.grand_total, taxTreatment: result.row.tax_treatment }, ipAddress,
    });
    return invoiceToApi(result.row, result.lines);
  }

  async fetchWithLines(tx: postgres.TransactionSql, tenantId: string, id: string) {
    const [row] = await tx<InvoiceRow[]>`select ${tx.unsafe(SELECT)} from invoices where id = ${id} and tenant_id = ${tenantId}`;
    if (!row) return null;
    const lines = await tx<InvoiceLineRow[]>`
      select il.id, il.line_no, il.billing_run_line_id, il.charge_type_id, ct.code as charge_type_code, il.description, il.hsn_sac_code, il.quantity, il.uom_code,
             il.rate, il.amount, il.tax_rate_id, il.tax_rate_pct, il.cgst_amount, il.sgst_amount, il.igst_amount, il.line_total
      from invoice_lines il join charge_types ct on ct.id = il.charge_type_id
      where il.tenant_id = ${tenantId} and il.invoice_id = ${id} order by il.line_no
    `;
    return { row, lines };
  }

  async list(actor: AuthenticatedUser, query: ListInvoicesQuery) {
    const pattern = query.q ? `%${query.q}%` : null;
    const customerFilter = query.customerId ?? null;
    const statusFilter = query.status ?? null;
    const from = query.from ?? null;
    const to = query.to ?? null;
    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const where = tx`
        where tenant_id = ${actor.tenantId}
          and (${pattern}::text is null or number ilike ${pattern} or customer_snapshot->>'name' ilike ${pattern} or customer_snapshot->>'legal_name' ilike ${pattern})
          and (${customerFilter}::uuid is null or customer_id = ${customerFilter})
          and (${statusFilter}::text is null or status = ${statusFilter})
          and (${from}::date is null or invoice_date >= ${from})
          and (${to}::date is null or invoice_date <= ${to})`;
      const rows = await tx<InvoiceRow[]>`
        select ${tx.unsafe(SELECT)} from invoices ${where} order by invoice_date desc, created_at desc limit ${query.limit} offset ${query.offset}
      `;
      const [{ count }] = await tx<{ count: string }[]>`select count(*)::text as count from invoices ${where}`;
      return { items: rows.map((r) => invoiceToApi(r)), total: Number(count), limit: query.limit, offset: query.offset };
    });
  }

  async get(actor: AuthenticatedUser, id: string) {
    const fetched = await withTenant(this.sql, actor.tenantId, (tx) => this.fetchWithLines(tx, actor.tenantId, id));
    if (!fetched) throw new NotFoundException('Invoice not found');
    return invoiceToApi(fetched.row, fetched.lines);
  }

  private async transition(
    actor: AuthenticatedUser,
    id: string,
    ipAddress: string | undefined,
    allowedFrom: string[],
    apply: (tx: postgres.TransactionSql, before: InvoiceRow) => Promise<void | Record<string, unknown>>,
  ) {
    let extra: Record<string, unknown> = {};
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const [before] = await tx<InvoiceRow[]>`select ${tx.unsafe(SELECT)} from invoices where id = ${id} and tenant_id = ${actor.tenantId} for update`;
      if (!before) return null;
      if (!allowedFrom.includes(before.status)) {
        throw new BadRequestException(`Cannot transition an invoice from '${before.status}' (expected one of: ${allowedFrom.join(', ')})`);
      }
      extra = (await apply(tx, before)) ?? {};
      return { before, after: (await this.fetchWithLines(tx, actor.tenantId, id))! };
    });
    if (!result) throw new NotFoundException('Invoice not found');
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, userRoleCode: actor.roleCode, action: 'status_change',
      entityType: 'invoice', entityId: id, previousValue: { status: result.before.status }, newValue: { status: result.after.row.status, ...extra }, ipAddress,
    });
    return invoiceToApi(result.after.row, result.after.lines);
  }

  submit(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['draft'], async (tx) => {
      await tx`update invoices set status = 'pending_approval', updated_at = now(), updated_by = ${actor.userId} where id = ${id} and tenant_id = ${actor.tenantId}`;
    });
  }

  approve(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['pending_approval'], async (tx) => {
      await tx`
        update invoices set status = 'approved', approved_at = now(), approved_by = ${actor.userId}, updated_at = now(), updated_by = ${actor.userId}
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;
    });
  }

  /** Issued is the customer-facing state: from here only payments, notes and the overdue clock move it. */
  issue(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['approved'], async (tx) => {
      await tx`update invoices set status = 'issued', issued_at = now(), updated_at = now(), updated_by = ${actor.userId} where id = ${id} and tenant_id = ${actor.tenantId}`;
    });
  }

  /** Before issue only. Frees the billing run to be previewed and invoiced again. */
  cancel(actor: AuthenticatedUser, id: string, reason: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['draft', 'pending_approval', 'approved'], async (tx, before) => {
      await tx`
        update invoices set status = 'cancelled', cancelled_at = now(), cancelled_by = ${actor.userId}, cancellation_reason = ${reason}, updated_at = now(), updated_by = ${actor.userId}
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;
      if (before.billing_run_id) {
        await tx`update billing_runs set status = 'previewed', invoice_id = null where id = ${before.billing_run_id} and tenant_id = ${actor.tenantId}`;
      }
      return { reason };
    });
  }
}
