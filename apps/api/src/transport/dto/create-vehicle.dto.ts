import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, IsUUID, Matches, Min } from 'class-validator';

export const VEHICLE_TYPES = [
  'tata_ace',
  '14ft',
  '20ft',
  '32ft_sxl',
  '32ft_mxl',
  'container',
  'tempo',
  'other',
] as const;
export const VEHICLE_CAPACITY_UOMS = ['mt', 'cbm'] as const;

export class CreateVehicleDto {
  /** schema/10_masters.sql: "normalised uppercase, no spaces: 'HR26DK1234'" -- the service does the normalising. */
  @IsString()
  @Matches(/^[A-Za-z0-9 ]{4,15}$/, { message: 'vehicleNumber must be 4-15 letters/digits' })
  vehicleNumber!: string;

  @IsOptional() @IsIn(VEHICLE_TYPES) vehicleType?: (typeof VEHICLE_TYPES)[number];
  @IsOptional() @IsNumber() @Min(0) capacityValue?: number;
  @IsOptional() @IsIn(VEHICLE_CAPACITY_UOMS) capacityUom?: (typeof VEHICLE_CAPACITY_UOMS)[number];
  @IsOptional() @IsUUID() transporterId?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
