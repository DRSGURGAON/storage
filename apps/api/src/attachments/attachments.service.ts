import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { AttachmentStorage } from './attachment-storage';
import { ATTACHMENT_STORAGE } from './attachments.tokens';

export interface CreateAttachmentParams {
  tenantId: string;
  ownerType: string;
  ownerId: string;
  category: string;
  fileName: string;
  contentType: string;
  bytes: Buffer;
  uploadedBy?: string;
}

interface AttachmentRow {
  id: string;
  file_name: string;
  content_type: string;
  size_bytes: string;
  storage_key: string;
}

/**
 * Backs generated-document PDF storage for now (schema/00_core.sql
 * `attachments`, owner_type='quotation' etc.) -- not yet the general
 * KYC-document/upload feature described in the blueprint (dev-phases.md
 * still lists that as a Phase 4 item).
 */
@Injectable()
export class AttachmentsService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStorage,
  ) {}

  async create(tx: postgres.TransactionSql, params: CreateAttachmentParams): Promise<AttachmentRow> {
    const id = randomUUID();
    const sha256 = createHash('sha256').update(params.bytes).digest('hex');
    const storageKey = await this.storage.put(params.tenantId, id, params.fileName, params.bytes);

    const [row] = await tx<AttachmentRow[]>`
      insert into attachments (
        id, tenant_id, owner_type, owner_id, category, file_name, content_type,
        size_bytes, storage_key, sha256, uploaded_by
      ) values (
        ${id}, ${params.tenantId}, ${params.ownerType}, ${params.ownerId}, ${params.category},
        ${params.fileName}, ${params.contentType}, ${params.bytes.length}, ${storageKey}, ${sha256},
        ${params.uploadedBy ?? null}
      )
      returning id, file_name, content_type, size_bytes, storage_key
    `;
    return row;
  }

  async readBytes(tenantId: string, attachmentId: string): Promise<{ row: AttachmentRow; bytes: Buffer }> {
    const [row] = await withTenant(this.sql, tenantId, (tx) => tx<AttachmentRow[]>`
      select id, file_name, content_type, size_bytes, storage_key from attachments
      where id = ${attachmentId} and tenant_id = ${tenantId}
    `);
    if (!row) throw new NotFoundException('Attachment not found');
    const bytes = await this.storage.read(row.storage_key);
    return { row, bytes };
  }
}
