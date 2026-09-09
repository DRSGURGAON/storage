import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { CreateQuotationLineDto } from './create-quotation-line.dto';

export class CreateQuotationDto {
  @IsUUID()
  customerId!: string;

  @IsOptional() @IsUUID() warehouseId?: string;

  @IsOptional() @IsDateString() quotationDate?: string;
  @IsOptional() @IsDateString() validUntil?: string;

  @IsOptional() @IsString() paymentTerms?: string;
  @IsOptional() @IsString() specialConditions?: string;
  @IsOptional() @IsString() notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateQuotationLineDto)
  lines!: CreateQuotationLineDto[];
}
