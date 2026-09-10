import { Injectable, Logger } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { AttachmentStorage } from './attachment-storage';

export interface S3StorageOptions {
  bucket: string;
  region: string;
  /** Set for anything that is not AWS itself: MinIO, Cloudflare R2, DigitalOcean Spaces, Wasabi. */
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /**
   * Path-style addressing (`https://host/bucket/key`) rather than virtual-host
   * (`https://bucket.host/key`). Required by MinIO and by any endpoint whose
   * DNS does not resolve `<bucket>.<host>`; harmless on AWS, which supports both.
   */
  forcePathStyle?: boolean;
  /** Optional prefix, so one bucket can hold more than this application. */
  prefix?: string;
}

/**
 * `DECISIONS.md` §24, finally: attachments in S3-compatible object storage
 * rather than on one container's disk.
 *
 * This is what makes a second API instance possible. Every generated PDF,
 * KYC document, gate photograph and captured signature was going to
 * `ATTACHMENTS_DIR`, which is a local directory: two containers behind a
 * load balancer would each hold half the files and 404 on the other half.
 *
 * Deliberately written against the S3 *protocol* rather than AWS: an
 * `endpoint` and `forcePathStyle` are all it takes to point this at MinIO
 * in a rack, Cloudflare R2, DigitalOcean Spaces or Wasabi. The one thing
 * it does not do is presign URLs -- this application already mints its own
 * signed download links, which carry a document id and expiry it controls
 * (`tenancy-and-security.md` §5) and work identically whichever storage is
 * behind them. Adding presigned S3 URLs would hand out a second, parallel
 * capability with different rules, which is how a document ends up
 * reachable after the link that named it was supposed to have expired.
 *
 * `storage_key` keeps the same shape as the filesystem adapter's --
 * `<tenant>/<attachment-id>-<filename>` -- so an existing database does not
 * need rewriting to move: copy the directory into the bucket under the
 * same paths and switch `ATTACHMENT_STORAGE`.
 */
@Injectable()
export class S3AttachmentStorage implements AttachmentStorage {
  private readonly logger = new Logger(S3AttachmentStorage.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(options: S3StorageOptions) {
    this.bucket = options.bucket;
    // Normalised to "" or "something/" once, here, so every method below
    // can concatenate without thinking about the slash.
    this.prefix = options.prefix ? options.prefix.replace(/^\/+|\/+$/g, '') + '/' : '';

    const config: S3ClientConfig = {
      region: options.region,
      forcePathStyle: options.forcePathStyle ?? Boolean(options.endpoint),
    };
    if (options.endpoint) config.endpoint = options.endpoint;
    // Credentials are left to the SDK's own chain when they are not given
    // explicitly -- an instance role, a task role, or the environment --
    // which is how a deployment avoids having long-lived keys at all.
    if (options.accessKeyId && options.secretAccessKey) {
      config.credentials = { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey };
    }
    this.client = new S3Client(config);
    this.logger.log(
      `attachments in s3://${this.bucket}/${this.prefix}` +
        (options.endpoint ? ` via ${options.endpoint}` : ' (aws)'),
    );
  }

  async put(tenantId: string, attachmentId: string, fileName: string, bytes: Buffer): Promise<string> {
    // The same key shape the filesystem adapter produces, so the two are
    // interchangeable over an existing `attachments` table.
    const safeName = fileName.replace(/[^A-Za-z0-9_.-]/g, '_');
    const storageKey = `${tenantId}/${attachmentId}-${safeName}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.prefix + storageKey,
        Body: bytes,
        // Not derived from the extension: the caller already knows the real
        // content type from the upload, and guessing here would be a second
        // opinion that can disagree with the `attachments` row.
        ContentLength: bytes.length,
      }),
    );
    return storageKey;
  }

  async read(storageKey: string): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: this.prefix + storageKey }),
    );
    if (!result.Body) throw new Error(`No body returned for ${storageKey}`);
    // `transformToByteArray` reads the whole stream. These are documents and
    // photographs -- a 10 MB ceiling, enforced on upload -- so this is a
    // bounded read rather than an open-ended one.
    return Buffer.from(await result.Body.transformToByteArray());
  }

  async remove(storageKey: string): Promise<void> {
    // S3's DeleteObject is already idempotent: it answers 204 for a key
    // that was never there. That matches the interface's contract --
    // missing bytes are not an error, the row is already gone.
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.prefix + storageKey }));
  }
}
