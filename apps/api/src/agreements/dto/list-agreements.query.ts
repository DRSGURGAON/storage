import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export const AGREEMENT_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'active',
  'expired',
  'terminated',
  'cancelled',
] as const;

export class ListAgreementsQuery {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsIn(AGREEMENT_STATUSES) status?: (typeof AGREEMENT_STATUSES)[number];

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit = 25;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset = 0;
}
