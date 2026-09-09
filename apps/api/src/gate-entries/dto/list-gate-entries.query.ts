import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { GATE_ENTRY_DIRECTIONS } from './create-gate-entry.dto';

export const GATE_ENTRY_STATUSES = ['open', 'linked', 'closed', 'cancelled'] as const;

export class ListGateEntriesQuery {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsIn(GATE_ENTRY_STATUSES) status?: (typeof GATE_ENTRY_STATUSES)[number];
  @IsOptional() @IsIn(GATE_ENTRY_DIRECTIONS) direction?: (typeof GATE_ENTRY_DIRECTIONS)[number];

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit = 25;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset = 0;
}
