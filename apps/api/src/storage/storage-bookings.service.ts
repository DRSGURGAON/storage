import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { assertWarehouseInScope, loadWarehouseScope } from '../auth/warehouse-scope';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { EntitlementService } from '../entitlement/entitlement.service';
import { loadPaywallContext } from '../entitlement/paywall';
import { PaywallException } from '../entitlement/paywall.exception';
import { NumberingService } from '../numbering/numbering.service';
import {
  CancelStorageBookingDto,
  CloseStorageBookingDto,
  CreateStorageBookingDto,
  ListStorageBookingsQuery,
  StorageChargeDto,
  StorageIntakeDto,
  StorageItemDto,
  StorageReleaseDto,
  UpdateStorageBookingDto,
} from './dto/storage.dtos';

interface BookingRow {
  id: string;
  number: string;
  customer_id: string;
  warehouse_id: string;
  storage_unit_id: string | null;
  booking_date: string;
  storage_start_date: string | null;
  expected_end_date: string | null;
  actual_end_date: string | null;
  rent_basis: string;
  billable_quantity: string | null;
  monthly_rent: string;
  security_deposit: string;
  minimum_months: number;
  notice_days: number;
  billing_day: number | null;
  customer_snapshot: Record<string, unknown>;
  pickup_address: string | null;
  delivery_address: string | null;
  id_proof_type: string | null;
  id_proof_last4: string | null;
  status: string;
  cancelled_at: Date | null;
  cancel_reason: string | null;
  closed_at: Date | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
  customer_name?: string;
  warehouse_name?: string;
  unit_code?: string | null;
}

interface ItemRow {
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
  remarks: string | null;
}

interface ChargeRow {
  id: string;
  charge_type_id: string | null;
  description: string;
  quantity: string;
  rate: string;
  amount: string;
  charged_on: string;
  invoiced_at: Date | null;
  invoice_id: string | null;
}

interface MovementRow {
  id: string;
  number: string;
  direction: string;
  movement_date: string;
  vehicle_number: string | null;
  driver_name: string | null;
  transporter_name: string | null;
  counterparty_name: string | null;
  counterparty_phone: string | null;
  authorisation_note: string | null;
  signature_attachment_id: string | null;
  remarks: string | null;
  status: string;
  completed_at: Date | null;
}

const BOOKING_COLUMNS = [
  'id', 'number', 'customer_id', 'warehouse_id', 'storage_unit_id', 'booking_date',
  'storage_start_date', 'expected_end_date', 'actual_end_date', 'rent_basis',
  'billable_quantity', 'monthly_rent', 'security_deposit', 'minimum_months', 'notice_days',
  'billing_day', 'customer_snapshot', 'pickup_address', 'delivery_address', 'id_proof_type',
  'id_proof_last4', 'status', 'cancelled_at', 'cancel_reason', 'closed_at', 'notes',
  'created_at', 'updated_at',
] as const;

const SELECT = BOOKING_COLUMNS.join(', ');
const SELECT_B = BOOKING_COLUMNS.map((c) => `b.${c}`).join(', ');

const ITEM_SELECT = `
  id, line_no, description, category, quantity, uom_code, packing,
  condition_note, declared_value, is_fragile, released_qty, remarks`;

const CHARGE_SELECT = `
  id, charge_type_id, description, quantity, rate, amount, charged_on, invoiced_at, invoice_id`;

const MOVEMENT_SELECT = `
  id, number, direction, movement_date, vehicle_number, driver_name, transporter_name,
  counterparty_name, counterparty_phone, authorisation_note, signature_attachment_id,
  remarks, status, completed_at`;

function num(value: string | null): number | null {
  return value === null ? null : Number(value);
}

function toItemApi(row: ItemRow) {
  const quantity = Number(row.quantity);
  const released = Number(row.released_qty);
  return {
    id: row.id,
    lineNo: row.line_no,
    description: row.description,
    category: row.category,
    quantity,
    uomCode: row.uom_code,
    packing: row.packing,
    conditionNote: row.condition_note,
    declaredValue: num(row.declared_value),
    isFragile: row.is_fragile,
    releasedQty: released,
    /** What is still lying in the godown -- the number an operator actually asks for. */
    inStorageQty: Number((quantity - released).toFixed(3)),
    remarks: row.remarks,
  };
}

