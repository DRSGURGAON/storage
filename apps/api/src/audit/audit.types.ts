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
