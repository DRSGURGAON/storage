import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PortalDocumentsQuery, PortalListQuery, PortalReturnRequestDto, PortalStatementQuery } from './dto/portal.dtos';
import { PortalGuard } from './portal.guard';
import { PortalService } from './portal.service';

/**
 * Blueprint §53's customer portal. Every route is read-only except the
 * return request, and every route is scoped by the membership's
 * `customer_id` rather than by anything in the request
 * (`tenancy-and-security.md` §2).
 *
 * There is no `PermissionsGuard` here, deliberately: the `customer` role
 * holds no staff permission codes at all, so guarding these routes on one
 * would mean granting the role a permission that the staff API also
 * honours -- exactly the "staff permission codes with a filter bolted on"
 * that §2 rules out. `PortalGuard` is the gate instead, and it admits
 * only an active `customer` membership.
 */
@Controller('portal')
@UseGuards(JwtAuthGuard, PortalGuard)
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Get('me')
  profile(@CurrentUser() user: AuthenticatedUser) {
    return this.portal.profile(user);
  }

  @Get('stock')
  stock(@CurrentUser() user: AuthenticatedUser, @Query() query: PortalListQuery) {
    return this.portal.stock(user, query);
  }

  @Get('goods-receipts')
  goodsReceipts(@CurrentUser() user: AuthenticatedUser, @Query() query: PortalListQuery) {
    return this.portal.goodsReceipts(user, query);
  }

  @Get('dispatches')
  dispatches(@CurrentUser() user: AuthenticatedUser, @Query() query: PortalListQuery) {
    return this.portal.dispatches(user, query);
  }

  @Get('release-orders')
  releaseOrders(@CurrentUser() user: AuthenticatedUser, @Query() query: PortalListQuery) {
    return this.portal.releaseOrders(user, query);
  }

  @Get('invoices')
  invoices(@CurrentUser() user: AuthenticatedUser, @Query() query: PortalListQuery) {
    return this.portal.invoices(user, query);
  }

  @Get('statement')
  statement(@CurrentUser() user: AuthenticatedUser, @Query() query: PortalStatementQuery) {
    return this.portal.statement(user, query);
  }

  @Get('documents')
  documents(@CurrentUser() user: AuthenticatedUser, @Query() query: PortalDocumentsQuery) {
    return this.portal.documentsList(user, query);
  }

  @Get('documents/:id/download')
  async download(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { fileName, bytes } = await this.portal.downloadDocument(user, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    res.send(bytes);
  }

  /** §53's "raise a return request", limited to goods this customer actually received. */
  @Post('return-requests')
  requestReturn(@CurrentUser() user: AuthenticatedUser, @Body() dto: PortalReturnRequestDto, @Ip() ip: string) {
    return this.portal.requestReturn(user, dto, ip);
  }
}
