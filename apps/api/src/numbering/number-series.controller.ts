import { Body, Controller, Get, Ip, Param, Put, UseGuards } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { NumberSeriesService } from './number-series.service';

export const FY_STYLES = ['YY-YY', 'YYYY-YY', 'YYYY', 'NONE'] as const;
export const RESET_POLICIES = ['never', 'yearly', 'monthly'] as const;

export class UpdateNumberSeriesDto {
  /** Letters, digits, dash and slash: it is printed on paper and typed into search boxes. */
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9\-/]{1,12}$/, {
    message: 'A prefix is up to 12 letters, digits, dashes or slashes',
  })
  prefix?: string;

  @IsOptional() @IsString() @Matches(/^[^\n]{1,60}$/) format?: string;
  @IsOptional() @IsIn(FY_STYLES) fyStyle?: string;
  @IsOptional() @IsIn(RESET_POLICIES) resetPolicy?: string;
  @IsOptional() @IsInt() @Min(1) @Max(12) padding?: number;
  /** May be raised (migrating from a system that already printed 4,120 invoices), never lowered. */
  @IsOptional() @IsInt() @Min(1) nextSeq?: number;
}

/**
 * §62's numbering, made configurable — `manage_company_settings`, the same
 * code the rest of Settings rides (`permissions-matrix.md` seeds no
 * numbering-specific permission, and inventing one here would be inventing
 * policy).
 */
@Controller('number-series')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class NumberSeriesController {
  constructor(private readonly series: NumberSeriesService) {}

  @Get()
  @RequirePermission('manage_company_settings')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.series.list(user);
  }

  @Put(':documentType')
  @RequirePermission('manage_company_settings')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('documentType') documentType: string,
    @Body() dto: UpdateNumberSeriesDto,
    @Ip() ip: string,
  ) {
    return this.series.update(user, documentType, dto, ip);
  }
}
