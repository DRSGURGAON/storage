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
  // Someone leaving, or a whole workspace closing. Recorded before the
  // account is anonymised, because afterwards there is nothing on the row
  // left to say who it was.
  | 'account_deleted'
  | 'workspace_deletion_requested'
  // Somebody asked to move to a paid plan. Until there is a gateway this
  // row is the sales pipeline.
  | 'upgrade_requested'
  // Household storage: goods arriving, goods handed back, and the booking
  // being wound up. Distinct from 'create'/'update' because these three are
  // the ones anybody ever goes back through the trail looking for.
  | 'storage_intake'
  | 'storage_release'
  | 'storage_close'
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
