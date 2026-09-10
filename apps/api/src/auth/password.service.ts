import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { AuditService } from '../audit/audit.service';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { EmailChannel } from '../notifications/channels/email.channel';
import { AuthenticatedUser } from './jwt-payload';

/** How long a reset link lives. Long enough to reach an inbox, short enough that a forwarded mail is not a standing key. */
const RESET_TTL_MINUTES = 60;

/**
 * Everything that changes a password.
 *
 * Four ways in, because a warehouse has four situations and only one of
 * them is "I am signed in and want a new password":
 *
 * - **`change`** -- signed in, knows the current one.
 * - **`forget` / `reset`** -- knows the email, has lost the password.
 *   Needs SMTP configured; without it the link is generated and goes
 *   nowhere, which is why `forget` says so in the log rather than silently
 *   pretending to have sent something.
 * - **`setPasswordForMember`** -- an Owner hands an operator a new password across
 *   the desk. This is the path that works with no email at all, and on a
 *   warehouse floor it is the common one: the person who forgot their
 *   password is standing in front of the person who can fix it.
 *
 * All four end at `writePassword`, which is also the only place
 * `password_changed_at` is set -- the column `JwtAuthGuard` reads to
 * decide that every token issued before now is dead. Without that, a
 * "reset" would leave whoever knew the old password signed in for the rest
 * of the day, which is precisely the thing a reset is for.
 */
