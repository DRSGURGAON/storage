import { IsEmail, IsString, MinLength } from 'class-validator';

/**
 * Eight characters, the same floor `SignupDto` sets, and no composition
 * rules on top of it.
 *
 * That is a decision, not an omission: a rule demanding a capital and a
 * digit is what produces `Warehouse1` on a sticky note under the keyboard.
 * Length is the property that actually costs an attacker something, and
 * the endpoints these guard are rate-limited per credential, so an online
 * guessing run is bounded whatever the password looks like.
 */
export class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  @IsString()
  @MinLength(8, { message: 'The new password must be at least 8 characters' })
  newPassword!: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(16, { message: 'That is not a reset token' })
  token!: string;

  @IsString()
  @MinLength(8, { message: 'The new password must be at least 8 characters' })
  newPassword!: string;
}

/** An Owner setting a member's password. No current password, because the Owner does not know it. */
export class SetMemberPasswordDto {
  @IsString()
  @MinLength(8, { message: 'The password must be at least 8 characters' })
  newPassword!: string;
}
