import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { CreateTaxRateDto } from './dto/list-rate-cards.query';

export interface TaxRateRow {
  id: string;
  tenant_id: string | null;
  code: string;
  name: string;
  rate_pct: string;
  is_active: boolean;
}

function toApi(row: TaxRateRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    ratePct: Number(row.rate_pct),
    isSystem: row.tenant_id === null,
    isActive: row.is_active,
  };
}

/** billing-engine.md §6: "tax_rates is tenant-editable data, not a constant." Same system+override pattern as charge types. */
@Injectable()
export class TaxRatesService {
  constructor(@Inject(PG_CONNECTION) private readonly sql: postgres.Sql) {}

  async list(tenantId: string) {
    const rows = await withTenant(this.sql, tenantId, (tx) => tx<TaxRateRow[]>`
      select id, tenant_id, code, name, rate_pct, is_active
      from tax_rates
      where (tenant_id = ${tenantId} or tenant_id is null) and is_active
      order by code, tenant_id nulls last
    `);
    const byCode = new Map<string, TaxRateRow>();
    for (const row of rows) {
      if (!byCode.has(row.code) || row.tenant_id !== null) byCode.set(row.code, row);
    }
    return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code)).map(toApi);
  }

  async create(tenantId: string, dto: CreateTaxRateDto) {
    const code = dto.code.toUpperCase();
    try {
      const [row] = await withTenant(this.sql, tenantId, (tx) => tx<TaxRateRow[]>`
        insert into tax_rates (id, tenant_id, code, name, rate_pct)
        values (${randomUUID()}, ${tenantId}, ${code}, ${dto.name}, ${dto.ratePct})
        returning id, tenant_id, code, name, rate_pct, is_active
      `);
      return toApi(row);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException(`Tax rate ${code} already exists`);
      }
      throw err;
    }
  }

  /** Used by RateCardLinesService to validate tax_rate_id before insert/update. */
  async exists(tx: postgres.TransactionSql, tenantId: string, id: string): Promise<boolean> {
    const [row] = await tx`
      select 1 from tax_rates where id = ${id} and (tenant_id = ${tenantId} or tenant_id is null)
    `;
    return Boolean(row);
  }
}
