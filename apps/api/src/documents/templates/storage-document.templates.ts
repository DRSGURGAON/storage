import { Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import {
  formatDate,
  formatMoney,
  renderDocumentShell,
  renderLineItemTable,
  renderPartyBlock,
  renderReceiverSignature,
} from '../html/layout';
import { DocumentTemplate, DocumentTemplateData, RenderExtras } from '../document-template';

/**
 * The three papers a household storage operator actually hands a customer.
 *
 * They share one loader, because all three are views of the same booking:
 * what was handed over, what is being held, and what went back. Splitting
 * that into three near-identical queries is how two of them quietly drift
 * apart -- the inventory list showing one thing and the receipt another,
 * about the same goods, on the same day.
 */

interface ItemSnapshot {
  lineNo: number;
  description: string;
  category: string | null;
  quantity: number;
  uomCode: string;
  packing: string | null;
  conditionNote: string | null;
  declaredValue: number | null;
  isFragile: boolean;
  releasedQty: number;
}

interface MovementSnapshot {
  number: string;
  direction: string;
  movementDate: string;
  vehicleNumber: string | null;
  driverName: string | null;
  counterpartyName: string | null;
  counterpartyPhone: string | null;
  authorisationNote: string | null;
  signatureAttachmentId: string | null;
  lines: { lineNo: number; description: string; quantity: number; conditionNote: string | null }[];
}

interface BookingSnapshot {
  number: string;
  bookingDate: string;
  storageStartDate: string | null;
  status: string;
  customerName: string;
  customerMobile: string | null;
  customerAddress: string | null;
  godownName: string;
  unitCode: string | null;
  monthlyRent: number;
  securityDeposit: number;
  noticeDays: number;
  minimumMonths: number;
  idProofType: string | null;
  idProofLast4: string | null;
  items: ItemSnapshot[];
  declaredValueTotal: number;
  charges: { description: string; quantity: number; rate: number; amount: number }[];
  movements: MovementSnapshot[];
  /** Set when the document is about one particular handover rather than the booking as a whole. */
  movement: MovementSnapshot | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  furniture: 'Furniture',
  appliance: 'Appliance',
  carton: 'Cartons',
  vehicle: 'Vehicle',
  other: 'Other',
};

const ID_PROOF_LABELS: Record<string, string> = {
  aadhaar: 'Aadhaar',
  driving_licence: 'Driving licence',
  voter_id: 'Voter ID',
  passport: 'Passport',
  other: 'Other ID',
};

async function loadBooking(
  tx: postgres.TransactionSql,
  tenantId: string,
  bookingId: string,
  direction: 'in' | 'out' | null,
  subjectMovementId?: string,
): Promise<DocumentTemplateData | null> {
  const [booking] = await tx<
    {
      number: string;
      booking_date: string;
      storage_start_date: string | null;
      status: string;
      customer_id: string;
      warehouse_id: string;
      customer_snapshot: Record<string, any>;
      monthly_rent: string;
      security_deposit: string;
      notice_days: number;
      minimum_months: number;
      id_proof_type: string | null;
      id_proof_last4: string | null;
      godown_name: string;
      unit_code: string | null;
    }[]
  >`
    select b.number, b.booking_date, b.storage_start_date, b.status, b.customer_id, b.warehouse_id,
           b.customer_snapshot, b.monthly_rent, b.security_deposit, b.notice_days, b.minimum_months,
           b.id_proof_type, b.id_proof_last4,
           w.name as godown_name, u.code as unit_code
    from storage_bookings b
    join warehouses w on w.id = b.warehouse_id
    left join storage_units u on u.id = b.storage_unit_id
    where b.id = ${bookingId} and b.tenant_id = ${tenantId}
  `;
  if (!booking) return null;

  const items = await tx<
    {
      id: string;
      line_no: number;
      description: string;
      category: string | null;
      quantity: string;
      uom_code: string;
      packing: string | null;
      condition_note: string | null;
      declared_value: string | null;
      is_fragile: boolean;
      released_qty: string;
    }[]
  >`
    select id, line_no, description, category, quantity, uom_code, packing, condition_note,
           declared_value, is_fragile, released_qty
    from storage_booking_items
    where tenant_id = ${tenantId} and booking_id = ${bookingId}
    order by line_no
  `;

  const charges = await tx<{ description: string; quantity: string; rate: string; amount: string }[]>`
    select description, quantity, rate, amount from storage_booking_charges
    where tenant_id = ${tenantId} and booking_id = ${bookingId}
    order by charged_on, created_at
  `;

  const movementRows = await tx<
    {
      id: string;
      number: string;
      direction: string;
      movement_date: string;
      vehicle_number: string | null;
      driver_name: string | null;
      counterparty_name: string | null;
      counterparty_phone: string | null;
      authorisation_note: string | null;
      signature_attachment_id: string | null;
    }[]
  >`
    select id, number, direction, movement_date, vehicle_number, driver_name, counterparty_name,
           counterparty_phone, authorisation_note, signature_attachment_id
    from storage_movements
    where tenant_id = ${tenantId} and booking_id = ${bookingId} and status = 'completed'
    order by movement_date, created_at
  `;

  const movements: MovementSnapshot[] = [];
  const movementById = new Map<string, MovementSnapshot>();
  for (const m of movementRows) {
    const lines = await tx<{ line_no: number; description: string; quantity: string; condition_note: string | null }[]>`
      select i.line_no, i.description, mi.quantity, mi.condition_note
      from storage_movement_items mi
      join storage_booking_items i on i.id = mi.booking_item_id
      where mi.tenant_id = ${tenantId} and mi.movement_id = ${m.id}
      order by i.line_no
    `;
    const snapshotOfMovement: MovementSnapshot = {
      number: m.number,
      direction: m.direction,
      movementDate: m.movement_date,
      vehicleNumber: m.vehicle_number,
      driverName: m.driver_name,
      counterpartyName: m.counterparty_name,
      counterpartyPhone: m.counterparty_phone,
      authorisationNote: m.authorisation_note,
      signatureAttachmentId: m.signature_attachment_id,
      lines: lines.map((l) => ({
        lineNo: l.line_no,
        description: l.description,
        quantity: Number(l.quantity),
        conditionNote: l.condition_note,
      })),
    };
    movements.push(snapshotOfMovement);
    movementById.set(m.id, snapshotOfMovement);
  }

  // A release note is about *one* handover, not all of them: a family that
  // collects in three trips gets three notes, each naming what that trip
  // carried and who signed for it. So the subject is looked up by id when
  // the caller named one, and otherwise is the latest of its direction.
  const subject = direction
    ? (subjectMovementId
        ? movementById.get(subjectMovementId) ?? null
        : [...movements].reverse().find((m) => m.direction === direction) ?? null)
    : null;
  if (direction && !subject) return null;

  const address = booking.customer_snapshot?.address;
  const snapshot: BookingSnapshot = {
    number: booking.number,
    bookingDate: booking.booking_date,
    storageStartDate: booking.storage_start_date,
    status: booking.status,
    customerName: booking.customer_snapshot?.name ?? '',
    customerMobile: booking.customer_snapshot?.mobile ?? null,
    customerAddress: address
      ? [address.addressLine1, address.addressLine2, address.city, address.pincode]
          .filter(Boolean)
          .join(', ')
      : null,
    godownName: booking.godown_name,
    unitCode: booking.unit_code,
    monthlyRent: Number(booking.monthly_rent),
    securityDeposit: Number(booking.security_deposit),
    noticeDays: booking.notice_days,
    minimumMonths: booking.minimum_months,
    idProofType: booking.id_proof_type,
    idProofLast4: booking.id_proof_last4,
    items: items.map((i) => ({
      lineNo: i.line_no,
      description: i.description,
      category: i.category,
      quantity: Number(i.quantity),
      uomCode: i.uom_code,
      packing: i.packing,
      conditionNote: i.condition_note,
      declaredValue: i.declared_value === null ? null : Number(i.declared_value),
      isFragile: i.is_fragile,
      releasedQty: Number(i.released_qty),
    })),
    declaredValueTotal: items.reduce((sum, i) => sum + Number(i.declared_value ?? 0), 0),
    charges: charges.map((c) => ({
      description: c.description,
      quantity: Number(c.quantity),
      rate: Number(c.rate),
      amount: Number(c.amount),
    })),
    movements,
    movement: subject,
  };

  return {
    // A release note is numbered by its own handover (SM/...), everything
    // else by the booking (SB/...). Two notes on one booking are two
    // documents, not two versions of one.
    documentNumber: direction === 'out' && subject ? subject.number : booking.number,
    customerId: booking.customer_id,
    warehouseId: booking.warehouse_id,
    statusAtGeneration: booking.status,
    snapshot: snapshot as unknown as Record<string, unknown>,
    // The receiver's signature, captured on a phone at the handover. Ids
    // rather than bytes: the snapshot is frozen into the document row, and
    // a base64 image there would duplicate a file `attachments` holds.
    ...(subject?.signatureAttachmentId
      ? { imageAttachmentIds: { receiverSignature: subject.signatureAttachmentId } }
      : {}),
  };
}

function partyBlock(s: BookingSnapshot) {
  return renderPartyBlock('Customer', [
    s.customerName,
    s.customerMobile ? `Phone: ${s.customerMobile}` : null,
    s.customerAddress,
    s.idProofType
      ? `ID checked: ${ID_PROOF_LABELS[s.idProofType] ?? s.idProofType}${s.idProofLast4 ? ` ••••${s.idProofLast4}` : ''}`
      : null,
  ]);
}

function storageBlock(s: BookingSnapshot) {
  return renderPartyBlock('Storage', [
    `Godown: ${s.godownName}${s.unitCode ? ` · Unit ${s.unitCode}` : ''}`,
    `Rent: ${formatMoney(s.monthlyRent)} per month`,
    s.securityDeposit > 0 ? `Security deposit: ${formatMoney(s.securityDeposit)}` : null,
    s.storageStartDate ? `In storage since: ${formatDate(s.storageStartDate)}` : 'Goods not yet received',
    `Notice period: ${s.noticeDays} days`,
  ]);
}

/** The item-wise list the customer signs. The one paper an insurance claim is settled against. */
@Injectable()
export class StorageInventoryListTemplate implements DocumentTemplate {
  documentType = 'storage_inventory_list';
  featureCode = 'STORAGE_INVENTORY_LIST';

  loadData(tx: postgres.TransactionSql, tenantId: string, sourceId: string) {
    return loadBooking(tx, tenantId, sourceId, null);
  }

  renderHtml(data: DocumentTemplateData, extras: RenderExtras): string {
    const s = data.snapshot as unknown as BookingSnapshot;

    const table = renderLineItemTable(
      ['#', 'Item', 'Kind', 'Qty', 'Packing', 'Condition at handover', 'Declared value'],
      s.items.map((i) => [
        i.lineNo,
        `${i.description}${i.isFragile ? ' (FRAGILE)' : ''}`,
        i.category ? CATEGORY_LABELS[i.category] ?? i.category : '—',
        `${i.quantity} ${i.uomCode}`,
        i.packing ?? '—',
        // Printed as a dash rather than left blank, so a line nobody
        // inspected is visibly a line nobody inspected.
        i.conditionNote ?? '—',
        i.declaredValue === null ? '—' : formatMoney(i.declaredValue),
      ]),
    );

    const declaration = `
      <div style="margin-top:18px;font-size:11px;line-height:1.55;">
        <p style="margin:0 0 8px 0;"><strong>Customer's declaration.</strong> The goods listed above
        are mine and were handed over in the condition written against each line. The values shown
        are my own declaration for identification; they are not an insurance cover unless a separate
        policy has been taken.</p>
        <p style="margin:0;"><strong>Not accepted for storage:</strong> cash, jewellery, documents of
        title, hazardous or inflammable material, perishable food, plants and animals.</p>
      </div>`;

    const signatures = `
      <table style="width:100%;margin-top:26px;font-size:11px;">
        <tr>
          <td style="width:50%;padding-top:34px;border-top:1px solid #333;">Customer's signature<br/>${s.customerName}</td>
          <td style="width:8%;"></td>
          <td style="width:42%;padding-top:34px;border-top:1px solid #333;">For the godown</td>
        </tr>
      </table>`;

    return renderDocumentShell({
      title: 'Inventory List',
      documentNumber: s.number,
      dateLabel: 'Date',
      date: formatDate(s.bookingDate),
      company: extras.company,
      bodyHtml: `${partyBlock(s)}${storageBlock(s)}${table}
        <p style="margin-top:10px;font-size:11px;"><strong>${s.items.length}</strong> line(s) ·
        Total declared value <strong>${formatMoney(s.declaredValueTotal)}</strong></p>
        ${declaration}${signatures}`,
      qrDataUri: extras.qrDataUri,
      qrToken: extras.qrToken,
    });
  }
}

/** What the customer keeps: proof that the godown is holding their things. */
@Injectable()
export class StorageReceiptTemplate implements DocumentTemplate {
  documentType = 'storage_receipt';
  featureCode = 'STORAGE_RECEIPT';

  loadData(tx: postgres.TransactionSql, tenantId: string, sourceId: string) {
    return loadBooking(tx, tenantId, sourceId, 'in');
  }

  renderHtml(data: DocumentTemplateData, extras: RenderExtras): string {
    const s = data.snapshot as unknown as BookingSnapshot;
    const m = s.movement;

    const arrival = renderPartyBlock('Received', [
      m ? `On: ${formatDate(m.movementDate)}` : null,
      m?.vehicleNumber ? `Vehicle: ${m.vehicleNumber}` : null,
      m?.driverName ? `Driver: ${m.driverName}` : null,
      m?.counterpartyName ? `Handed over by: ${m.counterpartyName}` : null,
    ]);

    const table = renderLineItemTable(
      ['#', 'Item', 'Qty', 'Condition at handover'],
      s.items.map((i) => [i.lineNo, i.description, `${i.quantity} ${i.uomCode}`, i.conditionNote ?? '—']),
    );

    const charges = s.charges.length
      ? renderLineItemTable(
          ['One-time charge', 'Qty', 'Rate', 'Amount'],
          s.charges.map((c) => [c.description, c.quantity, formatMoney(c.rate), formatMoney(c.amount)]),
        )
      : '';

    const terms = `
      <div style="margin-top:18px;font-size:11px;line-height:1.55;">
        <p style="margin:0 0 6px 0;">Rent is payable monthly in advance. Goods are released against
        this receipt to the customer, or to a person the customer authorises in writing.</p>
        <p style="margin:0;">${s.noticeDays} days' notice is required before the goods are taken
        back${s.minimumMonths > 1 ? `, with a minimum storage period of ${s.minimumMonths} months` : ''}.
        Charges remaining unpaid may be recovered from the security deposit, and the godown may hold
        the goods until dues are cleared.</p>
      </div>`;

    return renderDocumentShell({
      title: 'Storage Receipt',
      documentNumber: s.number,
      dateLabel: 'Received on',
      date: formatDate(m?.movementDate ?? s.storageStartDate ?? s.bookingDate),
      company: extras.company,
      bodyHtml: `${partyBlock(s)}${storageBlock(s)}${arrival}${table}${charges}${terms}
        ${renderReceiverSignature(extras.images, 'Signed at handover')}`,
      qrDataUri: extras.qrDataUri,
      qrToken: extras.qrToken,
    });
  }
}

/** What went back, to whom, and on whose authority. */
@Injectable()
export class StorageReleaseNoteTemplate implements DocumentTemplate {
  documentType = 'storage_release_note';
  featureCode = 'STORAGE_RELEASE_NOTE';

  /** `sourceId` is the movement, so each trip out is its own document. */
  async loadData(tx: postgres.TransactionSql, tenantId: string, sourceId: string) {
    const [movement] = await tx<{ booking_id: string; direction: string; status: string }[]>`
      select booking_id, direction, status from storage_movements
      where id = ${sourceId} and tenant_id = ${tenantId}
    `;
    if (!movement || movement.direction !== 'out' || movement.status !== 'completed') return null;
    return loadBooking(tx, tenantId, movement.booking_id, 'out', sourceId);
  }

  renderHtml(data: DocumentTemplateData, extras: RenderExtras): string {
    const s = data.snapshot as unknown as BookingSnapshot;
    const m = s.movement!;

    const collected = renderPartyBlock('Collected by', [
      m.counterpartyName,
      m.counterpartyPhone ? `Phone: ${m.counterpartyPhone}` : null,
      // The line that answers "who took it?" a year later, and the reason
      // the API refuses a release without a name.
      m.authorisationNote ? `Authorisation: ${m.authorisationNote}` : null,
      m.vehicleNumber ? `Vehicle: ${m.vehicleNumber}` : null,
    ]);

    const table = renderLineItemTable(
      ['#', 'Item', 'Handed back', 'Condition at collection'],
      m.lines.map((l) => [l.lineNo, l.description, l.quantity, l.conditionNote ?? '—']),
    );

    const remaining = s.items.filter((i) => i.quantity - i.releasedQty > 0);
    const stillInside = remaining.length
      ? renderLineItemTable(
          ['#', 'Still in storage', 'Qty'],
          remaining.map((i) => [i.lineNo, i.description, i.quantity - i.releasedQty]),
        )
      : `<p style="margin-top:14px;font-size:11px;"><strong>Everything on this booking has now been
         handed back.</strong></p>`;

    const acknowledgement = `
      <div style="margin-top:16px;font-size:11px;line-height:1.55;">
        <p style="margin:0;">I have received the goods listed above and have checked their condition
        at the time of collection. Anything not written against a line is accepted as received in the
        condition recorded when it was stored.</p>
      </div>`;

    return renderDocumentShell({
      title: 'Release Note',
      documentNumber: m.number,
      dateLabel: 'Released on',
      date: formatDate(m.movementDate),
      company: extras.company,
      bodyHtml: `${partyBlock(s)}${renderPartyBlock('Against booking', [
        `Booking: ${s.number}`,
        `Godown: ${s.godownName}${s.unitCode ? ` · Unit ${s.unitCode}` : ''}`,
      ])}${collected}${table}${stillInside}${acknowledgement}
        ${renderReceiverSignature(extras.images, 'Signed by the person collecting')}`,
      qrDataUri: extras.qrDataUri,
      qrToken: extras.qrToken,
    });
  }
}
