import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { CreateProductDto } from './dto/create-product.dto';
import { ListProductsQuery } from './dto/list-products.query';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsService } from './products.service';

@Controller('products')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Post()
  @RequirePermission('create_product')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateProductDto, @Ip() ip: string) {
    return this.products.create(user, dto, ip);
  }

  @Get()
  @RequirePermission('view_product')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListProductsQuery) {
    return this.products.list(user, query);
  }

  @Get(':id')
  @RequirePermission('view_product')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.products.get(user, id);
  }

  @Patch(':id')
  @RequirePermission('edit_product')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
    @Ip() ip: string,
  ) {
    return this.products.update(user, id, dto, ip);
  }
}
