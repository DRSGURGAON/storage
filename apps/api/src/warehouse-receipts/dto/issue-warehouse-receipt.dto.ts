import { IsDateString, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class IssueWarehouseReceiptDto {
  @IsUUID()
  grnId!: string;

  @IsOptional() @IsDateString() receiptDate?: string;

  /** Customer-declared value of the goods (schema/30_inbound.sql) -- optional, and never used for billing. */
  @IsOptional() @IsNumber() @Min(0) declaredValue?: number;

  @IsOptional() @IsString() remarks?: string;
}