function toChargeApi(row: ChargeRow) {
  return {
    id: row.id,
    chargeTypeId: row.charge_type_id,
    description: row.description,
    quantity: Number(row.quantity),
    rate: Number(row.rate),
    amount: Number(row.amount),
    chargedOn: row.charged_on,
    invoicedAt: row.invoiced_at,
    invoiceId: row.invoice_id,
  };
}

function toMovementApi(row: MovementRow) {
  return {
    id: row.id,
    number: row.number,
    direction: row.direction,
    movementDate: row.movement_date,
    vehicleNumber: row.vehicle_number,
    driverName: row.driver_name,
    transporterName: row.transporter_name,
    counterpartyName: row.counterparty_name,
    counterpartyPhone: row.counterparty_phone,
    authorisationNote: row.authorisation_note,
    signatureAttachmentId: row.signature_attachment_id,
    remarks: row.remarks,
    status: row.status,
    completedAt: row.completed_at,
  };
}

function toApi(
  row: BookingRow,
  extras?: { items: ItemRow[]; charges: ChargeRow[]; movements: MovementRow[] },
) {
  return {
    id: row.id,
    number: row.number,
    customerId: row.customer_id,
    customerName: row.customer_name ?? (row.customer_snapshot as { name?: string })?.name ?? null,
    warehouseId: row.warehouse_id,
    warehouseName: row.warehouse_name ?? null,
    storageUnitId: row.storage_unit_id,
    storageUnitCode: row.unit_code ?? null,
    bookingDate: row.booking_date,
    storageStartDate: row.storage_start_date,
    expectedEndDate: row.expected_end_date,
    actualEndDate: row.actual_end_date,
    rentBasis: row.rent_basis,
    billableQuantity: num(row.billable_quantity),
    monthlyRent: Number(row.monthly_rent),
    securityDeposit: Number(row.security_deposit),
    minimumMonths: row.minimum_months,
    noticeDays: row.notice_days,
    billingDay: row.billing_day,
    customerSnapshot: row.customer_snapshot,
    pickupAddress: row.pickup_address,
    deliveryAddress: row.delivery_address,
    idProofType: row.id_proof_type,
    idProofLast4: row.id_proof_last4,
    status: row.status,
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason,
    closedAt: row.closed_at,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(extras
      ? {
          items: extras.items.map(toItemApi),
          charges: extras.charges.map(toChargeApi),
          movements: extras.movements.map(toMovementApi),
          declaredValueTotal: extras.items.reduce((sum, i) => sum + Number(i.declared_value ?? 0), 0),
          oneTimeChargesTotal: extras.charges.reduce((sum, c) => sum + Number(c.amount), 0),
        }
      : {}),
  };
}

/** Two decimals, the same way everywhere, so an amount never drifts a paisa from quantity x rate. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * A household storage booking: one family's goods, one agreement, one
 * rent.
 *
 * The state machine is deliberately short, because the business is:
 *
 *   enquiry -> quoted -> confirmed -> in_storage -> closed
 *                   \-> cancelled (only while the goods are still outside)
 *
 * `in_storage` is never set by hand -- it is what the intake does, so the
 * date the rent starts from is the date somebody recorded goods arriving,
 * not a date typed into a form afterwards. Closing works the same way from
 * the other end: it refuses while anything is still on the floor.
 */
