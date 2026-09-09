import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';

export interface AgreementTemplateClause {
  id: string;
  title: string;
  body: string;
  editable: boolean;
}

interface AgreementTemplateRow {
  id: string;
  tenant_id: string | null;
  name: string;
  version: number;
  clauses: AgreementTemplateClause[];
  is_active: boolean;
}

function toApi(row: AgreementTemplateRow) {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    clauses: row.clauses,
    isSystem: row.tenant_id === null,
    isActive: row.is_active,
  };
}

/**
 * Blueprint §15: "Use a configurable template... treated as a template
 * requiring appropriate legal review." V1 ships list-only against the one
 * seeded system default (`db/seed-data.ts` `SYSTEM_AGREEMENT_TEMPLATE`);
 * authoring a tenant's own reviewed template is not built yet (dev-phases.md).
 */
@Injectable()
export class AgreementTemplatesService {
  constructor(@Inject(PG_CONNECTION) private readonly sql: postgres.Sql) {}

  async list(tenantId: string) {
    const rows = await withTenant(this.sql, tenantId, (tx) => tx<AgreementTemplateRow[]>`
      select id, tenant_id, name, version, clauses, is_active
      from agreement_templates
      where (tenant_id = ${tenantId} or tenant_id is null) and is_active
      order by name, tenant_id nulls last
    `);
    return rows.map(toApi);
  }

  /** Used by AgreementsService to resolve an explicit templateId, or fall back to the system default. */
  async get(
    tx: postgres.TransactionSql,
    tenantId: string,
    templateId?: string,
  ): Promise<{ id: string; clauses: AgreementTemplateClause[] } | null> {
    if (templateId) {
      const [row] = await tx<AgreementTemplateRow[]>`
        select id, tenant_id, name, version, clauses, is_active from agreement_templates
        where id = ${templateId} and (tenant_id = ${tenantId} or tenant_id is null)
      `;
      return row ?? null;
    }
    const [defaultRow] = await tx<AgreementTemplateRow[]>`
      select id, tenant_id, name, version, clauses, is_active from agreement_templates
      where tenant_id is null and is_active
      order by name
      limit 1
    `;
    return defaultRow ?? null;
  }
}
