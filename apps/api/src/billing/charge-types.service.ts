import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { CreateChargeTypeDto } from './dto/list-rate-cards.query';

export interface ChargeTypeRow {
  id: string;
  tenant_id: string | null;
  code: string;
  name: string;
  category: string;
  default_basis: string;
  sac_code: string | null;
  trigger_event: string | null;
  is_active: boolean;
}

function toApi(row: ChargeTypeRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    category: row.category,
    defaultBasis: row.default_basis,
    sacCode: row.sac_code,
    triggerEvent: row.trigger_event,
    isSystem: row.tenant_id === null,
    isActive: row.is_active,
  };
}

/**
 * billing-engine.md §2: system catalogue seeded once (tenant_id null,
 * db/seed-data.ts SYSTEM_CHARGE_TYPES), plus "tenants may add charge types
 * beyond this seed list". A tenant row overrides a system row of the same
 * code in list() (same override pattern roles/feature_keys don't need,
 * because rate_card_lines.charge_type_id is a real FK -- the two rows stay
 * genuinely distinct, this is just which one `list()` prefers by code).
 */
@Injectable()
export class ChargeTypesService {
  constructor(@Inject(PG_CONNECTION) private readonly sql: postgres.Sql) {}

  async list(tenantId: string) {
    const rows = await withTenant(this.sql, tenantId, (tx) => tx<ChargeTypeRow[]>`
      select id, tenant_id, code, name, category, default_basis, sac_code, trigger_event, is_active
      from charge_types
      where (tenant_id = ${tenantId} or tenant_id is null) and is_active
      order by code, tenant_id nulls last
    `);
    const byCode = new Map<string, ChargeTypeRow>();
    for (const row of rows) {
      if (!byCode.has(row.code) || row.tenant_id !== null) byCode.set(row.code, row);
    }
    return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code)).map(toApi);
  }

  async create(tenantId: string, dto: CreateChargeTypeDto) {
    const code = dto.code.toUpperCase();
    try {
      const [row] = await withTenant(this.sql, tenantId, (tx) => tx<ChargeTypeRow[]>`
        insert into charge_types (id, tenant_id, code, name, category, default_basis, sac_code, trigger_event)
        values (${randomUUID()}, ${tenantId}, ${code}, ${dto.name}, ${dto.category},
                ${dto.defaultBasis}, ${dto.sacCode ?? null}, ${dto.triggerEvent ?? null})
        returning id, tenant_id, code, name, category, default_basis, sac_code, trigger_event, is_active
      `);
      return toApi(row);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException(`Charge type ${code} already exists`);
      }
      throw err;
    }
  }

  /** Used by RateCardLinesService to validate charge_type_id before insert/update. */
  async exists(tx: postgres.TransactionSql, tenantId: string, id: string): Promise<boolean> {
    const [row] = await tx`
      select 1 from charge_types where id = ${id} and (tenant_id = ${tenantId} or tenant_id is null)
    `;
    return Boolean(row);
  }
}
