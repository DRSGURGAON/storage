import 'dotenv/config';
import postgres from 'postgres';
import { PERMISSIONS, ROLE_PERMISSIONS, SYSTEM_ROLES } from './seed-data';

/**
 * Idempotent: safe to run on every deploy. Relies on
 * schema/85_integrity_fixes.sql's partial unique index on
 * roles(code) where tenant_id is null -- without it, ON CONFLICT (code)
 * would not match these rows at all (see DECISIONS.md §16), and every run
 * would insert a fresh set of duplicate system roles.
 */
async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set (copy .env.example to .env)');
  }

  const sql = postgres(databaseUrl, { max: 1 });

  try {
    const roleIds = new Map<string, string>();

    for (const role of SYSTEM_ROLES) {
      const [row] = await sql<{ id: string }[]>`
        insert into roles (id, tenant_id, code, name, is_system)
        values (gen_random_uuid(), null, ${role.code}, ${role.name}, true)
        on conflict (code) where tenant_id is null
        do update set name = excluded.name
        returning id
      `;
      roleIds.set(role.code, row.id);
    }
    console.log(`seeded ${SYSTEM_ROLES.length} system roles`);

    for (const permission of PERMISSIONS) {
      await sql`
        insert into permissions (code, module)
        values (${permission.code}, ${permission.module})
        on conflict (code) do update set module = excluded.module
      `;
    }
    console.log(`seeded ${PERMISSIONS.length} permissions`);

    let grantCount = 0;
    for (const [roleCode, permissionCodes] of Object.entries(
      ROLE_PERMISSIONS,
    )) {
      const roleId = roleIds.get(roleCode);
      if (!roleId) {
        throw new Error(`Unknown role code in ROLE_PERMISSIONS: ${roleCode}`);
      }
      for (const permissionCode of permissionCodes) {
        await sql`
          insert into role_permissions (role_id, permission_code)
          values (${roleId}, ${permissionCode})
          on conflict (role_id, permission_code) do nothing
        `;
        grantCount++;
      }
    }
    console.log(`seeded ${grantCount} role-permission grants`);

    console.log('Seed complete.');
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
