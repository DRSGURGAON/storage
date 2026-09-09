import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { GenerateDocumentDto } from '../documents/dto/generate-document.dto';
import { DocumentEngineService } from '../documents/documents.service';
import { CreateStockTransferDto } from './dto/create-stock-transfer.dto';
import { ListStockTransfersQuery } from './dto/list-stock-transfers.query';
import { StockTransfersService } from './stock-transfers.service';

/**
 * Every route rides `create_stock_transfer`. `permissions-matrix.md` seeds
 * no separate approve code for this module -- unlike stock adjustments,
 * where it seeds two -- so approval here is the same authority as
 * raising the note, and inventing a distinction would be inventing policy.
 */
@Controller('stock-transfers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class StockTransfersController {
  constructor(
    private readonly transfers: StockTransfersService,
    private readonly documentEngine: DocumentEngineService,
  ) {}

  @Post()
  @RequirePermission('create_stock_transfer')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateStockTransferDto, @Ip() ip: string) {
    return this.transfers.create(user, dto, ip);
  }

  @Get()
  @RequirePermission('create_stock_transfer')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListStockTransfersQuery) {
    return this.transfers.list(user, query);
  }

  @Get(':id')
  @RequirePermission('create_stock_transfer')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.transfers.get(user, id);
  }

  @Post(':id/approve')
  @RequirePermission('create_stock_transfer')
  approve(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.transfers.approve(user, id, ip);
  }

  @Post(':id/dispatch')
  @RequirePermission('create_stock_transfer')
  dispatch(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.transfers.dispatch(user, id, ip);
  }

  @Post(':id/complete')
  @RequirePermission('create_stock_transfer')
  complete(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.transfers.complete(user, id, ip);
  }

  @Post(':id/cancel')
  @RequirePermission('create_stock_transfer')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.transfers.cancel(user, id, ip);
  }

  @Post(':id/document/preview')
  @RequirePermission('create_stock_transfer')
  async previewDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const pdf = await this.documentEngine.previewDocument(user, 'stock_transfer', id);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(pdf);
  }

  @Post(':id/document')
  @RequirePermission('create_stock_transfer')
  generateDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GenerateDocumentDto,
    @Ip() ip: string,
  ) {
    return this.documentEngine.commitDocument(user, 'stock_transfer', id, { regenerate: dto.regenerate }, ip);
  }
}
