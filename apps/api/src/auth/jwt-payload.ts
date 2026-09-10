export interface JwtPayload {
  sub: string; // userId
  tenantId: string;
  tenantUserId: string;
  roleCode: string;
  /**
   * Set only for a customer-portal login (`tenancy-and-security.md` §2:
   * "ordinary `tenant_users` rows with `role = customer` and a mandatory
   * `customer_id`"). It is carried in the token rather than looked up per
   * request so a portal handler cannot forget to scope itself, and it is
   * re-checked against the membership on every portal call.
   */
  customerId?: string | null;
  /**
   * The value of `users.session_epoch` when this token was minted.
   * `JwtStrategy` refuses a token whose epoch is behind the account's
   * current one, which is how a password change ends the sessions that
   * were already open -- the whole of what "reset my password" means when
   * sessions are stateless.
   *
   * A counter rather than a timestamp comparison, because `iat` has
   * one-second resolution: a token minted at 10.2s and a password changed
   * at 10.9s are indistinguishable by time, and the first version of this
   * check let exactly that token live.
   */
  epoch?: number;
}

export interface AuthenticatedUser {
  userId: string;
  tenantId: string;
  tenantUserId: string;
  roleCode: string;
  customerId?: string | null;
}
