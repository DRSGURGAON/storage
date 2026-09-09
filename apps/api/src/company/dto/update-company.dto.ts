import { IsIn, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * The tenant's own profile -- what every document's letterhead is built
 * from (`documents/company-context.ts`) and what the agreement template's
 * `{{company.*}}` tokens resolve against.
 *
 * Deliberately not settable here:
 *
 * - `slug` -- it is the workspace's identity at login; changing it would
 *   silently lock out anyone who logs in with it.
 * - `status` -- suspension is a platform decision, not a tenant's own.
 * - `financialYearStartMonth` -- number series are keyed by financial year
 *   (`numbering.md`), so moving it mid-year would re-key every series and
 *   start issuing numbers that collide with ones already printed.
 * - the three `*_attachment_id` fields (logo, signature, stamp) -- those
 *   need an upload flow, not a raw id from the client.
 */
export class UpdateCompanyDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) legalName?: string;
  @IsOptional() @IsString() @MaxLength(200) tradeName?: string;

  @IsOptional() @IsString() @MaxLength(200) addressLine1?: string;
  @IsOptional() @IsString() @MaxLength(200) addressLine2?: string;
  @IsOptional() @IsString() @MaxLength(100) city?: string;
  @IsOptional() @IsString() @MaxLength(100) state?: string;
  @IsOptional() @IsString() @Length(2, 2) stateCode?: string;
  @IsOptional() @IsString() @Matches(/^[1-9][0-9]{5}$/, { message: 'pincode must be 6 digits' }) pincode?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z][Z][0-9A-Z]$/, { message: 'gstin must be a valid 15-character GSTIN' })
  gstin?: string;

  @IsOptional() @IsString() @Matches(/^[A-Z]{5}[0-9]{4}[A-Z]$/, { message: 'pan must be a valid 10-character PAN' }) pan?: string;
  @IsOptional() @IsString() @MaxLength(30) cin?: string;

  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsString() @MaxLength(200) email?: string;
  @IsOptional() @IsString() @MaxLength(200) website?: string;

  @IsOptional() @IsString() @MaxLength(200) bankName?: string;
  @IsOptional() @IsString() @MaxLength(50) bankAccountNo?: string;
  @IsOptional() @IsString() @MaxLength(20) bankIfsc?: string;
  @IsOptional() @IsString() @MaxLength(200) bankBranch?: string;

  @IsOptional() @IsString() @MaxLength(200) signatoryName?: string;
  @IsOptional() @IsString() @MaxLength(200) signatoryDesignation?: string;
  @IsOptional() @IsString() termsAndConditions?: string;

  @IsOptional() @IsString() @MaxLength(64) timezone?: string;
  @IsOptional() @IsString() @IsIn(['INR']) currency?: string;
}
