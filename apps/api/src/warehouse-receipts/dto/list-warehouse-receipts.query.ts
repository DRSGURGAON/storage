import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export const WAREHOUSE_RECEIPT_STATUSES = ['issued', 'cancelled'] as const;

export class ListWarehouseReceiptsQuery {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsUUID() grnId?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsIn(WAREHOUSE_RECEIPT_STATUSES) status?: (typeof WAREHOUSE_RECEIPT_STATUSES)[number];

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit = 25;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset = 0;
}
