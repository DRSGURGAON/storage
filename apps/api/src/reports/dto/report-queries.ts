import { IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

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

/**
 * Every filter blueprint §55's reports take. A report declares which of
 * these it understands (`ReportDefinition.filters`) and the runner drops
 * the rest, so one query DTO serves the whole catalogue rather than
 * twenty-three near-identical ones.
 */
export class RunReportQuery {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsUUID() productId?: string;
  @IsOptional() @IsString() @MaxLength(40) status?: string;
}
