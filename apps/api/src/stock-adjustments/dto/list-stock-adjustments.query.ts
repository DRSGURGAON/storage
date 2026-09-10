import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export const ADJUSTMENT_STATUSES = [
  'draft',
  'pending_manager',
  'pending_owner',
  'approved',
  'rejected',
  'cancelled',
  'posted',
] as const;

export class ListStockAdjustmentsQuery {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsIn(ADJUSTMENT_STATUSES) status?: (typeof ADJUSTMENT_STATUSES)[number];

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit = 25;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset = 0;
}
