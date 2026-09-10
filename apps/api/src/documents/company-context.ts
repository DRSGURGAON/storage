import type postgres from 'postgres';
import { CompanyContext } from './html/layout';

interface CompanyRow {
  legal_name: string;
  trade_name: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  gstin: string | null;
  phone: string | null;
  email: string | null;
  is_demo: boolean;
  logo_attachment_id: string | null;
  signature_attachment_id: string | null;
  stamp_attachment_id: string | null;
}

/**
 * The bytes of an attachment, as a `data:` URI ready to drop into an
 * `<img src>`.
 *
 * `AttachmentsService.readBytes` is not used here on purpose: it opens its
 * own `withTenant` transaction, and this runs *inside* the caller's, which
 * for a document generation is the transaction that also reserves the
 * number and writes the `documents` row. Reading through `tx` keeps it to
 * one transaction and one consistent view.
 */
async function inlineImage(
  tx: postgres.TransactionSql,
  tenantId: string,
  attachmentId: string | null,
  read: (storageKey: string) => Promise<Buffer>,
): Promise<string | null> {
  if (!attachmentId) return null;
  const [row] = await tx<{ content_type: string; storage_key: string }[]>`
    select content_type, storage_key from attachments
    where id = ${attachmentId} and tenant_id = ${tenantId}
  `;
  if (!row) return null;
  try {
    const bytes = await read(row.storage_key);
    return `data:${row.content_type};base64,${bytes.toString('base64')}`;
  } catch {
    // A missing file must not fail the document. The letterhead simply
    // prints without the image, which is what it did before anyone
    // uploaded one.
    return null;
  }
}

/**
 * Inlines a set of `name -> attachments.id` the way `RenderExtras.images`
 * expects. Same reader, same transaction, same "a missing file prints
 * nothing rather than failing the document" rule as the letterhead.
 */
export async function inlineImages(
  tx: postgres.TransactionSql,
  tenantId: string,
  ids: Record<string, string | null> | undefined,
  readAttachment?: (storageKey: string) => Promise<Buffer>,
): Promise<Record<string, string | null>> {
  if (!ids || !readAttachment) return {};
  const entries = await Promise.all(
    Object.entries(ids).map(async ([name, id]) => [name, await inlineImage(tx, tenantId, id, readAttachment)] as const),
  );
  return Object.fromEntries(entries);
}

/** Shared by every document type's template -- the letterhead data is the same regardless of what's being rendered. */
export async function loadCompanyContext(
  tx: postgres.TransactionSql,
  tenantId: string,
  readAttachment?: (storageKey: string) => Promise<Buffer>,
): Promise<CompanyContext> {
  const [row] = await tx<CompanyRow[]>`
    select legal_name, trade_name, address_line1, address_line2, city, state, pincode, gstin, phone, email,
           is_demo, logo_attachment_id, signature_attachment_id, stamp_attachment_id
    from tenants where id = ${tenantId}
  `;
  const inline = (id: string | null) =>
    readAttachment ? inlineImage(tx, tenantId, id, readAttachment) : Promise.resolve(null);

  return {
    legalName: row.legal_name,
    tradeName: row.trade_name,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    city: row.city,
    state: row.state,
    pincode: row.pincode,
    gstin: row.gstin,
    phone: row.phone,
    email: row.email,
    isDemo: row.is_demo,
    logoDataUri: await inline(row.logo_attachment_id),
    signatureDataUri: await inline(row.signature_attachment_id),
    stampDataUri: await inline(row.stamp_attachment_id),
  };
}
