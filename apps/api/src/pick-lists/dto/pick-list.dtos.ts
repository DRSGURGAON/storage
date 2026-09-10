import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, Min, ValidateNested } from 'class-validator';

export class CreatePickListDto {
  @IsUUID() releaseOrderId!: string;
  @IsOptional() @IsUUID() pickerUserId?: string;
}

export class ConfirmPickLineDto {
  @IsUUID() lineId!: string;
  /** What was actually taken; never more than the line's reserved requirement. */
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) pickQty!: number;
}

export class ConfirmPickDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ConfirmPickLineDto)
  lines!: ConfirmPickLineDto[];
}

export const PICK_LIST_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'] as const;

export class ListPickListsQuery {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsUUID() releaseOrderId?: string;
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsIn(PICK_LIST_STATUSES) status?: (typeof PICK_LIST_STATUSES)[number];
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset = 0;
}
