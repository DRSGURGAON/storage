import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export const GRN_STATUSES = ['draft', 'submitted', 'checked', 'approved', 'rejected', 'cancelled', 'reversed'] as const;

export class ListGrnsQuery {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsIn(GRN_STATUSES) status?: (typeof GRN_STATUSES)[number];

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit = 25;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset = 0;
}
