import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { GenerateDocumentDto } from '../documents/dto/generate-document.dto';
import { DocumentEngineService } from '../documents/documents.service';
import { CancelReleaseOrderDto, CreateReleaseOrderDto, ReserveReleaseOrderDto, UpdateReleaseOrderDto } from './dto/create-release-order.dto';
import { ListReleaseOrdersQuery } from './dto/list-release-orders.query';
import { ReleaseOrdersService } from './release-orders.service';

/**
 * `create_release_order` stops at Warehouse Manager -- an Operator does not
 * raise outbound orders -- and `approve_release_order` / `reserve_stock`
 * are one row in the matrix, so approving and reserving are the same
 * authority. Reads ride the create code as every Operations module does.
 */
@Controller('release-orders')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReleaseOrdersController {
  constructor(private readonly orders: ReleaseOrdersService, private readonly documentEngine: DocumentEngineService) {}

  @Post() @RequirePermission('create_release_order')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateReleaseOrderDto, @Ip() ip: string) {
    return this.orders.create(user, dto, ip);
  }
  @Get() @RequirePermission('create_release_order')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListReleaseOrdersQuery) {
    return this.orders.list(user, query);
  }
  @Get(':id') @RequirePermission('create_release_order')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(user, id);
  }
  @Patch(':id') @RequirePermission('create_release_order')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateReleaseOrderDto, @Ip() ip: string) {
    return this.orders.update(user, id, dto, ip);
  }
  @Post(':id/approve') @RequirePermission('approve_release_order')
  approve(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.orders.approve(user, id, ip);
  }
  @Post(':id/reserve') @RequirePermission('reserve_stock')
  reserve(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReserveReleaseOrderDto, @Ip() ip: string) {
    return this.orders.reserve(user, id, dto, ip);
  }
  @Post(':id/cancel') @RequirePermission('create_release_order')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelReleaseOrderDto, @Ip() ip: string) {
    return this.orders.cancel(user, id, dto.reason, ip);
  }
  @Post(':id/document/preview') @RequirePermission('create_release_order')
  async previewDocument(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const pdf = await this.documentEngine.previewDocument(user, 'release_order', id);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(pdf);
  }
  @Post(':id/document') @RequirePermission('create_release_order')
  generateDocument(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: GenerateDocumentDto, @Ip() ip: string) {
    return this.documentEngine.commitDocument(user, 'release_order', id, { regenerate: dto.regenerate }, ip);
  }
}
