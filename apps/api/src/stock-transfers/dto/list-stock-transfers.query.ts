import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export const STOCK_TRANSFER_STATUSES = ['draft', 'approved', 'in_transit', 'completed', 'cancelled'] as const;

export class ListStockTransfersQuery {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() fromWarehouseId?: string;
  @IsOptional() @IsUUID() toWarehouseId?: string;
  @IsOptional() @IsIn(STOCK_TRANSFER_STATUSES) status?: (typeof STOCK_TRANSFER_STATUSES)[number];

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit = 25;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset = 0;
}
