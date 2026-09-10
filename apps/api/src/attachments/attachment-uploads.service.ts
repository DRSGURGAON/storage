import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { hasPermission } from '../auth/has-permission';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { AttachmentStorage } from './attachment-storage';
import {
  ATTACHMENT_CATEGORIES,
  ATTACHMENT_CONTENT_TYPES,
  ATTACHMENT_OWNERS,
  AttachmentOwner,
} from './attachment-owners';
import { AttachmentsService } from './attachments.service';
import { ATTACHMENT_STORAGE } from './attachments.tokens';

export interface UploadedBytes {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

interface ListedRow {
  id: string;
  owner_type: string;
  owner_id: string;
  category: string;
  file_name: string;
  content_type: string;
  size_bytes: string;
  uploaded_at: Date;
  uploaded_by_name: string | null;
}

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

/**
 * The upload half of `attachments`, which until now had none: the table,
 * the storage seam and the columns that point at a signature all existed,
 * and the only writer was the document engine storing its own PDFs. So
 * blueprint §21's damage photos, §36's POD signature and §9's customer KYC
 * documents were columns with no way to fill them --
 * `DiscrepancyReportsService`'s own header said as much.
 *
 * Three things this does that are easy to get wrong:
 *
 * 1. **The permission comes from what the file is attached to**
 *    (`attachment-owners.ts`), because a route decorator cannot depend on
 *    the request body.
 * 2. **The owner is checked to exist inside `withTenant`**, so pointing an
 *    upload at another workspace's id is a 404, not an unchecked
 *    polymorphic reference.
 * 3. **A linked category writes back.** A POD signature sets
 *    `pods.signature_attachment_id`; deleting it clears the column. A
 *    signature the POD did not point at would print on nothing.
 */
@Injectable()
export class AttachmentUploadsService {
  private readonly logger = new Logger(AttachmentUploadsService.name);
  private readonly maxBytes: number;

  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStorage,
    private readonly attachments: AttachmentsService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    this.maxBytes = Number(config.get('ATTACHMENT_MAX_BYTES') ?? DEFAULT_MAX_BYTES);
  }

  async upload(
    actor: AuthenticatedUser,
    params: { ownerType: string; ownerId: string; category: string },
    file: UploadedBytes | undefined,
    ipAddress?: string,
  ) {
    const owner = this.ownerTypeOrThrow(params.ownerType);
    if (!file) throw new BadRequestException('No file was uploaded');
    if (!(ATTACHMENT_CATEGORIES as readonly string[]).includes(params.category)) {
      throw new BadRequestException(`Unknown category '${params.category}'`);
    }
    if (!(ATTACHMENT_CONTENT_TYPES as readonly string[]).includes(file.mimetype)) {
      throw new BadRequestException(
        `${file.mimetype} is not an accepted file type (${ATTACHMENT_CONTENT_TYPES.join(', ')})`,
      );
    }
    // Multer's own limit rejects at the socket; this catches a limit
    // configured higher there than here, and says the size in words.
    if (file.size > this.maxBytes) {
      throw new PayloadTooLargeException(`That file is larger than ${Math.round(this.maxBytes / 1024 / 1024)} MB`);
    }
    const link = owner.links?.[params.category];

    const row = await this.withWritePermission(actor, owner, async (tx) => {
      await this.ownerRowOrThrow(tx, actor, owner, params.ownerId);
      const created = await this.attachments.create(tx, {
        tenantId: actor.tenantId,
        ownerType: params.ownerType,
        ownerId: params.ownerId,
        category: params.category,
        fileName: file.originalname,
        contentType: file.mimetype,
        bytes: file.buffer,
        uploadedBy: actor.userId,
      });
      if (link) await this.setLink(tx, actor, owner, params.ownerId, link, created.id);
      return created;
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'create',
      entityType: 'attachment',
      entityId: row.id,
      newValue: {
        ownerType: params.ownerType,
        ownerId: params.ownerId,
        category: params.category,
        fileName: row.file_name,
        sizeBytes: Number(row.size_bytes),
      },
      ipAddress,
    });

    return {
      id: row.id,
      ownerType: params.ownerType,
      ownerId: params.ownerId,
      category: params.category,
      fileName: row.file_name,
      contentType: row.content_type,
      sizeBytes: Number(row.size_bytes),
      linkedAs: link ?? null,
    };
  }

