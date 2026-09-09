import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { GenerateDocumentDto } from '../documents/dto/generate-document.dto';
import { DocumentEngineService } from '../documents/documents.service';
import { IssueWarehouseReceiptDto } from './dto/issue-warehouse-receipt.dto';
import { ListWarehouseReceiptsQuery } from './dto/list-warehouse-receipts.query';
import { WarehouseReceiptsService } from './warehouse-receipts.service';

/** All routes ride `issue_warehouse_receipt`, which permissions-matrix.md withholds from Warehouse Operator (unlike the rest of the inbound chain). */
@Controller('warehouse-receipts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class WarehouseReceiptsController {
  constructor(
    private readonly receipts: WarehouseReceiptsService,
    private readonly documentEngine: DocumentEngineService,
  ) {}

  @Post()
  @RequirePermission('issue_warehouse_receipt')
  issue(@CurrentUser() user: AuthenticatedUser, @Body() dto: IssueWarehouseReceiptDto, @Ip() ip: string) {
    return this.receipts.issue(user, dto, ip);
  }

  @Get()
  @RequirePermission('issue_warehouse_receipt')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListWarehouseReceiptsQuery) {
    return this.receipts.list(user, query);
  }

  @Get(':id')
  @RequirePermission('issue_warehouse_receipt')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.receipts.get(user, id);
  }

  @Post(':id/cancel')
  @RequirePermission('issue_warehouse_receipt')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.receipts.cancel(user, id, ip);
  }

  @Post(':id/document/preview')
  @RequirePermission('issue_warehouse_receipt')
  async previewDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const pdf = await this.documentEngine.previewDocument(user, 'warehouse_receipt', id);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(pdf);
  }

  @Post(':id/document')
  @RequirePermission('issue_warehouse_receipt')
  generateDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GenerateDocumentDto,
    @Ip() ip: string,
  ) {
    return this.documentEngine.commitDocument(user, 'warehouse_receipt', id, { regenerate: dto.regenerate }, ip);
  }
}
