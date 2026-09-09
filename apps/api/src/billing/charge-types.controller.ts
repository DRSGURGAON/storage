import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { ChargeTypesService } from './charge-types.service';
import { CreateChargeTypeDto } from './dto/list-rate-cards.query';

/** Same permission pair as rate cards (permissions-matrix.md has no separate charge-type row). */
@Controller('charge-types')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ChargeTypesController {
  constructor(private readonly chargeTypes: ChargeTypesService) {}

  @Get()
  @RequirePermission('view_rate_card')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.chargeTypes.list(user.tenantId);
  }

  @Post()
  @RequirePermission('create_rate_card')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateChargeTypeDto) {
    return this.chargeTypes.create(user.tenantId, dto);
  }
}
