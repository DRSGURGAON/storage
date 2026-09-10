import { Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { formatDate, renderDocumentShell, renderLineItemTable, renderPartyBlock } from '../html/layout';
import { DocumentTemplate, DocumentTemplateData, RenderExtras } from '../document-template';

interface StatementLineSnapshot {
  warehouse: string;
  location: string | null;
  sku: string;
  name: string;
  batchNo: string | null;
  expiryDate: string | null;
  uom: string;
  physicalQty: number;
  reservedQty: number;
  availableQty: number;
}

interface StatementSnapshot {
  number: string;
  asOf: string;
  customerCode: string;
  customerName: string;
  customerGstin: string | null;
  lines: StatementLineSnapshot[];
  totals: { sku: string; name: string; uom: string; physicalQty: number; availableQty: number }[];
}

/**
 * Blueprint §25's Customer Stock Statement as a document. Its "source
 * record" is the customer: a statement is *the statement for customer X*,
 * and issuing another later is a new version of the same thing, which is
 * exactly what the document engine's versioning models. The number is
 * therefore derived -- `SS/{customer code}/{date}` -- rather than drawn
 * from a series, since nothing else about the row is a transaction.
 *
 * Always as of *now*. The `/reports/stock-statement` endpoint can rebuild a
 * past date from the ledger; the printed statement is the one a customer
 * is handed today, and it says its date on its face.
 */
@Injectable()
export class StockStatementDocumentTemplate implements DocumentTemplate {
  documentType = 'stock_statement';
  featureCode = 'STOCK_STATEMENT';

  async loadData(tx: postgres.TransactionSql, tenantId: string, sourceId: string): Promise<DocumentTemplateData | null> {
    const [customer] = await tx<{ id: string; code: string; name: string; legal_name: string | null; gstin: string | null }[]>`
      select id, code, name, legal_name, gstin from customers where id = ${sourceId} and tenant_id = ${tenantId}
    `;
    if (!customer) return null;

    const rows = await tx<
      {
        warehouse: string;
        location: string | null;
        sku: string;
        name: string;
        batch_no: string | null;
        expiry_date: string | null;
        uom_code: string;
        physical_qty: string;
        reserved_qty: string;
      }[]
    >`
      select w.code || ' - ' || w.name as warehouse, l.full_code as location, p.sku, p.name, b.batch_no,
             b.expiry_date, sl.uom_code, sl.physical_qty, sl.reserved_qty
      from stock_lots sl
      join warehouses w on w.id = sl.warehouse_id
      join products p on p.id = sl.product_id
      left join locations l on l.id = sl.location_id
      left join batches b on b.id = sl.batch_id
      where sl.tenant_id = ${tenantId} and sl.customer_id = ${sourceId}
        and (sl.physical_qty <> 0 or sl.reserved_qty <> 0)
      order by w.code, p.sku, l.full_code nulls first
    `;

    const today = new Date().toISOString().slice(0, 10);
    const totals = new Map<string, { sku: string; name: string; uom: string; physicalQty: number; availableQty: number }>();
    const lines = rows.map((r) => {
      const physicalQty = Number(r.physical_qty);
      const reservedQty = Number(r.reserved_qty);
      const t = totals.get(r.sku) ?? { sku: r.sku, name: r.name, uom: r.uom_code, physicalQty: 0, availableQty: 0 };
      t.physicalQty += physicalQty;
      t.availableQty += physicalQty - reservedQty;
      totals.set(r.sku, t);
      return {
        warehouse: r.warehouse,
        location: r.location,
        sku: r.sku,
        name: r.name,
        batchNo: r.batch_no,
        expiryDate: r.expiry_date,
        uom: r.uom_code,
        physicalQty,
        reservedQty,
        availableQty: physicalQty - reservedQty,
      };
    });

    const snapshot: StatementSnapshot = {
      number: `SS/${customer.code}/${today}`,
      asOf: today,
      customerCode: customer.code,
      customerName: customer.legal_name || customer.name,
      customerGstin: customer.gstin,
      lines,
      totals: [...totals.values()],
    };

    return {
      documentNumber: snapshot.number,
      customerId: customer.id,
      warehouseId: null,
      statusAtGeneration: 'issued',
      snapshot: snapshot as unknown as Record<string, unknown>,
    };
  }

  renderHtml(data: DocumentTemplateData, extras: RenderExtras): string {
    const s = data.snapshot as unknown as StatementSnapshot;

    const party = renderPartyBlock('Stock Held For', [
      s.customerName,
      s.customerGstin ? `GSTIN: ${s.customerGstin}` : null,
      `Customer Code: ${s.customerCode}`,
    ]);

    const summary = renderLineItemTable(
      ['Product', 'UOM', 'On Hand', 'Available'],
      s.totals.map((t) => [`${t.name} (${t.sku})`, t.uom, t.physicalQty, t.availableQty]),
    );

    const detail = renderLineItemTable(
      ['Warehouse', 'Location', 'Product', 'Batch', 'Expiry', 'On Hand', 'Reserved', 'Available'],
      s.lines.map((l) => [
        l.warehouse,
        l.location ?? 'Unallocated',
        `${l.name} (${l.sku})`,
        l.batchNo ?? '-',
        l.expiryDate ? formatDate(l.expiryDate) : '-',
        l.physicalQty,
        l.reservedQty,
        l.availableQty,
      ]),
    );

    const note = renderPartyBlock('Note', [
      'Reserved quantities are held against release orders not yet dispatched. This statement ' +
        'reflects balances at the date shown and is not a document of title.',
    ]);

    return renderDocumentShell({
      title: 'Customer Stock Statement',
      documentNumber: s.number,
      dateLabel: 'As Of',
      date: formatDate(s.asOf),
      company: extras.company,
      bodyHtml: `${party}<h3 style="margin:14px 0 6px;font-size:12px">Summary</h3>${summary}<h3 style="margin:14px 0 6px;font-size:12px">Detail</h3>${detail}${note}`,
      qrDataUri: extras.qrDataUri,
      qrToken: extras.qrToken,
    });
  }
}
