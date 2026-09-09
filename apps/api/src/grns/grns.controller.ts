import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { GenerateDocumentDto } from '../documents/dto/generate-document.dto';
import { DocumentEngineService } from '../documents/documents.service';
import { CreateGrnDto } from './dto/create-grn.dto';
import { ListGrnsQuery } from './dto/list-grns.query';
import { UpdateGrnDto } from './dto/update-grn.dto';
import { GrnsService } from './grns.service';

/**
 * Blueprint §50's approval engine, "GRN: Operator -> Manager": everything
 * an Operator does (create/edit/submit/cancel and the document) rides
 * `create_grn`; the Manager-side verification steps (check/approve/reject)
 * ride `approve_grn`, which permissions-matrix.md withholds from
 * Warehouse Operator.
 */
@Controller('grns')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class GrnsController {
  constructor(
    private readonly grns: GrnsService,
    private readonly documentEngine: DocumentEngineService,
  ) {}

  @Post()
  @RequirePermission('create_grn')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateGrnDto, @Ip() ip: string) {
    return this.grns.create(user, dto, ip);
  }

  @Get()
  @RequirePermission('create_grn')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListGrnsQuery) {
    return this.grns.list(user, query);
  }

  @Get(':id')
  @RequirePermission('create_grn')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.grns.get(user, id);
  }

  @Patch(':id')
  @RequirePermission('create_grn')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGrnDto,
    @Ip() ip: string,
  ) {
    return this.grns.update(user, id, dto, ip);
  }

  @Post(':id/submit')
  @RequirePermission('create_grn')
  submit(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.grns.submit(user, id, ip);
  }

  @Post(':id/check')
  @RequirePermission('approve_grn')
  check(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.grns.check(user, id, ip);
  }

  @Post(':id/approve')
  @RequirePermission('approve_grn')
  approve(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.grns.approve(user, id, ip);
  }

  @Post(':id/reject')
  @RequirePermission('approve_grn')
  reject(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.grns.reject(user, id, ip);
  }

  @Post(':id/cancel')
  @RequirePermission('create_grn')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.grns.cancel(user, id, ip);
  }

  @Post(':id/document/preview')
  @RequirePermission('create_grn')
  async previewDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const pdf = await this.documentEngine.previewDocument(user, 'grn', id);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(pdf);
  }

  @Post(':id/document')
  @RequirePermission('create_grn')
  generateDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GenerateDocumentDto,
    @Ip() ip: string,
  ) {
    return this.documentEngine.commitDocument(user, 'grn', id, { regenerate: dto.regenerate }, ip);
  }
}
