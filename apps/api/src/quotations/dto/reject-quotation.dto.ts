import { IsString, MinLength } from 'class-validator';

export class RejectQuotationDto {
  @IsString()
  @MinLength(2)
  reason!: string;
}
