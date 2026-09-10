import { Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { escapeHtml, formatDate, formatMoney, renderDocumentShell, renderLineItemTable, renderPartyBlock, renderTotalsBlock } from '../html/layout';
import { buildCustomerStatement } from '../../receivables/statements.service';
import { DocumentTemplate, DocumentTemplateData, RenderExtras } from '../document-template';

type Row = Record<string, any>;

async function loadNote(tx: postgres.TransactionSql, tenantId: string, sourceId: string, noteType: 'credit' | 'debit') {
  const [n] = await tx<Row[]>`
    select n.*, coalesce(c.legal_name, c.name) as customer_name, c.gstin as customer_gstin, i.number as invoice_number, i.invoice_date, i.grand_total as invoice_total
    from credit_debit_notes n join customers c on c.id = n.customer_id left join invoices i on i.id = n.invoice_id
    where n.id = ${sourceId} and n.tenant_id = ${tenantId} and n.note_type = ${noteType}
  `;
  if (!n) return null;
  const lines = await tx<Row[]>`
    select l.description, l.hsn_sac_code, l.quantity, l.rate, l.amount, tr.rate_pct, l.tax_amount, l.line_total
    from credit_debit_note_lines l left join tax_rates tr on tr.id = l.tax_rate_id
    where l.tenant_id = ${tenantId} and l.note_id = ${sourceId} order by l.id
  `;
  const snapshot = {
    number: n.number, noteType: n.note_type, noteDate: n.note_date, status: n.status, reason: n.reason,
    customerName: n.customer_name, customerGstin: n.customer_gstin, invoiceNumber: n.invoice_number, invoiceDate: n.invoice_date,
    invoiceTotal: n.invoice_total === null ? null : Number(n.invoice_total),
    subtotal: Number(n.subtotal), taxTotal: Number(n.tax_total), grandTotal: Number(n.grand_total),
    lines: lines.map((l) => ({
      description: l.description, sac: l.hsn_sac_code, quantity: Number(l.quantity), rate: Number(l.rate),
      amount: Number(l.amount), taxPct: l.rate_pct === null ? 0 : Number(l.rate_pct), tax: Number(l.tax_amount), total: Number(l.line_total),
    })),
  };
  return { documentNumber: n.number, customerId: n.customer_id, warehouseId: null, statusAtGeneration: n.status, snapshot };
}

function renderNote(data: DocumentTemplateData, extras: RenderExtras, title: string, direction: string): string {
  const s = data.snapshot as Row;
  const party = renderPartyBlock(direction, [
    s.customerName, s.customerGstin ? `GSTIN: ${s.customerGstin}` : null,
    s.invoiceNumber ? `Against Invoice: ${s.invoiceNumber} of ${formatDate(s.invoiceDate)} (${formatMoney(s.invoiceTotal)})` : 'Not against a specific invoice',
    `Status: ${s.status}`,
  ]);
  const reason = `<div class="body-section"><div class="body-section-title">Reason</div>${escapeHtml(s.reason)}</div>`;
  const table = renderLineItemTable(['Description', 'SAC', 'Qty', 'Rate', 'Amount', 'GST %', 'Tax', 'Total'],
    s.lines.map((l: Row) => [l.description, l.sac ?? '-', l.quantity, formatMoney(l.rate), formatMoney(l.amount), `${l.taxPct}%`, formatMoney(l.tax), formatMoney(l.total)]));
  const totals = renderTotalsBlock([
    { label: 'Subtotal', value: formatMoney(s.subtotal) },
    { label: 'Tax', value: formatMoney(s.taxTotal) },
    { label: title === 'Credit Note' ? 'Total credited' : 'Total charged', value: formatMoney(s.grandTotal), emphasize: true },
  ]);
  return renderDocumentShell({ title, documentNumber: s.number, dateLabel: 'Date', date: formatDate(s.noteDate), company: extras.company, bodyHtml: `${party}${reason}${table}${totals}`, qrDataUri: extras.qrDataUri, qrToken: extras.qrToken });
}

/** Blueprint §41: money coming off what the customer owes. */
@Injectable()
export class CreditNoteDocumentTemplate implements DocumentTemplate {
  documentType = 'credit_note';
  featureCode = 'CREDIT_NOTE';
  loadData(tx: postgres.TransactionSql, tenantId: string, sourceId: string) {
    return loadNote(tx, tenantId, sourceId, 'credit');
  }
  renderHtml(data: DocumentTemplateData, extras: RenderExtras) {
    return renderNote(data, extras, 'Credit Note', 'Credited To');
  }
}

/** Blueprint §41: money going on to what the customer owes. */
@Injectable()
export class DebitNoteDocumentTemplate implements DocumentTemplate {
  documentType = 'debit_note';
  featureCode = 'DEBIT_NOTE';
  loadData(tx: postgres.TransactionSql, tenantId: string, sourceId: string) {
    return loadNote(tx, tenantId, sourceId, 'debit');
  }
  renderHtml(data: DocumentTemplateData, extras: RenderExtras) {
    return renderNote(data, extras, 'Debit Note', 'Debited To');
  }
}

/** Blueprint §42's Payment Receipt: what arrived, and which invoices it was put against. */
@Injectable()
export class PaymentReceiptDocumentTemplate implements DocumentTemplate {
  documentType = 'payment_receipt';
  featureCode = 'PAYMENT_RECEIPT';

  async loadData(tx: postgres.TransactionSql, tenantId: string, sourceId: string): Promise<DocumentTemplateData | null> {
    const [r] = await tx<Row[]>`
      select r.*, coalesce(c.legal_name, c.name) as customer_name, c.gstin as customer_gstin
      from payment_receipts r join customers c on c.id = r.customer_id where r.id = ${sourceId} and r.tenant_id = ${tenantId}
    `;
    if (!r) return null;
    const allocations = await tx<Row[]>`
      select i.number, i.invoice_date, i.grand_total, pa.amount, i.balance_due
      from payment_allocations pa join invoices i on i.id = pa.invoice_id
      where pa.tenant_id = ${tenantId} and pa.receipt_id = ${sourceId} order by i.invoice_date, i.number
    `;
    const allocated = allocations.reduce((s, a) => s + Number(a.amount), 0);
    const snapshot = {
      number: r.number, paymentDate: r.payment_date, amount: Number(r.amount), paymentMode: r.payment_mode,
      referenceNumber: r.reference_number, remarks: r.remarks, status: r.status, customerName: r.customer_name, customerGstin: r.customer_gstin,
      allocatedAmount: Math.round(allocated * 100) / 100, unallocatedAmount: Math.round((Number(r.amount) - allocated) * 100) / 100,
      allocations: allocations.map((a) => ({
        number: a.number, invoiceDate: a.invoice_date, invoiceTotal: Number(a.grand_total), amount: Number(a.amount), balanceDue: Number(a.balance_due),
      })),
    };
    return { documentNumber: r.number, customerId: r.customer_id, warehouseId: null, statusAtGeneration: r.status, snapshot };
  }

  renderHtml(data: DocumentTemplateData, extras: RenderExtras): string {
    const s = data.snapshot as Row;
    const party = renderPartyBlock('Received With Thanks From', [
      s.customerName, s.customerGstin ? `GSTIN: ${s.customerGstin}` : null,
      `Mode: ${s.paymentMode.toUpperCase()}${s.referenceNumber ? ` · Ref ${s.referenceNumber}` : ''}`,
      s.status === 'cancelled' ? 'THIS RECEIPT HAS BEEN CANCELLED' : null,
    ]);
    const table = s.allocations.length
      ? renderLineItemTable(['Invoice', 'Date', 'Invoice Total', 'Applied', 'Balance Due'],
          s.allocations.map((a: Row) => [a.number, formatDate(a.invoiceDate), formatMoney(a.invoiceTotal), formatMoney(a.amount), formatMoney(a.balanceDue)]))
      : `<div class="body-section">Held on account — not yet applied to any invoice.</div>`;
    const totals = renderTotalsBlock([
      { label: 'Amount received', value: formatMoney(s.amount), emphasize: true },
      { label: 'Applied to invoices', value: formatMoney(s.allocatedAmount) },
      { label: 'On account', value: formatMoney(s.unallocatedAmount) },
    ]);
    const remarks = s.remarks ? `<div class="body-section"><div class="body-section-title">Remarks</div>${escapeHtml(s.remarks)}</div>` : '';
    return renderDocumentShell({ title: 'Payment Receipt', documentNumber: s.number, dateLabel: 'Date', date: formatDate(s.paymentDate), company: extras.company, bodyHtml: `${party}${table}${totals}${remarks}`, qrDataUri: extras.qrDataUri, qrToken: extras.qrToken });
  }
}

/**
 * Blueprint §43's Customer Statement. Keyed on the customer, like the Stock
 * Statement (§26): each issue is a fresh reading of an account that keeps
 * moving, so reissuing is a new version of the same document rather than a
 * new document.
 */
@Injectable()
export class CustomerStatementDocumentTemplate implements DocumentTemplate {
  documentType = 'customer_statement';
  featureCode = 'CUSTOMER_STATEMENT';

  async loadData(tx: postgres.TransactionSql, tenantId: string, sourceId: string): Promise<DocumentTemplateData | null> {
    const statement = await buildCustomerStatement(tx, tenantId, sourceId, {});
    const today = new Date().toISOString().slice(0, 10);
    return {
      documentNumber: `CS/${statement.customer.code}/${today}`,
      customerId: sourceId,
      warehouseId: null,
      statusAtGeneration: 'issued',
      snapshot: { ...statement, generatedOn: today } as unknown as Record<string, unknown>,
    };
  }

  renderHtml(data: DocumentTemplateData, extras: RenderExtras): string {
    const s = data.snapshot as Row;
    const party = renderPartyBlock('Statement Of Account', [
      s.customer.legalName ?? s.customer.name, `Customer code: ${s.customer.code}`,
      s.customer.gstin ? `GSTIN: ${s.customer.gstin}` : null,
      s.customer.paymentTerms ? `Terms: ${s.customer.paymentTerms}` : `Credit days: ${s.customer.creditDays}`,
      `Period: ${s.from ? formatDate(s.from) : 'from the beginning'} to ${s.to ? formatDate(s.to) : formatDate(s.generatedOn)}`,
    ]);
    const table = renderLineItemTable(['Date', 'Document', 'Reference', 'Particulars', 'Debit', 'Credit', 'Balance'],
      s.entries.length
        ? s.entries.map((e: Row) => [
            formatDate(e.date), e.number, e.reference ?? '-', e.description,
            e.debit ? formatMoney(e.debit) : '-', e.credit ? formatMoney(e.credit) : '-', formatMoney(e.balance),
          ])
        : [['-', '-', '-', 'No activity in this period', '-', '-', formatMoney(s.openingBalance)]]);
    const totals = renderTotalsBlock([
      { label: 'Opening balance', value: formatMoney(s.openingBalance) },
      { label: 'Invoiced', value: formatMoney(s.totals.invoiced) },
      { label: 'Debit notes', value: formatMoney(s.totals.debitNotes) },
      { label: 'Credit notes', value: formatMoney(s.totals.creditNotes) },
      { label: 'Payments received', value: formatMoney(s.totals.received) },
      { label: 'Closing balance', value: formatMoney(s.closingBalance), emphasize: true },
    ]);
    const ageing = renderLineItemTable(['Not due', '1-30 days', '31-60 days', '61-90 days', 'Over 90 days'],
      [[formatMoney(s.ageing.notDue), formatMoney(s.ageing.upTo30), formatMoney(s.ageing.upTo60), formatMoney(s.ageing.upTo90), formatMoney(s.ageing.over90)]]);
    const ageingBlock = `<div class="body-section"><div class="body-section-title">Outstanding by age</div></div>${ageing}`;
    return renderDocumentShell({ title: 'Customer Statement', documentNumber: s.customer.code, dateLabel: 'Statement Date', date: formatDate(s.generatedOn), company: extras.company, bodyHtml: `${party}${table}${totals}${ageingBlock}`, qrDataUri: extras.qrDataUri, qrToken: extras.qrToken });
  }
}
