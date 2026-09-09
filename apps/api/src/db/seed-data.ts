/**
 * Transcribed directly from docs/architecture/permissions-matrix.md so the
 * two stay auditable against each other. The Customer role intentionally
 * gets zero entries in ROLE_PERMISSIONS: per that document's notes, the
 * portal uses a separate, narrower controller set instead of these
 * staff permission codes -- there is nothing to grant it here.
 */

export const SYSTEM_ROLES = [
  { code: 'owner', name: 'Owner' },
  { code: 'admin', name: 'Admin' },
  { code: 'warehouse_manager', name: 'Warehouse Manager' },
  { code: 'warehouse_operator', name: 'Warehouse Operator' },
  { code: 'billing_executive', name: 'Billing Executive' },
  { code: 'accountant', name: 'Accountant' },
  { code: 'customer', name: 'Customer' },
] as const;

export type SystemRoleCode = (typeof SYSTEM_ROLES)[number]['code'];

export const PERMISSIONS: { code: string; module: string }[] = [
  // Masters
  { code: 'view_customer', module: 'masters' },
  { code: 'create_customer', module: 'masters' },
  { code: 'edit_customer', module: 'masters' },
  { code: 'view_warehouse', module: 'masters' },
  { code: 'view_product', module: 'masters' },
  { code: 'view_transport_master', module: 'masters' },
  { code: 'view_rate_card', module: 'masters' },
  { code: 'create_warehouse', module: 'masters' },
  { code: 'create_product', module: 'masters' },
  { code: 'create_transport_master', module: 'masters' },
  { code: 'edit_warehouse', module: 'masters' },
  { code: 'edit_product', module: 'masters' },
  { code: 'edit_transport_master', module: 'masters' },
  { code: 'create_rate_card', module: 'masters' },
  { code: 'edit_rate_card', module: 'masters' },
  { code: 'manage_company_settings', module: 'masters' },
  { code: 'manage_users_and_roles', module: 'masters' },
  // Commercial
  { code: 'view_quotation', module: 'commercial' },
  { code: 'create_quotation', module: 'commercial' },
  { code: 'edit_quotation', module: 'commercial' },
  { code: 'view_agreement', module: 'commercial' },
  { code: 'create_agreement', module: 'commercial' },
  { code: 'edit_agreement', module: 'commercial' },
  { code: 'approve_agreement', module: 'commercial' },
  // Operations
  { code: 'create_gate_entry', module: 'operations' },
  { code: 'create_inward', module: 'operations' },
  { code: 'create_grn', module: 'operations' },
  { code: 'approve_grn', module: 'operations' },
  { code: 'create_discrepancy_report', module: 'operations' },
  { code: 'create_inspection', module: 'operations' },
  { code: 'create_putaway', module: 'operations' },
  { code: 'complete_putaway', module: 'operations' },
  { code: 'issue_warehouse_receipt', module: 'operations' },
  { code: 'create_release_order', module: 'operations' },
  { code: 'approve_release_order', module: 'operations' },
  { code: 'reserve_stock', module: 'operations' },
  { code: 'create_pick_list', module: 'operations' },
  { code: 'confirm_pick', module: 'operations' },
  { code: 'create_dispatch', module: 'operations' },
  { code: 'create_loading_sheet', module: 'operations' },
  { code: 'create_gate_pass', module: 'operations' },
  { code: 'confirm_gate_out', module: 'operations' },
  { code: 'capture_pod', module: 'operations' },
  { code: 'create_return_request', module: 'operations' },
  // Stock
  { code: 'view_stock', module: 'stock' },
  { code: 'view_stock_ledger', module: 'stock' },
  { code: 'create_stock_transfer', module: 'stock' },
  { code: 'create_stock_verification', module: 'stock' },
  { code: 'create_stock_adjustment', module: 'stock' },
  { code: 'approve_stock_adjustment', module: 'stock' },
  { code: 'approve_stock_adjustment_final', module: 'stock' },
  // Billing
  { code: 'generate_billing_run', module: 'billing' },
  { code: 'create_invoice', module: 'billing' },
  { code: 'approve_invoice', module: 'billing' },
  { code: 'create_credit_debit_note', module: 'billing' },
  { code: 'approve_credit_debit_note', module: 'billing' },
  { code: 'record_payment', module: 'billing' },
  { code: 'view_customer_statement', module: 'billing' },
  // Documents & reports
  { code: 'view_documents', module: 'documents' },
  { code: 'regenerate_document', module: 'documents' },
  { code: 'regenerate_after_approval', module: 'documents' },
  { code: 'view_reports', module: 'reports' },
  { code: 'export_reports', module: 'reports' },
  { code: 'view_audit_log', module: 'documents' },
  // Subscription & entitlement
  { code: 'view_plan_usage', module: 'settings' },
  { code: 'manage_subscription', module: 'settings' },
  // grant_entitlement_override is deliberately absent: platform-operator-only,
  // never assigned to any tenant role (permissions-matrix.md notes).
];

