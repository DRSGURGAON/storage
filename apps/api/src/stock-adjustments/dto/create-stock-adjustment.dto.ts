import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class CreateStockAdjustmentLineDto {
  @IsUUID() productId!: string;
  @IsOptional() @IsUUID() batchId?: string;
  @IsOptional() @IsUUID() locationId?: string;

  /**
   * Signed: positive adds stock the system did not know it had, negative
   * writes off stock that is not on the shelf. Not an absolute quantity
   * plus a direction flag, because the sign *is* the direction and
   * splitting them invites the two to disagree.
   */
  @IsNumber({ maxDecimalPlaces: 3 })
  quantityDelta!: number;

  @IsOptional() @IsString() remarks?: string;
}

export class CreateStockAdjustmentDto {
  /** Raise it from a completed verification, and its discrepant lines come across. */
  @IsOptional() @IsUUID() sourceVerificationId?: string;

  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsDateString() adjustmentDate?: string;

  /** Required, always: an unexplained change to a stock figure is the thing this record exists to prevent. */
  @IsString()
  @IsNotEmpty({ message: 'reason is required -- an adjustment without one is an unexplained stock change' })
  reason!: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateStockAdjustmentLineDto)
  lines?: CreateStockAdjustmentLineDto[];
}
