import { Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { formatDate, renderDocumentShell, renderLineItemTable, renderPartyBlock } from '../html/layout';
import { DocumentTemplate, DocumentTemplateData, RenderExtras } from '../document-template';

type Row = Record<string, any>;

/**
 * Blueprint §37's Return Inward note: what the customer asked to send
 * back, against which dispatch, and -- once its GRN is approved -- what
 * actually came in.
 */
@Injectable()
export class ReturnInwardDocumentTemplate implements DocumentTemplate {
  documentType = 'return_inward';
  featureCode = 'RETURN_INWARD';

  async loadData(tx: postgres.TransactionSql, tenantId: string, sourceId: string): Promise<DocumentTemplateData | null> {
    const [ri] = await tx<Row[]>`
      select ri.*, rr.number as request_number, rr.reason, rr.request_date, d.number as original_dispatch_number,
             g.number as grn_number, g.status as grn_status, g.grn_date,
             coalesce(c.legal_name, c.name) as customer_name, c.gstin as customer_gstin, w.name || ' (' || w.code || ')' as warehouse,
             v.vehicle_number, dr.name as driver_name, ge.number as gate_entry_number
      from return_inwards ri
      left join return_requests rr on rr.id = ri.return_request_id
      left join dispatches d on d.id = rr.original_dispatch_id
      left join grns g on g.id = ri.grn_id
      join customers c on c.id = ri.customer_id join warehouses w on w.id = ri.warehouse_id
      left join vehicles v on v.id = ri.vehicle_id left join drivers dr on dr.id = ri.driver_id left join gate_entries ge on ge.id = ri.gate_entry_id
      where ri.id = ${sourceId} and ri.tenant_id = ${tenantId}
    `;
    if (!ri) return null;
    const requested = ri.return_request_id
      ? await tx<Row[]>`
          select p.sku, p.name, p.uom_code, b.batch_no, rrl.quantity
          from return_request_lines rrl join products p on p.id = rrl.product_id left join batches b on b.id = rrl.batch_id
          where rrl.tenant_id = ${tenantId} and rrl.return_request_id = ${ri.return_request_id} order by p.sku
        `
      : [];
    const received = ri.grn_id
      ? await tx<Row[]>`
          select p.sku, gi.batch_no, gi.received_qty, gi.accepted_qty, gi.rejected_qty, gi.damaged_qty
          from grn_items gi join products p on p.id = gi.product_id where gi.tenant_id = ${tenantId} and gi.grn_id = ${ri.grn_id}
        `
      : [];
    const snapshot = {
      number: ri.number, createdAt: ri.created_at, status: ri.status, requestNumber: ri.request_number, requestDate: ri.request_date,
      reason: ri.reason, originalDispatchNumber: ri.original_dispatch_number, grnNumber: ri.grn_number, grnStatus: ri.grn_status,
      customerName: ri.customer_name, customerGstin: ri.customer_gstin, warehouse: ri.warehouse, vehicleNumber: ri.vehicle_number,
      driverName: ri.driver_name, gateEntryNumber: ri.gate_entry_number,
      lines: requested.map((l) => {
        const r = received.find((x) => x.sku === l.sku && (x.batch_no ?? null) === (l.batch_no ?? null));
        return {
          sku: l.sku, name: l.name, uom: l.uom_code, batchNo: l.batch_no, requestedQty: Number(l.quantity),
          receivedQty: r ? Number(r.received_qty) : null, acceptedQty: r ? Number(r.accepted_qty) : null,
          rejectedQty: r ? Number(r.rejected_qty) + Number(r.damaged_qty) : null,
        };
      }),
    };
    return { documentNumber: ri.number, customerId: ri.customer_id, warehouseId: ri.warehouse_id, statusAtGeneration: ri.status, snapshot };
  }

  renderHtml(data: DocumentTemplateData, extras: RenderExtras): string {
    const s = data.snapshot as Row;
    const from = renderPartyBlock('Returned By', [s.customerName, s.customerGstin ? `GSTIN: ${s.customerGstin}` : null,
      s.requestNumber ? `Return Request: ${s.requestNumber}${s.requestDate ? ` of ${formatDate(s.requestDate)}` : ''}` : null,
      s.originalDispatchNumber ? `Against Dispatch: ${s.originalDispatchNumber}` : null, s.reason ? `Reason: ${s.reason}` : null]);
    const arrival = renderPartyBlock('Arrival', [`Warehouse: ${s.warehouse}`, s.gateEntryNumber ? `Gate Entry: ${s.gateEntryNumber}` : null,
      s.vehicleNumber ? `Vehicle: ${s.vehicleNumber}${s.driverName ? `, driver ${s.driverName}` : ''}` : null,
      s.grnNumber ? `GRN: ${s.grnNumber} (${s.grnStatus})` : 'GRN: not yet raised', `Status: ${s.status}`]);
    const posted = s.grnNumber !== null;
    const table = renderLineItemTable(['Product', 'Batch', 'Requested', 'Received', 'Accepted', 'Rejected/Damaged', 'UOM'],
      s.lines.map((l: Row) => [`${l.name} (${l.sku})`, l.batchNo ?? '-', l.requestedQty,
        posted && l.receivedQty !== null ? l.receivedQty : '______', posted && l.acceptedQty !== null ? l.acceptedQty : '______',
        posted && l.rejectedQty !== null ? l.rejectedQty : '______', l.uom]));
    return renderDocumentShell({ title: 'Return Inward', documentNumber: s.number, dateLabel: 'Date', date: formatDate(s.createdAt), company: extras.company, bodyHtml: `${from}${arrival}${table}`, qrDataUri: extras.qrDataUri, qrToken: extras.qrToken });
  }
}
