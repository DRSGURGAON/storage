import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateNested } from 'class-validator';

class PagedQuery {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset = 0;
}

// ---------- Credit / Debit note (§41) ----------

export const NOTE_TYPES = ['credit', 'debit'] as const;

export class NoteLineDto {
  @IsString() description!: string;
  @IsOptional() @IsString() hsnSacCode?: string;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) quantity!: number;
  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) rate!: number;
  @IsOptional() @IsUUID() taxRateId?: string;
}

export class CreateNoteDto {
  @IsIn(NOTE_TYPES) noteType!: (typeof NOTE_TYPES)[number];
  @IsUUID() customerId!: string;
  /** The invoice being corrected, when there is one. Must belong to the same customer. */
  @IsOptional() @IsUUID() invoiceId?: string;
  @IsOptional() @IsDateString() noteDate?: string;
  @IsString() reason!: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => NoteLineDto)
  lines!: NoteLineDto[];
}

export const NOTE_STATUSES = ['draft', 'pending_approval', 'approved', 'issued', 'cancelled'] as const;

export class ListNotesQuery extends PagedQuery {
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() invoiceId?: string;
  @IsOptional() @IsIn(NOTE_TYPES) noteType?: (typeof NOTE_TYPES)[number];
  @IsOptional() @IsIn(NOTE_STATUSES) status?: (typeof NOTE_STATUSES)[number];
}

// ---------- Payment receipt (§42) ----------

export const PAYMENT_MODES = ['cash', 'cheque', 'neft', 'rtgs', 'imps', 'upi', 'card', 'other'] as const;

export class PaymentAllocationDto {
  @IsUUID() invoiceId!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount!: number;
}

export class CreatePaymentDto {
  /**
   * billing-engine.md §7: the client's own token for this "Record Payment"
   * click. A retry carrying the same token returns the receipt already
   * recorded instead of posting a second one.
   */
  @IsString() @Length(8, 200) idempotencyKey!: string;
  @IsUUID() customerId!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount!: number;
  @IsIn(PAYMENT_MODES) paymentMode!: (typeof PAYMENT_MODES)[number];
  @IsOptional() @IsDateString() paymentDate?: string;
  @IsOptional() @IsString() referenceNumber?: string;
  @IsOptional() @IsString() remarks?: string;
  /** Omitted: the receipt sits on account until allocated. */
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PaymentAllocationDto)
  allocations?: PaymentAllocationDto[];
}

export class AllocatePaymentDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => PaymentAllocationDto)
  allocations!: PaymentAllocationDto[];
}

export class ListPaymentsQuery extends PagedQuery {
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsIn(['posted', 'cancelled']) status?: 'posted' | 'cancelled';
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

// ---------- Customer statement (§43) ----------

export class CustomerStatementQuery {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}
