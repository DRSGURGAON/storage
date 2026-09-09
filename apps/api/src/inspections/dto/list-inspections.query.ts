import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export const INSPECTION_STATUSES = ['draft', 'completed', 'cancelled'] as const;

export class ListInspectionsQuery {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsUUID() grnId?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsIn(INSPECTION_STATUSES) status?: (typeof INSPECTION_STATUSES)[number];

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit = 25;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset = 0;
}
