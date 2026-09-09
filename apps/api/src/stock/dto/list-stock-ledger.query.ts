import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

/** stock-engine.md §2. */
export const STOCK_TXN_TYPES = [
  'INWARD',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'OUTWARD',
  'RETURN',
  'ADJUSTMENT',
  'RESERVE',
  'UNRESERVE',
] as const;

export class ListStockLedgerQuery {
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsUUID() productId?: string;
  @IsOptional() @IsIn(STOCK_TXN_TYPES) txnType?: (typeof STOCK_TXN_TYPES)[number];

  /** Trace one source document's whole stock footprint (§67). */
  @IsOptional() @IsString() sourceType?: string;
  @IsOptional() @IsUUID() sourceId?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  limit = 50;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset = 0;
}
