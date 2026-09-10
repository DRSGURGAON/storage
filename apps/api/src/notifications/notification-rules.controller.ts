import { Body, Controller, Get, Ip, Param, Put, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { UpsertNotificationRuleDto } from './dto/upsert-notification-rule.dto';
import { NotificationRulesService } from './notification-rules.service';

/**
 * Separate from `NotificationsController` because the two have opposite
 * audiences: that one is every logged-in user reading their own bell, this
 * one is the workspace's admin deciding what the bell says. Gated on
 * `manage_company_settings` for the same reason `CompanyController` is --
 * `permissions-matrix.md` seeds no notification-specific code, and
 * inventing one here would be inventing policy.
 *
 * There is no DELETE. Reverting to the shipped default is a real thing to
 * want, but it is "delete my override", which reads as destructive and is
 * indistinguishable, in the list, from a rule that was never touched. It
 * is left out until it is asked for, rather than half-built.
 */
@Controller('notification-rules')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class NotificationRulesController {
  constructor(private readonly rules: NotificationRulesService) {}

  @Get()
  @RequirePermission('manage_company_settings')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.rules.list(user);
  }

  @Put(':code')
  @RequirePermission('manage_company_settings')
  upsert(
    @CurrentUser() user: AuthenticatedUser,
    @Param('code') code: string,
    @Body() dto: UpsertNotificationRuleDto,
    @Ip() ip: string,
  ) {
    return this.rules.upsert(user, code, dto, ip);
  }
}
