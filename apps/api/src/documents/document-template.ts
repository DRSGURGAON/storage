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
}

export interface RenderExtras {
  company: CompanyContext;
  qrDataUri: string;
  qrToken: string;
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
