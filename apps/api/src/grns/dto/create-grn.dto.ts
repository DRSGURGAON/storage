import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { CreateGrnItemDto } from './create-grn-item.dto';

export class CreateGrnDto {
  /** Required directly, or auto-filled from `inwardId` (blueprint §18: "Auto-fill from Inward"). */
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsUUID() customerId?: string;

  @IsOptional() @IsDateString() grnDate?: string;

  @IsOptional() @IsUUID() inwardId?: string;
  /** Blueprint §37: a return re-enters through a GRN; lines default to the return request's. */
  @IsOptional() @IsUUID() returnInwardId?: string;
  @IsOptional() @IsUUID() gateEntryId?: string;

  @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional() @IsString() supplierName?: string;

  @IsOptional() @IsUUID() vehicleId?: string;
  @IsOptional() @IsString() vehicleNumber?: string;
  @IsOptional() @IsUUID() driverId?: string;
  @IsOptional() @IsString() driverName?: string;
  @IsOptional() @IsString() driverMobile?: string;
  @IsOptional() @IsUUID() transporterId?: string;
  @IsOptional() @IsString() transporterName?: string;

  @IsOptional() @IsString() lrNumber?: string;
  @IsOptional() @IsDateString() lrDate?: string;
  @IsOptional() @IsString() invoiceNumber?: string;
  @IsOptional() @IsDateString() invoiceDate?: string;
  @IsOptional() @IsString() ewayBillNumber?: string;
  @IsOptional() @IsString() poNumber?: string;
  @IsOptional() @IsString() remarks?: string;

  /** Omitted with an `inwardId`, the lines are copied from that inward's own items. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateGrnItemDto)
  items?: CreateGrnItemDto[];
}
