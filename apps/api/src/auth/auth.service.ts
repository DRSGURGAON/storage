import {
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import type postgres from 'postgres';
import { PG_CONNECTION } from '../db/db.module';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';
import { JwtPayload } from './jwt-payload';

interface MembershipRow {
  tenant_user_id: string;
  tenant_id: string;
  tenant_slug: string;
  legal_name: string;
  role_code: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly jwt: JwtService,
  ) {}

  async signup(dto: SignupDto) {
    const [emailTaken] =
      await this.sql`select id from users where email = ${dto.email}`;
    if (emailTaken) {
      throw new ConflictException('An account with this email already exists');
    }
    const [slugTaken] =
      await this.sql`select id from tenants where slug = ${dto.tenantSlug}`;
    if (slugTaken) {
      throw new ConflictException('That workspace URL is already taken');
    }

    const [ownerRole] = await this.sql<{ id: string }[]>`
      select id from roles where code = 'owner' and tenant_id is null
    `;
    if (!ownerRole) {
      // Only reachable if `npm run seed` was never run against this database.
      throw new InternalServerErrorException(
        'System roles are not seeded; run the seed script before signup',
      );
    }

    const passwordHash = await argon2.hash(dto.password);

    let created: {
      tenantId: string;
      userId: string;
      tenantUserId: string;
    };
    try {
      created = await this.sql.begin(async (tx) => {
        const [tenant] = await tx<{ id: string }[]>`
          insert into tenants (id, slug, legal_name)
          values (gen_random_uuid(), ${dto.tenantSlug}, ${dto.companyLegalName})
          returning id
        `;
        const [user] = await tx<{ id: string }[]>`
          insert into users (id, email, full_name, password_hash)
          values (gen_random_uuid(), ${dto.email}, ${dto.fullName}, ${passwordHash})
          returning id
        `;
        // The tenant this row belongs to is being created in this same
        // transaction, so app.tenant_id is set explicitly here rather
        // than via withTenant(), which assumes the tenant already exists.
        await tx`select set_config('app.tenant_id', ${tenant.id}, true)`;
        const [membership] = await tx<{ id: string }[]>`
          insert into tenant_users (id, tenant_id, user_id, role_id, status)
          values (gen_random_uuid(), ${tenant.id}, ${user.id}, ${ownerRole.id}, 'active')
          returning id
        `;
        return {
          tenantId: tenant.id,
          userId: user.id,
          tenantUserId: membership.id,
        };
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          'That email or workspace URL was just taken by someone else',
        );
      }
      throw err;
    }

    const accessToken = this.issueToken({
      sub: created.userId,
      tenantId: created.tenantId,
      tenantUserId: created.tenantUserId,
      roleCode: 'owner',
    });

    return {
      accessToken,
      tenant: { slug: dto.tenantSlug, legalName: dto.companyLegalName },
      role: 'owner',
    };
  }

  async login(dto: LoginDto) {
    const [user] = await this.sql<
      { id: string; password_hash: string | null }[]
    >`select id, password_hash from users where email = ${dto.email}`;

    if (!user || !user.password_hash) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!(await argon2.verify(user.password_hash, dto.password))) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const memberships = await this.sql.begin(async (tx) => {
      // No tenant is known yet -- this is what we're about to discover --
      // so app.tenant_id can't be set. schema/91_tenant_users_self_lookup.sql's
      // policy is what makes this query return this user's own memberships
      // instead of nothing.
      await tx`select set_config('app.actor_user_id', ${user.id}, true)`;
      return tx<MembershipRow[]>`
        select tu.id as tenant_user_id, tu.tenant_id, t.slug as tenant_slug,
               t.legal_name, r.code as role_code
        from tenant_users tu
        join tenants t on t.id = tu.tenant_id
        join roles r on r.id = tu.role_id
        where tu.user_id = ${user.id} and tu.status = 'active'
      `;
    });

    if (memberships.length === 0) {
      throw new UnauthorizedException(
        'This account has no active workspace membership',
      );
    }

    let chosen: MembershipRow;
    if (memberships.length === 1) {
      if (dto.tenantSlug && memberships[0].tenant_slug !== dto.tenantSlug) {
        throw new UnauthorizedException('No membership found for that workspace');
      }
      chosen = memberships[0];
    } else if (!dto.tenantSlug) {
      throw new ConflictException({
        message:
          'This account belongs to more than one workspace; specify tenantSlug',
        memberships: memberships.map((m) => ({
          tenantSlug: m.tenant_slug,
          legalName: m.legal_name,
          roleCode: m.role_code,
        })),
      });
    } else {
      const match = memberships.find((m) => m.tenant_slug === dto.tenantSlug);
      if (!match) {
        throw new UnauthorizedException('No membership found for that workspace');
      }
      chosen = match;
    }

    const accessToken = this.issueToken({
      sub: user.id,
      tenantId: chosen.tenant_id,
      tenantUserId: chosen.tenant_user_id,
      roleCode: chosen.role_code,
    });

    return {
      accessToken,
      tenant: { slug: chosen.tenant_slug, legalName: chosen.legal_name },
      role: chosen.role_code,
    };
  }

  private issueToken(payload: JwtPayload): string {
    return this.jwt.sign(payload);
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  );
}
