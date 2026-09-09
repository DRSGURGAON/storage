import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { NumberingService } from '../numbering/numbering.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { ListCustomersQuery } from './dto/list-customers.query';
import { UpdateCustomerDto } from './dto/update-customer.dto';

interface CustomerRow {
  id: string;
  code: string;
  name: string;
  legal_name: string | null;
  customer_type: string | null;
  contact_person: string | null;
  mobile: string | null;
  email: string | null;
  gstin: string | null;
  pan: string | null;
  state: string | null;
  state_code: string | null;
  place_of_supply: string | null;
  default_warehouse_id: string | null;
  default_rate_card_id: string | null;
  billing_cycle: string;
  credit_days: number;
  payment_terms: string | null;
  minimum_billing_amount: string | null;
  kyc_status: string;
  is_active: boolean;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

const SELECT_COLUMNS = `
  id, code, name, legal_name, customer_type, contact_person, mobile, email,
  gstin, pan, state, state_code, place_of_supply, default_warehouse_id,
  default_rate_card_id, billing_cycle, credit_days, payment_terms,
  minimum_billing_amount, kyc_status, is_active, notes, created_at, updated_at`;

/** Blueprint §10: the customer master is the single source of truth every downstream document auto-fills from. */
@Injectable()
export class CustomersService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
  ) {}

  async create(actor: AuthenticatedUser, dto: CreateCustomerDto, ipAddress?: string) {
    const row = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const code = await this.numbering.allocateNumberIn(tx, actor.tenantId, 'CUSTOMER');
      const values = {
        id: randomUUID(),
        tenant_id: actor.tenantId,
        code,
        ...toColumns(dto),
        created_by: actor.userId,
        updated_by: actor.userId,
      };
      const [inserted] = await tx<CustomerRow[]>`
        insert into customers ${tx(values)}
        returning ${tx.unsafe(SELECT_COLUMNS)}
      `;
      return inserted;
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'create',
      entityType: 'customer',
      entityId: row.id,
      newValue: row,
      ipAddress,
    });
    return toApi(row);
  }

  async list(actor: AuthenticatedUser, query: ListCustomersQuery) {
    const pattern = query.q ? `%${query.q}%` : null;
    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const rows = await tx<CustomerRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)}
        from customers
        where tenant_id = ${actor.tenantId}
          and (${pattern}::text is null
               or name ilike ${pattern} or code ilike ${pattern}
               or gstin ilike ${pattern} or mobile ilike ${pattern})
        order by name
        limit ${query.limit} offset ${query.offset}
      `;
      const [{ count }] = await tx<{ count: string }[]>`
        select count(*)::text as count from customers
        where tenant_id = ${actor.tenantId}
          and (${pattern}::text is null
               or name ilike ${pattern} or code ilike ${pattern}
               or gstin ilike ${pattern} or mobile ilike ${pattern})
      `;
      return { items: rows.map(toApi), total: Number(count), limit: query.limit, offset: query.offset };
    });
  }

  async get(actor: AuthenticatedUser, id: string) {
    const row = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const [found] = await tx<CustomerRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from customers
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;
      return found;
    });
    if (!row) throw new NotFoundException('Customer not found');
    return toApi(row);
  }

  async update(actor: AuthenticatedUser, id: string, dto: UpdateCustomerDto, ipAddress?: string) {
    const patch = toColumns(dto);
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const [before] = await tx<CustomerRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from customers
        where id = ${id} and tenant_id = ${actor.tenantId}
        for update
      `;
      if (!before) return null;
      if (Object.keys(patch).length === 0) return { before, after: before };
      const [after] = await tx<CustomerRow[]>`
        update customers
        set ${tx({ ...patch, updated_by: actor.userId })}, updated_at = now()
        where id = ${id} and tenant_id = ${actor.tenantId}
        returning ${tx.unsafe(SELECT_COLUMNS)}
      `;
      return { before, after };
    });
    if (!result) throw new NotFoundException('Customer not found');

    if (result.before !== result.after) {
      await this.audit.record({
        tenantId: actor.tenantId,
        userId: actor.userId,
        userRoleCode: actor.roleCode,
        action: 'update',
        entityType: 'customer',
        entityId: id,
        previousValue: result.before,
        newValue: result.after,
        ipAddress,
      });
    }
    return toApi(result.after);
  }
}

const COLUMN_MAP: Record<keyof CreateCustomerDto, string> = {
  name: 'name',
  legalName: 'legal_name',
  customerType: 'customer_type',
  contactPerson: 'contact_person',
  mobile: 'mobile',
  email: 'email',
  gstin: 'gstin',
  pan: 'pan',
  state: 'state',
  stateCode: 'state_code',
  placeOfSupply: 'place_of_supply',
  defaultWarehouseId: 'default_warehouse_id',
  billingCycle: 'billing_cycle',
  creditDays: 'credit_days',
  paymentTerms: 'payment_terms',
  minimumBillingAmount: 'minimum_billing_amount',
  isActive: 'is_active',
  notes: 'notes',
};

function toColumns(dto: Partial<CreateCustomerDto>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(COLUMN_MAP)) {
    const value = dto[key as keyof CreateCustomerDto];
    if (value !== undefined) out[column] = value;
  }
  return out;
}

function toApi(row: CustomerRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    legalName: row.legal_name,
    customerType: row.customer_type,
    contactPerson: row.contact_person,
    mobile: row.mobile,
    email: row.email,
    gstin: row.gstin,
    pan: row.pan,
    state: row.state,
    stateCode: row.state_code,
    placeOfSupply: row.place_of_supply,
    defaultWarehouseId: row.default_warehouse_id,
    defaultRateCardId: row.default_rate_card_id,
    billingCycle: row.billing_cycle,
    creditDays: row.credit_days,
    paymentTerms: row.payment_terms,
    minimumBillingAmount: row.minimum_billing_amount === null ? null : Number(row.minimum_billing_amount),
    kycStatus: row.kyc_status,
    isActive: row.is_active,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
