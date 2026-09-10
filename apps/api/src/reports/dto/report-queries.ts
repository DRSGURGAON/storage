import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class StockStatementQuery {
  @IsUUID() customerId!: string;
  @IsOptional() @IsUUID() warehouseId?: string;
  /** Balances as they stood at the end of this day, rebuilt from the ledger; omit for now. */
  @IsOptional() @IsDateString() asOf?: string;
}

export class AgeingQuery {
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() warehouseId?: string;
}
