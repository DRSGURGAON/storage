import { IsEmail, IsOptional, IsString } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;

  /** Required only when the account belongs to more than one tenant. */
  @IsOptional()
  @IsString()
  tenantSlug?: string;
}
