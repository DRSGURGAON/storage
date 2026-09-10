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

/** Staff roles. A `customer` membership is a portal login and needs a `customerId` -- see MEMBER_ROLE_CODES. */
export const STAFF_ROLE_CODES = [
  'owner',
  'admin',
  'warehouse_manager',
  'warehouse_operator',
  'billing_executive',
  'accountant',
] as const;

/** `customer` is the portal login (`tenancy-and-security.md` §2), and the only role that carries a `customerId`. */
export const MEMBER_ROLE_CODES = [...STAFF_ROLE_CODES, 'customer'] as const;

export class AddMemberDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(2)
  fullName!: string;

  /**
   * Always required, and ignored when the email already has an account.
   *
   * It used to be optional, with a 400 explaining that a password was
   * needed "when the email has no account yet" -- which told any tenant
   * admin, for any address they cared to try, whether that address had an
   * account *anywhere on the platform*, including in other tenants. The
   * membership itself is tenant-scoped; that answer was not. Requiring it
   * unconditionally costs the caller one field and removes the oracle:
   * the request now looks and behaves identically either way.
   */
  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  password!: string;

  @IsIn(MEMBER_ROLE_CODES)
  roleCode!: (typeof MEMBER_ROLE_CODES)[number];

  /** Required for `roleCode: 'customer'`, and refused for every other role. */
  @IsOptional() @IsUUID() customerId?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  warehouseIds?: string[];
}
