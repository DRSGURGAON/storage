import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { assertWarehouseInScope, loadWarehouseScope } from '../auth/warehouse-scope';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import {
  CreateStorageUnitDto,
  ListStorageUnitsQuery,
  UpdateStorageUnitDto,
} from './dto/storage.dtos';

interface UnitRow {
  id: string;
  warehouse_id: string;
  code: string;
  name: string | null;
  unit_type: string;
  area_sqft: string | null;
  volume_cbm: string | null;
  monthly_rate: string | null;
  status: string;
  is_active: boolean;
  notes: string | null;
  warehouse_name?: string;
  occupied_by?: string | null;
}

const COLUMNS = [
  'id', 'warehouse_id', 'code', 'name', 'unit_type', 'area_sqft',
  'volume_cbm', 'monthly_rate', 'status', 'is_active', 'notes',
] as const;

const SELECT = COLUMNS.join(', ');
/** The same columns, table-qualified, for the list query's join. */
const SELECT_U = COLUMNS.map((c) => `u.${c}`).join(', ');

function toApi(row: UnitRow) {
  return {
    id: row.id,
    warehouseId: row.warehouse_id,
    warehouseName: row.warehouse_name ?? null,
    code: row.code,
    name: row.name,
    unitType: row.unit_type,
    areaSqft: row.area_sqft === null ? null : Number(row.area_sqft),
    volumeCbm: row.volume_cbm === null ? null : Number(row.volume_cbm),
    monthlyRate: row.monthly_rate === null ? null : Number(row.monthly_rate),
    status: row.status,
    isActive: row.is_active,
    notes: row.notes,
    ...(row.occupied_by !== undefined ? { occupiedBy: row.occupied_by } : {}),
  };
}

/**
 * The physical space: a room, a locker, a marked area. Optional to a
 * booking on purpose -- an operator who stacks goods in a shared hall
 * should be able to take a booking on day one without first inventing a
 * numbering scheme for their own floor.
 */
@Injectable()
export class StorageUnitsService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthenticatedUser, query: ListStorageUnitsQuery) {
    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const warehouseId = query.warehouseId ?? null;
      const status = query.status ?? null;
      const search = query.q ? `%${query.q}%` : null;
      const where = tx`
        where u.tenant_id = ${actor.tenantId}
          and (${warehouseId}::uuid is null or u.warehouse_id = ${warehouseId})
          and (${status}::text is null or u.status = ${status})
          and (${scope}::uuid[] is null or u.warehouse_id = any(${scope}))
          and (${search}::text is null or u.code ilike ${search} or u.name ilike ${search})
      `;
      const [{ count }] = await tx<{ count: string }[]>`
        select count(*)::text as count from storage_units u ${where}
      `;
      // The occupant comes from the booking, not a column on the unit: a
      // status field that says "occupied" while no booking points at it is
      // exactly the drift this join avoids.
      const rows = await tx<UnitRow[]>`
        select ${tx.unsafe(SELECT_U)},
               w.name as warehouse_name,
               (select b.number from storage_bookings b
                 where b.storage_unit_id = u.id and b.status = 'in_storage'
                 order by b.created_at desc limit 1) as occupied_by
        from storage_units u
        join warehouses w on w.id = u.warehouse_id
        ${where}
        order by w.name, u.code
        limit ${query.limit} offset ${query.offset}
      `;
      return { total: Number(count), items: rows.map(toApi) };
    });
  }

  async create(actor: AuthenticatedUser, dto: CreateStorageUnitDto, ip?: string) {
    const row = await withTenant(this.sql, actor.tenantId, async (tx) => {
      assertWarehouseInScope(await loadWarehouseScope(tx, actor), dto.warehouseId);
      const [warehouse] = await tx<{ id: string }[]>`
        select id from warehouses where id = ${dto.warehouseId} and tenant_id = ${actor.tenantId}
      `;
      if (!warehouse) throw new NotFoundException('Warehouse not found');

      const [created] = await tx<UnitRow[]>`
        insert into storage_units
          (id, tenant_id, warehouse_id, code, name, unit_type, area_sqft, volume_cbm,
           monthly_rate, notes, created_by, updated_by)
        values
          (${randomUUID()}, ${actor.tenantId}, ${dto.warehouseId}, ${dto.code.trim()},
           ${dto.name ?? null}, ${dto.unitType ?? 'room'}, ${dto.areaSqft ?? null},
           ${dto.volumeCbm ?? null}, ${dto.monthlyRate ?? null}, ${dto.notes ?? null},
           ${actor.userId}, ${actor.userId})
        returning ${tx.unsafe(SELECT)}
      `;
      return created;
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'create',
      entityType: 'storage_unit',
      entityId: row.id,
      newValue: { code: row.code, warehouseId: row.warehouse_id },
      ipAddress: ip,
    });
    return toApi(row);
  }

  async update(actor: AuthenticatedUser, id: string, dto: UpdateStorageUnitDto, ip?: string) {
    const row = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const [before] = await tx<UnitRow[]>`
        select ${tx.unsafe(SELECT)} from storage_units
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;
      if (!before) throw new NotFoundException('Storage unit not found');
      assertWarehouseInScope(await loadWarehouseScope(tx, actor), before.warehouse_id);

      const patch: Record<string, unknown> = { updated_by: actor.userId };
      if (dto.name !== undefined) patch.name = dto.name;
      if (dto.unitType !== undefined) patch.unit_type = dto.unitType;
      if (dto.areaSqft !== undefined) patch.area_sqft = dto.areaSqft;
      if (dto.volumeCbm !== undefined) patch.volume_cbm = dto.volumeCbm;
      if (dto.monthlyRate !== undefined) patch.monthly_rate = dto.monthlyRate;
      if (dto.status !== undefined) patch.status = dto.status;
      if (dto.isActive !== undefined) patch.is_active = dto.isActive;
      if (dto.notes !== undefined) patch.notes = dto.notes;

      const [updated] = await tx<UnitRow[]>`
        update storage_units set ${tx(patch)}, updated_at = now()
        where id = ${id} and tenant_id = ${actor.tenantId}
        returning ${tx.unsafe(SELECT)}
      `;
      return updated;
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'update',
      entityType: 'storage_unit',
      entityId: id,
      newValue: { code: row.code, status: row.status },
      ipAddress: ip,
    });
    return toApi(row);
  }
}
