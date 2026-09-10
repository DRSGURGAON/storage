import { Injectable } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { AttachmentStorage } from './attachment-storage';

/** V1 implementation of AttachmentStorage (DECISIONS.md §24) -- see that entry before assuming this is the production strategy. */
@Injectable()
export class LocalFilesystemAttachmentStorage implements AttachmentStorage {
  constructor(private readonly baseDir: string) {}

  async put(tenantId: string, attachmentId: string, fileName: string, bytes: Buffer): Promise<string> {
    const safeName = fileName.replace(/[^A-Za-z0-9_.-]/g, '_');
    const storageKey = `${tenantId}/${attachmentId}-${safeName}`;
    const fullPath = path.join(this.baseDir, storageKey);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, bytes);
    return storageKey;
  }

  async read(storageKey: string): Promise<Buffer> {
    return fs.readFile(path.join(this.baseDir, storageKey));
  }

  async remove(storageKey: string): Promise<void> {
    await fs.rm(path.join(this.baseDir, storageKey), { force: true });
  }
}
