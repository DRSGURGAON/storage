import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  MinLength,
} from 'class-validator';

export const STORAGE_BASES = ['unit', 'pallet', 'box', 'cbm', 'sqft'] as const;

export class CreateProductDto {
  @IsString()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9\-_./]{0,49}$/, {
    message: 'sku must be 1-50 characters: letters, digits, - _ . /',
  })
  sku!: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() hsnCode?: string;

  @IsString()
  uomCode!: string;

  @IsOptional() @IsNumber() @Min(0) weightKg?: number;
  @IsOptional() @IsNumber() @Min(0) lengthCm?: number;
  @IsOptional() @IsNumber() @Min(0) widthCm?: number;
  @IsOptional() @IsNumber() @Min(0) heightCm?: number;
  @IsOptional() @IsString() barcode?: string;
  @IsOptional() @IsInt() @Min(1) unitsPerPackage?: number;
  @IsOptional() @IsBoolean() batchTracked?: boolean;
  @IsOptional() @IsBoolean() serialTracked?: boolean;
  @IsOptional() @IsBoolean() expiryTracked?: boolean;
  @IsOptional() @IsIn(STORAGE_BASES) storageBasis?: (typeof STORAGE_BASES)[number];

  /** Omitted/null = shared SKU, visible across every customer's transactions in this tenant. */
  @IsOptional() @IsUUID() customerId?: string;

  @IsOptional() @IsBoolean() isActive?: boolean;
}
