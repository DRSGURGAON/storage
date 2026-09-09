import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** Server-side pagination + the searchable-selector contract (blueprint §74, saas-layer §28): name/code/GSTIN/mobile. */
export class ListCustomersQuery {
  @IsOptional() @IsString() q?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit = 25;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset = 0;
}
