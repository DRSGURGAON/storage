import { IsArray, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { INWARD_ITEM_CONDITIONS } from '../../inwards/dto/create-inward-item.dto';

export class CreateGrnItemDto {
  @IsUUID()
  productId!: string;

  /** Set automatically when the GRN's items are derived from an Inward; accepted explicitly for a hand-built GRN line that still traces back to one. */
  @IsOptional() @IsUUID() inwardItemId?: string;

  @IsOptional() @IsString() batchNo?: string;
  @IsOptional() @IsDateString() mfgDate?: string;
  @IsOptional() @IsDateString() expiryDate?: string;

  @IsOptional() @IsNumber() @Min(0) expectedQty?: number;
  @IsOptional() @IsNumber() @Min(0) receivedQty?: number;
  /** What actually posts to stock once the GRN is approved (schema/30_inbound.sql). */
  @IsOptional() @IsNumber() @Min(0) acceptedQty?: number;
  @IsOptional() @IsNumber() @Min(0) rejectedQty?: number;
  @IsOptional() @IsNumber() @Min(0) damagedQty?: number;

  @IsOptional() @IsInt() @Min(0) packages?: number;
  @IsOptional() @IsString() packageType?: string;
  @IsOptional() @IsNumber() @Min(0) grossWeightKg?: number;
  @IsOptional() @IsIn(INWARD_ITEM_CONDITIONS) condition?: (typeof INWARD_ITEM_CONDITIONS)[number];
  @IsOptional() @IsString() remarks?: string;

  /** Only accepted for a product whose master has `serialTracked` set (GrnsService enforces this). */
  @IsOptional() @IsArray() @IsString({ each: true }) serialNos?: string[];
}