const MASTERS_VIEW_ONLY = [
  'view_customer',
  'view_warehouse',
  'view_product',
  'view_transport_master',
  'view_rate_card',
];

const OPERATIONS_ALL = [
  'create_gate_entry',
  'create_inward',
  'create_grn',
  'approve_grn',
  'create_discrepancy_report',
  'create_inspection',
  'create_putaway',
  'complete_putaway',
  'issue_warehouse_receipt',
  'create_release_order',
  'approve_release_order',
  'reserve_stock',
  'create_pick_list',
  'confirm_pick',
  'create_dispatch',
  'create_loading_sheet',
  'create_gate_pass',
  'confirm_gate_out',
  'capture_pod',
  'create_return_request',
];

const OPERATIONS_FIELD_LEVEL = [
  'create_gate_entry',
  'create_inward',
  'create_grn',
  'create_discrepancy_report',
  'create_inspection',
  'create_putaway',
  'complete_putaway',
  'create_pick_list',
  'confirm_pick',
  'create_dispatch',
  'create_loading_sheet',
  'create_gate_pass',
  'confirm_gate_out',
  'capture_pod',
];

const ALL_PERMISSION_CODES = PERMISSIONS.map((p) => p.code);

export const ROLE_PERMISSIONS: Record<SystemRoleCode, string[]> = {
  // Every row in the matrix is checked for Owner except the platform-only
  // grant_entitlement_override, which isn't in PERMISSIONS at all.
  owner: ALL_PERMISSION_CODES,

  admin: ALL_PERMISSION_CODES.filter(
    (c) =>
      ![
        'approve_agreement',
        'approve_stock_adjustment_final',
        'manage_subscription',
      ].includes(c),
  ),

  warehouse_manager: [
    ...MASTERS_VIEW_ONLY,
    'view_agreement',
    ...OPERATIONS_ALL,
    'view_stock',
    'view_stock_ledger',
    'create_stock_transfer',
    'create_stock_verification',
    'create_stock_adjustment',
    'approve_stock_adjustment',
    'view_documents',
    'regenerate_document',
    'view_reports',
    'export_reports',
  ],

  warehouse_operator: [
    ...MASTERS_VIEW_ONLY,
    ...OPERATIONS_FIELD_LEVEL,
    'view_stock',
    'view_stock_ledger',
    'create_stock_transfer',
    'create_stock_verification',
    'create_stock_adjustment',
    'view_documents',
  ],

  billing_executive: [
    ...MASTERS_VIEW_ONLY,
    'create_rate_card',
    'edit_rate_card',
    'view_stock',
    'view_stock_ledger',
    'generate_billing_run',
    'create_invoice',
    'create_credit_debit_note',
    'record_payment',
    'view_customer_statement',
    'view_documents',
    'regenerate_document',
    'view_reports',
    'export_reports',
    'view_plan_usage',
  ],

  accountant: [
    ...MASTERS_VIEW_ONLY,
    'view_stock',
    'view_stock_ledger',
    'generate_billing_run',
    'create_invoice',
    'approve_invoice',
    'create_credit_debit_note',
    'approve_credit_debit_note',
    'record_payment',
    'view_customer_statement',
    'view_documents',
    'view_reports',
    'export_reports',
    'view_plan_usage',
  ],

  // Portal access is enforced by a separate controller set, not these codes.
  customer: [],
};

/**
 * Transcribed from v1-scope-specification.md §7 (Subscription & 2-Free-Copy
 * Matrix). The 21 metered document-generation features get the free-copies
 * rule; the 5 "Not metered" ones still need an explicit `unlimited` row on
 * every plan below -- entitlement-engine.md §3's resolution is fail-closed
 * to `disabled` when no plan_feature_limits row exists at all, so "always
 * available" has to be seeded, not assumed.
 */
