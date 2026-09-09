import {
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
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';

interface WarehouseRow {
  id: string;
  code: string;
  name: string;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  state_code: string | null;
  pincode: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  gstin: string | null;
  capacity_value: string | null;
  capacity_uom: string | null;
  area_sqft: string | null;
  manager_name: string | null;
  working_hours: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

const COLS = `
  id, code, name, address_line1, address_line2, city, state, state_code, pincode,
  contact_phone, contact_email, gstin, capacity_value, capacity_uom, area_sqft,
  manager_name, working_hours, is_active, created_at, updated_at`;

const COLUMN_MAP: Record<keyof CreateWarehouseDto, string> = {
  code: 'code',
  name: 'name',
  addressLine1: 'address_line1',
  addressLine2: 'address_line2',
  city: 'city',
  state: 'state',
  stateCode: 'state_code',
  pincode: 'pincode',
  contactPhone: 'contact_phone',
  contactEmail: 'contact_email',
  gstin: 'gstin',
  capacityValue: 'capacity_value',
  capacityUom: 'capacity_uom',
  areaSqft: 'area_sqft',
  managerName: 'manager_name',
  workingHours: 'working_hours',
  isActive: 'is_active',
};

@Injectable()
export class WarehousesService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly audit: AuditService,
  ) {}

  async create(actor: AuthenticatedUser, dto: CreateWarehouseDto, ipAddress?: string) {
    let row: WarehouseRow;
    try {
      row = await withTenant(this.sql, actor.tenantId, async (tx) => {
        const [inserted] = await tx<WarehouseRow[]>`
          insert into warehouses ${tx({
            id: randomUUID(),
            tenant_id: actor.tenantId,
            ...toColumns(dto),
            created_by: actor.userId,
            updated_by: actor.userId,
          })}
          returning ${tx.unsafe(COLS)}
        `;
        return inserted;
      });
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException(`Warehouse code ${dto.code} is already in use`);
      }
      throw err;
    }
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, userRoleCode: actor.roleCode,
      action: 'create', entityType: 'warehouse', entityId: row.id, newValue: row, ipAddress,
    });
    return toApi(row);
  }

  async list(actor: AuthenticatedUser) {
    const rows = await withTenant(this.sql, actor.tenantId, (tx) => tx<WarehouseRow[]>`
      select ${tx.unsafe(COLS)} from warehouses
      where tenant_id = ${actor.tenantId} order by code
    `);
    return rows.map(toApi);
  }

  async get(actor: AuthenticatedUser, id: string) {
    const row = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const [found] = await tx<WarehouseRow[]>`
        select ${tx.unsafe(COLS)} from warehouses where id = ${id} and tenant_id = ${actor.tenantId}
      `;
      return found;
    });
    if (!row) throw new NotFoundException('Warehouse not found');
    return toApi(row);
  }

  async update(actor: AuthenticatedUser, id: string, dto: UpdateWarehouseDto, ipAddress?: string) {
    const patch = toColumns(dto);
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const [before] = await tx<WarehouseRow[]>`
        select ${tx.unsafe(COLS)} from warehouses
        where id = ${id} and tenant_id = ${actor.tenantId} for update
      `;
      if (!before) return null;
      if (Object.keys(patch).length === 0) return { before, after: before };
      const [after] = await tx<WarehouseRow[]>`
        update warehouses set ${tx({ ...patch, updated_by: actor.userId })}, updated_at = now()
        where id = ${id} and tenant_id = ${actor.tenantId}
        returning ${tx.unsafe(COLS)}
      `;
      return { before, after };
    });
    if (!result) throw new NotFoundException('Warehouse not found');
    if (result.before !== result.after) {
      await this.audit.record({
        tenantId: actor.tenantId, userId: actor.userId, userRoleCode: actor.roleCode,
        action: 'update', entityType: 'warehouse', entityId: id,
        previousValue: result.before, newValue: result.after, ipAddress,
      });
    }
    return toApi(result.after);
  }
}

function toColumns(dto: Partial<CreateWarehouseDto>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(COLUMN_MAP)) {
    const value = dto[key as keyof CreateWarehouseDto];
    if (value !== undefined) out[column] = value;
  }
  return out;
}

function toApi(r: WarehouseRow) {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    addressLine1: r.address_line1,
    addressLine2: r.address_line2,
    city: r.city,
    state: r.state,
    stateCode: r.state_code,
    pincode: r.pincode,
    contactPhone: r.contact_phone,
    contactEmail: r.contact_email,
    gstin: r.gstin,
    capacityValue: r.capacity_value === null ? null : Number(r.capacity_value),
    capacityUom: r.capacity_uom,
    areaSqft: r.area_sqft === null ? null : Number(r.area_sqft),
    managerName: r.manager_name,
    workingHours: r.working_hours,
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
