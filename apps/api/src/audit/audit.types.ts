/** Matches audit_logs.action's check constraint (schema/70_documents_governance.sql). */
export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'approve'
  | 'reject'
  | 'cancel'
  | 'stock_adjustment'
  | 'status_change'
  | 'document_generate'
  | 'document_regenerate'
  | 'login'
  | 'login_failed'
  // Credential changes are security events, not settings edits, and an
  // Owner reading the audit log should be able to tell the three apart:
  // someone changing their own password, an Owner issuing one for a
  // member, and a reset completed through an emailed link by whoever was
  // holding it.
  | 'password_changed'
  | 'password_change_failed'
  | 'password_reset'
  | 'password_set_for_member'
  | 'permission_denied';

export interface RecordAuditParams {
  tenantId: string;
  userId?: string;
  userRoleCode?: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  previousValue?: unknown;
  newValue?: unknown;
  ipAddress?: string;
  requestId?: string;
}
