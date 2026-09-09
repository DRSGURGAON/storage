import { IsBoolean, IsNumber, IsOptional, IsString, Min } from 'class-validator';

/** Level, segment and parent are structural (baked into full_code) and immutable; move = create new + deactivate old. */
export class UpdateLocationDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsNumber() @Min(0) capacityValue?: number;
  @IsOptional() @IsString() capacityUom?: string;
  @IsOptional() @IsBoolean() isPickable?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
