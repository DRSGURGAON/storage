import { IsBoolean, IsDateString, IsInt, IsObject, IsOptional, IsUUID, Min } from 'class-validator';

export class CreateAgreementDto {
  /** Optional if quotationId is given and the quotation is accepted -- pre-filled from it (blueprint §14). */
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsUUID() quotationId?: string;
  @IsOptional() @IsUUID() rateCardId?: string;
  @IsOptional() @IsUUID() templateId?: string;

  @IsOptional() @IsDateString() agreementDate?: string;

  @IsDateString()
  startDate!: string;

  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsBoolean() autoRenew?: boolean;
  @IsOptional() @IsInt() @Min(0) noticePeriodDays?: number;

  /** One key per §15 wizard step (parties, warehouse, services, goods, commercial_terms, rates, payment, liability_insurance, term, termination, signatories) -- freeform, not schema-enforced beyond "an object". */
  @IsOptional() @IsObject() wizardData?: Record<string, unknown>;
}
