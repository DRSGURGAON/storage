import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class ListProductsQuery {
  /** Matches SKU/name/barcode (blueprint §11's auto-fill selector). */
  @IsOptional() @IsString() q?: string;

  /** Filter to one customer's catalogue, or 'shared' for customer_id is null. */
  @IsOptional() @IsString() customerId?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit = 25;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset = 0;
}

export class CreateCategoryDto {
  @IsString()
  name!: string;

  @IsOptional() @IsUUID() parentId?: string;
}

export class CreateUomDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;
}
