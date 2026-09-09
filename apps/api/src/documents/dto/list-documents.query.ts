import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';

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

  /** Defaults to true (the Document Centre's default view, document-engine.md §5) -- pass false to see superseded versions too. */
  @IsOptional() @Transform(toBoolean) @IsBoolean() latestOnly?: boolean;
}