  async list(actor: AuthenticatedUser, query: { ownerType: string; ownerId: string }) {
    const owner = this.ownerTypeOrThrow(query.ownerType);
    const granted = await withTenant(this.sql, actor.tenantId, (tx) => hasPermission(tx, actor, owner.read));
    if (!granted) throw new ForbiddenException(`Missing permission: ${owner.read}`);

    // Which of these the owner row actually points at. Uploading a second
    // logo does not delete the first, so without this the list shows two
    // logos as equals and nothing says which one prints.
    const linked = await this.linkedIds(actor, owner, query.ownerId);

    const rows = await withTenant(this.sql, actor.tenantId, (tx) => tx<ListedRow[]>`
      select a.id, a.owner_type, a.owner_id, a.category, a.file_name, a.content_type,
             a.size_bytes, a.uploaded_at, u.full_name as uploaded_by_name
      from attachments a
      left join users u on u.id = a.uploaded_by
      where a.tenant_id = ${actor.tenantId}
        and a.owner_type = ${query.ownerType} and a.owner_id = ${query.ownerId}
        and a.category <> 'document'
      order by a.uploaded_at desc
    `);
    return rows.map((r) => ({
      id: r.id,
      ownerType: r.owner_type,
      ownerId: r.owner_id,
      category: r.category,
      fileName: r.file_name,
      contentType: r.content_type,
      sizeBytes: Number(r.size_bytes),
      uploadedAt: r.uploaded_at,
      uploadedBy: r.uploaded_by_name,
      /** True for the one the record itself points at, where a category links. */
      isLinked: linked.has(r.id),
    }));
  }

  /** The bytes themselves, for `<img src>` and for downloading. */
  async read(actor: AuthenticatedUser, attachmentId: string) {
    const [row] = await withTenant(this.sql, actor.tenantId, (tx) => tx<
      { owner_type: string; category: string; file_name: string; content_type: string; storage_key: string }[]
    >`
      select owner_type, category, file_name, content_type, storage_key from attachments
      where id = ${attachmentId} and tenant_id = ${actor.tenantId} and category <> 'document'
    `);
    if (!row) throw new NotFoundException('Attachment not found');
    const owner = this.ownerTypeOrThrow(row.owner_type);
    const granted = await withTenant(this.sql, actor.tenantId, (tx) => hasPermission(tx, actor, owner.read));
    if (!granted) throw new ForbiddenException(`Missing permission: ${owner.read}`);
    return { ...row, bytes: await this.storage.read(row.storage_key) };
  }

