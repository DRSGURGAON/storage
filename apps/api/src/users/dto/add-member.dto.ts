import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

/** Staff roles only. 'customer' memberships belong to the portal (V1.1) and need a customer_id. */
export const STAFF_ROLE_CODES = [
  'owner',
  'admin',
  'warehouse_manager',
  'warehouse_operator',
  'billing_executive',
  'accountant',
] as const;

export class AddMemberDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(2)
  fullName!: string;

  /** Required only when the email has no account yet; ignored for an existing account. */
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  password?: string;

  @IsIn(STAFF_ROLE_CODES)
  roleCode!: (typeof STAFF_ROLE_CODES)[number];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  warehouseIds?: string[];
}
