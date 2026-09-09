import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { CreateDriverDto } from './dto/create-driver.dto';
import { DriversService } from './drivers.service';
import { ListDriversQuery } from './dto/list-transport.query';
import { UpdateDriverDto } from './dto/update-driver.dto';

@Controller('drivers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DriversController {
  constructor(private readonly drivers: DriversService) {}

  @Post()
  @RequirePermission('create_transport_master')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateDriverDto, @Ip() ip: string) {
    return this.drivers.create(user, dto, ip);
  }

  @Get()
  @RequirePermission('view_transport_master')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListDriversQuery) {
    return this.drivers.list(user, query);
  }

  @Get(':id')
  @RequirePermission('view_transport_master')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.drivers.get(user, id);
  }

  @Patch(':id')
  @RequirePermission('edit_transport_master')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDriverDto,
    @Ip() ip: string,
  ) {
    return this.drivers.update(user, id, dto, ip);
  }
}
