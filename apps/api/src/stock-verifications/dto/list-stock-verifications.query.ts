import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export const VERIFICATION_STATUSES = ['draft', 'completed', 'cancelled'] as const;

export class ListStockVerificationsQuery {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsIn(VERIFICATION_STATUSES) status?: (typeof VERIFICATION_STATUSES)[number];

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit = 25;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset = 0;
}
