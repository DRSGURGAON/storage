import { IsBoolean, IsDateString, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateDriverDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional() @IsString() mobile?: string;
  @IsOptional() @IsString() licenseNumber?: string;
  @IsOptional() @IsDateString() licenseExpiry?: string;
  @IsOptional() @IsUUID() transporterId?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
