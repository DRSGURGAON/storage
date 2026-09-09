import { Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { escapeHtml, formatDate, renderDocumentShell, renderLineItemTable, renderPartyBlock } from '../html/layout';
import { DocumentTemplate, DocumentTemplateData, RenderExtras } from '../document-template';

interface InwardItemSnapshot {
  productSnapshot: { sku?: string; name?: string; uom?: string };
  batchNo: string | null;
  expectedQty: number;
  receivedQty: number;
  acceptedQty: number;
  rejectedQty: number;
  condition: string | null;
}

interface InwardSnapshot {
  number: string;
  inwardAt: string;
  status: string;
  customerId: string;
  customerName: string;
  supplierName: string | null;
  vehicleNumber: string | null;
  driverName: string | null;
  transporterName: string | null;
  lrNumber: string | null;
  invoiceNumber: string | null;
  ewayBillNumber: string | null;
  poNumber: string | null;
  remarks: string | null;
  items: InwardItemSnapshot[];
}

/** Blueprint §17: a goods-receipt slip -- product/batch/quantity lines, no money, no clauses. */
@Injectable()
export class InwardDocumentTemplate implements DocumentTemplate {
  documentType = 'inward';
  featureCode = 'INWARD';

  async loadData(tx: postgres.TransactionSql, tenantId: string, sourceId: string): Promise<DocumentTemplateData | null> {
    const [inward] = await tx<
      {
        number: string;
        inward_at: string;
        status: string;
        warehouse_id: string;
        customer_id: string;
        supplier_name: string | null;
        vehicle_number: string | null;
        driver_name: string | null;
        transporter_name: string | null;
        lr_number: string | null;
        invoice_number: string | null;
        eway_bill_number: string | null;
        po_number: string | null;
        remarks: string | null;
      }[]
    >`
      select number, inward_at, status, warehouse_id, customer_id, supplier_name, vehicle_number, driver_name,
             transporter_name, lr_number, invoice_number, eway_bill_number, po_number, remarks
      from inwards where id = ${sourceId} and tenant_id = ${tenantId}
    `;
    if (!inward) return null;

    const [customer] = await tx<{ name: string; legal_name: string | null }[]>`
      select name, legal_name from customers where id = ${inward.customer_id} and tenant_id = ${tenantId}
    `;

    const items = await tx<
      {
        product_snapshot: Record<string, unknown>;
        batch_no: string | null;
        expected_qty: string;
        received_qty: string;
        accepted_qty: string;
        rejected_qty: string;
        condition: string | null;
      }[]
    >`
      select product_snapshot, batch_no, expected_qty, received_qty, accepted_qty, rejected_qty, condition
      from inward_items where tenant_id = ${tenantId} and inward_id = ${sourceId}
      order by line_no
    `;

    const snapshot: InwardSnapshot = {
      number: inward.number,
      inwardAt: inward.inward_at,
      status: inward.status,
      customerId: inward.customer_id,
      customerName: customer ? customer.legal_name || customer.name : '',
      supplierName: inward.supplier_name,
      vehicleNumber: inward.vehicle_number,
      driverName: inward.driver_name,
      transporterName: inward.transporter_name,
      lrNumber: inward.lr_number,
      invoiceNumber: inward.invoice_number,
      ewayBillNumber: inward.eway_bill_number,
      poNumber: inward.po_number,
      remarks: inward.remarks,
      items: items.map((i) => ({
        productSnapshot: i.product_snapshot as InwardItemSnapshot['productSnapshot'],
        batchNo: i.batch_no,
        expectedQty: Number(i.expected_qty),
        receivedQty: Number(i.received_qty),
        acceptedQty: Number(i.accepted_qty),
        rejectedQty: Number(i.rejected_qty),
        condition: i.condition,
      })),
    };

    return {
      documentNumber: inward.number,
      customerId: inward.customer_id,
      warehouseId: inward.warehouse_id,
      statusAtGeneration: inward.status,
      snapshot: snapshot as unknown as Record<string, unknown>,
    };
  }

  renderHtml(data: DocumentTemplateData, extras: RenderExtras): string {
    const s = data.snapshot as unknown as InwardSnapshot;

    const summary = renderPartyBlock('Inward Details', [
      `Customer: ${s.customerName}`,
      s.supplierName ? `Supplier: ${s.supplierName}` : null,
      s.lrNumber ? `LR No: ${s.lrNumber}` : null,
      s.invoiceNumber ? `Invoice No: ${s.invoiceNumber}` : null,
      s.ewayBillNumber ? `E-way Bill: ${s.ewayBillNumber}` : null,
      s.poNumber ? `PO No: ${s.poNumber}` : null,
    ]);

    const transport = renderPartyBlock('Transport', [
      s.vehicleNumber ? `Vehicle: ${s.vehicleNumber}` : 'Vehicle: -',
      s.driverName ? `Driver: ${s.driverName}` : null,
      s.transporterName ? `Transporter: ${s.transporterName}` : null,
    ]);

    const table = renderLineItemTable(
      ['Product', 'Batch', 'Expected', 'Received', 'Accepted', 'Rejected', 'Condition'],
      s.items.map((i) => [
        `${i.productSnapshot.name ?? ''} (${i.productSnapshot.sku ?? ''})`,
        i.batchNo ?? '-',
        i.expectedQty,
        i.receivedQty,
        i.acceptedQty,
        i.rejectedQty,
        i.condition ?? '-',
      ]),
    );

    const remarksHtml = s.remarks
      ? `<div class="body-section"><div class="body-section-title">Remarks</div>${escapeHtml(s.remarks)}</div>`
      : '';

    const bodyHtml = `
      ${summary}
      ${transport}
      ${table}
      ${remarksHtml}
    `;

    return renderDocumentShell({
      title: 'Goods Inward',
      documentNumber: s.number,
      dateLabel: 'Date',
      date: formatDate(s.inwardAt),
      company: extras.company,
      bodyHtml,
      qrDataUri: extras.qrDataUri,
      qrToken: extras.qrToken,
    });
  }
}
