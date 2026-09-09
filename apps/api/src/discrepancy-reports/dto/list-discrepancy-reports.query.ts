import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export const DISCREPANCY_STATUSES = ['draft', 'submitted', 'acknowledged', 'closed', 'cancelled'] as const;

export class ListDiscrepancyReportsQuery {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsUUID() grnId?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsIn(DISCREPANCY_STATUSES) status?: (typeof DISCREPANCY_STATUSES)[number];

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit = 25;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset = 0;
}
