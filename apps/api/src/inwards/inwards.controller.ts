import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { GenerateDocumentDto } from '../documents/dto/generate-document.dto';
import { DocumentEngineService } from '../documents/documents.service';
import { CreateInwardDto } from './dto/create-inward.dto';
import { ListInwardsQuery } from './dto/list-inwards.query';
import { UpdateInwardDto } from './dto/update-inward.dto';
import { InwardsService } from './inwards.service';

/** permissions-matrix.md seeds `create_inward` (paired with `create_gate_entry` in the same row) as the only Inward permission -- every route here rides it, matching Gate Entry's own single-permission shape. */
@Controller('inwards')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class InwardsController {
  constructor(
    private readonly inwards: InwardsService,
    private readonly documentEngine: DocumentEngineService,
  ) {}

  @Post()
  @RequirePermission('create_inward')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateInwardDto, @Ip() ip: string) {
    return this.inwards.create(user, dto, ip);
  }

  @Get()
  @RequirePermission('create_inward')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListInwardsQuery) {
    return this.inwards.list(user, query);
  }

  @Get(':id')
  @RequirePermission('create_inward')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.inwards.get(user, id);
  }

  @Patch(':id')
  @RequirePermission('create_inward')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInwardDto,
    @Ip() ip: string,
  ) {
    return this.inwards.update(user, id, dto, ip);
  }

  @Post(':id/receive')
  @RequirePermission('create_inward')
  receive(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.inwards.receive(user, id, ip);
  }

  @Post(':id/cancel')
  @RequirePermission('create_inward')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.inwards.cancel(user, id, ip);
  }

  @Post(':id/document/preview')
  @RequirePermission('create_inward')
  async previewDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const pdf = await this.documentEngine.previewDocument(user, 'inward', id);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(pdf);
  }

  @Post(':id/document')
  @RequirePermission('create_inward')
  generateDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GenerateDocumentDto,
    @Ip() ip: string,
  ) {
    return this.documentEngine.commitDocument(user, 'inward', id, { regenerate: dto.regenerate }, ip);
  }
}
