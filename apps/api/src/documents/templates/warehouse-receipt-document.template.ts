import { Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import {
  escapeHtml,
  formatDate,
  formatMoney,
  renderDocumentShell,
  renderLineItemTable,
  renderPartyBlock,
} from '../html/layout';
import { DocumentTemplate, DocumentTemplateData, RenderExtras } from '../document-template';

interface ReceiptLine {
  sku: string | null;
  name: string | null;
  uom: string | null;
  batch: string | null;
  qty: number;
  packages: number | null;
  weightKg: number | null;
  locations: { code: string; qty: number }[];
}

interface WarehouseReceiptSnapshot {
  number: string;
  receiptDate: string;
  status: string;
  grnNumber: string;
  customerSnapshot: { legalName?: string; name?: string; gstin?: string | null; contact?: string | null };
  declaredValue: number | null;
  remarks: string | null;
  lines: ReceiptLine[];
}

/**
 * Blueprint §22, verbatim: "Clearly label it as an *operational*
 * warehouse receipt unless a separate legally compliant regulatory
 * implementation exists. Do not call it a negotiable / WDRA warehouse
 * receipt." A negotiable warehouse receipt is a regulated instrument
 * that can be pledged against credit, so this is a legal boundary, not
 * a wording preference -- stated in the title *and* as a disclaimer on
 * the page, where a reader will actually see it.
 */
@Injectable()
export class WarehouseReceiptDocumentTemplate implements DocumentTemplate {
  documentType = 'warehouse_receipt';
  featureCode = 'WAREHOUSE_RECEIPT';

  async loadData(tx: postgres.TransactionSql, tenantId: string, sourceId: string): Promise<DocumentTemplateData | null> {
    const [receipt] = await tx<
      {
        number: string;
        receipt_date: string;
        status: string;
        grn_id: string;
        warehouse_id: string;
        customer_id: string;
        customer_snapshot: Record<string, unknown>;
        lines: ReceiptLine[];
        declared_value: string | null;
        remarks: string | null;
      }[]
    >`
      select number, receipt_date, status, grn_id, warehouse_id, customer_id, customer_snapshot, lines,
             declared_value, remarks
      from warehouse_receipts where id = ${sourceId} and tenant_id = ${tenantId}
    `;
    if (!receipt) return null;

    const [grn] = await tx<{ number: string }[]>`
      select number from grns where id = ${receipt.grn_id} and tenant_id = ${tenantId}
    `;

    const snapshot: WarehouseReceiptSnapshot = {
      number: receipt.number,
      receiptDate: receipt.receipt_date,
      status: receipt.status,
      grnNumber: grn?.number ?? '',
      customerSnapshot: receipt.customer_snapshot as WarehouseReceiptSnapshot['customerSnapshot'],
      declaredValue: receipt.declared_value === null ? null : Number(receipt.declared_value),
      remarks: receipt.remarks,
      lines: receipt.lines,
    };

    return {
      documentNumber: receipt.number,
      customerId: receipt.customer_id,
      warehouseId: receipt.warehouse_id,
      statusAtGeneration: receipt.status,
      snapshot: snapshot as unknown as Record<string, unknown>,
    };
  }

  renderHtml(data: DocumentTemplateData, extras: RenderExtras): string {
    const s = data.snapshot as unknown as WarehouseReceiptSnapshot;
    const customer = s.customerSnapshot;

    // Built from the frozen snapshot, never re-read from the customer master.
    const partyBlock = renderPartyBlock('Goods Held For', [
      customer.legalName || customer.name,
      customer.gstin ? `GSTIN: ${customer.gstin}` : null,
      customer.contact ? `Contact: ${customer.contact}` : null,
      `Against GRN: ${s.grnNumber}`,
    ]);

    const table = renderLineItemTable(
      ['Product', 'Batch', 'Quantity', 'UOM', 'Packages', 'Weight (kg)', 'Location'],
      s.lines.map((l) => [
        `${l.name ?? ''} (${l.sku ?? ''})`,
        l.batch ?? '-',
        l.qty,
        l.uom ?? '-',
        l.packages ?? '-',
        l.weightKg ?? '-',
        l.locations.length ? l.locations.map((loc) => `${loc.code} (${loc.qty})`).join(', ') : '-',
      ]),
    );

    const declared = s.declaredValue !== null
      ? `<div class="body-section"><strong>Customer-declared value:</strong> ${formatMoney(s.declaredValue)}</div>`
      : '';
    const remarksHtml = s.remarks
      ? `<div class="body-section"><div class="body-section-title">Remarks</div>${escapeHtml(s.remarks)}</div>`
      : '';

    const disclaimer = `
      <div class="body-section">
        <div class="body-section-title">Important</div>
        This is an <strong>operational warehouse receipt</strong> issued as an acknowledgement that the goods
        listed above are held in storage. It is <strong>not a negotiable warehouse receipt</strong> and is not
        issued under any warehousing regulatory authority's scheme. It is not a document of title, and may not
        be transferred, endorsed, or pledged as security.
      </div>`;

    return renderDocumentShell({
      title: 'Warehouse Receipt (Operational)',
      documentNumber: s.number,
      dateLabel: 'Date',
      date: formatDate(s.receiptDate),
      company: extras.company,
      bodyHtml: `${partyBlock}${table}${declared}${remarksHtml}${disclaimer}`,
      qrDataUri: extras.qrDataUri,
      qrToken: extras.qrToken,
    });
  }
}
