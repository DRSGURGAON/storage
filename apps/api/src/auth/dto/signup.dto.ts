import { IsEmail, IsString, Matches, MinLength } from 'class-validator';

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
}
