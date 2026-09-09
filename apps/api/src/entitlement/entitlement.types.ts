export type EntitlementReason =
  | 'LIMIT_REACHED'
  | 'FEATURE_DISABLED'
  | 'SUBSCRIPTION_INACTIVE'
  | null;

export interface CheckEntitlementResult {
  allowed: boolean;
  reason: EntitlementReason;
  remaining: number | null;
  limit: number | null;
  used: number;
  upgradeRequired: boolean;
}

export interface ConsumeEntitlementParams {
  tenantId: string;
  featureCode: string;
  userId?: string;
  sourceId?: string;
  documentType?: string;
  generationId?: string;
  idempotencyKey: string;
}

export interface ConsumeEntitlementResult extends CheckEntitlementResult {
  /** true only when this call's own insert is the one that consumed the unit -- false on a duplicate/retried call. */
  wasNewlyConsumed: boolean;
}

export interface RecordFailedAttemptParams {
  tenantId: string;
  featureCode: string;
  userId?: string;
  sourceId?: string;
  documentType?: string;
  idempotencyKey: string;
  reason: string;
}
