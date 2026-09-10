import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { AttachmentsService } from '../attachments/attachments.service';
import { AuditService } from '../audit/audit.service';
import { hasPermission } from '../auth/has-permission';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PG_CONNECTION } from '../db/db.module';
import { loadWarehouseScope } from '../auth/warehouse-scope';
import { withTenant } from '../db/tenant-context';
import { EntitlementService } from '../entitlement/entitlement.service';
import { inlineImages, loadCompanyContext } from './company-context';
import { DocumentTemplateRegistry } from './document-template.registry';
import { PaywallException } from './paywall.exception';
import { PdfRendererService } from './pdf-renderer.service';
import { QrService } from './qr.service';
import { elevatedPermissionForRegeneration } from './regeneration-policy';

interface DocumentRow {
  id: string;
  document_type: string;
  source_id: string;
  document_number: string;
  customer_id: string | null;
  warehouse_id: string | null;
  version_no: number;
  is_latest: boolean;
  file_attachment_id: string;
  qr_token: string;
  status_at_generation: string | null;
  generated_at: Date;
  generated_by: string | null;
  superseded_at: Date | null;
  superseded_by_document_id: string | null;
}

const SELECT_COLUMNS = `
  id, document_type, source_id, document_number, customer_id, warehouse_id, version_no, is_latest,
  file_attachment_id, qr_token, status_at_generation, generated_at, generated_by, superseded_at,
  superseded_by_document_id`;

function toApi(row: DocumentRow) {
  return {
    id: row.id,
    documentType: row.document_type,
    sourceId: row.source_id,
    documentNumber: row.document_number,
    customerId: row.customer_id,
    warehouseId: row.warehouse_id,
    versionNo: row.version_no,
    isLatest: row.is_latest,
    qrToken: row.qr_token,
    statusAtGeneration: row.status_at_generation,
    generatedAt: row.generated_at,
    generatedBy: row.generated_by,
    supersededAt: row.superseded_at,
    supersededByDocumentId: row.superseded_by_document_id,
    downloadUrl: `/documents/${row.id}/download`,
  };
}

/**
 * document-engine.md §1: the one entry point that produces a PDF.
 * previewDocument (steps 1-4, no write) / commitDocument (steps 5-6,
 * write + entitlement) is the split from §6; every module that needs a
 * document calls these two methods, never renders its own PDF.
 */
