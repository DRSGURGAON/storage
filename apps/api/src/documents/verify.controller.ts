import { Controller, Get, Headers, Inject, Injectable, Ip, Param } from '@nestjs/common';
import type postgres from 'postgres';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { DocumentTemplateRegistry } from './document-template.registry';

interface VerifyResult {
  result: 'valid' | 'revoked' | 'not_found';
  documentNumber?: string;
  issuedBy?: string;
  generatedAt?: Date;
  status?: string;
}

/**
 * document-engine.md §4: the public verify page shows *only* doc number,
 * issuer trade name, generated date, and the source record's current
 * status -- never line items, amounts, or anything else from
 * render_data_snapshot. A revoked/superseded document resolves with
 * result='revoked' and a message, not a 404, so a scanner can tell "this
 * used to be valid" from "never existed."
 */
@Injectable()
export class VerifyService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly registry: DocumentTemplateRegistry,
  ) {}

  async verify(qrToken: string, ipAddress?: string, userAgent?: string): Promise<VerifyResult> {
    // qr_token is globally unique (schema/70_documents_governance.sql), not scoped by tenant, so the
    // lookup needs no tenant context -- the tenant is *discovered* from the matching row, the same
    // "find first, then scope" shape login uses. Under tenant_isolation alone this returns zero rows
    // regardless (no app.tenant_id yet); schema/95_document_qr_verify_lookup.sql's qr_verify_lookup
    // policy is what makes it visible -- it requires the caller to already possess this exact,
    // unguessable token, set as a session variable before the query runs.
    const [found] = await this.sql.begin(async (tx) => {
      await tx`select set_config('app.verify_qr_token', ${qrToken}, true)`;
      return tx<
        { id: string; tenant_id: string; document_type: string; source_id: string; document_number: string; is_latest: boolean; generated_at: Date }[]
      >`
        select id, tenant_id, document_type, source_id, document_number, is_latest, generated_at
        from documents where qr_token = ${qrToken}
      `;
    });
    if (!found) return { result: 'not_found' };

    return withTenant(this.sql, found.tenant_id, async (tx) => {
      await tx`
        insert into document_verifications (id, document_id, ip_address, user_agent, result)
        values (gen_random_uuid(), ${found.id}, ${ipAddress ?? null}, ${userAgent ?? null}, ${found.is_latest ? 'valid' : 'revoked'})
      `;

      const [tenantRow] = await tx<{ legal_name: string; trade_name: string | null }[]>`
        select legal_name, trade_name from tenants where id = ${found.tenant_id}
      `;

      let status: string | undefined;
      try {
        const template = this.registry.get(found.document_type);
        const data = await template.loadData(tx, found.tenant_id, found.source_id);
        status = data?.statusAtGeneration;
      } catch {
        status = undefined;
      }

      return {
        result: found.is_latest ? 'valid' : 'revoked',
        documentNumber: found.document_number,
        issuedBy: tenantRow.trade_name ?? tenantRow.legal_name,
        generatedAt: found.generated_at,
        status,
      };
    });
  }
}

@Controller('verify')
export class VerifyController {
  constructor(private readonly verify: VerifyService) {}

  @Get(':qrToken')
  check(@Param('qrToken') qrToken: string, @Ip() ip: string, @Headers('user-agent') userAgent?: string) {
    return this.verify.verify(qrToken, ip, userAgent);
  }
}
