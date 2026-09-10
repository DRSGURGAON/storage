import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { GenerateDocumentDto } from '../documents/dto/generate-document.dto';
import { DocumentEngineService } from '../documents/documents.service';
import { AddFoundLineDto, CountLineDto } from './dto/count-line.dto';
import { CreateStockVerificationDto } from './dto/create-stock-verification.dto';
import { ListStockVerificationsQuery } from './dto/list-stock-verifications.query';
import { StockVerificationsService } from './stock-verifications.service';

/** All on `create_stock_verification`: counting is a floor activity, and the matrix seeds no separate view or approve code. */
@Controller('stock-verifications')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class StockVerificationsController {
  constructor(
    private readonly verifications: StockVerificationsService,
    private readonly documentEngine: DocumentEngineService,
  ) {}

  @Post()
  @RequirePermission('create_stock_verification')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateStockVerificationDto, @Ip() ip: string) {
    return this.verifications.create(user, dto, ip);
  }

  @Get()
  @RequirePermission('create_stock_verification')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListStockVerificationsQuery) {
    return this.verifications.list(user, query);
  }

  @Get(':id')
  @RequirePermission('create_stock_verification')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.verifications.get(user, id);
  }

  @Patch(':id/lines/:lineId')
  @RequirePermission('create_stock_verification')
  countLine(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() dto: CountLineDto,
    @Ip() ip: string,
  ) {
    return this.verifications.countLine(user, id, lineId, dto, ip);
  }

  @Post(':id/lines')
  @RequirePermission('create_stock_verification')
  addFoundLine(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddFoundLineDto,
    @Ip() ip: string,
  ) {
    return this.verifications.addFoundLine(user, id, dto, ip);
  }

  @Post(':id/complete')
  @RequirePermission('create_stock_verification')
  complete(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.verifications.complete(user, id, ip);
  }

  @Post(':id/cancel')
  @RequirePermission('create_stock_verification')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.verifications.cancel(user, id, ip);
  }

  @Post(':id/document/preview')
  @RequirePermission('create_stock_verification')
  async previewDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const pdf = await this.documentEngine.previewDocument(user, 'stock_verification', id);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(pdf);
  }

  @Post(':id/document')
  @RequirePermission('create_stock_verification')
  generateDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GenerateDocumentDto,
    @Ip() ip: string,
  ) {
    return this.documentEngine.commitDocument(user, 'stock_verification', id, { regenerate: dto.regenerate }, ip);
  }
}
