import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { ListVehiclesQuery } from './dto/list-transport.query';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { TransportersService } from './transporters.service';

interface VehicleRow {
  id: string;
  vehicle_number: string;
  vehicle_type: string | null;
  capacity_value: string | null;
  capacity_uom: string | null;
  transporter_id: string | null;
  is_active: boolean;
}

const SELECT_COLUMNS = `id, vehicle_number, vehicle_type, capacity_value, capacity_uom, transporter_id, is_active`;

const COLUMN_MAP: Record<keyof CreateVehicleDto, string> = {
  vehicleNumber: 'vehicle_number',
  vehicleType: 'vehicle_type',
  capacityValue: 'capacity_value',
  capacityUom: 'capacity_uom',
  transporterId: 'transporter_id',
  isActive: 'is_active',
};

/** schema/10_masters.sql: "normalised uppercase, no spaces". */
function normalizeVehicleNumber(value: string): string {
  return value.toUpperCase().replace(/\s+/g, '');
}

function toColumns(dto: Partial<CreateVehicleDto>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(COLUMN_MAP)) {
    const value = dto[key as keyof CreateVehicleDto];
    if (value === undefined) continue;
    out[column] = key === 'vehicleNumber' ? normalizeVehicleNumber(value as string) : value;
  }
  return out;
}

function toApi(row: VehicleRow) {
  return {
    id: row.id,
    vehicleNumber: row.vehicle_number,
    vehicleType: row.vehicle_type,
    capacityValue: row.capacity_value === null ? null : Number(row.capacity_value),
    capacityUom: row.capacity_uom,
    transporterId: row.transporter_id,
    isActive: row.is_active,
  };
}

/** Blueprint §12: vehicles optionally belong to a transporter (transporter_id is nullable -- an owned fleet works too). */
@Injectable()
export class VehiclesService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly transporters: TransportersService,
    private readonly audit: AuditService,
  ) {}

  async create(actor: AuthenticatedUser, dto: CreateVehicleDto, ipAddress?: string) {
    const row = await withTenant(this.sql, actor.tenantId, async (tx) => {
      if (dto.transporterId && !(await this.transporters.exists(tx, actor.tenantId, dto.transporterId))) {
        throw new NotFoundException('Transporter not found');
      }
      const values = { id: randomUUID(), tenant_id: actor.tenantId, ...toColumns(dto) };
      const [inserted] = await tx<VehicleRow[]>`
        insert into vehicles ${tx(values)}
        returning ${tx.unsafe(SELECT_COLUMNS)}
      `;
      return inserted;
    }).catch((err) => {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException(`Vehicle ${normalizeVehicleNumber(dto.vehicleNumber)} already exists`);
      }
      throw err;
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'create',
      entityType: 'vehicle',
      entityId: row.id,
      newValue: row,
      ipAddress,
    });
    return toApi(row);
  }

  async list(actor: AuthenticatedUser, query: ListVehiclesQuery) {
    const pattern = query.q ? `%${normalizeVehicleNumber(query.q)}%` : null;
    const transporterFilter = query.transporterId ?? null;
    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const rows = await tx<VehicleRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)}
        from vehicles
        where tenant_id = ${actor.tenantId}
          and (${pattern}::text is null or vehicle_number ilike ${pattern})
          and (${transporterFilter}::uuid is null or transporter_id = ${transporterFilter})
        order by vehicle_number
        limit ${query.limit} offset ${query.offset}
      `;
      const [{ count }] = await tx<{ count: string }[]>`
        select count(*)::text as count from vehicles
        where tenant_id = ${actor.tenantId}
          and (${pattern}::text is null or vehicle_number ilike ${pattern})
          and (${transporterFilter}::uuid is null or transporter_id = ${transporterFilter})
      `;
      return { items: rows.map(toApi), total: Number(count), limit: query.limit, offset: query.offset };
    });
  }

  async get(actor: AuthenticatedUser, id: string) {
    const row = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const [found] = await tx<VehicleRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from vehicles
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;
      return found;
    });
    if (!row) throw new NotFoundException('Vehicle not found');
    return toApi(row);
  }

  async update(actor: AuthenticatedUser, id: string, dto: UpdateVehicleDto, ipAddress?: string) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const [before] = await tx<VehicleRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from vehicles
        where id = ${id} and tenant_id = ${actor.tenantId}
        for update
      `;
      if (!before) return null;
      if (dto.transporterId && !(await this.transporters.exists(tx, actor.tenantId, dto.transporterId))) {
        throw new NotFoundException('Transporter not found');
      }
      const patch = toColumns(dto);
      if (Object.keys(patch).length === 0) return { before, after: before };
      const [after] = await tx<VehicleRow[]>`
        update vehicles
        set ${tx(patch)}
        where id = ${id} and tenant_id = ${actor.tenantId}
        returning ${tx.unsafe(SELECT_COLUMNS)}
      `;
      return { before, after };
    }).catch((err) => {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException('That vehicle number already exists');
      }
      throw err;
    });
    if (!result) throw new NotFoundException('Vehicle not found');

    if (result.before !== result.after) {
      await this.audit.record({
        tenantId: actor.tenantId,
        userId: actor.userId,
        userRoleCode: actor.roleCode,
        action: 'update',
        entityType: 'vehicle',
        entityId: id,
        previousValue: result.before,
        newValue: result.after,
        ipAddress,
      });
    }
    return toApi(result.after);
  }
}
