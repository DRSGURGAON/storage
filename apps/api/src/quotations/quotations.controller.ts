import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { GenerateDocumentDto } from '../documents/dto/generate-document.dto';
import { DocumentEngineService } from '../documents/documents.service';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { ListQuotationsQuery } from './dto/list-quotations.query';
import { RejectQuotationDto } from './dto/reject-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import { QuotationsService } from './quotations.service';

@Controller('quotations')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class QuotationsController {
  constructor(
    private readonly quotations: QuotationsService,
    private readonly documentEngine: DocumentEngineService,
  ) {}

  @Post()
  @RequirePermission('create_quotation')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateQuotationDto, @Ip() ip: string) {
    return this.quotations.create(user, dto, ip);
  }

  @Get()
  @RequirePermission('view_quotation')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListQuotationsQuery) {
    return this.quotations.list(user, query);
  }

  @Get(':id')
  @RequirePermission('view_quotation')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotations.get(user, id);
  }

  @Patch(':id')
  @RequirePermission('edit_quotation')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateQuotationDto,
    @Ip() ip: string,
  ) {
    return this.quotations.update(user, id, dto, ip);
  }

  @Post(':id/send')
  @RequirePermission('edit_quotation')
  send(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.quotations.send(user, id, ip);
  }

  @Post(':id/accept')
  @RequirePermission('edit_quotation')
  accept(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.quotations.accept(user, id, ip);
  }

  @Post(':id/reject')
  @RequirePermission('edit_quotation')
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectQuotationDto,
    @Ip() ip: string,
  ) {
    return this.quotations.reject(user, id, dto, ip);
  }

  @Post(':id/cancel')
  @RequirePermission('edit_quotation')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.quotations.cancel(user, id, ip);
  }

  /** document-engine.md §6: preview renders without writing anything -- same permission as viewing the quotation itself. */
  @Post(':id/document/preview')
  @RequirePermission('view_quotation')
  async previewDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const pdf = await this.documentEngine.previewDocument(user, 'quotation', id);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(pdf);
  }

  /** Commits (and, with `{regenerate:true}`, re-versions) the quotation's PDF -- gated on create_quotation, since issuing the document is a creation-like action distinct from merely viewing the record. */
  @Post(':id/document')
  @RequirePermission('create_quotation')
  generateDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GenerateDocumentDto,
    @Ip() ip: string,
  ) {
    return this.documentEngine.commitDocument(user, 'quotation', id, { regenerate: dto.regenerate }, ip);
  }
}