export const METERED_FEATURE_KEYS = [
  { code: 'QUOTATION_GENERATION', module: 'commercial', name: 'Quotation generation' },
  { code: 'AGREEMENT_GENERATION', module: 'commercial', name: 'Agreement generation' },
  { code: 'GATE_ENTRY', module: 'operations', name: 'Gate entry' },
  { code: 'INWARD', module: 'operations', name: 'Goods inward' },
  { code: 'GRN_GENERATION', module: 'operations', name: 'GRN generation' },
  { code: 'DISCREPANCY_REPORT', module: 'operations', name: 'Discrepancy/damage report' },
  { code: 'PUTAWAY', module: 'operations', name: 'Put-away slip' },
  { code: 'WAREHOUSE_RECEIPT', module: 'operations', name: 'Warehouse receipt' },
  { code: 'RELEASE_ORDER', module: 'operations', name: 'Release/delivery order' },
  { code: 'PICK_LIST', module: 'operations', name: 'Pick list' },
  { code: 'DISPATCH_NOTE', module: 'operations', name: 'Dispatch note' },
  { code: 'LOADING_SHEET', module: 'operations', name: 'Loading sheet' },
  { code: 'GATE_PASS', module: 'operations', name: 'Gate pass' },
  { code: 'POD', module: 'operations', name: 'Proof of delivery' },
  { code: 'INVOICE_GENERATION', module: 'billing', name: 'Invoice generation' },
  { code: 'CREDIT_NOTE', module: 'billing', name: 'Credit note' },
  { code: 'PAYMENT_RECEIPT', module: 'billing', name: 'Payment receipt' },
  { code: 'DEBIT_NOTE', module: 'billing', name: 'Debit note' },
  { code: 'STOCK_TRANSFER', module: 'stock', name: 'Stock transfer' },
  { code: 'STOCK_VERIFICATION', module: 'stock', name: 'Physical stock verification' },
  { code: 'PACKING_LIST', module: 'operations', name: 'Packing list' },
] as const;

export const UNMETERED_FEATURE_KEYS = [
  { code: 'CUSTOMER_KYC', module: 'masters', name: 'Customer KYC' },
  { code: 'RATE_CARD', module: 'masters', name: 'Rate card' },
  { code: 'STOCK_LEDGER', module: 'stock', name: 'Stock ledger' },
  { code: 'STOCK_STATEMENT', module: 'stock', name: 'Customer stock statement' },
  { code: 'CUSTOMER_STATEMENT', module: 'billing', name: 'Customer account statement' },
] as const;

export const FEATURE_KEYS = [
  ...METERED_FEATURE_KEYS.map((f) => ({ ...f, isMeterable: true })),
  ...UNMETERED_FEATURE_KEYS.map((f) => ({ ...f, isMeterable: false })),
];

/** The default free-copies allowance (v1-scope-specification.md §7, §16 of the entitlement blueprint). */
export const FREE_PLAN_DOCUMENT_LIMIT = 2;

export const FREE_PLAN = {
  code: 'FREE',
  name: 'Free',
  description: '2 free copies of every document type, forever. No card required.',
  isPublic: true,
  trialDays: 0,
  priceMonthly: 0,
  priceYearly: 0,
};

/**
 * Transcribed from schema/10_masters.sql's own comment on `uoms.code`.
 * Seeded per-tenant at signup (uoms.tenant_id is not null -- there is no
 * shared/system-wide row here the way there is for roles or feature_keys,
 * so "give every new tenant a sensible starting catalogue" has to happen
 * at signup rather than once globally). A tenant can add more afterwards;
 * this is a starting point, not a closed list.
 */
export const DEFAULT_UOMS = [
  { code: 'NOS', name: 'Numbers (Pieces)' },
  { code: 'BOX', name: 'Box' },
  { code: 'BAG', name: 'Bag' },
  { code: 'KG', name: 'Kilogram' },
  { code: 'MT', name: 'Metric Ton' },
  { code: 'PLT', name: 'Pallet' },
  { code: 'CBM', name: 'Cubic Meter' },
  { code: 'SQFT', name: 'Square Feet' },
] as const;
