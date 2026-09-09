import { IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Min, MinLength } from 'class-validator';
import { RATE_BASES } from '../../billing/dto/create-rate-card-line.dto';

export class CreateQuotationLineDto {
  @IsUUID()
  chargeTypeId!: string;

  @IsString()
  @MinLength(2)
  description!: string;

  @IsIn(RATE_BASES)
  basis!: (typeof RATE_BASES)[number];

  @IsOptional() @IsString() uomCode?: string;

  /** Indicative quantity for the quote (schema/20_commercial.sql); omitted for non-quantity bases like lumpsum. */
  @IsOptional() @IsNumber() @Min(0) quantity?: number;

  @IsNumber() @Min(0)
  rate!: number;

  @IsOptional() @IsNumber() @Min(0) minimumCharge?: number;
  @IsOptional() @IsInt() @Min(0) freeDays?: number;
  @IsOptional() @IsUUID() taxRateId?: string;
  @IsOptional() @IsString() sacCode?: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}
