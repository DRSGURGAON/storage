import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { AuthenticatedUser } from './jwt-payload';

/**
 * Deleting an account, in a product whose records are somebody's legal
 * obligation.
 *
 * Google Play requires an in-app route to delete an account for any app
 * that lets one be created, and it is a fair requirement. It is also not
 * `delete from users`: a person's name is on GRNs they approved, invoices
 * they issued and audit rows that exist precisely so those actions can be
 * traced. Deleting the row would either fail on a foreign key or destroy a
 * warehouse's own evidence of who did what.
 *
 * So the personal data goes and the record stays. The `users` row is
 * anonymised in place -- email replaced with an unroutable address derived
 * from the id, name replaced, password and mobile cleared -- every
 * membership is disabled, and `session_epoch` moves so any open session
 * dies immediately. What is left behind is a foreign key pointing at
 * "Deleted user", which is what an audit trail of a departed employee
 * should look like.
 *
 * The one refusal: the last active Owner of a workspace. Somebody has to
 * be able to add users and approve adjustments, and an ownerless workspace
 * is a support ticket nobody can resolve from inside the product. The
 * message says what to do instead.
 */
@Injectable()
export class AccountDeletionService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly audit: AuditService,
  ) {}

  async deleteOwnAccount(actor: AuthenticatedUser, ipAddress?: string) {
    // Every workspace this person belongs to, and whether they are its only
    // remaining Owner. Read through the self-membership policy, the same
    // way login discovers memberships before a tenant is chosen.
    const memberships = await this.sql.begin(async (tx) => {
      await tx`select set_config('app.actor_user_id', ${actor.userId}, true)`;
      return tx<{ tenant_id: string; role_code: string; tenant_name: string; other_owners: number }[]>`
        select tu.tenant_id, r.code as role_code, t.legal_name as tenant_name,
               (
                 select count(*)::int from tenant_users peer
                 join roles peer_role on peer_role.id = peer.role_id
                 where peer.tenant_id = tu.tenant_id and peer.status = 'active'
                   and peer_role.code = 'owner' and peer.user_id <> ${actor.userId}
               ) as other_owners
        from tenant_users tu
        join roles r on r.id = tu.role_id
        join tenants t on t.id = tu.tenant_id
        where tu.user_id = ${actor.userId} and tu.status = 'active'
      `;
    });

    const orphaned = memberships.filter((m) => m.role_code === 'owner' && m.other_owners === 0);
    if (orphaned.length > 0) {
      throw new BadRequestException(
        `You are the only Owner of ${orphaned.map((m) => m.tenant_name).join(', ')}. ` +
          'Make someone else an Owner first, or ask us to close the workspace instead.',
      );
    }

    // Audited before the account stops existing, and once per workspace:
    // each one keeps its own trail, and after this runs there is no email
    // left on the row to say who left.
    for (const membership of memberships) {
      await this.audit.record({
        tenantId: membership.tenant_id,
        userId: actor.userId,
        userRoleCode: membership.role_code,
        action: 'account_deleted',
        entityType: 'user',
        entityId: actor.userId,
        ipAddress,
      });
    }

    // `users` is global identity and carries no row-level policy, so this
    // one runs on the bare connection.
    //
    // The email is derived from the id rather than a constant because the
    // column is unique: two deletions would collide, and the second person
    // would be told theirs failed.
    await this.sql`
      update users
      set email = ${`deleted-${actor.userId}@removed.invalid`},
          full_name = 'Deleted user',
          mobile = null,
          password_hash = null,
          session_epoch = session_epoch + 1,
          deleted_at = now(),
          updated_at = now()
      where id = ${actor.userId}
    `;

    // `tenant_users` is not global, and is under FORCE ROW LEVEL SECURITY:
    // one statement on the bare connection matches zero rows and disables
    // nothing, silently. It looked like it had worked -- the account could
    // no longer sign in, because the password was already gone -- while the
    // workspace went on listing the person as an active member. So it is
    // one statement per workspace, each inside that workspace's context.
    for (const membership of memberships) {
      await withTenant(this.sql, membership.tenant_id, (tx) => tx`
        update tenant_users set status = 'disabled'
        where user_id = ${actor.userId} and tenant_id = ${membership.tenant_id}
      `);
    }

    return {
      deleted: true,
      workspaces: memberships.length,
      message:
        'Your sign-in has been removed and every session ended. Records of work you did ' +
        '-- receipts, dispatches, invoices -- stay with the workspace that is legally required to keep them, ' +
        'with your name replaced.',
    };
  }

  /**
   * An Owner asking for the whole workspace to go.
   *
   * This records the request and stops everyone signing in; it does not
   * drop the data. A warehouse's stock ledger and issued invoices are
   * statutory records (GST: six years), so how long they are kept after a
   * workspace closes is a decision for whoever runs the service, not
   * something to hard-code here and certainly not something to do
   * immediately because a button was clicked. What the product can honestly
   * promise -- and does -- is that access ends now.
   */
  async requestWorkspaceDeletion(actor: AuthenticatedUser, reason: string | undefined, ipAddress?: string) {
    const [tenant] = await withTenant(this.sql, actor.tenantId, (tx) => tx<{ legal_name: string }[]>`
      select legal_name from tenants where id = ${actor.tenantId}
    `);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'workspace_deletion_requested',
      entityType: 'tenant',
      entityId: actor.tenantId,
      newValue: { reason: reason ?? null, requestedAt: new Date().toISOString() },
      ipAddress,
    });

    await withTenant(this.sql, actor.tenantId, (tx) => tx`
      update tenant_users set status = 'disabled'
      where tenant_id = ${actor.tenantId}
    `);

    return {
      requested: true,
      workspace: tenant?.legal_name ?? null,
      message:
        'Every sign-in for this workspace has been disabled. The records it holds are kept for the ' +
        'statutory retention period and then removed; write to us if you need them exported first.',
    };
  }
}
