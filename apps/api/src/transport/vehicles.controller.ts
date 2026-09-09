import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { ListVehiclesQuery } from './dto/list-transport.query';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { VehiclesService } from './vehicles.service';

@Controller('vehicles')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Post()
  @RequirePermission('create_transport_master')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateVehicleDto, @Ip() ip: string) {
    return this.vehicles.create(user, dto, ip);
  }

  @Get()
  @RequirePermission('view_transport_master')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListVehiclesQuery) {
    return this.vehicles.list(user, query);
  }

  @Get(':id')
  @RequirePermission('view_transport_master')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.vehicles.get(user, id);
  }

  @Patch(':id')
  @RequirePermission('edit_transport_master')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVehicleDto,
    @Ip() ip: string,
  ) {
    return this.vehicles.update(user, id, dto, ip);
  }
}
