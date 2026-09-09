import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsNumber, IsOptional, IsUUID, Min, ValidateNested } from 'class-validator';

/**
 * Blueprint §21: "Auto-fill: GRN, customer, SKU, batch, quantity. User
 * selects: zone, rack, row, bin, pallet." So a line carries only what
 * the *user* chooses -- which GRN line, where it goes, and (optionally)
 * how much of it, when one receipt line is split across locations.
 * Product and batch are copied from the GRN line, never re-typed.
 */
export class CreatePutawayLineDto {
  @IsUUID()
  grnItemId!: string;

  @IsUUID()
  toLocationId!: string;

  /** Defaults to the GRN line's whole accepted quantity; give it explicitly to split one line across several locations. */
  @IsOptional() @IsNumber() @Min(0) quantity?: number;
}

export class CreatePutawayDto {
  @IsUUID()
  grnId!: string;

  /** The operator the task is assigned to; defaults to unassigned. */
  @IsOptional() @IsUUID() assignedTo?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreatePutawayLineDto)
  lines!: CreatePutawayLineDto[];
}
