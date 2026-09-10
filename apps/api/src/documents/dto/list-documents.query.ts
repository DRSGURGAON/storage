import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

/**
 * `@Type(() => Boolean)` (class-transformer's usual boolean coercion)
 * would silently break this: it's plain `Boolean(value)`, and
 * `Boolean('false')` is `true` -- any non-empty query string is truthy.
 * `?latestOnly=false` would then be indistinguishable from
 * `?latestOnly=true`, defeating the one purpose this param exists for
 * (seeing superseded versions). Caught by a real HTTP test asserting on
 * the actual returned count, not by inspection.
 */
const toBoolean = ({ value }: { value: unknown }) => (typeof value === 'string' ? value === 'true' : value);

export class ListDocumentsQuery {
  @IsOptional() @IsString() documentType?: string;
  @IsOptional() @IsUUID() sourceId?: string;

  /** ux-system.md §5's Document Centre filters: type, customer, warehouse, date range. */
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset = 0;

  /** Defaults to true (the Document Centre's default view, document-engine.md §5) -- pass false to see superseded versions too. */
  @IsOptional() @Transform(toBoolean) @IsBoolean() latestOnly?: boolean;
}
