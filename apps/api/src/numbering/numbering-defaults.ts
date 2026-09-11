/**
 * Transcribed from numbering.md §6's canonical prefix list. These are seed
 * defaults for a tenant's first allocation of a given document type only
 * -- the table, not this map, is authoritative afterwards (a tenant can
 * edit prefix/format/padding from Settings without any code change).
 *
 * Keys reuse the feature_keys codes (db/seed-data.ts) where a document
 * type is also a metered entitlement feature, so the codebase has one
 * vocabulary for "which document type is this", not two.
 */
export const DOCUMENT_TYPE_PREFIXES: Record<string, string> = {
  GATE_ENTRY: 'GE',
  INWARD: 'IN',
  GRN_GENERATION: 'GRN',
  DISCREPANCY_REPORT: 'DR',
  INSPECTION: 'INS',
  PUTAWAY: 'PA',
  WAREHOUSE_RECEIPT: 'WR',
  QUOTATION_GENERATION: 'QT',
  AGREEMENT_GENERATION: 'AG',
  STOCK_TRANSFER: 'ST',
  STOCK_VERIFICATION: 'SV',
  STOCK_ADJUSTMENT: 'SA',
  RELEASE_ORDER: 'RO',
  PICK_LIST: 'PL',
  PACKING_LIST: 'PK',
  DISPATCH_NOTE: 'DN',
  LOADING_SHEET: 'LS',
  GATE_PASS: 'GP',
  POD: 'POD',
  RETURN_REQUEST: 'RR',
  RETURN_INWARD: 'RI',
  INVOICE_GENERATION: 'INV',
  CREDIT_NOTE: 'CN',
  // Distinct from Dispatch Note's 'DN' -- numbering.md §6 flags this collision explicitly.
  DEBIT_NOTE: 'DN2',
  PAYMENT_RECEIPT: 'RCPT',
  // Household storage. A booking is the record everything else hangs off,
  // so it carries the number the customer quotes on the phone; a movement
  // (goods in, goods out) gets its own, because two handovers on one
  // booking must be tellable apart.
  STORAGE_BOOKING: 'SB',
  STORAGE_MOVEMENT: 'SM',
  // Masters with running codes (blueprint §10 'CUST0001'). Not documents,
  // but the same engine: one series row per tenant, one allocator.
  CUSTOMER: 'CUST',
};

export interface SeriesDefaults {
  format: string;
  fyStyle: 'YY-YY' | 'YYYY-YY' | 'YYYY' | 'NONE';
  resetPolicy: 'never' | 'yearly' | 'monthly';
  padding: number;
}

/** Mirrors `number_series`' own column defaults in schema/00_core.sql. */
export const TABLE_DEFAULTS: SeriesDefaults = {
  format: '{prefix}/{fy}/{seq:6}',
  fyStyle: 'YY-YY',
  resetPolicy: 'yearly',
  padding: 6,
};

/** Only types whose first-use series should differ from the table defaults ('{prefix}/{fy}/{seq:6}', YY-YY, yearly). */
export const SERIES_DEFAULT_OVERRIDES: Record<string, SeriesDefaults> = {
  CUSTOMER: { format: '{prefix}{seq:4}', fyStyle: 'NONE', resetPolicy: 'never', padding: 4 },
};
