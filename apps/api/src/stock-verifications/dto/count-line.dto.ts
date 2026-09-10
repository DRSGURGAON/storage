import { IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

/** What the counter actually found. `differenceQty` is the database's to compute, never the client's to assert. */
export class CountLineDto {
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0, { message: 'physicalQty cannot be negative -- a count is what is on the shelf' })
  physicalQty!: number;

  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() remarks?: string;
}

/**
 * A line for stock the system does not know about at all -- goods found in
 * a rack with no matching lot. `stock_verification_lines.stock_lot_id` is
 * nullable precisely for this, and without it a count could only ever
 * report shortages, never a genuine find.
 */
export class AddFoundLineDto {
  @IsUUID() productId!: string;
  @IsUUID() locationId!: string;
  @IsOptional() @IsUUID() batchId?: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001, { message: 'a found line needs a positive quantity' })
  physicalQty!: number;

  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() remarks?: string;
}
