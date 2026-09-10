import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, IsUUID, Max, Min, MinLength } from 'class-validator';
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
  pricing() {
    return this.plans.publicPricing();
  }
}
