import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { CreateCategoryDto } from './dto/list-products.query';
import { ProductCategoriesService } from './product-categories.service';

/** Same permission pair as products (permissions-matrix.md has no separate category row). */
@Controller('product-categories')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ProductCategoriesController {
  constructor(private readonly categories: ProductCategoriesService) {}

  @Get()
  @RequirePermission('view_product')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.categories.list(user.tenantId);
  }

  @Post()
  @RequirePermission('create_product')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCategoryDto) {
    return this.categories.create(user.tenantId, dto);
  }
}
