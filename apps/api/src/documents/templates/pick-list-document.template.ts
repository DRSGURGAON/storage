import { Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { formatDate, renderDocumentShell, renderLineItemTable, renderPartyBlock } from '../html/layout';
import { DocumentTemplate, DocumentTemplateData, RenderExtras } from '../document-template';

interface Snapshot {
  number: string;
  createdAt: string;
  status: string;
  releaseOrderNumber: string;
  customerName: string;
  warehouse: string;
  allocationPolicy: string;
  pickerName: string | null;
  lines: { location: string; sku: string; name: string; batchNo: string | null; requiredQty: number; pickQty: number; picked: boolean }[];
}

/** Blueprint §31's Pick List: the walk order for a picker, so location comes first and there is a box to tick. */
@Injectable()
export class PickListDocumentTemplate implements DocumentTemplate {
  documentType = 'pick_list';
  featureCode = 'PICK_LIST';

  async loadData(tx: postgres.TransactionSql, tenantId: string, sourceId: string): Promise<DocumentTemplateData | null> {
    const [pl] = await tx<Record<string, any>[]>`
      select pl.*, ro.number as release_order_number, coalesce(c.legal_name, c.name) as customer_name,
             w.name || ' (' || w.code || ')' as warehouse, u.full_name as picker_name
      from pick_lists pl join release_orders ro on ro.id = pl.release_order_id
      join customers c on c.id = pl.customer_id join warehouses w on w.id = pl.warehouse_id
      left join users u on u.id = pl.picker_user_id
      where pl.id = ${sourceId} and pl.tenant_id = ${tenantId}
    `;
    if (!pl) return null;
    const lines = await tx<Record<string, any>[]>`
      select l.full_code as location, p.sku, p.name, b.batch_no, pll.required_qty, pll.pick_qty, pll.picked_at
      from pick_list_lines pll join products p on p.id = pll.product_id join locations l on l.id = pll.location_id
      left join batches b on b.id = pll.batch_id
      where pll.tenant_id = ${tenantId} and pll.pick_list_id = ${sourceId} order by l.full_code
    `;
    const snapshot: Snapshot = {
      number: pl.number, createdAt: pl.created_at, status: pl.status, releaseOrderNumber: pl.release_order_number,
      customerName: pl.customer_name, warehouse: pl.warehouse, allocationPolicy: pl.allocation_policy, pickerName: pl.picker_name,
      lines: lines.map((l) => ({ location: l.location, sku: l.sku, name: l.name, batchNo: l.batch_no, requiredQty: Number(l.required_qty), pickQty: Number(l.pick_qty), picked: l.picked_at !== null })),
    };
    return { documentNumber: pl.number, customerId: pl.customer_id, warehouseId: pl.warehouse_id, statusAtGeneration: pl.status, snapshot: snapshot as unknown as Record<string, unknown> };
  }

  renderHtml(data: DocumentTemplateData, extras: RenderExtras): string {
    const s = data.snapshot as unknown as Snapshot;
    const header = renderPartyBlock('Pick For', [
      `Release Order: ${s.releaseOrderNumber}`, `Customer: ${s.customerName}`, `Warehouse: ${s.warehouse}`,
      `Allocation: ${s.allocationPolicy.toUpperCase()}`, s.pickerName ? `Picker: ${s.pickerName}` : null, `Status: ${s.status}`,
    ]);
    const table = renderLineItemTable(['Location', 'Product', 'Batch', 'Required', 'Picked', '✓'],
      s.lines.map((l) => [l.location, `${l.name} (${l.sku})`, l.batchNo ?? '-', l.requiredQty, l.picked ? l.pickQty : '______', l.picked ? 'Yes' : '☐']));
    return renderDocumentShell({ title: 'Pick List', documentNumber: s.number, dateLabel: 'Date', date: formatDate(s.createdAt), company: extras.company, bodyHtml: `${header}${table}`, qrDataUri: extras.qrDataUri, qrToken: extras.qrToken });
  }
}
