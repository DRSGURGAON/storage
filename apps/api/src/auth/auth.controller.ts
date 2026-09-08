import { Body, Controller, Get, Inject, Post, UseGuards } from '@nestjs/common';
import type postgres from 'postgres';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';
import { AuthenticatedUser } from './jwt-payload';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
  ) {}

  @Post('signup')
  signup(@Body() dto: SignupDto) {
    return this.authService.signup(dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

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
