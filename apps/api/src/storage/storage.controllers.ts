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
import { BadRequestException } from '@nestjs/common';
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
  GenerateStoragePaperDto,
  ListStorageBookingsQuery,
  ListStorageUnitsQuery,
  RaiseRentInvoiceDto,
  StorageIntakeDto,
  StorageItemDto,
  StorageReleaseDto,
  UpdateStorageBookingDto,
  UpdateStorageUnitDto,
} from './dto/storage.dtos';
import { DocumentEngineService } from '../documents/documents.service';
import { StorageBillingService } from './storage-billing.service';
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
  constructor(
    private readonly bookings: StorageBookingsService,
    private readonly billing: StorageBillingService,
    private readonly documentEngine: DocumentEngineService,
  ) {}

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

  /**
   * The three papers, by the name an operator uses rather than the
   * document type in the table. A URL a person might type is worth being
   * readable; the mapping is one object and cannot drift, because an
   * unknown name is refused here rather than reaching the registry as a
   * 404 about a "document type" nobody asked for.
   */
  @Post(':id/documents/:paper')
  @RequirePermission('view_storage_booking')
  async generateDocument(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('paper') paper: string,
    @Body() dto: GenerateStoragePaperDto,
    @Ip() ip: string,
  ) {
    const type = paperType(paper);
    // A release note is about one trip out, so its source record is the
    // movement -- three collections make three notes, not three versions
    // of one. The other two describe the booking as a whole.
    const sourceId =
      type === 'storage_release_note'
        ? await this.bookings.movementForReleaseNote(u, id, dto.movementId)
        : id;
    return this.documentEngine.commitDocument(u, type, sourceId, { regenerate: dto.regenerate }, ip);
  }

  /** What the next rent invoice would say, without raising one. */
  @Post(':id/invoice/preview')
  @RequirePermission('create_invoice')
  previewInvoice(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RaiseRentInvoiceDto,
  ) {
    return this.billing.preview(u, id, dto);
  }

  @Post(':id/invoice')
  @RequirePermission('create_invoice')
  raiseInvoice(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RaiseRentInvoiceDto,
    @Ip() ip: string,
  ) {
    return this.billing.raise(u, id, dto, ip);
  }

  @Get(':id/invoices')
  @RequirePermission('view_storage_booking')
  invoices(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.billing.listForBooking(u, id);
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

const PAPERS: Record<string, string> = {
  'inventory-list': 'storage_inventory_list',
  receipt: 'storage_receipt',
  'release-note': 'storage_release_note',
};

function paperType(paper: string): string {
  const type = PAPERS[paper];
  if (!type) {
    throw new BadRequestException(
      `Unknown document "${paper}" -- expected one of: ${Object.keys(PAPERS).join(', ')}`,
    );
  }
  return type;
}
