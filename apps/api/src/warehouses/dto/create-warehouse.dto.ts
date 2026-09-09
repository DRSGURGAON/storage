import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
  MinLength,
} from 'class-validator';

export const CAPACITY_UOMS = ['pallet', 'sqft', 'cbm', 'mt'] as const;

export class CreateWarehouseDto {
  /** First segment of every location code (blueprint §9: 'WH01-A-R04-...'). */
  @IsString()
  @Matches(/^[A-Z0-9]{2,10}$/, { message: 'code must be 2-10 uppercase letters/digits' })
  code!: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional() @IsString() addressLine1?: string;
  @IsOptional() @IsString() addressLine2?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() @Length(2, 2) stateCode?: string;
  @IsOptional() @IsString() pincode?: string;
  @IsOptional() @IsString() contactPhone?: string;
  @IsOptional() @IsEmail() contactEmail?: string;

  @IsOptional()
  @Matches(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, {
    message: 'gstin must be a valid 15-character GSTIN',
  })
  gstin?: string;

  @IsOptional() @IsNumber() @Min(0) capacityValue?: number;
  @IsOptional() @IsIn(CAPACITY_UOMS) capacityUom?: (typeof CAPACITY_UOMS)[number];
  @IsOptional() @IsNumber() @Min(0) areaSqft?: number;
  @IsOptional() @IsString() managerName?: string;
  @IsOptional() @IsString() workingHours?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
