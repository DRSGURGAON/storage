import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type postgres from 'postgres';
import { AuthenticatedUser } from '../auth/jwt-payload';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';

/**
 * `tenancy-and-security.md` §2's first line of defence, as a guard rather
 * than as a filter each handler remembers to apply: every route in the
 * portal controller passes through here, and a request that is not a
 * `customer` membership with a `customer_id` never reaches a handler at
 * all. The handlers then read `user.customerId` as a *given*, not as an
 * optional they might forget.
 *
 * The token's `customerId` is re-read from `tenant_users` on every
 * request rather than trusted outright. A signed token is authentic, but
 * it is also a *snapshot*: a portal login that has since been disabled,
 * or re-pointed at another customer, must stop working immediately rather
 * than when its token happens to expire.
 */
@Injectable()
export class PortalGuard implements CanActivate {
  constructor(@Inject(PG_CONNECTION) private readonly sql: postgres.Sql) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) throw new ForbiddenException('This endpoint is for customer-portal logins');
    if (user.roleCode !== 'customer') {
      throw new ForbiddenException('This endpoint is for customer-portal logins; staff use the main API');
    }
    const [membership] = await withTenant(this.sql, user.tenantId, (tx) => tx<{ customer_id: string | null }[]>`
      select tu.customer_id from tenant_users tu join roles r on r.id = tu.role_id
      where tu.id = ${user.tenantUserId} and tu.tenant_id = ${user.tenantId} and tu.status = 'active' and r.code = 'customer'
    `);
    if (!membership?.customer_id) throw new ForbiddenException('This portal login is no longer active');
    // The membership, not the token, is what the handlers scope on.
    user.customerId = membership.customer_id;
    return true;
  }
}
