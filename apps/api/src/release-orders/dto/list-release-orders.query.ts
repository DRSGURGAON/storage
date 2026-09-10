import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export const RELEASE_ORDER_STATUSES = [
  'draft', 'approved', 'reserved', 'partially_picked', 'picked', 'dispatched', 'completed', 'cancelled',
] as const;

export class ListReleaseOrdersQuery {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsIn(RELEASE_ORDER_STATUSES) status?: (typeof RELEASE_ORDER_STATUSES)[number];
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset = 0;
}
