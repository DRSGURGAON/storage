import { SetMetadata } from '@nestjs/common';

export const REQUIRED_PERMISSION_KEY = 'requiredPermission';

/** Permission codes are the ones seeded from permissions-matrix.md (db/seed-data.ts PERMISSIONS). */
export const RequirePermission = (permissionCode: string) =>
  SetMetadata(REQUIRED_PERMISSION_KEY, permissionCode);
