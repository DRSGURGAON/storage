import { Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { formatDate, renderDocumentShell, renderLineItemTable, renderPartyBlock } from '../html/layout';
import { DocumentTemplate, DocumentTemplateData, RenderExtras } from '../document-template';

interface VerificationLineSnapshot {
  sku: string;
  name: string;
  batchNo: string | null;
  locationCode: string | null;
  systemQty: number;
  physicalQty: number;
  differenceQty: number;
  reason: string | null;
  counted: boolean;
}

interface VerificationSnapshot {
  number: string;
  verificationDate: string;
  status: string;
  warehouseName: string;
  customerName: string | null;
  verifiedByName: string | null;
  lines: VerificationLineSnapshot[];
  discrepancyCount: number;
}

/**
 * Blueprint §27's count sheet, and it has two lives. Printed from a
 * `draft` it is the blank sheet someone carries down the aisles, so the
 * *system* quantity is deliberately left off those rows -- telling a
 * counter what they are expected to find is how a count stops being one.
 * Printed from a `completed` verification it is the record of what was
 * found, and then all three columns matter.
 */
@Injectable()
export class StockVerificationDocumentTemplate implements DocumentTemplate {
  documentType = 'stock_verification';
  featureCode = 'STOCK_VERIFICATION';

  async loadData(tx: postgres.TransactionSql, tenantId: string, sourceId: string): Promise<DocumentTemplateData | null> {
    const [verification] = await tx<
      {
        number: string;
        verification_date: string;
        status: string;
        warehouse_id: string;
        customer_id: string | null;
        verified_by: string | null;
      }[]
    >`
      select number, verification_date, status, warehouse_id, customer_id, verified_by
      from stock_verifications where id = ${sourceId} and tenant_id = ${tenantId}
    `;
    if (!verification) return null;

    const [warehouse] = await tx<{ code: string; name: string }[]>`
      select code, name from warehouses where id = ${verification.warehouse_id} and tenant_id = ${tenantId}
    `;
    let customerName: string | null = null;
    if (verification.customer_id) {
      const [customer] = await tx<{ name: string; legal_name: string | null }[]>`
        select name, legal_name from customers where id = ${verification.customer_id} and tenant_id = ${tenantId}
      `;
      customerName = customer ? customer.legal_name || customer.name : null;
    }
    let verifiedByName: string | null = null;
    if (verification.verified_by) {
      const [user] = await tx<{ full_name: string }[]>`select full_name from users where id = ${verification.verified_by}`;
      verifiedByName = user?.full_name ?? null;
    }

    const lines = await tx<
      {
        sku: string;
        name: string;
        batch_no: string | null;
        location_code: string | null;
        system_qty: string;
        physical_qty: string;
        difference_qty: string;
        reason: string | null;
        stock_lot_id: string | null;
      }[]
    >`
      select p.sku, p.name, b.batch_no, l.full_code as location_code,
             svl.system_qty, svl.physical_qty, svl.difference_qty, svl.reason, svl.stock_lot_id
      from stock_verification_lines svl
      join products p on p.id = svl.product_id
      left join batches b on b.id = svl.batch_id
      left join locations l on l.id = svl.location_id
      where svl.tenant_id = ${tenantId} and svl.verification_id = ${sourceId}
      order by l.full_code nulls first, p.sku
    `;

    const snapshot: VerificationSnapshot = {
      number: verification.number,
      verificationDate: verification.verification_date,
      status: verification.status,
      warehouseName: warehouse ? `${warehouse.name} (${warehouse.code})` : '',
      customerName,
      verifiedByName,
      lines: lines.map((l) => ({
        sku: l.sku,
        name: l.name,
        batchNo: l.batch_no,
        locationCode: l.location_code,
        systemQty: Number(l.system_qty),
        physicalQty: Number(l.physical_qty),
        differenceQty: Number(l.difference_qty),
        reason: l.reason,
        // A line with no lot behind it is stock that was found, not stock
        // that was expected.
        counted: l.stock_lot_id === null || Number(l.difference_qty) !== 0,
      })),
      discrepancyCount: lines.filter((l) => Number(l.difference_qty) !== 0).length,
    };

    return {
      documentNumber: verification.number,
      customerId: verification.customer_id,
      warehouseId: verification.warehouse_id,
      statusAtGeneration: verification.status,
      snapshot: snapshot as unknown as Record<string, unknown>,
    };
  }

  renderHtml(data: DocumentTemplateData, extras: RenderExtras): string {
    const s = data.snapshot as unknown as VerificationSnapshot;
    const isBlankSheet = s.status === 'draft';

    const summary = renderPartyBlock(isBlankSheet ? 'Count Sheet' : 'Verification Result', [
      `Warehouse: ${s.warehouseName}`,
      s.customerName ? `Customer: ${s.customerName}` : 'Scope: whole warehouse',
      s.verifiedByName ? `Verified by: ${s.verifiedByName}` : null,
      `Status: ${s.status}`,
      isBlankSheet ? null : `Lines not matching: ${s.discrepancyCount} of ${s.lines.length}`,
    ]);

    const table = isBlankSheet
      ? renderLineItemTable(
          ['Location', 'Product', 'Batch', 'Counted Qty'],
          // No system quantity on a blank sheet, on purpose: a counter who
          // can see the expected figure is confirming it, not counting.
          s.lines.map((l) => [l.locationCode ?? 'Unallocated', `${l.name} (${l.sku})`, l.batchNo ?? '-', '____________']),
        )
      : renderLineItemTable(
          ['Location', 'Product', 'Batch', 'System', 'Counted', 'Difference', 'Reason'],
          s.lines.map((l) => [
            l.locationCode ?? 'Unallocated',
            `${l.name} (${l.sku})`,
            l.batchNo ?? '-',
            l.systemQty,
            l.physicalQty,
            l.differenceQty > 0 ? `+${l.differenceQty}` : l.differenceQty,
            l.reason ?? '-',
          ]),
        );

    const note =
      !isBlankSheet && s.discrepancyCount > 0
        ? renderPartyBlock('Note', [
            'This count does not by itself change any stock figure. Correcting a difference ' +
              'requires an approved Stock Adjustment raised against this verification.',
          ])
        : '';

    return renderDocumentShell({
      title: isBlankSheet ? 'Physical Stock Count Sheet' : 'Physical Stock Verification',
      documentNumber: s.number,
      dateLabel: 'Verification Date',
      date: formatDate(s.verificationDate),
      company: extras.company,
      bodyHtml: `${summary}${table}${note}`,
      qrDataUri: extras.qrDataUri,
      qrToken: extras.qrToken,
    });
  }
}
