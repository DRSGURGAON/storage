import { ArrayUnique, IsArray, IsIn, IsOptional, IsUUID } from 'class-validator';
import { STAFF_ROLE_CODES } from './add-member.dto';

export class UpdateMemberDto {
  @IsOptional()
  @IsIn(STAFF_ROLE_CODES)
  roleCode?: (typeof STAFF_ROLE_CODES)[number];

  @IsOptional()
  @IsIn(['active', 'disabled'])
  status?: 'active' | 'disabled';

  /** Pass an empty array to clear the restriction (all warehouses). */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  warehouseIds?: string[];
}
