import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export const INWARD_STATUSES = ['draft', 'received', 'grn_created', 'cancelled'] as const;

export class ListInwardsQuery {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsIn(INWARD_STATUSES) status?: (typeof INWARD_STATUSES)[number];

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit = 25;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset = 0;
}
