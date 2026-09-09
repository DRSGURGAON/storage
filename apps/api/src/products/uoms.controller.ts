import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { CreateUomDto } from './dto/list-products.query';
import { UomsService } from './uoms.service';

/** Same permission pair as products (permissions-matrix.md has no separate UOM row). */
@Controller('uoms')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UomsController {
  constructor(private readonly uoms: UomsService) {}

  @Get()
  @RequirePermission('view_product')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.uoms.list(user.tenantId);
  }

  @Post()
  @RequirePermission('create_product')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateUomDto) {
    return this.uoms.create(user.tenantId, dto);
  }
}
