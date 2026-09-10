import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export const TRANSPORT_MODES = ['customer_vehicle', 'company_vehicle', 'third_party'] as const;

export class CreateReleaseOrderLineDto {
  @IsUUID() productId!: string;
  /** The customer may ask for a specific batch; otherwise the allocation policy chooses. */
  @IsOptional() @IsUUID() batchId?: string;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) requestedQty!: number;
}

export class CreateReleaseOrderDto {
  @IsUUID() customerId!: string;
  @IsUUID() warehouseId!: string;
  @IsOptional() @IsDateString() orderDate?: string;
  @IsOptional() @IsDateString() requestedDate?: string;
  @IsOptional() @IsString() consigneeName?: string;
  @IsOptional() @IsString() consigneeAddress?: string;
  /** One of the customer's own addresses; snapshotted, so a later edit to the master never rewrites this order. */
  @IsOptional() @IsUUID() deliveryAddressId?: string;
  @IsOptional() @IsIn(TRANSPORT_MODES) transportMode?: (typeof TRANSPORT_MODES)[number];
  @IsOptional() @IsUUID() vehicleId?: string;
  @IsOptional() @IsUUID() driverId?: string;
  @IsOptional() @IsString() instructions?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateReleaseOrderLineDto)
  lines!: CreateReleaseOrderLineDto[];
}

export class UpdateReleaseOrderDto {
  @IsOptional() @IsDateString() requestedDate?: string;
  @IsOptional() @IsString() consigneeName?: string;
  @IsOptional() @IsString() consigneeAddress?: string;
  @IsOptional() @IsUUID() deliveryAddressId?: string;
  @IsOptional() @IsIn(TRANSPORT_MODES) transportMode?: (typeof TRANSPORT_MODES)[number];
  @IsOptional() @IsUUID() vehicleId?: string;
  @IsOptional() @IsUUID() driverId?: string;
  @IsOptional() @IsString() instructions?: string;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => CreateReleaseOrderLineDto)
  lines?: CreateReleaseOrderLineDto[];
}

export const ALLOCATION_POLICIES = ['fifo', 'lifo', 'fefo', 'manual'] as const;

export class ManualAllocationDto {
  @IsUUID() releaseOrderLineId!: string;
  @IsUUID() stockLotId!: string;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) quantity!: number;
}

export class ReserveReleaseOrderDto {
  /** Defaults to the tenant's `stock.allocation_policy`. `manual` requires `allocations`. */
  @IsOptional() @IsIn(ALLOCATION_POLICIES) allocationPolicy?: (typeof ALLOCATION_POLICIES)[number];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ManualAllocationDto)
  allocations?: ManualAllocationDto[];
}

export class CancelReleaseOrderDto {
  @IsString() reason!: string;
}
