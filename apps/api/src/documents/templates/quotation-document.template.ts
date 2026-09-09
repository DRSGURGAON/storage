import { Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import {
  escapeHtml,
  formatDate,
  formatMoney,
  renderDocumentShell,
  renderLineItemTable,
  renderPartyBlock,
  renderTotalsBlock,
} from '../html/layout';
import { DocumentTemplate, DocumentTemplateData, RenderExtras } from '../document-template';

interface QuotationSnapshot {
  number: string;
  quotationDate: string;
  validUntil: string | null;
  status: string;
  customerId: string;
  warehouseId: string | null;
  customerSnapshot: Record<string, unknown>;
  paymentTerms: string | null;
  specialConditions: string | null;
  notes: string | null;
  subtotal: number;
  taxTotal: number;
  grandTotal: number;
  lines: {
    description: string;
    basis: string;
    quantity: number | null;
    rate: number;
    amount: number | null;
    taxRatePct: number | null;
  }[];
}

/** Blueprint §14/§44-49: the first document type wired into the shared engine (document-engine.md's own worked example). */
@Injectable()
export class QuotationDocumentTemplate implements DocumentTemplate {
  documentType = 'quotation';
  featureCode = 'QUOTATION_GENERATION';

  async loadData(tx: postgres.TransactionSql, tenantId: string, sourceId: string): Promise<DocumentTemplateData | null> {
    const [quotation] = await tx<
      {
        number: string;
        quotation_date: string;
        valid_until: string | null;
        status: string;
        customer_id: string;
        warehouse_id: string | null;
        customer_snapshot: Record<string, unknown>;
        payment_terms: string | null;
        special_conditions: string | null;
        notes: string | null;
        subtotal: string;
        tax_total: string;
        grand_total: string;
      }[]
    >`
      select number, quotation_date, valid_until, status, customer_id, warehouse_id, customer_snapshot,
             payment_terms, special_conditions, notes, subtotal, tax_total, grand_total
      from quotations where id = ${sourceId} and tenant_id = ${tenantId}
    `;
    if (!quotation) return null;

    const lines = await tx<
      { description: string; basis: string; quantity: string | null; rate: string; amount: string | null; tax_rate_pct: string | null }[]
    >`
      select ql.description, ql.basis, ql.quantity, ql.rate, ql.amount, tr.rate_pct as tax_rate_pct
      from quotation_lines ql
      left join tax_rates tr on tr.id = ql.tax_rate_id
      where ql.tenant_id = ${tenantId} and ql.quotation_id = ${sourceId}
      order by ql.sort_order, ql.id
    `;

    const snapshot: QuotationSnapshot = {
      number: quotation.number,
      quotationDate: quotation.quotation_date,
      validUntil: quotation.valid_until,
      status: quotation.status,
      customerId: quotation.customer_id,
      warehouseId: quotation.warehouse_id,
      customerSnapshot: quotation.customer_snapshot,
      paymentTerms: quotation.payment_terms,
      specialConditions: quotation.special_conditions,
      notes: quotation.notes,
      subtotal: Number(quotation.subtotal),
      taxTotal: Number(quotation.tax_total),
      grandTotal: Number(quotation.grand_total),
      lines: lines.map((l) => ({
        description: l.description,
        basis: l.basis,
        quantity: l.quantity === null ? null : Number(l.quantity),
        rate: Number(l.rate),
        amount: l.amount === null ? null : Number(l.amount),
        taxRatePct: l.tax_rate_pct === null ? null : Number(l.tax_rate_pct),
      })),
    };

    return {
      documentNumber: quotation.number,
      customerId: quotation.customer_id,
      warehouseId: quotation.warehouse_id,
      statusAtGeneration: quotation.status,
      snapshot: snapshot as unknown as Record<string, unknown>,
    };
  }

  renderHtml(data: DocumentTemplateData, extras: RenderExtras): string {
    const s = data.snapshot as unknown as QuotationSnapshot;
    const customer = s.customerSnapshot as {
      name?: string;
      legalName?: string | null;
      gstin?: string | null;
      billingAddress?: { addressLine1?: string; city?: string; state?: string; pincode?: string } | null;
      contact?: { name?: string | null; mobile?: string | null; email?: string | null } | null;
    };

    const partyBlock = renderPartyBlock('Customer', [
      customer.legalName || customer.name,
      customer.gstin ? `GSTIN: ${customer.gstin}` : null,
      customer.billingAddress
        ? [customer.billingAddress.addressLine1, customer.billingAddress.city, customer.billingAddress.state, customer.billingAddress.pincode]
            .filter(Boolean)
            .join(', ')
        : null,
      customer.contact?.name ? `Contact: ${customer.contact.name}${customer.contact.mobile ? ` (${customer.contact.mobile})` : ''}` : null,
    ]);

    const table = renderLineItemTable(
      ['Description', 'Basis', 'Qty', 'Rate', 'Tax %', 'Amount'],
      s.lines.map((l) => [
        l.description,
        l.basis,
        l.quantity === null ? '-' : l.quantity,
        formatMoney(l.rate),
        l.taxRatePct === null ? '-' : `${l.taxRatePct}%`,
        l.amount === null ? '-' : formatMoney(l.amount),
      ]),
    );

    const totals = renderTotalsBlock([
      { label: 'Subtotal', value: formatMoney(s.subtotal) },
      { label: 'Tax', value: formatMoney(s.taxTotal) },
      { label: 'Grand Total', value: formatMoney(s.grandTotal), emphasize: true },
    ]);

    const validUntilLine = s.validUntil ? `<div class="body-section"><strong>Valid until:</strong> ${formatDate(s.validUntil)}</div>` : '';
    const termsLine = s.paymentTerms
      ? `<div class="body-section"><div class="body-section-title">Payment Terms</div>${escapeHtml(s.paymentTerms)}</div>`
      : '';
    const specialLine = s.specialConditions
      ? `<div class="body-section"><div class="body-section-title">Special Conditions</div>${escapeHtml(s.specialConditions)}</div>`
      : '';
    const notesLine = s.notes ? `<div class="body-section"><div class="body-section-title">Notes</div>${escapeHtml(s.notes)}</div>` : '';

    const bodyHtml = `
      ${partyBlock}
      ${validUntilLine}
      ${table}
      ${totals}
      ${termsLine}
      ${specialLine}
      ${notesLine}
    `;

    return renderDocumentShell({
      title: 'Warehousing / Storage Quotation',
      documentNumber: s.number,
      dateLabel: 'Date',
      date: formatDate(s.quotationDate),
      company: extras.company,
      bodyHtml,
      qrDataUri: extras.qrDataUri,
      qrToken: extras.qrToken,
    });
  }
}
