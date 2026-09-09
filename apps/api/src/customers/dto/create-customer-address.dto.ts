import { IsBoolean, IsIn, IsOptional, IsString, Length, Matches, MinLength } from 'class-validator';

export const CUSTOMER_ADDRESS_KINDS = ['registered', 'billing', 'delivery'] as const;

export class CreateCustomerAddressDto {
  @IsIn(CUSTOMER_ADDRESS_KINDS)
  kind!: (typeof CUSTOMER_ADDRESS_KINDS)[number];

  /** 'Head office', 'Plant 2' -- multiple delivery addresses are allowed (schema/10_masters.sql). */
  @IsOptional() @IsString() label?: string;

  @IsString()
  @MinLength(2)
  addressLine1!: string;

  @IsOptional() @IsString() addressLine2?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() @Length(2, 2) stateCode?: string;
  @IsOptional() @IsString() pincode?: string;

  /** A delivery address may belong to another GST registration than the customer's own. */
  @IsOptional()
  @Matches(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, {
    message: 'gstin must be a valid 15-character GSTIN',
  })
  gstin?: string;

  @IsOptional() @IsString() contactName?: string;
  @IsOptional() @IsString() contactPhone?: string;

  /** Setting true unsets any other default of the same kind for this customer (service-enforced, not a DB constraint). */
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
