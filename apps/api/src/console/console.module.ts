import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { EntitlementModule } from '../entitlement/entitlement.module';
import { ConsoleController, PlatformController, PricingController } from './console.controllers';
import { DashboardService } from './dashboard.service';
import { PlanService } from './plan.service';
import { SearchService } from './search.service';

/** ux-system.md §3, §4, §13, §14 and §57: the screens above the modules. */
@Module({
  // AuditModule for PermissionsGuard's permission_denied trail, which every guarded controller needs.
  imports: [EntitlementModule, AuditModule],
  controllers: [ConsoleController, PlatformController, PricingController],
  providers: [DashboardService, SearchService, PlanService],
})
export class ConsoleModule {}
