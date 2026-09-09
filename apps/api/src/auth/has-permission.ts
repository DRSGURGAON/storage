import type postgres from 'postgres';
import { AuthenticatedUser } from './jwt-payload';

/**
 * The one RBAC lookup in the codebase.
 *
 * `PermissionsGuard` answers "may this request reach the handler at all?",
 * which covers almost everything -- one permission per route, declared by
 * `@RequirePermission`. A handful of decisions cannot be expressed that
 * way, because the permission needed depends on the *request body* or on
 * the state of the record being acted on: document regeneration is the
 * first (see `documents/regeneration-policy.ts`). Those check here, inside
 * the service, against the same tenant_users -> role_permissions join the
 * guard uses.
 *
 * Kept as a plain function rather than an injectable so the guard and the
 * services can share it without every module in the app having to provide
 * a new dependency. Reads the caller's *membership*, never the JWT's
 * `roleCode`, so a role change or a disabled membership takes effect on
 * the next request rather than at token expiry.
 */
export async function hasPermission(
  tx: postgres.TransactionSql,
  user: AuthenticatedUser,
  permissionCode: string,
): Promise<boolean> {
  const [grant] = await tx<{ ok: boolean }[]>`
    select true as ok
    from tenant_users tu
    join role_permissions rp on rp.role_id = tu.role_id
    where tu.id = ${user.tenantUserId}
      and tu.tenant_id = ${user.tenantId}
      and tu.status = 'active'
      and rp.permission_code = ${permissionCode}
    limit 1
  `;
  return Boolean(grant);
}
