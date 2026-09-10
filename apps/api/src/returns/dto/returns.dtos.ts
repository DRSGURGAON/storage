import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, Min, ValidateNested } from 'class-validator';

class PagedQuery {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset = 0;
}

export class ReturnRequestLineDto {
  @IsUUID() productId!: string;
  @IsOptional() @IsUUID() batchId?: string;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) quantity!: number;
}

export class CreateReturnRequestDto {
  @IsUUID() customerId!: string;
  @IsUUID() warehouseId!: string;
  @IsOptional() @IsDateString() requestDate?: string;
  /** When given, every line must be on that dispatch and within what it carried. */
  @IsOptional() @IsUUID() originalDispatchId?: string;
  @IsString() reason!: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ReturnRequestLineDto)
  lines!: ReturnRequestLineDto[];
}

export class RejectReturnRequestDto {
  @IsString() reason!: string;
}

export const RETURN_REQUEST_STATUSES = ['requested', 'approved', 'rejected', 'received', 'cancelled'] as const;

export class ListReturnRequestsQuery extends PagedQuery {
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsIn(RETURN_REQUEST_STATUSES) status?: (typeof RETURN_REQUEST_STATUSES)[number];
}

export class CreateReturnInwardDto {
  @IsUUID() returnRequestId!: string;
  @IsOptional() @IsUUID() gateEntryId?: string;
  @IsOptional() @IsUUID() vehicleId?: string;
  @IsOptional() @IsUUID() driverId?: string;
}

export const RETURN_INWARD_STATUSES = ['draft', 'inspected', 'grn_posted', 'cancelled'] as const;

export class ListReturnInwardsQuery extends PagedQuery {
  @IsOptional() @IsUUID() returnRequestId?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsIn(RETURN_INWARD_STATUSES) status?: (typeof RETURN_INWARD_STATUSES)[number];
}
