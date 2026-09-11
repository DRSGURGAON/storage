import { Type } from 'class-transformer';
import { RATE_BASES } from '../../billing/dto/create-rate-card-line.dto';
import { ArrayMinSize, IsArray, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, Min, ValidateNested } from 'class-validator';

class PagedQuery {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset = 0;
}

/** billing-engine.md §1: the only hand-typed charge, and it still goes through the run. */
export class ManualChargeLineDto {
  @IsUUID() chargeTypeId!: string;
  @IsString() description!: string;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) quantity!: number;
  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) rate!: number;
  @IsOptional() @IsUUID() taxRateId?: string;
  @IsOptional() @IsString() sacCode?: string;
  /**
   * Overrides the charge type's default basis on this line only. A
   * household storage rent is a lumpsum for the month; printing the
   * Storage charge type's `unit_day` next to it on the customer's invoice
   * would be wrong in the one place a customer reads closely.
   */
  @IsOptional() @IsIn(RATE_BASES) basis?: (typeof RATE_BASES)[number];
}

export class CreateBillingRunDto {
  @IsUUID() customerId!: string;
  /** Omitted: every warehouse the customer has stock or activity in. */
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsDateString() periodStart!: string;
  @IsDateString() periodEnd!: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ManualChargeLineDto)
  manualLines?: ManualChargeLineDto[];
}

export const BILLING_RUN_STATUSES = ['previewed', 'invoiced', 'discarded'] as const;

export class ListBillingRunsQuery extends PagedQuery {
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsIn(BILLING_RUN_STATUSES) status?: (typeof BILLING_RUN_STATUSES)[number];
}

export class CreateInvoiceDto {
  @IsUUID() billingRunId!: string;
  @IsOptional() @IsDateString() invoiceDate?: string;
  /** Defaults to invoiceDate + the customer's credit days. */
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsString() paymentTerms?: string;
}

export class CancelInvoiceDto {
  @IsString() reason!: string;
}

export const INVOICE_STATUSES = ['draft', 'pending_approval', 'approved', 'issued', 'partially_paid', 'paid', 'overdue', 'cancelled'] as const;

export class ListInvoicesQuery extends PagedQuery {
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsIn(INVOICE_STATUSES) status?: (typeof INVOICE_STATUSES)[number];
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

export { ArrayMinSize };
