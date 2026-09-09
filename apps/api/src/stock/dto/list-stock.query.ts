import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/** See `documents/dto/list-documents.query.ts` for why this isn't `@Type(() => Boolean)`. */
const toBoolean = ({ value }: { value: unknown }) => (typeof value === 'string' ? value === 'true' : value);

export class ListStockQuery {
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsUUID() productId?: string;
  @IsOptional() @IsUUID() locationId?: string;

  /** Emptied lots are hidden by default -- "current stock" means what is there now. */
  @IsOptional() @Transform(toBoolean) @IsBoolean() includeEmpty?: boolean;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit = 25;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset = 0;
}
