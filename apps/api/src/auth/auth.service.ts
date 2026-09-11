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
import { AuditService } from '../audit/audit.service';
import { PG_CONNECTION } from '../db/db.module';
import { DEFAULT_UOMS } from '../db/seed-data';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';
import { JwtPayload } from './jwt-payload';

interface MembershipRow {
  tenant_user_id: string;
  tenant_id: string;
  tenant_slug: string;
  legal_name: string;
  role_code: string;
  customer_id: string | null;
}

/**
 * A real argon2id hash of a value nobody knows, used only to spend the
 * same ~100ms on a login for an email that has no account as on one that
 * does. Its plaintext is irrelevant and intentionally unrecoverable --
 * nothing ever verifies successfully against it. Baked in as a literal
 * rather than hashed at boot so every process, and every restart, takes
 * the identical amount of work.
 */
const TIMING_EQUALISER_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$r1aeTYVWnIqPqPP9iqjAig$GsIv5gxGyMqvDKgsd5STopcnCVCc84zo0nqI4qwUYOE';

@Injectable()
export class AuthService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async signup(dto: SignupDto, ipAddress?: string) {
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
    // The free plan of the product being signed up for. Two products, two
    // ladders (schema/101_storage_subscription.sql): contract warehousing
    // is priced per godown, household storage per customer in storage, and
    // landing a storage operator on the warehouse ladder would show them a
    // price list about buildings they will never buy.
    const product = dto.product ?? 'warehouse';
    const freePlanCode = product === 'storage' ? 'STORAGE_FREE' : 'FREE';
    const [freePlan] = await this.sql<{ id: string }[]>`
      select id from plans where code = ${freePlanCode}
    `;
    if (!ownerRole || !freePlan) {
      // Only reachable if `npm run seed` was never run against this database.
      throw new InternalServerErrorException(
        'System roles/plans are not seeded; run the seed script before signup',
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
          insert into tenants (id, slug, legal_name, product)
          values (gen_random_uuid(), ${dto.tenantSlug}, ${dto.companyLegalName}, ${product})
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
        // dev-phases.md Phase 1: every new tenant starts on the seeded FREE
        // plan. 'active', not 'trial' -- there is no time-boxed trial
        // period without a paid plan to convert to yet, and the Free plan
        // itself never expires.
        await tx`
          insert into tenant_subscriptions (id, tenant_id, plan_id, status)
          values (gen_random_uuid(), ${tenant.id}, ${freePlan.id}, 'active')
        `;
        // db/seed-data.ts DEFAULT_UOMS: uoms has no shared/system-wide row
        // (tenant_id is not null), so a starting catalogue has to be
        // seeded per tenant here rather than once globally like roles.
        for (const uom of DEFAULT_UOMS) {
          await tx`
            insert into uoms (tenant_id, code, name)
            values (${tenant.id}, ${uom.code}, ${uom.name})
          `;
        }
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
      // A row created a moment ago is at epoch 0, but it is read rather
      // than assumed: the claim's whole job is to match the column, and a
      // literal here is a second place for the two to drift apart.
      epoch: await this.sessionEpoch(created.userId),
    });

    await this.audit.record({
      tenantId: created.tenantId,
      userId: created.userId,
      userRoleCode: 'owner',
      action: 'create',
      entityType: 'tenant',
      entityId: created.tenantId,
      newValue: { slug: dto.tenantSlug, legalName: dto.companyLegalName, ownerEmail: dto.email },
      ipAddress,
    });

    return {
      accessToken,
      tenant: { slug: dto.tenantSlug, legalName: dto.companyLegalName },
      role: 'owner',
    };
  }

  async login(dto: LoginDto, ipAddress?: string) {
    const [user] = await this.sql<
      { id: string; password_hash: string | null; session_epoch: number }[]
    >`select id, password_hash, session_epoch from users where email = ${dto.email}`;

    // No user at all -- nothing to attribute a login_failed row to (no
    // tenant, no user_id), so unlike every other failure below, this one
    // isn't audited. See DECISIONS.md for why that's a deliberate scope
    // boundary, not an oversight.
    if (!user || !user.password_hash) {
      // Returning here immediately would answer in a millisecond, while a
      // real account spends ~100ms in argon2 -- a clean timing oracle for
      // "does this email have an account?", readable over the network
      // without needing the response body at all. Verifying against a
      // fixed dummy hash costs the same work and gives the same answer.
      await argon2.verify(TIMING_EQUALISER_HASH, dto.password).catch(() => false);
      throw new UnauthorizedException('Invalid email or password');
    }

    // Looked up before the password check (not just after a successful
    // one) so a wrong-password attempt against a real account can still be
    // audited against every tenant it would have reached -- the security-
    // relevant signal audit logging exists to capture in the first place.
    const memberships = await this.sql.begin(async (tx) => {
      // No tenant is known yet -- this is what we're about to discover --
      // so app.tenant_id can't be set. schema/91_tenant_users_self_lookup.sql's
      // policy is what makes this query return this user's own memberships
      // instead of nothing.
      await tx`select set_config('app.actor_user_id', ${user.id}, true)`;
      return tx<MembershipRow[]>`
        select tu.id as tenant_user_id, tu.tenant_id, t.slug as tenant_slug,
               t.legal_name, r.code as role_code, tu.customer_id
        from tenant_users tu
        join tenants t on t.id = tu.tenant_id
        join roles r on r.id = tu.role_id
        where tu.user_id = ${user.id} and tu.status = 'active'
      `;
    });

    if (!(await argon2.verify(user.password_hash, dto.password))) {
      await this.auditLoginFailed(user.id, memberships, ipAddress);
      throw new UnauthorizedException('Invalid email or password');
    }

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
      customerId: chosen.customer_id,
      epoch: user.session_epoch,
    });

    await this.audit.record({
      tenantId: chosen.tenant_id,
      userId: user.id,
      userRoleCode: chosen.role_code,
      action: 'login',
      entityType: 'tenant_user',
      entityId: chosen.tenant_user_id,
      ipAddress,
    });

    return {
      accessToken,
      tenant: { slug: chosen.tenant_slug, legalName: chosen.legal_name },
      role: chosen.role_code,
      customerId: chosen.customer_id,
    };
  }

  /** The account's current session counter, stamped into every token it mints. */
  private async sessionEpoch(userId: string): Promise<number> {
    const [row] = await this.sql<{ session_epoch: number }[]>`
      select session_epoch from users where id = ${userId}
    `;
    return row?.session_epoch ?? 0;
  }

  private issueToken(payload: JwtPayload): string {
    return this.jwt.sign(payload);
  }

  /** One login_failed row per tenant the account could have logged into -- a wrong password is a security signal against every one of them, not just whichever tenantSlug (if any) was specified. */
  private async auditLoginFailed(
    userId: string,
    memberships: MembershipRow[],
    ipAddress?: string,
  ): Promise<void> {
    await Promise.all(
      memberships.map((m) =>
        this.audit.record({
          tenantId: m.tenant_id,
          userId,
          userRoleCode: m.role_code,
          action: 'login_failed',
          entityType: 'tenant_user',
          entityId: m.tenant_user_id,
          ipAddress,
        }),
      ),
    );
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
