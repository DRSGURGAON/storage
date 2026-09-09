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
import { CreateLocationDto } from './dto/create-location.dto';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { ListLocationsQuery } from './dto/list-locations.query';
import { UpdateLocationDto } from './dto/update-location.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { LocationsService } from './locations.service';
import { WarehousesService } from './warehouses.service';

@Controller('warehouses')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class WarehousesController {
  constructor(
    private readonly warehouses: WarehousesService,
    private readonly locations: LocationsService,
  ) {}

  @Post()
  @RequirePermission('create_warehouse')
  create(@CurrentUser() u: AuthenticatedUser, @Body() dto: CreateWarehouseDto, @Ip() ip: string) {
    return this.warehouses.create(u, dto, ip);
  }

  @Get()
  @RequirePermission('view_warehouse')
  list(@CurrentUser() u: AuthenticatedUser) {
    return this.warehouses.list(u);
  }

  @Get(':id')
  @RequirePermission('view_warehouse')
  get(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.warehouses.get(u, id);
  }

  @Patch(':id')
  @RequirePermission('edit_warehouse')
  update(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWarehouseDto,
    @Ip() ip: string,
  ) {
    return this.warehouses.update(u, id, dto, ip);
  }

  // Locations are part of the warehouse master (blueprint §9), so they
  // ride on the warehouse permissions rather than needing their own.

  @Post(':id/locations')
  @RequirePermission('edit_warehouse')
  createLocation(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) warehouseId: string,
    @Body() dto: CreateLocationDto,
    @Ip() ip: string,
  ) {
    return this.locations.create(u, warehouseId, dto, ip);
  }

  @Get(':id/locations')
  @RequirePermission('view_warehouse')
  listLocations(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) warehouseId: string,
    @Query() query: ListLocationsQuery,
  ) {
    return this.locations.list(u, warehouseId, query);
  }

  @Patch(':id/locations/:locationId')
  @RequirePermission('edit_warehouse')
  updateLocation(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) warehouseId: string,
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @Body() dto: UpdateLocationDto,
    @Ip() ip: string,
  ) {
    return this.locations.update(u, warehouseId, locationId, dto, ip);
  }
}
