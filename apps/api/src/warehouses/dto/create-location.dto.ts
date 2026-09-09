import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
} from 'class-validator';

/** Ordered shallow -> deep. A child must be deeper than its parent, but levels may be skipped (blueprint §9's own example has no Row). */
export const LOCATION_LEVELS = ['zone', 'rack', 'row', 'bin', 'pallet'] as const;
export type LocationLevel = (typeof LOCATION_LEVELS)[number];

export class CreateLocationDto {
  @IsIn(LOCATION_LEVELS)
  level!: LocationLevel;

  /** One code segment, e.g. 'A', 'R04', 'B15'. Joined with '-' into full_code. */
  @IsString()
  @Matches(/^[A-Z0-9]{1,12}$/, { message: 'segment must be 1-12 uppercase letters/digits' })
  segment!: string;

  /** Required for every level except zone; must be a shallower location in the same warehouse. */
  @IsOptional() @IsUUID() parentId?: string;

  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsNumber() @Min(0) capacityValue?: number;
  @IsOptional() @IsString() capacityUom?: string;
  @IsOptional() @IsBoolean() isPickable?: boolean;
}
