import { Body, Controller, Get, Inject, Ip, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type postgres from 'postgres';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { positiveNumber, ThrottlePerCredential } from '../throttling';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';
import { AuthenticatedUser } from './jwt-payload';
import { JwtAuthGuard } from './jwt-auth.guard';

const AUTH_LIMIT = {
  ttl: positiveNumber(process.env.AUTH_RATE_LIMIT_TTL_MS, 60_000),
  limit: positiveNumber(process.env.AUTH_RATE_LIMIT_MAX, 8),
};

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
  ) {}

  /**
   * The tight limit, keyed per (IP, email) by `ScopedThrottlerGuard`.
   * Passwords are argon2id at 64 MiB a hash, so unlimited attempts are
   * not only a guessing oracle but a cheap way to exhaust the server's
   * memory: a hundred concurrent tries is 6.4 GB of work an anonymous
   * caller can ask for. Signup gets the same treatment -- it is the other
   * anonymous endpoint that runs a hash, and it doubles as an
   * account-existence oracle, which should not be answerable thousands of
   * times a minute whatever it is worth.
   */
  @Post('signup')
  @ThrottlePerCredential()
  @Throttle({ default: AUTH_LIMIT })
  signup(@Body() dto: SignupDto, @Ip() ip: string) {
    return this.authService.signup(dto, ip);
  }

  @Post('login')
  @ThrottlePerCredential()
  @Throttle({ default: AUTH_LIMIT })
  login(@Body() dto: LoginDto, @Ip() ip: string) {
    return this.authService.login(dto, ip);
  }

  /** An authenticated session polling its own identity is not the shape the limits exist for. */
  @SkipThrottle({ default: true })
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser) {
    // Both layers deliberately present: withTenant sets app.tenant_id for
    // RLS (schema/90_row_level_security.sql), and the query below also
    // filters by tenant_id explicitly -- tenancy-and-security.md §1's two
    // independent layers, not one relied on alone.
    const [row] = await withTenant(this.sql, user.tenantId, (tx) =>
      tx<
        {
          email: string;
          full_name: string;
          role_code: string;
          role_name: string;
          tenant_slug: string;
          legal_name: string;
        }[]
      >`
        select u.email, u.full_name, r.code as role_code, r.name as role_name,
               t.slug as tenant_slug, t.legal_name
        from tenant_users tu
        join users u on u.id = tu.user_id
        join roles r on r.id = tu.role_id
        join tenants t on t.id = tu.tenant_id
        where tu.id = ${user.tenantUserId} and tu.tenant_id = ${user.tenantId}
      `,
    );

    return {
      user: { email: row.email, fullName: row.full_name },
      role: { code: row.role_code, name: row.role_name },
      tenant: { slug: row.tenant_slug, legalName: row.legal_name },
    };
  }
}
