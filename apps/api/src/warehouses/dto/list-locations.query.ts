import { IsIn, IsOptional, IsString } from 'class-validator';
import { LOCATION_LEVELS, LocationLevel } from './create-location.dto';

export class ListLocationsQuery {
  @IsOptional() @IsIn(LOCATION_LEVELS) level?: LocationLevel;
  /** Direct children of this location id, or 'root' for zones. */
  @IsOptional() @IsString() parentId?: string;
  @IsOptional() @IsString() q?: string;
}
