import { IsNotEmpty, IsString } from 'class-validator';

export class RejectStockAdjustmentDto {
  @IsString()
  @IsNotEmpty({ message: 'a reason is required to reject an adjustment' })
  reason!: string;
}
