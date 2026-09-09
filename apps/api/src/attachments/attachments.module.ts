import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'node:path';
import { AttachmentsService } from './attachments.service';
import { ATTACHMENT_STORAGE } from './attachments.tokens';
import { LocalFilesystemAttachmentStorage } from './local-filesystem-attachment-storage';

@Module({
  providers: [
    AttachmentsService,
    {
      provide: ATTACHMENT_STORAGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new LocalFilesystemAttachmentStorage(
          path.resolve(config.get<string>('ATTACHMENTS_DIR') ?? './storage/attachments'),
        ),
    },
  ],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
