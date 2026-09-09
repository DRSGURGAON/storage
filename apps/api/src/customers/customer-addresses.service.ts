import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { CreateCustomerAddressDto } from './dto/create-customer-address.dto';
import { UpdateCustomerAddressDto } from './dto/update-customer-address.dto';

interface CustomerAddressRow {
  id: string;
  customer_id: string;
  kind: string;
  label: string | null;
  address_line1: string;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  state_code: string | null;
  pincode: string | null;
  gstin: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  is_default: boolean;
  is_active: boolean;
}

const SELECT_COLUMNS = `
  id, customer_id, kind, label, address_line1, address_line2, city, state, state_code,
  pincode, gstin, contact_name, contact_phone, is_default, is_active`;

function toApi(row: CustomerAddressRow) {
  return {
    id: row.id,
    customerId: row.customer_id,
    kind: row.kind,
    label: row.label,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    city: row.city,
    state: row.state,
    stateCode: row.state_code,
    pincode: row.pincode,
    gstin: row.gstin,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    isDefault: row.is_default,
    isActive: row.is_active,
  };
}

/** Blueprint §10: a customer's registered/billing/delivery addresses (schema/10_masters.sql). */
@Injectable()
export class CustomerAddressesService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly audit: AuditService,
  ) {}

  private async assertCustomer(tx: postgres.TransactionSql, tenantId: string, customerId: string) {
    const [customer] = await tx`select 1 from customers where id = ${customerId} and tenant_id = ${tenantId}`;
    if (!customer) throw new NotFoundException('Customer not found');
  }

  /** Only one default address per (customer, kind) -- not a DB constraint, so enforced here, in the same transaction as the write. */
  private async clearOtherDefaults(
    tx: postgres.TransactionSql,
    tenantId: string,
    customerId: string,
    kind: string,
    excludeId?: string,
  ) {
    await tx`
      update customer_addresses
      set is_default = false
      where tenant_id = ${tenantId} and customer_id = ${customerId} and kind = ${kind}
        and is_default = true and id is distinct from ${excludeId ?? null}
    `;
  }

  async create(actor: AuthenticatedUser, customerId: string, dto: CreateCustomerAddressDto, ipAddress?: string) {
    const row = await withTenant(this.sql, actor.tenantId, async (tx) => {
      await this.assertCustomer(tx, actor.tenantId, customerId);
      if (dto.isDefault) {
        await this.clearOtherDefaults(tx, actor.tenantId, customerId, dto.kind);
      }
      const [inserted] = await tx<CustomerAddressRow[]>`
        insert into customer_addresses (
          id, tenant_id, customer_id, kind, label, address_line1, address_line2,
          city, state, state_code, pincode, gstin, contact_name, contact_phone,
          is_default, is_active
        ) values (
          ${randomUUID()}, ${actor.tenantId}, ${customerId}, ${dto.kind}, ${dto.label ?? null},
          ${dto.addressLine1}, ${dto.addressLine2 ?? null}, ${dto.city ?? null}, ${dto.state ?? null},
          ${dto.stateCode ?? null}, ${dto.pincode ?? null}, ${dto.gstin ?? null}, ${dto.contactName ?? null},
          ${dto.contactPhone ?? null}, ${dto.isDefault ?? false}, ${dto.isActive ?? true}
        )
        returning ${tx.unsafe(SELECT_COLUMNS)}
      `;
      return inserted;
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'create',
      entityType: 'customer_address',
      entityId: row.id,
      newValue: row,
      ipAddress,
    });
    return toApi(row);
  }

  async list(actor: AuthenticatedUser, customerId: string) {
    return withTenant(this.sql, actor.tenantId, async (tx) => {
      await this.assertCustomer(tx, actor.tenantId, customerId);
      const rows = await tx<CustomerAddressRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from customer_addresses
        where tenant_id = ${actor.tenantId} and customer_id = ${customerId}
        order by kind, is_default desc, label
      `;
      return rows.map(toApi);
    });
  }

  async update(
    actor: AuthenticatedUser,
    customerId: string,
    id: string,
    dto: UpdateCustomerAddressDto,
    ipAddress?: string,
  ) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const [before] = await tx<CustomerAddressRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from customer_addresses
        where id = ${id} and customer_id = ${customerId} and tenant_id = ${actor.tenantId}
        for update
      `;
      if (!before) return null;

      const effectiveKind = dto.kind ?? before.kind;
      if (dto.isDefault) {
        await this.clearOtherDefaults(tx, actor.tenantId, customerId, effectiveKind, id);
      }

      const [after] = await tx<CustomerAddressRow[]>`
        update customer_addresses
        set kind = ${effectiveKind},
            label = ${dto.label !== undefined ? dto.label : before.label},
            address_line1 = ${dto.addressLine1 ?? before.address_line1},
            address_line2 = ${dto.addressLine2 !== undefined ? dto.addressLine2 : before.address_line2},
            city = ${dto.city !== undefined ? dto.city : before.city},
            state = ${dto.state !== undefined ? dto.state : before.state},
            state_code = ${dto.stateCode !== undefined ? dto.stateCode : before.state_code},
            pincode = ${dto.pincode !== undefined ? dto.pincode : before.pincode},
            gstin = ${dto.gstin !== undefined ? dto.gstin : before.gstin},
            contact_name = ${dto.contactName !== undefined ? dto.contactName : before.contact_name},
            contact_phone = ${dto.contactPhone !== undefined ? dto.contactPhone : before.contact_phone},
            is_default = ${dto.isDefault ?? before.is_default},
            is_active = ${dto.isActive ?? before.is_active}
        where id = ${id} and customer_id = ${customerId} and tenant_id = ${actor.tenantId}
        returning ${tx.unsafe(SELECT_COLUMNS)}
      `;
      return { before, after };
    });
    if (!result) throw new NotFoundException('Address not found');

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'update',
      entityType: 'customer_address',
      entityId: id,
      previousValue: result.before,
      newValue: result.after,
      ipAddress,
    });
    return toApi(result.after);
  }
}
