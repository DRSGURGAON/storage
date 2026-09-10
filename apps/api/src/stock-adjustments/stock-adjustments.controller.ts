import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { CreateStockAdjustmentDto } from './dto/create-stock-adjustment.dto';
import { ListStockAdjustmentsQuery } from './dto/list-stock-adjustments.query';
import { RejectStockAdjustmentDto } from './dto/reject-stock-adjustment.dto';
import { StockAdjustmentsService } from './stock-adjustments.service';

/**
 * The permission split here is the sharpest in the matrix.
 * `create_stock_adjustment` reaches a Warehouse Operator;
 * `approve_stock_adjustment` stops at Warehouse Manager; and
 * `approve_stock_adjustment_final` is **Owner alone** -- Admin does not
 * hold it, which is true of only one other permission in the whole
 * catalogue (`approve_agreement`). Changing a stock figure with no receipt
 * behind it is the operation the blueprint trusts least, and the codes say
 * so.
 *
 * `post` rides `approve_stock_adjustment` rather than the create code:
 * applying an approved change to the ledger is the approver's act, not the
 * requester's.
 */
@Controller('stock-adjustments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class StockAdjustmentsController {
  constructor(private readonly adjustments: StockAdjustmentsService) {}

  @Post()
  @RequirePermission('create_stock_adjustment')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateStockAdjustmentDto, @Ip() ip: string) {
    return this.adjustments.create(user, dto, ip);
  }

  @Get()
  @RequirePermission('create_stock_adjustment')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListStockAdjustmentsQuery) {
    return this.adjustments.list(user, query);
  }

  @Get(':id')
  @RequirePermission('create_stock_adjustment')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.adjustments.get(user, id);
  }

  @Post(':id/submit')
  @RequirePermission('create_stock_adjustment')
  submit(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.adjustments.submit(user, id, ip);
  }

  @Post(':id/approve')
  @RequirePermission('approve_stock_adjustment')
  approve(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.adjustments.approveManager(user, id, ip);
  }

  @Post(':id/approve-final')
  @RequirePermission('approve_stock_adjustment_final')
  approveFinal(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.adjustments.approveOwner(user, id, ip);
  }

  @Post(':id/reject')
  @RequirePermission('approve_stock_adjustment')
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectStockAdjustmentDto,
    @Ip() ip: string,
  ) {
    return this.adjustments.reject(user, id, dto.reason, ip);
  }

  @Post(':id/post')
  @RequirePermission('approve_stock_adjustment')
  postToLedger(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.adjustments.post(user, id, ip);
  }

  @Post(':id/cancel')
  @RequirePermission('create_stock_adjustment')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) {
    return this.adjustments.cancel(user, id, ip);
  }
}
