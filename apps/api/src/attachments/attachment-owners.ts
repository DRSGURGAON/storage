/**
 * What a file may be attached to, and who may attach it.
 *
 * An upload cannot declare its own permission the way a route can: which
 * permission it needs depends on *what it is attached to*. A photo on a
 * discrepancy report is part of raising that report; a signature on a POD
 * is part of capturing that POD; a customer's GST certificate is part of
 * editing that customer. So the permission is looked up here from the
 * owner type and checked in the service, the same way
 * `documents/regeneration-policy.ts` does for a decision a decorator
 * cannot express (`auth/has-permission.ts`).
 *
 * It doubles as the whitelist. `owner_type`/`owner_id` is a polymorphic
 * reference with no foreign key behind it, so without a fixed table of
 * allowed types an upload could name any string and point at any row --
 * including one in another tenant. Every entry names the table the id
 * must exist in, and that check runs inside `withTenant`, so a row in
 * another workspace is not found rather than not checked.
 *
 * `generated document PDFs` are deliberately absent: those rows are
 * written by the document engine with `owner_type = 'quotation'` and the
 * like, and are reachable only through `/documents`. Letting this API
 * delete one would break the document that points at it.
 */
export interface AttachmentOwner {
  /** Table the owner id must exist in. From this file only -- never from a request. */
  table: string;
  /** Permission to see the files attached to one of these. */
  read: string;
  /** Permission to attach a file to one, or remove one. */
  write: string;
  /**
   * Categories that also *point back* from the owner row, e.g. a POD's
   * signature. Uploading one sets the column; removing it clears it.
   * Without this the column would stay null forever and the document
   * that prints from it would have nothing to print.
   */
  links?: Record<string, string>;
  /**
   * `tenants` is the workspace itself: it has an `id`, not a `tenant_id`,
   * so its existence check is "this is your own workspace".
   */
  isTenantRow?: boolean;
}

export const ATTACHMENT_OWNERS: Record<string, AttachmentOwner> = {
  // The workspace's own letterhead furniture (schema/00_core.sql).
  company: {
    table: 'tenants',
    read: 'manage_company_settings',
    write: 'manage_company_settings',
    isTenantRow: true,
    links: {
      logo: 'logo_attachment_id',
      signature: 'signature_attachment_id',
      stamp: 'stamp_attachment_id',
    },
  },
  // Masters
  customer: { table: 'customers', read: 'view_customer', write: 'edit_customer' },
  supplier: { table: 'suppliers', read: 'view_customer', write: 'edit_customer' },
  product: { table: 'products', read: 'view_product', write: 'edit_product' },
  // Inbound
  gate_entry: { table: 'gate_entries', read: 'create_gate_entry', write: 'create_gate_entry' },
  inward: { table: 'inwards', read: 'create_inward', write: 'create_inward' },
  grn: { table: 'grns', read: 'create_grn', write: 'create_grn' },
  inspection: { table: 'inspections', read: 'create_inspection', write: 'create_inspection' },
  discrepancy_report: {
    table: 'discrepancy_reports',
    read: 'create_discrepancy_report',
    write: 'create_discrepancy_report',
    links: { signature: 'driver_ack_signature_attachment_id' },
  },
  // Outbound
  dispatch: { table: 'dispatches', read: 'create_dispatch', write: 'create_dispatch' },
  gate_pass: { table: 'gate_passes', read: 'create_gate_pass', write: 'create_gate_pass' },
  pod: {
    table: 'pods',
    read: 'capture_pod',
    write: 'capture_pod',
    links: { signature: 'signature_attachment_id', stamp: 'stamp_attachment_id' },
  },
  // Stock
  stock_verification: {
    table: 'stock_verifications',
    read: 'create_stock_verification',
    write: 'create_stock_verification',
  },
  stock_adjustment: {
    table: 'stock_adjustments',
    read: 'create_stock_adjustment',
    write: 'create_stock_adjustment',
  },
};

/**
 * The `category` values schema/00_core.sql lists, minus `document` --
 * that one belongs to the engine's own rows.
 */
export const ATTACHMENT_CATEGORIES = [
  'photo',
  'signature',
  'stamp',
  'logo',
  'invoice',
  'lr',
  'eway_bill',
  'gst_certificate',
  'pan',
  'kyc',
  'agreement',
  'other',
] as const;

/**
 * What a phone camera and a scanner produce, and nothing else. An upload
 * endpoint that accepts anything is a file-serving endpoint for whatever
 * someone puts through it, and these are read back by a browser.
 */
export const ATTACHMENT_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
] as const;
