import { Controller, Get, Param, ParseUUIDPipe, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { DocumentEngineService } from './documents.service';
import { ListDocumentsQuery } from './dto/list-documents.query';

/**
 * document-engine.md §8 / ux-system.md §5: the Document Centre's read
 * side -- one list/get/download surface for every document type, gated
 * on `view_documents` (broad, already granted to most roles) rather than
 * each source record's own narrower permission. Write endpoints
 * (preview/commit) live on each owning resource's own controller instead
 * -- see quotations.controller.ts -- since only that resource knows the
 * right permission to require.
 */
@Controller('documents')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DocumentsController {
  constructor(private readonly documents: DocumentEngineService) {}

  @Get()
  @RequirePermission('view_documents')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListDocumentsQuery) {
    return this.documents.list(user, {
      documentType: query.documentType,
      sourceId: query.sourceId,
      latestOnly: query.latestOnly ?? true,
    });
  }

  @Get(':id')
  @RequirePermission('view_documents')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.documents.get(user, id);
  }

  @Get(':id/download')
  @RequirePermission('view_documents')
  async download(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const { fileName, bytes } = await this.documents.downloadBytes(user, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    res.send(bytes);
  }
}
