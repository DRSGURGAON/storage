import { CustomDecorator, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModuleOptions } from '@nestjs/throttler';

/**
 * Rate limiting, as one throttler with per-route overrides rather than
 * several named ones.
 *
 * That is not a style preference. With `@nestjs/throttler`, *every* named
 * throttler is evaluated on *every* route -- `@Throttle({ auth: ... })`
 * overrides one's configuration for a route, it does not scope it to that
 * route. Declaring `auth: 8/min` alongside a generous default therefore
 * caps the whole API at eight requests a minute, which is exactly what
 * happened here: the suite went from green to 54 failures, all `429`, on
 * document and gate-entry routes that have nothing to do with logging in.
 * One throttler with per-route limits is the shape that actually says
 * what it means.
 */
export const THROTTLE_SCOPE_KEY = 'throttle:scope';

/**
 * Marks a route as keyed on the *credential being tried* rather than the
 * caller's address. See `ScopedThrottlerGuard.getTracker`.
 */
export const ThrottlePerCredential = (): CustomDecorator => SetMetadata(THROTTLE_SCOPE_KEY, 'credential');

/**
 * The single global limit: a runaway-script backstop, and only that. It is
 * set high on purpose. A per-IP limit is the wrong shape for the
 * authenticated half of a multi-tenant API -- a whole warehouse office
 * sits behind one NAT address, so any figure tight enough to be a real
 * defence would throttle a customer's entire staff as one caller. Those
 * routes are already gated by a JWT and a permission check, so the
 * attacker it would stop has to authenticate first. Rationing them
 * properly means a per-tenant quota, which is a plan/entitlement question
 * rather than a network one; until that exists, a generous ceiling that
 * catches an infinite loop is worth more than a tight one that pages
 * someone every busy shift.
 *
 * The routes that genuinely need a tight limit are the anonymous ones, and
 * they set their own (see `auth.controller.ts`, `verify.controller.ts`).
 * All limits are env-overridable so a load test or a deployment behind an
 * aggressive CDN can widen them without a code change.
 */
export function throttlerConfig(env: NodeJS.ProcessEnv): ThrottlerModuleOptions {
  return {
    throttlers: [
      {
        name: 'default',
        ttl: positiveNumber(env.RATE_LIMIT_TTL_MS, 60_000),
        limit: positiveNumber(env.RATE_LIMIT_MAX, 2_000),
      },
    ],
  };
}

export function positiveNumber(raw: string | undefined, fallback: number): number {
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Limits on the credential endpoints are keyed on **(IP, email)** rather
 * than IP alone.
 *
 * A plain per-IP limit is wrong in both directions there. Too low and it
 * breaks the warehouse office where forty people share one NAT address;
 * too high and it leaves room to guess one account's password thousands
 * of times a day. Keying on the account being *attacked* fixes both:
 * guessing one password stops after a handful of tries, while forty
 * different people signing in from the same address never collide.
 *
 * The IP stays in the key deliberately, so an attacker cannot lock a
 * victim out of their own account by burning the allowance from
 * elsewhere -- a denial of service that pure per-account throttling would
 * introduce while fixing the guessing one.
 */
@Injectable()
export class ScopedThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>, context?: ExecutionContext): Promise<string> {
    const ip = (req.ips as string[] | undefined)?.length ? (req.ips as string[])[0] : String(req.ip);
    const scope = context
      ? new Reflector().getAllAndOverride<string | undefined>(THROTTLE_SCOPE_KEY, [
          context.getHandler(),
          context.getClass(),
        ])
      : undefined;
    if (scope !== 'credential') return ip;

    const body = (req.body ?? {}) as { email?: unknown };
    // Lower-cased so `Owner@x.com` and `owner@x.com` share one bucket
    // rather than handing an attacker a free second budget.
    const email = typeof body.email === 'string' ? body.email.toLowerCase() : '<none>';
    return `${ip}:${email}`;
  }
}
