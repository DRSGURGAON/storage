import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { CreateTaxRateDto } from './dto/list-rate-cards.query';
import { TaxRatesService } from './tax-rates.service';

/** Same permission pair as rate cards (permissions-matrix.md has no separate tax-rate row). */
@Controller('tax-rates')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TaxRatesController {
  constructor(private readonly taxRates: TaxRatesService) {}

  @Get()
  @RequirePermission('view_rate_card')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.taxRates.list(user.tenantId);
  }

  @Post()
  @RequirePermission('create_rate_card')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTaxRateDto) {
    return this.taxRates.create(user.tenantId, dto);
  }
}
