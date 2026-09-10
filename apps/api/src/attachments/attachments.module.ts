import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import * as path from 'node:path';
import { AuditModule } from '../audit/audit.module';
import { AttachmentsController } from './attachments.controller';
import { AttachmentUploadsService } from './attachment-uploads.service';
import { AttachmentsService } from './attachments.service';
import { ATTACHMENT_STORAGE } from './attachments.tokens';
import { AttachmentStorage } from './attachment-storage';
import { LocalFilesystemAttachmentStorage } from './local-filesystem-attachment-storage';
import { S3AttachmentStorage } from './s3-attachment-storage';

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
      useFactory: chooseStorage,
    },
  ],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}

/**
 * Which storage the deployment gets, decided once, here.
 *
 * `S3_BUCKET` is the switch rather than a separate mode flag: naming a
 * bucket and then not using it is not a state anyone means, and a mode
 * flag set to `s3` with no bucket is a boot that succeeds and fails on the
 * first upload. Setting `ATTACHMENT_STORAGE=local` overrides it, for the
 * case of a staging copy of production's environment that should keep its
 * files to itself.
 *
 * A missing bucket is not defaulted around: the process refuses to start.
 * The alternative -- quietly falling back to the local disk -- gives a
 * multi-container deployment a fleet of half-populated directories and a
 * document that 404s depending on which instance answers.
 */
export function chooseStorage(config: ConfigService): AttachmentStorage {
  const mode = config.get<string>('ATTACHMENT_STORAGE');
  const bucket = config.get<string>('S3_BUCKET');
  const wantsS3 = mode === 's3' || (mode !== 'local' && Boolean(bucket));

  if (!wantsS3) {
    return new LocalFilesystemAttachmentStorage(
      path.resolve(config.get<string>('ATTACHMENTS_DIR') ?? './storage/attachments'),
    );
  }
  if (!bucket) {
    throw new Error('ATTACHMENT_STORAGE=s3 needs S3_BUCKET set to the bucket attachments live in');
  }
  return new S3AttachmentStorage({
    bucket,
    region: config.get<string>('S3_REGION') ?? 'us-east-1',
    endpoint: config.get<string>('S3_ENDPOINT') || undefined,
    accessKeyId: config.get<string>('S3_ACCESS_KEY_ID') || undefined,
    secretAccessKey: config.get<string>('S3_SECRET_ACCESS_KEY') || undefined,
    prefix: config.get<string>('S3_PREFIX') || undefined,
    forcePathStyle: parseBoolean(config.get<string>('S3_FORCE_PATH_STYLE')),
  });
}

function parseBoolean(raw: string | undefined): boolean | undefined {
  if (raw === undefined || raw === '') return undefined;
  return raw === 'true' || raw === '1';
}
