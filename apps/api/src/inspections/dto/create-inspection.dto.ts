import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export const PACKAGING_CONDITIONS = ['intact', 'damaged', 'wet', 'opened', 'other'] as const;
export const SEAL_CONDITIONS = ['intact', 'broken', 'not_applicable'] as const;
export const INSPECTION_RESULTS = ['accepted', 'rejected'] as const;

export class CreateInspectionItemDto {
  @IsUUID()
  productId!: string;

  /** Ties the inspected line back to the GRN line it came from, when the inspection was raised off a GRN. */
  @IsOptional() @IsUUID() grnItemId?: string;

  @IsOptional() @IsString() batchNo?: string;

  @IsNumber() @Min(0)
  quantity!: number;

  @IsOptional() @IsIn(PACKAGING_CONDITIONS) packagingCondition?: (typeof PACKAGING_CONDITIONS)[number];
  @IsOptional() @IsIn(SEAL_CONDITIONS) sealCondition?: (typeof SEAL_CONDITIONS)[number];
  @IsOptional() @IsBoolean() visibleDamage?: boolean;
  @IsOptional() @IsString() qualityRemarks?: string;

  @IsIn(INSPECTION_RESULTS)
  result!: (typeof INSPECTION_RESULTS)[number];

  @IsOptional() @IsNumber() @Min(0) acceptedQty?: number;
  @IsOptional() @IsNumber() @Min(0) rejectedQty?: number;
}

export class CreateInspectionDto {
  /** Required directly, or auto-filled from `grnId`. */
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsUUID() customerId?: string;

  @IsOptional() @IsUUID() grnId?: string;
  @IsOptional() @IsDateString() inspectionAt?: string;

  /** Defaults to the acting user (id and name both), since that is who is performing the inspection. */
  @IsOptional() @IsString() inspectorName?: string;
  @IsOptional() @IsString() remarks?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateInspectionItemDto)
  items!: CreateInspectionItemDto[];
}
