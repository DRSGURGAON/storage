import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator';
import { CreateInwardItemDto } from './create-inward-item.dto';

export class CreateInwardDto {
  /**
   * Required directly, or auto-filled from `gateEntryId` -- the gate entry
   * already names the warehouse the vehicle was let into, and an inward
   * that disagreed with it is refused rather than silently believed.
   */
  @IsOptional() @IsUUID() warehouseId?: string;

  /** Required directly, or resolved from `gateEntryId`'s own customer (InwardsService.create's own check). */
  @IsOptional() @IsUUID() customerId?: string;

  @IsOptional() @IsDateString() inwardAt?: string;

  /** No Supplier master exists yet (permissions-matrix.md defines none) -- supplierId is validated if given, supplierName works standalone. */
  @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional() @IsString() supplierName?: string;

  /** "If a Gate Entry already exists, selecting it must auto-fill its available data" (blueprint §17). */
  @IsOptional() @IsUUID() gateEntryId?: string;

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
  @IsOptional() @IsNumber() @Min(0) invoiceValue?: number;

  @IsOptional() @IsString() ewayBillNumber?: string;
  @IsOptional() @IsDateString() ewayBillDate?: string;
  @IsOptional() @IsString() poNumber?: string;
  @IsOptional() @IsString() remarks?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateInwardItemDto)
  items!: CreateInwardItemDto[];
}
