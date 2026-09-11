import { Body, Controller, Get, Ip, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';
import { DashboardService } from './dashboard.service';
import { PlanService } from './plan.service';
import { SearchService } from './search.service';

export class SearchQuery {
  @IsString() @MinLength(2) q!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 20;
}

export class AuditLogQuery {
  @IsOptional() @IsString() entityType?: string;
  @IsOptional() @IsUUID() entityId?: string;
  @IsOptional() @IsString() action?: string;
  @IsOptional() @IsUUID() userId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset = 0;
}

/**
 * What an Owner sends when they ask to upgrade.
 *
 * Declared above the controllers on purpose: a class named in a parameter
 * decorator is read when the controller class is *defined*, not when a
 * request arrives, so one declared further down the file throws
 * "Cannot access 'RequestUpgradeDto' before initialization" at import time
 * and the whole application refuses to boot. Which it did.
 */
export class RequestUpgradeDto {
  @IsString()
  @MinLength(2)
  planCode!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/**
 * `ux-system.md` §3's dashboard and §4's global search.
 *
 * These two carry `JwtAuthGuard` alone, and deliberately not
 * `PermissionsGuard`. Both are *aggregations of already-permitted reads*:
 * the dashboard drops the money tiles for a role that cannot see money and
 * narrows every tile by warehouse scope, and search drops each branch whose
 * governing permission the caller lacks. That is a per-branch decision a
 * single route decorator cannot express -- the case `has-permission.ts`
 * exists for -- and declaring one code here would either lock a manager out
 * of a screen made entirely of things they may read, or grant a permission
 * the services then have to re-check anyway. `PermissionsGuard` fails closed
 * on an undeclared route by design, so these routes must state their
 * position rather than inherit it.
 */
@Controller()
@UseGuards(JwtAuthGuard)
export class ConsoleController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly search: SearchService,
  ) {}

  @Get('dashboard')
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.dashboard.summary(user);
  }

  @Get('search')
  globalSearch(@CurrentUser() user: AuthenticatedUser, @Query() query: SearchQuery) {
    return this.search.search(user, query.q, query.limit);
  }
}

/** §13's Plan & Usage and §57's audit viewer: both have exactly one permission that governs them. */
@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PlatformController {
  constructor(private readonly plans: PlanService) {}

  @Get('plan/usage')
  @RequirePermission('view_plan_usage')
  usage(@CurrentUser() user: AuthenticatedUser) {
    return this.plans.usage(user);
  }

  /**
   * §11's upgrade prompt asks this after a 402: what does the next plan up
   * give for the feature that just ran out? Same permission as Plan &
   * Usage -- it is the same question, asked from the modal rather than
   * from the settings page.
   */
  @Get('plan/upgrade/:featureCode')
  @RequirePermission('view_plan_usage')
  upgradeOptions(@CurrentUser() user: AuthenticatedUser, @Param('featureCode') featureCode: string) {
    return this.plans.upgradeOptions(user, featureCode);
  }

  /**
   * The upgrade button. Owner/Admin, like everything else about the plan.
   *
   * It records the ask and notifies; it does not move the workspace onto
   * the plan. That happens after the money does.
   */
  @Post('plan/upgrade-request')
  @RequirePermission('view_plan_usage')
  requestUpgrade(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RequestUpgradeDto,
    @Ip() ip: string,
  ) {
    return this.plans.requestUpgrade(user, dto.planCode, dto.note, ip);
  }

  @Get('audit-logs')
  @RequirePermission('view_audit_log')
  auditLogs(@CurrentUser() user: AuthenticatedUser, @Query() query: AuditLogQuery) {
    return this.plans.auditLog(user, query);
  }
}

/**
 * `ux-system.md` §14: the pricing page is public, because it is what
 * someone reads *before* they have an account -- so this controller
 * carries no guard at all, the same shape as the QR verify endpoint. It
 * reads only `plans` and `plan_feature_limits`, which are platform-level
 * rows with no tenant in them, so there is nothing here to scope.
 */
@Controller('pricing')
export class PricingController {
  constructor(private readonly plans: PlanService) {}

  @Get()
  pricing(@Query('product') product?: string) {
    return this.plans.publicPricing(product === 'storage' ? 'storage' : 'warehouse');
  }
}
