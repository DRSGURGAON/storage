import { IsBoolean, IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateCustomerContactDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional() @IsString() designation?: string;
  @IsOptional() @IsString() mobile?: string;
  @IsOptional() @IsEmail() email?: string;

  /** Setting true unsets any other primary contact for this customer (service-enforced, not a DB constraint). */
  @IsOptional() @IsBoolean() isPrimary?: boolean;
  @IsOptional() @IsBoolean() receivesDocuments?: boolean;
}
