import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { CreateProductDto } from './dto/create-product.dto';
import { ListProductsQuery } from './dto/list-products.query';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductCategoriesService } from './product-categories.service';
import { UomsService } from './uoms.service';

interface ProductRow {
  id: string;
  customer_id: string | null;
  sku: string;
  name: string;
  description: string | null;
  category_id: string | null;
  brand: string | null;
  hsn_code: string | null;
  uom_code: string;
  weight_kg: string | null;
  length_cm: string | null;
  width_cm: string | null;
  height_cm: string | null;
  volume_cbm: string | null;
  barcode: string | null;
  units_per_package: number | null;
  batch_tracked: boolean;
  serial_tracked: boolean;
  expiry_tracked: boolean;
  storage_basis: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

const SELECT_COLUMNS = `
  id, customer_id, sku, name, description, category_id, brand, hsn_code, uom_code,
  weight_kg, length_cm, width_cm, height_cm, volume_cbm, barcode, units_per_package,
  batch_tracked, serial_tracked, expiry_tracked, storage_basis, is_active,
  created_at, updated_at`;

const COLUMN_MAP: Record<keyof CreateProductDto, string> = {
  sku: 'sku',
  name: 'name',
  description: 'description',
  categoryId: 'category_id',
  brand: 'brand',
  hsnCode: 'hsn_code',
  uomCode: 'uom_code',
  weightKg: 'weight_kg',
  lengthCm: 'length_cm',
  widthCm: 'width_cm',
  heightCm: 'height_cm',
  barcode: 'barcode',
  unitsPerPackage: 'units_per_package',
  batchTracked: 'batch_tracked',
  serialTracked: 'serial_tracked',
  expiryTracked: 'expiry_tracked',
  storageBasis: 'storage_basis',
  customerId: 'customer_id',
  isActive: 'is_active',
};

function toColumns(dto: Partial<CreateProductDto>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(COLUMN_MAP)) {
    const value = dto[key as keyof CreateProductDto];
    if (value !== undefined) out[column] = value;
  }
  return out;
}

/** schema/10_masters.sql: "volume_cbm -- derived, stored for billing". Never trust a client-supplied value. */
function computeVolumeCbm(lengthCm?: number, widthCm?: number, heightCm?: number): number | null {
  if (lengthCm === undefined || widthCm === undefined || heightCm === undefined) return null;
  return (lengthCm * widthCm * heightCm) / 1_000_000;
}

