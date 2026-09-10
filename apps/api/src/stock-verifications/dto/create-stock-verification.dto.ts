import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * A verification is a *count*, so it is not created with lines: it is
 * created against a warehouse and populated from what the system currently
 * believes is there. Handing the client a line list to submit would let it
 * decide what gets counted, which is the one thing a count must not let
 * anyone do.
 */
export class CreateStockVerificationDto {
  @IsUUID() warehouseId!: string;

  /** Omit to count the whole warehouse; blueprint §27 allows either. */
  @IsOptional() @IsUUID() customerId?: string;

  @IsOptional() @IsDateString() verificationDate?: string;
  @IsOptional() @IsString() verifiedByName?: string;
}