  async remove(actor: AuthenticatedUser, attachmentId: string, ipAddress?: string) {
    const [row] = await withTenant(this.sql, actor.tenantId, (tx) => tx<
      { owner_type: string; owner_id: string; category: string; file_name: string; storage_key: string }[]
    >`
      select owner_type, owner_id, category, file_name, storage_key from attachments
      where id = ${attachmentId} and tenant_id = ${actor.tenantId} and category <> 'document'
    `);
    if (!row) throw new NotFoundException('Attachment not found');
    const owner = this.ownerTypeOrThrow(row.owner_type);
    const link = owner.links?.[row.category];

    await this.withWritePermission(actor, owner, async (tx) => {
      // The column first: a row deleted while something still points at it
      // would leave a dangling id that reads as "there is a signature".
      // Only when it points at *this* one -- a second signature uploaded
      // over the first takes the link with it, and deleting the first
      // afterwards must not clear a link to the second.
      if (link) await this.clearLink(tx, actor, owner, row.owner_id, link, attachmentId);
      await tx`delete from attachments where id = ${attachmentId} and tenant_id = ${actor.tenantId}`;
    });

    // After the commit, and never fatal: the row is what the application
    // reads, so bytes left behind by a failed unlink are waste, not a
    // wrong answer -- while an unlink before the commit could delete the
    // file for a delete that then rolled back.
    try {
      await this.storage.remove(row.storage_key);
    } catch (error) {
      this.logger.warn(`Deleted attachment ${attachmentId} but could not remove its bytes: ${(error as Error).message}`);
    }

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'delete',
      entityType: 'attachment',
      entityId: attachmentId,
      previousValue: { ownerType: row.owner_type, ownerId: row.owner_id, category: row.category, fileName: row.file_name },
      ipAddress,
    });
    return { id: attachmentId, deleted: true };
  }

  /** The attachment ids the owner row's own columns point at, if any. */
  private async linkedIds(actor: AuthenticatedUser, owner: AttachmentOwner, ownerId: string): Promise<Set<string>> {
    const columns = Object.values(owner.links ?? {});
    if (columns.length === 0) return new Set();
    const selection = columns.map((c) => `"${c}"`).join(', ');
    const [row] = await withTenant(this.sql, actor.tenantId, (tx) =>
      owner.isTenantRow
        ? tx<Record<string, string | null>[]>`select ${tx.unsafe(selection)} from tenants where id = ${actor.tenantId}`
        : tx<Record<string, string | null>[]>`
            select ${tx.unsafe(selection)} from ${tx.unsafe(owner.table)}
            where id = ${ownerId} and tenant_id = ${actor.tenantId}
          `,
    );
    return new Set(Object.values(row ?? {}).filter((value): value is string => Boolean(value)));
  }

  private ownerTypeOrThrow(ownerType: string): AttachmentOwner {
    const owner = ATTACHMENT_OWNERS[ownerType];
    if (!owner) {
      throw new BadRequestException(
        `Nothing can be attached to '${ownerType}' (${Object.keys(ATTACHMENT_OWNERS).join(', ')})`,
      );
    }
    return owner;
  }

  private async withWritePermission<T>(
    actor: AuthenticatedUser,
    owner: AttachmentOwner,
    work: (tx: postgres.TransactionSql) => Promise<T>,
  ): Promise<T> {
    return withTenant(this.sql, actor.tenantId, async (tx) => {
      if (!(await hasPermission(tx, actor, owner.write))) {
        throw new ForbiddenException(`Missing permission: ${owner.write}`);
      }
      return work(tx);
    });
  }

  private async ownerRowOrThrow(
    tx: postgres.TransactionSql,
    actor: AuthenticatedUser,
    owner: AttachmentOwner,
    ownerId: string,
  ) {
    // `owner.table` comes from this file's own table, never from the
    // request -- which is what makes the interpolation safe.
    const found = owner.isTenantRow
      ? await tx`select 1 from tenants where id = ${ownerId} and id = ${actor.tenantId}`
      : await tx`select 1 from ${tx.unsafe(owner.table)} where id = ${ownerId} and tenant_id = ${actor.tenantId}`;
    if (found.length === 0) throw new NotFoundException('That record does not exist in this workspace');
  }

  private async clearLink(
    tx: postgres.TransactionSql,
    actor: AuthenticatedUser,
    owner: AttachmentOwner,
    ownerId: string,
    column: string,
    attachmentId: string,
  ) {
    if (owner.isTenantRow) {
      await tx`
        update tenants set ${tx.unsafe(column)} = null
        where id = ${actor.tenantId} and ${tx.unsafe(column)} = ${attachmentId}
      `;
      return;
    }
    await tx`
      update ${tx.unsafe(owner.table)} set ${tx.unsafe(column)} = null
      where id = ${ownerId} and tenant_id = ${actor.tenantId} and ${tx.unsafe(column)} = ${attachmentId}
    `;
  }

  private async setLink(
    tx: postgres.TransactionSql,
    actor: AuthenticatedUser,
    owner: AttachmentOwner,
    ownerId: string,
    column: string,
    attachmentId: string,
  ) {
    if (owner.isTenantRow) {
      await tx`update tenants set ${tx.unsafe(column)} = ${attachmentId} where id = ${actor.tenantId}`;
      return;
    }
    await tx`
      update ${tx.unsafe(owner.table)} set ${tx.unsafe(column)} = ${attachmentId}
      where id = ${ownerId} and tenant_id = ${actor.tenantId}
    `;
  }
}
