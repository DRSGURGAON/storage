import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { RATE_CARD_SCOPES, RATE_CARD_STATUSES } from './create-rate-card.dto';

export class ListRateCardsQuery {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsIn(RATE_CARD_SCOPES) scope?: (typeof RATE_CARD_SCOPES)[number];
  @IsOptional() @IsIn(RATE_CARD_STATUSES) status?: (typeof RATE_CARD_STATUSES)[number];
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() warehouseId?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit = 25;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset = 0;
}

export class CreateChargeTypeDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsIn(['storage', 'handling', 'other'])
  category!: 'storage' | 'handling' | 'other';

  @IsString()
  defaultBasis!: string;

  @IsOptional() @IsString() sacCode?: string;
  @IsOptional() @IsString() triggerEvent?: string;
}

export class CreateTaxRateDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  ratePct!: number;
}
