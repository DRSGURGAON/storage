import { BadRequestException, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface DownloadLinkClaims {
  /** `documents.id` this link releases, and nothing else. */
  documentId: string;
  tenantId: string;
  /** Set when a portal session minted the link; the consumer re-checks it. */
  customerId: string | null;
  /** Seconds since the epoch. */
  expiresAt: number;
}

/**
 * `tenancy-and-security.md` §5 and `dev-phases.md` Phase 8's open item:
 * "file access requires a valid signed URL scoped to the requester's
 * tenant/customer". Until now every download went through the
 * authenticated API, which is safe but cannot be handed to anything that
 * does not carry a JWT -- an `<img>`/`<iframe>` in a page, a link in an
 * email, a customer forwarding a delivery note to their own accountant.
 *
 * A link is `payload.signature`, both base64url:
 *
 *   payload   = the claims above, as JSON
 *   signature = HMAC-SHA256(payload, secret)
 *
 * The claims travel in the link rather than in a table, so consuming one
 * costs no row and no write, and there is nothing to clean up when it
 * expires. The trade is that a minted link cannot be revoked before its
 * expiry -- which is why the default life is minutes, not days, and why
 * the claims name one document rather than a customer or a folder. A
 * short-lived bearer capability is exactly what this is; it is not a
 * second authentication scheme, and it deliberately grants nothing beyond
 * "read these bytes".
 *
 * Signed with `DOCUMENT_LINK_SECRET` when set, otherwise `JWT_SECRET`.
 * Sharing the JWT secret by default is deliberate: an installation that
 * has one properly-secret value should not silently get a second,
 * weaker one just because a new feature wanted its own key. Rotating
 * either invalidates outstanding links, which for a five-minute lifetime
 * is a non-event.
 */
@Injectable()
export class DownloadLinkService {
  private secret(): string {
    const secret = process.env.DOCUMENT_LINK_SECRET ?? process.env.JWT_SECRET;
    if (!secret) throw new Error('DOCUMENT_LINK_SECRET or JWT_SECRET must be set to sign document links');
    return secret;
  }

  get ttlSeconds(): number {
    const configured = Number(process.env.DOCUMENT_LINK_TTL_SECONDS);
    return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 300;
  }

  sign(claims: Omit<DownloadLinkClaims, 'expiresAt'>, ttlSeconds = this.ttlSeconds): { token: string; path: string; expiresAt: Date } {
    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
    const payload = Buffer.from(JSON.stringify({ ...claims, expiresAt })).toString('base64url');
    const token = `${payload}.${this.digest(payload)}`;
    return { token, path: `/document-links/${token}`, expiresAt: new Date(expiresAt * 1000) };
  }

  /**
   * Verifies the signature before it parses anything, and compares in
   * constant time: a link is a bearer credential, so an attacker who can
   * measure how long a rejection takes must learn nothing from it.
   */
  verify(token: string): DownloadLinkClaims {
    const [payload, signature] = token.split('.');
    if (!payload || !signature) throw new BadRequestException('That link is not valid');
    const expected = Buffer.from(this.digest(payload));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      throw new BadRequestException('That link is not valid');
    }
    let claims: DownloadLinkClaims;
    try {
      claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    } catch {
      throw new BadRequestException('That link is not valid');
    }
    if (typeof claims.expiresAt !== 'number' || claims.expiresAt * 1000 < Date.now()) {
      // Said plainly and differently from "not valid": an expired link is a
      // normal thing to be holding, and the person holding it should be told
      // to ask for a fresh one rather than to suspect they were phished.
      throw new BadRequestException('That link has expired -- open the document again for a new one');
    }
    if (!claims.documentId || !claims.tenantId) throw new BadRequestException('That link is not valid');
    return claims;
  }

  private digest(payload: string): string {
    return createHmac('sha256', this.secret()).update(payload).digest('base64url');
  }
}