function toApi(row: ProductRow) {
  return {
    id: row.id,
    customerId: row.customer_id,
    sku: row.sku,
    name: row.name,
    description: row.description,
    categoryId: row.category_id,
    brand: row.brand,
    hsnCode: row.hsn_code,
    uomCode: row.uom_code,
    weightKg: row.weight_kg === null ? null : Number(row.weight_kg),
    lengthCm: row.length_cm === null ? null : Number(row.length_cm),
    widthCm: row.width_cm === null ? null : Number(row.width_cm),
    heightCm: row.height_cm === null ? null : Number(row.height_cm),
    volumeCbm: row.volume_cbm === null ? null : Number(row.volume_cbm),
    barcode: row.barcode,
    unitsPerPackage: row.units_per_package,
    batchTracked: row.batch_tracked,
    serialTracked: row.serial_tracked,
    expiryTracked: row.expiry_tracked,
    storageBasis: row.storage_basis,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Blueprint §11: the SKU master every stock/inbound/outbound document auto-fills from. */
@Injectable()
export class ProductsService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly uoms: UomsService,
    private readonly categories: ProductCategoriesService,
    private readonly audit: AuditService,
  ) {}

  async create(actor: AuthenticatedUser, dto: CreateProductDto, ipAddress?: string) {
    const row = await withTenant(this.sql, actor.tenantId, async (tx) => {
      if (!(await this.uoms.exists(tx, actor.tenantId, dto.uomCode))) {
        throw new NotFoundException(`UOM ${dto.uomCode} not found`);
      }
      if (dto.categoryId && !(await this.categories.exists(tx, actor.tenantId, dto.categoryId))) {
        throw new NotFoundException('Category not found');
      }
      if (dto.customerId) {
        const [customer] = await tx`
          select 1 from customers where id = ${dto.customerId} and tenant_id = ${actor.tenantId}
        `;
        if (!customer) throw new NotFoundException('Customer not found');
      }

      const values = {
        id: randomUUID(),
        tenant_id: actor.tenantId,
        ...toColumns(dto),
        volume_cbm: computeVolumeCbm(dto.lengthCm, dto.widthCm, dto.heightCm),
        created_by: actor.userId,
        updated_by: actor.userId,
      };
      const [inserted] = await tx<ProductRow[]>`
        insert into products ${tx(values)}
        returning ${tx.unsafe(SELECT_COLUMNS)}
      `;
      return inserted;
    }).catch((err) => {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException(
          dto.customerId
            ? `SKU ${dto.sku} already exists for this customer`
            : `Shared SKU ${dto.sku} already exists`,
        );
      }
      throw err;
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'create',
      entityType: 'product',
      entityId: row.id,
      newValue: row,
      ipAddress,
    });
    return toApi(row);
  }

  async list(actor: AuthenticatedUser, query: ListProductsQuery) {
    const pattern = query.q ? `%${query.q}%` : null;
    // Three states -- unfiltered, 'shared' (customer_id is null), or one customer's uuid --
    // so unlike `pattern`, a bare `null` can't double as "no filter"; a separate flag
    // keeps the SQL param a real null/uuid (postgres.js rejects a bound JS `undefined`).
    const customerFilterActive = query.customerId !== undefined;
    const customerFilterValue = query.customerId === 'shared' ? null : (query.customerId ?? null);

    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const rows = await tx<ProductRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)}
        from products
        where tenant_id = ${actor.tenantId}
          and (${pattern}::text is null
               or sku ilike ${pattern} or name ilike ${pattern} or barcode ilike ${pattern})
          and (not ${customerFilterActive} or customer_id is not distinct from ${customerFilterValue})
        order by sku
        limit ${query.limit} offset ${query.offset}
      `;
      const [{ count }] = await tx<{ count: string }[]>`
        select count(*)::text as count from products
        where tenant_id = ${actor.tenantId}
          and (${pattern}::text is null
               or sku ilike ${pattern} or name ilike ${pattern} or barcode ilike ${pattern})
          and (not ${customerFilterActive} or customer_id is not distinct from ${customerFilterValue})
      `;
      return { items: rows.map(toApi), total: Number(count), limit: query.limit, offset: query.offset };
    });
  }

  async get(actor: AuthenticatedUser, id: string) {
    const row = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const [found] = await tx<ProductRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from products
        where id = ${id} and tenant_id = ${actor.tenantId}
      `;
      return found;
    });
    if (!row) throw new NotFoundException('Product not found');
    return toApi(row);
  }

  async update(actor: AuthenticatedUser, id: string, dto: UpdateProductDto, ipAddress?: string) {
    const result = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const [before] = await tx<ProductRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from products
        where id = ${id} and tenant_id = ${actor.tenantId}
        for update
      `;
      if (!before) return null;

      if (dto.uomCode !== undefined && !(await this.uoms.exists(tx, actor.tenantId, dto.uomCode))) {
        throw new NotFoundException(`UOM ${dto.uomCode} not found`);
      }
      if (dto.categoryId && !(await this.categories.exists(tx, actor.tenantId, dto.categoryId))) {
        throw new NotFoundException('Category not found');
      }
      if (dto.customerId) {
        const [customer] = await tx`
          select 1 from customers where id = ${dto.customerId} and tenant_id = ${actor.tenantId}
        `;
        if (!customer) throw new NotFoundException('Customer not found');
      }

      const patch = toColumns(dto);
      if (Object.keys(patch).length === 0) return { before, after: before };

      const lengthCm = dto.lengthCm ?? (before.length_cm === null ? undefined : Number(before.length_cm));
      const widthCm = dto.widthCm ?? (before.width_cm === null ? undefined : Number(before.width_cm));
      const heightCm = dto.heightCm ?? (before.height_cm === null ? undefined : Number(before.height_cm));
      patch.volume_cbm = computeVolumeCbm(lengthCm, widthCm, heightCm);

      const [after] = await tx<ProductRow[]>`
        update products
        set ${tx({ ...patch, updated_by: actor.userId })}, updated_at = now()
        where id = ${id} and tenant_id = ${actor.tenantId}
        returning ${tx.unsafe(SELECT_COLUMNS)}
      `;
      return { before, after };
    }).catch((err) => {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException('That SKU already exists for this scope');
      }
      throw err;
    });
    if (!result) throw new NotFoundException('Product not found');

    if (result.before !== result.after) {
      await this.audit.record({
        tenantId: actor.tenantId,
        userId: actor.userId,
        userRoleCode: actor.roleCode,
        action: 'update',
        entityType: 'product',
        entityId: id,
        previousValue: result.before,
        newValue: result.after,
        ipAddress,
      });
    }
    return toApi(result.after);
  }
}
