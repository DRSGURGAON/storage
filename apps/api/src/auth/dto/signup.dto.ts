import { IsEmail, IsIn, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export const PRODUCTS = ['warehouse', 'storage'] as const;

export class SignupDto {
  @IsString()
  @MinLength(2)
  companyLegalName!: string;

  @IsString()
  @Matches(/^[a-z0-9](-?[a-z0-9])*$/, {
    message:
      'tenantSlug must be lowercase letters, digits, and single hyphens only',
  })
  tenantSlug!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(2)
  fullName!: string;

  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  password!: string;

  /**
   * Which product this workspace is signing up for, and therefore which
   * free plan it lands on and which price list it is shown. Sent by the
   * app the person is standing in, not chosen on a screen -- somebody
   * downloading a household storage app has already answered this question
   * by downloading it.
   */
  @IsOptional()
  @IsIn(PRODUCTS)
  product?: (typeof PRODUCTS)[number];
}
