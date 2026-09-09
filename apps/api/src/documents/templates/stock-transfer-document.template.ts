import { Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { formatDate, renderDocumentShell, renderLineItemTable, renderPartyBlock } from '../html/layout';
import { DocumentTemplate, DocumentTemplateData, RenderExtras } from '../document-template';

interface TransferLineSnapshot {
  sku: string | null;
  name: string | null;
  batchNo: string | null;
  quantity: number;
  uom: string;
  fromLocation: string;
  toLocation: string | null;
}

interface TransferSnapshot {
  number: string;
  transferDate: string;
  transferKind: string;
  status: string;
  customerName: string;
  fromWarehouse: string;
  toWarehouse: string;
  vehicleNumber: string | null;
  driverName: string | null;
  remarks: string | null;
  lines: TransferLineSnapshot[];
}

/**
 * Blueprint §28's STOCK TRANSFER NOTE. On a warehouse-to-warehouse move
 * this travels *with* the goods, so the page leads with where they came
 * from, where they are going, and who is carrying them -- the three things
 * a gate guard at the far end checks before unloading. On a bin-to-bin
 * move the vehicle block simply has nothing to show and is left off.
 */
@Injectable()
export class StockTransferDocumentTemplate implements DocumentTemplate {
  documentType = 'stock_transfer';
  featureCode = 'STOCK_TRANSFER';

  async loadData(tx: postgres.TransactionSql, tenantId: string, sourceId: string): Promise<DocumentTemplateData | null> {
    const [transfer] = await tx<
      {
        number: string;
        transfer_date: string;
        transfer_kind: string;
        status: string;
        customer_id: string;
        from_warehouse_id: string;
        to_warehouse_id: string;
        vehicle_id: string | null;
        driver_id: string | null;
        remarks: string | null;
      }[]
    >`
      select number, transfer_date, transfer_kind, status, customer_id,
             from_warehouse_id, to_warehouse_id, vehicle_id, driver_id, remarks
      from stock_transfers where id = ${sourceId} and tenant_id = ${tenantId}
    `;
    if (!transfer) return null;

    const [customer] = await tx<{ name: string; legal_name: string | null }[]>`
      select name, legal_name from customers where id = ${transfer.customer_id} and tenant_id = ${tenantId}
    `;
    const [fromWarehouse] = await tx<{ code: string; name: string }[]>`
      select code, name from warehouses where id = ${transfer.from_warehouse_id} and tenant_id = ${tenantId}
    `;
    const [toWarehouse] = await tx<{ code: string; name: string }[]>`
      select code, name from warehouses where id = ${transfer.to_warehouse_id} and tenant_id = ${tenantId}
    `;
    let vehicleNumber: string | null = null;
    if (transfer.vehicle_id) {
      const [vehicle] = await tx<{ vehicle_number: string }[]>`
        select vehicle_number from vehicles where id = ${transfer.vehicle_id} and tenant_id = ${tenantId}
      `;
      vehicleNumber = vehicle?.vehicle_number ?? null;
    }
    let driverName: string | null = null;
    if (transfer.driver_id) {
      const [driver] = await tx<{ name: string }[]>`
        select name from drivers where id = ${transfer.driver_id} and tenant_id = ${tenantId}
      `;
      driverName = driver?.name ?? null;
    }

    const lines = await tx<
      {
        quantity: string;
        sku: string;
        name: string;
        uom_code: string;
        batch_no: string | null;
        from_code: string;
        to_code: string | null;
      }[]
    >`
      select stl.quantity, p.sku, p.name, p.uom_code, b.batch_no,
             fl.full_code as from_code, tl.full_code as to_code
      from stock_transfer_lines stl
      join products p on p.id = stl.product_id
      join locations fl on fl.id = stl.from_location_id
      left join locations tl on tl.id = stl.to_location_id
      left join batches b on b.id = stl.batch_id
      where stl.tenant_id = ${tenantId} and stl.transfer_id = ${sourceId}
      order by fl.full_code
    `;

    const snapshot: TransferSnapshot = {
      number: transfer.number,
      transferDate: transfer.transfer_date,
      transferKind: transfer.transfer_kind,
      status: transfer.status,
      customerName: customer ? customer.legal_name || customer.name : '',
      fromWarehouse: fromWarehouse ? `${fromWarehouse.name} (${fromWarehouse.code})` : '',
      toWarehouse: toWarehouse ? `${toWarehouse.name} (${toWarehouse.code})` : '',
      vehicleNumber,
      driverName,
      remarks: transfer.remarks,
      lines: lines.map((l) => ({
        sku: l.sku,
        name: l.name,
        batchNo: l.batch_no,
        quantity: Number(l.quantity),
        uom: l.uom_code,
        fromLocation: l.from_code,
        toLocation: l.to_code,
      })),
    };

    return {
      documentNumber: transfer.number,
      customerId: transfer.customer_id,
      // The source warehouse: this note is raised there, and it is the one
      // whose stock the transfer is about to leave.
      warehouseId: transfer.from_warehouse_id,
      statusAtGeneration: transfer.status,
      snapshot: snapshot as unknown as Record<string, unknown>,
    };
  }

  renderHtml(data: DocumentTemplateData, extras: RenderExtras): string {
    const s = data.snapshot as unknown as TransferSnapshot;
    const isBetweenWarehouses = s.transferKind === 'warehouse';

    const route = renderPartyBlock(isBetweenWarehouses ? 'Transfer Route' : 'Transfer Details', [
      `Goods of: ${s.customerName}`,
      `From: ${s.fromWarehouse}`,
      `To: ${s.toWarehouse}`,
      `Status: ${s.status}`,
    ]);

    // Only meaningful when something is actually driven somewhere.
    const transport =
      isBetweenWarehouses && (s.vehicleNumber || s.driverName)
        ? renderPartyBlock('Transport', [
            s.vehicleNumber ? `Vehicle: ${s.vehicleNumber}` : null,
            s.driverName ? `Driver: ${s.driverName}` : null,
          ])
        : '';

    const table = renderLineItemTable(
      ['Product', 'Batch', 'Quantity', 'UOM', 'From', 'To'],
      s.lines.map((l) => [
        `${l.name ?? ''} (${l.sku ?? ''})`,
        l.batchNo ?? '-',
        l.quantity,
        l.uom,
        l.fromLocation,
        // A blank destination is a real state, not missing data: the goods
        // arrive unallocated and are shelved by a later put-away.
        l.toLocation ?? 'Unallocated',
      ]),
    );

    const remarks = s.remarks ? renderPartyBlock('Remarks', [s.remarks]) : '';

    return renderDocumentShell({
      title: isBetweenWarehouses ? 'Stock Transfer Note' : 'Internal Stock Movement',
      documentNumber: s.number,
      dateLabel: 'Transfer Date',
      date: formatDate(s.transferDate),
      company: extras.company,
      bodyHtml: `${route}${transport}${table}${remarks}`,
      qrDataUri: extras.qrDataUri,
      qrToken: extras.qrToken,
    });
  }
}
