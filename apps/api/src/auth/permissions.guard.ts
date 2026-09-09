import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { hasPermission } from './has-permission';
import { AuthenticatedUser } from './jwt-payload';
import { REQUIRED_PERMISSION_KEY } from './require-permission.decorator';

/**
 * tenancy-and-security.md §4: every endpoint declares the permission it
 * requires and is rejected with 403 before any handler logic runs.
 *
 * The lookup goes through the caller's tenant_users row, not the JWT's
 * roleCode: a role reassignment or a disabled membership takes effect on
 * the very next request, without waiting for the token to expire. RBAC
 * and entitlements stay independent axes -- this guard never consults
 * plan limits, and consumeEntitlement never consults roles.
 *
 * Must run after JwtAuthGuard (it reads request.user).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string | undefined>(
      REQUIRED_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) {
      // An authenticated endpoint that declares no permission is a
      // programming error, not an open door -- fail closed.
      throw new ForbiddenException('Endpoint declares no required permission');
    }

    const request = context.switchToHttp().getRequest();
    const user: AuthenticatedUser | undefined = request.user;
    if (!user) throw new UnauthorizedException();

    // Shared with the service-layer checks that a route decorator cannot
    // express (see has-permission.ts) -- one lookup, one place to change.
    const granted = await withTenant(this.sql, user.tenantId, (tx) => hasPermission(tx, user, required));

    if (!granted) {
      await this.audit.record({
        tenantId: user.tenantId,
        userId: user.userId,
        userRoleCode: user.roleCode,
        action: 'permission_denied',
        entityType: 'permission',
        entityId: user.tenantUserId,
        newValue: { required, method: request.method, path: request.url },
        ipAddress: request.ip,
      });
      throw new ForbiddenException(`Missing permission: ${required}`);
    }
    return true;
  }
}
