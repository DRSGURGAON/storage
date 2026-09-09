import { Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { escapeHtml, formatDate, renderDocumentShell, renderLineItemTable, renderPartyBlock } from '../html/layout';
import { DocumentTemplate, DocumentTemplateData, RenderExtras } from '../document-template';

interface GrnItemSnapshot {
  productSnapshot: { sku?: string; name?: string; uom?: string };
  batchNo: string | null;
  expectedQty: number;
  receivedQty: number;
  acceptedQty: number;
  rejectedQty: number;
  damagedQty: number;
  shortQty: number;
  excessQty: number;
  condition: string | null;
}

interface GrnSnapshot {
  number: string;
  grnDate: string;
  status: string;
  hasDiscrepancy: boolean;
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
  items: GrnItemSnapshot[];
}

/** Blueprint §18: the GOODS RECEIPT NOTE -- the inbound chain's most consequential document, since its accepted quantities are what post to stock. */
@Injectable()
export class GrnDocumentTemplate implements DocumentTemplate {
  documentType = 'grn';
  featureCode = 'GRN_GENERATION';

  async loadData(tx: postgres.TransactionSql, tenantId: string, sourceId: string): Promise<DocumentTemplateData | null> {
    const [grn] = await tx<
      {
        number: string;
        grn_date: string;
        status: string;
        has_discrepancy: boolean;
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
      select number, grn_date, status, has_discrepancy, warehouse_id, customer_id, supplier_name,
             vehicle_number, driver_name, transporter_name, lr_number, invoice_number, eway_bill_number,
             po_number, remarks
      from grns where id = ${sourceId} and tenant_id = ${tenantId}
    `;
    if (!grn) return null;

    const [customer] = await tx<{ name: string; legal_name: string | null }[]>`
      select name, legal_name from customers where id = ${grn.customer_id} and tenant_id = ${tenantId}
    `;

    const items = await tx<
      {
        product_snapshot: Record<string, unknown>;
        batch_no: string | null;
        expected_qty: string;
        received_qty: string;
        accepted_qty: string;
        rejected_qty: string;
        damaged_qty: string;
        short_qty: string;
        excess_qty: string;
        condition: string | null;
      }[]
    >`
      select product_snapshot, batch_no, expected_qty, received_qty, accepted_qty, rejected_qty,
             damaged_qty, short_qty, excess_qty, condition
      from grn_items where tenant_id = ${tenantId} and grn_id = ${sourceId}
      order by line_no
    `;

    const snapshot: GrnSnapshot = {
      number: grn.number,
      grnDate: grn.grn_date,
      status: grn.status,
      hasDiscrepancy: grn.has_discrepancy,
      customerName: customer ? customer.legal_name || customer.name : '',
      supplierName: grn.supplier_name,
      vehicleNumber: grn.vehicle_number,
      driverName: grn.driver_name,
      transporterName: grn.transporter_name,
      lrNumber: grn.lr_number,
      invoiceNumber: grn.invoice_number,
      ewayBillNumber: grn.eway_bill_number,
      poNumber: grn.po_number,
      remarks: grn.remarks,
      items: items.map((i) => ({
        productSnapshot: i.product_snapshot as GrnItemSnapshot['productSnapshot'],
        batchNo: i.batch_no,
        expectedQty: Number(i.expected_qty),
        receivedQty: Number(i.received_qty),
        acceptedQty: Number(i.accepted_qty),
        rejectedQty: Number(i.rejected_qty),
        damagedQty: Number(i.damaged_qty),
        shortQty: Number(i.short_qty),
        excessQty: Number(i.excess_qty),
        condition: i.condition,
      })),
    };

    return {
      documentNumber: grn.number,
      customerId: grn.customer_id,
      warehouseId: grn.warehouse_id,
      statusAtGeneration: grn.status,
      snapshot: snapshot as unknown as Record<string, unknown>,
    };
  }

  renderHtml(data: DocumentTemplateData, extras: RenderExtras): string {
    const s = data.snapshot as unknown as GrnSnapshot;

    const summary = renderPartyBlock('Receipt Details', [
      `Customer: ${s.customerName}`,
      s.supplierName ? `Supplier: ${s.supplierName}` : null,
      s.invoiceNumber ? `Invoice No: ${s.invoiceNumber}` : null,
      s.lrNumber ? `LR No: ${s.lrNumber}` : null,
      s.ewayBillNumber ? `E-way Bill: ${s.ewayBillNumber}` : null,
      s.poNumber ? `PO No: ${s.poNumber}` : null,
      `Status: ${s.status}`,
    ]);

    const transport = renderPartyBlock('Transport', [
      s.vehicleNumber ? `Vehicle: ${s.vehicleNumber}` : 'Vehicle: -',
      s.driverName ? `Driver: ${s.driverName}` : null,
      s.transporterName ? `Transporter: ${s.transporterName}` : null,
    ]);

    const table = renderLineItemTable(
      ['Product', 'Batch', 'Expected', 'Received', 'Accepted', 'Rejected', 'Damaged', 'Short', 'Excess'],
      s.items.map((i) => [
        `${i.productSnapshot.name ?? ''} (${i.productSnapshot.sku ?? ''})`,
        i.batchNo ?? '-',
        i.expectedQty,
        i.receivedQty,
        i.acceptedQty,
        i.rejectedQty,
        i.damagedQty,
        i.shortQty,
        i.excessQty,
      ]),
    );

    // §19: a discrepancy is what triggers "Create Discrepancy Report", so the GRN itself has to say so on its face.
    const discrepancyNote = s.hasDiscrepancy
      ? '<div class="body-section"><div class="body-section-title">Discrepancy</div>This receipt has short, excess, or damaged quantities. A Discrepancy / Damage Report should be raised against it.</div>'
      : '';
    const remarksHtml = s.remarks
      ? `<div class="body-section"><div class="body-section-title">Remarks</div>${escapeHtml(s.remarks)}</div>`
      : '';

    const bodyHtml = `
      ${summary}
      ${transport}
      ${table}
      ${discrepancyNote}
      ${remarksHtml}
    `;

    return renderDocumentShell({
      title: 'Goods Receipt Note',
      documentNumber: s.number,
      dateLabel: 'Date',
      date: formatDate(s.grnDate),
      company: extras.company,
      bodyHtml,
      qrDataUri: extras.qrDataUri,
      qrToken: extras.qrToken,
    });
  }
}
