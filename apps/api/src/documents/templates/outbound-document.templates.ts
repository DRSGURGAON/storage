import { Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { formatDate, renderDocumentShell, renderLineItemTable, renderPartyBlock, renderTotalsBlock } from '../html/layout';
import { DocumentTemplate, DocumentTemplateData, RenderExtras } from '../document-template';

type Row = Record<string, any>;

const transportLines = (d: Row) => [
  d.vehicle_number ? `Vehicle: ${d.vehicle_number}` : null,
  d.driver_name ? `Driver: ${d.driver_name}` : null,
  d.transporter_name ? `Transporter: ${d.transporter_name}` : null,
  d.lr_number ? `LR: ${d.lr_number}${d.lr_date ? ` dated ${formatDate(d.lr_date)}` : ''}` : null,
  d.eway_bill_number ? `E-way bill: ${d.eway_bill_number}${d.eway_bill_date ? ` dated ${formatDate(d.eway_bill_date)}` : ''}` : null,
];

/** Blueprint §32's Packing List: what is in which box, travelling with the consignment. */
@Injectable()
export class PackingListDocumentTemplate implements DocumentTemplate {
  documentType = 'packing_list';
  featureCode = 'PACKING_LIST';

  async loadData(tx: postgres.TransactionSql, tenantId: string, sourceId: string): Promise<DocumentTemplateData | null> {
    const [pk] = await tx<Row[]>`
      select pk.*, ro.number as release_order_number, ro.warehouse_id, coalesce(c.legal_name, c.name) as customer_name,
             w.name || ' (' || w.code || ')' as warehouse
      from packing_lists pk join release_orders ro on ro.id = pk.release_order_id
      join customers c on c.id = pk.customer_id join warehouses w on w.id = ro.warehouse_id
      where pk.id = ${sourceId} and pk.tenant_id = ${tenantId}
    `;
    if (!pk) return null;
    const lines = await tx<Row[]>`
      select p.sku, p.name, p.uom_code, pkl.quantity, pkl.packages, pkl.box_number, pkl.weight_kg, pkl.remarks
      from packing_list_lines pkl join products p on p.id = pkl.product_id
      where pkl.tenant_id = ${tenantId} and pkl.packing_list_id = ${sourceId} order by pkl.box_number nulls last, p.sku
    `;
    const snapshot = {
      number: pk.number, createdAt: pk.created_at, releaseOrderNumber: pk.release_order_number, customerName: pk.customer_name,
      warehouse: pk.warehouse, consigneeName: pk.consignee_name, totalPackages: pk.total_packages,
      totalWeightKg: pk.total_weight_kg === null ? null : Number(pk.total_weight_kg), remarks: pk.remarks,
      lines: lines.map((l) => ({
        sku: l.sku, name: l.name, uom: l.uom_code, quantity: Number(l.quantity), packages: l.packages, boxNumber: l.box_number,
        weightKg: l.weight_kg === null ? null : Number(l.weight_kg), remarks: l.remarks,
      })),
    };
    return { documentNumber: pk.number, customerId: pk.customer_id, warehouseId: pk.warehouse_id, statusAtGeneration: 'issued', snapshot };
  }

  renderHtml(data: DocumentTemplateData, extras: RenderExtras): string {
    const s = data.snapshot as Row;
    const header = renderPartyBlock('Consignment', [
      `Release Order: ${s.releaseOrderNumber}`, `Customer: ${s.customerName}`, `From: ${s.warehouse}`,
      s.consigneeName ? `Consignee: ${s.consigneeName}` : null,
    ]);
    const table = renderLineItemTable(['Box', 'Product', 'Qty', 'UOM', 'Packages', 'Weight (kg)', 'Remarks'],
      s.lines.map((l: Row) => [l.boxNumber ?? '-', `${l.name} (${l.sku})`, l.quantity, l.uom, l.packages ?? '-', l.weightKg ?? '-', l.remarks ?? '']));
    const totals = renderTotalsBlock([
      { label: 'Total packages', value: s.totalPackages === null ? '-' : String(s.totalPackages) },
      { label: 'Total weight (kg)', value: s.totalWeightKg === null ? '-' : String(s.totalWeightKg), emphasize: true },
    ]);
    const remarks = s.remarks ? renderPartyBlock('Remarks', [s.remarks]) : '';
    return renderDocumentShell({ title: 'Packing List', documentNumber: s.number, dateLabel: 'Date', date: formatDate(s.createdAt), company: extras.company, bodyHtml: `${header}${table}${totals}${remarks}`, qrDataUri: extras.qrDataUri, qrToken: extras.qrToken });
  }
}

/** Blueprint §33's Dispatch Note: the consignment, its transport, and the numbers that follow it. */
@Injectable()
export class DispatchNoteDocumentTemplate implements DocumentTemplate {
  documentType = 'dispatch_note';
  featureCode = 'DISPATCH_NOTE';

  async loadData(tx: postgres.TransactionSql, tenantId: string, sourceId: string): Promise<DocumentTemplateData | null> {
    const [d] = await tx<Row[]>`
      select d.*, ro.number as release_order_number, ro.delivery_address_snapshot, coalesce(c.legal_name, c.name) as customer_name,
             c.gstin as customer_gstin, w.name || ' (' || w.code || ')' as warehouse, pl.number as pick_list_number, pk.number as packing_list_number
      from dispatches d join release_orders ro on ro.id = d.release_order_id
      join customers c on c.id = d.customer_id join warehouses w on w.id = d.warehouse_id
      left join pick_lists pl on pl.id = d.pick_list_id left join packing_lists pk on pk.id = d.packing_list_id
      where d.id = ${sourceId} and d.tenant_id = ${tenantId}
    `;
    if (!d) return null;
    const lines = await tx<Row[]>`
      select p.sku, p.name, b.batch_no, dl.quantity, dl.uom_code
      from dispatch_lines dl join products p on p.id = dl.product_id left join batches b on b.id = dl.batch_id
      where dl.tenant_id = ${tenantId} and dl.dispatch_id = ${sourceId} order by p.sku
    `;
    const a = d.delivery_address_snapshot as Record<string, string | null> | null;
    const snapshot = {
      number: d.number, dispatchDate: d.dispatch_date, status: d.status, releaseOrderNumber: d.release_order_number,
      pickListNumber: d.pick_list_number, packingListNumber: d.packing_list_number, customerName: d.customer_name,
      customerGstin: d.customer_gstin, warehouse: d.warehouse, consigneeName: d.consignee_name,
      deliveryAddress: a ? [a.address_line1, a.address_line2, a.city, a.state, a.pincode].filter(Boolean).join(', ') : null,
      transport: transportLines(d).filter(Boolean) as string[],
      totalPackages: d.total_packages, totalWeightKg: d.total_weight_kg === null ? null : Number(d.total_weight_kg), remarks: d.remarks,
      lines: lines.map((l) => ({ sku: l.sku, name: l.name, batchNo: l.batch_no, quantity: Number(l.quantity), uom: l.uom_code })),
    };
    return { documentNumber: d.number, customerId: d.customer_id, warehouseId: d.warehouse_id, statusAtGeneration: d.status, snapshot };
  }

  renderHtml(data: DocumentTemplateData, extras: RenderExtras): string {
    const s = data.snapshot as Row;
    const from = renderPartyBlock('Dispatched From', [s.warehouse, `Release Order: ${s.releaseOrderNumber}`,
      s.pickListNumber ? `Pick List: ${s.pickListNumber}` : null, s.packingListNumber ? `Packing List: ${s.packingListNumber}` : null, `Status: ${s.status}`]);
    const to = renderPartyBlock('Consignee', [s.consigneeName ?? s.customerName, `Customer: ${s.customerName}`,
      s.customerGstin ? `GSTIN: ${s.customerGstin}` : null, s.deliveryAddress]);
    const transport = renderPartyBlock('Transport', s.transport.length ? s.transport : ['-']);
    const table = renderLineItemTable(['Product', 'Batch', 'Quantity', 'UOM'],
      s.lines.map((l: Row) => [`${l.name} (${l.sku})`, l.batchNo ?? '-', l.quantity, l.uom]));
    const totals = s.totalPackages !== null || s.totalWeightKg !== null
      ? renderTotalsBlock([
          { label: 'Packages', value: s.totalPackages === null ? '-' : String(s.totalPackages) },
          { label: 'Weight (kg)', value: s.totalWeightKg === null ? '-' : String(s.totalWeightKg) },
        ])
      : '';
    const remarks = s.remarks ? renderPartyBlock('Remarks', [s.remarks]) : '';
    return renderDocumentShell({ title: 'Dispatch Note', documentNumber: s.number, dateLabel: 'Dispatch Date', date: formatDate(s.dispatchDate), company: extras.company, bodyHtml: `${from}${to}${transport}${table}${totals}${remarks}`, qrDataUri: extras.qrDataUri, qrToken: extras.qrToken });
  }
}

/** Blueprint §34's Loading Sheet: the dock's tick-list, with a box per line. */
@Injectable()
export class LoadingSheetDocumentTemplate implements DocumentTemplate {
  documentType = 'loading_sheet';
  featureCode = 'LOADING_SHEET';

  async loadData(tx: postgres.TransactionSql, tenantId: string, sourceId: string): Promise<DocumentTemplateData | null> {
    const [ls] = await tx<Row[]>`
      select ls.*, d.number as dispatch_number, d.customer_id, d.warehouse_id, d.consignee_name, d.transporter_name,
             coalesce(v.vehicle_number, d.vehicle_number) as vehicle_number, coalesce(dr.name, d.driver_name) as driver_name,
             coalesce(c.legal_name, c.name) as customer_name, w.name || ' (' || w.code || ')' as warehouse, u.full_name as loaded_by_name
      from loading_sheets ls join dispatches d on d.id = ls.dispatch_id
      join customers c on c.id = d.customer_id join warehouses w on w.id = d.warehouse_id
      left join vehicles v on v.id = ls.vehicle_id left join drivers dr on dr.id = ls.driver_id left join users u on u.id = ls.loaded_by
      where ls.id = ${sourceId} and ls.tenant_id = ${tenantId}
    `;
    if (!ls) return null;
    const lines = await tx<Row[]>`
      select p.sku, p.name, b.batch_no, lsl.quantity, dl.uom_code, lsl.weight_kg, lsl.loaded
      from loading_sheet_lines lsl join dispatch_lines dl on dl.id = lsl.dispatch_line_id
      join products p on p.id = lsl.product_id left join batches b on b.id = dl.batch_id
      where lsl.tenant_id = ${tenantId} and lsl.loading_sheet_id = ${sourceId} order by p.sku
    `;
    const snapshot = {
      number: ls.number, createdAt: ls.created_at, status: ls.status, dispatchNumber: ls.dispatch_number, customerName: ls.customer_name,
      warehouse: ls.warehouse, consigneeName: ls.consignee_name, vehicleNumber: ls.vehicle_number, driverName: ls.driver_name,
      transporterName: ls.transporter_name, sealNumber: ls.seal_number, loadedByName: ls.loaded_by_name, loadingCompletedAt: ls.loading_completed_at,
      lines: lines.map((l) => ({ sku: l.sku, name: l.name, batchNo: l.batch_no, quantity: Number(l.quantity), uom: l.uom_code, weightKg: l.weight_kg === null ? null : Number(l.weight_kg), loaded: l.loaded })),
    };
    return { documentNumber: ls.number, customerId: ls.customer_id, warehouseId: ls.warehouse_id, statusAtGeneration: ls.status, snapshot };
  }

  renderHtml(data: DocumentTemplateData, extras: RenderExtras): string {
    const s = data.snapshot as Row;
    const header = renderPartyBlock('Load For', [`Dispatch: ${s.dispatchNumber}`, `Customer: ${s.customerName}`, s.consigneeName ? `Consignee: ${s.consigneeName}` : null, `Bay: ${s.warehouse}`, `Status: ${s.status}`]);
    const vehicle = renderPartyBlock('Vehicle', [s.vehicleNumber ? `Vehicle: ${s.vehicleNumber}` : 'Vehicle: ______', s.driverName ? `Driver: ${s.driverName}` : null,
      s.transporterName ? `Transporter: ${s.transporterName}` : null, `Seal: ${s.sealNumber ?? '______'}`,
      s.loadedByName ? `Loaded by: ${s.loadedByName}${s.loadingCompletedAt ? ` on ${formatDate(s.loadingCompletedAt)}` : ''}` : null]);
    const table = renderLineItemTable(['Product', 'Batch', 'Qty', 'UOM', 'Weight (kg)', 'Loaded'],
      s.lines.map((l: Row) => [`${l.name} (${l.sku})`, l.batchNo ?? '-', l.quantity, l.uom, l.weightKg ?? '______', l.loaded ? 'Yes' : '☐']));
    return renderDocumentShell({ title: 'Loading Sheet', documentNumber: s.number, dateLabel: 'Date', date: formatDate(s.createdAt), company: extras.company, bodyHtml: `${header}${vehicle}${table}`, qrDataUri: extras.qrDataUri, qrToken: extras.qrToken });
  }
}

/** Blueprint §35's Gate Pass: what the gate holds, and what the truck is carrying out. */
@Injectable()
export class GatePassDocumentTemplate implements DocumentTemplate {
  documentType = 'gate_pass';
  featureCode = 'GATE_PASS';

  async loadData(tx: postgres.TransactionSql, tenantId: string, sourceId: string): Promise<DocumentTemplateData | null> {
    const [gp] = await tx<Row[]>`
      select gp.*, d.number as dispatch_number, d.consignee_name, d.transporter_name, d.vehicle_number, d.driver_name, d.total_packages,
             coalesce(c.legal_name, c.name) as customer_name, w.name || ' (' || w.code || ')' as warehouse, u.full_name as authorized_by_name
      from gate_passes gp join dispatches d on d.id = gp.dispatch_id
      join customers c on c.id = gp.customer_id join warehouses w on w.id = gp.warehouse_id
      left join users u on u.id = gp.authorized_by
      where gp.id = ${sourceId} and gp.tenant_id = ${tenantId}
    `;
    if (!gp) return null;
    const lines = await tx<Row[]>`
      select p.sku, p.name, b.batch_no, dl.quantity, dl.uom_code
      from dispatch_lines dl join products p on p.id = dl.product_id left join batches b on b.id = dl.batch_id
      where dl.tenant_id = ${tenantId} and dl.dispatch_id = ${gp.dispatch_id} order by p.sku
    `;
    const snapshot = {
      number: gp.number, createdAt: gp.created_at, status: gp.status, dispatchNumber: gp.dispatch_number, customerName: gp.customer_name,
      warehouse: gp.warehouse, consigneeName: gp.consignee_name, vehicleNumber: gp.vehicle_number, driverName: gp.driver_name,
      transporterName: gp.transporter_name, invoiceNumber: gp.invoice_number, lrNumber: gp.lr_number, ewayBillNumber: gp.eway_bill_number,
      sealNumber: gp.seal_number, totalPackages: gp.total_packages, gateOutAt: gp.gate_out_at, authorizedByName: gp.authorized_by_name,
      lines: lines.map((l) => ({ sku: l.sku, name: l.name, batchNo: l.batch_no, quantity: Number(l.quantity), uom: l.uom_code })),
    };
    return { documentNumber: gp.number, customerId: gp.customer_id, warehouseId: gp.warehouse_id, statusAtGeneration: gp.status, snapshot };
  }

  renderHtml(data: DocumentTemplateData, extras: RenderExtras): string {
    const s = data.snapshot as Row;
    const header = renderPartyBlock('Outward Against', [`Dispatch: ${s.dispatchNumber}`, `Customer: ${s.customerName}`, s.consigneeName ? `Consignee: ${s.consigneeName}` : null, `Gate: ${s.warehouse}`,
      s.invoiceNumber ? `Invoice: ${s.invoiceNumber}` : null, s.lrNumber ? `LR: ${s.lrNumber}` : null, s.ewayBillNumber ? `E-way bill: ${s.ewayBillNumber}` : null]);
    const vehicle = renderPartyBlock('Vehicle', [`Vehicle: ${s.vehicleNumber ?? '______'}`, `Driver: ${s.driverName ?? '______'}`, s.transporterName ? `Transporter: ${s.transporterName}` : null,
      `Seal: ${s.sealNumber ?? '______'}`, s.totalPackages !== null ? `Packages: ${s.totalPackages}` : null,
      s.gateOutAt ? `Gate-out: ${formatDate(s.gateOutAt)}${s.authorizedByName ? `, authorised by ${s.authorizedByName}` : ''}` : `Status: ${s.status}`]);
    const table = renderLineItemTable(['Product', 'Batch', 'Quantity', 'UOM'], s.lines.map((l: Row) => [`${l.name} (${l.sku})`, l.batchNo ?? '-', l.quantity, l.uom]));
    return renderDocumentShell({ title: 'Gate Pass', documentNumber: s.number, dateLabel: 'Date', date: formatDate(s.createdAt), company: extras.company, bodyHtml: `${header}${vehicle}${table}`, qrDataUri: extras.qrDataUri, qrToken: extras.qrToken });
  }
}

/** Blueprint §36's Proof of Delivery: what the consignee signed for, line by line. */
@Injectable()
export class PodDocumentTemplate implements DocumentTemplate {
  documentType = 'pod';
  featureCode = 'POD';

  async loadData(tx: postgres.TransactionSql, tenantId: string, sourceId: string): Promise<DocumentTemplateData | null> {
    const [pod] = await tx<Row[]>`
      select pod.*, d.number as dispatch_number, d.customer_id, d.warehouse_id, d.consignee_name, d.vehicle_number, d.driver_name, d.transporter_name, d.lr_number,
             coalesce(c.legal_name, c.name) as customer_name, w.name || ' (' || w.code || ')' as warehouse, u.full_name as captured_by_name
      from pods pod join dispatches d on d.id = pod.dispatch_id
      join customers c on c.id = d.customer_id join warehouses w on w.id = d.warehouse_id
      left join users u on u.id = pod.captured_by
      where pod.id = ${sourceId} and pod.tenant_id = ${tenantId}
    `;
    if (!pod) return null;
    const lines = await tx<Row[]>`
      select p.sku, p.name, b.batch_no, dl.uom_code, pl.dispatched_qty, pl.received_qty, pl.shortage_qty, pl.damaged_qty, pl.remarks
      from pod_lines pl join dispatch_lines dl on dl.id = pl.dispatch_line_id
      join products p on p.id = pl.product_id left join batches b on b.id = dl.batch_id
      where pl.tenant_id = ${tenantId} and pl.pod_id = ${sourceId} order by p.sku
    `;
    const snapshot = {
      number: pod.number, createdAt: pod.created_at, status: pod.status, dispatchNumber: pod.dispatch_number, customerName: pod.customer_name,
      warehouse: pod.warehouse, consigneeName: pod.consignee_name, vehicleNumber: pod.vehicle_number, driverName: pod.driver_name,
      transporterName: pod.transporter_name, lrNumber: pod.lr_number, deliveryDate: pod.delivery_date, receiverName: pod.receiver_name,
      receiverMobile: pod.receiver_mobile, remarks: pod.remarks, capturedByName: pod.captured_by_name, capturedAt: pod.captured_at,
      lines: lines.map((l) => ({ sku: l.sku, name: l.name, batchNo: l.batch_no, uom: l.uom_code, dispatchedQty: Number(l.dispatched_qty),
        receivedQty: Number(l.received_qty), shortageQty: Number(l.shortage_qty), damagedQty: Number(l.damaged_qty), remarks: l.remarks })),
    };
    return { documentNumber: pod.number, customerId: pod.customer_id, warehouseId: pod.warehouse_id, statusAtGeneration: pod.status, snapshot };
  }

  renderHtml(data: DocumentTemplateData, extras: RenderExtras): string {
    const s = data.snapshot as Row;
    const header = renderPartyBlock('Delivery Of', [`Dispatch: ${s.dispatchNumber}`, `Customer: ${s.customerName}`, s.consigneeName ? `Consignee: ${s.consigneeName}` : null, `From: ${s.warehouse}`,
      s.vehicleNumber ? `Vehicle: ${s.vehicleNumber}${s.driverName ? `, driver ${s.driverName}` : ''}` : null, s.lrNumber ? `LR: ${s.lrNumber}` : null]);
    const receipt = renderPartyBlock('Received By', s.status === 'pending'
      ? ['Name: ______________________', 'Mobile: ____________', 'Date: ____________', 'Signature / stamp:']
      : [`${s.receiverName ?? '-'}${s.receiverMobile ? ` (${s.receiverMobile})` : ''}`, `Delivered: ${formatDate(s.deliveryDate)}`, `Outcome: ${s.status}`,
         s.capturedByName ? `Captured by ${s.capturedByName} on ${formatDate(s.capturedAt)}` : null, s.remarks]);
    const table = renderLineItemTable(['Product', 'Batch', 'Dispatched', 'Received', 'Short', 'Damaged', 'UOM', 'Remarks'],
      s.lines.map((l: Row) => [`${l.name} (${l.sku})`, l.batchNo ?? '-', l.dispatchedQty, s.status === 'pending' ? '______' : l.receivedQty,
        s.status === 'pending' ? '' : l.shortageQty, s.status === 'pending' ? '' : l.damagedQty, l.uom, l.remarks ?? '']));
    return renderDocumentShell({ title: 'Proof of Delivery', documentNumber: s.number, dateLabel: 'Date', date: formatDate(s.createdAt), company: extras.company, bodyHtml: `${header}${table}${receipt}`, qrDataUri: extras.qrDataUri, qrToken: extras.qrToken });
  }
}
