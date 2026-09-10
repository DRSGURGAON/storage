import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type postgres from 'postgres';
import { PG_CONNECTION } from '../db/db.module';
import { withTenant } from '../db/tenant-context';
import { AuthenticatedUser, JwtPayload } from './jwt-payload';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    @Inject(PG_CONNECTION) private readonly sql: postgres.Sql,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  /**
   * A valid signature is not the same as a live session.
   *
   * This used to return the claims and nothing else, which meant a token
   * stayed good for its full twelve hours no matter what happened to the
   * account behind it: a password reset left whoever knew the old password
   * signed in until the token expired -- the exact situation a reset
   * exists to end -- and a membership disabled at 9am kept working until
   * that evening.
   *
   * So one indexed lookup per request, next to the several every handler
   * already makes. It answers both questions at once: is this membership
   * still active, and was this token issued before the password changed.
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const [row] = await withTenant(this.sql, payload.tenantId, (tx) =>
      tx<{ status: string; session_epoch: number }[]>`
        select tu.status, u.session_epoch
        from tenant_users tu join users u on u.id = tu.user_id
        where tu.id = ${payload.tenantUserId} and tu.tenant_id = ${payload.tenantId}
      `,
    );

    if (!row) throw new UnauthorizedException('This membership no longer exists');
    if (row.status !== 'active') throw new UnauthorizedException('This membership is no longer active');
    // `?? 0` covers a token minted before this claim existed: on the
    // deployment that introduces it, every account is still at epoch 0, so
    // those tokens pass -- nobody is signed out by the upgrade itself.
    if ((payload.epoch ?? 0) < row.session_epoch) {
      throw new UnauthorizedException('The password for this account changed. Sign in again.');
    }

    return {
      userId: payload.sub,
      tenantId: payload.tenantId,
      tenantUserId: payload.tenantUserId,
      roleCode: payload.roleCode,
      customerId: payload.customerId ?? null,
    };
  }
}
