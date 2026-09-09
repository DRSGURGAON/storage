import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AgreementTemplatesService } from './agreement-templates.service';
import { AgreementsService } from './agreements.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { GenerateDocumentDto } from '../documents/dto/generate-document.dto';
import { DocumentEngineService } from '../documents/documents.service';
import { CreateAgreementDto } from './dto/create-agreement.dto';
import { ListAgreementsQuery } from './dto/list-agreements.query';
import { TerminateAgreementDto } from './dto/terminate-agreement.dto';
import { UpdateAgreementDto } from './dto/update-agreement.dto';

@Controller('agreements')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AgreementsController {
  constructor(
    private readonly agreements: AgreementsService,
    private readonly templates: AgreementTemplatesService,
    private readonly documentEngine: DocumentEngineService,
  ) {}

  @Post()
  @RequirePermission('create_agreement')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAgreementDto, @Ip() ip: string) {
    return this.agreements.create(user, dto, ip);
  }

  @Get()
  @RequirePermission('view_agreement')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListAgreementsQuery) {
    return this.agreements.list(user, query);
  }

  @Get('templates')
  @RequirePermission('view_agreement')
  listTemplates(@CurrentUser() user: AuthenticatedUser) {
    return this.templates.list(user.tenantId);
  }

  @Get(':id')
  @RequirePermission('view_agreement')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.agreements.get(user, id);
  }

  @Patch(':id')
  @RequirePermission('edit_agreement')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAgreementDto,
    @Ip() ip: string,
  ) {
    return this.agreements.update(user, id, dto, ip);
  }

  @Post(':id/submit')
  @RequirePermission('edit_agreement')
  submit(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.agreements.submit(user, id, ip);
  }

  /** Owner-only per permissions-matrix.md's approve_agreement row. */
  @Post(':id/approve')
  @RequirePermission('approve_agreement')
  approve(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.agreements.approve(user, id, ip);
  }

  @Post(':id/sign')
  @RequirePermission('edit_agreement')
  sign(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.agreements.sign(user, id, ip);
  }

  @Post(':id/terminate')
  @RequirePermission('edit_agreement')
  terminate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TerminateAgreementDto,
    @Ip() ip: string,
  ) {
    return this.agreements.terminate(user, id, dto, ip);
  }

  @Post(':id/cancel')
  @RequirePermission('edit_agreement')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.agreements.cancel(user, id, ip);
  }

  /** document-engine.md §6: preview renders without writing anything -- same permission as viewing the agreement itself. */
  @Post(':id/document/preview')
  @RequirePermission('view_agreement')
  async previewDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const pdf = await this.documentEngine.previewDocument(user, 'agreement', id);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(pdf);
  }

  /** Commits (and, with `{regenerate:true}`, re-versions) the agreement's PDF -- gated on create_agreement, matching the quotation route's own reasoning (issuing the document is a creation-like action, distinct from merely viewing the record). */
  @Post(':id/document')
  @RequirePermission('create_agreement')
  generateDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GenerateDocumentDto,
    @Ip() ip: string,
  ) {
    return this.documentEngine.commitDocument(user, 'agreement', id, { regenerate: dto.regenerate }, ip);
  }
}
