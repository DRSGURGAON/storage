import type postgres from 'postgres';
import { CompanyContext } from './html/layout';

export interface DocumentTemplateData {
  documentNumber: string;
  customerId: string | null;
  warehouseId: string | null;
  /** The source record's own status column value at generation time -- documents.status_at_generation. */
  statusAtGeneration: string;
  /** Everything the template needs to render, frozen into documents.render_data_snapshot as-is. */
  snapshot: Record<string, unknown>;
  /**
   * Images belonging to the source record that the template wants to
   * print, as `name -> attachments.id` (a POD's receiver signature, say).
   *
   * The engine resolves each to a `data:` URI and hands them back in
   * `RenderExtras.images`. Ids rather than bytes on purpose: the snapshot
   * is frozen into `documents.render_data_snapshot`, and a base64 image
   * there would bloat every stored document row with a copy of a file the
   * `attachments` table already holds.
   */
  imageAttachmentIds?: Record<string, string | null>;
}

export interface RenderExtras {
  company: CompanyContext;
  qrDataUri: string;
  qrToken: string;
  /**
   * The `imageAttachmentIds` the template asked for, inlined as `data:`
   * URIs -- or absent, if the attachment has since been deleted or its
   * bytes cannot be read. A template must render without them.
   */
  images?: Record<string, string | null>;
}

/**
 * document-engine.md §1-§3: one contract every document type implements.
 * `DocumentEngineService` is the only caller -- adding a new document
 * type later means adding one class satisfying this interface and
 * registering it, never a new rendering pipeline.
 */
export interface DocumentTemplate {
  /** Matches documents.document_type (schema/70_documents_governance.sql's comment lists the full set). */
  documentType: string;
  /** The entitlement feature_keys.code this document type is metered under. */
  featureCode: string;

  /** Loads the source record + everything needed to render, or null if sourceId doesn't exist for this tenant. */
  loadData(tx: postgres.TransactionSql, tenantId: string, sourceId: string): Promise<DocumentTemplateData | null>;

  /** Pure function: data + shared extras (company letterhead, QR) -> a full HTML document string. */
  renderHtml(data: DocumentTemplateData, extras: RenderExtras): string;
}
