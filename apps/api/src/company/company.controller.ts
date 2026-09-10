import { Body, Controller, Delete, Get, Ip, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { AccountDeletionService } from '../auth/account-deletion.service';
import { RequestWorkspaceDeletionDto } from '../auth/dto/password.dto';
import { CompanyService } from './company.service';
import { SetSettingDto } from './dto/set-setting.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';

/**
 * `manage_company_settings` on the read as well as the write, which is
 * stricter than it might look. `permissions-matrix.md` seeds exactly one
 * code for this area and grants it to Owner and Admin only; there is no
 * `view_company_settings`, and inventing one here would be inventing
 * policy. The record also holds bank account details and the authorised
 * signatory -- and nothing else needs it: documents build their letterhead
 * server-side from the same row, so no client ever has to fetch it to
 * render one, and `GET /onboarding/status` reports whether the profile is
 * complete without exposing what is in it.
 */
@Controller('company')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CompanyController {
  constructor(
    private readonly company: CompanyService,
    private readonly accountDeletion: AccountDeletionService,
  ) {}

  /**
   * Closing the workspace. Owner/Admin only, like everything else here.
   *
   * It disables every sign-in immediately and records the request; it does
   * not drop the data, because a warehouse's stock ledger and issued
   * invoices are statutory records and how long they are kept after a
   * closure is a decision for whoever runs the service. The response says
   * exactly that rather than implying the data is gone.
   */
  @Post('deletion-request')
  @RequirePermission('manage_company_settings')
  requestDeletion(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RequestWorkspaceDeletionDto,
    @Ip() ip: string,
  ) {
    return this.accountDeletion.requestWorkspaceDeletion(user, dto.reason, ip);
  }

  @Get()
  @RequirePermission('manage_company_settings')
  getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.company.getProfile(user);
  }

  @Patch()
  @RequirePermission('manage_company_settings')
  updateProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateCompanyDto, @Ip() ip: string) {
    return this.company.updateProfile(user, dto, ip);
  }

  @Get('settings')
  @RequirePermission('manage_company_settings')
  listSettings(@CurrentUser() user: AuthenticatedUser) {
    return this.company.listSettings(user);
  }

  @Put('settings/:key')
  @RequirePermission('manage_company_settings')
  setSetting(
    @CurrentUser() user: AuthenticatedUser,
    @Param('key') key: string,
    @Body() dto: SetSettingDto,
    @Ip() ip: string,
  ) {
    return this.company.setSetting(user, key, dto, ip);
  }

  @Delete('settings/:key')
  @RequirePermission('manage_company_settings')
  clearSetting(@CurrentUser() user: AuthenticatedUser, @Param('key') key: string, @Ip() ip: string) {
    return this.company.clearSetting(user, key, ip);
  }
}
