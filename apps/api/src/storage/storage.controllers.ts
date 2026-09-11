import {
  Body,
  Controller,
  Delete,
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
import {
  AddStorageChargesDto,
  AddStorageItemsDto,
  CancelStorageBookingDto,
  CloseStorageBookingDto,
  CreateStorageBookingDto,
  CreateStorageUnitDto,
  ListStorageBookingsQuery,
  ListStorageUnitsQuery,
  StorageIntakeDto,
  StorageItemDto,
  StorageReleaseDto,
  UpdateStorageBookingDto,
  UpdateStorageUnitDto,
} from './dto/storage.dtos';
import { StorageBookingsService } from './storage-bookings.service';
import { StorageUnitsService } from './storage-units.service';

@Controller('storage/units')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class StorageUnitsController {
  constructor(private readonly units: StorageUnitsService) {}

  @Get()
  @RequirePermission('view_warehouse')
  list(@CurrentUser() u: AuthenticatedUser, @Query() query: ListStorageUnitsQuery) {
    return this.units.list(u, query);
  }

  @Post()
  @RequirePermission('create_warehouse')
  create(@CurrentUser() u: AuthenticatedUser, @Body() dto: CreateStorageUnitDto, @Ip() ip: string) {
    return this.units.create(u, dto, ip);
  }

  @Patch(':id')
  @RequirePermission('edit_warehouse')
  update(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStorageUnitDto,
    @Ip() ip: string,
  ) {
    return this.units.update(u, id, dto, ip);
  }
}

@Controller('storage/bookings')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class StorageBookingsController {
  constructor(private readonly bookings: StorageBookingsService) {}

  @Get()
  @RequirePermission('view_storage_booking')
  list(@CurrentUser() u: AuthenticatedUser, @Query() query: ListStorageBookingsQuery) {
    return this.bookings.list(u, query);
  }

  @Get(':id')
  @RequirePermission('view_storage_booking')
  get(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.get(u, id);
  }

  @Post()
  @RequirePermission('create_storage_booking')
  create(
    @CurrentUser() u: AuthenticatedUser,
    @Body() dto: CreateStorageBookingDto,
    @Ip() ip: string,
  ) {
    return this.bookings.create(u, dto, ip);
  }

  @Patch(':id')
  @RequirePermission('edit_storage_booking')
  update(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStorageBookingDto,
    @Ip() ip: string,
  ) {
    return this.bookings.update(u, id, dto, ip);
  }

  @Post(':id/items')
  @RequirePermission('edit_storage_booking')
  addItems(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddStorageItemsDto,
    @Ip() ip: string,
  ) {
    return this.bookings.addItems(u, id, dto.items ?? [], ip);
  }

  @Patch(':id/items/:itemId')
  @RequirePermission('edit_storage_booking')
  updateItem(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: StorageItemDto,
    @Ip() ip: string,
  ) {
    return this.bookings.updateItem(u, id, itemId, dto, ip);
  }

  @Delete(':id/items/:itemId')
  @RequirePermission('edit_storage_booking')
  removeItem(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    return this.bookings.removeItem(u, id, itemId);
  }

  @Post(':id/charges')
  @RequirePermission('edit_storage_booking')
  addCharges(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddStorageChargesDto,
  ) {
    return this.bookings.addCharges(u, id, dto.charges ?? []);
  }

  @Delete(':id/charges/:chargeId')
  @RequirePermission('edit_storage_booking')
  removeCharge(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('chargeId', ParseUUIDPipe) chargeId: string,
  ) {
    return this.bookings.removeCharge(u, id, chargeId);
  }

  @Post(':id/intake')
  @RequirePermission('confirm_storage_intake')
  intake(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StorageIntakeDto,
    @Ip() ip: string,
  ) {
    return this.bookings.intake(u, id, dto, ip);
  }

  @Post(':id/release')
  @RequirePermission('release_storage_goods')
  release(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StorageReleaseDto,
    @Ip() ip: string,
  ) {
    return this.bookings.release(u, id, dto, ip);
  }

  @Post(':id/close')
  @RequirePermission('close_storage_booking')
  close(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseStorageBookingDto,
    @Ip() ip: string,
  ) {
    return this.bookings.close(u, id, dto, ip);
  }

  @Post(':id/cancel')
  @RequirePermission('edit_storage_booking')
  cancel(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelStorageBookingDto,
    @Ip() ip: string,
  ) {
    return this.bookings.cancel(u, id, dto, ip);
  }
}
