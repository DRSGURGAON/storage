import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { CreateTransporterDto } from './dto/create-transporter.dto';
import { ListTransportersQuery } from './dto/list-transport.query';
import { UpdateTransporterDto } from './dto/update-transporter.dto';

interface TransporterRow {
  id: string;
  name: string;
  gstin: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  email: string | null;
  address: string | null;
  is_active: boolean;
}

const SELECT_COLUMNS = `id, name, gstin, contact_name, contact_phone, email, address, is_active`;

const COLUMN_MAP: Record<keyof CreateTransporterDto, string> = {
  name: 'name',
  gstin: 'gstin',
  contactName: 'contact_name',
  contactPhone: 'contact_phone',
  email: 'email',
  address: 'address',
  isActive: 'is_active',
};

function toColumns(dto: Partial<CreateTransporterDto>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(COLUMN_MAP)) {
    const value = dto[key as keyof CreateTransporterDto];
    if (value !== undefined) out[column] = value;
  }
  return out;
}

function toApi(row: TransporterRow) {
  return {
    id: row.id,
    name: row.name,
    gstin: row.gstin,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    email: row.email,
    address: row.address,
    isActive: row.is_active,
  };
}

/** Blueprint §12: the transport master, shared by vehicles and drivers via transporter_id. */
@Injectable()
export class TransportersService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly audit: AuditService,
  ) {}

  async create(actor: AuthenticatedUser, dto: CreateTransporterDto, ipAddress?: string) {
    const row = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const values = { id: randomUUID(), tenant_id: actor.tenantId, ...toColumns(dto) };
      const [inserted] = await tx<TransporterRow[]>`
        insert into transporters ${tx(values)}
        returning ${tx.unsafe(SELECT_COLUMNS)}
      `;
      return inserted;
    }).catch((err) => {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException(`Transporter ${dto.name} already exists`);
      }
      throw err;
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'create',
      entityType: 'transporter',
      entityId: row.id,
      newValue: row,
      ipAddress,
    });
    return toApi(row);
  }

  async list(actor: AuthenticatedUser, query: ListTransportersQuery) {
    const pattern = query.q ? `%${query.q}%` : null;
    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const rows = await tx<TransporterRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)}
        from transporters
        where tenant_id = ${actor.tenantId}
          and (${pattern}::text is null or name ilike ${pattern} or gstin ilike ${pattern})
        order by name
        limit ${query.limit} offset ${query.offset}
      `;
      const [{ count }] = await tx<{ count: string }[]>`
        select count(*)::text as count from transporters
        where tenant_id = ${actor.tenantId}
          and (${pattern}::text is null or name ilike ${pattern} or gstin ilike ${pattern})
      `;
      return { items: rows.map(toApi), total: Number(count), limit: query.limit, offset: query.offset };
    });
  }

  async get(actor: AuthenticatedUser, id: string) {
    const row = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const [found] = await tx<TransporterRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from transporters
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;
      return found;
    });
    if (!row) throw new NotFoundException('Transporter not found');
    return toApi(row);
  }

  async update(actor: AuthenticatedUser, id: string, dto: UpdateTransporterDto, ipAddress?: string) {
    const patch = toColumns(dto);
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const [before] = await tx<TransporterRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from transporters
        where id = ${id} and tenant_id = ${actor.tenantId}
        for update
      `;
      if (!before) return null;
      if (Object.keys(patch).length === 0) return { before, after: before };
      const [after] = await tx<TransporterRow[]>`
        update transporters
        set ${tx(patch)}
        where id = ${id} and tenant_id = ${actor.tenantId}
        returning ${tx.unsafe(SELECT_COLUMNS)}
      `;
      return { before, after };
    }).catch((err) => {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException(`Transporter ${dto.name} already exists`);
      }
      throw err;
    });
    if (!result) throw new NotFoundException('Transporter not found');

    if (result.before !== result.after) {
      await this.audit.record({
        tenantId: actor.tenantId,
        userId: actor.userId,
        userRoleCode: actor.roleCode,
        action: 'update',
        entityType: 'transporter',
        entityId: id,
        previousValue: result.before,
        newValue: result.after,
        ipAddress,
      });
    }
    return toApi(result.after);
  }

  /** Used by VehiclesService/DriversService to validate transporter_id before insert/update. */
  async exists(tx: postgres.TransactionSql, tenantId: string, id: string): Promise<boolean> {
    const [row] = await tx`select 1 from transporters where id = ${id} and tenant_id = ${tenantId}`;
    return Boolean(row);
  }
}
