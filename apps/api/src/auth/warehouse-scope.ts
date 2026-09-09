import { ForbiddenException } from '@nestjs/common';
import type postgres from 'postgres';
import { AuthenticatedUser } from './jwt-payload';

/**
 * tenancy-and-security.md §4: "`tenant_users.warehouse_ids` optionally
 * restricts a Warehouse Manager/Operator to specific warehouses; when set,
 * every operational query additionally filters
 * `warehouse_id = ANY(tenant_users.warehouse_ids)`."
 * `permissions-matrix.md` adds that it *narrows* the role's existing
 * permissions and never grants new ones -- so this is a filter layered on
 * top of RBAC, never a substitute for it.
 *
 * It is a third, independent axis, and worth keeping straight:
 *
 * - **RLS** decides which tenant's rows exist at all.
 * - **RBAC** decides whether this role may perform this kind of action.
 * - **This** decides which warehouses within the tenant that action may
 *   touch.
 *
 * Read per request rather than carried in the JWT, for the same reason
 * `PermissionsGuard` re-reads the role: narrowing someone's warehouses
 * must take effect on their next request, not when their token expires.
 */
export type WarehouseScope = string[] | null;

/**
 * `null` means unrestricted -- which is the common case, and deliberately
 * also what an empty array means. A membership with `warehouse_ids = '{}'`
 * is someone who was never restricted, not someone locked out of every
 * warehouse; treating it as "see nothing" would silently disable accounts
 * on a stray empty write.
 */
export async function loadWarehouseScope(
  tx: postgres.TransactionSql,
  user: AuthenticatedUser,
): Promise<WarehouseScope> {
  const [row] = await tx<{ warehouse_ids: string[] | null }[]>`
    select warehouse_ids from tenant_users
    where id = ${user.tenantUserId} and tenant_id = ${user.tenantId}
  `;
  const ids = row?.warehouse_ids;
  return ids && ids.length > 0 ? ids : null;
}

/**
 * Guards the *write* side. Reads narrow silently (an out-of-scope record
 * is simply not there, which is what a filter means), but a create or an
 * action naming a warehouse the caller may not touch is a mistake worth
 * naming: a silent 404 there would read as "that warehouse doesn't
 * exist", which is both confusing and less honest than saying so.
 */
export function assertWarehouseInScope(scope: WarehouseScope, warehouseId: string | null | undefined) {
  if (!scope || !warehouseId) return;
  if (!scope.includes(warehouseId)) {
    throw new ForbiddenException('Your account is not assigned to that warehouse');
  }
}
