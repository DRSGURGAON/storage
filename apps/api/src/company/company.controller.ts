import { Body, Controller, Delete, Get, Ip, Param, Patch, Put, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
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
  constructor(private readonly company: CompanyService) {}

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
