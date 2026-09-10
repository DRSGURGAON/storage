import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { NOTIFICATION_CHANNELS } from '../notification-rules.service';

export class UpsertNotificationRuleDto {
  /**
   * At least one: a rule with no channels is a rule that silently does
   * nothing, which is what `isActive: false` is for and says out loud.
   */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(NOTIFICATION_CHANNELS as unknown as string[], { each: true })
  channels!: string[];

  /**
   * Empty means every staff role, which is what the seeded rules with a
   * null audience already mean -- so an operator who clears the list gets
   * the shipped behaviour back rather than a rule nobody receives. Role
   * codes are checked against the real roles by the service.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  audienceRoleCodes?: string[];

  @IsOptional() @IsBoolean() isActive?: boolean;
}