@Injectable()
export class DocumentEngineService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly registry: DocumentTemplateRegistry,
    private readonly pdfRenderer: PdfRendererService,
    private readonly qr: QrService,
    private readonly entitlement: EntitlementService,
    private readonly attachments: AttachmentsService,
    private readonly audit: AuditService,
  ) {}

  async previewDocument(actor: AuthenticatedUser, documentType: string, sourceId: string): Promise<Buffer> {
    const template = this.registry.get(documentType);

    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const data = await template.loadData(tx, actor.tenantId, sourceId);
      if (!data) throw new NotFoundException('Source record not found');

      const [existing] = await tx<{ id: string }[]>`
        select id from documents
        where tenant_id = ${actor.tenantId} and document_type = ${documentType}
          and source_id = ${sourceId} and is_latest
      `;
      // saas-layer §8: viewing/re-rendering an already-committed document is never a new unit of
      // usage, so the paywall only gates a source that hasn't been generated yet.
      if (!existing) {
        const check = await this.entitlement.checkEntitlement(actor.tenantId, template.featureCode);
        if (!check.allowed) {
          throw new PaywallException(template.featureCode, await this.featureName(tx, template.featureCode), check);
        }
      }

      const qrToken = randomUUID();
      const [qrDataUri, company] = await Promise.all([
        this.qr.dataUri(qrToken),
        loadCompanyContext(tx, actor.tenantId, (key) => this.attachments.readByStorageKey(key)),
      ]);
      const images = await inlineImages(tx, actor.tenantId, data.imageAttachmentIds, (key) =>
        this.attachments.readByStorageKey(key),
      );
      const html = template.renderHtml(data, { company, qrDataUri, qrToken, images });
      return this.pdfRenderer.renderPdf(html);
    });
  }

  async commitDocument(
    actor: AuthenticatedUser,
    documentType: string,
    sourceId: string,
    opts: { regenerate?: boolean } = {},
    ipAddress?: string,
  ) {
    const template = this.registry.get(documentType);

    const row = await withTenant(this.sql, actor.tenantId, async (tx) => {
      const [existing] = await tx<DocumentRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from documents
        where tenant_id = ${actor.tenantId} and document_type = ${documentType}
          and source_id = ${sourceId} and is_latest
        for update
      `;

      // document-engine.md §7: "a retried Generate click on a request that timed out produces
      // exactly one documents row" -- a plain (non-regenerate) commit on an already-committed
      // source is a no-op that returns the existing row, never a second render.
      if (existing && !opts.regenerate) return existing;
      if (!existing && opts.regenerate) {
        throw new BadRequestException('Cannot regenerate: no existing document for this source yet');
      }

      const data = await template.loadData(tx, actor.tenantId, sourceId);
      if (!data) throw new NotFoundException('Source record not found');

      if (opts.regenerate) {
        await this.assertMayRegenerate(tx, actor, documentType, sourceId, data.statusAtGeneration, ipAddress);
      }

      if (!existing) {
        // First-ever commit for this source is the only time entitlement is consumed --
        // regeneration (below) reuses it, matching §7's "does not call consumeEntitlement again."
        const idempotencyKey = `${documentType}:${sourceId}:generate`;
        const consumeResult = await this.entitlement.consumeEntitlement({
          tenantId: actor.tenantId,
          featureCode: template.featureCode,
          userId: actor.userId,
          sourceId,
          documentType,
          idempotencyKey,
        });
        if (!consumeResult.allowed) {
          throw new PaywallException(template.featureCode, await this.featureName(tx, template.featureCode), consumeResult);
        }
      }

      const qrToken = randomUUID();
      const [qrDataUri, company] = await Promise.all([
        this.qr.dataUri(qrToken),
        loadCompanyContext(tx, actor.tenantId, (key) => this.attachments.readByStorageKey(key)),
      ]);
      const images = await inlineImages(tx, actor.tenantId, data.imageAttachmentIds, (key) =>
        this.attachments.readByStorageKey(key),
      );
      const html = template.renderHtml(data, { company, qrDataUri, qrToken, images });
      const pdfBytes = await this.pdfRenderer.renderPdf(html);

      const attachment = await this.attachments.create(tx, {
        tenantId: actor.tenantId,
        ownerType: documentType,
        ownerId: sourceId,
        category: documentType,
        fileName: `${data.documentNumber.replace(/\//g, '-')}-v${existing ? existing.version_no + 1 : 1}.pdf`,
        contentType: 'application/pdf',
        bytes: pdfBytes,
        uploadedBy: actor.userId,
      });

      const newId = randomUUID();
      const versionNo = existing ? existing.version_no + 1 : 1;
      let inserted: DocumentRow;
      try {
        [inserted] = await tx<DocumentRow[]>`
          insert into documents (
            id, tenant_id, document_type, source_id, document_number, customer_id, warehouse_id,
            version_no, is_latest, file_attachment_id, render_data_snapshot, qr_token,
            status_at_generation, generated_by
          ) values (
            ${newId}, ${actor.tenantId}, ${documentType}, ${sourceId}, ${data.documentNumber},
            ${data.customerId}, ${data.warehouseId}, ${versionNo}, true, ${attachment.id},
            ${JSON.stringify(data.snapshot)}::jsonb, ${qrToken}, ${data.statusAtGeneration}, ${actor.userId}
          )
          returning ${tx.unsafe(SELECT_COLUMNS)}
        `;
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          // Lost a race to a concurrent commit for the same source -- the entitlement unit was
          // still only consumed once (usage_ledger's own idempotency key saw to that); return
          // whichever commit actually won the documents insert, rather than erroring or duplicating.
          const [winner] = await tx<DocumentRow[]>`
            select ${tx.unsafe(SELECT_COLUMNS)} from documents
            where tenant_id = ${actor.tenantId} and document_type = ${documentType}
              and source_id = ${sourceId} and is_latest
          `;
          if (!winner) throw err;
          return winner;
        }
        throw err;
      }

      if (existing) {
        await tx`
          update documents set is_latest = false, superseded_at = now(), superseded_by_document_id = ${newId}
          where id = ${existing.id}
        `;
      }
      return inserted;
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'document_generate',
      entityType: documentType,
      entityId: sourceId,
      newValue: { documentId: row.id, versionNo: row.version_no, documentNumber: row.document_number },
      ipAddress,
    });

    return toApi(row);
  }

  async get(actor: AuthenticatedUser, id: string) {
    const [row] = await withTenant(this.sql, actor.tenantId, (tx) => tx<DocumentRow[]>`
      select ${tx.unsafe(SELECT_COLUMNS)} from documents where id = ${id} and tenant_id = ${actor.tenantId}
    `);
    if (!row) throw new NotFoundException('Document not found');
    return toApi(row);
  }

  /**
   * ux-system.md §5's Document Centre. It returned a bare, unpaginated
   * array until Phase 8: fine while a tenant had a handful of documents,
   * and a growing full-table read after that -- on the one screen whose
   * whole job is to accumulate. It now filters on the four things §5 names
   * (type, customer, warehouse, date range), searches the document number,
   * narrows to the caller's warehouse scope, and pages like every other
   * list in the API.
   */
  async list(
    actor: AuthenticatedUser,
    query: { documentType?: string; sourceId?: string; customerId?: string; warehouseId?: string; q?: string; from?: string; to?: string; latestOnly?: boolean; limit?: number; offset?: number },
  ) {
    const typeFilter = query.documentType ?? null;
    const sourceFilter = query.sourceId ?? null;
    const customerFilter = query.customerId ?? null;
    const warehouseFilter = query.warehouseId ?? null;
    const pattern = query.q ? `%${query.q}%` : null;
    const from = query.from ?? null;
    const to = query.to ?? null;
    const latestOnly = query.latestOnly ?? true;
    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;

    return withTenant(this.sql, actor.tenantId, async (tx) => {
      const scope = await loadWarehouseScope(tx, actor);
      const where = tx`
        where tenant_id = ${actor.tenantId}
          and (${scope}::uuid[] is null or warehouse_id is null or warehouse_id = any(${scope}))
          and (${typeFilter}::text is null or document_type = ${typeFilter})
          and (${sourceFilter}::uuid is null or source_id = ${sourceFilter})
          and (${customerFilter}::uuid is null or customer_id = ${customerFilter})
          and (${warehouseFilter}::uuid is null or warehouse_id = ${warehouseFilter})
          and (${pattern}::text is null or document_number ilike ${pattern})
          and (${from}::date is null or generated_at >= ${from}::date)
          and (${to}::date is null or generated_at < (${to}::date + 1))
          and (${!latestOnly}::boolean or is_latest)`;
      const rows = await tx<DocumentRow[]>`
        select ${tx.unsafe(SELECT_COLUMNS)} from documents ${where}
        order by generated_at desc limit ${limit} offset ${offset}
      `;
      const [{ count }] = await tx<{ count: string }[]>`select count(*)::text as count from documents ${where}`;
      return { items: rows.map(toApi), total: Number(count), limit, offset };
    });
  }

  /**
   * The signed-link path into the same bytes `downloadBytes` serves. It
   * takes verified claims rather than a request, so the only way to reach
   * it is through `DownloadLinkService.verify()`.
   *
   * The customer check is repeated here rather than trusted from the
   * link: the claims say who the link was minted for, and this asserts
   * the document still belongs to them. A customer whose portal access is
   * later removed keeps any unexpired link they were already holding --
   * that is inherent to a bearer capability, and the reason the lifetime
   * is minutes -- but a link can never be walked sideways onto another
   * customer's document, whatever the claims say.
   */
  async downloadBytesByClaims(claims: { documentId: string; tenantId: string; customerId: string | null }) {
    const [row] = await withTenant(this.sql, claims.tenantId, (tx) => tx<DocumentRow[]>`
      select ${tx.unsafe(SELECT_COLUMNS)} from documents
      where id = ${claims.documentId} and tenant_id = ${claims.tenantId}
        and (${claims.customerId}::uuid is null or customer_id = ${claims.customerId})
    `);
    if (!row) throw new NotFoundException('Document not found');
    const { bytes } = await this.attachments.readBytes(claims.tenantId, row.file_attachment_id);
    return { fileName: `${row.document_number.replace(/\//g, '-')}.pdf`, bytes };
  }

  async downloadBytes(actor: AuthenticatedUser, id: string) {
    const [row] = await withTenant(this.sql, actor.tenantId, (tx) => tx<DocumentRow[]>`
      select ${tx.unsafe(SELECT_COLUMNS)} from documents where id = ${id} and tenant_id = ${actor.tenantId}
    `);
    if (!row) throw new NotFoundException('Document not found');
    const { bytes } = await this.attachments.readBytes(actor.tenantId, row.file_attachment_id);
    return { fileName: `${row.document_number.replace(/\//g, '-')}.pdf`, bytes };
  }

  /**
   * document-engine.md §2's regeneration rule, which until now was
   * documented and seeded but never enforced -- `regenerate: true` was
   * honoured for anyone holding the source record's own create
   * permission. That mattered: a Warehouse Operator holds `create_grn`
   * and neither regenerate code, and could supersede an approved GRN's
   * document, which flips the copy the customer is already holding to
   * `revoked` on the public verify page. Unmetered, too, since
   * regeneration deliberately does not consume a second entitlement unit.
   *
   * Checked here rather than with `@RequirePermission` because the answer
   * depends on the *body* (`regenerate`) and on the source record's
   * current status -- neither of which a route decorator can see.
   * Denials are audited exactly as `PermissionsGuard` audits its own, so
   * a refused regeneration looks the same in the audit log however it was
   * refused.
   */
  private async assertMayRegenerate(
    tx: postgres.TransactionSql,
    actor: AuthenticatedUser,
    documentType: string,
    sourceId: string,
    sourceStatus: string,
    ipAddress?: string,
  ) {
    const required = ['regenerate_document'];
    const elevated = elevatedPermissionForRegeneration(documentType, sourceStatus);
    if (elevated) required.push(elevated);

    for (const permissionCode of required) {
      if (await hasPermission(tx, actor, permissionCode)) continue;

      await this.audit.record({
        tenantId: actor.tenantId,
        userId: actor.userId,
        userRoleCode: actor.roleCode,
        action: 'permission_denied',
        entityType: documentType,
        entityId: sourceId,
        newValue: { required: permissionCode, reason: 'regenerate', sourceStatus },
        ipAddress,
      });
      throw new ForbiddenException(
        elevated && permissionCode === elevated
          ? `Missing permission: ${permissionCode} -- this ${documentType.replace(/_/g, ' ')} is '${sourceStatus}', ` +
            `so regenerating it would supersede a document that has already been issued`
          : `Missing permission: ${permissionCode}`,
      );
    }
  }

  private async featureName(tx: postgres.TransactionSql, featureCode: string): Promise<string> {
    const [row] = await tx<{ name: string }[]>`select name from feature_keys where code = ${featureCode}`;
    return row?.name ?? featureCode;
  }
}
