import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { CreateCustomerContactDto } from './dto/create-customer-contact.dto';
import { UpdateCustomerContactDto } from './dto/update-customer-contact.dto';

interface CustomerContactRow {
  id: string;
  customer_id: string;
  name: string;
  designation: string | null;
  mobile: string | null;
  email: string | null;
  is_primary: boolean;
  receives_documents: boolean;
}

const SELECT_COLUMNS = `id, customer_id, name, designation, mobile, email, is_primary, receives_documents`;

function toApi(row: CustomerContactRow) {
  return {
    id: row.id,
    customerId: row.customer_id,
    name: row.name,
    designation: row.designation,
    mobile: row.mobile,
    email: row.email,
    isPrimary: row.is_primary,
    receivesDocuments: row.receives_documents,
  };
}

/** Blueprint §10: a customer's contacts, one of whom may be flagged primary (notification recipient by default). */
@Injectable()
export class CustomerContactsService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly audit: AuditService,
  ) {}

  private async assertCustomer(tx: postgres.TransactionSql, tenantId: string, customerId: string) {
    const [customer] = await tx`select 1 from customers where id = ${customerId} and tenant_id = ${tenantId}`;
    if (!customer) throw new NotFoundException('Customer not found');
  }

  /** Only one primary contact per customer -- not a DB constraint, so enforced here, in the same transaction as the write. */
  private async clearOtherPrimaries(
    tx: postgres.TransactionSql,
    tenantId: string,
    customerId: string,
    excludeId?: string,
  ) {
    await tx`
      update customer_contacts
      set is_primary = false
      where tenant_id = ${tenantId} and customer_id = ${customerId}
        and is_primary = true and id is distinct from ${excludeId ?? null}
    `;
  }

  async create(actor: AuthenticatedUser, customerId: string, dto: CreateCustomerContactDto, ipAddress?: string) {
    const row = await withTenant(this.sql, actor.tenantId, async (tx) => {
      await this.assertCustomer(tx, actor.tenantId, customerId);
      if (dto.isPrimary) {
        await this.clearOtherPrimaries(tx, actor.tenantId, customerId);
      }
      const [inserted] = await tx<CustomerContactRow[]>`
        insert into customer_contacts (
          id, tenant_id, customer_id, name, designation, mobile, email, is_primary, receives_documents
        ) values (
          ${randomUUID()}, ${actor.tenantId}, ${customerId}, ${dto.name}, ${dto.designation ?? null},
          ${dto.mobile ?? null}, ${dto.email ?? null}, ${dto.isPrimary ?? false}, ${dto.receivesDocuments ?? true}
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
      entityType: 'customer_contact',
      entityId: row.id,
      newValue: row,
      ipAddress,
    });
    return toApi(row);
  }

  async list(actor: AuthenticatedUser, customerId: string) {
    return withTenant(this.sql, actor.tenantId, async (tx) => {
      await this.assertCustomer(tx, actor.tenantId, customerId);
      const rows = await tx<CustomerContactRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from customer_contacts
        where tenant_id = ${actor.tenantId} and customer_id = ${customerId}
        order by is_primary desc, name
      `;
      return rows.map(toApi);
    });
  }

  async update(
    actor: AuthenticatedUser,
    customerId: string,
    id: string,
    dto: UpdateCustomerContactDto,
    ipAddress?: string,
  ) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const [before] = await tx<CustomerContactRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from customer_contacts
        where id = ${id} and customer_id = ${customerId} and tenant_id = ${actor.tenantId}
        for update
      `;
      if (!before) return null;

      if (dto.isPrimary) {
        await this.clearOtherPrimaries(tx, actor.tenantId, customerId, id);
      }

      const [after] = await tx<CustomerContactRow[]>`
        update customer_contacts
        set name = ${dto.name ?? before.name},
            designation = ${dto.designation !== undefined ? dto.designation : before.designation},
            mobile = ${dto.mobile !== undefined ? dto.mobile : before.mobile},
            email = ${dto.email !== undefined ? dto.email : before.email},
            is_primary = ${dto.isPrimary ?? before.is_primary},
            receives_documents = ${dto.receivesDocuments ?? before.receives_documents}
        where id = ${id} and customer_id = ${customerId} and tenant_id = ${actor.tenantId}
        returning ${tx.unsafe(SELECT_COLUMNS)}
      `;
      return { before, after };
    });
    if (!result) throw new NotFoundException('Contact not found');

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'update',
      entityType: 'customer_contact',
      entityId: id,
      previousValue: result.before,
      newValue: result.after,
      ipAddress,
    });
    return toApi(result.after);
  }
}
