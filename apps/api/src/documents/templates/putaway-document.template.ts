import { Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { formatDate, renderDocumentShell, renderLineItemTable, renderPartyBlock } from '../html/layout';
import { DocumentTemplate, DocumentTemplateData, RenderExtras } from '../document-template';

interface PutawayLineSnapshot {
  sku: string | null;
  name: string | null;
  batchNo: string | null;
  quantity: number;
  locationCode: string;
  confirmed: boolean;
}

interface PutawaySnapshot {
  number: string;
  createdAt: string;
  status: string;
  customerName: string;
  grnNumber: string;
  assignedToName: string | null;
  lines: PutawayLineSnapshot[];
}

/** Blueprint §21's PUT-AWAY SLIP: the sheet an operator carries, so the location code is the point of the page. */
@Injectable()
export class PutawayDocumentTemplate implements DocumentTemplate {
  documentType = 'putaway';
  featureCode = 'PUTAWAY';

  async loadData(tx: postgres.TransactionSql, tenantId: string, sourceId: string): Promise<DocumentTemplateData | null> {
    const [putaway] = await tx<
      {
        number: string;
        created_at: string;
        status: string;
        grn_id: string;
        warehouse_id: string;
        customer_id: string;
        assigned_to: string | null;
      }[]
    >`
      select number, created_at, status, grn_id, warehouse_id, customer_id, assigned_to
      from putaways where id = ${sourceId} and tenant_id = ${tenantId}
    `;
    if (!putaway) return null;

    const [customer] = await tx<{ name: string; legal_name: string | null }[]>`
      select name, legal_name from customers where id = ${putaway.customer_id} and tenant_id = ${tenantId}
    `;
    const [grn] = await tx<{ number: string }[]>`
      select number from grns where id = ${putaway.grn_id} and tenant_id = ${tenantId}
    `;
    let assignedToName: string | null = null;
    if (putaway.assigned_to) {
      const [assignee] = await tx<{ full_name: string }[]>`select full_name from users where id = ${putaway.assigned_to}`;
      assignedToName = assignee?.full_name ?? null;
    }

    const lines = await tx<
      {
        quantity: string;
        full_code: string;
        confirmed_at: string | null;
        sku: string | null;
        name: string | null;
        batch_no: string | null;
      }[]
    >`
      select pl.quantity, l.full_code, pl.confirmed_at,
             gi.product_snapshot->>'sku' as sku, gi.product_snapshot->>'name' as name, gi.batch_no
      from putaway_lines pl
      join locations l on l.id = pl.to_location_id
      join grn_items gi on gi.id = pl.grn_item_id
      where pl.tenant_id = ${tenantId} and pl.putaway_id = ${sourceId}
      order by l.full_code
    `;

    const snapshot: PutawaySnapshot = {
      number: putaway.number,
      createdAt: putaway.created_at,
      status: putaway.status,
      customerName: customer ? customer.legal_name || customer.name : '',
      grnNumber: grn?.number ?? '',
      assignedToName,
      lines: lines.map((l) => ({
        sku: l.sku,
        name: l.name,
        batchNo: l.batch_no,
        quantity: Number(l.quantity),
        locationCode: l.full_code,
        confirmed: l.confirmed_at !== null,
      })),
    };

    return {
      documentNumber: putaway.number,
      customerId: putaway.customer_id,
      warehouseId: putaway.warehouse_id,
      statusAtGeneration: putaway.status,
      snapshot: snapshot as unknown as Record<string, unknown>,
    };
  }

  renderHtml(data: DocumentTemplateData, extras: RenderExtras): string {
    const s = data.snapshot as unknown as PutawaySnapshot;

    const summary = renderPartyBlock('Put-away Details', [
      `Customer: ${s.customerName}`,
      `Against GRN: ${s.grnNumber}`,
      s.assignedToName ? `Assigned to: ${s.assignedToName}` : null,
      `Status: ${s.status}`,
    ]);

    const table = renderLineItemTable(
      ['Product', 'Batch', 'Quantity', 'Location', 'Confirmed'],
      s.lines.map((l) => [
        `${l.name ?? ''} (${l.sku ?? ''})`,
        l.batchNo ?? '-',
        l.quantity,
        l.locationCode,
        l.confirmed ? 'Yes' : '☐',
      ]),
    );

    return renderDocumentShell({
      title: 'Put-away Slip',
      documentNumber: s.number,
      dateLabel: 'Date',
      date: formatDate(s.createdAt),
      company: extras.company,
      bodyHtml: `${summary}${table}`,
      qrDataUri: extras.qrDataUri,
      qrToken: extras.qrToken,
    });
  }
}
