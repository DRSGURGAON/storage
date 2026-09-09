import { IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export const INWARD_ITEM_CONDITIONS = ['good', 'damaged', 'partially_damaged', 'wet', 'tampered', 'other'] as const;

export class CreateInwardItemDto {
  @IsUUID()
  productId!: string;

  @IsOptional() @IsString() batchNo?: string;
  @IsOptional() @IsDateString() mfgDate?: string;
  @IsOptional() @IsDateString() expiryDate?: string;

  @IsOptional() @IsNumber() @Min(0) expectedQty?: number;
  @IsOptional() @IsNumber() @Min(0) receivedQty?: number;
  @IsOptional() @IsNumber() @Min(0) acceptedQty?: number;
  @IsOptional() @IsNumber() @Min(0) rejectedQty?: number;

  @IsOptional() @IsInt() @Min(0) packages?: number;
  @IsOptional() @IsString() packageType?: string;
  @IsOptional() @IsNumber() @Min(0) grossWeightKg?: number;
  @IsOptional() @IsIn(INWARD_ITEM_CONDITIONS) condition?: (typeof INWARD_ITEM_CONDITIONS)[number];
  @IsOptional() @IsString() remarks?: string;
}
