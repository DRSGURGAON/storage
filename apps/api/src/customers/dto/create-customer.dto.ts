import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export const CUSTOMER_TYPES = [
  'company',
  'proprietor',
  'partnership',
  'individual',
  'government',
] as const;
export const BILLING_CYCLES = ['monthly', 'fortnightly', 'weekly', 'on_dispatch'] as const;

export class CreateCustomerDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional() @IsString() legalName?: string;
  @IsOptional() @IsIn(CUSTOMER_TYPES) customerType?: (typeof CUSTOMER_TYPES)[number];
  @IsOptional() @IsString() contactPerson?: string;
  @IsOptional() @IsString() mobile?: string;
  @IsOptional() @IsEmail() email?: string;

  @IsOptional()
  @Matches(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, {
    message: 'gstin must be a valid 15-character GSTIN',
  })
  gstin?: string;

  @IsOptional()
  @Matches(/^[A-Z]{5}[0-9]{4}[A-Z]$/, { message: 'pan must be a valid 10-character PAN' })
  pan?: string;

  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() @Length(2, 2) stateCode?: string;
  @IsOptional() @IsString() @Length(2, 2) placeOfSupply?: string;
  @IsOptional() @IsUUID() defaultWarehouseId?: string;
  @IsOptional() @IsIn(BILLING_CYCLES) billingCycle?: (typeof BILLING_CYCLES)[number];
  @IsOptional() @IsInt() @Min(0) @Max(365) creditDays?: number;
  @IsOptional() @IsString() paymentTerms?: string;
  @IsOptional() @IsNumber() @Min(0) minimumBillingAmount?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() notes?: string;
}