@Injectable()
export class StorageBookingsService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly numbering: NumberingService,
    private readonly entitlement: EntitlementService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- reads

  async list(actor: AuthenticatedUser, query: ListStorageBookingsQuery) {
    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const customerId = query.customerId ?? null;
      const warehouseId = query.warehouseId ?? null;
      const status = query.status ?? null;
      const search = query.q ? `%${query.q}%` : null;
      const where = tx`
        where b.tenant_id = ${actor.tenantId}
          and (${customerId}::uuid is null or b.customer_id = ${customerId})
          and (${warehouseId}::uuid is null or b.warehouse_id = ${warehouseId})
          and (${status}::text is null or b.status = ${status})
          and (${scope}::uuid[] is null or b.warehouse_id = any(${scope}))
          and (${search}::text is null or b.number ilike ${search} or c.name ilike ${search}
               or c.mobile ilike ${search})
      `;
      const [{ count }] = await tx<{ count: string }[]>`
        select count(*)::text as count
        from storage_bookings b join customers c on c.id = b.customer_id
        ${where}
      `;
      const rows = await tx<BookingRow[]>`
        select ${tx.unsafe(SELECT_B)}, c.name as customer_name, w.name as warehouse_name,
               u.code as unit_code
        from storage_bookings b
        join customers c on c.id = b.customer_id
        join warehouses w on w.id = b.warehouse_id
        left join storage_units u on u.id = b.storage_unit_id
        ${where}
        order by b.created_at desc
        limit ${query.limit} offset ${query.offset}
      `;
      return { total: Number(count), items: rows.map((r) => toApi(r)) };
    });
  }

  async get(actor: AuthenticatedUser, id: string) {
    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const row = await this.loadBooking(tx, actor, id);
      const [items, charges, movements] = await Promise.all([
        tx<ItemRow[]>`
          select ${tx.unsafe(ITEM_SELECT)} from storage_booking_items
          where tenant_id = ${actor.tenantId} and booking_id = ${id} order by line_no
        `,
        tx<ChargeRow[]>`
          select ${tx.unsafe(CHARGE_SELECT)} from storage_booking_charges
          where tenant_id = ${actor.tenantId} and booking_id = ${id} order by charged_on, created_at
        `,
        tx<MovementRow[]>`
          select ${tx.unsafe(MOVEMENT_SELECT)} from storage_movements
          where tenant_id = ${actor.tenantId} and booking_id = ${id}
          order by movement_date, created_at
        `,
      ]);
      return toApi(row, { items, charges, movements });
    });
  }

  private async loadBooking(
    tx: postgres.TransactionSql,
    actor: AuthenticatedUser,
    id: string,
  ): Promise<BookingRow> {
    const [row] = await tx<BookingRow[]>`
      select ${tx.unsafe(SELECT_B)}, c.name as customer_name, w.name as warehouse_name,
             u.code as unit_code
      from storage_bookings b
      join customers c on c.id = b.customer_id
      join warehouses w on w.id = b.warehouse_id
      left join storage_units u on u.id = b.storage_unit_id
      where b.id = ${id} and b.tenant_id = ${actor.tenantId}
    `;
    if (!row) throw new NotFoundException('Booking not found');
    assertWarehouseInScope(await loadWarehouseScope(tx, actor), row.warehouse_id);
    return row;
  }

  // --------------------------------------------------------------- create

  /**
   * The customer's details as they were on the day. Every document this
   * booking produces prints from this snapshot rather than from a live
   * join, because an agreement signed in June must still read the way it
   * read in June -- even after the customer moves house.
   */
  private async buildCustomerSnapshot(
    tx: postgres.TransactionSql,
    tenantId: string,
    customerId: string,
  ) {
    const [customer] = await tx<
      {
        name: string;
        legal_name: string | null;
        customer_type: string | null;
        contact_person: string | null;
        mobile: string | null;
        email: string | null;
        gstin: string | null;
        state: string | null;
        state_code: string | null;
      }[]
    >`
      select name, legal_name, customer_type, contact_person, mobile, email, gstin, state, state_code
      from customers where id = ${customerId} and tenant_id = ${tenantId}
    `;
    if (!customer) throw new NotFoundException('Customer not found');

    const [address] = await tx<
      {
        address_line1: string;
        address_line2: string | null;
        city: string | null;
        state: string | null;
        state_code: string | null;
        pincode: string | null;
      }[]
    >`
      select address_line1, address_line2, city, state, state_code, pincode
      from customer_addresses
      where tenant_id = ${tenantId} and customer_id = ${customerId} and is_active
      order by (kind = 'billing') desc, (kind = 'registered') desc, is_default desc
      limit 1
    `;

    return {
      name: customer.name,
      legalName: customer.legal_name,
      customerType: customer.customer_type,
      mobile: customer.mobile,
      email: customer.email,
      gstin: customer.gstin,
      contactPerson: customer.contact_person,
      address: address
        ? {
            addressLine1: address.address_line1,
            addressLine2: address.address_line2,
            city: address.city,
            state: address.state,
            stateCode: address.state_code,
            pincode: address.pincode,
          }
        : null,
    };
  }

  private async insertItems(
    tx: postgres.TransactionSql,
    tenantId: string,
    bookingId: string,
    items: StorageItemDto[],
    startLineNo: number,
    userId: string,
  ) {
    let lineNo = startLineNo;
    for (const item of items) {
      await tx`
        insert into storage_booking_items
          (id, tenant_id, booking_id, line_no, description, category, quantity, uom_code,
           packing, condition_note, declared_value, is_fragile, remarks, created_by, updated_by)
        values
          (${randomUUID()}, ${tenantId}, ${bookingId}, ${lineNo}, ${item.description.trim()},
           ${item.category ?? null}, ${item.quantity ?? 1}, ${item.uomCode ?? 'NOS'},
           ${item.packing ?? null}, ${item.conditionNote ?? null}, ${item.declaredValue ?? null},
           ${item.isFragile ?? false}, ${item.remarks ?? null}, ${userId}, ${userId})
      `;
      lineNo += 1;
    }
    return lineNo;
  }

  private async insertCharges(
    tx: postgres.TransactionSql,
    tenantId: string,
    bookingId: string,
    charges: StorageChargeDto[],
    userId: string,
  ) {
    for (const charge of charges) {
      const quantity = charge.quantity ?? 1;
      const amount = round2(quantity * charge.rate);
      if (charge.chargeTypeId) {
        const [exists] = await tx<{ id: string }[]>`
          select id from charge_types
          where id = ${charge.chargeTypeId} and (tenant_id = ${tenantId} or tenant_id is null)
        `;
        if (!exists) throw new NotFoundException('Charge type not found');
      }
      await tx`
        insert into storage_booking_charges
          (id, tenant_id, booking_id, charge_type_id, description, quantity, rate, amount,
           charged_on, created_by, updated_by)
        values
          (${randomUUID()}, ${tenantId}, ${bookingId}, ${charge.chargeTypeId ?? null},
           ${charge.description.trim()}, ${quantity}, ${charge.rate}, ${amount},
           ${charge.chargedOn ?? today()}, ${userId}, ${userId})
      `;
    }
  }

  async create(actor: AuthenticatedUser, dto: CreateStorageBookingDto, ip?: string) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      assertWarehouseInScope(await loadWarehouseScope(tx, actor), dto.warehouseId);
      const [warehouse] = await tx<{ id: string }[]>`
        select id from warehouses where id = ${dto.warehouseId} and tenant_id = ${actor.tenantId} and is_active
      `;
      if (!warehouse) throw new NotFoundException('Warehouse not found');

      if (dto.storageUnitId) {
        const [unit] = await tx<{ id: string; warehouse_id: string; status: string }[]>`
          select id, warehouse_id, status from storage_units
          where id = ${dto.storageUnitId} and tenant_id = ${actor.tenantId} and is_active
        `;
        if (!unit) throw new NotFoundException('Storage unit not found');
        if (unit.warehouse_id !== dto.warehouseId) {
          throw new BadRequestException('That storage unit belongs to a different godown');
        }
        if (unit.status === 'maintenance') {
          throw new BadRequestException('That storage unit is under maintenance');
        }
      }

      const snapshot = await this.buildCustomerSnapshot(tx, actor.tenantId, dto.customerId);
      const number = await this.numbering.allocateNumberIn(
        tx,
        actor.tenantId,
        'STORAGE_BOOKING',
        dto.warehouseId,
      );
      const id = randomUUID();

      const [created] = await tx<BookingRow[]>`
        insert into storage_bookings
          (id, tenant_id, number, customer_id, warehouse_id, storage_unit_id, booking_date,
           expected_end_date, rent_basis, billable_quantity, monthly_rent, security_deposit,
           minimum_months, notice_days, billing_day, customer_snapshot, pickup_address,
           delivery_address, id_proof_type, id_proof_last4, notes, created_by, updated_by)
        values
          (${id}, ${actor.tenantId}, ${number}, ${dto.customerId}, ${dto.warehouseId},
           ${dto.storageUnitId ?? null}, ${dto.bookingDate ?? today()},
           ${dto.expectedEndDate ?? null}, ${dto.rentBasis ?? 'flat'},
           ${dto.billableQuantity ?? null}, ${dto.monthlyRent}, ${dto.securityDeposit ?? 0},
           ${dto.minimumMonths ?? 1}, ${dto.noticeDays ?? 30}, ${dto.billingDay ?? null},
           ${JSON.stringify(snapshot)}::jsonb, ${dto.pickupAddress ?? null},
           ${dto.deliveryAddress ?? null}, ${dto.idProofType ?? null},
           ${dto.idProofLast4 ?? null}, ${dto.notes ?? null}, ${actor.userId}, ${actor.userId})
        returning ${tx.unsafe(SELECT)}
      `;

      await this.insertItems(tx, actor.tenantId, id, dto.items ?? [], 1, actor.userId);
      await this.insertCharges(tx, actor.tenantId, id, dto.charges ?? [], actor.userId);
      return created;
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'create',
      entityType: 'storage_booking',
      entityId: result.id,
      newValue: {
        number: result.number,
        customerId: result.customer_id,
        monthlyRent: Number(result.monthly_rent),
        items: (dto.items ?? []).length,
      },
      ipAddress: ip,
    });
    return this.get(actor, result.id);
  }

  async update(actor: AuthenticatedUser, id: string, dto: UpdateStorageBookingDto, ip?: string) {
    await withTenant(this.sql, actor.tenantId, async (tx) => {
      const before = await this.loadBooking(tx, actor, id);
      if (['closed', 'cancelled'].includes(before.status)) {
        throw new BadRequestException(`This booking is ${before.status} and can no longer be edited`);
      }
      // The rent is what the customer agreed to. Once the goods are in, an
      // edit here would silently re-price months that have already been
      // billed -- a rent change on a running booking is a new agreement,
      // not a correction.
      if (before.status === 'in_storage' && dto.monthlyRent !== undefined
        && Number(before.monthly_rent) !== dto.monthlyRent) {
        throw new BadRequestException(
          'Rent cannot be changed while the goods are in storage -- close this booking and raise a new one',
        );
      }

      // `updated_at = now()` is appended to the SET clause rather than put
      // in the patch object: postgres.js's helper cannot serialise a JS Date
      // there, and it fails at runtime rather than at compile time.
      const patch: Record<string, unknown> = { updated_by: actor.userId };
      if (dto.storageUnitId !== undefined) patch.storage_unit_id = dto.storageUnitId;
      if (dto.expectedEndDate !== undefined) patch.expected_end_date = dto.expectedEndDate;
      if (dto.rentBasis !== undefined) patch.rent_basis = dto.rentBasis;
      if (dto.billableQuantity !== undefined) patch.billable_quantity = dto.billableQuantity;
      if (dto.monthlyRent !== undefined) patch.monthly_rent = dto.monthlyRent;
      if (dto.securityDeposit !== undefined) patch.security_deposit = dto.securityDeposit;
      if (dto.minimumMonths !== undefined) patch.minimum_months = dto.minimumMonths;
      if (dto.noticeDays !== undefined) patch.notice_days = dto.noticeDays;
      if (dto.billingDay !== undefined) patch.billing_day = dto.billingDay;
      if (dto.pickupAddress !== undefined) patch.pickup_address = dto.pickupAddress;
      if (dto.deliveryAddress !== undefined) patch.delivery_address = dto.deliveryAddress;
      if (dto.idProofType !== undefined) patch.id_proof_type = dto.idProofType;
      if (dto.idProofLast4 !== undefined) patch.id_proof_last4 = dto.idProofLast4;
      if (dto.notes !== undefined) patch.notes = dto.notes;
      if (dto.status !== undefined) {
        if (before.status === 'in_storage') {
          throw new BadRequestException('The goods are already in storage; status cannot be moved back');
        }
        patch.status = dto.status;
      }

      await tx`
        update storage_bookings set ${tx(patch)}, updated_at = now()
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'update',
      entityType: 'storage_booking',
      entityId: id,
      newValue: dto as Record<string, unknown>,
      ipAddress: ip,
    });
    return this.get(actor, id);
  }

  // ---------------------------------------------------------------- items

  async addItems(actor: AuthenticatedUser, id: string, items: StorageItemDto[], ip?: string) {
    await withTenant(this.sql, actor.tenantId, async (tx) => {
      const booking = await this.loadBooking(tx, actor, id);
      if (['closed', 'cancelled'].includes(booking.status)) {
        throw new BadRequestException(`This booking is ${booking.status}`);
      }
      const [{ next }] = await tx<{ next: number }[]>`
        select coalesce(max(line_no), 0) + 1 as next from storage_booking_items
        where tenant_id = ${actor.tenantId} and booking_id = ${id}
      `;
      await this.insertItems(tx, actor.tenantId, id, items, next, actor.userId);
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'update',
      entityType: 'storage_booking',
      entityId: id,
      newValue: { addedItems: items.length },
      ipAddress: ip,
    });
    return this.get(actor, id);
  }

  async updateItem(
    actor: AuthenticatedUser,
    id: string,
    itemId: string,
    dto: StorageItemDto,
    ip?: string,
  ) {
    await withTenant(this.sql, actor.tenantId, async (tx) => {
      await this.loadBooking(tx, actor, id);
      const [item] = await tx<ItemRow[]>`
        select ${tx.unsafe(ITEM_SELECT)} from storage_booking_items
        where id = ${itemId} and booking_id = ${id} and tenant_id = ${actor.tenantId}
      `;
      if (!item) throw new NotFoundException('Item not found on this booking');
      if (dto.quantity !== undefined && dto.quantity < Number(item.released_qty)) {
        throw new BadRequestException(
          `${Number(item.released_qty)} of this item has already gone out -- the quantity cannot be set below that`,
        );
      }
      const patch: Record<string, unknown> = { updated_by: actor.userId };
      if (dto.description !== undefined) patch.description = dto.description.trim();
      if (dto.category !== undefined) patch.category = dto.category;
      if (dto.quantity !== undefined) patch.quantity = dto.quantity;
      if (dto.uomCode !== undefined) patch.uom_code = dto.uomCode;
      if (dto.packing !== undefined) patch.packing = dto.packing;
      if (dto.conditionNote !== undefined) patch.condition_note = dto.conditionNote;
      if (dto.declaredValue !== undefined) patch.declared_value = dto.declaredValue;
      if (dto.isFragile !== undefined) patch.is_fragile = dto.isFragile;
      if (dto.remarks !== undefined) patch.remarks = dto.remarks;

      await tx`
        update storage_booking_items set ${tx(patch)}, updated_at = now()
        where id = ${itemId} and tenant_id = ${actor.tenantId}
      `;
    });
    return this.get(actor, id);
  }

  async removeItem(actor: AuthenticatedUser, id: string, itemId: string) {
    await withTenant(this.sql, actor.tenantId, async (tx) => {
      await this.loadBooking(tx, actor, id);
      const [item] = await tx<{ released_qty: string }[]>`
        select released_qty from storage_booking_items
        where id = ${itemId} and booking_id = ${id} and tenant_id = ${actor.tenantId}
      `;
      if (!item) throw new NotFoundException('Item not found on this booking');
      if (Number(item.released_qty) > 0) {
        throw new BadRequestException('This item has already been handed back and cannot be deleted');
      }
      await tx`
        delete from storage_booking_items
        where id = ${itemId} and tenant_id = ${actor.tenantId}
      `;
    });
    return this.get(actor, id);
  }

  async addCharges(actor: AuthenticatedUser, id: string, charges: StorageChargeDto[]) {
    await withTenant(this.sql, actor.tenantId, async (tx) => {
      const booking = await this.loadBooking(tx, actor, id);
      if (booking.status === 'cancelled') throw new BadRequestException('This booking is cancelled');
      await this.insertCharges(tx, actor.tenantId, id, charges, actor.userId);
    });
    return this.get(actor, id);
  }

  async removeCharge(actor: AuthenticatedUser, id: string, chargeId: string) {
    await withTenant(this.sql, actor.tenantId, async (tx) => {
      await this.loadBooking(tx, actor, id);
      const [charge] = await tx<{ invoiced_at: Date | null }[]>`
        select invoiced_at from storage_booking_charges
        where id = ${chargeId} and booking_id = ${id} and tenant_id = ${actor.tenantId}
      `;
      if (!charge) throw new NotFoundException('Charge not found on this booking');
      if (charge.invoiced_at) {
        throw new BadRequestException('This charge is already on an invoice -- raise a credit note instead');
      }
      await tx`delete from storage_booking_charges where id = ${chargeId} and tenant_id = ${actor.tenantId}`;
    });
    return this.get(actor, id);
  }

  // ------------------------------------------------------------ movements

  /** Goods have arrived. This is what starts the rent, and the only thing that does. */
  async intake(actor: AuthenticatedUser, id: string, dto: StorageIntakeDto, ip?: string) {
    const movementNumber = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const booking = await this.loadBooking(tx, actor, id);
      if (booking.status === 'in_storage') {
        throw new BadRequestException('The goods are already in storage on this booking');
      }
      if (!['enquiry', 'quoted', 'confirmed'].includes(booking.status)) {
        throw new BadRequestException(`Cannot take goods in on a booking that is ${booking.status}`);
      }
      const [{ count }] = await tx<{ count: string }[]>`
        select count(*)::text as count from storage_booking_items
        where tenant_id = ${actor.tenantId} and booking_id = ${id}
      `;
      // An intake with no inventory list is the one mistake that cannot be
      // repaired later: nobody can reconstruct, six months on, what was in
      // the tempo. So it is refused rather than warned about.
      if (Number(count) === 0) {
        throw new BadRequestException(
          'Add the inventory list before taking the goods in -- an intake with no items cannot be reconstructed later',
        );
      }

      // The subscription is counted here rather than at booking, because
      // this is the moment the goods become the operator's responsibility --
      // and because an enquiry that never arrives should never have cost
      // anybody a slot. Inside the transaction and behind a lock on the
      // tenant row, so two intakes at once cannot both find the last place.
      const room = await this.entitlement.assertResourceAvailable(
        tx,
        actor.tenantId,
        'STORAGE_ACTIVE_BOOKING',
      );
      if (!room.allowed) {
        throw new PaywallException(
          await loadPaywallContext(tx, actor.tenantId, 'STORAGE_ACTIVE_BOOKING'),
          room,
        );
      }

      const movementDate = dto.movementDate ?? today();
      const number = await this.numbering.allocateNumberIn(
        tx,
        actor.tenantId,
        'STORAGE_MOVEMENT',
        booking.warehouse_id,
      );
      const movementId = randomUUID();
      await tx`
        insert into storage_movements
          (id, tenant_id, number, booking_id, direction, movement_date, vehicle_number,
           driver_name, transporter_name, counterparty_name, counterparty_phone,
           signature_attachment_id, remarks, status, completed_at, created_by, updated_by)
        values
          (${movementId}, ${actor.tenantId}, ${number}, ${id}, 'in', ${movementDate},
           ${dto.vehicleNumber ?? null}, ${dto.driverName ?? null}, ${dto.transporterName ?? null},
           ${dto.counterpartyName ?? null}, ${dto.counterpartyPhone ?? null},
           ${dto.signatureAttachmentId ?? null}, ${dto.remarks ?? null}, 'completed', now(),
           ${actor.userId}, ${actor.userId})
      `;
      // Everything on the list came in. A partial intake is a different
      // booking, not a half-finished one -- keeping that rule means the
      // inventory list and what is on the floor never disagree.
      await tx`
        insert into storage_movement_items (id, tenant_id, movement_id, booking_item_id, quantity, condition_note)
        select gen_random_uuid(), ${actor.tenantId}, ${movementId}, i.id, i.quantity, i.condition_note
        from storage_booking_items i
        where i.tenant_id = ${actor.tenantId} and i.booking_id = ${id}
      `;
      await tx`
        update storage_bookings
        set status = 'in_storage', storage_start_date = ${movementDate},
            updated_by = ${actor.userId}, updated_at = now()
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;
      if (booking.storage_unit_id) {
        await tx`
          update storage_units set status = 'occupied', updated_at = now()
          where id = ${booking.storage_unit_id} and tenant_id = ${actor.tenantId}
        `;
      }
      return number;
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'storage_intake',
      entityType: 'storage_booking',
      entityId: id,
      newValue: { movementNumber, vehicleNumber: dto.vehicleNumber ?? null },
      ipAddress: ip,
    });
    return this.get(actor, id);
  }

  /** Goods going back, in whole or in part. */
  async release(actor: AuthenticatedUser, id: string, dto: StorageReleaseDto, ip?: string) {
    const movementNumber = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const booking = await this.loadBooking(tx, actor, id);
      if (booking.status !== 'in_storage') {
        throw new BadRequestException(
          `Nothing is in storage on this booking (it is ${booking.status})`,
        );
      }

      const movementDate = dto.movementDate ?? today();
      const number = await this.numbering.allocateNumberIn(
        tx,
        actor.tenantId,
        'STORAGE_MOVEMENT',
        booking.warehouse_id,
      );
      const movementId = randomUUID();
      await tx`
        insert into storage_movements
          (id, tenant_id, number, booking_id, direction, movement_date, vehicle_number,
           driver_name, transporter_name, counterparty_name, counterparty_phone,
           authorisation_note, signature_attachment_id, remarks, status, completed_at,
           created_by, updated_by)
        values
          (${movementId}, ${actor.tenantId}, ${number}, ${id}, 'out', ${movementDate},
           ${dto.vehicleNumber ?? null}, ${dto.driverName ?? null}, ${dto.transporterName ?? null},
           ${dto.counterpartyName}, ${dto.counterpartyPhone ?? null},
           ${dto.authorisationNote ?? null}, ${dto.signatureAttachmentId ?? null},
           ${dto.remarks ?? null}, 'completed', now(), ${actor.userId}, ${actor.userId})
      `;

      for (const line of dto.lines) {
        // `for update` because two people releasing the same booking at
        // once would otherwise both read the same released_qty and both
        // find room -- and the goods only exist once.
        const [item] = await tx<{ id: string; description: string; quantity: string; released_qty: string }[]>`
          select id, description, quantity, released_qty from storage_booking_items
          where id = ${line.itemId} and booking_id = ${id} and tenant_id = ${actor.tenantId}
          for update
        `;
        if (!item) throw new NotFoundException(`Item ${line.itemId} is not on this booking`);
        const remaining = Number(item.quantity) - Number(item.released_qty);
        if (line.quantity > remaining + 1e-9) {
          throw new BadRequestException(
            `${item.description}: only ${remaining} left in storage, cannot hand back ${line.quantity}`,
          );
        }
        await tx`
          update storage_booking_items
          set released_qty = released_qty + ${line.quantity}, updated_by = ${actor.userId}, updated_at = now()
          where id = ${line.itemId} and tenant_id = ${actor.tenantId}
        `;
        await tx`
          insert into storage_movement_items (id, tenant_id, movement_id, booking_item_id, quantity, condition_note)
          values (${randomUUID()}, ${actor.tenantId}, ${movementId}, ${line.itemId},
                  ${line.quantity}, ${line.conditionNote ?? null})
        `;
      }
      return number;
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'storage_release',
      entityType: 'storage_booking',
      entityId: id,
      newValue: {
        movementNumber,
        takenBy: dto.counterpartyName,
        lines: dto.lines.length,
      },
      ipAddress: ip,
    });
    return this.get(actor, id);
  }

  async close(actor: AuthenticatedUser, id: string, dto: CloseStorageBookingDto, ip?: string) {
    await withTenant(this.sql, actor.tenantId, async (tx) => {
      const booking = await this.loadBooking(tx, actor, id);
      if (booking.status !== 'in_storage') {
        throw new BadRequestException(`Only a booking in storage can be closed (this one is ${booking.status})`);
      }
      const [{ count }] = await tx<{ count: string }[]>`
        select count(*)::text as count from storage_booking_items
        where tenant_id = ${actor.tenantId} and booking_id = ${id} and released_qty < quantity
      `;
      if (Number(count) > 0) {
        throw new BadRequestException(
          `${count} item(s) are still in storage -- hand them back before closing this booking`,
        );
      }
      await tx`
        update storage_bookings
        set status = 'closed', actual_end_date = ${dto.closedOn ?? today()}, closed_at = now(),
            notes = coalesce(${dto.notes ?? null}, notes), updated_by = ${actor.userId}, updated_at = now()
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;
      if (booking.storage_unit_id) {
        // Freed the moment the booking closes, so the unit can be sold
        // again the same day -- a unit left "occupied" by a closed booking
        // is lost revenue nobody notices.
        await tx`
          update storage_units set status = 'vacant', updated_at = now()
          where id = ${booking.storage_unit_id} and tenant_id = ${actor.tenantId}
        `;
      }
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'storage_close',
      entityType: 'storage_booking',
      entityId: id,
      newValue: { closedOn: dto.closedOn ?? today() },
      ipAddress: ip,
    });
    return this.get(actor, id);
  }

  async cancel(actor: AuthenticatedUser, id: string, dto: CancelStorageBookingDto, ip?: string) {
    await withTenant(this.sql, actor.tenantId, async (tx) => {
      const booking = await this.loadBooking(tx, actor, id);
      if (booking.status === 'in_storage') {
        throw new BadRequestException(
          'The goods are already in storage -- hand them back and close the booking instead of cancelling it',
        );
      }
      if (['closed', 'cancelled'].includes(booking.status)) {
        throw new BadRequestException(`This booking is already ${booking.status}`);
      }
      await tx`
        update storage_bookings
        set status = 'cancelled', cancelled_at = now(), cancel_reason = ${dto.reason},
            updated_by = ${actor.userId}, updated_at = now()
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'cancel',
      entityType: 'storage_booking',
      entityId: id,
      newValue: { reason: dto.reason },
      ipAddress: ip,
    });
    return this.get(actor, id);
  }
}
