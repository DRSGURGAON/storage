/**
 * DECISIONS.md §24: the repository's own architecture note commits V1 to
 * "S3-compatible object storage, signed URLs" for `attachments.storage_key`
 * -- but no bucket or credentials exist in this environment to point a
 * real S3 client at, and inventing one would be choosing infrastructure
 * the user hasn't provisioned. This interface is the seam: swapping the
 * one implementation below for a real `S3AttachmentStorage` later touches
 * no caller, no schema, and no other file -- only which provider
 * `AttachmentsModule` binds.
 */
export interface AttachmentStorage {
  /** Writes the bytes and returns the opaque `storage_key` to persist on the `attachments` row. */
  put(tenantId: string, attachmentId: string, fileName: string, bytes: Buffer): Promise<string>;

  /** Reads the bytes back by `storage_key`. */
  read(storageKey: string): Promise<Buffer>;
}
