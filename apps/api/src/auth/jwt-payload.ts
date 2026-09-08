export interface JwtPayload {
  sub: string; // userId
  tenantId: string;
  tenantUserId: string;
  roleCode: string;
}

export interface AuthenticatedUser {
  userId: string;
  tenantId: string;
  tenantUserId: string;
  roleCode: string;
}