@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);

  constructor(
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
    private readonly audit: AuditService,
    private readonly email: EmailChannel,
  ) {}

  async change(actor: AuthenticatedUser, currentPassword: string, newPassword: string, ipAddress?: string) {
    const [row] = await this.sql<{ password_hash: string }[]>`
      select password_hash from users where id = ${actor.userId}
    `;
    if (!row) throw new UnauthorizedException('Sign in again');

    if (!(await argon2.verify(row.password_hash, currentPassword))) {
      // Audited, and deliberately at the same level as a failed login: a
      // run of these on one account is somebody at an unlocked screen
      // guessing, and that is exactly what an Owner reading the audit log
      // wants to be able to see.
      await this.audit.record({
        tenantId: actor.tenantId,
        userId: actor.userId,
        userRoleCode: actor.roleCode,
        action: 'password_change_failed',
        entityType: 'user',
        entityId: actor.userId,
        ipAddress,
      });
      throw new UnauthorizedException('That is not your current password');
    }
    if (currentPassword === newPassword) {
      throw new BadRequestException('The new password has to be different from the current one');
    }

    await this.writePassword(actor.userId, newPassword);
    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'password_changed',
      entityType: 'user',
      entityId: actor.userId,
      ipAddress,
    });
    return { changed: true };
  }

  /**
   * Always the same answer, whether or not the address has an account.
   *
   * `POST /auth/signup` already refuses a taken email, so this endpoint is
   * not the only way to learn an address is registered -- but it is the
   * one an anonymous caller can run down a list with, so it does not
   * confirm anything, and the rate limit on it is the tight per-credential
   * one rather than the loose global backstop.
   */
  async forget(email: string, ipAddress?: string) {
    const [user] = await this.sql<{ id: string; full_name: string }[]>`
      select id, full_name from users where email = ${email}
    `;

    if (user) {
      const token = randomBytes(32).toString('base64url');
      await this.sql`
        insert into password_reset_tokens (id, user_id, token_hash, expires_at, requested_ip)
        values (
          ${randomUUID()}, ${user.id}, ${hashToken(token)},
          now() + ${`${RESET_TTL_MINUTES} minutes`}::interval, ${ipAddress ?? null}
        )
      `;
      // `PUBLIC_WEB_URL`, not `PUBLIC_APP_URL`: the latter is where the QR
      // codes on documents point, which is the *API*. A reset link has to
      // open the web app's own screen, and sending someone to a JSON
      // endpoint is the kind of mistake that only shows up in production.
      const webBase = (process.env.PUBLIC_WEB_URL ?? 'http://localhost:5173').replace(/\/$/, '');
      const link = `${webBase}/reset-password?token=${token}`;
      if (this.email.configured) {
        try {
          await this.email.send({
            to: email,
            subject: 'Reset your warehouse password',
            body:
              `Hello ${user.full_name},\n\n` +
              `Open this link to choose a new password. It works once and expires in ${RESET_TTL_MINUTES} minutes:\n\n` +
              `${link}\n\n` +
              `If you did not ask for this, you can ignore this mail -- your password has not changed.\n`,
            severity: 'critical',
          });
        } catch (error) {
          // Not re-thrown: the caller is told the same thing either way, and
          // a provider outage must not become an oracle for which addresses
          // exist. It is loud in the log instead, where it belongs.
          this.logger.error(`Could not send the reset mail: ${error instanceof Error ? error.message : error}`);
        }
      } else {
        this.logger.warn(
          'SMTP_URL is not set, so a password reset link was created but not delivered. ' +
            'Set SMTP_URL, or have an Owner set the password from Settings -> Users instead.',
        );
      }
    }

    return {
      accepted: true,
      message: 'If that email has an account, a reset link is on its way.',
    };
  }

  async reset(token: string, newPassword: string, ipAddress?: string) {
    const [row] = await this.sql<{ id: string; user_id: string; expired: boolean; used: boolean }[]>`
      select id, user_id, expires_at < now() as expired, used_at is not null as used
      from password_reset_tokens where token_hash = ${hashToken(token)}
    `;
    // One message for all three failures. "Already used" and "expired" are
    // more helpful to the person who owns the link, and more helpful still
    // to someone spraying guesses at the endpoint.
    if (!row || row.expired || row.used) {
      throw new BadRequestException('That reset link is not valid any more. Ask for a new one.');
    }

    await this.writePassword(row.user_id, newPassword);
    await this.sql`update password_reset_tokens set used_at = now() where id = ${row.id}`;
    // Any other outstanding link for this account dies with it: someone who
    // asked three times and used the third should not leave two live keys
    // behind in an inbox.
    await this.sql`
      update password_reset_tokens set used_at = now()
      where user_id = ${row.user_id} and used_at is null
    `;

    // A password reset is not tenant work -- the account may hold
    // memberships in several workspaces -- but it is exactly the event each
    // of those workspaces should be able to see in its own audit log.
    // The same problem login has, and the same answer: which workspaces
    // this account belongs to has to be read before any one of them is
    // chosen. `schema/91_tenant_users_self_lookup.sql` allows exactly that
    // -- SELECT only, and only for the user named in `app.actor_user_id`,
    // which is set here for one statement after the token was verified.
    const memberships = await this.sql.begin(async (tx) => {
      await tx`select set_config('app.actor_user_id', ${row.user_id}, true)`;
      return tx<{ tenant_id: string; role_code: string }[]>`
        select tu.tenant_id, r.code as role_code
        from tenant_users tu join roles r on r.id = tu.role_id
        where tu.user_id = ${row.user_id}
      `;
    });
    for (const membership of memberships) {
      await this.audit.record({
        tenantId: membership.tenant_id,
        userId: row.user_id,
        userRoleCode: membership.role_code,
        action: 'password_reset',
        entityType: 'user',
        entityId: row.user_id,
        ipAddress,
      });
    }
    return { reset: true };
  }

  /**
   * An Owner or Admin setting a member's password directly.
   *
   * Scoped to the caller's own workspace by the `tenant_users` join, so
   * "reset this user" cannot reach an account that merely exists -- only
   * one that is a member here. The caller's own account is excluded: an
   * Owner changing their own password goes through `change()` and has to
   * type the current one, which is the difference between an
   * administrative action and a bypass of it.
   */
  async setPasswordForMember(actor: AuthenticatedUser, tenantUserId: string, newPassword: string, ipAddress?: string) {
    // Through `withTenant`: `tenant_users` is under FORCE ROW LEVEL
    // SECURITY, so this join on the bare connection matches zero rows and
    // the route answers 404 for a member who plainly exists. (It did,
    // first run.)
    const [member] = await withTenant(this.sql, actor.tenantId, (tx) => tx<{ user_id: string; email: string }[]>`
      select tu.user_id, u.email
      from tenant_users tu join users u on u.id = tu.user_id
      where tu.id = ${tenantUserId} and tu.tenant_id = ${actor.tenantId}
    `);
    if (!member) throw new NotFoundException('No such member of this workspace');
    if (member.user_id === actor.userId) {
      throw new BadRequestException('Change your own password from your account settings, with the current one');
    }

    await this.writePassword(member.user_id, newPassword);
    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      userRoleCode: actor.roleCode,
      action: 'password_set_for_member',
      entityType: 'user',
      entityId: member.user_id,
      newValue: { email: member.email },
      ipAddress,
    });
    return { email: member.email };
  }

  /**
   * The one write. `password_changed_at` moves with the hash, always, in
   * the same statement -- a path that updated one without the other would
   * leave the old sessions alive, and that is not the sort of thing to
   * leave to whoever adds the fifth way to set a password.
   */
  private async writePassword(userId: string, newPassword: string): Promise<void> {
    const hash = await argon2.hash(newPassword);
    await this.sql`
      update users
      set password_hash = ${hash},
          password_changed_at = now(),
          session_epoch = session_epoch + 1,
          updated_at = now()
      where id = ${userId}
    `;
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
