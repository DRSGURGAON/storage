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
}

export interface AuthenticatedUser {
  userId: string;
  tenantId: string;
  tenantUserId: string;
  roleCode: string;
  customerId?: string | null;
}
