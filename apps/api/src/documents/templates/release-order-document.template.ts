import { Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { formatDate, renderDocumentShell, renderLineItemTable, renderPartyBlock } from '../html/layout';
import { DocumentTemplate, DocumentTemplateData, RenderExtras } from '../document-template';

interface Snapshot {
  number: string;
  orderDate: string;
  requestedDate: string | null;
  status: string;
  customerName: string;
  customerGstin: string | null;
  warehouse: string;
  consigneeName: string | null;
  consigneeAddress: string | null;
  deliveryAddress: string | null;
  transportMode: string | null;
  instructions: string | null;
  lines: { sku: string; name: string; batchNo: string | null; requestedQty: number; reservedQty: number; uom: string }[];
}

/** Blueprint §29's Release / Delivery Order -- the customer's instruction, and what the warehouse reserved against it. */
@Injectable()
export class ReleaseOrderDocumentTemplate implements DocumentTemplate {
  documentType = 'release_order';
  featureCode = 'RELEASE_ORDER';

  async loadData(tx: postgres.TransactionSql, tenantId: string, sourceId: string): Promise<DocumentTemplateData | null> {
    const [ro] = await tx<Record<string, any>[]>`
      select ro.*, coalesce(c.legal_name, c.name) as customer_name, c.gstin as customer_gstin,
             w.name || ' (' || w.code || ')' as warehouse
      from release_orders ro join customers c on c.id = ro.customer_id join warehouses w on w.id = ro.warehouse_id
      where ro.id = ${sourceId} and ro.tenant_id = ${tenantId}
    `;
    if (!ro) return null;
    const lines = await tx<Record<string, any>[]>`
      select p.sku, p.name, b.batch_no, rol.requested_qty, rol.reserved_qty, rol.uom_code
      from release_order_lines rol join products p on p.id = rol.product_id left join batches b on b.id = rol.batch_id
      where rol.tenant_id = ${tenantId} and rol.release_order_id = ${sourceId} order by rol.line_no
    `;
    const a = ro.delivery_address_snapshot as Record<string, string | null> | null;
    const deliveryAddress = a
      ? [a.address_line1, a.address_line2, a.city, a.state, a.pincode].filter(Boolean).join(', ')
      : null;
    const snapshot: Snapshot = {
      number: ro.number, orderDate: ro.order_date, requestedDate: ro.requested_date, status: ro.status,
      customerName: ro.customer_name, customerGstin: ro.customer_gstin, warehouse: ro.warehouse,
      consigneeName: ro.consignee_name, consigneeAddress: ro.consignee_address, deliveryAddress,
      transportMode: ro.transport_mode, instructions: ro.instructions,
      lines: lines.map((l) => ({ sku: l.sku, name: l.name, batchNo: l.batch_no, requestedQty: Number(l.requested_qty), reservedQty: Number(l.reserved_qty), uom: l.uom_code })),
    };
    return { documentNumber: ro.number, customerId: ro.customer_id, warehouseId: ro.warehouse_id, statusAtGeneration: ro.status, snapshot: snapshot as unknown as Record<string, unknown> };
  }

  renderHtml(data: DocumentTemplateData, extras: RenderExtras): string {
    const s = data.snapshot as unknown as Snapshot;
    const customer = renderPartyBlock('Release Requested By', [s.customerName, s.customerGstin ? `GSTIN: ${s.customerGstin}` : null, `From: ${s.warehouse}`]);
    const delivery = renderPartyBlock('Deliver To', [
      s.consigneeName ?? s.customerName, s.deliveryAddress ?? s.consigneeAddress ?? '-',
      s.transportMode ? `Transport: ${s.transportMode.replace(/_/g, ' ')}` : null,
      s.requestedDate ? `Requested by: ${formatDate(s.requestedDate)}` : null,
    ]);
    const table = renderLineItemTable(['Product', 'Batch', 'Requested', 'Reserved', 'UOM'],
      s.lines.map((l) => [`${l.name} (${l.sku})`, l.batchNo ?? '-', l.requestedQty, l.reservedQty, l.uom]));
    const instructions = s.instructions ? renderPartyBlock('Instructions', [s.instructions]) : '';
    return renderDocumentShell({ title: 'Release Order', documentNumber: s.number, dateLabel: 'Order Date', date: formatDate(s.orderDate), company: extras.company, bodyHtml: `${customer}${delivery}${table}${instructions}`, qrDataUri: extras.qrDataUri, qrToken: extras.qrToken });
  }
}
