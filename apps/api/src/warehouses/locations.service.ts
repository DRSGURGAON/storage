import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { CreateLocationDto, LOCATION_LEVELS } from './dto/create-location.dto';
import { ListLocationsQuery } from './dto/list-locations.query';
import { UpdateLocationDto } from './dto/update-location.dto';

interface LocationRow {
  id: string;
  warehouse_id: string;
  parent_id: string | null;
  level: string;
  segment: string;
  full_code: string;
  name: string | null;
  capacity_value: string | null;
  capacity_uom: string | null;
  is_pickable: boolean;
  is_active: boolean;
  barcode_value: string | null;
  created_at: Date;
}

const COLS = `
  id, warehouse_id, parent_id, level, segment, full_code, name, capacity_value,
  capacity_uom, is_pickable, is_active, barcode_value, created_at`;

/**
 * Blueprint §9: Warehouse -> Zone -> Rack -> Row -> Bin -> Pallet, every
 * location with a unique materialised code like WH01-A-R04-B15-P003. The
 * blueprint's own example has no Row, so the rule enforced here is
 * "deeper than the parent", not "exactly one level deeper".
 */
@Injectable()
export class LocationsService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly audit: AuditService,
  ) {}

  async create(actor: AuthenticatedUser, warehouseId: string, dto: CreateLocationDto, ipAddress?: string) {
    const depth = LOCATION_LEVELS.indexOf(dto.level);
    if (dto.level === 'zone' && dto.parentId) {
      throw new BadRequestException('A zone sits directly under the warehouse and has no parent');
    }
    if (dto.level !== 'zone' && !dto.parentId) {
      throw new BadRequestException(`A ${dto.level} needs a parent location`);
    }

    let row: LocationRow;
    try {
      row = await withTenant(this.sql, actor.tenantId, async (tx) => {
        const [warehouse] = await tx<{ code: string }[]>`
          select code from warehouses where id = ${warehouseId} and tenant_id = ${actor.tenantId}
        `;
        if (!warehouse) throw new NotFoundException('Warehouse not found');

        let prefix = warehouse.code;
        if (dto.parentId) {
          const [parent] = await tx<{ level: string; full_code: string; warehouse_id: string }[]>`
            select level, full_code, warehouse_id from locations
            where id = ${dto.parentId} and tenant_id = ${actor.tenantId}
          `;
          if (!parent || parent.warehouse_id !== warehouseId) {
            throw new BadRequestException('Parent location not found in this warehouse');
          }
          if (LOCATION_LEVELS.indexOf(parent.level as never) >= depth) {
            throw new BadRequestException(
              `A ${dto.level} cannot sit under a ${parent.level}; the parent must be a shallower level`,
            );
          }
          prefix = parent.full_code;
        }
        const fullCode = `${prefix}-${dto.segment}`;

        const [inserted] = await tx<LocationRow[]>`
          insert into locations ${tx({
            id: randomUUID(),
            tenant_id: actor.tenantId,
            warehouse_id: warehouseId,
            parent_id: dto.parentId ?? null,
            level: dto.level,
            segment: dto.segment,
            full_code: fullCode,
            name: dto.name ?? null,
            capacity_value: dto.capacityValue ?? null,
            capacity_uom: dto.capacityUom ?? null,
            is_pickable: dto.isPickable ?? true,
            barcode_value: fullCode,
          })}
          returning ${tx.unsafe(COLS)}
        `;
        return inserted;
      });
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException(`Segment ${dto.segment} already exists at that position`);
      }
      throw err;
    }

    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, userRoleCode: actor.roleCode,
      action: 'create', entityType: 'location', entityId: row.id, newValue: row, ipAddress,
    });
    return toApi(row);
  }

  async list(actor: AuthenticatedUser, warehouseId: string, query: ListLocationsQuery) {
    const pattern = query.q ? `%${query.q}%` : null;
    const level = query.level ?? null;
    const parentFilter = query.parentId ?? null; // 'root' => zones only
    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const [warehouse] = await tx`
        select id from warehouses where id = ${warehouseId} and tenant_id = ${actor.tenantId}
      `;
      if (!warehouse) throw new NotFoundException('Warehouse not found');
      const rows = await tx<LocationRow[]>`
        select ${tx.unsafe(COLS)} from locations
        where tenant_id = ${actor.tenantId} and warehouse_id = ${warehouseId}
          and (${level}::text is null or level = ${level})
          and (${parentFilter}::text is null
               or (${parentFilter} = 'root' and parent_id is null)
               or parent_id::text = ${parentFilter})
          and (${pattern}::text is null or full_code ilike ${pattern} or name ilike ${pattern})
        order by full_code
      `;
      return rows.map(toApi);
    });
  }

  async update(actor: AuthenticatedUser, warehouseId: string, id: string, dto: UpdateLocationDto, ipAddress?: string) {
    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.capacityValue !== undefined) patch.capacity_value = dto.capacityValue;
    if (dto.capacityUom !== undefined) patch.capacity_uom = dto.capacityUom;
    if (dto.isPickable !== undefined) patch.is_pickable = dto.isPickable;
    if (dto.isActive !== undefined) patch.is_active = dto.isActive;

    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const [before] = await tx<LocationRow[]>`
        select ${tx.unsafe(COLS)} from locations
        where id = ${id} and warehouse_id = ${warehouseId} and tenant_id = ${actor.tenantId} for update
      `;
      if (!before) return null;
      if (Object.keys(patch).length === 0) return { before, after: before };
      const [after] = await tx<LocationRow[]>`
        update locations set ${tx(patch)}
        where id = ${id} and tenant_id = ${actor.tenantId}
        returning ${tx.unsafe(COLS)}
      `;
      return { before, after };
    });
    if (!result) throw new NotFoundException('Location not found');
    if (result.before !== result.after) {
      await this.audit.record({
        tenantId: actor.tenantId, userId: actor.userId, userRoleCode: actor.roleCode,
        action: 'update', entityType: 'location', entityId: id,
        previousValue: result.before, newValue: result.after, ipAddress,
      });
    }
    return toApi(result.after);
  }
}

function toApi(r: LocationRow) {
  return {
    id: r.id,
    warehouseId: r.warehouse_id,
    parentId: r.parent_id,
    level: r.level,
    segment: r.segment,
    fullCode: r.full_code,
    name: r.name,
    capacityValue: r.capacity_value === null ? null : Number(r.capacity_value),
    capacityUom: r.capacity_uom,
    isPickable: r.is_pickable,
    isActive: r.is_active,
    barcodeValue: r.barcode_value,
    createdAt: r.created_at,
  };
}
