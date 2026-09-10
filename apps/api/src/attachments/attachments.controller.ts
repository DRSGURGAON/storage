import {
  Body,
  Controller,
  Delete,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { ATTACHMENT_CATEGORIES, ATTACHMENT_OWNERS } from './attachment-owners';
import { AttachmentUploadsService, UploadedBytes } from './attachment-uploads.service';

export class UploadAttachmentDto {
  @IsIn(Object.keys(ATTACHMENT_OWNERS)) ownerType!: string;
  @IsUUID() ownerId!: string;
  @IsIn(ATTACHMENT_CATEGORIES as unknown as string[]) category!: string;
}

export class ListAttachmentsQuery {
  @IsIn(Object.keys(ATTACHMENT_OWNERS)) ownerType!: string;
  @IsUUID() ownerId!: string;
}

export class DownloadQuery {
  /** `?download=1` asks the browser to save rather than render it. */
  @IsOptional() @IsString() download?: string;
}

/**
 * No `@RequirePermission` here, and `PermissionsGuard` is deliberately
 * absent rather than declared-and-unenforced: the permission an upload
 * needs depends on what it is being attached to, which a decorator
 * evaluated before the body is read cannot know. `PermissionsGuard` fails
 * closed on an undeclared route by design, so the check lives in
 * `AttachmentUploadsService` against the same `hasPermission` lookup the
 * guard uses -- the same arrangement `/search` and document regeneration
 * already use.
 */
@Controller('attachments')
@UseGuards(JwtAuthGuard)
export class AttachmentsController {
  constructor(private readonly uploads: AttachmentUploadsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @CurrentUser() user: AuthenticatedUser,
    // Multipart fields arrive as strings on the body, so the DTO is
    // validated by the global pipe exactly as any other body would be.
    @Body() dto: UploadAttachmentDto,
    @UploadedFile() file: UploadedBytes,
    @Ip() ip: string,
  ) {
    return this.uploads.upload(user, dto, file, ip);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListAttachmentsQuery) {
    return this.uploads.list(user, query);
  }

  @Get(':id/file')
  async file(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: DownloadQuery,
    @Res() res: Response,
  ) {
    const found = await this.uploads.read(user, id);
    res.setHeader('Content-Type', found.content_type);
    // Inline by default so a photo renders in the record it belongs to.
    res.setHeader(
      'Content-Disposition',
      `${query.download ? 'attachment' : 'inline'}; filename="${found.file_name.replace(/"/g, '')}"`,
    );
    res.send(found.bytes);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.uploads.remove(user, id, ip);
  }
}
