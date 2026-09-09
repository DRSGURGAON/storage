import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { ChargeTypesService } from '../billing/charge-types.service';
import { TaxRatesService } from '../billing/tax-rates.service';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { NumberingService } from '../numbering/numbering.service';
import { CreateQuotationLineDto } from './dto/create-quotation-line.dto';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { ListQuotationsQuery } from './dto/list-quotations.query';
import { RejectQuotationDto } from './dto/reject-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';

interface QuotationRow {
  id: string;
  number: string;
  quotation_date: string;
  valid_until: string | null;
  customer_id: string;
  warehouse_id: string | null;
  customer_snapshot: Record<string, unknown>;
  payment_terms: string | null;
  special_conditions: string | null;
  notes: string | null;
  subtotal: string;
  tax_total: string;
  grand_total: string;
  status: string;
  sent_at: Date | null;
  accepted_at: Date | null;
  rejected_at: Date | null;
  rejection_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

interface QuotationLineRow {
  id: string;
  charge_type_id: string;
  description: string;
  basis: string;
  uom_code: string | null;
  quantity: string | null;
  rate: string;
  minimum_charge: string | null;
  free_days: number;
  tax_rate_id: string | null;
  sac_code: string | null;
  amount: string | null;
  sort_order: number;
}

const SELECT_COLUMNS = `
  id, number, quotation_date, valid_until, customer_id, warehouse_id, customer_snapshot,
  payment_terms, special_conditions, notes, subtotal, tax_total, grand_total, status,
  sent_at, accepted_at, rejected_at, rejection_reason, created_at, updated_at`;

const LINE_SELECT_COLUMNS = `
  id, charge_type_id, description, basis, uom_code, quantity, rate, minimum_charge,
  free_days, tax_rate_id, sac_code, amount, sort_order`;

function toLineApi(row: QuotationLineRow) {
  return {
    id: row.id,
    chargeTypeId: row.charge_type_id,
    description: row.description,
    basis: row.basis,
    uomCode: row.uom_code,
    quantity: row.quantity === null ? null : Number(row.quantity),
    rate: Number(row.rate),
    minimumCharge: row.minimum_charge === null ? null : Number(row.minimum_charge),
    freeDays: row.free_days,
    taxRateId: row.tax_rate_id,
    sacCode: row.sac_code,
    amount: row.amount === null ? null : Number(row.amount),
    sortOrder: row.sort_order,
  };
}

function toApi(row: QuotationRow, lines?: QuotationLineRow[]) {
  return {
    id: row.id,
    number: row.number,
    quotationDate: row.quotation_date,
    validUntil: row.valid_until,
    customerId: row.customer_id,
    warehouseId: row.warehouse_id,
    customerSnapshot: row.customer_snapshot,
    paymentTerms: row.payment_terms,
    specialConditions: row.special_conditions,
    notes: row.notes,
    subtotal: Number(row.subtotal),
    taxTotal: Number(row.tax_total),
    grandTotal: Number(row.grand_total),
    status: row.status,
    sentAt: row.sent_at,
    acceptedAt: row.accepted_at,
    rejectedAt: row.rejected_at,
    rejectionReason: row.rejection_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(lines !== undefined ? { lines: lines.map(toLineApi) } : {}),
  };
}

/** Round to 2 decimals the same way everywhere -- amount and tax must never drift a paisa from line-item arithmetic. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

interface PricedLine {
  values: Record<string, unknown>;
  amount: number;
  taxAmount: number;
}

/** Blueprint §14: the warehousing/storage quotation, Draft -> Sent -> Accepted/Rejected/Cancelled. */
@Injectable()
export class QuotationsService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly numbering: NumberingService,
    private readonly chargeTypes: ChargeTypesService,
    private readonly taxRates: TaxRatesService,
    private readonly audit: AuditService,
  ) {}

  private async buildCustomerSnapshot(tx: postgres.TransactionSql, tenantId: string, customerId: string) {
    const [customer] = await tx<
      {
        name: string;
        legal_name: string | null;
        gstin: string | null;
        pan: string | null;
        contact_person: string | null;
        mobile: string | null;
        email: string | null;
      }[]
    >`
      select name, legal_name, gstin, pan, contact_person, mobile, email
      from customers where id = ${customerId} and tenant_id = ${tenantId}
    `;
    if (!customer) throw new NotFoundException('Customer not found');

    // Prefer a billing address, then registered, then whatever default exists -- schema/10_masters.sql's
    // customer_addresses.kind values, in the order that matters for what gets printed on a quotation.
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

    const [primaryContact] = await tx<{ name: string; mobile: string | null; email: string | null }[]>`
      select name, mobile, email from customer_contacts
      where tenant_id = ${tenantId} and customer_id = ${customerId} and is_primary
      limit 1
    `;

    return {
      name: customer.name,
      legalName: customer.legal_name,
      gstin: customer.gstin,
      pan: customer.pan,
      billingAddress: address
        ? {
            addressLine1: address.address_line1,
            addressLine2: address.address_line2,
            city: address.city,
            state: address.state,
            stateCode: address.state_code,
            pincode: address.pincode,
          }
        : null,
      contact: primaryContact
        ? { name: primaryContact.name, mobile: primaryContact.mobile, email: primaryContact.email }
        : { name: customer.contact_person, mobile: customer.mobile, email: customer.email },
    };
  }

  /**
   * amount = quantity x rate when a quantity is given (a metered basis like
   * unit_day); for a flat/non-quantity basis (lumpsum, flat_month) the rate
   * itself is the line amount. Tax rides on amount, never on rate directly,
   * so an unpriced (no-quantity) line without a rate still taxes correctly.
   */
  private async priceLine(
    tx: postgres.TransactionSql,
    tenantId: string,
    dto: CreateQuotationLineDto,
  ): Promise<PricedLine> {
    if (!(await this.chargeTypes.exists(tx, tenantId, dto.chargeTypeId))) {
      throw new NotFoundException('Charge type not found');
    }
    let taxRatePct = 0;
    if (dto.taxRateId) {
      const [taxRate] = await tx<{ rate_pct: string }[]>`
        select rate_pct from tax_rates where id = ${dto.taxRateId} and (tenant_id = ${tenantId} or tenant_id is null)
      `;
      if (!taxRate) throw new NotFoundException('Tax rate not found');
      taxRatePct = Number(taxRate.rate_pct);
    }

    const amount = round2((dto.quantity ?? 1) * dto.rate);
    const taxAmount = round2((amount * taxRatePct) / 100);

    return {
      amount,
      taxAmount,
      values: {
        id: randomUUID(),
        tenant_id: tenantId,
        charge_type_id: dto.chargeTypeId,
        description: dto.description,
        basis: dto.basis,
        uom_code: dto.uomCode ?? null,
        quantity: dto.quantity ?? null,
        rate: dto.rate,
        minimum_charge: dto.minimumCharge ?? null,
        free_days: dto.freeDays ?? 0,
        tax_rate_id: dto.taxRateId ?? null,
        sac_code: dto.sacCode ?? null,
        amount,
        sort_order: dto.sortOrder ?? 0,
      },
    };
  }

  private async insertLines(
    tx: postgres.TransactionSql,
    tenantId: string,
    quotationId: string,
    lineDtos: CreateQuotationLineDto[],
  ): Promise<{ subtotal: number; taxTotal: number }> {
    let subtotal = 0;
    let taxTotal = 0;
    for (const dto of lineDtos) {
      const priced = await this.priceLine(tx, tenantId, dto);
      subtotal += priced.amount;
      taxTotal += priced.taxAmount;
      await tx`insert into quotation_lines ${tx({ ...priced.values, quotation_id: quotationId })}`;
    }
    return { subtotal: round2(subtotal), taxTotal: round2(taxTotal) };
  }

  private async fetchWithLines(tx: postgres.TransactionSql, tenantId: string, id: string) {
    const [row] = await tx<QuotationRow[]>`
      select ${tx.unsafe(SELECT_COLUMNS)} from quotations where id = ${id} and tenant_id = ${tenantId}
    `;
    if (!row) return null;
    const lines = await tx<QuotationLineRow[]>`
      select ${tx.unsafe(LINE_SELECT_COLUMNS)} from quotation_lines
      where tenant_id = ${tenantId} and quotation_id = ${id}
      order by sort_order, id
    `;
    return { row, lines };
  }

  async create(actor: AuthenticatedUser, dto: CreateQuotationDto, ipAddress?: string) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      if (dto.warehouseId) {
        const [warehouse] = await tx`
          select 1 from warehouses where id = ${dto.warehouseId} and tenant_id = ${actor.tenantId}
        `;
        if (!warehouse) throw new NotFoundException('Warehouse not found');
      }
      const customerSnapshot = await this.buildCustomerSnapshot(tx, actor.tenantId, dto.customerId);
      const number = await this.numbering.allocateNumberIn(tx, actor.tenantId, 'QUOTATION_GENERATION');

      const id = randomUUID();
      await tx`
        insert into quotations (
          id, tenant_id, number, quotation_date, valid_until, customer_id, warehouse_id,
          customer_snapshot, payment_terms, special_conditions, notes, created_by, updated_by
        ) values (
          ${id}, ${actor.tenantId}, ${number}, ${dto.quotationDate ?? new Date().toISOString().slice(0, 10)},
          ${dto.validUntil ?? null}, ${dto.customerId}, ${dto.warehouseId ?? null},
          ${JSON.stringify(customerSnapshot)}, ${dto.paymentTerms ?? null}, ${dto.specialConditions ?? null},
          ${dto.notes ?? null}, ${actor.userId}, ${actor.userId}
        )
      `;

      const { subtotal, taxTotal } = await this.insertLines(tx, actor.tenantId, id, dto.lines);
      await tx`
        update quotations
        set subtotal = ${subtotal}, tax_total = ${taxTotal}, grand_total = ${round2(subtotal + taxTotal)}
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;

      return this.fetchWithLines(tx, actor.tenantId, id);
    });
    if (!result) throw new NotFoundException('Quotation not found');

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'create',
      entityType: 'quotation',
      entityId: result.row.id,
      newValue: result.row,
      ipAddress,
    });
    return toApi(result.row, result.lines);
  }

  async list(actor: AuthenticatedUser, query: ListQuotationsQuery) {
    const pattern = query.q ? `%${query.q}%` : null;
    const customerFilter = query.customerId ?? null;
    const statusFilter = query.status ?? null;

    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const rows = await tx<QuotationRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)}
        from quotations
        where tenant_id = ${actor.tenantId}
          and (${pattern}::text is null or number ilike ${pattern})
          and (${customerFilter}::uuid is null or customer_id = ${customerFilter})
          and (${statusFilter}::text is null or status = ${statusFilter})
        order by created_at desc
        limit ${query.limit} offset ${query.offset}
      `;
      const [{ count }] = await tx<{ count: string }[]>`
        select count(*)::text as count from quotations
        where tenant_id = ${actor.tenantId}
          and (${pattern}::text is null or number ilike ${pattern})
          and (${customerFilter}::uuid is null or customer_id = ${customerFilter})
          and (${statusFilter}::text is null or status = ${statusFilter})
      `;
      return {
        items: rows.map((row) => toApi(row)),
        total: Number(count),
        limit: query.limit,
        offset: query.offset,
      };
    });
  }

  async get(actor: AuthenticatedUser, id: string) {
    const result = await withTenant(this.sql, actor.tenantId, (tx) => this.fetchWithLines(tx, actor.tenantId, id));
    if (!result) throw new NotFoundException('Quotation not found');
    return toApi(result.row, result.lines);
  }

  async update(actor: AuthenticatedUser, id: string, dto: UpdateQuotationDto, ipAddress?: string) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const [before] = await tx<QuotationRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from quotations
        where id = ${id} and tenant_id = ${actor.tenantId}
        for update
      `;
      if (!before) return null;
      if (before.status !== 'draft') {
        throw new BadRequestException(`Cannot edit a quotation in '${before.status}' status`);
      }

      if (dto.warehouseId) {
        const [warehouse] = await tx`
          select 1 from warehouses where id = ${dto.warehouseId} and tenant_id = ${actor.tenantId}
        `;
        if (!warehouse) throw new NotFoundException('Warehouse not found');
      }

      const customerId = dto.customerId ?? before.customer_id;
      const customerSnapshot =
        dto.customerId !== undefined
          ? await this.buildCustomerSnapshot(tx, actor.tenantId, customerId)
          : before.customer_snapshot;

      await tx`
        update quotations
        set customer_id = ${customerId},
            warehouse_id = ${dto.warehouseId !== undefined ? dto.warehouseId : before.warehouse_id},
            customer_snapshot = ${JSON.stringify(customerSnapshot)},
            quotation_date = ${dto.quotationDate ?? before.quotation_date},
            valid_until = ${dto.validUntil !== undefined ? dto.validUntil : before.valid_until},
            payment_terms = ${dto.paymentTerms !== undefined ? dto.paymentTerms : before.payment_terms},
            special_conditions = ${dto.specialConditions !== undefined ? dto.specialConditions : before.special_conditions},
            notes = ${dto.notes !== undefined ? dto.notes : before.notes},
            updated_by = ${actor.userId},
            updated_at = now()
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;

      if (dto.lines !== undefined) {
        await tx`delete from quotation_lines where tenant_id = ${actor.tenantId} and quotation_id = ${id}`;
        const { subtotal, taxTotal } = await this.insertLines(tx, actor.tenantId, id, dto.lines);
        await tx`
          update quotations
          set subtotal = ${subtotal}, tax_total = ${taxTotal}, grand_total = ${round2(subtotal + taxTotal)}
          where id = ${id} and tenant_id = ${actor.tenantId}
        `;
      }

      const after = await this.fetchWithLines(tx, actor.tenantId, id);
      return { before, after: after!.row, lines: after!.lines };
    });
    if (!result) throw new NotFoundException('Quotation not found');

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'update',
      entityType: 'quotation',
      entityId: id,
      previousValue: result.before,
      newValue: result.after,
      ipAddress,
    });
    return toApi(result.after, result.lines);
  }

  private async transition(
    actor: AuthenticatedUser,
    id: string,
    ipAddress: string | undefined,
    allowedFrom: string[],
    setClauseFor: (tx: postgres.TransactionSql) => Promise<void>,
  ) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const [before] = await tx<QuotationRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from quotations
        where id = ${id} and tenant_id = ${actor.tenantId}
        for update
      `;
      if (!before) return null;
      if (!allowedFrom.includes(before.status)) {
        throw new BadRequestException(
          `Cannot transition a quotation from '${before.status}' (expected one of: ${allowedFrom.join(', ')})`,
        );
      }
      await setClauseFor(tx);
      const after = await this.fetchWithLines(tx, actor.tenantId, id);
      return { before, after: after!.row, lines: after!.lines };
    });
    if (!result) throw new NotFoundException('Quotation not found');

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'status_change',
      entityType: 'quotation',
      entityId: id,
      previousValue: { status: result.before.status },
      newValue: { status: result.after.status },
      ipAddress,
    });
    return toApi(result.after, result.lines);
  }

  send(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['draft'], async (tx) => {
      await tx`update quotations set status = 'sent', sent_at = now() where id = ${id} and tenant_id = ${actor.tenantId}`;
    });
  }

  accept(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['sent'], async (tx) => {
      await tx`update quotations set status = 'accepted', accepted_at = now() where id = ${id} and tenant_id = ${actor.tenantId}`;
    });
  }

  reject(actor: AuthenticatedUser, id: string, dto: RejectQuotationDto, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['sent'], async (tx) => {
      await tx`
        update quotations
        set status = 'rejected', rejected_at = now(), rejection_reason = ${dto.reason}
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;
    });
  }

  cancel(actor: AuthenticatedUser, id: string, ipAddress?: string) {
    return this.transition(actor, id, ipAddress, ['draft', 'sent'], async (tx) => {
      await tx`update quotations set status = 'cancelled' where id = ${id} and tenant_id = ${actor.tenantId}`;
    });
  }
}
