import { Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { escapeHtml, formatDate, formatMoney, renderDocumentShell, renderLineItemTable, renderPartyBlock, renderTotalsBlock } from '../html/layout';
import { DocumentTemplate, DocumentTemplateData, RenderExtras } from '../document-template';

type Row = Record<string, any>;

const addressLines = (a: Row | null | undefined) =>
  a ? [a.address_line1, a.address_line2, [a.city, a.state, a.pincode].filter(Boolean).join(' ')].filter(Boolean) : [];

/** Blueprint §40's Tax Invoice: the frozen party snapshots, the lines, and the GST split the invoice decided at creation. */
@Injectable()
export class InvoiceDocumentTemplate implements DocumentTemplate {
  documentType = 'invoice';
  featureCode = 'INVOICE_GENERATION';

  async loadData(tx: postgres.TransactionSql, tenantId: string, sourceId: string): Promise<DocumentTemplateData | null> {
    const [inv] = await tx<Row[]>`select * from invoices where id = ${sourceId} and tenant_id = ${tenantId}`;
    if (!inv) return null;
    const lines = await tx<Row[]>`
      select il.line_no, il.description, il.hsn_sac_code, il.quantity, il.uom_code, il.rate, il.amount, il.tax_rate_pct, il.cgst_amount, il.sgst_amount, il.igst_amount, il.line_total
      from invoice_lines il where il.tenant_id = ${tenantId} and il.invoice_id = ${sourceId} order by il.line_no
    `;
    const snapshot = {
      number: inv.number, invoiceDate: inv.invoice_date, dueDate: inv.due_date, status: inv.status, taxTreatment: inv.tax_treatment,
      placeOfSupply: inv.place_of_supply, paymentTerms: inv.payment_terms, customer: inv.customer_snapshot, company: inv.company_snapshot,
      subtotal: Number(inv.subtotal), cgst: Number(inv.cgst_amount), sgst: Number(inv.sgst_amount), igst: Number(inv.igst_amount),
      roundOff: Number(inv.round_off), grandTotal: Number(inv.grand_total), amountPaid: Number(inv.amount_paid), balanceDue: Number(inv.balance_due),
      lines: lines.map((l) => ({
        lineNo: l.line_no, description: l.description, sac: l.hsn_sac_code, quantity: Number(l.quantity), uom: l.uom_code, rate: Number(l.rate),
        amount: Number(l.amount), taxPct: Number(l.tax_rate_pct), cgst: Number(l.cgst_amount), sgst: Number(l.sgst_amount), igst: Number(l.igst_amount), total: Number(l.line_total),
      })),
    };
    return { documentNumber: inv.number, customerId: inv.customer_id, warehouseId: null, statusAtGeneration: inv.status, snapshot };
  }

  renderHtml(data: DocumentTemplateData, extras: RenderExtras): string {
    const s = data.snapshot as Row;
    const c = s.customer as Row;
    const billTo = renderPartyBlock('Bill To', [
      c.legal_name ?? c.name, ...addressLines(c.billing_address), c.gstin ? `GSTIN: ${c.gstin}` : null, c.pan ? `PAN: ${c.pan}` : null,
      `Place of supply: ${s.placeOfSupply ?? '-'}`, c.period_start ? `Period: ${formatDate(c.period_start)} to ${formatDate(c.period_end)}` : null,
    ]);
    const terms = renderPartyBlock('Terms', [
      `Due date: ${s.dueDate ? formatDate(s.dueDate) : '-'}`, s.paymentTerms ? `Payment terms: ${s.paymentTerms}` : null,
      `Tax: ${s.taxTreatment === 'intra_state' ? 'CGST + SGST' : s.taxTreatment === 'inter_state' ? 'IGST' : s.taxTreatment}`, `Status: ${s.status}`,
    ]);
    const intra = s.taxTreatment === 'intra_state';
    const table = renderLineItemTable(
      ['#', 'Description', 'SAC', 'Qty', 'Basis', 'Rate', 'Amount', 'GST %', ...(intra ? ['CGST', 'SGST'] : ['IGST']), 'Total'],
      s.lines.map((l: Row) => [
        l.lineNo, l.description, l.sac ?? '-', l.quantity, l.uom ?? '-', formatMoney(l.rate), formatMoney(l.amount), `${l.taxPct}%`,
        ...(intra ? [formatMoney(l.cgst), formatMoney(l.sgst)] : [formatMoney(l.igst)]), formatMoney(l.total),
      ]),
    );
    const totals = renderTotalsBlock([
      { label: 'Subtotal', value: formatMoney(s.subtotal) },
      ...(intra ? [{ label: 'CGST', value: formatMoney(s.cgst) }, { label: 'SGST', value: formatMoney(s.sgst) }] : [{ label: 'IGST', value: formatMoney(s.igst) }]),
      { label: 'Round off', value: formatMoney(s.roundOff) },
      { label: 'Grand Total', value: formatMoney(s.grandTotal), emphasize: true },
      ...(s.amountPaid > 0 ? [{ label: 'Paid', value: formatMoney(s.amountPaid) }, { label: 'Balance due', value: formatMoney(s.balanceDue), emphasize: true }] : []),
    ]);
    const co = s.company as Row;
    const bank = co.bank_account_no
      ? `<div class="body-section"><div class="body-section-title">Bank Details</div>${escapeHtml([co.bank_name, `A/c ${co.bank_account_no}`, co.bank_ifsc ? `IFSC ${co.bank_ifsc}` : null, co.bank_branch].filter(Boolean).join(' · '))}</div>`
      : '';
    const tnc = co.terms_and_conditions ? `<div class="body-section"><div class="body-section-title">Terms &amp; Conditions</div>${escapeHtml(co.terms_and_conditions)}</div>` : '';
    return renderDocumentShell({ title: 'Tax Invoice', documentNumber: s.number, dateLabel: 'Invoice Date', date: formatDate(s.invoiceDate), company: extras.company, bodyHtml: `${billTo}${terms}${table}${totals}${bank}${tnc}`, qrDataUri: extras.qrDataUri, qrToken: extras.qrToken });
  }
}
