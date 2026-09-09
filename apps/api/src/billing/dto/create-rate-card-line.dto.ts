import { IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

/** schema/10_masters.sql's own comment on rate_card_lines.basis. */
export const RATE_BASES = [
  'unit_day',
  'pallet_day',
  'box_day',
  'sqft_month',
  'cbm_day',
  'flat_month',
  'per_unit',
  'per_package',
  'per_pallet',
  'per_vehicle',
  'per_hour',
  'per_document',
  'per_kg',
  'lumpsum',
] as const;

export class CreateRateCardLineDto {
  @IsUUID()
  chargeTypeId!: string;

  @IsIn(RATE_BASES)
  basis!: (typeof RATE_BASES)[number];

  @IsOptional() @IsString() uomCode?: string;

  @IsNumber() @Min(0)
  rate!: number;

  @IsOptional() @IsNumber() @Min(0) minimumCharge?: number;
  @IsOptional() @IsInt() @Min(0) freeDays?: number;
  @IsOptional() @IsNumber() @Min(0) slabFrom?: number;
  @IsOptional() @IsNumber() @Min(0) slabTo?: number;

  /** A SKU-specific or category-wide override -- at most one of the two (billing-engine.md §3). */
  @IsOptional() @IsUUID() productId?: string;
  @IsOptional() @IsUUID() categoryId?: string;

  @IsOptional() @IsUUID() taxRateId?: string;
  @IsOptional() @IsString() sacCode?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}
