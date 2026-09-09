import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export const QUOTATION_STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'expired', 'cancelled'] as const;

export class ListQuotationsQuery {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsIn(QUOTATION_STATUSES) status?: (typeof QUOTATION_STATUSES)[number];

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit = 25;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset = 0;
}
