import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export const RENT_BASES = ['flat', 'per_sqft', 'per_cbm', 'per_unit'] as const;
export const ITEM_CATEGORIES = ['furniture', 'appliance', 'carton', 'vehicle', 'other'] as const;
export const ID_PROOF_TYPES = ['aadhaar', 'driving_licence', 'voter_id', 'passport', 'other'] as const;
export const BOOKING_STATUSES = [
  'enquiry',
  'quoted',
  'confirmed',
  'in_storage',
  'closed',
  'cancelled',
] as const;
export const UNIT_TYPES = ['room', 'locker', 'pallet', 'open_area', 'container'] as const;

class PagedQuery {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset = 0;
}

// --------------------------------------------------------------------------
// Storage units
// --------------------------------------------------------------------------

export class CreateStorageUnitDto {
  @IsUUID() warehouseId!: string;
  @IsString() @MaxLength(40) code!: string;
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsIn(UNIT_TYPES) unitType?: (typeof UNIT_TYPES)[number];
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) areaSqft?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) volumeCbm?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) monthlyRate?: number;
  @IsOptional() @IsString() notes?: string;
}

export class UpdateStorageUnitDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsIn(UNIT_TYPES) unitType?: (typeof UNIT_TYPES)[number];
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) areaSqft?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) volumeCbm?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) monthlyRate?: number;
  @IsOptional() @IsIn(['vacant', 'occupied', 'maintenance']) status?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() notes?: string;
}

export class ListStorageUnitsQuery extends PagedQuery {
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsIn(['vacant', 'occupied', 'maintenance']) status?: string;
}

// --------------------------------------------------------------------------
// Bookings
// --------------------------------------------------------------------------

export class StorageItemDto {
  @IsString() @MaxLength(300) description!: string;
  @IsOptional() @IsIn(ITEM_CATEGORIES) category?: (typeof ITEM_CATEGORIES)[number];
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) quantity?: number;
  @IsOptional() @IsString() @MaxLength(20) uomCode?: string;
  @IsOptional() @IsString() @MaxLength(200) packing?: string;
  /**
   * The line that settles an argument six months later. Optional in the
   * API because an operator in a hurry will skip it, but the inventory
   * list prints "—" rather than nothing so the gap is visible on paper.
   */
  @IsOptional() @IsString() @MaxLength(500) conditionNote?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) declaredValue?: number;
  @IsOptional() @IsBoolean() isFragile?: boolean;
  @IsOptional() @IsString() @MaxLength(500) remarks?: string;
}

export class StorageChargeDto {
  @IsOptional() @IsUUID() chargeTypeId?: string;
  @IsString() @MaxLength(200) description!: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) quantity?: number;
  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) rate!: number;
  @IsOptional() @IsDateString() chargedOn?: string;
}

export class CreateStorageBookingDto {
  @IsUUID() customerId!: string;
  @IsUUID() warehouseId!: string;
  @IsOptional() @IsUUID() storageUnitId?: string;

  @IsOptional() @IsDateString() bookingDate?: string;
  @IsOptional() @IsDateString() expectedEndDate?: string;

  @IsOptional() @IsIn(RENT_BASES) rentBasis?: (typeof RENT_BASES)[number];
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) billableQuantity?: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) monthlyRent!: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) securityDeposit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(120) minimumMonths?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(180) noticeDays?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(28) billingDay?: number;

  @IsOptional() @IsString() @MaxLength(500) pickupAddress?: string;
  @IsOptional() @IsString() @MaxLength(500) deliveryAddress?: string;

  @IsOptional() @IsIn(ID_PROOF_TYPES) idProofType?: (typeof ID_PROOF_TYPES)[number];
  /** Last four digits only -- the scan belongs in attachments, not in a column. */
  @IsOptional() @IsString() @MaxLength(4) idProofLast4?: string;

  @IsOptional() @IsString() notes?: string;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => StorageItemDto)
  items?: StorageItemDto[];

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => StorageChargeDto)
  charges?: StorageChargeDto[];
}

