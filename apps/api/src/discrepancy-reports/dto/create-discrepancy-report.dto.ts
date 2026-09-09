import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateDiscrepancyItemDto {
  @IsUUID()
  productId!: string;

  @IsOptional() @IsUUID() grnItemId?: string;
  @IsOptional() @IsString() batchNo?: string;

  @IsOptional() @IsNumber() @Min(0) expectedQty?: number;
  @IsOptional() @IsNumber() @Min(0) receivedQty?: number;
  @IsOptional() @IsNumber() @Min(0) shortQty?: number;
  @IsOptional() @IsNumber() @Min(0) excessQty?: number;
  @IsOptional() @IsNumber() @Min(0) damagedQty?: number;

  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() remarks?: string;
}

export class CreateDiscrepancyReportDto {
  /** Required directly, or auto-filled from `grnId` (blueprint §19's whole auto-fill list). */
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsUUID() customerId?: string;

  @IsOptional() @IsUUID() grnId?: string;
  @IsOptional() @IsDateString() reportDate?: string;

  @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional() @IsString() supplierName?: string;

  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() remarks?: string;

  /** Omitted with a `grnId`, the lines are copied from that GRN's own discrepant items. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateDiscrepancyItemDto)
  items?: CreateDiscrepancyItemDto[];
}
