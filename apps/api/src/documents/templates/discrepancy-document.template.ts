import { Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { escapeHtml, formatDate, renderDocumentShell, renderLineItemTable, renderPartyBlock } from '../html/layout';
import { DocumentTemplate, DocumentTemplateData, RenderExtras } from '../document-template';

interface DiscrepancyItemSnapshot {
  productSnapshot: { sku?: string; name?: string };
  batchNo: string | null;
  expectedQty: number;
  receivedQty: number;
  shortQty: number;
  excessQty: number;
  damagedQty: number;
  reason: string | null;
}

interface DiscrepancySnapshot {
  number: string;
  reportDate: string;
  status: string;
  customerName: string;
  supplierName: string | null;
  grnNumber: string | null;
  reason: string | null;
  remarks: string | null;
  driverAckName: string | null;
  warehouseAckAt: string | null;
  items: DiscrepancyItemSnapshot[];
}

/** Blueprint §19: the shortage/damage record handed to the supplier or transporter, with both acknowledgement lines on its face. */
@Injectable()
export class DiscrepancyDocumentTemplate implements DocumentTemplate {
  documentType = 'discrepancy_report';
  featureCode = 'DISCREPANCY_REPORT';

  async loadData(tx: postgres.TransactionSql, tenantId: string, sourceId: string): Promise<DocumentTemplateData | null> {
    const [report] = await tx<
      {
        number: string;
        report_date: string;
        status: string;
        warehouse_id: string;
        customer_id: string;
        supplier_name: string | null;
        grn_id: string | null;
        reason: string | null;
        remarks: string | null;
        driver_ack_name: string | null;
        warehouse_ack_at: string | null;
      }[]
    >`
      select number, report_date, status, warehouse_id, customer_id, supplier_name, grn_id, reason,
             remarks, driver_ack_name, warehouse_ack_at
      from discrepancy_reports where id = ${sourceId} and tenant_id = ${tenantId}
    `;
    if (!report) return null;

    const [customer] = await tx<{ name: string; legal_name: string | null }[]>`
      select name, legal_name from customers where id = ${report.customer_id} and tenant_id = ${tenantId}
    `;
    let grnNumber: string | null = null;
    if (report.grn_id) {
      const [grn] = await tx<{ number: string }[]>`
        select number from grns where id = ${report.grn_id} and tenant_id = ${tenantId}
      `;
      grnNumber = grn?.number ?? null;
    }

    const items = await tx<
      {
        product_snapshot: Record<string, unknown>;
        batch_no: string | null;
        expected_qty: string;
        received_qty: string;
        short_qty: string;
        excess_qty: string;
        damaged_qty: string;
        reason: string | null;
      }[]
    >`
      select product_snapshot, batch_no, expected_qty, received_qty, short_qty, excess_qty, damaged_qty, reason
      from discrepancy_items where tenant_id = ${tenantId} and report_id = ${sourceId}
      order by id
    `;

    const snapshot: DiscrepancySnapshot = {
      number: report.number,
      reportDate: report.report_date,
      status: report.status,
      customerName: customer ? customer.legal_name || customer.name : '',
      supplierName: report.supplier_name,
      grnNumber,
      reason: report.reason,
      remarks: report.remarks,
      driverAckName: report.driver_ack_name,
      warehouseAckAt: report.warehouse_ack_at,
      items: items.map((i) => ({
        productSnapshot: i.product_snapshot as DiscrepancyItemSnapshot['productSnapshot'],
        batchNo: i.batch_no,
        expectedQty: Number(i.expected_qty),
        receivedQty: Number(i.received_qty),
        shortQty: Number(i.short_qty),
        excessQty: Number(i.excess_qty),
        damagedQty: Number(i.damaged_qty),
        reason: i.reason,
      })),
    };

    return {
      documentNumber: report.number,
      customerId: report.customer_id,
      warehouseId: report.warehouse_id,
      statusAtGeneration: report.status,
      snapshot: snapshot as unknown as Record<string, unknown>,
    };
  }

  renderHtml(data: DocumentTemplateData, extras: RenderExtras): string {
    const s = data.snapshot as unknown as DiscrepancySnapshot;

    const summary = renderPartyBlock('Report Details', [
      `Customer: ${s.customerName}`,
      s.supplierName ? `Supplier: ${s.supplierName}` : null,
      s.grnNumber ? `Against GRN: ${s.grnNumber}` : null,
      s.reason ? `Reason: ${s.reason}` : null,
      `Status: ${s.status}`,
    ]);

    const table = renderLineItemTable(
      ['Product', 'Batch', 'Expected', 'Received', 'Short', 'Excess', 'Damaged', 'Reason'],
      s.items.map((i) => [
        `${i.productSnapshot.name ?? ''} (${i.productSnapshot.sku ?? ''})`,
        i.batchNo ?? '-',
        i.expectedQty,
        i.receivedQty,
        i.shortQty,
        i.excessQty,
        i.damagedQty,
        i.reason ?? '-',
      ]),
    );

    const acknowledgements = renderPartyBlock('Acknowledgements', [
      s.driverAckName ? `Driver: ${s.driverAckName}` : 'Driver: __________________',
      s.warehouseAckAt ? `Warehouse: acknowledged ${formatDate(s.warehouseAckAt)}` : 'Warehouse: __________________',
    ]);

    const remarksHtml = s.remarks
      ? `<div class="body-section"><div class="body-section-title">Remarks</div>${escapeHtml(s.remarks)}</div>`
      : '';

    const bodyHtml = `
      ${summary}
      ${table}
      ${remarksHtml}
      ${acknowledgements}
    `;

    return renderDocumentShell({
      title: 'Discrepancy / Damage Report',
      documentNumber: s.number,
      dateLabel: 'Date',
      date: formatDate(s.reportDate),
      company: extras.company,
      bodyHtml,
      qrDataUri: extras.qrDataUri,
      qrToken: extras.qrToken,
    });
  }
}