export class UpdateStorageBookingDto {
  @IsOptional() @IsUUID() storageUnitId?: string;
  @IsOptional() @IsDateString() expectedEndDate?: string;
  @IsOptional() @IsIn(RENT_BASES) rentBasis?: (typeof RENT_BASES)[number];
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) billableQuantity?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) monthlyRent?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) securityDeposit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(120) minimumMonths?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(180) noticeDays?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(28) billingDay?: number;
  @IsOptional() @IsString() @MaxLength(500) pickupAddress?: string;
  @IsOptional() @IsString() @MaxLength(500) deliveryAddress?: string;
  @IsOptional() @IsIn(ID_PROOF_TYPES) idProofType?: (typeof ID_PROOF_TYPES)[number];
  @IsOptional() @IsString() @MaxLength(4) idProofLast4?: string;
  @IsOptional() @IsIn(['enquiry', 'quoted', 'confirmed']) status?: string;
  @IsOptional() @IsString() notes?: string;
}

export class ListStorageBookingsQuery extends PagedQuery {
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsIn(BOOKING_STATUSES) status?: (typeof BOOKING_STATUSES)[number];
}

// --------------------------------------------------------------------------
// Movements
// --------------------------------------------------------------------------

export class StorageIntakeDto {
  @IsOptional() @IsDateString() movementDate?: string;
  @IsOptional() @IsString() @MaxLength(30) vehicleNumber?: string;
  @IsOptional() @IsString() @MaxLength(120) driverName?: string;
  @IsOptional() @IsString() @MaxLength(200) transporterName?: string;
  @IsOptional() @IsString() @MaxLength(120) counterpartyName?: string;
  @IsOptional() @IsString() @MaxLength(20) counterpartyPhone?: string;
  @IsOptional() @IsUUID() signatureAttachmentId?: string;
  @IsOptional() @IsString() @MaxLength(500) remarks?: string;
}

export class ReleaseLineDto {
  @IsUUID() itemId!: string;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) quantity!: number;
  @IsOptional() @IsString() @MaxLength(500) conditionNote?: string;
}

/**
 * Not `extends StorageIntakeDto`. Re-declaring an inherited property to
 * make it required needs TypeScript's `declare` modifier, and a `declare`
 * field emits no decorator metadata at all -- class-validator would then
 * silently stop validating the single most important field on this DTO.
 * Repeating six lines is cheaper than that failure.
 */
export class StorageReleaseDto {
  @IsOptional() @IsDateString() movementDate?: string;
  @IsOptional() @IsString() @MaxLength(30) vehicleNumber?: string;
  @IsOptional() @IsString() @MaxLength(120) driverName?: string;
  @IsOptional() @IsString() @MaxLength(200) transporterName?: string;
  @IsOptional() @IsString() @MaxLength(20) counterpartyPhone?: string;
  @IsOptional() @IsUUID() signatureAttachmentId?: string;
  @IsOptional() @IsString() @MaxLength(500) remarks?: string;

  /**
   * Who physically took the goods, and on whose say-so. A storage
   * operator's worst day is "somebody else came and took it", so this is
   * required on the way out even though the same field is optional on the
   * way in.
   */
  @IsString() @MaxLength(120) counterpartyName!: string;
  @IsOptional() @IsString() @MaxLength(300) authorisationNote?: string;

  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ReleaseLineDto)
  lines!: ReleaseLineDto[];
}

export class AddStorageItemsDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => StorageItemDto)
  items!: StorageItemDto[];
}

export class AddStorageChargesDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => StorageChargeDto)
  charges!: StorageChargeDto[];
}

export class CloseStorageBookingDto {
  @IsOptional() @IsDateString() closedOn?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class CancelStorageBookingDto {
  @IsString() @MaxLength(300) reason!: string;
}
