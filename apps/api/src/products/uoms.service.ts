import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { CreateUomDto } from './dto/list-products.query';

export interface UomRow {
  code: string;
  name: string;
}

/** blueprint §11: seeded per tenant at signup (db/seed-data.ts DEFAULT_UOMS); this is where a tenant adds its own. */
@Injectable()
export class UomsService {
  constructor(@Inject(PG_CONNECTION) private readonly sql: postgres.Sql) {}

  async list(tenantId: string) {
    const rows = await withTenant(this.sql, tenantId, (tx) => tx<UomRow[]>`
      select code, name from uoms where tenant_id = ${tenantId} order by code
    `);
    return rows;
  }

  async create(tenantId: string, dto: CreateUomDto) {
    const code = dto.code.toUpperCase();
    try {
      await withTenant(this.sql, tenantId, (tx) => tx`
        insert into uoms (tenant_id, code, name) values (${tenantId}, ${code}, ${dto.name})
      `);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException(`UOM ${code} already exists`);
      }
      throw err;
    }
    return { code, name: dto.name };
  }

  /** Used by ProductsService to validate a product's uom_code before insert/update. */
  async exists(tx: postgres.TransactionSql, tenantId: string, code: string): Promise<boolean> {
    const [row] = await tx`select 1 from uoms where tenant_id = ${tenantId} and code = ${code}`;
    return Boolean(row);
  }
}
