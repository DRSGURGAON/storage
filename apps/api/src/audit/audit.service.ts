import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { RecordAuditParams } from './audit.types';

/**
 * dev-phases.md's cross-cutting note: "Audit logging should be wired into
 * the service-layer interceptor starting Phase 1, not deferred to Phase 8."
 * One function every mutating (and security-relevant: login/login_failed/
 * permission_denied) action calls, same discipline as numbering.md's
 * allocateNumber() and entitlement-engine.md's consumeEntitlement -- no
 * module writes its own ad hoc audit_logs insert.
 */
@Injectable()
export class AuditService {
  constructor(@Inject(PG_CONNECTION) private readonly sql: postgres.Sql) {}

  async record(params: RecordAuditParams): Promise<void> {
    await withTenant(this.sql, params.tenantId, (tx) => tx`
      insert into audit_logs
        (id, tenant_id, user_id, user_role_code, action, entity_type, entity_id,
         previous_value, new_value, ip_address, request_id)
      values
        (gen_random_uuid(), ${params.tenantId}, ${params.userId ?? null},
         ${params.userRoleCode ?? null}, ${params.action}, ${params.entityType},
         ${params.entityId},
         ${params.previousValue ? JSON.stringify(params.previousValue) : null}::jsonb,
         ${params.newValue ? JSON.stringify(params.newValue) : null}::jsonb,
         ${params.ipAddress ?? null}, ${params.requestId ?? null})
    `);
  }
}
