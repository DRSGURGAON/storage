import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { CreateDriverDto } from './dto/create-driver.dto';
import { ListDriversQuery } from './dto/list-transport.query';
import { UpdateDriverDto } from './dto/update-driver.dto';
import { TransportersService } from './transporters.service';

interface DriverRow {
  id: string;
  name: string;
  mobile: string | null;
  license_number: string | null;
  license_expiry: string | null;
  transporter_id: string | null;
  is_active: boolean;
}

const SELECT_COLUMNS = `id, name, mobile, license_number, license_expiry, transporter_id, is_active`;

const COLUMN_MAP: Record<keyof CreateDriverDto, string> = {
  name: 'name',
  mobile: 'mobile',
  licenseNumber: 'license_number',
  licenseExpiry: 'license_expiry',
  transporterId: 'transporter_id',
  isActive: 'is_active',
};

function toColumns(dto: Partial<CreateDriverDto>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(COLUMN_MAP)) {
    const value = dto[key as keyof CreateDriverDto];
    if (value !== undefined) out[column] = value;
  }
  return out;
}

function toApi(row: DriverRow) {
  return {
    id: row.id,
    name: row.name,
    mobile: row.mobile,
    licenseNumber: row.license_number,
    licenseExpiry: row.license_expiry,
    transporterId: row.transporter_id,
    isActive: row.is_active,
  };
}

/** Blueprint §12: no unique constraint in schema/10_masters.sql -- unlike transporters/vehicles, duplicate names/mobiles are allowed. */
@Injectable()
export class DriversService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly transporters: TransportersService,
    private readonly audit: AuditService,
  ) {}

  async create(actor: AuthenticatedUser, dto: CreateDriverDto, ipAddress?: string) {
    const row = await withTenant(this.sql, actor.tenantId, async (tx) => {
      if (dto.transporterId && !(await this.transporters.exists(tx, actor.tenantId, dto.transporterId))) {
        throw new NotFoundException('Transporter not found');
      }
      const values = { id: randomUUID(), tenant_id: actor.tenantId, ...toColumns(dto) };
      const [inserted] = await tx<DriverRow[]>`
        insert into drivers ${tx(values)}
        returning ${tx.unsafe(SELECT_COLUMNS)}
      `;
      return inserted;
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'create',
      entityType: 'driver',
      entityId: row.id,
      newValue: row,
      ipAddress,
    });
    return toApi(row);
  }

  async list(actor: AuthenticatedUser, query: ListDriversQuery) {
    const pattern = query.q ? `%${query.q}%` : null;
    const transporterFilter = query.transporterId ?? null;
    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const rows = await tx<DriverRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)}
        from drivers
        where tenant_id = ${actor.tenantId}
          and (${pattern}::text is null or name ilike ${pattern} or mobile ilike ${pattern})
          and (${transporterFilter}::uuid is null or transporter_id = ${transporterFilter})
        order by name
        limit ${query.limit} offset ${query.offset}
      `;
      const [{ count }] = await tx<{ count: string }[]>`
        select count(*)::text as count from drivers
        where tenant_id = ${actor.tenantId}
          and (${pattern}::text is null or name ilike ${pattern} or mobile ilike ${pattern})
          and (${transporterFilter}::uuid is null or transporter_id = ${transporterFilter})
      `;
      return { items: rows.map(toApi), total: Number(count), limit: query.limit, offset: query.offset };
    });
  }

  async get(actor: AuthenticatedUser, id: string) {
    const row = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const [found] = await tx<DriverRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from drivers
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;
      return found;
    });
    if (!row) throw new NotFoundException('Driver not found');
    return toApi(row);
  }

  async update(actor: AuthenticatedUser, id: string, dto: UpdateDriverDto, ipAddress?: string) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const [before] = await tx<DriverRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from drivers
        where id = ${id} and tenant_id = ${actor.tenantId}
        for update
      `;
      if (!before) return null;
      if (dto.transporterId && !(await this.transporters.exists(tx, actor.tenantId, dto.transporterId))) {
        throw new NotFoundException('Transporter not found');
      }
      const patch = toColumns(dto);
      if (Object.keys(patch).length === 0) return { before, after: before };
      const [after] = await tx<DriverRow[]>`
        update drivers
        set ${tx(patch)}
        where id = ${id} and tenant_id = ${actor.tenantId}
        returning ${tx.unsafe(SELECT_COLUMNS)}
      `;
      return { before, after };
    });
    if (!result) throw new NotFoundException('Driver not found');

    if (result.before !== result.after) {
      await this.audit.record({
        tenantId: actor.tenantId,
        userId: actor.userId,
        userRoleCode: actor.roleCode,
        action: 'update',
        entityType: 'driver',
        entityId: id,
        previousValue: result.before,
        newValue: result.after,
        ipAddress,
      });
    }
    return toApi(result.after);
  }
}
