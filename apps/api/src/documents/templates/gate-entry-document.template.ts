import { Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { escapeHtml, formatDate, renderDocumentShell, renderPartyBlock } from '../html/layout';
import { DocumentTemplate, DocumentTemplateData, RenderExtras } from '../document-template';

interface GateEntrySnapshot {
  number: string;
  entryAt: Date;
  exitAt: Date | null;
  direction: string;
  purpose: string;
  status: string;
  customerId: string | null;
  customerName: string | null;
  vehicleNumber: string | null;
  driverName: string | null;
  driverMobile: string | null;
  transporterName: string | null;
  referenceNo: string | null;
  remarks: string | null;
}

/** Blueprint §16: a single-block gate log slip -- no line items, no totals. */
@Injectable()
export class GateEntryDocumentTemplate implements DocumentTemplate {
  documentType = 'gate_entry';
  featureCode = 'GATE_ENTRY';

  async loadData(tx: postgres.TransactionSql, tenantId: string, sourceId: string): Promise<DocumentTemplateData | null> {
    const [gateEntry] = await tx<
      {
        number: string;
        entry_at: Date;
        exit_at: Date | null;
        direction: string;
        purpose: string;
        status: string;
        warehouse_id: string;
        customer_id: string | null;
        vehicle_number: string | null;
        driver_name: string | null;
        driver_mobile: string | null;
        transporter_name: string | null;
        reference_no: string | null;
        remarks: string | null;
      }[]
    >`
      select number, entry_at, exit_at, direction, purpose, status, warehouse_id, customer_id,
             vehicle_number, driver_name, driver_mobile, transporter_name, reference_no, remarks
      from gate_entries where id = ${sourceId} and tenant_id = ${tenantId}
    `;
    if (!gateEntry) return null;

    let customerName: string | null = null;
    if (gateEntry.customer_id) {
      const [customer] = await tx<{ name: string; legal_name: string | null }[]>`
        select name, legal_name from customers where id = ${gateEntry.customer_id} and tenant_id = ${tenantId}
      `;
      customerName = customer ? customer.legal_name || customer.name : null;
    }

    const snapshot: GateEntrySnapshot = {
      number: gateEntry.number,
      entryAt: gateEntry.entry_at,
      exitAt: gateEntry.exit_at,
      direction: gateEntry.direction,
      purpose: gateEntry.purpose,
      status: gateEntry.status,
      customerId: gateEntry.customer_id,
      customerName,
      vehicleNumber: gateEntry.vehicle_number,
      driverName: gateEntry.driver_name,
      driverMobile: gateEntry.driver_mobile,
      transporterName: gateEntry.transporter_name,
      referenceNo: gateEntry.reference_no,
      remarks: gateEntry.remarks,
    };

    return {
      documentNumber: gateEntry.number,
      customerId: gateEntry.customer_id,
      warehouseId: gateEntry.warehouse_id,
      statusAtGeneration: gateEntry.status,
      snapshot: snapshot as unknown as Record<string, unknown>,
    };
  }

  renderHtml(data: DocumentTemplateData, extras: RenderExtras): string {
    const s = data.snapshot as unknown as GateEntrySnapshot;

    const summary = renderPartyBlock('Gate Entry Details', [
      `Direction: ${s.direction === 'in' ? 'Gate In' : 'Gate Out'}`,
      `Purpose: ${s.purpose.replace(/_/g, ' ')}`,
      s.customerName ? `Customer: ${s.customerName}` : null,
      `Entry: ${formatDate(s.entryAt)}`,
      s.exitAt ? `Exit: ${formatDate(s.exitAt)}` : null,
      s.referenceNo ? `Reference: ${s.referenceNo}` : null,
    ]);

    const transport = renderPartyBlock('Transport', [
      s.vehicleNumber ? `Vehicle: ${s.vehicleNumber}` : 'Vehicle: -',
      s.driverName ? `Driver: ${s.driverName}${s.driverMobile ? ` (${s.driverMobile})` : ''}` : null,
      s.transporterName ? `Transporter: ${s.transporterName}` : null,
    ]);

    const remarksHtml = s.remarks
      ? `<div class="body-section"><div class="body-section-title">Remarks</div>${escapeHtml(s.remarks)}</div>`
      : '';

    const bodyHtml = `
      ${summary}
      ${transport}
      ${remarksHtml}
    `;

    return renderDocumentShell({
      title: 'Vehicle Gate Entry',
      documentNumber: s.number,
      dateLabel: 'Entry',
      date: formatDate(s.entryAt),
      company: extras.company,
      bodyHtml,
      qrDataUri: extras.qrDataUri,
      qrToken: extras.qrToken,
    });
  }
}
