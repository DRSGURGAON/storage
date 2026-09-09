import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export const PUTAWAY_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'] as const;

export class ListPutawaysQuery {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsUUID() grnId?: string;
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsIn(PUTAWAY_STATUSES) status?: (typeof PUTAWAY_STATUSES)[number];

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit = 25;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset = 0;
}
