import {
  Body,
  Controller,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { ListCustomersQuery } from './dto/list-customers.query';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Controller('customers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Post()
  @RequirePermission('create_customer')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCustomerDto, @Ip() ip: string) {
    return this.customers.create(user, dto, ip);
  }

  @Get()
  @RequirePermission('view_customer')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListCustomersQuery) {
    return this.customers.list(user, query);
  }

  @Get(':id')
  @RequirePermission('view_customer')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.customers.get(user, id);
  }

  @Patch(':id')
  @RequirePermission('edit_customer')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
    @Ip() ip: string,
  ) {
    return this.customers.update(user, id, dto, ip);
  }
}
