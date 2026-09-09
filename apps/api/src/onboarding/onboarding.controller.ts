import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { OnboardingService } from './onboarding.service';

/** No RequirePermission: informational and RLS-scoped to the caller's own tenant, same as GET /auth/me. */
@Controller('onboarding')
@UseGuards(JwtAuthGuard)
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get('status')
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.onboarding.getStatus(user.tenantId);
  }
}
