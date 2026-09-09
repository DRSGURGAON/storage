import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { ListStockLedgerQuery } from './dto/list-stock-ledger.query';
import { ListStockQuery } from './dto/list-stock.query';
import { StockService } from './stock.service';

/**
 * Read-only, and that is the design rather than an unfinished half: there
 * is no endpoint anywhere that writes a stock balance. Stock moves only as
 * a consequence of an operational document being approved, completed, or
 * reversed (stock-engine.md §1, §3.4), so the write side lives in those
 * modules and always goes through `StockService.postWithin()`.
 *
 * `view_stock` / `view_stock_ledger` are the broadest permissions in the
 * matrix -- every internal role holds both, since an operator who cannot
 * see stock cannot do their job.
 */
@Controller('stock')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get()
  @RequirePermission('view_stock')
  listLots(@CurrentUser() user: AuthenticatedUser, @Query() query: ListStockQuery) {
    return this.stock.listLots(user, query);
  }

  @Get('ledger')
  @RequirePermission('view_stock_ledger')
  listLedger(@CurrentUser() user: AuthenticatedUser, @Query() query: ListStockLedgerQuery) {
    return this.stock.listLedger(user, query);
  }
}
