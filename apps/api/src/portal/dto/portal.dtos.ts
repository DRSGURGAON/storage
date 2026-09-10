import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, Min, ValidateNested } from 'class-validator';

export class PortalListQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset = 0;
}

export class PortalDocumentsQuery extends PortalListQuery {
  @IsOptional() @IsString() documentType?: string;
}

export class PortalStatementQuery {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

export class PortalReturnLineDto {
  @IsUUID() productId!: string;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) quantity!: number;
}

/**
 * Note what is *absent*: no `customerId`, and no `warehouseId`. The portal
 * handler takes both from the membership, so there is no field a portal
 * user could set to reach another customer's goods.
 */
export class PortalReturnRequestDto {
  @IsUUID() originalDispatchId!: string;
  @IsString() reason!: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => PortalReturnLineDto)
  lines!: PortalReturnLineDto[];
}
