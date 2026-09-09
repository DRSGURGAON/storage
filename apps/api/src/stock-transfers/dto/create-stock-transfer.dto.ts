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

/**
 * 40_stock.sql: a transfer is either a move *within* one warehouse (bin to
 * bin) or *between* two. The distinction is not cosmetic -- it decides when
 * the stock actually moves, because only one of the two involves a vehicle
 * and a gap in between. See `StockTransfersService`.
 */
export const TRANSFER_KINDS = ['location', 'warehouse'] as const;

export class CreateStockTransferLineDto {
  @IsUUID() productId!: string;
  @IsOptional() @IsUUID() batchId?: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001, { message: 'quantity must be greater than zero' })
  quantity!: number;

  /** Where the goods are now. Required: a transfer has to name what it is moving. */
  @IsUUID() fromLocationId!: string;

  /**
   * Optional on a warehouse transfer: goods can arrive and be shelved
   * later, in which case they land unallocated at the destination exactly
   * as a GRN's receipt does.
   */
  @IsOptional() @IsUUID() toLocationId?: string;
}

export class CreateStockTransferDto {
  @IsIn(TRANSFER_KINDS) transferKind!: (typeof TRANSFER_KINDS)[number];
  @IsUUID() customerId!: string;
  @IsUUID() fromWarehouseId!: string;
  @IsUUID() toWarehouseId!: string;

  @IsOptional() @IsDateString() transferDate?: string;
  @IsOptional() @IsUUID() vehicleId?: string;
  @IsOptional() @IsUUID() driverId?: string;
  @IsOptional() @IsString() remarks?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'a transfer needs at least one line' })
  @ValidateNested({ each: true })
  @Type(() => CreateStockTransferLineDto)
  lines!: CreateStockTransferLineDto[];
}
