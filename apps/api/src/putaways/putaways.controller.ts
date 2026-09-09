import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { GenerateDocumentDto } from '../documents/dto/generate-document.dto';
import { DocumentEngineService } from '../documents/documents.service';
import { CreatePutawayDto } from './dto/create-putaway.dto';
import { ListPutawaysQuery } from './dto/list-putaways.query';
import { PutawaysService } from './putaways.service';

/**
 * permissions-matrix.md seeds `create_putaway` *and* `complete_putaway`
 * as separate codes -- the only Phase 4 record with a distinct
 * completion permission -- so confirming placements is gated separately
 * from raising the slip. There is no `edit_putaway`: a slip is raised
 * with its locations already chosen, then confirmed or cancelled.
 */
@Controller('putaways')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PutawaysController {
  constructor(
    private readonly putaways: PutawaysService,
    private readonly documentEngine: DocumentEngineService,
  ) {}

  @Post()
  @RequirePermission('create_putaway')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePutawayDto, @Ip() ip: string) {
    return this.putaways.create(user, dto, ip);
  }

  @Get()
  @RequirePermission('create_putaway')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListPutawaysQuery) {
    return this.putaways.list(user, query);
  }

  @Get(':id')
  @RequirePermission('create_putaway')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.putaways.get(user, id);
  }

  @Post(':id/start')
  @RequirePermission('create_putaway')
  start(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.putaways.start(user, id, ip);
  }

  @Post(':id/complete')
  @RequirePermission('complete_putaway')
  complete(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.putaways.complete(user, id, ip);
  }

  @Post(':id/cancel')
  @RequirePermission('create_putaway')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.putaways.cancel(user, id, ip);
  }

  @Post(':id/document/preview')
  @RequirePermission('create_putaway')
  async previewDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const pdf = await this.documentEngine.previewDocument(user, 'putaway', id);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(pdf);
  }

  @Post(':id/document')
  @RequirePermission('create_putaway')
  generateDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GenerateDocumentDto,
    @Ip() ip: string,
  ) {
    return this.documentEngine.commitDocument(user, 'putaway', id, { regenerate: dto.regenerate }, ip);
  }
}
