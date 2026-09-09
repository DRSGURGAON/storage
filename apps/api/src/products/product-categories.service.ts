import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { CreateCategoryDto } from './dto/list-products.query';

interface CategoryRow {
  id: string;
  name: string;
  parent_id: string | null;
}

@Injectable()
export class ProductCategoriesService {
  constructor(@Inject(PG_CONNECTION) private readonly sql: postgres.Sql) {}

  async list(tenantId: string) {
    const rows = await withTenant(this.sql, tenantId, (tx) => tx<CategoryRow[]>`
      select id, name, parent_id from product_categories where tenant_id = ${tenantId} order by name
    `);
    return rows.map((r) => ({ id: r.id, name: r.name, parentId: r.parent_id }));
  }

  async create(tenantId: string, dto: CreateCategoryDto) {
    try {
      const row = await withTenant(this.sql, tenantId, async (tx) => {
        if (dto.parentId) {
          const [parent] = await tx`
            select 1 from product_categories where id = ${dto.parentId} and tenant_id = ${tenantId}
          `;
          if (!parent) throw new NotFoundException('Parent category not found');
        }
        const [inserted] = await tx<CategoryRow[]>`
          insert into product_categories (id, tenant_id, name, parent_id)
          values (${randomUUID()}, ${tenantId}, ${dto.name}, ${dto.parentId ?? null})
          returning id, name, parent_id
        `;
        return inserted;
      });
      return { id: row.id, name: row.name, parentId: row.parent_id };
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException('That category name already exists under the same parent');
      }
      throw err;
    }
  }

  /** Used by ProductsService to validate a product's category_id before insert/update. */
  async exists(tx: postgres.TransactionSql, tenantId: string, categoryId: string): Promise<boolean> {
    const [row] = await tx`select 1 from product_categories where id = ${categoryId} and tenant_id = ${tenantId}`;
    return Boolean(row);
  }
}
