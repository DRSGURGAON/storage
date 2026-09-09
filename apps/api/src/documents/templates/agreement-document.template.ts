import { Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { escapeHtml, formatDate, renderDocumentShell, renderPartyBlock } from '../html/layout';
import { DocumentTemplate, DocumentTemplateData, RenderExtras } from '../document-template';

interface AgreementSnapshot {
  number: string;
  agreementDate: string;
  status: string;
  customerId: string;
  warehouseId: string | null;
  customerName: string;
  warehouseName: string | null;
  startDate: string;
  endDate: string | null;
  autoRenew: boolean;
  noticePeriodDays: number | null;
  clauses: { id: string; title: string; body: string }[] | null;
}

/**
 * Blueprint §15: the second document type. Unlike Quotation, an
 * agreement has no frozen `customer_snapshot` of its own -- its
 * `rendered_clauses` (already placeholder-resolved plain text, computed
 * by AgreementsService on every `draft` edit and left untouched once the
 * agreement leaves `draft`) already carry the legally operative
 * customer/company/warehouse identity as prose, per the seeded system
 * template's own "parties" clause. This template renders each clause as
 * its own titled section rather than duplicating that identity into a
 * separate party card -- a contract's body *is* its clauses.
 */
@Injectable()
export class AgreementDocumentTemplate implements DocumentTemplate {
  documentType = 'agreement';
  featureCode = 'AGREEMENT_GENERATION';

  async loadData(tx: postgres.TransactionSql, tenantId: string, sourceId: string): Promise<DocumentTemplateData | null> {
    const [agreement] = await tx<
      {
        number: string;
        agreement_date: string;
        status: string;
        customer_id: string;
        warehouse_id: string | null;
        rendered_clauses: { id: string; title: string; body: string }[] | null;
        start_date: string;
        end_date: string | null;
        auto_renew: boolean;
        notice_period_days: number | null;
      }[]
    >`
      select number, agreement_date, status, customer_id, warehouse_id, rendered_clauses,
             start_date, end_date, auto_renew, notice_period_days
      from agreements where id = ${sourceId} and tenant_id = ${tenantId}
    `;
    if (!agreement) return null;

    const [customer] = await tx<{ name: string; legal_name: string | null }[]>`
      select name, legal_name from customers where id = ${agreement.customer_id} and tenant_id = ${tenantId}
    `;
    let warehouseName: string | null = null;
    if (agreement.warehouse_id) {
      const [warehouse] = await tx<{ name: string }[]>`
        select name from warehouses where id = ${agreement.warehouse_id} and tenant_id = ${tenantId}
      `;
      warehouseName = warehouse?.name ?? null;
    }

    const snapshot: AgreementSnapshot = {
      number: agreement.number,
      agreementDate: agreement.agreement_date,
      status: agreement.status,
      customerId: agreement.customer_id,
      warehouseId: agreement.warehouse_id,
      customerName: customer?.legal_name || customer?.name || '',
      warehouseName,
      startDate: agreement.start_date,
      endDate: agreement.end_date,
      autoRenew: agreement.auto_renew,
      noticePeriodDays: agreement.notice_period_days,
      clauses: agreement.rendered_clauses,
    };

    return {
      documentNumber: agreement.number,
      customerId: agreement.customer_id,
      warehouseId: agreement.warehouse_id,
      statusAtGeneration: agreement.status,
      snapshot: snapshot as unknown as Record<string, unknown>,
    };
  }

  renderHtml(data: DocumentTemplateData, extras: RenderExtras): string {
    const s = data.snapshot as unknown as AgreementSnapshot;

    const summary = renderPartyBlock('Agreement Summary', [
      `Customer: ${s.customerName}`,
      s.warehouseName ? `Warehouse: ${s.warehouseName}` : null,
      `Term: ${formatDate(s.startDate)} to ${s.endDate ? formatDate(s.endDate) : 'ongoing'}${s.autoRenew ? ' (auto-renewing)' : ''}`,
      s.noticePeriodDays ? `Notice period: ${s.noticePeriodDays} days` : null,
    ]);

    const clausesHtml =
      s.clauses && s.clauses.length > 0
        ? s.clauses
            .map(
              (c) =>
                `<div class="body-section"><div class="body-section-title">${escapeHtml(c.title)}</div>${escapeHtml(c.body)}</div>`,
            )
            .join('')
        : '<div class="body-section">No template clauses have been added to this agreement yet.</div>';

    const bodyHtml = `
      ${summary}
      ${clausesHtml}
    `;

    return renderDocumentShell({
      title: 'Warehousing Service Agreement',
      documentNumber: s.number,
      dateLabel: 'Date',
      date: formatDate(s.agreementDate),
      company: extras.company,
      bodyHtml,
      qrDataUri: extras.qrDataUri,
      qrToken: extras.qrToken,
    });
  }
}
