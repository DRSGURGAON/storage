import { IsDateString, IsOptional } from 'class-validator';

export class CloseGateEntryDto {
  /** Defaults to now() -- the moment the vehicle actually leaves. */
  @IsOptional() @IsDateString() exitAt?: string;
}
