import { IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export const GATE_ENTRY_DIRECTIONS = ['in', 'out'] as const;
export const GATE_ENTRY_PURPOSES = ['inward', 'dispatch', 'return', 'transfer', 'visitor', 'other'] as const;

export class CreateGateEntryDto {
  @IsUUID()
  warehouseId!: string;

  @IsIn(GATE_ENTRY_DIRECTIONS)
  direction!: (typeof GATE_ENTRY_DIRECTIONS)[number];

  /** Defaults to now() -- blueprint §16's "date, time" of gate-in. */
  @IsOptional() @IsDateString() entryAt?: string;

  @IsOptional() @IsUUID() customerId?: string;

  /** Selecting a vehicle auto-fills transporter (blueprint §16) and its own number, unless overridden below. */
  @IsOptional() @IsUUID() vehicleId?: string;
  @IsOptional() @IsString() @MaxLength(20) vehicleNumber?: string;

  @IsOptional() @IsUUID() driverId?: string;
  @IsOptional() @IsString() @MaxLength(120) driverName?: string;
  @IsOptional() @IsString() @MaxLength(20) driverMobile?: string;

  @IsOptional() @IsUUID() transporterId?: string;
  @IsOptional() @IsString() @MaxLength(200) transporterName?: string;

  @IsIn(GATE_ENTRY_PURPOSES)
  purpose!: (typeof GATE_ENTRY_PURPOSES)[number];

  @IsOptional() @IsString() @MaxLength(100) referenceNo?: string;
  @IsOptional() @IsString() remarks?: string;
}
