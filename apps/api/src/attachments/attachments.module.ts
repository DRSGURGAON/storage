import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import * as path from 'node:path';
import { AuditModule } from '../audit/audit.module';
import { AttachmentsController } from './attachments.controller';
import { AttachmentUploadsService } from './attachment-uploads.service';
import { AttachmentsService } from './attachments.service';
import { ATTACHMENT_STORAGE } from './attachments.tokens';
import { LocalFilesystemAttachmentStorage } from './local-filesystem-attachment-storage';

@Module({
  imports: [
    AuditModule,
    // In memory, not on disk: the bytes are hashed and handed straight to
    // AttachmentStorage, so a temp file would only be a second copy to
    // clean up. The limit is enforced here as well as in the service --
    // this one stops reading at the socket, before a large body is
    // buffered at all.
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        limits: { fileSize: Number(config.get('ATTACHMENT_MAX_BYTES') ?? 10 * 1024 * 1024), files: 1 },
      }),
    }),
  ],
  controllers: [AttachmentsController],
  providers: [
    AttachmentsService,
    AttachmentUploadsService,
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
