import { IsDateString, IsIn, IsOptional, IsString, IsUUID, Matches, MinLength } from 'class-validator';

export const RATE_CARD_SCOPES = ['customer', 'warehouse', 'company'] as const;
export const RATE_CARD_STATUSES = ['draft', 'active', 'expired', 'archived'] as const;

export class CreateRateCardDto {
  @IsString()
  @Matches(/^[A-Z0-9_-]{2,20}$/, { message: 'code must be 2-20 uppercase letters/digits/-/_' })
  code!: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsIn(RATE_CARD_SCOPES)
  scope!: (typeof RATE_CARD_SCOPES)[number];

  /** Required when scope='customer'; ignored for 'warehouse'/'company' (schema/10_masters.sql's check constraint). */
  @IsOptional() @IsUUID() customerId?: string;

  /** Required when scope='warehouse'; optional narrowing when scope='customer' (billing-engine.md §3); ignored for 'company'. */
  @IsOptional() @IsUUID() warehouseId?: string;

  @IsOptional() @IsString() currency?: string;

  @IsDateString()
  validFrom!: string;

  @IsOptional() @IsDateString() validTo?: string;

  @IsOptional() @IsIn(RATE_CARD_STATUSES) status?: (typeof RATE_CARD_STATUSES)[number];
  @IsOptional() @IsString() notes?: string;
}
